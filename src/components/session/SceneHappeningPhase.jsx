import { COLORS, COMMON_STYLES } from "../../styles/theme";
import { HAPPENING_TABLE } from "../../data/tables";
import { getSpotById } from "../../data/gameData";

export function SceneHappeningPhase({ gs, upd, pc, animateDice, SPOTS }) {
  const { startRoll } = useDiceRoll(upd);
  const sc = gs.currentScene;

  const rollHappening = () => {
  startRoll(1, "ハプニング表", (nextGs, res) => {
    return { ...nextGs, currentScene: { ...nextGs.currentScene, phase: "happening_result", happeningDice: res[0] } };
  });
};

  return (
    <div style={{ textAlign: "center" }}>
      {sc.phase === "happening_roll" && (
        <button onClick={rollHappening} style={COMMON_STYLES.btn(COLORS.redBg, COLORS.redBorder, COLORS.red)}>🎲 ハプニング表(1D6)を振る</button>
      )}
      {sc.phase === "happening_result" && (
        <div style={{ animation: "fadeUp 0.3s ease" }}>
          <div style={{ color: COLORS.red, fontSize: 14, fontWeight: "bold" }}>ハプニング: {HAPPENING_TABLE[sc.happeningDice].title}</div>
          <div style={{ fontSize: 10, color: COLORS.textDim, margin: "8px 0" }}>{HAPPENING_TABLE[sc.happeningDice].desc}</div>
          <button 
            onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "action" } }))}
            style={COMMON_STYLES.btn(COLORS.goldBg, COLORS.goldDim, COLORS.gold, { marginTop: 8 })}
          >
            確認
          </button>
        </div>
      )}
    </div>
  );
}