import { useEffect, useRef } from "react";
import { animate, useMotionValue, useTransform, motion } from "framer-motion";

import { formatNumber } from "@/lib/converters/distance";

type Props = {
  value: number;
  className?: string;
};

/** Smoothly tweens between numeric values like a digital odometer. */
export function AnimatedNumber({ value, className }: Props) {
  const mv = useMotionValue(value);
  const display = useTransform(mv, (v) => formatNumber(v));
  const last = useRef(value);

  useEffect(() => {
    const controls = animate(mv, value, {
      duration: 0.55,
      ease: [0.22, 1, 0.36, 1],
    });
    last.current = value;
    return controls.stop;
  }, [value, mv]);

  return <motion.span className={className}>{display}</motion.span>;
}
