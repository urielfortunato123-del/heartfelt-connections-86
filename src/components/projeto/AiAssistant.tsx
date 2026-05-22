import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Check,
  Copy,
  FileDown,
  Loader2,
  Plus,
  RotateCcw,
  Send,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ChatMessage = { role: "user" | "assistant"; content: string };

export type AiContext = {
  projectName?: string;
  rodovia?: string;
  rowsCount?: number;
  kmStart?: number;
  kmEnd?: number;
  hasRoute?: boolean;
  srs?: string;
};

const MODELS = [
  { id: "Claude-Sonnet-4.5", label: "Claude Sonnet 4.5" },
  { id: "GPT-5", label: "GPT-5" },
  { id: "Gemini-2.5-Pro", label: "Gemini 2.5 Pro" },
  { id: "Claude-Opus-4.1", label: "Claude Opus 4.1" },
] as const;

const DEFAULT_QUICK_PROMPTS = [
  "Qual SRS devo usar para um traçado em São Paulo?",
  "Como converter coordenadas UTM 23S para WGS84?",
  "Sugira o sentido de estaqueamento para esta rodovia",
  "Explique a diferença entre km, hectômetro e estaca",
];

const DEFAULT_SYSTEM_PROMPT = `Você é um assistente especialista em engenharia rodoviária e GIS,
integrado ao software KM/Converter Pro. Ajude o usuário com:
- Interpretação de arquivos DXF/TXT/KML/Shapefile
- Detecção e conversão de sistemas de coordenadas (SIRGAS 2000, UTM, WGS84)
- Sugestões de estaqueamento, sentido de rodovia e marcos quilométricos
- Padrões DER-SP, DNIT e concessionárias
- Cálculos de quilometragem, hectômetros, estacas

Responda em português brasileiro, de forma técnica, objetiva e profissional.
Use markdown quando útil (listas, tabelas, blocos de código).`;

const SETTINGS_KEY = "kmconv:ai-assistant-settings";

type AssistantSettings = {
  systemPrompt: string;
  quickPrompts: string[];
};

function loadSettings(): AssistantSettings {
  if (typeof window === "undefined") {
    return { systemPrompt: "", quickPrompts: DEFAULT_QUICK_PROMPTS };
  }
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { systemPrompt: "", quickPrompts: DEFAULT_QUICK_PROMPTS };
    const parsed = JSON.parse(raw) as Partial<AssistantSettings>;
    return {
      systemPrompt: typeof parsed.systemPrompt === "string" ? parsed.systemPrompt : "",
      quickPrompts:
        Array.isArray(parsed.quickPrompts) && parsed.quickPrompts.length > 0
          ? parsed.quickPrompts.filter((p): p is string => typeof p === "string")
          : DEFAULT_QUICK_PROMPTS,
    };
  } catch {
    return { systemPrompt: "", quickPrompts: DEFAULT_QUICK_PROMPTS };
  }
}

export function AiAssistant({ context }: { context: AiContext }) {
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState<string>(MODELS[0].id);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [settings, setSettings] = useState<AssistantSettings>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // ignore quota errors
    }
  }, [settings]);

  const contextString = useMemo(() => {
    const parts: string[] = [];
    if (context.projectName) parts.push(`Projeto: ${context.projectName}`);
    if (context.rodovia) parts.push(`Rodovia: ${context.rodovia}`);
    if (context.rowsCount !== undefined) parts.push(`Linhas: ${context.rowsCount}`);
    if (context.kmStart !== undefined && context.kmEnd !== undefined) {
      parts.push(`Trecho: km ${context.kmStart.toFixed(3)} → km ${context.kmEnd.toFixed(3)}`);
    }
    if (context.hasRoute) parts.push("Rota traçada no mapa: sim");
    if (context.srs) parts.push(`SRS atual: ${context.srs}`);
    return parts.join("\n");
  }, [context]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;
      const next: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
      setMessages(next);
      setInput("");
      setLoading(true);

      // placeholder assistant message that we update as tokens arrive
      setMessages((m) => [...m, { role: "assistant", content: "" }]);
      let acc = "";
      const appendDelta = (delta: string) => {
        acc += delta;
        setMessages((m) => {
          const copy = m.slice();
          const last = copy[copy.length - 1];
          if (last && last.role === "assistant") {
            copy[copy.length - 1] = { ...last, content: acc };
          }
          return copy;
        });
      };

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const resp = await fetch("/api/poe-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: next,
            model,
            context: contextString || undefined,
          }),
          signal: controller.signal,
        });

        if (!resp.ok || !resp.body) {
          const errJson = await resp.json().catch(() => ({ error: resp.statusText }));
          appendDelta(`⚠️ ${errJson.error || "Falha na requisição"}`);
          return;
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let done = false;

        while (!done) {
          const { done: rDone, value } = await reader.read();
          if (rDone) break;
          buffer += decoder.decode(value, { stream: true });

          let nl: number;
          while ((nl = buffer.indexOf("\n")) !== -1) {
            let line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (!line || line.startsWith(":")) continue;
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") {
              done = true;
              break;
            }
            try {
              const json = JSON.parse(payload);
              const delta = json.choices?.[0]?.delta?.content;
              if (typeof delta === "string" && delta) appendDelta(delta);
            } catch {
              // partial JSON — put back and wait for more
              buffer = line + "\n" + buffer;
              break;
            }
          }
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          appendDelta(
            `\n\n⚠️ ${error instanceof Error ? error.message : "Erro inesperado"}`,
          );
        }
      } finally {
        setLoading(false);
        abortRef.current = null;
      }
    },
    [contextString, loading, messages, model],
  );

  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const copyMessage = useCallback(async (index: number, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIndex(index);
      window.setTimeout(() => setCopiedIndex((c) => (c === index ? null : c)), 1500);
    } catch {
      toast.error("Não foi possível copiar");
    }
  }, []);

  const exportPdf = useCallback(async () => {
    if (messages.length === 0) {
      toast.info("Nenhuma conversa para exportar");
      return;
    }
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 15;
      const maxW = pageW - margin * 2;
      let y = margin;

      const ensureSpace = (h: number) => {
        if (y + h > pageH - margin) {
          doc.addPage();
          y = margin;
        }
      };

      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("Assistente IA — KM/Converter Pro", margin, y);
      y += 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text(new Date().toLocaleString("pt-BR"), margin, y);
      y += 4;
      if (context.projectName) {
        doc.text(`Projeto: ${context.projectName}`, margin, y);
        y += 4;
      }
      if (contextString) {
        const ctxLines = doc.splitTextToSize(contextString, maxW) as string[];
        ensureSpace(ctxLines.length * 4 + 2);
        doc.text(ctxLines, margin, y);
        y += ctxLines.length * 4 + 2;
      }
      doc.setDrawColor(200);
      doc.line(margin, y, pageW - margin, y);
      y += 6;
      doc.setTextColor(0);

      for (const m of messages) {
        const label = m.role === "user" ? "Você" : "Assistente";
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        if (m.role === "user") doc.setTextColor(30, 100, 160);
        else doc.setTextColor(80, 40, 160);
        ensureSpace(6);
        doc.text(label, margin, y);
        y += 5;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(20);
        const lines = doc.splitTextToSize(m.content || "(vazio)", maxW) as string[];
        for (const line of lines) {
          ensureSpace(5);
          doc.text(line, margin, y);
          y += 5;
        }
        y += 3;
      }

      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const slug = (context.projectName || "chat")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      doc.save(`assistente-${slug || "chat"}-${stamp}.pdf`);
      toast.success("PDF exportado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao exportar PDF");
    }
  }, [context.projectName, contextString, messages]);


  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir assistente IA"
          className="fixed bottom-6 right-6 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 via-fuchsia-500 to-cyan-400 text-white shadow-[0_0_24px_-4px_rgba(168,85,247,0.6)] transition hover:scale-105"
        >
          <Sparkles className="h-6 w-6" />
        </button>
      )}

      <aside
        className={cn(
          "fixed right-0 top-0 z-50 flex h-screen w-full max-w-md flex-col border-l border-white/10 bg-slate-950/95 text-white shadow-2xl backdrop-blur transition-transform duration-300",
          open ? "translate-x-0" : "translate-x-full",
        )}
        aria-hidden={!open}
      >
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-purple-500 to-cyan-400">
              <Bot className="h-4 w-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold">Assistente IA</div>
              <div className="text-[11px] text-white/50">Poe · Engenharia rodoviária</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="h-7 rounded border border-white/10 bg-slate-800 px-2 text-[11px] text-white"
              title="Modelo"
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void exportPdf()}
              aria-label="Exportar conversa em PDF"
              title="Exportar PDF"
              disabled={messages.length === 0}
              className="rounded-md p-1 text-white/60 hover:bg-white/5 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-white/60"
            >
              <FileDown className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fechar"
              className="rounded-md p-1 text-white/60 hover:bg-white/5 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <div className="space-y-3">
              <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-white/70">
                Olá! Sou seu assistente técnico. Posso analisar o projeto atual,
                interpretar arquivos DXF/TXT, sugerir SRS e estaqueamento.
                {contextString && (
                  <div className="mt-2 border-t border-white/10 pt-2 text-[11px] text-white/50">
                    Contexto carregado:
                    <pre className="mt-1 whitespace-pre-wrap font-mono text-[10px] text-cyan-300/80">
                      {contextString}
                    </pre>
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium uppercase tracking-wide text-white/40">
                  Sugestões
                </div>
                {settings.quickPrompts.map((p: string) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => void send(p)}
                    className="block w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-xs text-white/80 transition hover:border-cyan-400/40 hover:bg-cyan-500/10"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                "rounded-lg px-3 py-2 text-sm",
                m.role === "user"
                  ? "ml-6 bg-cyan-500/10 text-cyan-50 ring-1 ring-cyan-400/20"
                  : "mr-6 bg-white/5 text-white/90 ring-1 ring-white/10",
              )}
            >
              <div className="prose prose-invert prose-sm max-w-none prose-pre:bg-slate-900/80 prose-pre:text-xs prose-code:text-cyan-300">
                <ReactMarkdown>{m.content}</ReactMarkdown>
              </div>
              {m.role === "assistant" && m.content && (
                <div className="mt-1.5 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void copyMessage(i, m.content)}
                    aria-label="Copiar resposta"
                    title="Copiar"
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-white/40 transition hover:bg-white/5 hover:text-white/80"
                  >
                    {copiedIndex === i ? (
                      <>
                        <Check className="h-3 w-3" /> Copiado
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" /> Copiar
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="mr-6 flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-white/60 ring-1 ring-white/10">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Pensando…
            </div>
          )}
        </div>

        <form
          className="flex gap-2 border-t border-white/10 bg-slate-900/50 px-3 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder="Pergunte sobre SRS, DXF, estaqueamento…"
            rows={2}
            className="flex-1 resize-none rounded-md border border-white/10 bg-slate-800/60 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-cyan-400/50 focus:outline-none"
            disabled={loading}
          />
          <Button
            type="submit"
            size="sm"
            disabled={loading || !input.trim()}
            className="self-end bg-gradient-to-br from-purple-500 to-cyan-500 hover:opacity-90"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </aside>
    </>
  );
}
