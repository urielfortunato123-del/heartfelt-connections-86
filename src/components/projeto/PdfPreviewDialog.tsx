import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blob: Blob | null;
  filename: string;
  title?: string;
};

export function PdfPreviewDialog({ open, onOpenChange, blob, filename, title = "Pré-visualização" }: Props) {
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!open || !blob) {
      setThumbs([]);
      return;
    }
    cancelRef.current = false;
    setLoading(true);
    setThumbs([]);

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

        const buf = await blob.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: buf }).promise;
        const out: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelRef.current) return;
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 0.5 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d")!;
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          out.push(canvas.toDataURL("image/jpeg", 0.75));
          setThumbs([...out]);
        }
      } catch (err) {
        console.error("PDF preview error:", err);
      } finally {
        if (!cancelRef.current) setLoading(false);
      }
    })();

    return () => {
      cancelRef.current = true;
    };
  }, [open, blob]);

  const handleDownload = () => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto rounded-md border border-white/10 bg-slate-950/40 p-4">
          {thumbs.length === 0 && loading && (
            <div className="flex h-40 items-center justify-center text-sm text-white/60">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Gerando pré-visualização…
            </div>
          )}
          {thumbs.length === 0 && !loading && (
            <div className="flex h-40 items-center justify-center text-sm text-white/60">
              Nenhuma página para exibir.
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {thumbs.map((src, i) => (
              <figure key={i} className="rounded-md border border-white/10 bg-white p-1">
                <img src={src} alt={`Página ${i + 1}`} className="block w-full" />
                <figcaption className="px-1 py-1 text-center text-[10px] text-slate-600">
                  Página {i + 1}
                </figcaption>
              </figure>
            ))}
          </div>
          {loading && thumbs.length > 0 && (
            <div className="mt-3 flex items-center justify-center text-xs text-white/50">
              <Loader2 className="mr-2 h-3 w-3 animate-spin" /> Renderizando mais páginas…
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button onClick={handleDownload} disabled={!blob}>
            <Download className="mr-1 h-4 w-4" /> Baixar PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
