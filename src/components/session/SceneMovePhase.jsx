import { COLORS, COMMON_STYLES } from "../../styles/theme";
import { useDiceRoll } from "../../hooks/useDiceRoll";
import { DiceDisplay } from "../common/DiceDisplay";

export function SceneMovePhase({ gs, upd, pc, getSpot, animateDice }) {
  const sc = gs.currentScene;
  const { diceResult, diceAnim, animateDice } = useDiceRoll();

  const chooseMove = () => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "move_roll" } }));
  const chooseStay = () => {
    upd(p => {
      const newPcs = p.pcs.map(x => {
        if (x.uid !== pc.uid) return x;
        const r = x.resources.やる気;
        return { ...x, resources: { ...x.resources, やる気: { ...r, cur: Math.min(r.max, r.cur + 1) } } };
      });
      return { ...p, pcs: newPcs, currentScene: { ...p.currentScene, phase: "action" }, log: [`${pc.name} はその場に留まり、やる気を回復した`, ...p.log] };
    });
  };

  const rollMoveDice = () => {
    const count = pc.resources.やる気.cur || 1;
    animateDice(count, (results) => {
      upd(p => ({
        ...p,
        currentScene: { ...p.currentScene, moveDice: results }
      }));
    });
  };

  const selectDie = (val) => {
    if (val === 6) {
      upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "happening_roll" }, log: [`${pc.name} の移動で 6 が出た（ハプニング！）`, ...p.log] }));
    } else {
      upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "move_dest", selectedMoveDie: val } }));
    }
  };

  return (
    <div>
      {sc.phase === "move_or_stay" && (
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={chooseMove} style={COMMON_STYLES.btn(COLORS.blueBg, COLORS.blueBorder, COLORS.blue, { flex: 1 })}>移動する</button>
          <button onClick={chooseStay} style={COMMON_STYLES.btn(COLORS.greenBg, COLORS.greenBorder, COLORS.green, { flex: 1 })}>留まる</button>
        </div>
      )}
      {sc.phase === "move_roll" && (
        <div style={{ textAlign: "center" }}>
          {!sc.moveDice?.length ? (
            <button onClick={rollMoveDice} disabled={diceAnim}>🎲 ダイスを振る</button>
          ) : (
            <DiceDisplay dice={diceResult} isRolling={diceAnim} />
          )}
        </div>
      )}
      {sc.phase === "move_dest" && (
        <div style={{ textAlign: "center", fontSize: 11, color: COLORS.gold }}>
          マップ上のスポットを選択してください (最大 {sc.selectedMoveDie} マス)
          {sc.selectedDestSpot && (
            <button 
              onClick={() => {
                upd(p => {
                  const newPcs = p.pcs.map(x => x.uid === pc.uid ? { ...x, currentSpot: sc.selectedDestSpot } : x);
                  return { ...p, pcs: newPcs, currentScene: { ...p.currentScene, phase: "action" } };
                })
              }}
              style={COMMON_STYLES.btn(COLORS.blueBg, COLORS.blueBorder, COLORS.blue, { marginTop: 8, width: "100%" })}
            >
              {getSpot(sc.selectedDestSpot)?.name} へ移動
            </button>
          )}
        </div>
      )}
    </div>
  );
}