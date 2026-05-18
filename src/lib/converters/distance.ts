// Pure distance conversion logic. All factors are "units per 1 kilometer".
// Extracted so future converters (speed, fuel, topography) can follow the
// same shape.

export type DistanceUnit = {
  key: string;
  label: string;
  suffix: string;
  /** Multiplier: 1 km × factor = value in this unit */
  factor: number;
};

export const DISTANCE_UNITS: DistanceUnit[] = [
  { key: "m", label: "Meters", suffix: "m", factor: 1000 },
  { key: "mi", label: "Miles", suffix: "mi", factor: 0.621371 },
  { key: "nmi", label: "Nautical Miles", suffix: "nmi", factor: 0.539957 },
  { key: "yd", label: "Yards", suffix: "yd", factor: 1093.61 },
  { key: "ft", label: "Feet", suffix: "ft", factor: 3280.84 },
  { key: "legua", label: "Léguas (BR)", suffix: "lég", factor: 1 / 6.6 },
  { key: "au", label: "Astronomical U.", suffix: "AU", factor: 6.6846e-9 },
  { key: "ly", label: "Light-Years", suffix: "ly", factor: 1.057e-16 },
];

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs < 0.0001 || abs >= 1e9) return n.toExponential(4);
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function toEditableString(n: number): string {
  if (!Number.isFinite(n)) return "";
  return Number(n.toPrecision(8)).toString();
}
