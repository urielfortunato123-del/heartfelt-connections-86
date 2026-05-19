// Diálogo de importação: aceita .dxf e .txt/.csv, deixa o usuário escolher
// o SRC, mapear o formato do TXT, e preview básico (contagem + bbox).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  detectTxtPreset,
  parseDxf,
  parseTopoTxt,
  TXT_PRESETS,
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
    if (!f) return;
    const isTxtFile = f.name.toLowerCase().endsWith(".txt") || f.name.toLowerCase().endsWith(".csv");
    if (isTxtFile) {
      try {
        log("Detectando formato (PNEZD/PENZD/Lat-Lng)…");
        const detected = await detectTxtPreset(f, decimal, skipHeader);
        if (detected && detected !== presetName) {
          setPresetName(detected);
          toast.info(`Formato detectado: ${detected}`);
          log(`Formato detectado: ${detected}`, "ok");
          return;
        }
        if (detected) log(`Formato confirmado: ${detected}`, "ok");
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
