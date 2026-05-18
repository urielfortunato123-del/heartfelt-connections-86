import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Gauge, Zap, Navigation } from "lucide-react";
import heroImg from "@/assets/hero-neon-road.jpg";

export const Route = createFileRoute("/")({
  component: Index,
});

const UNITS = [
  { key: "m", label: "Meters", factor: 1000, suffix: "m" },
  { key: "mi", label: "Miles", factor: 0.621371, suffix: "mi" },
  { key: "nmi", label: "Nautical Miles", factor: 0.539957, suffix: "nmi" },
  { key: "yd", label: "Yards", factor: 1093.61, suffix: "yd" },
  { key: "ft", label: "Feet", factor: 3280.84, suffix: "ft" },
  { key: "ly", label: "Light-Years", factor: 1.057e-16, suffix: "ly" },
];

function format(n: number) {
  if (!isFinite(n)) return "—";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs < 0.0001 || abs >= 1e9) return n.toExponential(4);
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function Particles() {
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
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
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

function Index() {
  const [km, setKm] = useState<number>(100);

  return (
    <div
      className="relative min-h-screen w-full overflow-hidden text-white"
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
        <div className="hidden gap-8 font-mono text-xs tracking-widest text-white/50 md:flex">
          <span>v2.0.77</span>
          <span className="text-cyan-300">// ONLINE</span>
        </div>
      </header>

      {/* Hero */}
      <main className="relative z-10 mx-auto max-w-7xl px-6 pt-8 pb-24">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          {/* Left: copy + converter */}
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
              A cinematic converter built for engineers, drivers, and travelers
              of the next decade. Convert kilometers across every unit in real
              time.
            </motion.p>

            {/* Converter card */}
            <motion.div
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
              <div className="mb-4 flex items-center justify-between font-mono text-[10px] tracking-[0.3em] text-white/40">
                <span>INPUT · KILOMETERS</span>
                <span className="flex items-center gap-1.5 text-cyan-300">
                  <Gauge className="h-3 w-3" /> LIVE
                </span>
              </div>

              <div className="flex items-end gap-3">
                <input
                  type="number"
                  value={Number.isFinite(km) ? km : ""}
                  onChange={(e) => setKm(parseFloat(e.target.value))}
                  className="w-full bg-transparent text-5xl font-light tracking-tight text-white outline-none placeholder:text-white/20 md:text-6xl"
                  placeholder="0"
                />
                <span className="pb-2 font-mono text-sm tracking-[0.3em] text-cyan-300">
                  KM
                </span>
              </div>

              <input
                type="range"
                min={0}
                max={1000}
                step={1}
                value={Number.isFinite(km) ? Math.min(km, 1000) : 0}
                onChange={(e) => setKm(parseFloat(e.target.value))}
                className="mt-6 w-full accent-cyan-400"
              />

              <div className="mt-6 flex flex-wrap gap-2">
                {[1, 5, 10, 100, 1000].map((preset) => {
                  const active = km === preset;
                  return (
                    <motion.button
                      key={preset}
                      type="button"
                      onClick={() => setKm(preset)}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className={`rounded-full border px-4 py-1.5 font-mono text-xs tracking-[0.2em] transition-colors ${
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

              <div className="mt-4 font-mono text-[10px] tracking-[0.3em] text-white/30">
                ↔ EDIT ANY FIELD · BIDIRECTIONAL
              </div>


              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
                {UNITS.map((u, i) => {
                  const value = (Number.isFinite(km) ? km : 0) * u.factor;
                  const display = Number.isFinite(value)
                    ? Number(value.toPrecision(8)).toString()
                    : "";
                  return (
                    <motion.label
                      key={u.key}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.6 + i * 0.05 }}
                      className="group relative block overflow-hidden rounded-xl border border-white/10 bg-black/40 p-4 transition-colors focus-within:border-cyan-400/60 hover:border-white/20"
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
                      <div className="flex items-center justify-between font-mono text-[10px] tracking-[0.25em] text-white/40">
                        <span>{u.label.toUpperCase()}</span>
                        <span className="text-white/30">{u.suffix}</span>
                      </div>
                      <input
                        type="number"
                        value={display}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!Number.isFinite(v)) {
                            setKm(0);
                            return;
                          }
                          setKm(v / u.factor);
                        }}
                        className="mt-2 w-full truncate bg-transparent text-xl font-medium text-white outline-none placeholder:text-white/20"
                        placeholder="0"
                      />
                    </motion.label>
                  );
                })}
              </div>
            </motion.div>
          </div>

          {/* Right: hero illustration */}
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1.2, ease: "easeOut" }}
            className="relative"
          >
            <div
              className="relative aspect-square overflow-hidden rounded-[2rem] border border-white/10"
              style={{
                boxShadow:
                  "0 0 120px -20px rgba(34,211,238,.4), 0 0 120px -20px rgba(168,85,247,.4)",
              }}
            >
              <img
                src={heroImg}
                alt="Holographic neon road HUD"
                width={1536}
                height={1024}
                className="h-full w-full object-cover"
              />
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(5,5,5,0) 50%, rgba(5,5,5,0.9) 100%)",
                }}
              />
              {/* HUD overlay */}
              <motion.div
                animate={{ opacity: [0.6, 1, 0.6] }}
                transition={{ duration: 3, repeat: Infinity }}
                className="absolute left-6 top-6 font-mono text-[10px] tracking-[0.3em] text-cyan-300"
              >
                ◆ NAV.SYS · LOCKED
              </motion.div>
              <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between font-mono text-[10px] text-white/70">
                <div>
                  <div className="text-[9px] tracking-[0.3em] text-white/40">
                    VELOCITY
                  </div>
                  <div className="text-2xl text-white">
                    {format((Number.isFinite(km) ? km : 0) * 1.3)} <span className="text-xs text-cyan-300">km/h</span>
                  </div>
                </div>
                <Navigation className="h-5 w-5 text-fuchsia-400" />
              </div>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
}
