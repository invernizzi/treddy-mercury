"""
Treadmill BLE Client

This script connects to a Norditrack s20i via Bluetooth Low Energy (BLE).
It displays and stores real-time metrics such as speed, incline, distance, and elapsed time.
"""

import asyncio
import struct
from rich import print
from rich.live import Live
import collections
from bleak import BleakScanner, BleakClient
import yaml
from dataclasses import dataclass
import time
from treadfit.fitbit_upload import process_existing_runs

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

# --- GLOBAL STATE ---TS ---
# Nicer text interface.
live = Live(auto_refresh=False)
# This is where the data events are stored.
parsed_events = collections.deque()
# Event to signal stopping the polling loop.
stop_event = asyncio.Event()


@dataclass
class TreadmillStatus:
    speed_kph: float = 0.0
    incline_deg: float = 0.0
    distance_km: float = 0.0
    seconds_total: int = 0


def print_status(treatmill_status: TreadmillStatus):
    minutes = (treatmill_status.seconds_total // 60) % 60
    seconds = treatmill_status.seconds_total % 60
    status = (
        f"Speed: {treatmill_status.speed_kph:4.1f} KPH | "
        f"Incline: {treatmill_status.incline_deg:4.1f}% | "
        f"Distance: {treatmill_status.distance_km:.3f} KM | "
        f"Time: {minutes:d}:{seconds:02d}"
    )
    live.update(status, refresh=True)


def get_current_status():
    speed_kph, incline_deg, distance_km, seconds_total = 0, 0, 0, 0
    for event in reversed(parsed_events):
        speed_kph = speed_kph or event.get("speed_kph", 0)
        incline_deg = incline_deg or event.get("incline_deg", 0)
        distance_km = distance_km or event.get("distance_km", 0)
        seconds_total = seconds_total or event.get("seconds_total", 0)
        if (
            speed_kph >= 0
            and incline_deg >= 0
            and distance_km > 0
            and seconds_total > 0
        ):
            break
    # Computed derived values: calories

    return TreadmillStatus(
        speed_kph=speed_kph,
        incline_deg=incline_deg,
        distance_km=distance_km,
        seconds_total=seconds_total,
    )


def print_last_status():
    print_status(get_current_status())


def parse_treadmill_data(_sender: int, data: bytearray):
    """
    Parse incoming treadmill data and update the parsed_events deque.
    """
    if len(data) < 12:
        return
    match data[0]:
        case 0x00:
            # Notification message.
            parsed_events.append(
                dict(
                    speed_kph=struct.unpack_from("<H", data, 10)[0] / 100.0,
                    incline_deg=struct.unpack_from("<H", data, 12)[0] / 100.0,
                    distance_km=struct.unpack_from("<H", data, 16)[0] / 1000,
                )
            )
            print_last_status()
            return
        case 0x01:
            # Notification message.
            parsed_events.append(
                dict(seconds_total=struct.unpack_from("<H", data, 9)[0])
            )
            print_last_status()
            return
        case 0xFF:
            return
        case 0xFE:
            return
        case _:
            # Unknown message type.
            print("Unknown message type received.", data.hex())
            return


async def polling_loop(client):
    try:
        while not stop_event.is_set():
            if client.is_connected:
                for hex_cmd in POLL_SEQUENCE:
                    await client.write_gatt_char(
                        WRITE_UUID, bytes.fromhex(hex_cmd), response=True
                    )
                await asyncio.sleep(1.0)
            else:
                break
    except Exception as e:
        print(f"\n[Polling Error] {e}")


async def save_loop():
    """
    Every 30 seconds, save the current treadmill state to a YAML file.
    """
    while not stop_event.is_set():
        await asyncio.sleep(30)
        treadmill_status = get_current_status()
        data = {
            "timestamp": time.time(),
            "speed_kph": treadmill_status.speed_kph,
            "incline_deg": treadmill_status.incline_deg,
            "distance_km": treadmill_status.distance_km,
            "seconds_total": treadmill_status.seconds_total,
        }
        date_str = time.strftime("%Y-%m-%d", time.localtime(data["timestamp"]))
        live.update(f"\n[Data Saved at {date_str}]", refresh=True)
        with open(f"data/treadmill_data_{date_str}.yaml", "a") as f:
            yaml.dump([data], f)


async def main():
    with live:
        live.update(f"Scanning for '{DEVICE_NAME}'...")
        device = await BleakScanner.find_device_by_filter(
            lambda d, ad: d.name and d.name == DEVICE_NAME
        )

        if not device:
            live.update("Device not found.")
            return

        live.update(f"Found {device.name}. Connecting...")

        async with BleakClient(device.address) as client:
            live.update(f"Connected: {client.is_connected}")
            await asyncio.sleep(0.1)

            live.update("Subscribing...")
            await client.start_notify(NOTIFY_UUID, parse_treadmill_data)
            # Send Magic Incantation.
            for h in INITIALIZATION_SEQUENCE:
                await client.write_gatt_char(
                    WRITE_UUID, bytes.fromhex(h), response=True
                )
                await asyncio.sleep(0.1)

            # Start polling loop.
            poller = asyncio.create_task(polling_loop(client))
            # Start save loop.
            saver = asyncio.create_task(save_loop())
            # Wait until interrupted.
            try:
                await poller
            except asyncio.CancelledError:
                pass


if __name__ == "__main__":
    # Upload existing runs first

    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
    process_existing_runs()
