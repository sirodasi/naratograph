import { useState, useRef } from "react";
import { PERSONALITY_SKILLS } from "../../data/personalitySkills";
import { COLORS, COMMON_STYLES } from "../../styles/theme";

export default function SkillSelector({ selectedId, onSelect, onConfirm }) {
  const [dice, setDice] = useState([1, 1]);
  const [rolling, setRolling] = useState(false);
  const timer = useRef(null);

  const roll = () => {
    setRolling(true);
    let count = 0;
    timer.current = setInterval(() => {
      const d1 = Math.floor(Math.random() * 6) + 1;
      const d2 = Math.floor(Math.random() * 6) + 1;
      setDice([d1, d2]);
      if (++count > 15) {
        clearInterval(timer.current);
        setRolling(false);
        const lo = Math.min(d1, d2), hi = Math.max(d1, d2);
        onSelect(lo * 10 + hi);
      }
    }, 60);
  };

  const skill = PERSONALITY_SKILLS[selectedId];

  return (
    <div>
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <button onClick={roll} style={COMMON_STYLES.btn(COLORS.redBg, COLORS.redBorder, COLORS.red)}>🎲 D66を振る</button>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 10 }}>
          {dice.map((d, i) => (
            <div key={i} style={{ width: 40, height: 40, border: "2px solid #1e3a5a", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: "#60c0f0", fontWeight: "bold" }}>{d}</div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, maxHeight: 200, overflowY: "auto", marginBottom: 16 }}>
        {Object.entries(PERSONALITY_SKILLS).map(([id, s]) => (
          <div key={id} onClick={() => onSelect(parseInt(id))} style={{ padding: 6, borderRadius: 4, cursor: "pointer", background: selectedId == id ? COLORS.goldBg : "rgba(255,255,255,0.02)", border: `1px solid ${selectedId == id ? COLORS.goldDim : "#111828"}` }}>
            <div style={{ fontSize: 10 }}>《{s.name}》</div>
          </div>
        ))}
      </div>

      {skill && (
        <div style={{ padding: 12, background: COLORS.goldBg, border: `1px solid ${COLORS.goldDim}`, borderRadius: 5, marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: COLORS.gold }}>《{skill.name}》</div>
          <div style={{ fontSize: 9, color: COLORS.textDim }}>{skill.desc}</div>
        </div>
      )}
      <button onClick={onConfirm} disabled={!selectedId} style={COMMON_STYLES.btn(selectedId ? COLORS.goldBg : "rgba(255,255,255,0.02)", selectedId ? COLORS.goldDim : COLORS.border, selectedId ? COLORS.gold : COLORS.textFaint, { width: "100%" })}>決定 →</button>
    </div>
  );
}