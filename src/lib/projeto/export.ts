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

type PlateSide = "single" | "both";

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

  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(1.5);
  doc.roundedRect(x, y, w, h, 5, 5, "FD");

  // Faixa de título (sentido / lado)
  doc.setFillColor(...titleColor);
  doc.rect(x, y, w, 14, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.text(title, x + w / 2, y + 9.5, { align: "center" });

  // Km grande
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(54);
  doc.text(kmLabel, x + w / 2, y + h / 2 + 8, { align: "center" });

  // Sub-linha (estaca/hm)
  doc.setFontSize(11);
  doc.text(subline, x + w / 2, y + h - 18, { align: "center" });

  if (descricao) {
    doc.setFontSize(10);
    doc.setTextColor(80);
    doc.text(descricao, x + w / 2, y + h - 8, { align: "center" });
  }
}

/**
 * PDF com placa(s) por marcador de km.
 * - mode "single": 1 placa por página (respeitando o sentido do projeto).
 * - mode "both":   2 placas por página, lado esquerdo (decrescente) e lado direito (crescente),
 *                  cada uma mostrando o km correto para aquele lado da pista.
 */
export function exportPdfPlacas(
  meta: ProjectMeta,
  rows: Row[],
  mode: PlateSide = "single",
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = 297;
  const H = 210;

  // Para cálculo do km do lado oposto: espelho em torno de (startKm + endKm) / 2
  const mirror = (km: number) => meta.startKm + meta.endKm - km;

  rows.forEach((r, idx) => {
    if (idx > 0) doc.addPage();

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
      const plateW = 130;
      const plateH = 140;
      const gap = 17;
      const totalW = plateW * 2 + gap;
      const startX = (W - totalW) / 2;
      const plateY = 45;

      // Lado esquerdo da pista: sentido DECRESCENTE → km espelhado
      const leftKm = mirror(r.km);
      drawPlate(doc, {
        x: startX,
        y: plateY,
        w: plateW,
        h: plateH,
        title: "← LADO ESQUERDO · DECRESCENTE",
        titleColor: [200, 60, 60],
        kmLabel: `km ${formatKm(leftKm)}`,
        subline,
        descricao: r.descricao,
      });

      // Lado direito da pista: sentido CRESCENTE → km original
      drawPlate(doc, {
        x: startX + plateW + gap,
        y: plateY,
        w: plateW,
        h: plateH,
        title: "LADO DIREITO · CRESCENTE →",
        titleColor: [16, 185, 129],
        kmLabel: `km ${formatKm(r.km)}`,
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
        kmLabel: `km ${formatKm(r.km)}`,
        subline,
        descricao: r.descricao,
      });
    }

    // Footer
    doc.setTextColor(120);
    doc.setFontSize(9);
    doc.text(`${idx + 1} / ${rows.length}`, W - 14, H - 8, { align: "right" });
  });

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
