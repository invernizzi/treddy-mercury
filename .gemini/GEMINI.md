# Treddy Mercury

## Overview
Treddy Mercury is a project designed to control and monitor the NT s20i treadmill. It provides both a Progressive Web App (PWA) and a Textual User Interface (TUI) to track running metrics and sync data.

## Key Features
- **Live Dashboard**: Displays real-time speed, incline, distance, time, and calories via a TUI.
- **Smart Calorie Tracking**: Calculates calories burned using ACSM metabolic equations and user weight data from Fitbit.
- **Fitbit Integration**: Automatically uploads run data to Fitbit in the background.
- **BLE Connection**: Connects directly to the treadmill via Bluetooth Low Energy.

## Tech Stack
- **Language**: Python
- **Package Manager**: `uv`
- **UI library**: Textual
- **Connectivity**: BLE (Bluetooth Low Energy)
