export function calculateCalories(
  weightKg: number,
  speedKph: number,
  inclineDeg: number,
  durationSeconds: number
): number {
  if (durationSeconds <= 0) return 0.0;

  // Speed in meters/min
  const speedMMin = (speedKph * 1000) / 60.0;

  // Percent grade (fraction)
  // Assuming inclineDeg is actual degrees
  const gradeFraction = Math.tan((inclineDeg * Math.PI) / 180);

  let vo2MlKgMin = 0;

  // Determine standard MET equation: Walking vs Running
  // Cutoff is 6.0 km/h
  if (speedKph <= 6.0) {
    // ACSM Walking Equation
    // VO2 = 3.5 + (0.1 * S) + (1.8 * S * G)
    vo2MlKgMin = 3.5 + 0.1 * speedMMin + 1.8 * speedMMin * gradeFraction;
  } else {
    // ACSM Running Equation
    // VO2 = 3.5 + (0.2 * S) + (0.9 * S * G)
    vo2MlKgMin = 3.5 + 0.2 * speedMMin + 0.9 * speedMMin * gradeFraction;
  }

  // Convert VO2 (ml/kg/min) to Kcal/min
  // Kcal/min = (VO2 * weight_kg) / 1000 * 5
  const kcalPerMin = ((vo2MlKgMin * weightKg) / 1000.0) * 5.0;

  // Reduce by 20% as manual correction (matches Python source)
  return kcalPerMin * (durationSeconds / 60.0) * 0.8;
}
