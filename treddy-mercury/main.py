import asyncio
import struct
import collections
import yaml
import time
from textual.app import App, ComposeResult
from textual.containers import Grid, Vertical
from textual.widgets import Header, Footer, Static, Digits, Label
from textual.reactive import reactive
from textual import work
from bleak import BleakScanner, BleakClient

from treadfit.fitbit_upload import calculate_calories, get_user_weight

# Bluetooth Configuration.
DEVICE_NAME = "I_TL"

# UUIDs
WRITE_UUID = "00001534-1412-efde-1523-785feabcd123"
NOTIFY_UUID = "00001535-1412-efde-1523-785feabcd123"

# --- PROTOCOL CONSTANTS ---

# 1. Initialization Sequence.
INITIALIZATION_SEQUENCE = [
    "fe022c04",
    "0012020402280428900701cec4b0aaa2a8949696",
    "0112aca8a2bad0dccefe14003a52786486a6fc18",
    "ff08324aa0880200004400000000000000000000",
]

# 2. Read/Poll Sequence.
POLL_SEQUENCE = [
    "fe021403",
    "001202040210041002000a1b9430000040500080",
    "ff02182700000000000000000000000000000000",
]


class MetricDigits(Digits):
    pass


class Metric(Static):
    def __init__(self, label: str, id: str):
        super().__init__(id=id)
        self.label_text = label

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label(self.label_text, classes="metric-label")
            yield MetricDigits("0.0", id=f"{self.id}-digits")

    def update_value(self, value):
        self.query_one(f"#{self.id}-digits", Digits).update(f"{value}")


class TreadmillApp(App):
    CSS = """
    Screen {
        layers: base;
        align: center middle;
    }

    .metric-label {
        text-align: center;
        width: 100%;
        color: #888888;
    }

    MetricDigits {
        text-align: center;
        width: 100%;
        color: #00ff00;
        margin-bottom: 2;
    }
    
    #status-bar {
        dock: bottom;
        height: 1;
        background: $primary;
        color: $text;
    }

    Grid {
        grid-size: 2 3;
        grid-gutter: 2;
        padding: 2;
        width: 80%;
        height: 80%;
        border: solid green;
    }
    """

    BINDINGS = [
        ("q", "quit", "Quit"),
    ]

    # Reactive state
    speed_kph = reactive(0.0)
    incline_deg = reactive(0.0)
    distance_km = reactive(0.0)
    seconds_total = reactive(0)
    calories_burned = reactive(0.0)
    calories_per_hour = reactive(0.0)
    connection_status = reactive("Disconnected")

    def __init__(self):
        super().__init__()
        self.parsed_events = collections.deque()
        self.ble_client = None
        self.stop_event = asyncio.Event()
        self.user_weight_kg = 86.0  # Default, will fetch
        self.accumulated_calories = 0.0
        self.last_calorie_update_time = time.time()

    def compose(self) -> ComposeResult:
        yield Header()
        with Grid():
            yield Metric("Speed (km/h)", id="speed")
            yield Metric("Incline (%)", id="incline")
            yield Metric("Distance (km)", id="distance")
            yield Metric("Time", id="time")
            yield Metric("Calories (kcal)", id="calories")
            yield Metric("Output (kcal/h)", id="cal_rate")
        yield Label("Status: Disconnected", id="status-bar")
        yield Footer()

    async def on_mount(self):
        # Fetch weight in background
        self.fetch_weight_worker()
        # Start BLE worker
        self.run_worker(self.ble_worker, exclusive=True)

    @work(thread=True)
    def fetch_weight_worker(self):
        try:
            w = get_user_weight()
            self.app.call_from_thread(self.update_weight, w)
        except Exception:
            pass

    def update_weight(self, weight):
        self.user_weight_kg = weight
        self.notify(f"User weight loaded: {weight} kg")

    async def ble_worker(self):
        while not self.stop_event.is_set():
            self.connection_status = f"Scanning for '{DEVICE_NAME}'..."
            self.update_status(self.connection_status)

            device = await BleakScanner.find_device_by_filter(
                lambda d, ad: d.name and d.name == DEVICE_NAME
            )

            if not device:
                self.connection_status = "Device not found. Retrying..."
                self.update_status(self.connection_status)
                await asyncio.sleep(5)
                continue

            self.connection_status = f"Found {device.name}. Connecting..."
            self.update_status(self.connection_status)

            try:
                async with BleakClient(device.address) as client:
                    self.ble_client = client
                    self.connection_status = "Connected"
                    self.update_status(self.connection_status)
                    await asyncio.sleep(0.1)

                    await client.start_notify(NOTIFY_UUID, self.parse_treadmill_data)

                    # Init sequence
                    for h in INITIALIZATION_SEQUENCE:
                        await client.write_gatt_char(
                            WRITE_UUID, bytes.fromhex(h), response=True
                        )
                        await asyncio.sleep(0.1)

                    # Start save loop as a concurrent task inside the connection block
                    save_task = asyncio.create_task(self.save_loop())

                    try:
                        while client.is_connected and not self.stop_event.is_set():
                            for hex_cmd in POLL_SEQUENCE:
                                await client.write_gatt_char(
                                    WRITE_UUID, bytes.fromhex(hex_cmd), response=True
                                )
                            await asyncio.sleep(1.0)

                            # Update derived metrics periodically
                            self.calculate_realtime_metrics()

                    finally:
                        save_task.cancel()

            except Exception as e:
                self.connection_status = f"Error: {e}"
                self.update_status(self.connection_status)
                await asyncio.sleep(5)

    def update_status(self, status):
        self.query_one("#status-bar", Label).update(f"Status: {status}")

    def parse_treadmill_data(self, _sender: int, data: bytearray):
        if len(data) < 12:
            return

        match data[0]:
            case 0x00:
                # Notification message.
                s = struct.unpack_from("<H", data, 10)[0] / 100.0
                i = struct.unpack_from("<H", data, 12)[0] / 100.0
                d = (
                    struct.unpack_from("<H", data, 16)[0] / 1000.0
                )  # BLE returns meters? Original code divided by 1000.

                # Update reactive variables
                self.update_metrics_00(s, i, d)

            case 0x01:
                # Notification message.
                sec = struct.unpack_from("<H", data, 9)[0]
                self.update_metrics_01(sec)

    def update_metrics_00(self, s, i, d):
        self.speed_kph = s
        self.incline_deg = i
        self.distance_km = d

    def update_metrics_01(self, sec):
        self.seconds_total = sec

    def calculate_realtime_metrics(self):
        # Calculate instantaneous calories
        now = time.time()
        dt = now - self.last_calorie_update_time
        if dt <= 0:
            return
        self.last_calorie_update_time = now

        # Calculate rate (cal/hour)
        cal_per_hour = calculate_calories(
            self.user_weight_kg, self.speed_kph, self.incline_deg, 3600
        )
        self.calories_per_hour = cal_per_hour

        # Accumulate total roughly
        # Only accumulate if speed > 0
        if self.speed_kph > 0.1:
            self.accumulated_calories += (cal_per_hour / 3600) * dt
            self.calories_burned = self.accumulated_calories

    async def save_loop(self):
        while True:
            await asyncio.sleep(30)
            data = {
                "timestamp": time.time(),
                "speed_kph": self.speed_kph,
                "incline_deg": self.incline_deg,
                "distance_km": self.distance_km,
                "seconds_total": self.seconds_total,
            }
            try:
                date_str = time.strftime("%Y-%m-%d", time.localtime(data["timestamp"]))
                with open(f"data/treadmill_data_{date_str}.yaml", "a") as f:
                    yaml.dump([data], f)
                self.notify("Data saved")
            except Exception as e:
                self.notify(f"Save failed: {e}", severity="error")

    # Watchers to update UI
    def watch_speed_kph(self, value):
        self.query_one("#speed", Metric).update_value(f"{value:.1f}")

    def watch_incline_deg(self, value):
        self.query_one("#incline", Metric).update_value(f"{value:.1f}")

    def watch_distance_km(self, value):
        self.query_one("#distance", Metric).update_value(f"{value:.3f}")

    def watch_seconds_total(self, value):
        minutes = (value // 60) % 60
        seconds = value % 60
        hours = value // 3600
        if hours > 0:
            self.query_one("#time", Metric).update_value(
                f"{hours}:{minutes:02d}:{seconds:02d}"
            )
        else:
            self.query_one("#time", Metric).update_value(f"{minutes}:{seconds:02d}")

    def watch_calories_burned(self, value):
        self.query_one("#calories", Metric).update_value(f"{int(value)}")

    def watch_calories_per_hour(self, value):
        self.query_one("#cal_rate", Metric).update_value(f"{int(value)}")


if __name__ == "__main__":
    app = TreadmillApp()
    app.run()
