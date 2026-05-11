import { SceneMovePhase } from "./SceneMovePhase";
import { SceneHappeningPhase } from "./SceneHappeningPhase";
import { SceneExplorePhase } from "./SceneExplorePhase";
import { COLORS, COMMON_STYLES } from "../../styles/theme";
import { getSpotById } from "../../data/gameData";

export function ScenePanel({ gs, upd, user, isGm, animateDice, SPOTS }) {
  const sc = gs.currentScene;
  if (!sc) return null;
  const pc = gs.pcs.find(p => p.uid === sc.pcUid);
  if (!pc) return null;
  const isMyTurn = pc.uid === user?.uid || isGm;

  const endScene = () => {
    upd(p => ({
      ...p,
      actedPcs: [...(p.actedPcs || []), pc.uid],
      currentScene: null,
      log: [`${pc.name} のシーンを終了した`, ...p.log]
    }));
  };

  return (
    <div style={{ padding: 10, background: "rgba(25,118,210,0.1)", borderBottom: `1px solid ${COLORS.blueBorder}` }}>
      {!isMyTurn ? (
        <div style={{ textAlign: "center", fontSize: 11, color: COLORS.textFaint }}>
          {pc.name} が操作中です...
        </div>
      ) : (
        <>
          {/* フェーズに応じたコンポーネントの切り替え */}
          {(sc.phase === "move_or_stay" || sc.phase === "move_roll" || sc.phase === "move_dest") && (
            <SceneMovePhase gs={gs} upd={upd} pc={pc} animateDice={animateDice} />
          )}
          
          {(sc.phase === "happening_roll" || sc.phase === "happening_result" || sc.phase.startsWith("happening_")) && (
            <SceneHappeningPhase gs={gs} upd={upd} pc={pc} animateDice={animateDice} SPOTS={SPOTS} />
          )}

          {(sc.phase === "action" || sc.phase.startsWith("explore_")) && (
            <SceneExplorePhase gs={gs} upd={upd} pc={pc} animateDice={animateDice} SPOTS={SPOTS} />
          )}

          {sc.phase === "action_done" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: COLORS.textDim, marginBottom: 8 }}>アクション完了</div>
              <button onClick={endScene} style={{ ...COMMON_STYLES.btn(COLORS.redBg, COLORS.redBorder, COLORS.red, { width: "100%" }) }}>
                🎬 シーンを終了する
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}