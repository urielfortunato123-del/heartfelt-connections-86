import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import {
  DISTANCE_UNITS,
  formatKm,
  kmToDer,
  kmToHectometros,
} from "@/lib/converters/distance";

export type ProjectMeta = {
  name: string;          // "SP-261"
  direction: "asc" | "desc";
  startKm: number;
  endKm: number;
  step: number;
};

export type Row = {
  km: number;
  descricao: string;
};

export type ImportedRow = {
  km: number;
  descricao: string;
  estacas?: number;
  excedente?: number;
};

/**
 * Importa CSV/XLSX. Aceita colunas (case/acento-insensível):
 *   km | estaca | excedente (m) | descricao
 * Se houver "estaca" + "excedente" mas não houver "km", reconstrói km = (estaca*20 + excedente)/1000.
 */
export async function importSpreadsheet(file: File): Promise<ImportedRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("Planilha vazia");
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  const norm = (s: string) =>
    s
      .toString()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");

  const out: ImportedRow[] = [];
  for (const r of raw) {
    const map: Record<string, unknown> = {};
    for (const k of Object.keys(r)) map[norm(k)] = r[k];

    const kmRaw = map.km ?? map.quilometro ?? map.kilometro;
    const estRaw = map.estaca ?? map.estacas;
    const excRaw = map.excedente ?? map.excedentem ?? map.extra ?? map.metros;
    const descRaw =
      map.descricao ?? map.descricaodoponto ?? map.observacao ?? map.obs ?? map.label ?? "";

    let km: number | null = null;
    if (kmRaw !== undefined && kmRaw !== "") {
      const n = Number(String(kmRaw).replace(",", "."));
      if (Number.isFinite(n)) km = n;
    }
    if (km === null && estRaw !== undefined && estRaw !== "") {
      const est = Number(String(estRaw).replace(",", "."));
      const exc = excRaw !== undefined && excRaw !== "" ? Number(String(excRaw).replace(",", ".")) : 0;
      if (Number.isFinite(est)) km = (est * 20 + (Number.isFinite(exc) ? exc : 0)) / 1000;
    }
    if (km === null) continue;

    out.push({
      km,
      descricao: String(descRaw ?? "").trim(),
      estacas: estRaw !== undefined && estRaw !== "" ? Number(estRaw) : undefined,
      excedente: excRaw !== undefined && excRaw !== "" ? Number(excRaw) : undefined,
    });
  }
  return out;
}


function buildRows(rows: Row[]): Record<string, string | number>[] {
  return rows.map((r) => {
    const der = kmToDer(r.km);
    const out: Record<string, string | number> = {
      "Km": formatKm(r.km),
      "Estaca": der.estacas,
      "Excedente (m)": Number(der.extra.toFixed(2)),
      "Hectômetro": Number(kmToHectometros(r.km).toFixed(2)),
    };
    for (const u of DISTANCE_UNITS) {
      out[`${u.label} (${u.suffix})`] = Number((r.km * u.factor).toPrecision(8));
    }
    out["Descrição"] = r.descricao || "";
    return out;
  });
}

export function exportExcel(meta: ProjectMeta, rows: Row[]) {
  const data = buildRows(rows);
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Estaqueamento");

  const metaWs = XLSX.utils.json_to_sheet([
    { Campo: "Rodovia", Valor: meta.name },
    { Campo: "Sentido", Valor: meta.direction === "asc" ? "Crescente" : "Decrescente" },
    { Campo: "Km inicial", Valor: meta.startKm },
    { Campo: "Km final", Valor: meta.endKm },
    { Campo: "Passo (km)", Valor: meta.step },
  ]);
  XLSX.utils.book_append_sheet(wb, metaWs, "Projeto");

  XLSX.writeFile(wb, `${slug(meta.name)}-estaqueamento.xlsx`);
}

export function exportCsv(meta: ProjectMeta, rows: Row[]) {
  const data = buildRows(rows);
  const ws = XLSX.utils.json_to_sheet(data);
  const csv = XLSX.utils.sheet_to_csv(ws);
  download(`${slug(meta.name)}-estaqueamento.csv`, csv, "text/csv;charset=utf-8");
}

function buildLadosRows(meta: ProjectMeta, rows: Row[]): Record<string, string | number>[] {
  const mirror = (km: number) => meta.startKm + meta.endKm - km;
  const projectIsAsc = meta.direction === "asc";
  return rows.map((r) => {
    const der = kmToDer(Math.abs(r.km));
    const rightKm = r.km;
    const leftKm = mirror(r.km);
    return {
      "Estaca": der.estacas,
      "Excedente (m)": Number(der.extra.toFixed(2)),
      "Km lado direito": formatKm(Math.abs(rightKm)),
      "Km lado direito (sentido)": projectIsAsc ? "Crescente" : "Decrescente",
      "Km lado esquerdo": formatKm(Math.abs(leftKm)),
      "Km lado esquerdo (sentido)": projectIsAsc ? "Decrescente" : "Crescente",
      "Descrição": r.descricao || "",
    };
  });
}

export function exportPlacasLadosExcel(meta: ProjectMeta, rows: Row[]) {
  const data = buildLadosRows(meta, rows);
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Placas por estaca");
  const metaWs = XLSX.utils.json_to_sheet([
    { Campo: "Rodovia", Valor: meta.name },
    { Campo: "Sentido do projeto", Valor: meta.direction === "asc" ? "Crescente" : "Decrescente" },
    { Campo: "Km inicial", Valor: meta.startKm },
    { Campo: "Km final", Valor: meta.endKm },
    { Campo: "Passo (km)", Valor: meta.step },
  ]);
  XLSX.utils.book_append_sheet(wb, metaWs, "Projeto");
  XLSX.writeFile(wb, `${slug(meta.name)}-placas-lados.xlsx`);
}

export function exportPlacasLadosCsv(meta: ProjectMeta, rows: Row[]) {
  const data = buildLadosRows(meta, rows);
  const ws = XLSX.utils.json_to_sheet(data);
  const csv = XLSX.utils.sheet_to_csv(ws);
  download(`${slug(meta.name)}-placas-lados.csv`, csv, "text/csv;charset=utf-8");
}

export function exportPdfTable(meta: ProjectMeta, rows: Row[]) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  doc.setFontSize(14);
  doc.text(`Projeto de Pista — ${meta.name}`, 14, 14);
  doc.setFontSize(10);
  doc.text(
    `Sentido: ${meta.direction === "asc" ? "Crescente (+km)" : "Decrescente (-km)"}   ` +
      `Km ${formatKm(meta.startKm)} → ${formatKm(meta.endKm)}   ` +
      `Passo: ${meta.step} km`,
    14,
    20,
  );

  const head = [["Km", "Estaca", "Exc. (m)", "Hm", "Metros", "Milhas", "Pés", "Descrição"]];
  const body = rows.map((r) => {
    const der = kmToDer(r.km);
    return [
      formatKm(r.km),
      String(der.estacas),
      der.extra.toFixed(2),
      kmToHectometros(r.km).toFixed(2),
      (r.km * 1000).toFixed(2),
      (r.km * 0.621371).toFixed(4),
      (r.km * 3280.84).toFixed(2),
      r.descricao || "",
    ];
  });

  autoTable(doc, {
    head,
    body,
    startY: 26,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [80, 30, 140] },
  });

  doc.save(`${slug(meta.name)}-estaqueamento.pdf`);
}

type PlateSide = "single" | "both" | "grid";

export type KmLabelFormat = "padded" | "integer" | "decimal1" | "decimal3";

export function formatKmLabel(km: number, fmt: KmLabelFormat = "decimal3"): string {
  const abs = Math.abs(km);
  switch (fmt) {
    case "padded": {
      // km 012 — sempre 3 dígitos zero à esquerda, inteiro arredondado
      const n = Math.round(abs);
      return `km ${n.toString().padStart(3, "0")}`;
    }
    case "integer":
      return `km ${Math.round(abs)}`;
    case "decimal1":
      return `km ${abs.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
    case "decimal3":
    default:
      return `km ${formatKm(abs)}`;
  }
}


function drawPlate(
  doc: jsPDF,
  opts: {
    x: number;
    y: number;
    w: number;
    h: number;
    title: string;
    titleColor: [number, number, number];
    kmLabel: string;
    subline: string;
    descricao?: string;
  },
) {
  const { x, y, w, h, title, titleColor, kmLabel, subline, descricao } = opts;

  // Escalas relativas à altura (referência: h=130mm)
  const scale = h / 130;
  const titleBar = Math.max(8, 14 * scale);
  const fsTitle = Math.max(7, 12 * scale);
  const fsKm = Math.max(18, 54 * scale);
  const fsSub = Math.max(6, 11 * scale);
  const fsDesc = Math.max(6, 10 * scale);

  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(1.2);
  doc.roundedRect(x, y, w, h, 4, 4, "FD");

  doc.setFillColor(...titleColor);
  doc.rect(x, y, w, titleBar, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(fsTitle);
  doc.text(title, x + w / 2, y + titleBar * 0.7, { align: "center" });

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(fsKm);
  doc.text(kmLabel, x + w / 2, y + h / 2 + fsKm * 0.18, { align: "center" });

  doc.setFontSize(fsSub);
  doc.text(subline, x + w / 2, y + h - (descricao ? fsDesc * 1.8 + 4 : 4), {
    align: "center",
  });

  if (descricao) {
    doc.setFontSize(fsDesc);
    doc.setTextColor(80);
    doc.text(descricao, x + w / 2, y + h - 3, { align: "center" });
  }
}

/**
 * PDF com placa(s) por marcador de km.
 * - mode "single": 1 placa por página (respeitando o sentido do projeto).
 * - mode "both":   2 placas por página, lado esquerdo (decrescente) e lado direito (crescente),
 *                  cada uma mostrando o km correto para aquele lado da pista.
 * - mode "grid":   várias placas por página (3 colunas × 4 linhas = 12 por A4 paisagem),
 *                  consolidado para impressão econômica.
 */
export type BothLayout = {
  plateW: number;      // largura de cada placa (mm)
  plateH: number;      // altura de cada placa (mm)
  gap: number;         // espaçamento horizontal entre as placas (mm)
  marginTop: number;   // distância do topo até as placas (mm)
  marginX: number;     // margem lateral mínima (mm); se 0, as placas são centralizadas
};

export const DEFAULT_BOTH_LAYOUT: BothLayout = {
  plateW: 130,
  plateH: 140,
  gap: 17,
  marginTop: 45,
  marginX: 0,
};

export type GridLayout = {
  cols: number;
  rows: number;
  marginX: number;
  marginTop: number;
  marginBottom: number;
  gap: number;
};

export const DEFAULT_GRID_LAYOUT: GridLayout = {
  cols: 3,
  rows: 4,
  marginX: 8,
  marginTop: 22,
  marginBottom: 10,
  gap: 4,
};

export function exportPdfPlacas(
  meta: ProjectMeta,
  rows: Row[],
  mode: PlateSide = "single",
  kmFormat: KmLabelFormat = "decimal3",
  bothLayout: BothLayout = DEFAULT_BOTH_LAYOUT,
  outputMode: "save" | "blob" = "save",
  gridLayout: GridLayout = DEFAULT_GRID_LAYOUT,
): Blob | void {


  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = 297;
  const H = 210;

  // ====== CAPA ======
  const kmMin = Math.min(meta.startKm, meta.endKm);
  const kmMax = Math.max(meta.startKm, meta.endKm);
  const extentKm = Math.abs(meta.endKm - meta.startKm);
  const today = new Date();
  const dateStr = today.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, W, H, "F");

  // Faixa decorativa
  doc.setFillColor(168, 85, 247);
  doc.rect(0, 0, W, 6, "F");
  doc.setFillColor(34, 211, 238);
  doc.rect(0, H - 6, W, 6, "F");

  doc.setTextColor(168, 85, 247);
  doc.setFontSize(14);
  doc.text("PROJETO DE PISTA", W / 2, 50, { align: "center" });

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(56);
  doc.text(meta.name || "—", W / 2, 80, { align: "center" });

  doc.setTextColor(180);
  doc.setFontSize(14);
  doc.text(
    mode === "both"
      ? "Placas — dois lados da pista"
      : mode === "grid"
        ? "Placas — consolidado"
        : `Placas — sentido ${meta.direction === "asc" ? "crescente" : "decrescente"}`,
    W / 2,
    95,
    { align: "center" },
  );

  // Caixa de info
  doc.setDrawColor(168, 85, 247);
  doc.setLineWidth(0.6);
  doc.roundedRect(50, 115, W - 100, 60, 4, 4, "S");

  doc.setTextColor(140);
  doc.setFontSize(10);
  doc.text("INTERVALO DE KM", 60, 128);
  doc.text("SENTIDO", 60, 148);
  doc.text("PASSO", 160, 128);
  doc.text("DATA", 160, 148);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text(`km ${formatKm(kmMin)} → km ${formatKm(kmMax)}`, 60, 138);
  doc.text(meta.direction === "asc" ? "Crescente (+)" : "Decrescente (-)", 60, 158);
  doc.text(`${meta.step} km`, 160, 138);
  doc.text(dateStr, 160, 158);

  doc.setTextColor(120);
  doc.setFontSize(11);
  doc.text(
    `Extensão total: ${extentKm.toFixed(3)} km   ·   ${rows.length} placa(s)`,
    W / 2,
    188,
    { align: "center" },
  );

  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text("Gerado automaticamente pelo Editor de Projeto de Pista", W / 2, H - 14, {
    align: "center",
  });



  // ====== GRID: várias placas por página ======
  if (mode === "grid") {
    const cols = Math.max(1, Math.floor(gridLayout.cols));
    const rowsPerPage = Math.max(1, Math.floor(gridLayout.rows));
    const perPage = cols * rowsPerPage;
    const marginX = gridLayout.marginX;
    const marginTop = gridLayout.marginTop;
    const marginBottom = gridLayout.marginBottom;
    const gap = gridLayout.gap;

    const plateW = (W - marginX * 2 - gap * (cols - 1)) / cols;
    const plateH = (H - marginTop - marginBottom - gap * (rowsPerPage - 1)) / rowsPerPage;

    rows.forEach((r, idx) => {
      const slot = idx % perPage;
      if (slot === 0) {
        doc.addPage();
        // Fundo + header da página
        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, W, H, "F");
        doc.setTextColor(168, 85, 247);
        doc.setFontSize(13);
        doc.text(`${meta.name} · Placas (consolidado)`, 14, 12);
        doc.setTextColor(180);
        doc.setFontSize(9);
        doc.text(
          `Sentido: ${meta.direction === "asc" ? "Crescente (+km)" : "Decrescente (-km)"}   ·   página ${Math.floor(idx / perPage) + 1}`,
          14,
          18,
        );
      }

      const col = slot % cols;
      const row = Math.floor(slot / cols);
      const x = marginX + col * (plateW + gap);
      const y = marginTop + row * (plateH + gap);

      const der = kmToDer(Math.abs(r.km));
      drawPlate(doc, {
        x,
        y,
        w: plateW,
        h: plateH,
        title:
          meta.direction === "asc"
            ? "↑ CRESCENTE"
            : "↓ DECRESCENTE",
        titleColor: meta.direction === "asc" ? [16, 185, 129] : [200, 60, 60],
        kmLabel: formatKmLabel(r.km, kmFormat),
        subline: `Est ${der.estacas}+${der.extra.toFixed(1)} · ${kmToHectometros(Math.abs(r.km)).toFixed(1)} hm`,
        descricao: r.descricao,
      });
    });

    if (outputMode === "blob") return doc.output("blob");
    doc.save(`${slug(meta.name)}-placas-grid.pdf`);
    return;
  }



  // Para cálculo do km do lado oposto: espelho em torno de (startKm + endKm) / 2
  const mirror = (km: number) => meta.startKm + meta.endKm - km;

  rows.forEach((r, idx) => {
    doc.addPage();

    // Fundo
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, W, H, "F");

    // Header
    doc.setTextColor(168, 85, 247);
    doc.setFontSize(16);
    doc.text(`${meta.name} · Projeto de Pista`, 14, 16);

    doc.setTextColor(200);
    doc.setFontSize(11);
    doc.text(
      mode === "both"
        ? "Placas dos dois lados da pista"
        : `Sentido: ${meta.direction === "asc" ? "Crescente (+km)" : "Decrescente (-km)"}`,
      14,
      24,
    );

    const der = kmToDer(Math.abs(r.km));
    const subline = `Estaca ${der.estacas} + ${der.extra.toFixed(2)}   ·   ${kmToHectometros(
      Math.abs(r.km),
    ).toFixed(2)} hm`;

    if (mode === "both") {
      const { plateW, plateH, gap, marginTop, marginX } = bothLayout;
      const totalW = plateW * 2 + gap;
      const startX = marginX > 0 ? marginX : (W - totalW) / 2;
      const plateY = marginTop;

      // O km "r.km" segue o sentido do projeto (asc: cresce; desc: decresce).
      // mirror() é simétrico — devolve o mesmo ponto físico medido a partir
      // do outro extremo. Funciona corretamente seja qual for a ordem de
      // startKm/endKm (ex.: 120→0 ou 0→120).
      const oppositeKm = mirror(r.km);

      // A faixa do projeto define qual sentido é o "direto" (lado direito da
      // pista, no sentido de leitura do motorista). O outro lado é o oposto.
      const projectIsAsc = meta.direction === "asc";

      const rightSide = {
        km: r.km,
        title: projectIsAsc ? "LADO DIREITO · CRESCENTE →" : "LADO DIREITO · DECRESCENTE →",
        color: projectIsAsc ? ([16, 185, 129] as [number, number, number]) : ([200, 60, 60] as [number, number, number]),
      };
      const leftSide = {
        km: oppositeKm,
        title: projectIsAsc ? "← LADO ESQUERDO · DECRESCENTE" : "← LADO ESQUERDO · CRESCENTE",
        color: projectIsAsc ? ([200, 60, 60] as [number, number, number]) : ([16, 185, 129] as [number, number, number]),
      };

      // Lado esquerdo da pista (sentido contrário ao do projeto)
      drawPlate(doc, {
        x: startX,
        y: plateY,
        w: plateW,
        h: plateH,
        title: leftSide.title,
        titleColor: leftSide.color,
        kmLabel: formatKmLabel(leftSide.km, kmFormat),
        subline,
        descricao: r.descricao,
      });

      // Lado direito da pista (sentido do projeto)
      drawPlate(doc, {
        x: startX + plateW + gap,
        y: plateY,
        w: plateW,
        h: plateH,
        title: rightSide.title,
        titleColor: rightSide.color,
        kmLabel: formatKmLabel(rightSide.km, kmFormat),
        subline,
        descricao: r.descricao,
      });

    } else {
      drawPlate(doc, {
        x: 60,
        y: 50,
        w: 177,
        h: 130,
        title: meta.direction === "asc" ? "↑ CRESCENTE" : "↓ DECRESCENTE",
        titleColor:
          meta.direction === "asc" ? [16, 185, 129] : [200, 60, 60],
        kmLabel: formatKmLabel(r.km, kmFormat),
        subline,
        descricao: r.descricao,
      });
    }

    // Footer
    doc.setTextColor(120);
    doc.setFontSize(9);
    doc.text(`${idx + 1} / ${rows.length}`, W - 14, H - 8, { align: "right" });
  });

  if (outputMode === "blob") return doc.output("blob");
  doc.save(
    `${slug(meta.name)}-placas${mode === "both" ? "-dois-lados" : ""}.pdf`,
  );
}

function slug(s: string) {
  return (s || "projeto")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
