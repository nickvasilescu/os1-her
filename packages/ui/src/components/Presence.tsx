import { useEffect, useRef } from "react";

/** Presence states from the component kit (Paper S1 · 01). */
export type PresenceState = "asleep" | "listening" | "thinking" | "speaking" | "working";

interface Props {
  state: PresenceState;
  /** 0..1, sampled every frame: her voice while speaking, the user's while listening. */
  getLevel: () => number;
  /** Ribbon width in px. */
  size?: number;
}

const FIBERS = 9;

/**
 * Her presence: a ring when listening/asleep, a three-lobe ribbon of fine fibers with
 * pointed ends when thinking/speaking, an arc while working elsewhere.
 * Drawn on canvas so amplitude can follow audio at 60 fps without React re-renders.
 */
export function Presence({ state, getLevel, size = 440 }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const levelRef = useRef(getLevel);
  const stateRef = useRef(state);
  levelRef.current = getLevel;
  stateRef.current = state;

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = size;
    const h = size * 0.42;
    el.width = w * dpr;
    el.height = h * dpr;
    ctx.scale(dpr, dpr);

    let frame = 0;
    let smooth = 0;
    let ribbon = 0; // 0 = ring, 1 = ribbon (morph)
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const draw = (t: number) => {
      const s = stateRef.current;
      smooth += (Math.min(1, levelRef.current() * 2.2) - smooth) * 0.18;
      const wantRibbon = s === "speaking" || s === "thinking" ? 1 : 0;
      ribbon += (wantRibbon - ribbon) * 0.08;
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = "round";
      const cx = w / 2;
      const cy = h / 2;
      const time = reduced ? 0 : t / 1000;

      if (ribbon < 0.98) {
        // Ring (asleep / listening / working)
        const alpha = (1 - ribbon) * (s === "asleep" ? 0.35 : 1);
        const breathe = s === "listening" ? 1 + smooth * 0.12 + Math.sin(time * 1.6) * 0.015 : 1;
        const r = h * 0.3 * breathe;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = "#fffdf9";
        ctx.lineWidth = s === "asleep" ? 1.2 : 2.4;
        ctx.shadowColor = "rgba(255,253,249,0.8)";
        ctx.shadowBlur = s === "listening" ? 18 + smooth * 30 : 6;
        ctx.beginPath();
        if (s === "working") {
          const start = time * 2.2;
          ctx.arc(cx, cy, r, start, start + Math.PI * 1.55);
        } else {
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
        }
        ctx.stroke();
        ctx.restore();
      }

      if (ribbon > 0.02) {
        // Ribbon: two mirrored sine bundles crossing twice -> three lobes, pointed ends.
        const span = w * (s === "thinking" ? 0.55 : 0.82);
        const amp = h * (s === "thinking" ? 0.16 : 0.2 + smooth * 0.22);
        ctx.save();
        ctx.globalAlpha = ribbon;
        ctx.strokeStyle = "#fffdf9";
        for (let f = 0; f < FIBERS; f++) {
          const jitter = (f - FIBERS / 2) / FIBERS;
          for (const sign of [1, -1]) {
            ctx.beginPath();
            ctx.lineWidth = f === Math.floor(FIBERS / 2) ? 1.6 : 0.7;
            ctx.globalAlpha = ribbon * (0.35 + 0.65 * (1 - Math.abs(jitter) * 1.6));
            for (let i = 0; i <= 120; i++) {
              const u = i / 120;
              const x = cx - span / 2 + u * span;
              const envelope = Math.pow(Math.sin(Math.PI * u), 0.75);
              const wobble = 1 + jitter * 0.18 * Math.sin(time * 1.3 + f);
              const y = cy + sign * amp * wobble * envelope * Math.sin(3 * Math.PI * u + jitter * 0.12);
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();
          }
        }
        ctx.restore();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [size]);

  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label={`Samantha is ${state}`}
      style={{ width: size, height: size * 0.42, maxWidth: "100%", display: "block" }}
    />
  );
}
