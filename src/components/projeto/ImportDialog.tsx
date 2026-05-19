// Diálogo de importação: aceita .dxf e .txt/.csv, deixa o usuário escolher
// o SRC, mapear o formato do TXT, e preview básico (contagem + bbox).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_THRESHOLDS,
  detectDecimalSeparator,
  detectTxtPresetVerbose,
  parseDxf,
  parseTopoTxt,
  TXT_PRESETS,
  type DetectionResult,
  type DetectionThresholds,
  type ImportedDataset,
  type TxtFormat,
} from "@/lib/projeto/importers";
import { LOCAL_SRS, SRS_OPTIONS, looksLikeLatLng, looksLikeUTM, toLatLng, validateSrsBbox } from "@/lib/projeto/srs";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

export type OverlayFeature = {
  id: string;
  source: string;
  kind: "dxf" | "topo-txt";
  /** Polilinhas em [lat,lng]. */
  polylines: [number, number][][];
  /** Pontos em [lat,lng] + rótulo opcional. */
  points: Array<{ lat: number; lng: number; label?: string }>;
  /** Offset aplicado em metros (usado no modo arrastar). */
  offset?: { dx: number; dy: number };
  /** Estilo visual ajustável (cor/espessura/opacidade). */
  style?: { color: string; weight: number; opacity: number };
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (overlay: OverlayFeature) => void;
  /** Recebe eventos de log do pipeline (lendo/convertendo/desenhando…) p/ exibir no mapa. */
  onStatus?: (msg: string, level?: "info" | "ok" | "warn" | "error") => void;
};

export function ImportDialog({ open, onOpenChange, onImport, onStatus }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ImportedDataset | null>(null);
  const [busy, setBusy] = useState(false);
  const [srs, setSrs] = useState("EPSG:31983");
  const [presetName, setPresetName] = useState<keyof typeof TXT_PRESETS>("PENZD (P,E,N,Z,D)");
  const [skipHeader, setSkipHeader] = useState(0);
  const [decimal, setDecimal] = useState<"." | ",">(".");
  const [thresholds, setThresholds] = useState<DetectionThresholds>(DEFAULT_THRESHOLDS);
  const [autoApply, setAutoApply] = useState(true);
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [decimalInfo, setDecimalInfo] = useState<{
    decimal: "." | ",";
    confidence: "high" | "low";
    comma: number;
    dot: number;
  } | null>(null);

  // Reseta o estado ao fechar.
  useEffect(() => {
    if (!open) {
      setFile(null);
      setParsed(null);
      setBusy(false);
    }
  }, [open]);

  // Amostra bruta das primeiras linhas do TXT (texto cru, para preview de colunas).
  const [rawSample, setRawSample] = useState<string[]>([]);

  const isDxf = file?.name.toLowerCase().endsWith(".dxf");
  const isTxt =
    file && (file.name.toLowerCase().endsWith(".txt") || file.name.toLowerCase().endsWith(".csv"));

  const txtFormat: TxtFormat = useMemo(
    () => ({
      ...TXT_PRESETS[presetName],
      skipHeaderLines: skipHeader,
      decimal,
    }),
    [presetName, skipHeader, decimal],
  );

  // Lê as primeiras linhas crus do TXT para alimentar o preview de mapeamento.
  useEffect(() => {
    if (!file || !isTxt) {
      setRawSample([]);
      return;
    }
    let cancelled = false;
    file.text().then((txt) => {
      if (cancelled) return;
      const lines = txt
        .split(/\r?\n/)
        .slice(skipHeader)
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 5);
      setRawSample(lines);
    });
    return () => {
      cancelled = true;
    };
  }, [file, isTxt, skipHeader]);

  // Mapeia cada linha de amostra nas colunas declaradas pelo preset.
  const previewRows = useMemo(() => {
    if (rawSample.length === 0) return [];
    const first = rawSample[0];
    const sep =
      first.includes("\t") ? /\t/
        : first.includes(";") ? /;/
        : first.includes(",") ? /,/
        : /\s+/;
    return rawSample.map((line) => {
      const parts = line.split(sep).map((s) => s.trim()).filter(Boolean);
      const mapped: Record<string, string> = {};
      txtFormat.order.forEach((key, i) => {
        if (key === "skip") return;
        mapped[key] = parts[i] ?? "";
      });
      // Junta tudo que sobrou em "D" caso o preset tenha menos colunas que a linha
      if (parts.length > txtFormat.order.length && txtFormat.order.includes("D")) {
        const extras = parts.slice(txtFormat.order.length).join(" ");
        mapped["D"] = `${mapped["D"] ?? ""}${mapped["D"] ? " " : ""}${extras}`.trim();
      }
      return mapped;
    });
  }, [rawSample, txtFormat]);

  // Detecta SRS automaticamente quando há dataset carregado.
  useEffect(() => {
    if (!parsed) return;
    const p = parsed.points[0] || parsed.polylines[0]?.coords[0];
    if (!p) return;
    const x = "x" in p ? p.x : 0;
    const y = "y" in p ? p.y : 0;
    if (looksLikeLatLng(x, y)) setSrs("EPSG:4326");
    else if (looksLikeUTM(x, y)) {
      // mantém o SRS atual se já é UTM Sul; caso contrário sugere SIRGAS 23S
      if (!srs.startsWith("EPSG:3198") && !srs.startsWith("EPSG:2919") && !srs.startsWith("EPSG:2252") && !srs.startsWith("EPSG:3272")) {
        setSrs("EPSG:31983");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed]);

  const log = useCallback(
    (msg: string, level: "info" | "ok" | "warn" | "error" = "info") => onStatus?.(msg, level),
    [onStatus],
  );

  const handleParse = async (f: File) => {
    setBusy(true);
    try {
      log(`Lendo arquivo "${f.name}" (${Math.round(f.size / 1024)} KB)…`);
      const isDxfFile = f.name.toLowerCase().endsWith(".dxf");
      log(isDxfFile ? "Interpretando entidades DXF…" : "Interpretando pontos topográficos…");
      const ds = isDxfFile ? await parseDxf(f) : await parseTopoTxt(f, txtFormat);
      log(
        `Parse OK: ${ds.polylines.length} polilinha(s), ${ds.points.length} ponto(s).`,
        "ok",
      );
      if (ds.points.length === 0 && ds.polylines.length === 0) {
        log("Nenhuma geometria encontrada — verifique formato/separador/cabeçalho.", "warn");
      }
      setParsed(ds);
    } catch (err) {
      const m = err instanceof Error ? err.message : "Falha ao ler o arquivo.";
      toast.error(m);
      log(`Falha na leitura: ${m}`, "error");
    } finally {
      setBusy(false);
    }
  };

  // Re-parse do TXT quando o usuário troca formato/cabeçalho.
  useEffect(() => {
    if (file && isTxt) handleParse(file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetName, skipHeader, decimal]);

  const handleFile = async (f: File | null) => {
    setFile(f);
    setParsed(null);
    setDetection(null);
    setDecimalInfo(null);
    if (!f) return;
    const isTxtFile = f.name.toLowerCase().endsWith(".txt") || f.name.toLowerCase().endsWith(".csv");
    if (isTxtFile) {
      // 1) Detecta o separador decimal (vírgula vs ponto) antes de qualquer parse,
      //    para evitar erros silenciosos (ex.: "7.534,21" lido como 7.534).
      let effectiveDecimal: "." | "," = decimal;
      try {
        log("Detectando separador decimal (vírgula vs ponto)…");
        const dec = await detectDecimalSeparator(f, skipHeader);
        setDecimalInfo({
          decimal: dec.decimal,
          confidence: dec.confidence,
          comma: dec.stats.comma,
          dot: dec.stats.dot,
        });
        const tag = dec.confidence === "high" ? "alta confiança" : "baixa confiança";
        if (dec.confidence === "high" && dec.decimal !== decimal) {
          setDecimal(dec.decimal);
          effectiveDecimal = dec.decimal;
          toast.info(`Decimal detectado: "${dec.decimal}" (${tag})`);
          log(
            `Decimal detectado: "${dec.decimal}" — vírgulas=${dec.stats.comma}, pontos=${dec.stats.dot} (${tag}).`,
            "ok",
          );
        } else {
          log(
            `Decimal: "${dec.decimal}" — vírgulas=${dec.stats.comma}, pontos=${dec.stats.dot} (${tag}).`,
            dec.confidence === "high" ? "ok" : "warn",
          );
        }
      } catch {
        log("Detecção do decimal falhou — usando o atual.", "warn");
      }

      try {
        log(
          `Detectando formato (min=${thresholds.minSamples}, ratio=${thresholds.ratio.toFixed(2)}, margem=${thresholds.margin})…`,
        );
        const result = await detectTxtPresetVerbose(f, effectiveDecimal, skipHeader, thresholds);
        setDetection(result);
        if (result) {
          const tag = result.confidence === "high" ? "alta confiança" : "baixa confiança";
          if (result.columnCheck?.promoted) {
            log(
              `Consistência por coluna (${result.columnCheck.rangeLabel}) promoveu confiança para ALTA.`,
              "ok",
            );
          }
          if (result.confidence === "high" && result.preset !== presetName) {
            if (autoApply) {
              setPresetName(result.preset);
              toast.info(`Formato detectado: ${result.preset} (${tag})`);
              log(`Formato auto-aplicado: ${result.preset} (${tag})`, "ok");
              return;
            }
            log(
              `Sugestão (auto-aplicar desativado): ${result.preset} (${tag}). Mantido "${presetName}".`,
              "warn",
            );
          } else if (result.confidence === "high") {
            log(`Formato confirmado: ${result.preset} (${tag})`, "ok");
          } else {
            // Não sobrescreve quando incerto — apenas sugere ao usuário.
            log(
              `Sugestão: ${result.preset} (${tag}). Mantido "${presetName}" — confira a prévia ou afrouxe os limiares.`,
              "warn",
            );
          }
        }
      } catch {
        log("Detecção automática falhou — usando formato atual.", "warn");
      }
    }
    handleParse(f);
  };

  const handleConfirm = () => {
    if (!parsed) return;
    const polylines: [number, number][][] = [];
    const points: OverlayFeature["points"] = [];
    try {
      log(`Convertendo coordenadas (${srs}) → WGS84…`);
      for (const pl of parsed.polylines) {
        polylines.push(pl.coords.map((v) => {
          const ll = toLatLng(srs, v.x, v.y);
          return [ll.lat, ll.lng] as [number, number];
        }));
      }
      for (const p of parsed.points) {
        const ll = toLatLng(srs, p.x, p.y);
        points.push({ lat: ll.lat, lng: ll.lng, label: p.label });
      }
      log(`Conversão OK: ${polylines.length} polilinha(s), ${points.length} ponto(s).`, "ok");
    } catch (err) {
      toast.error("Falha ao reprojetar coordenadas. Verifique o SRC selecionado.");
      log(`Falha na conversão: ${err instanceof Error ? err.message : String(err)}`, "error");
      console.error(err);
      return;
    }
    const overlay: OverlayFeature = {
      id: `ov-${Date.now()}`,
      source: parsed.source,
      kind: parsed.kind,
      polylines,
      points,
      style: { color: "#34d399", weight: 2.5, opacity: 0.9 },
    };
    log("Desenhando no mapa…");
    onImport(overlay);
    onOpenChange(false);
    log(
      `${parsed.kind === "dxf" ? "Desenho" : "Pontos"} importado com sucesso.`,
      "ok",
    );
    toast.success(
      `${parsed.kind === "dxf" ? "Desenho" : "Pontos"} importado: ${
        polylines.length
      } polilinha(s), ${points.length} ponto(s).`,
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Importar desenho ou pontos topográficos</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Arquivo</Label>
            <Input
              type="file"
              accept=".dxf,.txt,.csv"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-white/50">
              Aceita <b>.dxf</b> (Civil 3D/AutoCAD ASCII) e <b>.txt/.csv</b> de estação total ou GNSS.
              Para .dwg, exporte como DXF no Civil 3D primeiro.
            </p>
          </div>

          {isTxt && (
            <div className="grid grid-cols-2 gap-3 rounded border border-white/10 bg-black/30 p-3">
              <div className="col-span-2 space-y-1">
                <Label>Formato</Label>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value as keyof typeof TXT_PRESETS)}
                >
                  {Object.keys(TXT_PRESETS).map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Linhas de cabeçalho</Label>
                <Input
                  type="number"
                  min={0}
                  value={skipHeader}
                  onChange={(e) => setSkipHeader(Math.max(0, Number(e.target.value)))}
                />
              </div>
              <div className="space-y-1">
                <Label>Decimal</Label>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={decimal}
                  onChange={(e) => setDecimal(e.target.value as "." | ",")}
                >
                  <option value=".">Ponto (1234.56)</option>
                  <option value=",">Vírgula (1234,56)</option>
                </select>
              </div>
            </div>
          )}

          {isTxt && (
            <details className="rounded border border-white/10 bg-black/30 p-3 text-xs">
              <summary className="cursor-pointer select-none text-white/70">
                Limiares da detecção automática{" "}
                <span className="ml-1 text-white/40">
                  (min={thresholds.minSamples} · ratio={thresholds.ratio.toFixed(2)} · margem=
                  {thresholds.margin}{autoApply ? "" : " · auto-aplicar OFF"})
                </span>
              </summary>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px]">Mín. amostras</Label>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={thresholds.minSamples}
                    onChange={(e) =>
                      setThresholds((t) => ({
                        ...t,
                        minSamples: Math.max(1, Number(e.target.value) || 1),
                      }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Ratio (0–1)</Label>
                  <Input
                    type="number"
                    min={0.5}
                    max={1}
                    step={0.05}
                    value={thresholds.ratio}
                    onChange={(e) =>
                      setThresholds((t) => ({
                        ...t,
                        ratio: Math.min(1, Math.max(0.5, Number(e.target.value) || 0.75)),
                      }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Margem mín.</Label>
                  <Input
                    type="number"
                    min={0}
                    max={20}
                    value={thresholds.margin}
                    onChange={(e) =>
                      setThresholds((t) => ({
                        ...t,
                        margin: Math.max(0, Number(e.target.value) || 0),
                      }))
                    }
                  />
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-white/80">
                  <input
                    type="checkbox"
                    checked={autoApply}
                    onChange={(e) => setAutoApply(e.target.checked)}
                  />
                  Auto-aplicar preset quando confiança = alta
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px]"
                  onClick={() => {
                    setThresholds(DEFAULT_THRESHOLDS);
                    setAutoApply(true);
                  }}
                >
                  Restaurar padrão
                </Button>
              </div>
              <p className="mt-2 text-[10px] text-white/40">
                Mais rígido (ratio↑, margem↑) = só auto-aplica quando tem certeza. Mais permissivo
                (valores↓) = aplica mesmo em arquivos pequenos ou ambíguos.
              </p>
            </details>
          )}

          {isTxt && (detection || decimalInfo) && (
            <div className="rounded border border-white/10 bg-black/30 p-3 text-[11px] text-white/80">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider text-white/60">
                  Estatísticas da detecção
                </span>
                {detection && (
                  <span
                    className={`rounded px-2 py-0.5 font-mono text-[10px] ${
                      detection.confidence === "high"
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-amber-500/15 text-amber-300"
                    }`}
                  >
                    {detection.confidence === "high" ? "ALTA confiança" : "BAIXA confiança"}
                  </span>
                )}
              </div>

              {decimalInfo && (
                <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 font-mono">
                  <span>
                    Decimal:{" "}
                    <b className="text-cyan-300">"{decimalInfo.decimal}"</b>{" "}
                    <span className="text-white/40">({decimalInfo.confidence})</span>
                  </span>
                  <span className="text-white/60">
                    vírgulas={decimalInfo.comma} · pontos={decimalInfo.dot}
                  </span>
                </div>
              )}

              {detection && (
                <>
                  <div className="mb-2 font-mono">
                    Preset sugerido: <b className="text-cyan-300">{detection.preset}</b> ·
                    amostras analisadas: <b>{detection.stats.sampled}</b>{" "}
                    <span className="text-white/40">
                      (com ID: {detection.stats.withId} · sem ID: {detection.stats.withoutId})
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono sm:grid-cols-3">
                    <div>
                      <span className="text-white/50">PNEZD (N&gt;E, com ID):</span>{" "}
                      <b>{detection.stats.aGtB_id}</b>
                    </div>
                    <div>
                      <span className="text-white/50">PENZD (E&gt;N, com ID):</span>{" "}
                      <b>{detection.stats.bGtA_id}</b>
                    </div>
                    <div>
                      <span className="text-white/50">NEZ (N&gt;E, sem ID):</span>{" "}
                      <b>{detection.stats.aGtB_noid}</b>
                    </div>
                    <div>
                      <span className="text-white/50">ENZ (E&gt;N, sem ID):</span>{" "}
                      <b>{detection.stats.bGtA_noid}</b>
                    </div>
                    <div>
                      <span className="text-white/50">GNSS (lat/lng):</span>{" "}
                      <b
                        className={
                          detection.stats.sampled > 0 &&
                          detection.stats.latLngHits / detection.stats.sampled >= 0.8
                            ? "text-emerald-300"
                            : ""
                        }
                      >
                        {detection.stats.latLngHits}
                      </b>
                      <span className="text-white/40">/{detection.stats.sampled}</span>
                    </div>
                  </div>

                  {detection.columnCheck && (
                    <div
                      className={`mt-3 rounded border p-2 text-[11px] ${
                        detection.columnCheck.promoted
                          ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                          : "border-white/10 bg-white/[0.03] text-white/70"
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <span className="font-mono uppercase tracking-wider text-[10px]">
                          Consistência por coluna
                        </span>
                        {detection.columnCheck.promoted && (
                          <span className="rounded bg-emerald-500/20 px-2 py-0.5 font-mono text-[10px]">
                            ↑ promoveu para ALTA
                          </span>
                        )}
                      </div>
                      <div className="font-mono">{detection.columnCheck.rangeLabel}</div>
                      <div className="mt-1 grid grid-cols-2 gap-x-4 font-mono">
                        <span>
                          N na faixa:{" "}
                          <b>
                            {detection.columnCheck.nInRange}/{detection.columnCheck.sampled}
                          </b>{" "}
                          <span className="opacity-60">
                            (disp.{" "}
                            {isFinite(detection.columnCheck.nSpread)
                              ? detection.columnCheck.nSpread.toFixed(1) + "×"
                              : "∞"}
                            )
                          </span>
                        </span>
                        <span>
                          E na faixa:{" "}
                          <b>
                            {detection.columnCheck.eInRange}/{detection.columnCheck.sampled}
                          </b>{" "}
                          <span className="opacity-60">
                            (disp.{" "}
                            {isFinite(detection.columnCheck.eSpread)
                              ? detection.columnCheck.eSpread.toFixed(1) + "×"
                              : "∞"}
                            )
                          </span>
                        </span>
                      </div>
                    </div>
                  )}

                  {detection.topSamples && detection.topSamples.length > 0 && (
                    <details className="mt-3 rounded border border-white/10 bg-white/[0.03] p-2 text-[11px]">
                      <summary className="cursor-pointer select-none text-white/70">
                        Top {detection.topSamples.length} linha
                        {detection.topSamples.length > 1 ? "s" : ""} que mais contribuíram
                      </summary>
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full border-collapse font-mono text-[10.5px]">
                          <thead className="text-left text-cyan-300/80">
                            <tr>
                              <th className="border-b border-white/10 px-2 py-1">#</th>
                              <th className="border-b border-white/10 px-2 py-1">linha</th>
                              <th className="border-b border-white/10 px-2 py-1">N</th>
                              <th className="border-b border-white/10 px-2 py-1">E</th>
                              <th className="border-b border-white/10 px-2 py-1">score</th>
                              <th className="border-b border-white/10 px-2 py-1">motivo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detection.topSamples.map((s, i) => (
                              <tr key={`${s.lineNumber}-${i}`} className="text-white/80 odd:bg-white/[0.02]">
                                <td className="border-b border-white/5 px-2 py-1 text-white/40">
                                  {i + 1}
                                </td>
                                <td className="border-b border-white/5 px-2 py-1 text-white/50">
                                  L{s.lineNumber}
                                </td>
                                <td className="border-b border-white/5 px-2 py-1 text-emerald-300">
                                  {Number.isFinite(s.n) ? s.n.toLocaleString("pt-BR") : "—"}
                                </td>
                                <td className="border-b border-white/5 px-2 py-1 text-emerald-300">
                                  {Number.isFinite(s.e) ? s.e.toLocaleString("pt-BR") : "—"}
                                </td>
                                <td
                                  className={`border-b border-white/5 px-2 py-1 ${
                                    s.score >= 5
                                      ? "text-emerald-300"
                                      : s.score <= 0
                                      ? "text-amber-300"
                                      : ""
                                  }`}
                                >
                                  {s.score.toFixed(1)}
                                </td>
                                <td className="border-b border-white/5 px-2 py-1 text-white/60">
                                  {s.reason}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="mt-1 text-[10px] text-white/40">
                        Score combina aderência à faixa (UTM Sul / lat-lng) e a margem N vs E.
                        Valores altos = linha "puxou" a detecção; valores baixos ou negativos =
                        linha foi contra o preset.
                      </p>
                    </details>
                  )}



                  <p className="mt-2 text-[10px] text-white/40">
                    Limiares atuais: mín={thresholds.minSamples} · ratio=
                    {thresholds.ratio.toFixed(2)} · margem={thresholds.margin}.
                    {detection.confidence === "low" &&
                      !detection.columnCheck?.promoted &&
                      " Para auto-aplicar este preset, afrouxe os limiares acima ou troque manualmente."}
                  </p>

                </>
              )}
            </div>
          )}





          {isTxt && previewRows.length > 0 && (
            <div className="rounded border border-white/10 bg-black/30 p-2">
              <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wider text-white/60">
                <span>Prévia do mapeamento</span>
                <span className="font-mono normal-case text-white/40">
                  {txtFormat.order.filter((k) => k !== "skip").join(" · ")}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse font-mono text-[11px]">
                  <thead>
                    <tr className="text-left text-cyan-300/80">
                      {txtFormat.order
                        .filter((k) => k !== "skip")
                        .map((k, i) => (
                          <th key={`${k}-${i}`} className="border-b border-white/10 px-2 py-1">
                            {(
                              {
                                P: "P (id)",
                                N: "N (norte/lat)",
                                E: "E (leste/lng)",
                                Z: "Z (cota)",
                                D: "D (descrição)",
                              } as Record<string, string>
                            )[k] ?? k}
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, ri) => (
                      <tr key={ri} className="text-white/85 odd:bg-white/[0.02]">
                        {txtFormat.order
                          .filter((k) => k !== "skip")
                          .map((k, ci) => (
                            <td
                              key={`${ri}-${k}-${ci}`}
                              className={`border-b border-white/5 px-2 py-1 ${
                                k === "N" || k === "E" ? "text-emerald-300" : ""
                              } ${k === "D" ? "text-white/60" : ""}`}
                            >
                              {row[k] || <span className="text-white/30">—</span>}
                            </td>
                          ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-[10px] text-white/40">
                Confira se <b className="text-emerald-300">N</b> (norte) é maior que{" "}
                <b className="text-emerald-300">E</b> (leste) — caso contrário, troque o preset
                acima.
              </p>
            </div>
          )}


          <div className="space-y-1">
            <Label>Sistema de coordenadas (SRC)</Label>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={srs}
              onChange={(e) => setSrs(e.target.value)}
            >
              {SRS_OPTIONS.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-white/50">
              SP, RJ, MG → normalmente <b>SIRGAS 2000 / UTM 23S</b>. Detecto automaticamente
              se as coordenadas parecem lat/lng.
            </p>
          </div>

          {parsed && (() => {
            const srsWarning = parsed.bbox ? validateSrsBbox(srs, parsed.bbox) : null;
            const nearZero = parsed.bbox && Math.abs(parsed.bbox.minX) < 1 && Math.abs(parsed.bbox.minY) < 1;
            return (
              <div className="rounded border border-cyan-400/20 bg-cyan-400/5 p-3 text-xs text-white/80">
                <div><b>{parsed.source}</b></div>
                <div>Polilinhas: <b>{parsed.polylines.length}</b> · Pontos: <b>{parsed.points.length}</b></div>
                {parsed.bbox && (
                  <div>
                    Bbox: X [{parsed.bbox.minX.toFixed(2)} → {parsed.bbox.maxX.toFixed(2)}], Y [
                    {parsed.bbox.minY.toFixed(2)} → {parsed.bbox.maxY.toFixed(2)}]
                  </div>
                )}
                {parsed.georef && (
                  <div className="text-amber-300">⚠ {parsed.georef.hint}</div>
                )}
                {nearZero && (
                  <div className="text-amber-300">
                    ⚠ Coordenadas próximas de (0,0) — provavelmente sistema local.
                  </div>
                )}
                {srsWarning && (
                  <div className="mt-2 space-y-2 rounded border border-amber-400/30 bg-amber-400/10 p-2 text-amber-200">
                    <div>⚠ {srsWarning}</div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => setSrs(LOCAL_SRS)}
                      >
                        Usar sistema local
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => setSrs("EPSG:31983")}
                      >
                        Manter UTM 23S mesmo assim
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={!parsed || busy}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
            Importar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
