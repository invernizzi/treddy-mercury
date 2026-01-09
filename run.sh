#!/bin/bash

# Run the main Python script with the required dependencies.
# You can also just install the dependencies manually and run `python treddy-mercury/main.py`.
# Adding current directory to PYTHONPATH so treadfit package can be found
export PYTHONPATH=$PYTHONPATH:.
uv run --with bleak,rich,fitbit,python-dotenv,pyyaml,textual treddy-mercury/main.py

./upload.sh