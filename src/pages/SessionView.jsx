import { useState } from "react";
import MapView from "../components/session/MapView";
import { RightPanel } from "../components/session/RightPanel";
import { ScenePanel } from "../components/session/ScenePanel";
import { BackstoryScreen } from "../components/session/BackstoryScreen.jsx";
import { ConfirmModal } from "../components/common/ConfirmModal";
import { SPOTS, CYCLES, CYCLE_COLORS } from "../data/gameData";

export function SessionView({ gs, upd, sceneData, setSceneData, isGm, user, room }) {
  const [pendingAction, setPendingAction] = useState(null);

  // 探索フェイズ移行処理
  const doTransitionToExplore = () => {
    const startQuests = (gs.scenarioData?.quests ?? []).filter(q => (q.unlockType ?? "start") === "start");
    const clueCount = Math.ceil(((gs.pcs || []).length || 1) / 2);
    const shuffled = SPOTS.filter(s => s.roll !== null).sort(() => Math.random() - 0.5);
    const clueSpots = shuffled.slice(0, clueCount).map(s => s.id);

    upd(p => ({
      ...p,
      sessionPhase: "explore", day: 1, cycleIdx: 0,
      clues: clueSpots,
      quests: startQuests.map(q => ({ ...q, revealed: true, solved: false })),
      log: [`探索フェイズ開始。手がかりを${clueCount}箇所に配置。`, ...p.log],
    }));
    setPendingAction(null);
  };

  if (gs.sessionPhase === "intro") {
    return (
      <BackstoryScreen 
        gs={gs} isGm={isGm} 
        onProceed={() => upd(p => ({ ...p, sessionPhase: "intro_main" }))} 
      />
    );
  }

  const handleSpotClick = (spotId) => {
    // GMまたは自分の手番の移動中のみ反応
    if (isGm || gs.currentScene?.pcUid === user.uid) {
      upd(p => ({
        ...p,
        currentScene: { ...p.currentScene, selectedDestSpot: spotId }
      }));
    }
  };

  if (gs.sessionPhase === "intro") {
    return (
      <BackstoryScreen 
        gs={gs} 
        isGm={isGm} 
        onProceed={() => setPendingAction("toExplore")}
      />
    );
  }

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "#060810" }}>
      {/* メインエリア（マップ + シーン） */}
      <div style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column" }}>
        
        {/* シーン操作パネル（シーン中のみ表示） */}
        <ScenePanel 
          gs={gs} upd={upd} user={user} isGm={isGm}
          SPOTS={SPOTS}
          animateDice={() => {} /* App.jsx側のDiceロジックが必要なら統合 */} 
        />

        {/* マップ表示 */}
        <div style={{ flex: 1, position: "relative" }}>
          <MapView 
            gs={gs} 
            sceneData={sceneData} 
            isGm={isGm} 
            user={user} 
            onSpotClick={handleSpotClick} 
          />
        </div>
      </div>

      {/* 右パネル */}
      <RightPanel 
        gs={gs} upd={upd} isGm={isGm}
        CYCLES={CYCLES} 
        CYCLE_COLORS={CYCLE_COLORS}
        setPendingAction={setPendingAction}
      />

      {/* モーダル類 */}
      {pendingAction === "toExplore" && (
        <ConfirmModal 
          title="探索フェイズへ移行しますか？"
          body="導入を終了し、各PCが拠点から行動を開始します。"
          onOk={doTransitionToExplore}
          onCancel={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}