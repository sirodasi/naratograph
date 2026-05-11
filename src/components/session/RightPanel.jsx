import { useState } from "react";
import { COLORS, COMMON_STYLES } from "../../styles/theme";
import { PCCard } from "./PCCard";
import { getSpotById } from "../../data/gameData";
import { useDiceRoll } from "../../hooks/useDiceRoll";

export function RightPanel({ gs, upd, isGm, CYCLES, CYCLE_COLORS }) {
  const { startRoll } = useDiceRoll(upd);
  const [tab, setTab] = useState("progress");
  const cycleIdx = gs.cycleIdx || 0;

  const handleNewspaper = () => {
    startRoll(2, "文々。新聞表", (nextGs, res) => {
      const val = Math.min(res[0], res[1]) * 10 + Math.max(res[0], res[1]);
      const paper = NEWSPAPER[val] || { title: "記事なし", effect: "-" };
      return { ...nextGs, newspaper: { roll: val, ...paper }, log: [`新聞: ${paper.title}`, ...nextGs.log] };
    }, true);
  };

  const handleMorningClue = () => {
    startRoll(2, "手がかり配置", (nextGs, res) => {
      const val = Math.min(res[0], res[1]) * 10 + Math.max(res[0], res[1]);
      const spot = getSpotsByRoll(val)[0];
      return { 
        ...nextGs, 
        cluePlaced: true, 
        clues: [...new Set([...nextGs.clues, spot.id])],
        log: [`朝の手がかりを ${spot.name} に配置`, ...nextGs.log]
      };
    }, true);
  };

  return (
    <div style={{ width: 300, display: "flex", flexDirection: "column", background: "#0b0d14", borderLeft: `1px solid ${COLORS.border}` }}>
      {/* サイクル情報 */}
      <div style={{ padding: 10, borderBottom: `1px solid ${COLORS.border}`, textAlign: "center" }}>
        <div style={{ fontSize: 12, color: CYCLE_COLORS[cycleIdx] }}>{gs.day}日目・{CYCLES[cycleIdx]}</div>
      </div>

      {/* タブ切り替え */}
      <div style={{ display: "flex", borderBottom: `1px solid ${COLORS.border}` }}>
        {["progress", "pcs", "log"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: "8px", background: tab === t ? "rgba(255,255,255,0.05)" : "transparent", border: "none", color: tab === t ? COLORS.gold : COLORS.textFaint, fontSize: 10 }}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {/* コンテンツエリア */}
      <div style={{ flex: 1, overflowY: "auto", padding: 10 }}>
        {tab === "progress" && (
          <div>
            <div style={{ fontSize: 9, color: COLORS.textFaint, marginBottom: 8 }}>クエスト状況</div>
            {gs.quests.map(q => (
              <div key={q.id} style={{ padding: 6, background: "rgba(255,255,255,0.02)", border: `1px solid ${COLORS.border}`, marginBottom: 4, borderRadius: 4 }}>
                <div style={{ fontSize: 10, color: COLORS.gold }}>{q.name}</div>
              </div>
            ))}
          </div>
        )}

        {tab === "pcs" && (
          <div>
            {gs.pcs.map(pc => (
              <PCCard key={pc.uid} pc={pc} gs={gs} isGm={isGm} onUpdatePc={(updPc) => upd(p => ({ ...p, pcs: p.pcs.map(x => x.uid === pc.uid ? updPc : x) }))} />
            ))}
          </div>
        )}

        {tab === "log" && (
          <div style={{ fontSize: 10, color: COLORS.textDim }}>
            {gs.log.map((l, i) => <div key={i} style={{ marginBottom: 4, borderBottom: "1px solid #111" }}>{l}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}