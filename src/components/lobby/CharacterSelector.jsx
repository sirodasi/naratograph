import { useState } from "react";
import { CHARACTERS } from "../../data/characters";
import CharSprite from "../common/CharSprite";
import { COLORS, COMMON_STYLES } from "../../styles/theme";

export default function CharacterSelector({ selectedChar, onSelect, roomPlayers, onConfirm }) {
  const [customForm, setCustomForm] = useState(false);
  const [custom, setCustom] = useState({ name: "", tags: "", base: "", abilitySkillName: "", abilitySkillType: "アクション", abilitySkillDesc: "", danmakuSkillName: "", danmakuSkillDesc: "", sc1name: "", sc1desc: "", sc2name: "", sc2desc: "", portrait: null });

  const addCustom = () => {
    const c = {
      id: "custom_" + Date.now(), name: custom.name || "カスタムキャラ",
      spriteRow: -1, spriteCol: -1, customPortrait: custom.portrait,
      tags: custom.tags.split(/[、,]/).map(t => t.trim()).filter(Boolean),
      base: custom.base,
      abilitySkill: { name: custom.abilitySkillName, type: custom.abilitySkillType, desc: custom.abilitySkillDesc },
      danmakuSkill: { name: custom.danmakuSkillName, desc: custom.danmakuSkillDesc },
      spellCards: [custom.sc1name, custom.sc2name].filter(Boolean)
    };
    onSelect(c);
    setCustomForm(false);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 13, color: COLORS.gold }}>② キャラクターを選択</div>
        <button onClick={() => setCustomForm(true)} style={COMMON_STYLES.btn("rgba(255,255,255,0.04)", COLORS.border, COLORS.textDim, { padding: "4px 10px" })}>＋ カスタム</button>
      </div>
      
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(78px,1fr))", gap: 5, marginBottom: 16, maxHeight: 300, overflowY: "auto" }}>
        {CHARACTERS.map(c => {
          const taken = Object.values(roomPlayers || {}).some(p => p.charId === c.id);
          const isSel = selectedChar?.id === c.id;
          return (
            <div key={c.id} onClick={() => !taken && onSelect(c)} style={{ border: `2px solid ${isSel ? COLORS.gold : "transparent"}`, borderRadius: 5, padding: 4, cursor: taken ? "not-allowed" : "pointer", background: isSel ? COLORS.goldBg : "rgba(255,255,255,0.02)", opacity: taken ? 0.3 : 1, textAlign: "center" }}>
              <CharSprite spriteRow={c.spriteRow} spriteCol={c.spriteCol} size={60} />
              <div style={{ fontSize: 8, color: COLORS.textDim, marginTop: 2 }}>{c.name}</div>
            </div>
          );
        })}
      </div>

      {selectedChar && (
        <div style={{ padding: 14, background: COLORS.goldBg, border: `1px solid ${COLORS.goldDim}`, borderRadius: 6 }}>
          <div style={{ fontSize: 15, color: COLORS.gold }}>{selectedChar.name}</div>
          <div style={{ fontSize: 10, color: COLORS.textDim, marginBottom: 8 }}>拠点: {selectedChar.base}</div>
          <button onClick={onConfirm} style={COMMON_STYLES.btn(COLORS.goldBg, COLORS.goldDim, COLORS.gold, { width: "100%" })}>このキャラで決定 →</button>
        </div>
      )}

      {customForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#0c1020", padding: 20, borderRadius: 6, width: 300 }}>
            <div style={{ fontSize: 12, color: COLORS.gold, marginBottom: 10 }}>カスタムキャラクター</div>
            <input placeholder="名前" style={{ ...COMMON_STYLES.input, marginBottom: 8 }} onChange={e => setCustom({ ...custom, name: e.target.value })} />
            <input placeholder="拠点" style={{ ...COMMON_STYLES.input, marginBottom: 12 }} onChange={e => setCustom({ ...custom, base: e.target.value })} />
            <button onClick={addCustom} style={COMMON_STYLES.btn(COLORS.greenBg, COLORS.greenBorder, COLORS.green, { width: "100%", marginBottom: 8 })}>作成</button>
            <button onClick={() => setCustomForm(false)} style={COMMON_STYLES.btn("none", COLORS.border, COLORS.textFaint, { width: "100%" })}>キャンセル</button>
          </div>
        </div>
      )}
    </div>
  );
}