import unittest
from treadfit.fitbit_upload import calculate_calories


class TestCalculateCalories(unittest.TestCase):
    def setUp(self):
        # Default user weight for tests
        self.user_weight_kg = 86.0

    def test_zero_duration(self):
        # Duration is 0, should return 0
        cals = calculate_calories(self.user_weight_kg, 5.0, 0.0, 0)
        self.assertEqual(cals, 0.0)

    def test_walking_flat(self):
        # 5 km/h, 0% incline, 60 seconds (1 min)
        # Speed <= 6.0, use walking equation
        # speed_m_min = 5 * 1000 / 60 = 83.333
        # grade_fraction = tan(0) = 0
        # vo2 = 3.5 + 0.1 * 83.333 + 1.8 * 83.333 * 0 = 3.5 + 8.3333 = 11.8333
        # kcal_per_min = 11.8333 * 86 / 1000 * 5 = 5.088
        # total = 5.088 * 1 = 5.088

        speed_kph = 5.0
        incline_deg = 0.0
        duration_sec = 60

        cals = calculate_calories(
            self.user_weight_kg, speed_kph, incline_deg, duration_sec
        )

        # approximate check
        self.assertAlmostEqual(cals, 5.088, places=2)

    def test_walking_incline(self):
        # 5 km/h, 5% incline (approx 2.86 degrees? tan(2.86)=0.05), ... wait
        # The code takes incline_deg.
        # Let's say 5 degrees. grade_fraction = tan(radians(5)) ~= 0.08748
        # speed_m_min = 83.333
        # vo2 = 3.5 + (0.1 * 83.333) + (1.8 * 83.333 * 0.08748)
        # vo2 = 3.5 + 8.3333 + 13.122 = 24.955
        # kcal_per_min = 24.955 * 86 / 1000 * 5 = 10.73

        speed_kph = 5.0
        incline_deg = 5.0
        duration_sec = 60

        cals = calculate_calories(
            self.user_weight_kg, speed_kph, incline_deg, duration_sec
        )
        self.assertAlmostEqual(cals, 10.73, places=1)

    def test_running_flat(self):
        # 10 km/h, 0% incline, 60 seconds
        # Speed > 6.0, use running equation
        # speed_m_min = 10 * 1000 / 60 = 166.666
        # grade_fraction = 0
        # vo2 = 3.5 + (0.2 * 166.666) + (0.9 * 166.666 * 0)
        # vo2 = 3.5 + 33.333 = 36.833
        # kcal_per_min = 36.833 * 86 / 1000 * 5 = 15.838

        speed_kph = 10.0
        incline_deg = 0.0
        duration_sec = 60

        cals = calculate_calories(
            self.user_weight_kg, speed_kph, incline_deg, duration_sec
        )
        self.assertAlmostEqual(cals, 15.84, places=1)

    def test_running_incline(self):
        # 10 km/h, 2 degrees incline
        # speed_m_min = 166.666
        # grade_fraction = tan(2) ~= 0.03492
        # vo2 = 3.5 + (0.2 * 166.666) + (0.9 * 166.666 * 0.03492)
        # vo2 = 3.5 + 33.333 + 5.238 = 42.071
        # kcal_per_min = 42.071 * 86 / 1000 * 5 = 18.09

        speed_kph = 10.0
        incline_deg = 2.0
        duration_sec = 60

        cals = calculate_calories(
            self.user_weight_kg, speed_kph, incline_deg, duration_sec
        )
        self.assertAlmostEqual(cals, 18.09, places=1)


if __name__ == "__main__":
    unittest.main()
