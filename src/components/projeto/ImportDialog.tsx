// Diálogo de importação: aceita .dxf e .txt/.csv, deixa o usuário escolher
// o SRC, mapear o formato do TXT, e preview básico (contagem + bbox).

import { useEffect, useMemo, useState } from "react";
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
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (overlay: OverlayFeature) => void;
};

export function ImportDialog({ open, onOpenChange, onImport }: Props) {
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

  const handleParse = async (f: File) => {
    setBusy(true);
    try {
      const ds = f.name.toLowerCase().endsWith(".dxf")
        ? await parseDxf(f)
        : await parseTopoTxt(f, txtFormat);
      setParsed(ds);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao ler o arquivo.");
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
    // Para TXT/CSV, detecta o preset automaticamente para evitar Norte/Leste invertidos.
    const isTxtFile = f.name.toLowerCase().endsWith(".txt") || f.name.toLowerCase().endsWith(".csv");
    if (isTxtFile) {
      try {
        const detected = await detectTxtPreset(f, decimal, skipHeader);
        if (detected && detected !== presetName) {
          setPresetName(detected);
          toast.info(`Formato detectado: ${detected}`);
          // O useEffect que observa presetName fará o parse com o formato certo.
          return;
        }
      } catch {
        // segue o fluxo normal se a detecção falhar
      }
    }
    handleParse(f);
  };

  const handleConfirm = () => {
    if (!parsed) return;
    const polylines: [number, number][][] = [];
    const points: OverlayFeature["points"] = [];
    try {
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
    } catch (err) {
      toast.error("Falha ao reprojetar coordenadas. Verifique o SRC selecionado.");
      console.error(err);
      return;
    }
    const overlay: OverlayFeature = {
      id: `ov-${Date.now()}`,
      source: parsed.source,
      kind: parsed.kind,
      polylines,
      points,
    };
    onImport(overlay);
    onOpenChange(false);
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

          {parsed && (
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
              {parsed.bbox && parsed.bbox.minX === 0 && parsed.bbox.minY === 0 && (
                <div className="text-amber-300">
                  ⚠ Coordenadas próximas de (0,0) — provavelmente sistema local.
                  Após importar, ative "Posicionar manualmente" para arrastar no mapa.
                </div>
              )}
            </div>
          )}
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
