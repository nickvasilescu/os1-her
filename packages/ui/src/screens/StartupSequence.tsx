import { useEffect, useRef } from "react";
import { InfinityLoader } from "../components/InfinityLoader";
import { sound } from "../sound";

// Optional local boot audio: bundled when present locally, gracefully falls back to synthesized sound.boot() in public builds.
const _localBootAudio = import.meta.glob<string>("../assets/init_sound.mp3", { eager: true, import: "default" });
const initSoundUrl: string | null = Object.values(_localBootAudio)[0] ?? null;

/**
 * OS1 Startup Sequence — continuous 3D infinity-helix → ring WebGL animation
 * driven directly by `init_sound.mp3` (14.16 s) via `audio.currentTime` + live
 * WebAudio `AnalyserNode` energy so visuals and sound stay sample-locked:
 *   -0.90–0.00 s  coral field warms up; 3D infinity helix emerges and spins calmly
 *    0.00–5.20 s  accelerating pulses; gossamer echo filament trails the ribbon
 *    5.20–10.75 s 90° turn into depth + continuous parametric morph ∞ → O (zero swap)
 *   10.75–12.15 s locked radiant ring breathes across the resolving chord climax
 *   12.15–13.38 s graceful contraction to a warm point of light + silky dissolve
 *   13.38–14.16 s awaits `init_sound.mp3`'s natural reverb tail before handoff
 *
 * Click or press any key (except Cmd/Ctrl+Shift+M mute) to skip.
 */
const HELIX_START_MS = 180;
const PRE_ROLL_MS = 1350;
const SAFETY_TIMEOUT_MS = 22_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function StartupSequence({ onDone }: { onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const auraRef = useRef<HTMLDivElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLDivElement>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    let cancelled = false;
    let finished = false;
    let audio: HTMLAudioElement | null = null;
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let freqBuf: Uint8Array<ArrayBuffer> | null = null;
    let audioPlaying = false;
    let loader: InfinityLoader | null = null;

    const cleanupAudio = () => {
      audioPlaying = false;
      if (audio) {
        try {
          audio.pause();
          audio.currentTime = 0;
        } catch {
          /* ignore */
        }
        audio = null;
      }
      if (audioCtx) {
        void audioCtx.close().catch(() => undefined);
        audioCtx = null;
      }
      analyser = null;
      freqBuf = null;
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      cancelled = true;
      cleanupAudio();
      loader?.destroy();
      loader = null;
      onDoneRef.current();
    };

    // `#preview=startup&motion` forces full motion (useful on Linux displays with reduced-motion).
    const forceMotion = window.location.hash.includes("motion");
    if (!forceMotion && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (veilRef.current) veilRef.current.style.opacity = "0";
      if (markRef.current) markRef.current.style.opacity = "0.88";
      const id = window.setTimeout(finish, 1800);
      return () => window.clearTimeout(id);
    }

    const unsubMute = sound.onMuteChange((muted) => {
      if (audio) audio.muted = muted;
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "m") return;
      finish();
    };
    window.addEventListener("click", finish);
    window.addEventListener("keydown", onKeyDown);

    const safetyTimer = window.setTimeout(finish, SAFETY_TIMEOUT_MS);

    requestAnimationFrame(() => {
      if (veilRef.current) veilRef.current.style.opacity = "0";
    });

    const getAudioTime = (): number | null => {
      if (!audio || !audioPlaying || audio.paused || audio.ended) return null;
      return audio.currentTime;
    };

    const getAudioEnergy = (): number => {
      if (!analyser || !freqBuf || !audioPlaying || audio?.muted) return 0;
      analyser.getByteFrequencyData(freqBuf);
      // Warm harmonic band (bins 2..48 of 128) captures the swells & chord peak cleanly.
      let sum = 0;
      const start = 2;
      const end = Math.min(48, freqBuf.length);
      for (let i = start; i < end; i++) sum += freqBuf[i];
      return Math.min(1, sum / ((end - start) * 185));
    };

    const run = async () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        finish();
        return;
      }

      try {
        loader = new InfinityLoader(canvas, {
          mode: "startup",
          getAudioTime,
          getAudioEnergy,
          onGlowChange: (intensity) => {
            if (!auraRef.current) return;
            auraRef.current.style.opacity = String(0.18 + intensity * 0.65);
            auraRef.current.style.transform = `scale(${0.86 + intensity * 0.34})`;
          },
        });
      } catch {
        finish();
        return;
      }

      loader.onRingLocked = () => {
        // Fade the subtle wordmark out smoothly right as the ring contracts to a dot.
        if (!markRef.current) return;
        window.setTimeout(() => {
          if (cancelled || !markRef.current) return;
          markRef.current.style.transition = "opacity 650ms ease";
          markRef.current.style.opacity = "0";
        }, 550);
      };

      const visualComplete = new Promise<void>((resolve) => {
        if (loader) loader.onComplete = resolve;
      });

      await delay(HELIX_START_MS);
      if (cancelled || !loader) return;

      loader.start();
      if (markRef.current) markRef.current.style.opacity = "0.74";

      await delay(PRE_ROLL_MS);
      if (cancelled || !loader) return;

      let resolveAudioEnded!: () => void;
      const audioEnded = new Promise<void>((resolve) => {
        resolveAudioEnded = resolve;
      });

      if (initSoundUrl) {
        audio = new Audio(initSoundUrl);
        audio.preload = "auto";
        audio.muted = sound.muted;

        // Wire AnalyserNode so the 3D filament & coral aura breathe live with the audio.
        try {
          audioCtx = new AudioContext();
          const src = audioCtx.createMediaElementSource(audio);
          analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.78;
          freqBuf = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
          src.connect(analyser);
          analyser.connect(audioCtx.destination);
        } catch {
          analyser = null;
        }

        audio.addEventListener(
          "ended",
          () => {
            audioPlaying = false;
            resolveAudioEnded();
          },
          { once: true },
        );
        audio.addEventListener(
          "error",
          () => {
            audioPlaying = false;
            resolveAudioEnded();
          },
          { once: true },
        );

        try {
          await audioCtx?.resume().catch(() => undefined);
          await audio.play();
          audioPlaying = true;
        } catch {
          audioPlaying = false;
          resolveAudioEnded();
        }
      } else {
        // Public repo fallback when optional init_sound.mp3 is not present locally.
        sound.boot();
        resolveAudioEnded();
      }

      if (cancelled || !loader) return;
      loader.triggerTransition();

      await Promise.all([visualComplete, audioEnded]);
      if (cancelled) return;

      finish();
    };

    void run();

    return () => {
      cancelled = true;
      window.clearTimeout(safetyTimer);
      unsubMute();
      window.removeEventListener("click", finish);
      window.removeEventListener("keydown", onKeyDown);
      cleanupAudio();
      loader?.destroy();
      loader = null;
    };
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Subtle sunlit warm coral bloom behind the 3D filament */}
      <div
        ref={auraRef}
        style={{
          position: "fixed",
          width: "min(62vw, 680px)",
          height: "min(62vw, 680px)",
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(255, 224, 198, 0.34) 0%, rgba(236, 126, 92, 0.16) 38%, transparent 70%)",
          opacity: 0.18,
          transform: "scale(0.86)",
          pointerEvents: "none",
          willChange: "transform, opacity",
        }}
      />
      <canvas
        ref={canvasRef}
        style={{
          position: "relative",
          display: "block",
          pointerEvents: "none",
        }}
      />
      <div
        ref={markRef}
        aria-label="UAOS1"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 58,
          textAlign: "center",
          font: "200 32px/1 var(--font-sans)",
          letterSpacing: "0.04em",
          color: "var(--paper)",
          opacity: 0,
          transition: "opacity 900ms var(--ease-soft) 350ms",
          pointerEvents: "none",
        }}
      >
        UAOS<sup style={{ fontSize: 13, verticalAlign: "top", marginLeft: 1 }}>1</sup>
      </div>
      <div
        ref={veilRef}
        style={{
          position: "fixed",
          inset: 0,
          background: "#1d0a05",
          opacity: 1,
          transition: "opacity 600ms var(--ease-soft)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
