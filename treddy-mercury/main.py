import asyncio
import time
import os
import yaml
from textual.app import App, ComposeResult
from textual.containers import Grid, Vertical
from textual.widgets import Header, Footer, Static, Digits, Label
from textual.reactive import reactive
from textual import work

from treadfit.fitbit_upload import get_user_weight
from treadfit.ble import TreadmillClient


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
    seconds_total = reactive(0.0)
    calories_burned = reactive(0.0)
    calories_per_hour = reactive(0.0)

    def __init__(self):
        super().__init__()
        self.client = TreadmillClient(
            metrics_callback=self.on_metrics_update, status_callback=self.update_status
        )

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

    def on_metrics_update(self, metrics: dict):
        self.speed_kph = metrics["speed_kph"]
        self.incline_deg = metrics["incline_deg"]
        self.distance_km = metrics["distance_km"]
        self.seconds_total = metrics["seconds_total"]
        self.calories_burned = metrics["calories_burned"]
        self.calories_per_hour = metrics["calories_per_hour"]

    def update_status(self, status: str):
        try:
            self.query_one("#status-bar", Label).update(f"Status: {status}")
        except Exception:
            pass

    async def on_mount(self):
        # Fetch weight in background
        self.fetch_weight_worker()
        
        # Start BLE worker and Save Loop
        self.run_worker(self.client.ble_worker, exclusive=True)
        self.run_worker(self.save_loop, exclusive=True)

    @work(thread=True)
    def fetch_weight_worker(self):
        try:
            w = get_user_weight()
            self.app.call_from_thread(self.update_weight, w)
        except Exception:
            pass

    def update_weight(self, weight):
        self.client.set_user_weight(weight)
        self.notify(f"User weight loaded: {weight} kg")

    async def save_loop(self):
        while not self.client.stop_event.is_set():
            await asyncio.sleep(30)
            data = {
                "timestamp": time.time(),
                "speed_kph": self.speed_kph,
                "incline_deg": self.incline_deg,
                "distance_km": self.distance_km,
                "seconds_total": self.seconds_total,
            }
            try:
                os.makedirs("data", exist_ok=True)
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
        minutes = int((value // 60) % 60)
        seconds = int(value % 60)
        hours = int(value // 3600)
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
