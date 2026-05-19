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

/**
 * Detecta heurísticamente o preset de TXT topográfico a partir do conteúdo bruto.
 * Estratégia:
 *  - identifica o separador na primeira linha de dados;
 *  - amostra até 20 linhas com ≥4 colunas numéricas iniciadas por ID inteiro;
 *  - se col1 e col2 caem em faixas de lat/lng → "Lat,Lng,Z (GNSS)";
 *  - senão compara magnitudes: no Brasil (UTM sul) Norte > Leste, então
 *    col1 > col2 ⇒ PNEZD; col2 > col1 ⇒ PENZD.
 *  - sem ID inteiro na col0, decide entre NEZ/ENZ pela mesma regra.
 * Devolve null se não tiver confiança suficiente (deixa o padrão atual).
 */
export async function detectTxtPreset(
  file: File,
  decimal: "." | "," = ".",
  skipHeaderLines = 0,
): Promise<keyof typeof TXT_PRESETS | null> {
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
  let aGtB_id = 0; // col1 > col2 quando há ID
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

    const idLike = Number.isFinite(n0) && Number.isInteger(n0) && n0 >= 0 && parts[0].indexOf(".") < 0;

    // Quando há ID na col0, os candidatos a Norte/Leste são col1/col2.
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

  if (sampled === 0) return null;

  // Lat/Lng quando a maioria das amostras cabe nas faixas.
  if (latLngHits / sampled >= 0.8) return "Lat,Lng,Z (GNSS)";

  if (withId >= withoutId) {
    if (aGtB_id > bGtA_id) return "PNEZD (P,N,E,Z,D)";
    if (bGtA_id > aGtB_id) return "PENZD (P,E,N,Z,D)";
    return null;
  }
  if (aGtB_noid > bGtA_noid) return "NEZ (N,E,Z)";
  if (bGtA_noid > aGtB_noid) return "ENZ (E,N,Z)";
  return null;
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
