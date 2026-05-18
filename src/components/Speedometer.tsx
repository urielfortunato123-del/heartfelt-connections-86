import { motion } from "framer-motion";

type Props = {
  /** 0..1 progress */
  progress: number;
  /** Display label, e.g. "100" */
  label: string;
  /** Unit text, e.g. "km/h" */
  unit: string;
};

const SIZE = 280;
const CENTER = SIZE / 2;
const RADIUS = 110;
const START = Math.PI * 0.75; // 135deg
const END = Math.PI * 2.25; // 405deg => 270deg sweep

function polar(angle: number, r: number) {
  return { x: CENTER + Math.cos(angle) * r, y: CENTER + Math.sin(angle) * r };
}

function arcPath(r: number, from: number, to: number) {
  const a = polar(from, r);
  const b = polar(to, r);
  const large = to - from > Math.PI ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
}

export function Speedometer({ progress, label, unit }: Props) {
  const clamped = Math.min(1, Math.max(0, progress));
  const angle = START + (END - START) * clamped;
  const needle = polar(angle, RADIUS - 18);

  const ticks = Array.from({ length: 25 }).map((_, i) => {
    const t = i / 24;
    const a = START + (END - START) * t;
    const isMajor = i % 4 === 0;
    const inner = polar(a, RADIUS - (isMajor ? 18 : 12));
    const outer = polar(a, RADIUS);
    const active = t <= clamped;
    return { inner, outer, isMajor, active };
  });

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="h-full w-full"
      role="img"
      aria-label={`Speedometer showing ${label} ${unit}`}
    >
      <defs>
        <linearGradient id="speed-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
        <filter id="speed-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Outer ring */}
      <circle
        cx={CENTER}
        cy={CENTER}
        r={RADIUS + 14}
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={1}
      />

      {/* Background arc */}
      <path
        d={arcPath(RADIUS, START, END)}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={2}
      />

      {/* Active arc */}
      <motion.path
        d={arcPath(RADIUS, START, END)}
        fill="none"
        stroke="url(#speed-gradient)"
        strokeWidth={3}
        strokeLinecap="round"
        filter="url(#speed-glow)"
        pathLength={1}
        initial={false}
        animate={{ strokeDasharray: `${clamped} 1` }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      />

      {/* Ticks */}
      {ticks.map((t, i) => (
        <line
          key={i}
          x1={t.inner.x}
          y1={t.inner.y}
          x2={t.outer.x}
          y2={t.outer.y}
          stroke={t.active ? (t.isMajor ? "#22d3ee" : "#a855f7") : "rgba(255,255,255,0.15)"}
          strokeWidth={t.isMajor ? 2 : 1}
          opacity={t.active ? 1 : 0.6}
        />
      ))}

      {/* Needle */}
      <motion.line
        x1={CENTER}
        y1={CENTER}
        x2={needle.x}
        y2={needle.y}
        stroke="#fff"
        strokeWidth={2}
        strokeLinecap="round"
        filter="url(#speed-glow)"
        initial={false}
        animate={{ x2: needle.x, y2: needle.y }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      />
      <circle cx={CENTER} cy={CENTER} r={6} fill="#22d3ee" filter="url(#speed-glow)" />

      {/* Center text */}
      <text
        x={CENTER}
        y={CENTER + 50}
        textAnchor="middle"
        fill="#fff"
        fontSize={32}
        fontWeight={300}
        fontFamily="monospace"
      >
        {label}
      </text>
      <text
        x={CENTER}
        y={CENTER + 70}
        textAnchor="middle"
        fill="rgba(255,255,255,0.4)"
        fontSize={10}
        letterSpacing={4}
        fontFamily="monospace"
      >
        {unit.toUpperCase()}
      </text>
    </svg>
  );
}
