import { useEffect, useRef, useState } from "react";
import { useNarrow } from "./useNarrow";
import type { ActiveSurface, PendingAction, RememberedShimmer, UndoToast } from "../types";

/**
 * Paper S2 Modals — unified overlay for asking (`shared`), interrupting (`triage`),
 * computer confirmation (`computer`), and high-stakes read-back (`money` / `forget`).
 */
export function PendingActionModal({
  action,
  onRespond,
}: {
  action: PendingAction;
  onRespond: (actionId: string, choice: string) => void;
}) {
  const highStakes = action.stakes === "money" || action.stakes === "forget";
  const eyebrow =
    action.stakes === "forget"
      ? "Really gone · read-back confirmation"
      : action.stakes === "money"
        ? "Money · read-back confirmation"
        : action.stakes === "computer"
          ? "Your Mac · bounded action"
          : action.source === "triage"
            ? "Urgent interruption"
            : "Checking with you first";

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(32, 12, 6, 0.52)",
        backdropFilter: "blur(10px)",
        display: "grid",
        placeItems: "center",
        padding: 32,
        zIndex: 50,
      }}
    >
      <div
        className="os1-paper-card os1-fade"
        style={{
          width: "100%",
          maxWidth: 540,
          padding: 30,
          display: "grid",
          gap: 18,
          border: highStakes ? "2px solid var(--crimson)" : undefined,
        }}
      >
        <div className="os1-mono" style={{ fontSize: 11, color: highStakes ? "var(--crimson)" : "var(--coral)" }}>
          {eyebrow}
        </div>
        <h3 style={{ margin: 0, font: "300 28px/1.2 var(--font-sans)", color: "var(--ink)" }}>{action.title}</h3>
        {action.summaryLines.length > 0 && (
          <div
            style={{
              padding: "14px 16px",
              borderRadius: 14,
              background: highStakes ? "rgba(168, 39, 60, 0.06)" : "rgba(237, 215, 189, 0.44)",
              display: "grid",
              gap: 8,
            }}
          >
            {action.summaryLines.map((line) => (
              <div key={line} style={{ font: "400 15px/1.45 var(--font-sans)", color: "var(--ink)" }}>
                {line}
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
          {action.options.map((opt, idx) => {
            const isDanger = highStakes && idx === 0;
            const isPrimary = !highStakes && idx === 0;
            return (
              <button
                key={opt.choice}
                type="button"
                className={`os1-pill-ink ${isDanger ? "danger" : isPrimary ? "primary" : ""}`}
                onClick={() => onRespond(action.id, opt.choice)}
              >
                “{opt.phrase}”
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 60-second Undo Toast ("Moved 4 newsletters to Trash · Say 'undo that'"). */
export function UndoToastBar({ toast, onUndo }: { toast: UndoToast; onUndo: (id: string) => void }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil(toast.expiresAt - Date.now() / 1000)));
  useEffect(() => {
    const id = window.setInterval(() => {
      setRemaining(Math.max(0, Math.ceil(toast.expiresAt - Date.now() / 1000)));
    }, 500);
    return () => window.clearInterval(id);
  }, [toast.expiresAt]);
  if (remaining <= 0) return null;

  return (
    <div
      className="os1-fade"
      style={{
        position: "fixed",
        bottom: 72,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "10px 16px 10px 20px",
        borderRadius: 999,
        background: "var(--paper)",
        color: "var(--ink)",
        boxShadow: "0 14px 40px rgba(32, 12, 6, 0.3)",
        zIndex: 45,
      }}
    >
      <span style={{ font: "400 14px var(--font-sans)" }}>{toast.label}</span>
      <span className="os1-mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>
        {remaining}s
      </span>
      <button
        type="button"
        className="os1-pill-ink primary"
        style={{ padding: "5px 12px", fontSize: 12 }}
        onClick={() => onUndo(toast.id)}
      >
        “Undo that”
      </button>
    </div>
  );
}

/** Tactile "Remembered" shimmer when a new moment is saved into the Memory Ledger. */
export function RememberedShimmerBadge({ shimmer }: { shimmer: RememberedShimmer }) {
  return (
    <div
      className="os1-toast"
      style={{
        background: "rgba(255, 253, 249, 0.22)",
        border: "1px solid rgba(255, 253, 249, 0.45)",
        animation: "os1-fade 300ms var(--ease-soft) both, os1-pulse-ring 1.8s ease-out infinite",
      }}
    >
      ✦ Remembered · {shimmer.summary.slice(0, 48)}
    </div>
  );
}

const DOCK_ITEMS: { surface: ActiveSurface; label: string }[] = [
  { surface: "conversation", label: "Talk" },
  { surface: "home", label: "Home" },
  { surface: "inbox_cascade", label: "Inbox" },
  { surface: "her_computer", label: "Cloud" },
  { surface: "your_computer", label: "My Mac" },
  { surface: "swarm", label: "Swarm" },
  { surface: "made_just_now", label: "Canvas" },
  { surface: "memory", label: "Memory" },
  { surface: "atlas", label: "Atlas" },
  { surface: "apps", label: "Services" },
  { surface: "connectors", label: "Connectors" },
  { surface: "voice_picker", label: "Voice" },
];

const PHONE_PRIMARY: ActiveSurface[] = ["conversation", "home", "inbox_cascade", "atlas", "apps"];

/** Quiet bottom whisper dock so every Paper surface is reachable by voice OR pointer.
 *  On a phone it shows five main places plus "More", which opens the rest as a sheet. */
export function AmbientDock({ active, onSelect }: { active: ActiveSurface; onSelect: (s: ActiveSurface) => void }) {
  const dockRef = useRef<HTMLElement>(null);
  const narrow = useNarrow();
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = dockRef.current?.querySelector<HTMLButtonElement>('button[data-active="true"]');
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [active]);
  useEffect(() => setMore(false), [active]);

  const pick = (s: ActiveSurface) => {
    setMore(false);
    onSelect(s);
  };
  const primary = narrow ? DOCK_ITEMS.filter((i) => PHONE_PRIMARY.includes(i.surface)) : DOCK_ITEMS;
  const rest = DOCK_ITEMS.filter((i) => !PHONE_PRIMARY.includes(i.surface));
  const activeInRest = narrow && rest.some((i) => i.surface === active);

  return (
    <>
      {narrow && more && (
        <div className="os1-dock-more" role="menu" aria-label="More places">
          {rest.map((item) => (
            <button
              key={item.surface}
              type="button"
              role="menuitem"
              data-active={active === item.surface}
              onClick={() => pick(item.surface)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      <nav ref={dockRef} className="os1-dock" aria-label="OS1 surfaces">
        {primary.map((item) => (
          <button key={item.surface} type="button" data-active={active === item.surface} onClick={() => pick(item.surface)}>
            {item.label}
          </button>
        ))}
        {narrow && (
          <button type="button" data-active={more || activeInRest} aria-expanded={more} onClick={() => setMore((m) => !m)}>
            {activeInRest && !more ? (rest.find((i) => i.surface === active)?.label ?? "More") : "More"}
          </button>
        )}
      </nav>
    </>
  );
}
