import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, FileDown, FileSpreadsheet, FileText, MapPin, Plus, Route as RouteIcon, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DISTANCE_UNITS,
  formatKm,
  kmToDer,
  kmToHectometros,
} from "@/lib/converters/distance";
import {
  cumulativeKm,
  distributeKmMarkers,
  fetchOsrmRoute,
  nearestKm,
  nearestOnRoute,
  type LL,
} from "@/lib/projeto/geo";
import {
  DEFAULT_BOTH_LAYOUT,
  DEFAULT_GRID_LAYOUT,
  exportCsv,
  exportExcel,
  exportPdfPlacas,
  exportPdfTable,
  exportPlacasLadosCsv,
  exportPlacasLadosExcel,
  importSpreadsheet,
  type BothLayout,
  type GridLayout,
  type KmLabelFormat,
  type PageFormat,
  type PageOrientation,
  type ProjectMeta,
} from "@/lib/projeto/export";




const RouteMap = lazy(() => import("@/components/projeto/RouteMap"));
import { PdfPreviewDialog } from "@/components/projeto/PdfPreviewDialog";

export const Route = createFileRoute("/projeto")({
  head: () => ({
    meta: [
      { title: "Editor de Projeto de Pista · KM Converter Pro" },
      {
        name: "description",
        content:
          "Trace rotas no mapa, gere estaqueamento DER automaticamente e exporte para PDF (com placas) ou Excel.",
      },
      { property: "og:title", content: "Editor de Projeto de Pista" },
      {
        property: "og:description",
        content: "Mapa + estaqueamento DER + export PDF/Excel.",
      },
    ],
  }),
  component: ProjetoPage,
});

type Manual = { id: string; km: number; lat: number; lng: number; label: string };

const STORAGE_KEY = "pista.projects.v1";

type SavedProject = {
  meta: ProjectMeta;
  start: LL | null;
  end: LL | null;
  polyline: [number, number][];
  manuals: Manual[];
  descriptions: Record<string, string>;
};

function loadSaved(): SavedProject | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedProject) : null;
  } catch {
    return null;
  }
}

function ProjetoPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [meta, setMeta] = useState<ProjectMeta>({
    name: "SP-261",
    direction: "asc",
    startKm: 0,
    endKm: 0,
    step: 1,
  });

  const [start, setStart] = useState<LL | null>(null);
  const [end, setEnd] = useState<LL | null>(null);
  const [polyline, setPolyline] = useState<[number, number][]>([]);
  const [manuals, setManuals] = useState<Manual[]>([]);
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"start" | "end" | "manual">("start");
  const [loading, setLoading] = useState(false);
  const [kmFormat, setKmFormat] = useState<KmLabelFormat>("decimal3");
  const [bothLayout, setBothLayout] = useState<BothLayout>(DEFAULT_BOTH_LAYOUT);
  const [gridLayout, setGridLayout] = useState<GridLayout>(DEFAULT_GRID_LAYOUT);
  const [pageFormat, setPageFormat] = useState<PageFormat>("a4");
  const [pageOrientation, setPageOrientation] = useState<PageOrientation>("landscape");
  const [kmDrafts, setKmDrafts] = useState<Record<string, string>>({});
  const [kmErrors, setKmErrors] = useState<Record<string, string>>({});
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // ---------- Histórico (undo/redo) dos pontos manuais ----------
  const manualsRef = useRef<Manual[]>([]);
  useEffect(() => { manualsRef.current = manuals; }, [manuals]);
  const past = useRef<Manual[][]>([]);
  const future = useRef<Manual[][]>([]);
  const draggingId = useRef<string | null>(null);
  const HISTORY_LIMIT = 100;

  const pushSnapshot = useCallback((snapshot: Manual[]) => {
    past.current.push(snapshot);
    if (past.current.length > HISTORY_LIMIT) past.current.shift();
    future.current = [];
  }, []);

  /** Replace estado e zera histórico (usar em restore/reset). */
  const replaceManuals = useCallback((next: Manual[]) => {
    past.current = [];
    future.current = [];
    manualsRef.current = next;
    setManuals(next);
  }, []);

  /** Atualiza manuals criando um checkpoint no histórico. */
  type Updater = Manual[] | ((prev: Manual[]) => Manual[]);
  const commitManuals = useCallback((updater: Updater) => {
    const prev = manualsRef.current;
    const next = typeof updater === "function" ? (updater as (p: Manual[]) => Manual[])(prev) : updater;
    if (next === prev) return;
    pushSnapshot(prev);
    manualsRef.current = next;
    setManuals(next);
  }, [pushSnapshot]);

  /** Atualização "transitória" (usada no arraste). Coalesce em um único snapshot. */
  const liveManuals = useCallback((id: string, updater: Updater) => {
    const prev = manualsRef.current;
    if (draggingId.current !== id) {
      // primeiro movimento do arraste — snapshot do estado anterior
      pushSnapshot(prev);
      draggingId.current = id;
    }
    const next = typeof updater === "function" ? (updater as (p: Manual[]) => Manual[])(prev) : updater;
    manualsRef.current = next;
    setManuals(next);
  }, [pushSnapshot]);

  const endLive = useCallback(() => { draggingId.current = null; }, []);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(manualsRef.current);
    manualsRef.current = prev;
    setManuals(prev);
    toast("Desfeito", { duration: 1200 });
  }, []);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(manualsRef.current);
    manualsRef.current = next;
    setManuals(next);
    toast("Refeito", { duration: 1200 });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      const editable = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement | null)?.isContentEditable;
      if (editable) return; // não interceptar quando digitando em inputs
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((key === "y") || (key === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);
  // --------------------------------------------------------------

  const kmRange = useMemo(() => {
    const lo = Math.min(meta.startKm, meta.endKm);
    const hi = Math.max(meta.startKm, meta.endKm);
    return { lo, hi };
  }, [meta.startKm, meta.endKm]);

  function validateKm(raw: string): { value?: number; error?: string } {
    const s = raw.trim().replace(",", ".");
    if (s === "" || s === "-") return { error: "Informe um valor numérico." };
    const v = Number(s);
    if (!Number.isFinite(v)) return { error: "Valor numérico inválido." };
    const { lo, hi } = kmRange;
    if (hi > lo && (v < lo - 1e-9 || v > hi + 1e-9)) {
      return { error: `Fora do intervalo ${formatKm(lo)} – ${formatKm(hi)}.` };
    }
    return { value: v };
  }

  function commitManualKm(id: string, raw: string) {
    setKmDrafts((d) => ({ ...d, [id]: raw }));
    const { value, error } = validateKm(raw);
    if (error || value === undefined) {
      setKmErrors((e) => ({ ...e, [id]: error ?? "Valor inválido." }));
      return;
    }
    setKmErrors((e) => {
      const { [id]: _, ...rest } = e;
      return rest;
    });
    commitManuals((arr) => arr.map((x) => (x.id === id ? { ...x, km: value } : x)));
  }

  // Restaurar do localStorage
  useEffect(() => {
    if (!mounted) return;
    const saved = loadSaved();
    if (saved) {
      setMeta(saved.meta);
      setStart(saved.start);
      setEnd(saved.end);
      setPolyline(saved.polyline);
      replaceManuals(saved.manuals);
      setDescriptions(saved.descriptions);
    }
  }, [mounted]);

  // Salvar automaticamente
  useEffect(() => {
    if (!mounted) return;
    const data: SavedProject = { meta, start, end, polyline, manuals, descriptions };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }, [mounted, meta, start, end, polyline, manuals, descriptions]);

  const { total, cum } = useMemo(() => cumulativeKm(polyline), [polyline]);

  const kmMarkers = useMemo(() => {
    if (polyline.length < 2 || meta.step <= 0) return [];
    return distributeKmMarkers(polyline, meta.step).map((p) => ({
      ...p,
      // remapeia para o domínio [startKm, endKm] respeitando sentido
      km: meta.direction === "asc" ? meta.startKm + p.km : meta.startKm - p.km,
    }));
  }, [polyline, meta.step, meta.startKm, meta.direction]);

  async function traceRoute(s: LL, e: LL) {
    setLoading(true);
    try {
      const { polyline: poly, distanceKm } = await fetchOsrmRoute(s, e);
      setPolyline(poly);
      setMeta((m) => ({
        ...m,
        endKm: m.direction === "asc" ? m.startKm + distanceKm : m.startKm - distanceKm,
      }));
      toast.success(`Rota traçada: ${distanceKm.toFixed(3)} km`);
    } catch (err) {
      toast.error(`Falha ao traçar rota: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  function handleMapClick(latlng: LL) {
    if (mode === "start") {
      setStart(latlng);
      setMode("end");
      toast("Início definido. Agora clique no FIM.");
    } else if (mode === "end") {
      setEnd(latlng);
      if (start) void traceRoute(start, latlng);
      setMode("manual");
    } else {
      if (polyline.length < 2) {
        toast.error("Trace a rota antes de adicionar pontos.");
        return;
      }
      const km = nearestKm(polyline, cum, latlng);
      const absKm = meta.direction === "asc" ? meta.startKm + km : meta.startKm - km;
      const id = `m-${Date.now()}`;
      commitManuals((arr) => [...arr, { id, km: absKm, lat: latlng.lat, lng: latlng.lng, label: "ponto" }]);
    }
  }

  function resetAll() {
    setStart(null);
    setEnd(null);
    setPolyline([]);
    replaceManuals([]);
    setDescriptions({});
    setMode("start");
    setMeta((m) => ({ ...m, startKm: 0, endKm: 0 }));
  }

  async function handleImport(file: File | null) {
    if (!file) return;
    try {
      const imported = await importSpreadsheet(file);
      if (imported.length === 0) {
        toast.error("Nenhuma linha válida encontrada. Verifique colunas: km, estaca, excedente, descrição.");
        return;
      }

      // Adapta km à direção do projeto (planilha é tratada como absoluta).
      const descPatch: Record<string, string> = {};
      const newManuals: Manual[] = [];
      const hasRoute = polyline.length >= 2;
      const autoKmSet = new Set(kmMarkers.map((m) => Number(m.km.toFixed(3))));

      // Importa ajustando startKm/endKm se vier além dos limites
      let minKm = Infinity;
      let maxKm = -Infinity;

      imported.forEach((row, i) => {
        const km = row.km;
        if (km < minKm) minKm = km;
        if (km > maxKm) maxKm = km;
        descPatch[`km-${km}`] = row.descricao;

        // Se NÃO bater com a grade automática, vira ponto manual
        const rounded = Number(km.toFixed(3));
        if (!autoKmSet.has(rounded) && row.descricao) {
          let lat = 0;
          let lng = 0;
          if (hasRoute) {
            // interpola posição na rota a partir do km relativo
            const rel = meta.direction === "asc" ? km - meta.startKm : meta.startKm - km;
            // pequeno helper inline: pega ponto mais próximo do cum
            let bestIdx = 0;
            let bestDiff = Infinity;
            for (let j = 0; j < cum.length; j++) {
              const d = Math.abs(cum[j] - rel);
              if (d < bestDiff) {
                bestDiff = d;
                bestIdx = j;
              }
            }
            lat = polyline[bestIdx]?.[0] ?? 0;
            lng = polyline[bestIdx]?.[1] ?? 0;
          }
          newManuals.push({
            id: `imp-${Date.now()}-${i}`,
            km,
            lat,
            lng,
            label: row.descricao,
          });
        }
      });

      setDescriptions((d) => ({ ...d, ...descPatch }));
      if (newManuals.length > 0) commitManuals((arr) => [...arr, ...newManuals]);

      // Se não há rota, ajusta limites do projeto pelo que foi importado
      if (!hasRoute && Number.isFinite(minKm) && Number.isFinite(maxKm)) {
        setMeta((m) => ({
          ...m,
          startKm: Math.min(m.startKm, minKm),
          endKm: Math.max(m.endKm, maxKm),
        }));
      }

      toast.success(
        `${imported.length} linha(s) importada(s). ${newManuals.length} viraram pontos manuais.`,
      );
    } catch (err) {
      toast.error(`Falha ao importar: ${(err as Error).message}`);
    }
  }


  // Linhas finais para tabela/export
  type UiRow = { km: number; descricao: string; kind: "auto" | "manual"; id?: string };
  const rows = useMemo<UiRow[]>(() => {
    const auto: UiRow[] = kmMarkers.map((m) => ({
      km: m.km,
      descricao: descriptions[`km-${m.km}`] ?? "",
      kind: "auto",
    }));
    const manualRows: UiRow[] = manuals.map((m) => ({
      km: m.km,
      descricao: m.label,
      kind: "manual",
      id: m.id,
    }));
    return [...auto, ...manualRows].sort((a, b) =>
      meta.direction === "asc" ? a.km - b.km : b.km - a.km,
    );
  }, [kmMarkers, manuals, descriptions, meta.direction]);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-white/10 bg-slate-900/60 px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="inline-flex items-center gap-1 text-sm text-white/60 hover:text-white">
              <ArrowLeft className="h-4 w-4" /> Conversor
            </Link>
            <span className="text-white/30">/</span>
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <RouteIcon className="h-5 w-5 text-purple-400" />
              Editor de Projeto de Pista
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-cyan-400/40 bg-cyan-500/10 px-3 text-xs font-medium text-cyan-200 hover:bg-cyan-500/20">
              <Upload className="mr-1 h-4 w-4" /> Importar CSV/Excel
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  void handleImport(f);
                  e.target.value = "";
                }}
              />
            </label>

            <Button size="sm" variant="secondary" onClick={() => exportExcel(meta, rows)} disabled={rows.length === 0}>
              <FileSpreadsheet className="mr-1 h-4 w-4" /> Excel
            </Button>
            <Button size="sm" variant="secondary" onClick={() => exportCsv(meta, rows)} disabled={rows.length === 0}>
              <FileDown className="mr-1 h-4 w-4" /> CSV
            </Button>
            <Button size="sm" variant="secondary" onClick={() => exportPdfTable(meta, rows)} disabled={rows.length === 0}>
              <FileText className="mr-1 h-4 w-4" /> PDF tabela
            </Button>
            <select
              value={kmFormat}
              onChange={(e) => setKmFormat(e.target.value as KmLabelFormat)}
              className="h-9 rounded-md border border-white/10 bg-slate-800 px-2 text-xs text-white"
              title="Formato do rótulo do km nas placas"
            >
              <option value="padded">km 012 (3 dígitos)</option>
              <option value="integer">km 12 (inteiro)</option>
              <option value="decimal1">km 12,3 (1 decimal)</option>
              <option value="decimal3">km 12,345 (3 decimais)</option>
            </select>
            <Button size="sm" variant="secondary" onClick={() => exportPdfPlacas(meta, rows, "single", kmFormat)} disabled={rows.length === 0}>
              <FileText className="mr-1 h-4 w-4" /> PDF placas
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const blob = exportPdfPlacas(meta, rows, "grid", kmFormat, bothLayout, "blob", gridLayout, pageFormat, pageOrientation) as Blob | undefined;
                if (blob) {
                  setPreviewBlob(blob);
                  setPreviewOpen(true);
                }
              }}
              disabled={rows.length === 0}
            >
              <FileText className="mr-1 h-4 w-4" /> PDF placas (grid)
            </Button>
            <Button size="sm" onClick={() => exportPdfPlacas(meta, rows, "both", kmFormat, bothLayout)} disabled={rows.length === 0}>
              <FileText className="mr-1 h-4 w-4" /> PDF placas (2 lados)
            </Button>
            <Button size="sm" variant="secondary" onClick={() => exportPlacasLadosExcel(meta, rows)} disabled={rows.length === 0}>
              <FileSpreadsheet className="mr-1 h-4 w-4" /> Excel km esq/dir
            </Button>
            <Button size="sm" variant="secondary" onClick={() => exportPlacasLadosCsv(meta, rows)} disabled={rows.length === 0}>
              <FileSpreadsheet className="mr-1 h-4 w-4" /> CSV km esq/dir
            </Button>

          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-[360px_1fr]">
        {/* Painel cabeçalho */}
        <aside className="space-y-4 rounded-lg border border-white/10 bg-slate-900/40 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white/60">
            Dados do projeto
          </h2>

          <div className="space-y-1">
            <Label>Rodovia</Label>
            <Input
              value={meta.name}
              onChange={(e) => setMeta({ ...meta, name: e.target.value })}
              placeholder="SP-261"
            />
          </div>

          <div className="space-y-1">
            <Label>Sentido</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={meta.direction === "asc" ? "default" : "outline"}
                onClick={() => setMeta({ ...meta, direction: "asc" })}
              >
                ↑ Crescente
              </Button>
              <Button
                variant={meta.direction === "desc" ? "default" : "outline"}
                onClick={() => setMeta({ ...meta, direction: "desc" })}
              >
                ↓ Decrescente
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Km inicial</Label>
              <Input
                type="number"
                step="0.001"
                value={meta.startKm}
                onChange={(e) => setMeta({ ...meta, startKm: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Km final</Label>
              <Input
                type="number"
                step="0.001"
                value={meta.endKm}
                onChange={(e) => setMeta({ ...meta, endKm: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Passo (km)</Label>
            <Input
              type="number"
              step="0.1"
              min="0.1"
              value={meta.step}
              onChange={(e) => setMeta({ ...meta, step: Math.max(0.001, Number(e.target.value)) })}
            />
          </div>

          <div className="rounded border border-white/10 bg-black/30 p-3 text-xs text-white/70">
            <div>Rota traçada: <b className="text-cyan-300">{total.toFixed(3)} km</b></div>
            <div>Marcadores automáticos: <b>{kmMarkers.length}</b></div>
            <div>Pontos manuais: <b>{manuals.length}</b></div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Button size="sm" variant={mode === "start" ? "default" : "outline"} onClick={() => setMode("start")}>
              <MapPin className="mr-1 h-3 w-3" /> Início
            </Button>
            <Button size="sm" variant={mode === "end" ? "default" : "outline"} onClick={() => setMode("end")}>
              <MapPin className="mr-1 h-3 w-3" /> Fim
            </Button>
            <Button size="sm" variant={mode === "manual" ? "default" : "outline"} onClick={() => setMode("manual")}>
              <Plus className="mr-1 h-3 w-3" /> Ponto
            </Button>
          </div>

          <Button variant="destructive" size="sm" className="w-full" onClick={resetAll}>
            <Trash2 className="mr-1 h-4 w-4" /> Limpar projeto
          </Button>

          <details className="rounded border border-white/10 bg-black/30 p-3 text-xs">
            <summary className="cursor-pointer font-semibold uppercase tracking-wider text-white/60">
              Layout PDF placas (2 lados)
            </summary>
            <div className="mt-3 space-y-2">
              {([
                ["plateW", "Largura placa (mm)", 40, 140, 1],
                ["plateH", "Altura placa (mm)", 40, 200, 1],
                ["gap", "Espaçamento entre placas (mm)", 0, 80, 1],
                ["marginTop", "Margem superior (mm)", 10, 120, 1],
                ["marginX", "Margem lateral (mm, 0 = centralizar)", 0, 80, 1],
              ] as const).map(([key, label, min, max, step]) => (
                <div key={key} className="space-y-1">
                  <Label className="text-[11px] text-white/70">
                    {label}: <span className="text-cyan-300">{bothLayout[key]}</span>
                  </Label>
                  <Input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={bothLayout[key]}
                    onChange={(e) =>
                      setBothLayout((l) => ({ ...l, [key]: Number(e.target.value) }))
                    }
                  />
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => setBothLayout(DEFAULT_BOTH_LAYOUT)}
              >
                Restaurar padrão
              </Button>
            </div>
          </details>

          <details className="rounded border border-white/10 bg-black/30 p-3 text-xs">
            <summary className="cursor-pointer font-semibold uppercase tracking-wider text-white/60">
              Layout PDF placas (grid)
            </summary>
            <div className="mt-3 space-y-2">
              {([
                ["cols", "Colunas", 1, 6, 1],
                ["rows", "Linhas", 1, 8, 1],
                ["marginX", "Margem lateral (mm)", 0, 40, 1],
                ["marginTop", "Margem superior (mm)", 0, 60, 1],
                ["marginBottom", "Margem inferior (mm)", 0, 40, 1],
                ["gap", "Espaçamento entre placas (mm)", 0, 30, 1],
              ] as const).map(([key, label, min, max, step]) => (
                <div key={key} className="space-y-1">
                  <Label className="text-[11px] text-white/70">
                    {label}: <span className="text-cyan-300">{gridLayout[key]}</span>
                  </Label>
                  <Input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={gridLayout[key]}
                    onChange={(e) =>
                      setGridLayout((l) => ({ ...l, [key]: Number(e.target.value) }))
                    }
                  />
                </div>
              ))}
              <p className="text-[10px] text-white/40">
                {gridLayout.cols * gridLayout.rows} placa(s) por página
              </p>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => setGridLayout(DEFAULT_GRID_LAYOUT)}
              >
                Restaurar padrão
              </Button>
            </div>
          </details>
        </aside>


        {/* Mapa + tabela */}
        <section className="space-y-4">
          {mounted ? (
            <Suspense fallback={<div className="h-[480px] animate-pulse rounded-lg bg-white/5" />}>
              <RouteMap
                start={start}
                end={end}
                polyline={polyline}
                kmMarkers={kmMarkers.map((m, i) => ({ ...m, km: Number(m.km.toFixed(3)) || i }))}
                manualPoints={manuals}
                mode={mode}
                onClick={handleMapClick}
                onUpdatePoint={(id, patch) =>
                  commitManuals((arr) => arr.map((x) => (x.id === id ? { ...x, ...patch } : x)))
                }
                onRemovePoint={(id) => commitManuals((arr) => arr.filter((x) => x.id !== id))}
                onMovePoint={(id, ll) => {
                  // Recalcula km a cada movimento, ancorando o pino ao traçado.
                  liveManuals(id, (arr) =>
                    arr.map((x) => {
                      if (x.id !== id) return x;
                      if (polyline.length < 2) {
                        return { ...x, lat: ll.lat, lng: ll.lng };
                      }
                      const snap = nearestOnRoute(polyline, cum, ll);
                      const km =
                        meta.direction === "asc"
                          ? meta.startKm + snap.km
                          : meta.startKm - snap.km;
                      return { ...x, lat: snap.lat, lng: snap.lng, km };
                    }),
                  );
                  setKmErrors((e) => {
                    if (!(id in e)) return e;
                    const { [id]: _, ...rest } = e;
                    return rest;
                  });
                  setKmDrafts((d) => {
                    if (!(id in d)) return d;
                    const { [id]: _, ...rest } = d;
                    return rest;
                  });
                }}
                onMovePointEnd={endLive}
              />
            </Suspense>

          ) : (
            <div className="h-[480px] rounded-lg border border-white/10 bg-white/5" />
          )}

          {loading && <div className="text-sm text-cyan-300">Calculando rota…</div>}

          {/* Pontos manuais editáveis */}
          {manuals.length > 0 && (
            <div className="rounded-lg border border-white/10 bg-slate-900/40 p-4">
              <h3 className="mb-2 text-sm font-semibold uppercase text-white/60">Pontos manuais</h3>
              <div className="space-y-2">
                {manuals.map((m) => {
                  const err = kmErrors[m.id];
                  return (
                    <div key={m.id} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          step="0.001"
                          className={`w-24 font-mono text-xs ${err ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                          value={kmDrafts[m.id] ?? String(m.km)}
                          onChange={(e) => commitManualKm(m.id, e.target.value)}
                          onBlur={() => {
                            if (!kmErrors[m.id]) setKmDrafts((d) => { const { [m.id]: _, ...rest } = d; return rest; });
                          }}
                          aria-invalid={!!err}
                          title="km do ponto"
                        />
                        <Input
                          className="flex-1"
                          value={m.label}
                          onChange={(e) =>
                            commitManuals((arr) => arr.map((x) => (x.id === m.id ? { ...x, label: e.target.value } : x)))
                          }
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            commitManuals((arr) => arr.filter((x) => x.id !== m.id));
                            setKmDrafts((d) => { const { [m.id]: _, ...rest } = d; return rest; });
                            setKmErrors((e) => { const { [m.id]: _, ...rest } = e; return rest; });
                          }}
                          title="Remover ponto manual"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      {err && <p className="text-xs text-red-400">{err}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tabela de estaqueamento */}
          <div className="overflow-auto rounded-lg border border-white/10 bg-slate-900/40">
            <table className="w-full text-sm">
              <thead className="bg-black/40 text-xs uppercase text-white/60">
                <tr>
                  <th className="px-3 py-2 text-left">Km</th>
                  <th className="px-3 py-2 text-left">Estaca</th>
                  <th className="px-3 py-2 text-left">Exc. (m)</th>
                  <th className="px-3 py-2 text-left">Hm</th>
                  {DISTANCE_UNITS.slice(0, 3).map((u) => (
                    <th key={u.key} className="px-3 py-2 text-left">{u.suffix}</th>
                  ))}
                  <th className="px-3 py-2 text-left">Descrição</th>
                  <th className="px-3 py-2 text-left w-10"></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-white/40">
                      Marque o início e o fim no mapa para gerar o estaqueamento.
                    </td>
                  </tr>
                )}
                {rows.map((r, i) => {
                  const der = kmToDer(Math.abs(r.km));
                  const isManual = r.kind === "manual";
                  return (
                    <tr key={i} className={`border-t border-white/5 hover:bg-white/5 ${isManual ? "bg-cyan-500/5" : ""}`}>
                      <td className="px-3 py-2 font-mono">
                        {isManual && r.id ? (
                          <div className="space-y-1">
                            <Input
                              type="number"
                              step="0.001"
                              className={`h-7 w-24 text-xs font-mono ${kmErrors[r.id] ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                              value={kmDrafts[r.id] ?? String(r.km)}
                              onChange={(e) => commitManualKm(r.id!, e.target.value)}
                              aria-invalid={!!kmErrors[r.id]}
                            />
                            {kmErrors[r.id] && (
                              <p className="text-[10px] leading-tight text-red-400">{kmErrors[r.id]}</p>
                            )}
                          </div>
                        ) : (
                          formatKm(r.km)
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono">{der.estacas}</td>
                      <td className="px-3 py-2 font-mono">{der.extra.toFixed(2)}</td>
                      <td className="px-3 py-2 font-mono">{kmToHectometros(Math.abs(r.km)).toFixed(2)}</td>
                      {DISTANCE_UNITS.slice(0, 3).map((u) => (
                        <td key={u.key} className="px-3 py-2 font-mono">{(r.km * u.factor).toFixed(2)}</td>
                      ))}
                      <td className="px-3 py-2">
                        <Input
                          className="h-7 text-xs"
                          value={r.descricao}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (isManual && r.id) {
                              commitManuals((arr) => arr.map((x) => (x.id === r.id ? { ...x, label: v } : x)));
                            } else {
                              setDescriptions((d) => ({ ...d, [`km-${r.km}`]: v }));
                            }
                          }}
                          placeholder="ex.: ponte, placa A-1a…"
                        />
                      </td>
                      <td className="px-3 py-2">
                        {isManual && r.id && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => commitManuals((arr) => arr.filter((x) => x.id !== r.id))}
                            title="Remover ponto manual"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
      <PdfPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        blob={previewBlob}
        filename={`${(meta.name || "projeto").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-placas-grid.pdf`}
        title="Pré-visualização — PDF placas (grid)"
      />
    </div>
  );
}
