#!/bin/bash

# Fetch a Fitbit access token
uv run --with cherrypy,dotenv,fitbit python3 treadfit/get_tokens.py
 # Upload data to Fitbit
uv run --with bleak,rich,fitbit,python-dotenv,pyyaml python3 -c "from treadfit.fitbit_upload import process_existing_runs; process_existing_runs()"
 