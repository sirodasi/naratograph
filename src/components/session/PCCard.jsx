import { useState } from "react";
import { CharSprite } from "../common/CharSprite";
import { COLORS, COMMON_STYLES } from "../../styles/theme";
import { ITEM_DATA, INIT_ITEMS, INIT_RESOURCES } from "../../data/items";
import { PERSONALITY_SKILLS } from "../../data/personalitySkills";
import { BAD_STATUS_TABLE } from "../../data/tables";

export function PCCard({ pc, gs, isGm, onUpdatePc, getSpot }) {
  const [expanded, setExpanded] = useState(false);
  const [gmEdit, setGmEdit] = useState(false);
  const resources = pc.resources || INIT_RESOURCES();
  const items = pc.items || INIT_ITEMS();
  const skill = pc.skillId ? PERSONALITY_SKILLS[pc.skillId] : null;
  const isActing = gs.currentScene?.pcUid === pc.uid;
  const hasActed = (gs.actedPcs || []).includes(pc.uid);

  return (
    <div style={{ 
      border: `1px solid ${isActing ? COLORS.blue : expanded ? "#2a3545" : COLORS.border}`,
      borderRadius: 5, marginBottom: 6, overflow: "hidden", background: "#0b0d14" 
    }}>
      {/* ヘッダー部分 */}
      <div 
        style={{ 
          display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", cursor: "pointer",
          background: isActing ? COLORS.blueBg : "rgba(255,255,255,0.01)" 
        }} 
        onClick={() => setExpanded(!expanded)}
      >
        <CharSprite spriteRow={pc.spriteRow} spriteCol={pc.spriteCol} size={36}/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: COLORS.text }}>{pc.name}</span>
            {isActing && <span style={{ fontSize: 9, color: COLORS.blue }}>▶ 行動中</span>}
          </div>
          <div style={{ fontSize: 9, color: COLORS.textFaint }}>
            {pc.charName} / {getSpot(pc.currentSpot)?.name || "-"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <span style={{ fontSize: 9, color: "#f9a825" }}>やる気{resources.やる気.cur}</span>
          <span style={{ fontSize: 9, color: "#ab47bc" }}>霊力{resources.霊力.cur}</span>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: "10px 12px", borderTop: `1px solid ${COLORS.border}` }}>
          {/* リソースグリッド */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginBottom: 10 }}>
            {Object.entries(resources).map(([k, r]) => (
              <div key={k} style={{ padding: "4px", background: "rgba(255,255,255,0.02)", border: `1px solid ${COLORS.border}`, textAlign: "center" }}>
                <div style={{ fontSize: 8, color: COLORS.textFaint }}>{k}</div>
                <div style={{ fontSize: 12, color: COLORS.gold }}>{r.cur}</div>
              </div>
            ))}
          </div>

          {/* アイテム一覧 */}
          <div style={{ fontSize: 9, color: COLORS.textFaint, marginBottom: 4 }}>アイテム</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {Object.entries(items).map(([name, count]) => count > 0 && (
              <div key={name} style={{ padding: "2px 6px", background: COLORS.goldBg, border: `1px solid ${COLORS.goldDim}`, borderRadius: 10, fontSize: 10, color: COLORS.gold }}>
                {name} x{count}
              </div>
            ))}
          </div>

          {/* スキル表示 */}
          {skill && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, color: COLORS.gold }}>《{skill.name}》</div>
              <div style={{ fontSize: 9, color: COLORS.textFaint }}>{skill.desc}</div>
            </div>
          )}

          {isGm && (
            <button 
              onClick={() => setGmEdit(!gmEdit)}
              style={{ ...COMMON_STYLES.btn("transparent", COLORS.border, COLORS.textFaint, { marginTop: 8, width: "100%", fontSize: 9 }) }}
            >
              GM編集モード切り替え
            </button>
          )}
        </div>
      )}
    </div>
  );
}