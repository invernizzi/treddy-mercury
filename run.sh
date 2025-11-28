#!/bin/bash

# Run the main Python script with the required dependencies.
# You can also just install the dependencies manually and run `python main.py`.
uv run --with bleak,rich main.py