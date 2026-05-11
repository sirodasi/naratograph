import { useState } from "react";
import { COLORS, COMMON_STYLES } from "../../styles/theme";
import { PCCard } from "./PCCard";

export function RightPanel({ gs, upd, isGm, getSpot, CYCLES, CYCLE_COLORS }) {
  const [tab, setTab] = useState("progress");
  const cycleIdx = gs.cycleIdx || 0;

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
              <PCCard key={pc.uid} pc={pc} gs={gs} isGm={isGm} getSpot={getSpot} onUpdatePc={(updPc) => upd(p => ({ ...p, pcs: p.pcs.map(x => x.uid === pc.uid ? updPc : x) }))} />
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