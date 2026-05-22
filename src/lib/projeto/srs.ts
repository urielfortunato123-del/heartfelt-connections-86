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

export const LOCAL_SRS = "LOCAL";

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
  { code: LOCAL_SRS, label: "Sistema local (sem reprojeção — posicionar manualmente)", group: "Geográfico" },
];

// Âncora padrão para sistema local: centro aproximado de SP. O usuário arrasta depois.
const LOCAL_ANCHOR = { lat: -22.0, lng: -48.0 };
const M_PER_DEG_LAT = 111_320;

/** Converte um par (x,y) ou (lng,lat) do SRS origem para WGS84 lat/lng. */
export function toLatLng(srs: string, x: number, y: number): { lat: number; lng: number } {
  if (srs === "EPSG:4326" || srs === "EPSG:4674") {
    return { lat: y, lng: x };
  }
  if (srs === LOCAL_SRS) {
    // Trata (x,y) como metros relativos a uma âncora arbitrária; geometria
    // relativa é preservada e o usuário move o overlay para o lugar certo.
    const lat = LOCAL_ANCHOR.lat + y / M_PER_DEG_LAT;
    const lng =
      LOCAL_ANCHOR.lng +
      x / (M_PER_DEG_LAT * Math.cos((LOCAL_ANCHOR.lat * Math.PI) / 180));
    return { lat, lng };
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

/**
 * Valida se um bbox bate com as faixas esperadas para o SRS escolhido.
 * Retorna uma mensagem de aviso quando há mismatch (ex.: usuário escolheu
 * UTM 23S mas as coordenadas são pequenas demais — provavelmente sistema local).
 */
export function validateSrsBbox(
  srs: string,
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
): string | null {
  const isUtmSouth = /^EPSG:(3198\d|2919\d|2252\d|3272\d)$/.test(srs);
  if (isUtmSouth) {
    const eOk = bbox.minX >= 100_000 && bbox.maxX <= 900_000;
    const nOk = bbox.minY >= 5_500_000 && bbox.maxY <= 10_000_000;
    if (!nOk || !eOk) {
      return (
        "As coordenadas não cabem nas faixas típicas de UTM Sul " +
        "(Leste 150k–850k, Norte 6M–10M). Provavelmente é um sistema local da obra. " +
        "Selecione \"Sistema local\" abaixo e posicione manualmente."
      );
    }
  }
  if (srs === "EPSG:4326" || srs === "EPSG:4674") {
    if (
      Math.abs(bbox.minX) > 180 || Math.abs(bbox.maxX) > 180 ||
      Math.abs(bbox.minY) > 90 || Math.abs(bbox.maxY) > 90
    ) {
      return "Os valores não parecem latitude/longitude (graus). Escolha um SRS projetado (UTM) ou \"Sistema local\".";
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Auto-detecção do SRC mais provável
// ---------------------------------------------------------------------------

/** Limites geográficos aproximados do Brasil (margem folgada). */
const BR_BOUNDS = { minLat: -35, maxLat: 6, minLng: -75, maxLng: -33 };

function tryReprojectBbox(
  srs: string,
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
): { minLat: number; maxLat: number; minLng: number; maxLng: number } | null {
  try {
    const corners = [
      [bbox.minX, bbox.minY],
      [bbox.maxX, bbox.minY],
      [bbox.minX, bbox.maxY],
      [bbox.maxX, bbox.maxY],
    ];
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const [x, y] of corners) {
      const ll = toLatLng(srs, x, y);
      if (!Number.isFinite(ll.lat) || !Number.isFinite(ll.lng)) return null;
      if (Math.abs(ll.lat) > 90 || Math.abs(ll.lng) > 180) return null;
      if (ll.lat < minLat) minLat = ll.lat;
      if (ll.lat > maxLat) maxLat = ll.lat;
      if (ll.lng < minLng) minLng = ll.lng;
      if (ll.lng > maxLng) maxLng = ll.lng;
    }
    return { minLat, maxLat, minLng, maxLng };
  } catch {
    return null;
  }
}

export type SrsCandidate = {
  code: string;
  label: string;
  score: number;
  reason: string;
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number };
};

/**
 * Pontua todos os SRCs candidatos contra o bbox dos dados: reprojeta e
 * verifica se o resultado cai dentro do Brasil com extensão plausível.
 */
export function rankSrsCandidates(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
): SrsCandidate[] {
  const looksUtm =
    bbox.minX > 1e5 && bbox.maxX < 1e6 &&
    bbox.minY > 5.5e6 && bbox.maxY < 1e7;
  const looksGeo =
    Math.abs(bbox.minX) <= 180 && Math.abs(bbox.maxX) <= 180 &&
    Math.abs(bbox.minY) <= 90 && Math.abs(bbox.maxY) <= 90;

  const out: SrsCandidate[] = [];
  for (const opt of SRS_OPTIONS) {
    if (opt.code === LOCAL_SRS) continue;
    const isGeo = opt.code === "EPSG:4326" || opt.code === "EPSG:4674";
    if (isGeo && !looksGeo) continue;
    if (!isGeo && !looksUtm) continue;

    const ll = tryReprojectBbox(opt.code, bbox);
    if (!ll) continue;

    const inside =
      ll.minLat >= BR_BOUNDS.minLat && ll.maxLat <= BR_BOUNDS.maxLat &&
      ll.minLng >= BR_BOUNDS.minLng && ll.maxLng <= BR_BOUNDS.maxLng;
    let score = inside ? 100 : 30;

    const spanLat = ll.maxLat - ll.minLat;
    const spanLng = ll.maxLng - ll.minLng;
    if (spanLat <= 5 && spanLng <= 5) score += 20;
    else if (spanLat <= 15 && spanLng <= 15) score += 5;
    else score -= 20;

    if (opt.group === "SIRGAS 2000") score += 5;

    const reason = inside
      ? `dentro do Brasil · span ${spanLat.toFixed(2)}°×${spanLng.toFixed(2)}°`
      : `fora do Brasil · span ${spanLat.toFixed(2)}°×${spanLng.toFixed(2)}°`;

    out.push({ code: opt.code, label: opt.label, score, reason, bbox: ll });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

export function detectBestSrs(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
): SrsCandidate | null {
  const ranked = rankSrsCandidates(bbox);
  if (ranked.length === 0) return null;
  if (ranked[0].score < 50) return null;
  return ranked[0];
}

/** Computa estatísticas de um SRC específico contra um bbox (para comparação). */
export function computeCandidateForSrs(
  code: string,
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
): SrsCandidate | null {
  if (code === LOCAL_SRS) return null;
  const opt = SRS_OPTIONS.find((o) => o.code === code);
  if (!opt) return null;
  const ll = tryReprojectBbox(code, bbox);
  if (!ll) return null;
  const inside =
    ll.minLat >= BR_BOUNDS.minLat && ll.maxLat <= BR_BOUNDS.maxLat &&
    ll.minLng >= BR_BOUNDS.minLng && ll.maxLng <= BR_BOUNDS.maxLng;
  let score = inside ? 100 : 30;
  const spanLat = ll.maxLat - ll.minLat;
  const spanLng = ll.maxLng - ll.minLng;
  if (spanLat <= 5 && spanLng <= 5) score += 20;
  else if (spanLat <= 15 && spanLng <= 15) score += 5;
  else score -= 20;
  if (opt.group === "SIRGAS 2000") score += 5;
  const reason = inside
    ? `dentro do Brasil · span ${spanLat.toFixed(2)}°×${spanLng.toFixed(2)}°`
    : `fora do Brasil · span ${spanLat.toFixed(2)}°×${spanLng.toFixed(2)}°`;
  return { code: opt.code, label: opt.label, score, reason, bbox: ll };
}
