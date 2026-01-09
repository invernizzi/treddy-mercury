import datetime
import os
import glob
import math
import yaml
from fitbit import Fitbit
from dotenv import load_dotenv

load_dotenv()


def calculate_calories(
    weight_kg: float, speed_kph: float, incline_deg: float, duration_seconds: float
) -> float:
    """
    Calculate calories burned using ACSM metabolic equations.

    Assumptions:
    - incline_deg is in degrees (based on variable name in existing code).
    - 1 MET = 3.5 ml/kg/min O2.
    - 5 kcal per liter of O2 consumed.
    """
    if duration_seconds <= 0:
        return 0.0

    # Speed in meters/min
    speed_m_min = (speed_kph * 1000) / 60.0

    # Percent grade (fraction)
    # Assuming incline_deg is actual degrees, grade = tan(radians(degrees))
    grade_fraction = math.tan(math.radians(incline_deg))

    # Determine standard MET equation: Walking vs Running
    # Cutoff is typically ~6 km/h (3.7 mph) or if the user is explicitly running.
    # We'll use 6.0 km/h as the switch point.
    if speed_kph <= 6.0:
        # ACSM Walking Equation
        # VO2 = 3.5 + (0.1 * S) + (1.8 * S * G)
        vo2_ml_kg_min = 3.5 + (0.1 * speed_m_min) + (1.8 * speed_m_min * grade_fraction)
    else:
        # ACSM Running Equation
        # VO2 = 3.5 + (0.2 * S) + (0.9 * S * G)
        vo2_ml_kg_min = 3.5 + (0.2 * speed_m_min) + (0.9 * speed_m_min * grade_fraction)

    # Convert VO2 (ml/kg/min) to Kcal/min
    # Kcal/min = (VO2 * weight_kg) / 1000 * 5
    kcal_per_min = (vo2_ml_kg_min * weight_kg) / 1000.0 * 5.0

    return kcal_per_min * (duration_seconds / 60.0)


def process_existing_runs():
    print("Checking for existing treadmill data to upload...")
    files = glob.glob("data/treadmill_data_*.yaml")

    # Get Fitbit credentials
    client_id = os.getenv("FITBIT_CLIENT_ID")
    client_secret = os.getenv("FITBIT_CLIENT_SECRET")
    access_token = os.getenv("FITBIT_ACCESS_TOKEN")
    refresh_token = os.getenv("FITBIT_REFRESH_TOKEN")

    if not all([client_id, client_secret, access_token, refresh_token]):
        print("Skipping upload: Credentials not found in .env")
        return

    # Initialize Fitbit client
    # We ask for METRIC system to ensure weight is in kg
    auth2_client = Fitbit(
        client_id,
        client_secret,
        access_token=access_token,
        refresh_token=refresh_token,
        system="METRIC",
    )

    # Fetch user weight
    user_weight_kg = 86.0
    try:
        profile = auth2_client.user_profile_get()
        weight = profile.get("user", {}).get("weight")
        if weight:
            user_weight_kg = float(weight)
            print(f"Fetched user weight from Fitbit: {user_weight_kg} kg")
        else:
            print(f"Weight not found in profile, using default: {user_weight_kg} kg")
    except Exception as e:
        print(
            f"Could not fetch weight from Fitbit (error: {e}), using default: {user_weight_kg} kg"
        )

    for file_path in files:
        print(f"Processing {file_path}...")
        try:
            with open(file_path, "r") as f:
                # Load all documents from the file (in case of multiple appends)
                all_docs = list(yaml.safe_load_all(f))

            # Flatten the list if it's a list of lists or just lists
            data_points = []
            for doc in all_docs:
                if isinstance(doc, list):
                    data_points.extend(doc)
                elif isinstance(doc, dict):
                    data_points.append(doc)

            if not data_points:
                print(f"No data in {file_path}, deleting.")
                os.remove(file_path)
                continue

            # Sort by timestamp
            data_points.sort(key=lambda x: x["timestamp"])

            first_point = data_points[0]
            last_point = data_points[-1]

            start_ts = first_point["timestamp"]
            start_dt = datetime.datetime.fromtimestamp(start_ts)

            # Identify resets or gaps
            total_distance_km = 0.0
            total_duration_sec = 0.0
            total_elevation_gain_m = 0.0
            total_calories = 0.0

            # If only one point
            if len(data_points) == 1:
                # Can't calculate much, assume 0
                pass
            else:
                prev_dist = first_point["distance_km"]
                prev_secs = first_point["seconds_total"]

                for i in range(1, len(data_points)):
                    curr = data_points[i]
                    c_dist = curr["distance_km"]
                    c_secs = curr["seconds_total"]
                    # Use prev incline for the segment
                    p_incline = data_points[i - 1]["incline_deg"]
                    # Use prev speed (or average?) for the segment.
                    # Usually better to use the speed setting that was active during the interval.
                    # This file structure records instantaneous values.
                    # We'll use the previous point's speed as the speed for the following interval.
                    p_speed = data_points[i - 1].get("speed_kph", 0.0)

                    dist_delta = c_dist - prev_dist
                    sec_delta = c_secs - prev_secs

                    if dist_delta < -0.1 or sec_delta < -5:
                        # Reset detected
                        pass
                    else:
                        if dist_delta > 0:
                            total_distance_km += dist_delta
                            # Elevation
                            total_elevation_gain_m += (dist_delta * 1000) * math.sin(
                                math.radians(p_incline)
                            )

                        if sec_delta > 0:
                            total_duration_sec += sec_delta

                            # Calculate calories for this segment
                            # If speed wasn't recorded in the previous point (it might be missing), infer it?
                            # data_points should generally have speed_kph.

                            # Use calculated speed from distance/time for better accuracy?
                            # segment_speed = (dist_delta / sec_delta) * 3600
                            # But if the treadmill ramped up, the reported speed might be better.
                            # Let's stick to reported speed if reasonable, but p_speed is what we have.

                            # If p_speed is 0 but we moved distance, use calculated speed.
                            calc_speed = 0.0
                            if dist_delta > 0:
                                calc_speed = (dist_delta / sec_delta) * 3600

                            used_speed = p_speed if p_speed > 0 else calc_speed

                            seg_cals = calculate_calories(
                                user_weight_kg, used_speed, p_incline, sec_delta
                            )
                            total_calories += seg_cals

                    prev_dist = c_dist
                    prev_secs = c_secs

            if total_duration_sec <= 0:
                # Fallback to timestamp duration
                total_duration_sec = last_point["timestamp"] - first_point["timestamp"]

            # Avg speed needs to be in km/h
            if total_duration_sec > 0:
                avg_speed_kmh = (total_distance_km / total_duration_sec) * 3600
            else:
                avg_speed_kmh = 0.0

            print(
                f"Uploading run from {start_dt}: {total_distance_km:.2f}km, {total_duration_sec:.0f}s"
            )

            if total_distance_km <= 0.01:
                print(
                    f"Skipping upload for {file_path}: distance too short ({total_distance_km:.3f}km). Deleting file."
                )
                os.remove(file_path)
                continue

            # Estimate calories
            calories = int(total_calories)
            print(f"Estimated Calories: {calories}")

            upload_to_fitbit(
                client_id,
                client_secret,
                access_token,
                refresh_token,
                distance_km=total_distance_km,
                avg_speed_kmh=avg_speed_kmh,
                elevation_m=total_elevation_gain_m,
                duration_seconds=int(total_duration_sec),
                start_dt=start_dt,
                calories=calories,
                fitbit_client=auth2_client,
            )

            # If successful (no exception), delete file
            print(f"Uploaded successfully. Deleting {file_path}")
            os.remove(file_path)

        except Exception as e:
            print(f"Failed to process {file_path}: {e}")
            import traceback

            traceback.print_exc()


def upload_to_fitbit(
    client_id: str,
    client_secret: str,
    access_token: str,
    refresh_token: str,
    distance_km: float,
    avg_speed_kmh: float,
    elevation_m: float,
    duration_seconds: int,
    start_dt: datetime.datetime = None,
    calories: int = 0,
    fitbit_client=None,
):
    """
    Uploads a treadmill run to Fitbit.

    Note:
    - Speed is derived from distance and duration by Fitbit.
    - Elevation is not supported by the simple log_activity endpoint.
    """
    if start_dt is None:
        start_dt = datetime.datetime.now()

    if fitbit_client:
        auth2_client = fitbit_client
    else:
        auth2_client = Fitbit(
            client_id,
            client_secret,
            access_token=access_token,
            refresh_token=refresh_token,
        )

    # duration in milliseconds
    duration_millis = int(duration_seconds * 1000)

    # Date and time strings
    date_str = start_dt.strftime("%Y-%m-%d")
    time_str = start_dt.strftime("%H:%M")

    # Log the activity
    # We use "Treadmill" as the activity name.
    # Fitbit will try to match it to an activity ID (usually 90013 for Treadmill).
    data = {
        "activityName": "Treadmill",
        "manualCalories": calories,
        "startTime": time_str,
        "durationMillis": duration_millis,
        "date": date_str,
        "distance": distance_km,
        "distanceUnit": "Kilometer",
    }
    response = auth2_client.log_activity(data)

    print(f"Successfully logged run: {response}")
    return response


if __name__ == "__main__":
    # Example usage
    # You need to fill in your credentials
    CLIENT_ID = os.getenv("FITBIT_CLIENT_ID")
    CLIENT_SECRET = os.getenv("FITBIT_CLIENT_SECRET")
    ACCESS_TOKEN = os.getenv("FITBIT_ACCESS_TOKEN")
    REFRESH_TOKEN = os.getenv("FITBIT_REFRESH_TOKEN")

    if not all([CLIENT_ID, CLIENT_SECRET, ACCESS_TOKEN, REFRESH_TOKEN]):
        print(
            "Please set FITBIT_CLIENT_ID, FITBIT_CLIENT_SECRET, FITBIT_ACCESS_TOKEN, and FITBIT_REFRESH_TOKEN in your .env file"
        )
        exit(1)
    process_existing_runs()
