import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
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
  type LL,
} from "@/lib/projeto/geo";
import {
  exportCsv,
  exportExcel,
  exportPdfPlacas,
  exportPdfTable,
  importSpreadsheet,
  type ProjectMeta,
} from "@/lib/projeto/export";


const RouteMap = lazy(() => import("@/components/projeto/RouteMap"));

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

  // Restaurar do localStorage
  useEffect(() => {
    if (!mounted) return;
    const saved = loadSaved();
    if (saved) {
      setMeta(saved.meta);
      setStart(saved.start);
      setEnd(saved.end);
      setPolyline(saved.polyline);
      setManuals(saved.manuals);
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
      setManuals((arr) => [...arr, { id, km: absKm, lat: latlng.lat, lng: latlng.lng, label: "ponto" }]);
    }
  }

  function resetAll() {
    setStart(null);
    setEnd(null);
    setPolyline([]);
    setManuals([]);
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
      if (newManuals.length > 0) setManuals((arr) => [...arr, ...newManuals]);

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
  const rows = useMemo(() => {
    const auto = kmMarkers.map((m) => ({
      km: m.km,
      descricao: descriptions[`km-${m.km}`] ?? "",
    }));
    const manualRows = manuals.map((m) => ({
      km: m.km,
      descricao: m.label,
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
            <Button size="sm" variant="secondary" onClick={() => exportPdfPlacas(meta, rows, "single")} disabled={rows.length === 0}>
              <FileText className="mr-1 h-4 w-4" /> PDF placas
            </Button>
            <Button size="sm" onClick={() => exportPdfPlacas(meta, rows, "both")} disabled={rows.length === 0}>
              <FileText className="mr-1 h-4 w-4" /> PDF placas (2 lados)
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
                  setManuals((arr) => arr.map((x) => (x.id === id ? { ...x, ...patch } : x)))
                }
                onRemovePoint={(id) => setManuals((arr) => arr.filter((x) => x.id !== id))}
                onMovePoint={(id, ll) => {
                  // recalcula km automaticamente quando arrasta sobre a rota
                  let km: number | undefined;
                  if (polyline.length >= 2) {
                    const k = nearestKm(polyline, cum, ll);
                    km = meta.direction === "asc" ? meta.startKm + k : meta.startKm - k;
                  }
                  setManuals((arr) =>
                    arr.map((x) =>
                      x.id === id
                        ? { ...x, lat: ll.lat, lng: ll.lng, ...(km !== undefined ? { km } : {}) }
                        : x,
                    ),
                  );
                }}
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
                {manuals.map((m) => (
                  <div key={m.id} className="flex items-center gap-2">
                    <span className="w-24 text-xs text-cyan-300">km {formatKm(m.km)}</span>
                    <Input
                      className="flex-1"
                      value={m.label}
                      onChange={(e) =>
                        setManuals((arr) => arr.map((x) => (x.id === m.id ? { ...x, label: e.target.value } : x)))
                      }
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setManuals((arr) => arr.filter((x) => x.id !== m.id))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
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
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-white/40">
                      Marque o início e o fim no mapa para gerar o estaqueamento.
                    </td>
                  </tr>
                )}
                {rows.map((r, i) => {
                  const der = kmToDer(Math.abs(r.km));
                  return (
                    <tr key={i} className="border-t border-white/5 hover:bg-white/5">
                      <td className="px-3 py-2 font-mono">{formatKm(r.km)}</td>
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
                          onChange={(e) =>
                            setDescriptions((d) => ({ ...d, [`km-${r.km}`]: e.target.value }))
                          }
                          placeholder="ex.: ponte, placa A-1a…"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
