import math

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

    # Reduce by 20% as manual correction
    return kcal_per_min * (duration_seconds / 60.0) * 0.8
