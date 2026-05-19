// Diálogo de importação: aceita .dxf e .txt/.csv, deixa o usuário escolher
// o SRC, mapear o formato do TXT, e preview básico (contagem + bbox).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
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
import { Loader2, Maximize2, Minus, Plus, Upload } from "lucide-react";
import { toast } from "sonner";

/**
 * Mini visualizador SVG dos pontos/polilinhas importadas, com zoom e reset
 * para inspecionar arquivos grandes sem precisar abrir no mapa.
 */
function PreviewCanvas({ parsed }: { parsed: ImportedDataset }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const bbox = parsed.bbox;
  const W = 560;
  const H = 280;
  const PAD = 12;

  const transform = useMemo(() => {
    if (!bbox) return null;
    const dx = bbox.maxX - bbox.minX || 1;
    const dy = bbox.maxY - bbox.minY || 1;
    const innerW = W - PAD * 2;
    const innerH = H - PAD * 2;
    const scale = Math.min(innerW / dx, innerH / dy);
    const cx = (bbox.minX + bbox.maxX) / 2;
    const cy = (bbox.minY + bbox.maxY) / 2;
    return (x: number, y: number): [number, number] => {
      const px = W / 2 + (x - cx) * scale;
      // inverte Y (norte para cima)
      const py = H / 2 - (y - cy) * scale;
      return [px, py];
    };
  }, [bbox]);

  if (!bbox || !transform) {
    return (
      <div className="grid h-32 place-items-center rounded border border-white/10 bg-black/40 text-xs text-white/40">
        Sem coordenadas para pré-visualizar
      </div>
    );
  }

  // viewBox responde ao zoom/pan: quanto maior o zoom, menor a área visível.
  const vw = W / zoom;
  const vh = H / zoom;
  const vx = (W - vw) / 2 - pan.x / zoom;
  const vy = (H - vh) / 2 - pan.y / zoom;

  const reset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div className="relative mt-2 overflow-hidden rounded border border-white/10 bg-black/60">
      <svg
        viewBox={`${vx} ${vy} ${vw} ${vh}`}
        width="100%"
        height={H}
        className="block touch-none select-none"
        onWheel={(e) => {
          e.preventDefault();
          const factor = e.deltaY > 0 ? 0.85 : 1.18;
          setZoom((z) => Math.max(0.5, Math.min(40, z * factor)));
        }}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          dragRef.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          if (!dragRef.current) return;
          const dx = e.clientX - dragRef.current.x;
          const dy = e.clientY - dragRef.current.y;
          dragRef.current = { x: e.clientX, y: e.clientY };
          setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        style={{ cursor: dragRef.current ? "grabbing" : "grab" }}
      >
        {parsed.polylines.map((pl, i) => {
          const pts = pl.coords
            .map((c) => {
              const [px, py] = transform(c.x, c.y);
              return `${px},${py}`;
            })
            .join(" ");
          return (
            <polyline
              key={`pl-${i}`}
              points={pts}
              fill="none"
              stroke="#22d3ee"
              strokeWidth={1.2 / zoom}
              opacity={0.85}
            />
          );
        })}
        {parsed.points.map((p, i) => {
          const [px, py] = transform(p.x, p.y);
          return (
            <circle
              key={`pt-${i}`}
              cx={px}
              cy={py}
              r={Math.max(0.6, 1.6 / zoom)}
              fill="#a855f7"
            />
          );
        })}
      </svg>

      <div className="absolute right-2 top-2 flex gap-1">
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(40, z * 1.4))}
          className="grid h-7 w-7 place-items-center rounded bg-black/70 text-white/80 hover:bg-black/90"
          title="Mais zoom"
          aria-label="Mais zoom"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(0.5, z / 1.4))}
          className="grid h-7 w-7 place-items-center rounded bg-black/70 text-white/80 hover:bg-black/90"
          title="Menos zoom"
          aria-label="Menos zoom"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={reset}
          className="grid h-7 w-7 place-items-center rounded bg-black/70 text-white/80 hover:bg-black/90"
          title="Enquadrar tudo"
          aria-label="Enquadrar tudo"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="absolute bottom-1 left-2 font-mono text-[10px] text-white/40">
        zoom {zoom.toFixed(1)}× · arraste para mover · roda para zoom
      </div>
    </div>
  );
}

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
  const [progress, setProgress] = useState<{ value: number; label: string } | null>(null);
  const setStage = useCallback((value: number, label: string) => {
    setProgress({ value: Math.max(0, Math.min(100, value)), label });
  }, []);
  const [srs, setSrs] = useState("EPSG:31983");
  const [presetName, setPresetName] = useState<keyof typeof TXT_PRESETS>("PENZD (P,E,N,Z,D)");
  const [skipHeader, setSkipHeader] = useState(0);
  const [decimal, setDecimal] = useState<"." | ",">(".");
  const [thresholds, setThresholds] = useState<DetectionThresholds>(() => {
    if (typeof window === "undefined") return DEFAULT_THRESHOLDS;
    try {
      const raw = window.localStorage.getItem("import.thresholds");
      if (!raw) return DEFAULT_THRESHOLDS;
      const parsed = JSON.parse(raw);
      return {
        minSamples:
          typeof parsed.minSamples === "number" ? parsed.minSamples : DEFAULT_THRESHOLDS.minSamples,
        ratio: typeof parsed.ratio === "number" ? parsed.ratio : DEFAULT_THRESHOLDS.ratio,
        margin: typeof parsed.margin === "number" ? parsed.margin : DEFAULT_THRESHOLDS.margin,
      };
    } catch {
      return DEFAULT_THRESHOLDS;
    }
  });
  /**
   * Política de auto-aplicação do preset detectado:
   *   - "off":  nunca sobrescreve o preset atual (apenas loga sugestão).
   *   - "high": só auto-aplica quando confiança = ALTA (padrão).
   *   - "any":  auto-aplica em qualquer confiança (também em BAIXA).
   */
  const [autoApply, setAutoApply] = useState<"off" | "high" | "any">(() => {
    if (typeof window === "undefined") return "high";
    const v = window.localStorage.getItem("import.autoApply");
    return v === "off" || v === "high" || v === "any" ? v : "high";
  });

  // Persiste preferências entre aberturas do diálogo.
  useEffect(() => {
    try {
      window.localStorage.setItem("import.thresholds", JSON.stringify(thresholds));
    } catch {
      /* ignore */
    }
  }, [thresholds]);
  useEffect(() => {
    try {
      window.localStorage.setItem("import.autoApply", autoApply);
    } catch {
      /* ignore */
    }
  }, [autoApply]);

  // Validação dos limiares — exibida inline e bloqueia a detecção quando inválida.
  const thresholdErrors = useMemo(() => {
    const errs: { minSamples?: string; ratio?: string; margin?: string } = {};
    const { minSamples, ratio, margin } = thresholds;
    if (!Number.isFinite(minSamples) || minSamples < 1 || minSamples > 50) {
      errs.minSamples = "Use um inteiro entre 1 e 50.";
    } else if (!Number.isInteger(minSamples)) {
      errs.minSamples = "Deve ser um número inteiro.";
    }
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
      errs.ratio = "Ratio deve estar entre 0 (exclusivo) e 1.";
    } else if (ratio < 0.5) {
      errs.ratio = "Valores < 0,5 tornam a detecção pouco confiável.";
    }
    if (!Number.isFinite(margin) || margin < 0 || margin > 100) {
      errs.margin = "Margem deve estar entre 0 e 100.";
    } else if (!Number.isInteger(margin)) {
      errs.margin = "Deve ser um número inteiro.";
    }
    return errs;
  }, [thresholds]);
  const hasThresholdErrors = Object.keys(thresholdErrors).length > 0;
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

      if (hasThresholdErrors) {
        const msgs = Object.values(thresholdErrors).join(" ");
        toast.error(`Limiares inválidos — corrija antes de detectar. ${msgs}`);
        log(`Detecção cancelada: limiares inválidos. ${msgs}`, "warn");
        setDetection(null);
      } else try {
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
          if (result.preset !== presetName) {
            const shouldApply =
              autoApply === "any" ||
              (autoApply === "high" && result.confidence === "high");
            if (shouldApply) {
              setPresetName(result.preset);
              toast.info(`Formato detectado: ${result.preset} (${tag})`);
              log(
                `Formato auto-aplicado: ${result.preset} (${tag}, política=${autoApply}).`,
                result.confidence === "high" ? "ok" : "warn",
              );
              return;
            }
            log(
              `Sugestão (auto-aplicar=${autoApply}): ${result.preset} (${tag}). Mantido "${presetName}" — troque manualmente se quiser.`,
              "warn",
            );
          } else if (result.confidence === "high") {
            log(`Formato confirmado: ${result.preset} (${tag})`, "ok");
          } else {
            log(
              `Confirmação fraca: ${result.preset} (${tag}). Confira a prévia ou afrouxe os limiares.`,
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
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-xl flex-col gap-0 overflow-hidden p-0 sm:w-full">
        <DialogHeader className="border-b border-white/10 px-6 py-4">
          <DialogTitle>Importar desenho ou pontos topográficos</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
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
                  {thresholds.margin} · auto={autoApply})
                </span>
              </summary>
              {hasThresholdErrors && (
                <div
                  role="alert"
                  className="mt-3 rounded border border-red-500/40 bg-red-500/10 p-2 text-[11px] text-red-200"
                >
                  Corrija os limiares antes de iniciar a detecção:
                  <ul className="ml-4 list-disc">
                    {Object.entries(thresholdErrors).map(([k, msg]) => (
                      <li key={k}>
                        <span className="font-medium">{k}:</span> {msg}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-3 grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px]">Mín. amostras</Label>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    aria-invalid={!!thresholdErrors.minSamples}
                    className={thresholdErrors.minSamples ? "border-red-500/60" : undefined}
                    value={thresholds.minSamples}
                    onChange={(e) =>
                      setThresholds((t) => ({ ...t, minSamples: Number(e.target.value) }))
                    }
                  />
                  {thresholdErrors.minSamples && (
                    <p className="text-[10px] text-red-300">{thresholdErrors.minSamples}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Ratio (0–1)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    aria-invalid={!!thresholdErrors.ratio}
                    className={thresholdErrors.ratio ? "border-red-500/60" : undefined}
                    value={thresholds.ratio}
                    onChange={(e) =>
                      setThresholds((t) => ({ ...t, ratio: Number(e.target.value) }))
                    }
                  />
                  {thresholdErrors.ratio && (
                    <p className="text-[10px] text-red-300">{thresholdErrors.ratio}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Margem mín.</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    aria-invalid={!!thresholdErrors.margin}
                    className={thresholdErrors.margin ? "border-red-500/60" : undefined}
                    value={thresholds.margin}
                    onChange={(e) =>
                      setThresholds((t) => ({ ...t, margin: Number(e.target.value) }))
                    }
                  />
                  {thresholdErrors.margin && (
                    <p className="text-[10px] text-red-300">{thresholdErrors.margin}</p>
                  )}
                </div>
              </div>
              <div className="mt-3 space-y-2">
                <Label className="text-[11px]">Política de auto-aplicação</Label>
                <div className="flex flex-wrap gap-3 text-white/80">
                  {(
                    [
                      ["high", "Só em ALTA confiança", "padrão — seguro"],
                      ["any", "Em ALTA ou BAIXA", "permissivo — sugere sempre"],
                      ["off", "Nunca (apenas sugerir)", "manual — você decide"],
                    ] as const
                  ).map(([value, label, hint]) => (
                    <label
                      key={value}
                      className={`flex cursor-pointer items-start gap-2 rounded border px-2 py-1.5 text-[11px] ${
                        autoApply === value
                          ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-100"
                          : "border-white/10 bg-white/[0.03] hover:border-white/30"
                      }`}
                    >
                      <input
                        type="radio"
                        name="autoApply"
                        className="mt-0.5"
                        checked={autoApply === value}
                        onChange={() => setAutoApply(value)}
                      />
                      <span>
                        <span className="block font-medium">{label}</span>
                        <span className="block text-[10px] text-white/50">{hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px]"
                    onClick={() => {
                      setThresholds(DEFAULT_THRESHOLDS);
                      setAutoApply("high");
                    }}
                  >
                    Restaurar padrão
                  </Button>
                </div>
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
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 font-mono">
                    <div>
                      Preset sugerido: <b className="text-cyan-300">{detection.preset}</b> ·
                      amostras analisadas: <b>{detection.stats.sampled}</b>{" "}
                      <span className="text-white/40">
                        (com ID: {detection.stats.withId} · sem ID: {detection.stats.withoutId})
                      </span>
                    </div>
                    {detection.preset !== presetName && (
                      <button
                        type="button"
                        onClick={() => {
                          setPresetName(detection.preset);
                          const tag =
                            detection.confidence === "high" ? "alta confiança" : "baixa confiança";
                          toast.success(`Preset aplicado: ${detection.preset} (${tag}).`);
                          log(
                            `Preset aplicado manualmente: ${detection.preset} (${tag}).`,
                            "ok",
                          );
                        }}
                        className="rounded border border-cyan-400/50 bg-cyan-400/10 px-2.5 py-1 text-[11px] font-medium text-cyan-100 hover:bg-cyan-400/20"
                      >
                        Aplicar sugerido
                      </button>
                    )}
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

                  {detection.decision && (
                    <div
                      className={`mt-3 rounded border p-2 text-[11px] ${
                        detection.confidence === "high"
                          ? "border-emerald-400/30 bg-emerald-400/5 text-emerald-100"
                          : "border-amber-400/30 bg-amber-400/5 text-amber-100"
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <span className="font-mono uppercase tracking-wider text-[10px]">
                          Por que {detection.confidence === "high" ? "ALTA" : "BAIXA"} confiança?
                        </span>
                        <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-[10px]">
                          trilha: {detection.decision.track}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono">
                        <span>
                          Limiares aplicados:{" "}
                          <b>
                            mín={detection.decision.thresholds.minSamples} · ratio=
                            {detection.decision.thresholds.ratio.toFixed(2)} · margem=
                            {detection.decision.thresholds.margin}
                          </b>
                        </span>
                        <span>
                          Amostras: <b>{detection.stats.sampled}</b>{" "}
                          <span className="opacity-60">
                            (latLngHits: {detection.stats.latLngHits})
                          </span>
                        </span>
                        <span>
                          Winner / Loser:{" "}
                          <b className="text-emerald-300">{detection.decision.winner}</b>
                          {" / "}
                          <b className="text-red-300">{detection.decision.loser}</b>{" "}
                          <span className="opacity-60">(total {detection.decision.total})</span>
                        </span>
                        <span>
                          Ratio real:{" "}
                          <b
                            className={
                              detection.decision.ratioActual >=
                              detection.decision.thresholds.ratio
                                ? "text-emerald-300"
                                : "text-amber-300"
                            }
                          >
                            {(detection.decision.ratioActual * 100).toFixed(0)}%
                          </b>{" "}
                          · Margem real:{" "}
                          <b
                            className={
                              detection.decision.marginActual >=
                              detection.decision.thresholds.margin
                                ? "text-emerald-300"
                                : "text-amber-300"
                            }
                          >
                            {detection.decision.marginActual}
                          </b>
                        </span>
                      </div>
                      <div className="mt-1 text-white/70">{detection.decision.reason}</div>
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
                <PreviewCanvas parsed={parsed} />
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
        </div>

        <DialogFooter className="border-t border-white/10 bg-background px-6 py-4">
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
