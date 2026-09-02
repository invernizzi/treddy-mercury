import asyncio
import struct
import time
try:
    from bleak import BleakScanner, BleakClient
except ImportError:
    BleakScanner = None  # type: ignore
    BleakClient = None  # type: ignore

from treadfit.calories import calculate_calories

# Bluetooth Configuration.
DEVICE_NAME = "I_TL"

# UUIDs
WRITE_UUID = "00001534-1412-efde-1523-785feabcd123"
NOTIFY_UUID = "00001535-1412-efde-1523-785feabcd123"

# 1. Full Initialization & Unlock Sequences.
FULL_INITIALIZATION_SEQUENCES = [
    # Initial 6 handshake packet pairs
    ["fe020802", "ff08020402040204818700000000000000000000"],
    ["fe020802", "ff08020402040404808800000000000000000000"],
    ["fe020802", "ff08020402040404889000000000000000000000"],
    ["fe020a02", "ff0a0204020602068200008a0000000000000000"],
    ["fe020a02", "ff0a0204020602068400008c0000000000000000"],
    ["fe020802", "ff08020402040204959b00000000000000000000"],
    # Primary 4-packet initialization
    [
        "fe022c04",
        "0012020402280428900701cec4b0aaa2a8949696",
        "0112aca8a2bad0dccefe14003a52786486a6fc18",
        "ff08324aa0880200004400000000000000000000",
    ],
    # Setup / parameter configuration sequences
    [
        "fe021903",
        "001202040215041502000f001000d81c480000e0",
        "ff070000001000086e0000000000000000000000",
    ],
    [
        "fe021903",
        "0012020402150415020e00000000000000000000",
        "ff070000001001003a0000000000000000000000",
    ],
    [
        "fe021703",
        "0012020402130413020c00000000000000000000",
        "ff0500800000a500000000000000000000000000",
    ],
    [
        "fe021703",
        "0012020402130413020c00000000000000000000",
        "ff0500800000a500000000000000000000000000",
    ],
    [
        "fe021703",
        "0012020402130413020c00000000000000000000",
        "ff0500800000a500000000000000000000000000",
    ],
    [
        "fe021703",
        "0012020402130413020c00000000000000000000",
        "ff0500800000a500000000000000000000000000",
    ],
    [
        "fe022c04",
        "0012020402280428900701cec4b0aaa2a8949696",
        "0112aca8a2bad0dccefe14003a52786486a6fc18",
        "ff08324aa0880200004400000000000000000000",
    ],
    [
        "fe022003",
        "00120204021c041c020900004002184000008030",
        "ff0e2a0000c720580200b400580200ee00000000",
    ],
    # Remote Control Mode Enable / Start workout sequences (iFit Mode)
    [
        "fe021102",
        "ff110204020d040d02020310a00000000a00d200",
    ],
    [
        "fe021102",
        "ff110204020d040d02020310a00000000200ca00",
    ],
]

# 2. Read/Poll Sequence.
POLL_SEQUENCE = [
    "fe021403",
    "001202040210041002000a1b9430000040500080",
    "ff02182700000000000000000000000000000000",
]


def build_control_packets(target: int, value: int) -> tuple[bytes, bytes]:
    """Generates the header and payload BLE packets for iFit treadmill controls.

    target: 0x01 for SPEED, 0x02 for INCLINE
    value: integer parameter (e.g. kph * 100 or incline_deg * 100)
    """
    v_unsigned = value & 0xFFFF
    v_low = v_unsigned & 0xFF
    v_high = (v_unsigned >> 8) & 0xFF
    checksum = (0x10 + target + v_low + v_high) & 0xFF

    header = bytes.fromhex("fe020d02")
    payload = bytes([
        0xFF,
        0x0D,
        0x02,
        0x04,
        0x02,
        0x09,
        0x04,
        0x09,
        0x02,
        0x01,
        target,
        v_low,
        v_high,
        0x00,
        checksum,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
    ])
    return header, payload


class TreadmillClient:
    def __init__(self, metrics_callback, status_callback):
        self.stop_event = asyncio.Event()
        self.metrics_callback = metrics_callback
        self.status_callback = status_callback

        self.speed_kph = 0.0
        self.incline_deg = 0.0
        self.distance_km = 0.0
        self.seconds_total = 0.0
        self.calories_burned = 0.0
        self.calories_per_hour = 0.0

        self.user_weight_kg = 86.0
        self.accumulated_calories = 0.0
        self.has_synced_initial_state = False
        self.last_metric_update_time = time.time()

    def set_user_weight(self, weight):
        self.user_weight_kg = weight

    def get_metrics_snapshot(self):
        return {
            "speed_kph": self.speed_kph,
            "incline_deg": self.incline_deg,
            "distance_km": self.distance_km,
            "seconds_total": self.seconds_total,
            "calories_burned": self.calories_burned,
            "calories_per_hour": self.calories_per_hour,
        }

    def _push_metrics(self):
        self.metrics_callback(self.get_metrics_snapshot())

    def _push_status(self, status):
        self.status_callback(status)

    def sync_initial_workout_state(self, distance_km, speed_kph, incline_deg):
        initial_secs = self.seconds_total
        if initial_secs <= 0 and speed_kph > 0:
            initial_secs = (distance_km / speed_kph) * 3600
        if initial_secs > 0:
            initial_cals = calculate_calories(
                self.user_weight_kg, speed_kph, incline_deg, initial_secs
            )
            self.accumulated_calories = initial_cals
            self.calories_burned = self.accumulated_calories
            if self.seconds_total <= 0:
                self.seconds_total = initial_secs

    def parse_treadmill_data(self, _sender: int, data: bytearray):
        if len(data) < 10:
            return

        match data[0]:
            case 0x00:
                if len(data) < 18:
                    return
                # Notification message.
                s = struct.unpack_from("<H", data, 10)[0] / 100.0
                i = struct.unpack_from("<H", data, 12)[0] / 100.0
                d = (
                    struct.unpack_from("<H", data, 16)[0] / 1000.0
                )  # BLE returns meters? Original code divided by 1000.

                if not self.has_synced_initial_state and d > 0:
                    self.sync_initial_workout_state(d, s, i)
                    self.has_synced_initial_state = True

                self.speed_kph = s
                self.incline_deg = i
                self.distance_km = d
                self._push_metrics()

            case 0x01:
                # Notification message - Time received from treadmill.
                if len(data) >= 11:
                    treadmill_secs = struct.unpack_from("<H", data, 9)[0]
                    if treadmill_secs > 0:
                        if (
                            not self.has_synced_initial_state
                            and self.distance_km > 0
                            and self.accumulated_calories == 0
                        ):
                            avg_speed = (
                                self.speed_kph
                                if self.speed_kph > 0
                                else (self.distance_km / treadmill_secs) * 3600
                            )
                            self.accumulated_calories = calculate_calories(
                                self.user_weight_kg,
                                avg_speed,
                                self.incline_deg,
                                treadmill_secs,
                            )
                            self.calories_burned = self.accumulated_calories
                            self.seconds_total = treadmill_secs
                            self.has_synced_initial_state = True
                            self._push_metrics()
                        elif self.seconds_total <= 0:
                            self.seconds_total = treadmill_secs
                            self._push_metrics()

    def calculate_realtime_metrics(self):
        # Calculate instantaneous calories and time
        now = time.time()
        dt = now - self.last_metric_update_time
        self.last_metric_update_time = now

        if dt <= 0:
            return

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
            self.seconds_total += dt
        
        self._push_metrics()

    async def ble_worker(self):
        while not self.stop_event.is_set():
            self._push_status(f"Scanning for '{DEVICE_NAME}'...")
            
            device = await BleakScanner.find_device_by_filter(
                lambda d, ad: d.name and d.name == DEVICE_NAME
            )

            if not device:
                self._push_status("Device not found. Retrying...")
                await asyncio.sleep(5)
                continue

            self._push_status(f"Found {device.name}. Connecting...")

            try:
                async with BleakClient(device.address) as client:
                    self._push_status("Connected")
                    await asyncio.sleep(0.1)

                    await client.start_notify(NOTIFY_UUID, self.parse_treadmill_data)

                    # Init sequence
                    for seq in FULL_INITIALIZATION_SEQUENCES:
                        for h in seq:
                            await client.write_gatt_char(
                                WRITE_UUID, bytes.fromhex(h), response=True
                            )
                            await asyncio.sleep(0.02)
                        await asyncio.sleep(0.04)

                    while client.is_connected and not self.stop_event.is_set():
                        for hex_cmd in POLL_SEQUENCE:
                            await client.write_gatt_char(
                                WRITE_UUID, bytes.fromhex(hex_cmd), response=True
                            )
                        await asyncio.sleep(1.0)

                        # Update derived metrics periodically
                        self.calculate_realtime_metrics()

            except Exception as e:
                self._push_status(f"Error: {e}")
                await asyncio.sleep(5)
