import { COLORS, COMMON_STYLES } from "../../styles/theme";
import { SPOT_DETAILS } from "../../data/spots";
import { getSpotById } from "../../data/gameData";
import { useDiceRoll } from "../../hooks/useDiceRoll";

export function SceneExplorePhase({ gs, upd, pc, SPOTS }) {
  const { startRoll } = useDiceRoll(upd);
  const sc = gs.currentScene;
  const spotDetail = SPOT_DETAILS[pc.currentSpot];

  const rollExplore = () => {
    startRoll(sc.actionDiceCount, "行為判定", (nextGs, res) => {
      return { ...nextGs, currentScene: { ...nextGs.currentScene, phase: "explore_result", actionDice: res } };
    });
  };

  return (
    <div>
      {sc.phase === "action" && (
        <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "explore_select" } }))} style={COMMON_STYLES.btn(COLORS.greenBg, COLORS.greenBorder, COLORS.green, { width: "100%" })}>🔍 探索イベントを実行</button>
      )}
      {sc.phase === "explore_select" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {spotDetail?.events.map((ev, i) => (
            <button key={i} onClick={() => startRoll(ev)} style={COMMON_STYLES.btn("rgba(255,255,255,0.05)", COLORS.border, COLORS.text, { textAlign: "left", fontSize: 10 })}>
              {ev.name} (目標:{ev.target})
            </button>
          ))}
        </div>
      )}
      {sc.phase === "explore_roll" && (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, marginBottom: 8 }}>目標値: {sc.selectedEvent.target}</div>
          <button onClick={rollExplore} style={COMMON_STYLES.btn(COLORS.goldBg, COLORS.goldDim, COLORS.gold)}>🎲 ダイスを振る</button>
        </div>
      )}
      {sc.phase === "explore_result" && (
        <div style={{ textAlign: "center" }}>
          <div style={{ display: "flex", gap: 4, justifyContent: "center", marginBottom: 8 }}>
            {sc.actionDice.map((d, i) => <div key={i} style={{ width: 30, height: 30, background: "#0b0d14", border: `1px solid ${COLORS.blue}`, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center" }}>{d}</div>)}
          </div>
          <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "action_done" } }))} style={COMMON_STYLES.btn(COLORS.blueBg, COLORS.blueBorder, COLORS.blue)}>次へ</button>
        </div>
      )}
    </div>
  );
}