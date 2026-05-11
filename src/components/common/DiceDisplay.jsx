import { COLORS } from "../../styles/theme";

export function DiceDisplay({ dice, isRolling, label }) {
  if (!dice) return null;

  return (
    <div style={{ marginTop: 12, textAlign: "center", animation: "fadeUp 0.3s ease" }}>
      {label && <div style={{ fontSize: 10, color: COLORS.textFaint, marginBottom: 6 }}>{label}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        {dice.map((d, i) => (
          <div
            key={i}
            style={{
              width: 40, height: 40,
              border: `2px solid ${d === 6 ? COLORS.gold : COLORS.blueBorder}`,
              borderRadius: 6,
              background: "rgba(14,20,36,0.95)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 22, color: d === 6 ? COLORS.gold : "#60c0f0",
              fontWeight: "bold",
              // アニメーション中の揺れ
              animation: isRolling ? "rollSpin 0.25s ease infinite" : "none",
            }}
          >
            {d}
          </div>
        ))}
      </div>
      <style>{`
        @keyframes rollSpin {
          0% { transform: rotate(0deg) scale(1); }
          50% { transform: rotate(5deg) scale(1.1); }
          100% { transform: rotate(0deg) scale(1); }
        }
      `}</style>
    </div>
  );
}