interface Props {
  chips: string[];
  /** Taps behave exactly like saying the phrase. */
  onSay?: (phrase: string) => void;
}

/** "Say" chips: hints of what you can say, not buttons. The likeliest phrase is filled. */
export function SayChips({ chips, onSay }: Props) {
  if (!chips.length) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 12 }} className="os1-fade">
      <span className="os1-label" style={{ fontSize: 11, color: "var(--on-coral-dim)", marginRight: 4 }}>
        Say
      </span>
      {chips.map((chip, i) => (
        <button
          key={chip}
          type="button"
          onClick={() => onSay?.(chip)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            padding: "9px 18px 9px 14px",
            borderRadius: 999,
            border: `1px solid ${i === 0 ? "transparent" : "var(--on-coral-faint)"}`,
            background: i === 0 ? "var(--paper)" : "rgba(255,253,249,0.08)",
            color: i === 0 ? "var(--coral-deep)" : "var(--on-coral)",
            font: "italic 300 18px var(--font-sans)",
            cursor: "pointer",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 11,
              height: 11,
              borderRadius: "50%",
              border: `1.6px solid ${i === 0 ? "var(--coral)" : "var(--on-coral)"}`,
            }}
          />
          “{chip}”
        </button>
      ))}
    </div>
  );
}
