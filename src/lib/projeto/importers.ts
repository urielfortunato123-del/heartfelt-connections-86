// Importadores de arquivos de topografia/CAD.
// - DXF (Civil 3D / AutoCAD ASCII)
// - TXT/CSV de estação total: PENZD, NEZD, PNEZ etc. (separador automático)
//
// Cada importer devolve `ImportedDataset` em coordenadas do SRS original
// (xs/ys). A conversão pra WGS84 lat/lng é feita depois com `srs.toLatLng()`.

import DxfParser from "dxf-parser";

export type ImportedPoint = {
  id: string;
  x: number;
  y: number;
  z?: number;
  label?: string;
  description?: string;
};

export type ImportedPolyline = {
  id: string;
  layer?: string;
  coords: Array<{ x: number; y: number; z?: number }>;
  closed?: boolean;
};

export type ImportedDataset = {
  source: string; // nome do arquivo
  kind: "dxf" | "topo-txt";
  points: ImportedPoint[];
  polylines: ImportedPolyline[];
  bbox?: { minX: number; minY: number; maxX: number; maxY: number };
  /** Se o DXF traz georreferência (INSBASE não-zero ou GEODATA), guardamos aqui. */
  georef?: {
    insBase?: { x: number; y: number };
    hint?: string;
  };
};

function computeBbox(ds: ImportedDataset): void {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const acc = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const p of ds.points) acc(p.x, p.y);
  for (const pl of ds.polylines) for (const v of pl.coords) acc(v.x, v.y);
  if (Number.isFinite(minX)) ds.bbox = { minX, minY, maxX, maxY };
}

// ---------------------------------------------------------------------------
// DXF
// ---------------------------------------------------------------------------

export async function parseDxf(file: File): Promise<ImportedDataset> {
  const text = await file.text();
  const parser = new DxfParser();
  // tipos do dxf-parser são frouxos; usamos `any` localmente, sem propagar.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dxf = parser.parseSync(text) as any;
  const ds: ImportedDataset = {
    source: file.name,
    kind: "dxf",
    points: [],
    polylines: [],
  };

  const insBase = dxf?.header?.$INSBASE;
  if (insBase && (insBase.x !== 0 || insBase.y !== 0)) {
    ds.georef = {
      insBase: { x: insBase.x, y: insBase.y },
      hint: "Origem $INSBASE diferente de (0,0).",
    };
  }

  let idSeq = 0;
  const nid = () => `dxf-${++idSeq}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const e of (dxf?.entities ?? []) as any[]) {
    const layer = e.layer as string | undefined;
    switch (e.type) {
      case "POINT":
        ds.points.push({ id: nid(), x: e.position.x, y: e.position.y, z: e.position.z, label: layer });
        break;
      case "LINE":
        ds.polylines.push({
          id: nid(),
          layer,
          coords: [
            { x: e.vertices[0].x, y: e.vertices[0].y, z: e.vertices[0].z },
            { x: e.vertices[1].x, y: e.vertices[1].y, z: e.vertices[1].z },
          ],
        });
        break;
      case "LWPOLYLINE":
      case "POLYLINE":
        ds.polylines.push({
          id: nid(),
          layer,
          coords: (e.vertices ?? []).map((v: { x: number; y: number; z?: number }) => ({
            x: v.x,
            y: v.y,
            z: v.z,
          })),
          closed: Boolean(e.shape),
        });
        break;
      case "CIRCLE":
      case "ARC": {
        // aproxima como polilinha de 64 segmentos
        const cx = e.center.x;
        const cy = e.center.y;
        const r = e.radius;
        const start = (e.startAngle ?? 0) * (Math.PI / 180);
        const end = (e.endAngle ?? 360) * (Math.PI / 180);
        const span = e.type === "CIRCLE" ? Math.PI * 2 : end - start;
        const steps = 64;
        const coords: Array<{ x: number; y: number }> = [];
        for (let i = 0; i <= steps; i++) {
          const a = start + (span * i) / steps;
          coords.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
        }
        ds.polylines.push({ id: nid(), layer, coords, closed: e.type === "CIRCLE" });
        break;
      }
      // outros tipos (TEXT, INSERT…) ignorados nesta versão
      default:
        break;
    }
  }

  computeBbox(ds);
  return ds;
}

// ---------------------------------------------------------------------------
// TXT topográfico (estação total / GNSS)
// ---------------------------------------------------------------------------

export type TxtFormat = {
  /** Ordem das colunas. P = ponto, N = Norte/Y, E = Leste/X, Z = elevação, D = descrição */
  order: Array<"P" | "N" | "E" | "Z" | "D" | "skip">;
  separator: "," | ";" | "\t" | " " | "auto";
  decimal: "." | ",";
  skipHeaderLines: number;
};

export const TXT_PRESETS: Record<string, TxtFormat> = {
  "PENZD (P,E,N,Z,D)": {
    order: ["P", "E", "N", "Z", "D"],
    separator: "auto",
    decimal: ".",
    skipHeaderLines: 0,
  },
  "PNEZD (P,N,E,Z,D)": {
    order: ["P", "N", "E", "Z", "D"],
    separator: "auto",
    decimal: ".",
    skipHeaderLines: 0,
  },
  "NEZ (N,E,Z)": {
    order: ["N", "E", "Z"],
    separator: "auto",
    decimal: ".",
    skipHeaderLines: 0,
  },
  "ENZ (E,N,Z)": {
    order: ["E", "N", "Z"],
    separator: "auto",
    decimal: ".",
    skipHeaderLines: 0,
  },
  "Lat,Lng,Z (GNSS)": {
    order: ["N", "E", "Z"], // N=lat, E=lng quando SRS = EPSG:4326
    separator: "auto",
    decimal: ".",
    skipHeaderLines: 0,
  },
};

function detectSeparator(line: string): string {
  if (line.includes("\t")) return "\t";
  if (line.includes(";")) return ";";
  if (line.includes(",")) return ",";
  return /\s+/.test(line) ? "\\s+" : ",";
}

function toNum(s: string, decimal: "." | ","): number {
  const norm = decimal === "," ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  return Number(norm);
}

export type DecimalDetection = {
  decimal: "." | ",";
  confidence: "high" | "low";
  stats: { sampled: number; comma: number; dot: number };
};

/**
 * Detecta o separador decimal de um TXT/CSV inspecionando até 20 linhas.
 * Regra: se o separador de colunas é `,`, o decimal é forçosamente `.`.
 * Caso contrário, conta tokens numéricos que contêm `,` vs `.` e escolhe a maioria.
 */
export async function detectDecimalSeparator(
  file: File,
  skipHeaderLines = 0,
): Promise<DecimalDetection> {
  const text = await file.text();
  const lines = text
    .split(/\r?\n/)
    .slice(skipHeaderLines)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return { decimal: ".", confidence: "low", stats: { sampled: 0, comma: 0, dot: 0 } };
  }
  const sepStr = detectSeparator(lines[0]);

  // Se as colunas são separadas por vírgula, o decimal não pode ser vírgula.
  if (sepStr === ",") {
    return { decimal: ".", confidence: "high", stats: { sampled: lines.length, comma: 0, dot: 0 } };
  }

  const re = sepStr === "\\s+" ? /\s+/ : new RegExp(sepStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  let comma = 0;
  let dot = 0;
  let sampled = 0;
  for (const raw of lines.slice(0, 20)) {
    const parts = raw.split(re).map((s) => s.trim()).filter(Boolean);
    for (const p of parts) {
      // Considera só tokens "numéricos" (dígitos + um separador decimal opcional + sinal).
      if (!/^[-+]?\d+([.,]\d+)?$/.test(p)) continue;
      sampled++;
      if (p.includes(",")) comma++;
      else if (p.includes(".")) dot++;
    }
  }
  if (comma === 0 && dot === 0) {
    return { decimal: ".", confidence: "low", stats: { sampled, comma, dot } };
  }
  const decimal: "." | "," = comma > dot ? "," : ".";
  const winner = Math.max(comma, dot);
  const loser = Math.min(comma, dot);
  const total = winner + loser;
  const confidence: "high" | "low" =
    total >= 3 && winner / total >= 0.8 ? "high" : "low";
  return { decimal, confidence, stats: { sampled, comma, dot } };
}

export type DetectionResult = {
  preset: keyof typeof TXT_PRESETS;
  /** "high" só quando vence com folga (≥75% e ≥3 votos de margem). "low" caso contrário. */
  confidence: "high" | "low";
  /** Estatísticas brutas para debug/UI. */
  stats: {
    sampled: number;
    withId: number;
    withoutId: number;
    aGtB_id: number;
    bGtA_id: number;
    aGtB_noid: number;
    bGtA_noid: number;
    latLngHits: number;
  };
};

const MIN_SAMPLES = 3;
const CONFIDENT_RATIO = 0.75;
const CONFIDENT_MARGIN = 3;

function classify(winner: number, loser: number): "high" | "low" {
  const total = winner + loser;
  if (total < MIN_SAMPLES) return "low";
  if (winner / total < CONFIDENT_RATIO) return "low";
  if (winner - loser < CONFIDENT_MARGIN) return "low";
  return "high";
}

/**
 * Versão "verbose" da detecção: devolve o preset vencedor + confiança + estatísticas,
 * mesmo quando a confiança é baixa, para que a UI possa decidir o que mostrar.
 * Devolve null apenas quando não há amostra alguma.
 */
export async function detectTxtPresetVerbose(
  file: File,
  decimal: "." | "," = ".",
  skipHeaderLines = 0,
): Promise<DetectionResult | null> {
  const text = await file.text();
  const lines = text
    .split(/\r?\n/)
    .slice(skipHeaderLines)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const sepStr = detectSeparator(lines[0]);
  const re = sepStr === "\\s+" ? /\s+/ : new RegExp(sepStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  let withId = 0;
  let withoutId = 0;
  let aGtB_id = 0;
  let bGtA_id = 0;
  let aGtB_noid = 0;
  let bGtA_noid = 0;
  let latLngHits = 0;
  let sampled = 0;

  for (const raw of lines.slice(0, 20)) {
    const parts = raw.split(re).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 3) continue;
    const n0 = toNum(parts[0], decimal);
    const n1 = toNum(parts[1], decimal);
    const n2 = toNum(parts[2], decimal);
    const n3 = parts[3] ? toNum(parts[3], decimal) : NaN;

    const idLike =
      Number.isFinite(n0) && Number.isInteger(n0) && n0 >= 0 && parts[0].indexOf(".") < 0;

    if (idLike && Number.isFinite(n1) && Number.isFinite(n2) && Number.isFinite(n3)) {
      withId++;
      sampled++;
      if (Math.abs(n1) <= 90 && Math.abs(n2) <= 180) latLngHits++;
      if (n1 > n2) aGtB_id++;
      else if (n2 > n1) bGtA_id++;
    } else if (!idLike && Number.isFinite(n0) && Number.isFinite(n1)) {
      withoutId++;
      sampled++;
      if (Math.abs(n0) <= 90 && Math.abs(n1) <= 180) latLngHits++;
      if (n0 > n1) aGtB_noid++;
      else if (n1 > n0) bGtA_noid++;
    }
  }

  const stats = { sampled, withId, withoutId, aGtB_id, bGtA_id, aGtB_noid, bGtA_noid, latLngHits };
  if (sampled === 0) return null;

  // Lat/Lng só é alta-confiança se quase todas as amostras cabem nas faixas E há ≥3 amostras.
  if (sampled >= MIN_SAMPLES && latLngHits / sampled >= 0.9) {
    return { preset: "Lat,Lng,Z (GNSS)", confidence: "high", stats };
  }
  if (latLngHits / sampled >= 0.8) {
    return { preset: "Lat,Lng,Z (GNSS)", confidence: "low", stats };
  }

  if (withId >= withoutId && withId > 0) {
    const aWin = aGtB_id >= bGtA_id;
    const winner = aWin ? aGtB_id : bGtA_id;
    const loser = aWin ? bGtA_id : aGtB_id;
    if (winner === 0) return null;
    return {
      preset: aWin ? "PNEZD (P,N,E,Z,D)" : "PENZD (P,E,N,Z,D)",
      confidence: classify(winner, loser),
      stats,
    };
  }

  if (withoutId > 0) {
    const aWin = aGtB_noid >= bGtA_noid;
    const winner = aWin ? aGtB_noid : bGtA_noid;
    const loser = aWin ? bGtA_noid : aGtB_noid;
    if (winner === 0) return null;
    return {
      preset: aWin ? "NEZ (N,E,Z)" : "ENZ (E,N,Z)",
      confidence: classify(winner, loser),
      stats,
    };
  }

  return null;
}

/**
 * Detecta o preset de TXT topográfico. Só devolve o preset quando a heurística
 * está em ALTA confiança (vence com ≥75% e ≥3 votos de margem em ≥3 amostras).
 * Caso contrário devolve null — a UI mantém o preset atual e o usuário decide.
 */
export async function detectTxtPreset(
  file: File,
  decimal: "." | "," = ".",
  skipHeaderLines = 0,
): Promise<keyof typeof TXT_PRESETS | null> {
  const r = await detectTxtPresetVerbose(file, decimal, skipHeaderLines);
  if (!r) return null;
  return r.confidence === "high" ? r.preset : null;
}

export async function parseTopoTxt(file: File, fmt: TxtFormat): Promise<ImportedDataset> {
  const text = await file.text();
  const allLines = text.split(/\r?\n/);
  const lines = allLines.slice(fmt.skipHeaderLines).filter((l) => l.trim().length > 0);
  const sep = fmt.separator === "auto" ? detectSeparator(lines[0] ?? "") : fmt.separator;
  const re = sep === "\\s+" ? /\s+/ : new RegExp(sep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  const ds: ImportedDataset = { source: file.name, kind: "topo-txt", points: [], polylines: [] };

  let idSeq = 0;
  for (const raw of lines) {
    const parts = raw.split(re).map((s) => s.trim()).filter(Boolean);
    if (parts.length < fmt.order.length) continue;
    let pid: string | undefined;
    let x: number | undefined;
    let y: number | undefined;
    let z: number | undefined;
    let desc: string | undefined;
    for (let i = 0; i < fmt.order.length; i++) {
      const key = fmt.order[i];
      const val = parts[i];
      if (!val) continue;
      switch (key) {
        case "P": pid = val; break;
        case "E": x = toNum(val, fmt.decimal); break;
        case "N": y = toNum(val, fmt.decimal); break;
        case "Z": z = toNum(val, fmt.decimal); break;
        case "D": desc = val; break;
        case "skip": break;
      }
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    ds.points.push({
      id: pid || `pt-${++idSeq}`,
      x: x as number,
      y: y as number,
      z,
      label: pid,
      description: desc,
    });
  }
  computeBbox(ds);
  return ds;
}
