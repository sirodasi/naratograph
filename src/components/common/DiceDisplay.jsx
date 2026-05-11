import { useState, useEffect } from "react";
import { COLORS } from "../../styles/theme";

export function DiceDisplay({ dice, isRolling, count = 1, label }) {
  const [tempDice, setTempDice] = useState([]);

  useEffect(() => {
    let timer;
    if (isRolling) {
      timer = setInterval(() => {
        setTempDice(Array(count).fill(0).map(() => Math.floor(Math.random() * 6) + 1));
      }, 80);
    } else {
      setTempDice(dice || []);
    }
    return () => clearInterval(timer);
  }, [isRolling, dice, count]);

  if (!isRolling && (!dice || dice.length === 0)) return null;

  return (
    <div style={{ margin: "12px 0", textAlign: "center" }}>
      {label && <div style={{ fontSize: 10, color: COLORS.textFaint, marginBottom: 6 }}>{label}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        {tempDice.map((d, i) => (
          <div key={i} style={{
            width: 44, height: 44,
            border: `2px solid ${d === 6 ? COLORS.gold : COLORS.blueBorder}`,
            borderRadius: 6, background: "rgba(14,20,36,0.95)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22, color: d === 6 ? COLORS.gold : "#60c0f0", fontWeight: "bold",
            transform: isRolling ? `rotate(${Math.random() * 10 - 5}deg)` : "none"
          }}>
            {d}
          </div>
        ))}
      </div>
    </div>
  );
}