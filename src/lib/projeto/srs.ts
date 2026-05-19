// Sistemas de Referência (SRS/SRC) usados em projetos rodoviários no Brasil.
// Reprojeção via proj4js — converte qualquer SRS suportado para WGS84 (lat/lng).

import proj4 from "proj4";

// Definições EPSG (datums comuns no Brasil + WGS84 global).
const DEFS: Record<string, string> = {
  // WGS84 geográfico (lat/lng) — fallback
  "EPSG:4326": "+proj=longlat +datum=WGS84 +no_defs",
  // SIRGAS 2000 geográfico
  "EPSG:4674": "+proj=longlat +ellps=GRS80 +no_defs",
  // SIRGAS 2000 UTM Sul (22S–25S)
  "EPSG:31982": "+proj=utm +zone=22 +south +ellps=GRS80 +units=m +no_defs",
  "EPSG:31983": "+proj=utm +zone=23 +south +ellps=GRS80 +units=m +no_defs",
  "EPSG:31984": "+proj=utm +zone=24 +south +ellps=GRS80 +units=m +no_defs",
  "EPSG:31985": "+proj=utm +zone=25 +south +ellps=GRS80 +units=m +no_defs",
  // SAD69 UTM Sul
  "EPSG:29192": "+proj=utm +zone=22 +south +ellps=aust_SA +towgs84=-66.87,4.37,-38.52,0,0,0,0 +units=m +no_defs",
  "EPSG:29193": "+proj=utm +zone=23 +south +ellps=aust_SA +towgs84=-66.87,4.37,-38.52,0,0,0,0 +units=m +no_defs",
  "EPSG:29194": "+proj=utm +zone=24 +south +ellps=aust_SA +towgs84=-66.87,4.37,-38.52,0,0,0,0 +units=m +no_defs",
  "EPSG:29195": "+proj=utm +zone=25 +south +ellps=aust_SA +towgs84=-66.87,4.37,-38.52,0,0,0,0 +units=m +no_defs",
  // Córrego Alegre UTM Sul (parâmetros médios — DPI/IBGE)
  "EPSG:22522": "+proj=utm +zone=22 +south +ellps=intl +towgs84=-206,172,-6,0,0,0,0 +units=m +no_defs",
  "EPSG:22523": "+proj=utm +zone=23 +south +ellps=intl +towgs84=-206,172,-6,0,0,0,0 +units=m +no_defs",
  "EPSG:22524": "+proj=utm +zone=24 +south +ellps=intl +towgs84=-206,172,-6,0,0,0,0 +units=m +no_defs",
  "EPSG:22525": "+proj=utm +zone=25 +south +ellps=intl +towgs84=-206,172,-6,0,0,0,0 +units=m +no_defs",
  // WGS84 UTM Sul
  "EPSG:32722": "+proj=utm +zone=22 +south +datum=WGS84 +units=m +no_defs",
  "EPSG:32723": "+proj=utm +zone=23 +south +datum=WGS84 +units=m +no_defs",
  "EPSG:32724": "+proj=utm +zone=24 +south +datum=WGS84 +units=m +no_defs",
  "EPSG:32725": "+proj=utm +zone=25 +south +datum=WGS84 +units=m +no_defs",
};

for (const [code, def] of Object.entries(DEFS)) {
  proj4.defs(code, def);
}

export type SrsOption = {
  code: string;
  label: string;
  group: "SIRGAS 2000" | "SAD69" | "Córrego Alegre" | "WGS84" | "Geográfico";
};

export const SRS_OPTIONS: SrsOption[] = [
  { code: "EPSG:4326", label: "WGS84 — Latitude/Longitude (GNSS RTK)", group: "Geográfico" },
  { code: "EPSG:4674", label: "SIRGAS 2000 — Latitude/Longitude", group: "Geográfico" },
  { code: "EPSG:31982", label: "SIRGAS 2000 / UTM 22S", group: "SIRGAS 2000" },
  { code: "EPSG:31983", label: "SIRGAS 2000 / UTM 23S (SP, RJ, MG…)", group: "SIRGAS 2000" },
  { code: "EPSG:31984", label: "SIRGAS 2000 / UTM 24S", group: "SIRGAS 2000" },
  { code: "EPSG:31985", label: "SIRGAS 2000 / UTM 25S", group: "SIRGAS 2000" },
  { code: "EPSG:29192", label: "SAD69 / UTM 22S", group: "SAD69" },
  { code: "EPSG:29193", label: "SAD69 / UTM 23S", group: "SAD69" },
  { code: "EPSG:29194", label: "SAD69 / UTM 24S", group: "SAD69" },
  { code: "EPSG:29195", label: "SAD69 / UTM 25S", group: "SAD69" },
  { code: "EPSG:22522", label: "Córrego Alegre / UTM 22S", group: "Córrego Alegre" },
  { code: "EPSG:22523", label: "Córrego Alegre / UTM 23S", group: "Córrego Alegre" },
  { code: "EPSG:22524", label: "Córrego Alegre / UTM 24S", group: "Córrego Alegre" },
  { code: "EPSG:22525", label: "Córrego Alegre / UTM 25S", group: "Córrego Alegre" },
  { code: "EPSG:32722", label: "WGS84 / UTM 22S", group: "WGS84" },
  { code: "EPSG:32723", label: "WGS84 / UTM 23S", group: "WGS84" },
  { code: "EPSG:32724", label: "WGS84 / UTM 24S", group: "WGS84" },
  { code: "EPSG:32725", label: "WGS84 / UTM 25S", group: "WGS84" },
];

/** Converte um par (x,y) ou (lng,lat) do SRS origem para WGS84 lat/lng. */
export function toLatLng(srs: string, x: number, y: number): { lat: number; lng: number } {
  if (srs === "EPSG:4326" || srs === "EPSG:4674") {
    return { lat: y, lng: x };
  }
  const [lng, lat] = proj4(srs, "EPSG:4326", [x, y]);
  return { lat, lng };
}

/** Detecção heurística: valores ~6 dígitos com Y>1e6 sugerem UTM Sul. */
export function looksLikeUTM(x: number, y: number): boolean {
  return Math.abs(x) > 1000 && Math.abs(y) > 1_000_000;
}

/** Detecção heurística para lat/lng geográfico. */
export function looksLikeLatLng(x: number, y: number): boolean {
  return Math.abs(x) <= 180 && Math.abs(y) <= 90;
}
