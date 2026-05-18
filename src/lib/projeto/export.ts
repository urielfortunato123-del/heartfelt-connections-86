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

/** PDF com uma "placa" por marcador de km (paisagem, 1 placa por página). */
export function exportPdfPlacas(meta: ProjectMeta, rows: Row[]) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = 297;
  const H = 210;

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
      `Sentido: ${meta.direction === "asc" ? "Crescente (+km)" : "Decrescente (-km)"}`,
      14,
      24,
    );

    // PLACA grande (estilo rodoviário)
    const plateX = 60;
    const plateY = 50;
    const plateW = 177;
    const plateH = 110;

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(2);
    doc.roundedRect(plateX, plateY, plateW, plateH, 6, 6, "FD");

    // Faixa superior (sentido)
    doc.setFillColor(meta.direction === "asc" ? 16 : 200, meta.direction === "asc" ? 185 : 60, meta.direction === "asc" ? 129 : 60);
    doc.rect(plateX, plateY, plateW, 16, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    doc.text(
      meta.direction === "asc" ? "↑ CRESCENTE" : "↓ DECRESCENTE",
      plateX + plateW / 2,
      plateY + 11,
      { align: "center" },
    );

    // Km enorme
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(72);
    doc.text(`km ${formatKm(r.km)}`, plateX + plateW / 2, plateY + 68, { align: "center" });

    // Estaca / hm
    const der = kmToDer(r.km);
    doc.setFontSize(14);
    doc.text(
      `Estaca ${der.estacas} + ${der.extra.toFixed(2)}   ·   ${kmToHectometros(r.km).toFixed(2)} hm`,
      plateX + plateW / 2,
      plateY + 90,
      { align: "center" },
    );

    if (r.descricao) {
      doc.setFontSize(12);
      doc.setTextColor(80);
      doc.text(r.descricao, plateX + plateW / 2, plateY + 102, { align: "center" });
    }

    // Footer
    doc.setTextColor(120);
    doc.setFontSize(9);
    doc.text(`${idx + 1} / ${rows.length}`, W - 14, H - 8, { align: "right" });
  });

  doc.save(`${slug(meta.name)}-placas.pdf`);
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
