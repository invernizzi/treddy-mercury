import struct
from treadfit.ble import build_control_packets, build_nus_packet, TreadmillClient

def test_build_nus_packet():
    # Handshake 0x10 -> [0xA5, 0x04, 0x10, 0xB9]
    hs = build_nus_packet(0x10)
    assert hs == bytes([0xA5, 0x04, 0x10, 0xB9])

    # Request control 0x15 -> [0xA5, 0x04, 0x15, 0xBE]
    req = build_nus_packet(0x15)
    assert req == bytes([0xA5, 0x04, 0x15, 0xBE])

    # Start belt 0x11 with [0x01] -> [0xA5, 0x05, 0x11, 0x01, 0xBC]
    start = build_nus_packet(0x11, [0x01])
    assert start == bytes([0xA5, 0x05, 0x11, 0x01, 0xBC])

    # Keepalive watchdog ping 0x30 with [0x00] -> [0xA5, 0x05, 0x30, 0x00, 0xDA]
    ping = build_nus_packet(0x30, [0x00])
    assert ping == bytes([0xA5, 0x05, 0x30, 0x00, 0xDA])

    # Speed 0x20 with 100 -> [0xA5, 0x06, 0x20, 0x64, 0x00, 0x2F]
    speed = build_nus_packet(0x20, [0x64, 0x00])
    assert speed == bytes([0xA5, 0x06, 0x20, 0x64, 0x00, 0x2F])


def test_build_control_packets():
    header, payload = build_control_packets(0x01, 160)
    assert header == bytes.fromhex("fe020d02")
    assert payload == bytes.fromhex("ff0d020402090409020101a00000000000000000")


def test_parse_nus_telemetry():
    metrics = {}
    client = TreadmillClient(
        metrics_callback=lambda m: metrics.update(m),
        status_callback=lambda s: None,
    )

    # 16-byte packet:
    # byte 0: 0x02
    # byte 1: 0x10
    # byte 2: 0x80
    # bytes 3-4: 300 (uint16 LE) -> 3.00 km/h (metric mode)
    # bytes 5-6: 45 (int16 LE) -> 4.5%
    # bytes 7-9: 500 (3-byte LE) -> 500m = 0.5km
    # byte 13: 0x20 (metric flag)
    packet = bytearray(16)
    packet[0] = 0x02
    packet[1] = 0x10
    packet[2] = 0x80
    struct.pack_into("<H", packet, 3, 300)
    struct.pack_into("<h", packet, 5, 45)
    packet[7] = 500 & 0xFF
    packet[8] = (500 >> 8) & 0xFF
    packet[9] = 0
    packet[13] = 0x20  # Metric

    client.parse_treadmill_data(0, packet)

    assert metrics["speed_kph"] == 3.00
    assert metrics["incline_deg"] == 4.5
    assert metrics["distance_km"] == 0.5
