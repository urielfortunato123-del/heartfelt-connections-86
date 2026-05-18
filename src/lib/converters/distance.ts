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

// ============ DER (Estaca / Hectômetro) ============
// Padrão DER brasileiro:
//   1 estaca   = 20 metros
//   1 hectômetro = 100 m = 5 estacas
//   1 km       = 1000 m = 50 estacas = 10 hectômetros
// Notação: "Estaca 52 + 5" = 52 estacas + 5 metros excedentes (0..19)
export const METERS_PER_ESTACA = 20;
export const METERS_PER_HECTOMETRO = 100;

export type DerStake = {
  estacas: number;   // integer, # de estacas inteiras
  extra: number;     // metros excedentes (0..19), pode ter decimais
};

export function kmToDer(km: number): DerStake {
  if (!Number.isFinite(km) || km < 0) return { estacas: 0, extra: 0 };
  const meters = km * 1000;
  const estacas = Math.floor(meters / METERS_PER_ESTACA);
  const extra = meters - estacas * METERS_PER_ESTACA;
  return { estacas, extra: Math.round(extra * 10000) / 10000 };
}

export const MAX_EXTRA_METERS = 19.99;

/** Clamp metros excedentes ao intervalo [0, 19.99] com 2 casas decimais. */
export function clampExtra(extra: number): number {
  if (!Number.isFinite(extra) || extra < 0) return 0;
  const capped = Math.min(extra, MAX_EXTRA_METERS);
  return Math.round(capped * 100) / 100;
}

export function derToKm(estacas: number, extra: number): number {
  const e = Number.isFinite(estacas) ? Math.max(0, Math.floor(estacas)) : 0;
  const x = clampExtra(extra);
  return (e * METERS_PER_ESTACA + x) / 1000;
}

export function kmToHectometros(km: number): number {
  return (Number.isFinite(km) ? km : 0) * 10;
}

export function formatDer({ estacas, extra }: DerStake): string {
  const ex = Number.isInteger(extra) ? extra : Number(extra.toFixed(2));
  return `${estacas} + ${ex}`;
}
