import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, Gauge, History, Keyboard, Navigation, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { AnimatedNumber } from "@/components/AnimatedNumber";
import { Speedometer } from "@/components/Speedometer";
import {
  DISTANCE_UNITS,
  formatDer,
  formatKm,
  formatNumber,
  toEditableString,
} from "@/lib/converters/distance";

const searchSchema = z.object({
  km: z.coerce.number().optional(),
});

export const Route = createFileRoute("/")({
  validateSearch: searchSchema,
  component: Index,
});

const PRESETS = [1, 5, 10, 100, 1000];
const MAX_RANGE = 1000;
const HISTORY_KEY = "kmcp.history.v1";

type HistoryEntry = { km: number; at: number };

function loadHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
  } catch {
    return [];
  }
}

function Particles() {
  // Só renderiza no client — evita mismatch de hidratação por Math.random no SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dots = useMemo(
    () =>
      Array.from({ length: 40 }).map(() => ({
        x: Math.random() * 100,
        y: Math.random() * 100,
        d: 6 + Math.random() * 10,
        s: 1 + Math.random() * 2,
      })),
    [],
  );
  if (!mounted) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {dots.map((p, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.s,
            height: p.s,
            background: i % 2 ? "#a855f7" : "#22d3ee",
            boxShadow: `0 0 ${p.s * 6}px ${i % 2 ? "#a855f7" : "#22d3ee"}`,
          }}
          animate={{ y: [0, -30, 0], opacity: [0.2, 1, 0.2] }}
          transition={{ duration: p.d, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

function formatTravelTime(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "0min";
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}min`;
  if (h < 24) return `${h}h ${m.toString().padStart(2, "0")}min`;
  const days = Math.floor(h / 24);
  const remHours = h % 24;
  return `${days}d ${remHours}h`;
}

type DerDirection = "asc" | "desc";

const DER_PREFS_KEY = "kmcp.der.prefs.v1";

function loadDerPrefs(): { kmBase: number; direction: DerDirection } {
  if (typeof window === "undefined") return { kmBase: 0, direction: "asc" };
  try {
    const raw = localStorage.getItem(DER_PREFS_KEY);
    if (!raw) return { kmBase: 0, direction: "asc" };
    const p = JSON.parse(raw) as { kmBase?: number; direction?: DerDirection };
    return {
      kmBase: Number.isFinite(p.kmBase) ? Math.max(0, p.kmBase!) : 0,
      direction: p.direction === "desc" ? "desc" : "asc",
    };
  } catch {
    return { kmBase: 0, direction: "asc" };
  }
}

function DerPanel({ km, setKm }: { km: number; setKm: (n: number) => void }) {
  const [prefs, setPrefs] = useState<{ kmBase: number; direction: DerDirection }>(
    () => loadDerPrefs(),
  );
  const { kmBase, direction } = prefs;

  useEffect(() => {
    try {
      localStorage.setItem(DER_PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* noop */
    }
  }, [prefs]);

  // Estaca relativa ao km base, respeitando o sentido.
  const offsetMeters = Math.max(
    0,
    Math.round((direction === "asc" ? km - kmBase : kmBase - km) * 1000),
  );
  const der = {
    estacas: Math.floor(offsetMeters / 20),
    extra: Math.round((offsetMeters - Math.floor(offsetMeters / 20) * 20) * 100) / 100,
  };
  const hm = offsetMeters / 100;
  const meters = offsetMeters;

  // Aplica estaca+excedente → km absoluto, respeitando base e sentido.
  const applyEstaca = (estacas: number, extra: number) => {
    const e = Number.isFinite(estacas) ? Math.max(0, Math.floor(estacas)) : 0;
    const x = Number.isFinite(extra) ? Math.max(0, Math.min(19.99, extra)) : 0;
    const meters = e * 20 + x;
    const km = direction === "asc" ? kmBase + meters / 1000 : kmBase - meters / 1000;
    setKm(Math.max(0, km));
  };
  const applyHm = (hmValue: number) => {
    const v = Number.isFinite(hmValue) ? Math.max(0, hmValue) : 0;
    const km = direction === "asc" ? kmBase + v / 10 : kmBase - v / 10;
    setKm(Math.max(0, km));
  };

  return (
    <section
      aria-label="Conversão DER · Estaca e Hectômetro"
      className="mt-6 overflow-hidden rounded-2xl border border-fuchsia-400/20 bg-black/40 p-5"
      style={{ boxShadow: "0 0 40px -20px rgba(168,85,247,.5) inset" }}
    >
      <div className="mb-3 flex items-center justify-between font-mono text-[10px] tracking-[0.3em]">
        <span className="text-fuchsia-300">DER · ESTACA / HECTÔMETRO</span>
        <span className="text-white/30">PADRÃO BRASILEIRO</span>
      </div>

      {/* Trecho: km base + sentido */}
      <div className="mb-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <label
            htmlFor="der-base"
            className="block font-mono text-[10px] tracking-[0.25em] text-white/40"
          >
            KM INICIAL <span className="text-white/30">(Estaca 0)</span>
          </label>
          <div className="mt-1 flex items-end gap-2">
            <input
              id="der-base"
              type="number"
              inputMode="decimal"
              min={0}
              step={0.001}
              aria-label="Km da Estaca 0 (offset do trecho)"
              value={toEditableString(kmBase)}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setPrefs((p) => ({ ...p, kmBase: Number.isFinite(v) ? Math.max(0, v) : 0 }));
              }}
              className="w-full rounded bg-transparent text-2xl font-light text-white outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/60"
              placeholder="0"
            />
            <span className="pb-1 font-mono text-[10px] tracking-[0.3em] text-fuchsia-300">KM</span>
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <div className="font-mono text-[10px] tracking-[0.25em] text-white/40">
            SENTIDO DO ESTAQUEAMENTO
          </div>
          <div
            role="radiogroup"
            aria-label="Sentido do estaqueamento"
            className="mt-2 flex gap-2"
          >
            {(["asc", "desc"] as const).map((d) => {
              const active = direction === d;
              return (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setPrefs((p) => ({ ...p, direction: d }))}
                  className={`flex-1 rounded-lg border px-3 py-2 font-mono text-[10px] tracking-[0.2em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/60 ${
                    active
                      ? "border-fuchsia-400/70 bg-fuchsia-400/10 text-fuchsia-200"
                      : "border-white/10 bg-white/[0.02] text-white/60 hover:border-white/30 hover:text-white"
                  }`}
                >
                  {d === "asc" ? "↑ CRESCENTE (+KM)" : "↓ DECRESCENTE (−KM)"}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <label
            htmlFor="der-estacas"
            className="block font-mono text-[10px] tracking-[0.25em] text-white/40"
          >
            ESTACAS <span className="text-white/30">(20 m cada)</span>
          </label>
          <div className="mt-1 flex items-end gap-2">
            <input
              id="der-estacas"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              aria-label="Número de estacas"
              value={der.estacas}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                applyEstaca(Number.isFinite(v) ? v : 0, der.extra);
              }}
              className="w-full rounded bg-transparent text-2xl font-light text-white outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/60"
              placeholder="0"
            />
            <span className="pb-1 font-mono text-[10px] tracking-[0.3em] text-fuchsia-300">EST</span>
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <label
            htmlFor="der-extra"
            className="block font-mono text-[10px] tracking-[0.25em] text-white/40"
          >
            EXCEDENTE <span className="text-white/30">(0–19 m)</span>
          </label>
          <div className="mt-1 flex items-end gap-2">
            <input
              id="der-extra"
              type="number"
              inputMode="decimal"
              min={0}
              max={19.99}
              step={0.1}
              aria-label="Metros excedentes"
              value={der.extra}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                applyEstaca(der.estacas, Number.isFinite(v) ? v : 0);
              }}
              className="w-full rounded bg-transparent text-2xl font-light text-white outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/60"
              placeholder="0"
            />
            <span className="pb-1 font-mono text-[10px] tracking-[0.3em] text-fuchsia-300">M</span>
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <label
            htmlFor="der-hm"
            className="block font-mono text-[10px] tracking-[0.25em] text-white/40"
          >
            HECTÔMETROS <span className="text-white/30">(100 m)</span>
          </label>
          <div className="mt-1 flex items-end gap-2">
            <input
              id="der-hm"
              type="number"
              inputMode="decimal"
              min={0}
              step={0.1}
              aria-label="Hectômetros"
              value={toEditableString(hm)}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                applyHm(Number.isFinite(v) ? v : 0);
              }}
              className="w-full rounded bg-transparent text-2xl font-light text-white outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/60"
              placeholder="0"
            />
            <span className="pb-1 font-mono text-[10px] tracking-[0.3em] text-fuchsia-300">HM</span>
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] tracking-[0.25em] text-white/40">
        <span>
          NOTAÇÃO:{" "}
          <span className="text-fuchsia-300">Estaca {formatDer(der)}</span>
          <span className="ml-2 text-white/30">
            (base {formatKm(kmBase)} km, {direction === "asc" ? "↑" : "↓"})
          </span>
        </span>
        <span>
          = <span className="text-white">{formatNumber(meters)} m</span> ·{" "}
          <span className="text-white">{formatKm(km)} km</span>
        </span>
      </div>
    </section>
  );
}

function Index() {
  const search = useSearch({ from: "/" });
  const initial = Number.isFinite(search.km) && search.km! > 0 ? search.km! : 100;

  // Fonte única da verdade: total em metros (inteiro).
  // Evita erro de ponto flutuante ao combinar km + metros.
  const [totalMeters, setTotalMeters] = useState<number>(
    Math.max(0, Math.round((Number.isFinite(initial) ? initial : 0) * 1000)),
  );
  const km = totalMeters / 1000;
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  // Rascunho do input de metros — permite digitar vazio sem perder foco,
  // com validação visual em tempo real (0–1000).
  const [metersDraft, setMetersDraft] = useState<string | null>(null);

  // setKm aceita km (float) e converte para inteiro de metros — single source of truth.
  const setKm = useCallback((next: number) => {
    const m = Number.isFinite(next) ? Math.max(0, Math.round(next * 1000)) : 0;
    setTotalMeters(Math.min(m, MAX_RANGE * 1000));
  }, []);

  // Sincroniza ?km= APENAS quando explicitamente "commitado"
  // (onPointerUp/onKeyUp do slider, onBlur do input, clique em preset/history).
  // Evita replaceState a cada tick durante o arraste — que causava scroll/jank.
  const commitUrl = useCallback((value: number) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (Number.isFinite(value) && value > 0) {
      url.searchParams.set("km", String(value));
    } else {
      url.searchParams.delete("km");
    }
    if (url.toString() === window.location.href) return;
    // Desativa a restauração automática de scroll do navegador/roteador
    // enquanto sincronizamos ?km= via slider/input — evita "saltos" da página.
    const prevRestoration = window.history.scrollRestoration;
    try {
      window.history.scrollRestoration = "manual";
    } catch {
      // alguns navegadores podem rejeitar — seguir adiante
    }
    const x = window.scrollX;
    const y = window.scrollY;
    // Preserva foco + seleção do campo ativo (ex.: input de metros) ao mexer na URL.
    const active = document.activeElement as HTMLElement | null;
    const isTextInput =
      active instanceof HTMLInputElement &&
      (active.type === "number" || active.type === "text" || active.type === "search");
    const activeId = active?.id || null;
    let selStart: number | null = null;
    let selEnd: number | null = null;
    let selDir: "forward" | "backward" | "none" = "none";
    if (isTextInput) {
      try {
        selStart = (active as HTMLInputElement).selectionStart;
        selEnd = (active as HTMLInputElement).selectionEnd;
        selDir = ((active as HTMLInputElement).selectionDirection ?? "none") as
          | "forward"
          | "backward"
          | "none";
      } catch {
        // number inputs throw on selection access in some browsers — ignore
      }
    }
    window.history.replaceState(null, "", url.toString());
    if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y);
    const restore = () => {
      if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y);
      if (!activeId) return;
      const el = document.getElementById(activeId) as HTMLElement | null;
      if (!el) return;
      if (document.activeElement !== el) el.focus({ preventScroll: true });
      if (
        el instanceof HTMLInputElement &&
        selStart !== null &&
        selEnd !== null
      ) {
        try {
          el.setSelectionRange(selStart, selEnd, selDir);
        } catch {
          // ignore — input type may not support selection
        }
      }
    };
    requestAnimationFrame(() => {
      restore();
      try {
        window.history.scrollRestoration = prevRestoration;
      } catch {
        // ignore
      }
    });
  }, []);




  // Debounced history push
  useEffect(() => {
    if (!km || !Number.isFinite(km)) return;
    const t = window.setTimeout(() => {
      setHistory((prev) => {
        if (prev[0]?.km === km) return prev;
        const next = [{ km, at: Date.now() }, ...prev.filter((e) => e.km !== km)].slice(0, 6);
        try {
          localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
        } catch {
          // ignore quota errors
        }
        return next;
      });
    }, 900);
    return () => window.clearTimeout(t);
  }, [km]);

  // Keyboard shortcuts: ↑/↓ adjust, number keys jump to presets
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (isTyping) return;
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setKm(Math.max(0, km + (e.shiftKey ? 10 : 1)));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setKm(Math.max(0, km - (e.shiftKey ? 10 : 1)));
      } else if (/^[1-5]$/.test(e.key)) {
        setKm(PRESETS[parseInt(e.key, 10) - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [km, setKm]);

  const copyValue = useCallback(
    async (value: number, unitLabel: string, suffix: string) => {
      const text = `${formatNumber(value)} ${suffix}`;
      try {
        await navigator.clipboard.writeText(text);
        toast.success("Copied", { description: `${unitLabel}: ${text}` });
      } catch {
        toast.error("Could not copy to clipboard");
      }
    },
    [],
  );

  const shareLink = useCallback(async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied", { description: url });
    } catch {
      toast.error("Could not copy link");
    }
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      /* noop */
    }
    toast("History cleared");
  }, []);

  // Derived
  const speedKmh = (Number.isFinite(km) ? km : 0) * 1.3; // illustrative HUD value
  const speedProgress = Math.min(1, speedKmh / 300);
  const travelHours = km > 0 ? km / 100 : 0; // assume 100 km/h cruise

  return (
    <div
      className="relative min-h-dvh w-full overflow-hidden text-white"
      style={{ backgroundColor: "#050505" }}
    >
      {/* Ambient glows */}
      <div
        className="pointer-events-none absolute -top-40 -left-40 h-[600px] w-[600px] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(34,211,238,0.25), transparent 60%)" }}
      />
      <div
        className="pointer-events-none absolute -bottom-40 -right-40 h-[600px] w-[600px] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(168,85,247,0.25), transparent 60%)" }}
      />
      {/* Grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.15]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(34,211,238,.4) 1px, transparent 1px), linear-gradient(90deg, rgba(168,85,247,.4) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
          maskImage: "radial-gradient(ellipse at center, black 40%, transparent 80%)",
        }}
      />
      <Particles />

      {/* Nav */}
      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <div
            className="grid h-9 w-9 place-items-center rounded-lg border border-cyan-400/40"
            style={{ boxShadow: "0 0 24px rgba(34,211,238,.5) inset" }}
          >
            <Zap className="h-4 w-4 text-cyan-300" />
          </div>
          <span className="font-mono text-sm tracking-[0.3em] text-white/80">
            KM/CONVERTER · PRO
          </span>
        </div>
        <div className="flex items-center gap-2 md:gap-4">
          <a
            href="/projeto"
            className="rounded-full border border-purple-400/40 bg-purple-500/10 px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-purple-200 transition-colors hover:border-purple-300 hover:text-white md:px-4 md:tracking-[0.25em]"
          >
            EDITOR
          </a>
          <button
            onClick={shareLink}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-1.5 font-mono text-[10px] tracking-[0.25em] text-white/70 transition-colors hover:border-cyan-400/50 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
          >
            SHARE
          </button>
          <span className="font-mono text-[10px] tracking-[0.3em] text-cyan-300">
            // ONLINE
          </span>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl px-6 pt-4 pb-24">
        <div className="grid items-start gap-12 lg:grid-cols-[1.1fr_1fr]">
          {/* LEFT: copy + converter */}
          <div>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 font-mono text-[10px] tracking-[0.3em] text-cyan-300 backdrop-blur"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
              REALTIME · ZERO LATENCY
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, delay: 0.1 }}
              className="text-5xl font-bold leading-[1.05] tracking-tight md:text-7xl"
            >
              Distance,
              <br />
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(110deg, #22d3ee 0%, #818cf8 45%, #a855f7 100%)",
                }}
              >
                reimagined.
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4, duration: 1 }}
              className="mt-6 max-w-md text-base text-white/60"
            >
              A cinematic converter built for engineers, drivers and travelers
              of the next decade. Edit any field — every unit updates in real
              time.
            </motion.p>

            {/* Converter card */}
            <motion.section
              aria-label="Distance converter"
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.9 }}
              className="relative mt-10 rounded-3xl border border-white/10 p-6 backdrop-blur-2xl md:p-8"
              style={{
                background:
                  "linear-gradient(145deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
                boxShadow:
                  "0 0 0 1px rgba(255,255,255,.04), 0 30px 80px -20px rgba(34,211,238,.25), 0 30px 80px -20px rgba(168,85,247,.25)",
              }}
            >
              <label
                htmlFor="km-input"
                className="mb-4 flex items-center justify-between font-mono text-[10px] tracking-[0.3em] text-white/40"
              >
                <span>INPUT · KILOMETERS</span>
                <span className="flex items-center gap-1.5 text-cyan-300" aria-hidden="true">
                  <Gauge className="h-3 w-3" /> LIVE
                </span>
              </label>

              <div className="flex items-end gap-3">
                <input
                  id="km-input"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  aria-label="Distance in kilometers"
                  value={Number.isFinite(km) ? Number(km.toFixed(3)) : ""}
                  onChange={(e) => setKm(parseFloat(e.target.value))}
                  onBlur={() => commitUrl(km)}
                  className="w-full rounded-md bg-transparent text-5xl font-light tracking-tight text-white outline-none placeholder:text-white/20 focus-visible:ring-2 focus-visible:ring-cyan-400/60 md:text-6xl"
                  placeholder="0"
                />
                <span
                  className="pb-2 font-mono text-sm tracking-[0.3em] text-cyan-300"
                  aria-hidden="true"
                >
                  KM
                </span>
              </div>

              {(() => {
                const safeTotal = Math.max(0, Math.min(totalMeters, MAX_RANGE * 1000));
                const wholeKm = Math.floor(safeTotal / 1000);
                const meters = safeTotal % 1000;
                return (
                  <>
                    <label htmlFor="km-slider" className="sr-only">
                      Ajustar quilômetros, faixa 0 a {MAX_RANGE}
                    </label>
                    <input
                      id="km-slider"
                      type="range"
                      min={0}
                      max={MAX_RANGE}
                      step={1}
                      aria-label="Quilômetros"
                      aria-valuemin={0}
                      aria-valuemax={MAX_RANGE}
                      aria-valuenow={wholeKm}
                      aria-valuetext={`${wholeKm} quilômetros`}
                      value={wholeKm}
                      onChange={(e) => {
                        const k = parseInt(e.target.value, 10) || 0;
                        // Aritmética inteira: preserva os metros atuais sem erro de ponto flutuante.
                        setTotalMeters(Math.min(MAX_RANGE * 1000, k * 1000 + meters));
                      }}
                      onPointerUp={() => commitUrl(km)}
                      onKeyUp={(e) => {
                        if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Home","End","PageUp","PageDown"].includes(e.key))
                          commitUrl(km);
                      }}
                      className="mt-6 w-full rounded-full accent-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                    />
                    {(() => {
                      // Preview ao vivo do total enquanto o usuário digita metros.
                      const draftN =
                        metersDraft === null || metersDraft === ""
                          ? NaN
                          : Number(metersDraft);
                      const previewMeters =
                        Number.isFinite(draftN) && draftN >= 0 && draftN <= 1000
                          ? wholeKm * 1000 + Math.round(draftN)
                          : totalMeters;
                      const previewKm = previewMeters / 1000;
                      return (
                        <div
                          className="mt-4 flex items-center justify-between font-mono text-[10px] tracking-[0.3em]"
                          aria-live="polite"
                        >
                          <span className="text-white/40">
                            TOTAL ={" "}
                            <span className="text-cyan-300 tabular-nums">
                              {formatKm(previewKm)} km
                            </span>
                            <span className="ml-2 text-white/30">
                              ({formatNumber(previewMeters)} m)
                            </span>
                          </span>
                        </div>
                      );
                    })()}
                    <div className="mt-2 flex items-center justify-between font-mono text-[10px] tracking-[0.3em] text-white/40">
                      <label htmlFor="m-slider" className="text-fuchsia-300">
                        + METROS · PRECISÃO FINA
                      </label>
                      <div className="flex items-center gap-1.5 text-white">
                        {(() => {
                          const draftNum =
                            metersDraft === null || metersDraft === ""
                              ? NaN
                              : Number(metersDraft);
                          const invalid =
                            metersDraft !== null &&
                            metersDraft !== "" &&
                            (!Number.isFinite(draftNum) ||
                              draftNum < 0 ||
                              draftNum > 1000 ||
                              !/^\d+$/.test(metersDraft));
                          const displayValue =
                            metersDraft !== null ? metersDraft : String(meters);
                          return (
                            <input
                              id="m-input"
                              type="number"
                              inputMode="numeric"
                              min={0}
                              max={1000}
                              step={1}
                              aria-label="Metros adicionais (0 a 1000)"
                              aria-invalid={invalid}
                              value={displayValue}
                              onChange={(e) => {
                                const v = e.target.value;
                                setMetersDraft(v);
                                // Aplica somente se for inteiro válido dentro do range.
                                if (v === "" || !/^\d+$/.test(v)) return;
                                const n = Number(v);
                                if (!Number.isFinite(n) || n < 0 || n > 1000) return;
                                const next =
                                  n >= 1000 ? (wholeKm + 1) * 1000 : wholeKm * 1000 + n;
                                setTotalMeters(Math.min(MAX_RANGE * 1000, next));
                              }}
                              onBlur={() => {
                                // Ao sair, normaliza: vazio/ inválido vira valor clampeado.
                                const n = Number(metersDraft);
                                if (
                                  metersDraft === null ||
                                  metersDraft === "" ||
                                  !Number.isFinite(n)
                                ) {
                                  setTotalMeters(wholeKm * 1000);
                                } else {
                                  const clamped = Math.max(0, Math.min(1000, Math.round(n)));
                                  const next =
                                    clamped >= 1000
                                      ? (wholeKm + 1) * 1000
                                      : wholeKm * 1000 + clamped;
                                  setTotalMeters(Math.min(MAX_RANGE * 1000, next));
                                }
                                setMetersDraft(null);
                                commitUrl(km);
                              }}
                              className={`w-16 rounded bg-black/40 px-2 py-1 text-right font-mono text-xs tabular-nums text-white outline-none focus-visible:ring-2 ${
                                invalid
                                  ? "ring-2 ring-red-500/70 focus-visible:ring-red-500/70"
                                  : "focus-visible:ring-fuchsia-400/60"
                              }`}
                            />
                          );
                        })()}
                        <span className="text-white/40">m</span>
                      </div>
                    </div>
                    <input
                      id="m-slider"
                      type="range"
                      min={0}
                      max={1000}
                      step={1}
                      aria-label="Metros adicionais (0 a 1000)"
                      aria-valuemin={0}
                      aria-valuemax={1000}
                      aria-valuenow={meters}
                      aria-valuetext={`${meters} metros`}
                      value={meters}
                      onChange={(e) => {
                        const m = parseInt(e.target.value, 10) || 0;
                        const next = m >= 1000 ? (wholeKm + 1) * 1000 : wholeKm * 1000 + m;
                        setTotalMeters(Math.min(MAX_RANGE * 1000, next));
                      }}
                      onPointerUp={() => commitUrl(km)}
                      onKeyUp={(e) => {
                        if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Home","End","PageUp","PageDown"].includes(e.key))
                          commitUrl(km);
                      }}
                      className="mt-2 w-full rounded-full accent-fuchsia-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/60"
                      style={{ accentColor: "#d946ef" }}
                    />
                  </>
                );
              })()}

              <div
                role="group"
                aria-label="Quick distance presets"
                className="mt-6 flex flex-wrap gap-2"
              >
                {PRESETS.map((preset, i) => {
                  const active = km === preset;
                  return (
                    <motion.button
                      key={preset}
                      type="button"
                      onClick={() => { setKm(preset); commitUrl(preset); }}
                      aria-pressed={active}
                      aria-label={`Set distance to ${preset} kilometers (press ${i + 1})`}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className={`rounded-full border px-4 py-1.5 font-mono text-xs tracking-[0.2em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 ${
                        active
                          ? "border-cyan-400/70 bg-cyan-400/10 text-cyan-200"
                          : "border-white/10 bg-white/[0.03] text-white/60 hover:border-white/30 hover:text-white"
                      }`}
                      style={
                        active
                          ? { boxShadow: "0 0 24px -4px rgba(34,211,238,.6)" }
                          : undefined
                      }
                    >
                      {preset} KM
                    </motion.button>
                  );
                })}
              </div>

              <p className="mt-4 font-mono text-[10px] tracking-[0.3em] text-white/30">
                ↔ EDIT ANY FIELD · BIDIRECTIONAL
              </p>

              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
                {DISTANCE_UNITS.map((u, i) => {
                  const value = (Number.isFinite(km) ? km : 0) * u.factor;
                  return (
                    <div
                      key={u.key}
                      className="group relative overflow-hidden rounded-xl border border-white/10 bg-black/40 p-4 transition-colors focus-within:border-cyan-400/60 hover:border-white/20"
                    >
                      <div
                        className="absolute inset-x-0 -top-px h-px"
                        style={{
                          background:
                            i % 2
                              ? "linear-gradient(90deg,transparent, #a855f7, transparent)"
                              : "linear-gradient(90deg,transparent, #22d3ee, transparent)",
                        }}
                      />
                      <label
                        htmlFor={`unit-${u.key}`}
                        className="flex items-center justify-between font-mono text-[10px] tracking-[0.25em] text-white/40"
                      >
                        <span>{u.label.toUpperCase()}</span>
                        <span className="text-white/30">{u.suffix}</span>
                      </label>
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          id={`unit-${u.key}`}
                          type="number"
                          inputMode="decimal"
                          aria-label={`Distance in ${u.label}`}
                          value={toEditableString(value)}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            setKm(Number.isFinite(v) ? v / u.factor : 0);
                          }}
                          className="w-full truncate rounded bg-transparent text-xl font-medium text-white outline-none placeholder:text-white/20 focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                          placeholder="0"
                        />
                        <button
                          type="button"
                          onClick={() => copyValue(value, u.label, u.suffix)}
                          aria-label={`Copy ${u.label} value`}
                          className="rounded-md p-1.5 text-white/40 transition-colors hover:bg-white/5 hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* DER · Estaca / Hectômetro (Padrão Brasileiro) */}
              <DerPanel km={Number.isFinite(km) ? km : 0} setKm={setKm} />

              {/* Travel time strip */}
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/5 bg-black/30 px-4 py-3">
                <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.25em] text-white/40">
                  <Navigation className="h-3 w-3 text-fuchsia-400" />
                  TRAVEL TIME · @ 100 KM/H
                </div>
                <div className="font-mono text-sm text-white">
                  <AnimatedNumber value={travelHours} className="text-cyan-300" />
                  <span className="ml-1 text-xs text-white/40">h</span>
                  <span className="ml-3 text-white/60">{formatTravelTime(travelHours)}</span>
                </div>
              </div>

              {/* Keyboard hint */}
              <div className="mt-4 hidden items-center gap-2 font-mono text-[10px] tracking-[0.25em] text-white/30 md:flex">
                <Keyboard className="h-3 w-3" />
                <span>↑/↓ adjust · shift = ×10 · 1–5 = presets</span>
              </div>
            </motion.section>
          </div>

          {/* RIGHT: speedometer + history */}
          <div className="space-y-6 lg:sticky lg:top-6">
            <motion.div
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1, ease: "easeOut" }}
              className="relative overflow-hidden rounded-[2rem] border border-white/10 p-6"
              style={{
                background:
                  "radial-gradient(ellipse at top, rgba(34,211,238,0.15), transparent 60%), #0a0a0f",
                boxShadow:
                  "0 0 120px -20px rgba(34,211,238,.4), 0 0 120px -20px rgba(168,85,247,.4)",
              }}
            >
              <div className="mb-4 flex items-center justify-between font-mono text-[10px] tracking-[0.3em] text-white/40">
                <span>HUD · VELOCITY PROJECTION</span>
                <motion.span
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 2.5, repeat: Infinity }}
                  className="text-cyan-300"
                >
                  ◆ NAV.LOCK
                </motion.span>
              </div>
              <div className="mx-auto aspect-square max-w-[360px]">
                <Speedometer
                  progress={speedProgress}
                  label={Math.round(speedKmh).toLocaleString()}
                  unit="km/h"
                />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center font-mono text-[10px] tracking-[0.25em] text-white/40">
                <div>
                  <div className="text-white/30">DIST</div>
                  <div className="mt-1 text-white">
                    <AnimatedNumber value={km} format={formatKm} /> km
                  </div>
                </div>
                <div>
                  <div className="text-white/30">RANGE</div>
                  <div className="mt-1 text-white">0–300</div>
                </div>
                <div>
                  <div className="text-white/30">MODE</div>
                  <div className="mt-1 text-cyan-300">CRUISE</div>
                </div>
              </div>
            </motion.div>

            {/* History panel */}
            <motion.section
              aria-label="Recent conversions"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.8 }}
              className="rounded-2xl border border-white/10 bg-black/40 p-5 backdrop-blur-xl"
            >
              <div className="mb-3 flex items-center justify-between font-mono text-[10px] tracking-[0.3em] text-white/40">
                <span className="flex items-center gap-1.5">
                  <History className="h-3 w-3 text-cyan-300" /> RECENT
                </span>
                {history.length > 0 && (
                  <button
                    type="button"
                    onClick={clearHistory}
                    aria-label="Clear history"
                    className="rounded p-1 text-white/40 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
              {history.length === 0 ? (
                <p className="font-mono text-[11px] text-white/30">
                  No conversions yet — start typing.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  <AnimatePresence initial={false}>
                    {history.map((h) => (
                      <motion.li
                        key={`${h.km}-${h.at}`}
                        layout
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        transition={{ duration: 0.25 }}
                      >
                        <button
                          type="button"
                          onClick={() => { setKm(h.km); commitUrl(h.km); }}
                          className="group flex w-full items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-left transition-colors hover:border-cyan-400/40 hover:bg-cyan-400/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                        >
                          <span className="font-mono text-sm text-white">
                            {formatKm(h.km)}{" "}
                            <span className="text-xs text-white/40">km</span>
                          </span>
                          <span className="font-mono text-[10px] tracking-[0.2em] text-white/30 group-hover:text-cyan-300">
                            RESTORE →
                          </span>
                        </button>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </motion.section>
          </div>
        </div>
      </main>
    </div>
  );
}
