// src/SessionView.jsx
import { useState, useEffect, useRef } from "react";
import { CharSprite, PERSONALITY_SKILLS } from "./Lobby";
import { SPOT_DETAILS } from "./data/spots";
import { EDGES } from "./data/gameData";
import { C } from "./styles/colors";
 
// ─── ユーティリティ ───────────────────────────────────────────────
export function getSpotByD66(d1, d2, SPOTS) {
  const val = Math.min(d1, d2) * 10 + Math.max(d1, d2);
  const candidates = SPOTS.filter(s => s.roll === val);
  if (candidates.length === 2) {
    return (d1 < d2 ? candidates.find(s => s.id.endsWith("A")) : candidates.find(s => s.id.endsWith("B")))?.id;
  } else if (candidates.length === 1) {
    return candidates[0].id;
  }
  return null;
}

// ─── アイテムデータ ───────────────────────────────────────────────
 
export const ITEM_DATA = {
  "お酒": {
    timing: "いつでも",
    desc:    "自身の【やる気】が「1点」回復します。",
    canUse:  pc => (pc.items?.["お酒"] || 0) > 0 && !(pc.badStatus ||[]).includes("二日酔い"),
    use: pc => {
      const resources = { ...pc.resources };
      if (!(pc.badStatus ||[]).includes("だるい")) {
        const r = resources.やる気 || { cur: 0, max: 3 };
        resources.やる気 = { cur: Math.min(r.cur + 1, r.max), max: r.max };
      }
      return { ...pc, items: { ...pc.items, "お酒": Math.max(0, (pc.items["お酒"] || 0) - 1) }, resources };
    },
  },
  "小銭": {
    timing: "行為判定直前",
    desc:    "次の行為判定の判定ダイス数が「1」増加します。",
    canUse:  pc => (pc.items?.["小銭"] || 0) > 0 && !(pc.badStatus ||[]).includes("二日酔い"),
    use: pc => ({ ...pc, items: { ...pc.items, "小銭": Math.max(0, (pc.items["小銭"] || 0) - 1) }, flags: { ...pc.flags, kosen: true } }),
  },
  "お守り": {
    timing: "移動処理中",
    desc:    "移動で「6」が出たとき、ハプニングが発生せず6マス先まで移動できます。",
    canUse:  pc => (pc.items?.["お守り"] || 0) > 0 && !(pc.badStatus ||[]).includes("二日酔い"),
    use: pc => ({ ...pc, items: { ...pc.items, "お守り": Math.max(0, (pc.items["お守り"] || 0) - 1) }, flags: { ...pc.flags, omamori: true } }),
  },
  "Pアイテム": {
    timing: "いつでも",
    desc:    "【霊力】を「3点」獲得します。",
    canUse:  pc => (pc.items?.["Pアイテム"] || 0) > 0 && !(pc.badStatus ||[]).includes("二日酔い"),
    use: pc => {
      const resources = { ...pc.resources };
      if (!(pc.badStatus ||[]).includes("スランプ")) {
        const r = resources.霊力 || { cur: 0, max: 30 };
        resources.霊力 = { cur: Math.min(r.cur + 3, r.max), max: r.max };
      }
      return { ...pc, items: { ...pc.items, "Pアイテム": Math.max(0, (pc.items["Pアイテム"] || 0) - 1) }, resources };
    },
  },
  "残機のかけら": {
    timing: "いつでも",
    desc:    "3つ消費して【残り人数】を「1点」獲得します。（3つ以上保持時のみ）",
    canUse:  pc => (pc.items?.["残機のかけら"] || 0) >= 3 && !(pc.badStatus ||[]).includes("二日酔い"),
    use: pc => {
      const resources = { ...pc.resources };
      const r = resources.残り人数 || { cur: 0, max: 5 };
      resources.残り人数 = { cur: Math.min(r.cur + 1, r.max), max: r.max };
      return { ...pc, items: { ...pc.items, "残機のかけら": Math.max(0, (pc.items["残機のかけら"] || 0) - 3) }, resources };
    },
  },
  "スペカのかけら": {
    timing: "いつでも",
    desc:    "2つ消費して【スペルカード】を「1点」獲得します。（2つ以上保持時のみ）",
    canUse:  pc => (pc.items?.["スペカかけら"] || 0) >= 2 && !(pc.badStatus ||[]).includes("二日酔い"),
    use: pc => {
      const resources = { ...pc.resources };
      const r = resources.スペカ || { cur: 0, max: 5 };
      resources.スペカ = { cur: Math.min(r.cur + 1, r.max), max: r.max };
      return { ...pc, items: { ...pc.items, "スペカかけら": Math.max(0, (pc.items["スペカかけら"] || 0) - 2) }, resources };
    },
  },
  "妖器": {
    timing: "弾幕ごっこ前",
    desc:    "1ラウンドの間【攻撃力】が1点増加します。（輝針城の限定アイテム）",
    canUse:  pc => (pc.items?.["妖器"] || 0) > 0 && !(pc.badStatus ||[]).includes("二日酔い"),
    use: pc => {
      const resources = { ...pc.resources };
      const r = resources.攻撃力 || { cur: 1, max: 5 };
      resources.攻撃力 = { cur: Math.min(r.cur + 1, r.max), max: r.max };
      return { ...pc, items: { ...pc.items, "妖器": Math.max(0, (pc.items["妖器"] || 0) - 1) }, resources, flags: { ...pc.flags, youki: true } };
    },
  },
};
 
export const INIT_RESOURCES = () => ({
  やる気:     { cur: 1, max: 3  },
  残り人数:   { cur: 2, max: 5  },
  スペカ:     { cur: 1, max: 5  },
  グレイズ:   { cur: 0, max: 5  },
  霊力:       { cur: 0, max: 20 },
  攻撃力:     { cur: 1, max: 5  },
});
 
export const INIT_ITEMS = () => ({
  お酒: 0, 小銭: 0, お守り: 0, Pアイテム: 0, 残機のかけら: 0, スペカかけら: 0, 妖器: 0,
});
 
export const BAD_STATUS_TABLE = {
  1: { name: "だるい",   desc: "あなたの【やる気】は「1点」となり、いかなる処理によっても回復しません。" },
  2: { name: "スランプ", desc: "いかなる処理によってもあなたの【霊力】は増加しなくなります。" },
  3: { name: "二日酔い", desc: "あなたはアイテムを使用することができません。" },
  4: { name: "怪我",     desc: "行為判定の際にダイスを2つまでしか振ることができなくなります。" },
  5: { name: "不機嫌",   desc: "あなたは絆を獲得できなくなり、他のキャラクターもあなたへの絆を獲得できません。" },
  6: { name: "疲れた",   desc: "「移動」の処理で移動できる距離が1スポット分少なくなります。" },
};
 
const SKILL_TYPE_COLOR = { "オート": "#81c784", "アクション": "#64b5f6", "サポート": "#ffb74d" };
 
const btnFull = (bg, border, color, extra = {}) => ({
  width: "100%", padding: "8px", borderRadius: 4, cursor: "pointer",
  background: bg, border: `1px solid ${border}`, color, fontSize: 12, ...extra,
});
 
const btnSmall = {
  width: 24, height: 24, background: "rgba(255,255,255,0.05)",
  border: `1px solid ${C.border}`, color: C.textFaint, borderRadius: 4, cursor: "pointer",
};
 
// ─── BackstoryScreen ──────────────────────────────────────────────
export function BackstoryScreen({ gs, isGm, onProceed }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { setTimeout(() => setVisible(true), 100); },[]);
  return (
    <div style={{ background: "#04060a", height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "serif", cursor: "pointer", padding: "40px 60px", boxSizing: "border-box" }} onClick={isGm ? onProceed : undefined}>
      <style>{`@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } } @keyframes pulse { 0%,100% { opacity: 0.5 } 50% { opacity: 1 } }`}</style>
      <div style={{ maxWidth: 760, animation: "fadeIn 1.2s ease", opacity: visible ? 1 : 0, transition: "opacity 1s" }}>
        <div style={{ fontSize: 11, color: "#4a6080", letterSpacing: 4, textAlign: "center", marginBottom: 16 }}>{gs.scenarioData?.name || "シナリオ"}</div>
        <div style={{ fontSize: 15, color: "#b8c8d8", lineHeight: 2.2, whiteSpace: "pre-wrap", textAlign: "justify" }}>{gs.scenarioData?.backstory || "（バックストーリー未設定）"}</div>
        {isGm
          ? <div style={{ textAlign: "center", marginTop: 40, animation: "pulse 2s ease infinite" }}><span style={{ fontSize: 11, color: "#3a5070", letterSpacing: 3 }}>▼ クリックして探索フェイズへ ▼</span></div>
          : <div style={{ textAlign: "center", marginTop: 40 }}><span style={{ fontSize: 10, color: "#2a3545", letterSpacing: 2 }}>GMがフェイズを進めるまでお待ちください…</span></div>
        }
      </div>
    </div>
  );
}
 
// ─── ConfirmModal ─────────────────────────────────────────────────
export function ConfirmModal({ title, body, onOk, onCancel, okLabel = "実行する", okColor = "#e07060" }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onCancel}>
      <div style={{ background: "#0c1020", border: "1px solid #1e2d45", borderRadius: 6, padding: 22, maxWidth: 360, width: "90%" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 13, color: C.gold, marginBottom: 8 }}>{title}</div>
        {body && <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.8, marginBottom: 16, whiteSpace: "pre-wrap" }}>{body}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onOk}     style={{ flex: 1, padding: "8px", cursor: "pointer", borderRadius: 3, background: `${okColor}20`, border: `1px solid ${okColor}80`, color: okColor, fontSize: 12 }}>{okLabel}</button>
          <button onClick={onCancel} style={{ flex: 1, padding: "8px", cursor: "pointer", borderRadius: 3, background: "rgba(255,255,255,0.03)", border: "1px solid #1e2535", color: C.textFaint, fontSize: 12 }}>キャンセル</button>
        </div>
      </div>
    </div>
  );
}
 
// ─── ItemUseModal ─────────────────────────────────────────────────
function ItemUseModal({ itemName, pc, onConfirm, onCancel }) {
  const data = ITEM_DATA[itemName];
  if (!data) return null;
  const canUse = data.canUse(pc);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onCancel}>
      <div style={{ background: "#0c1020", border: "1px solid #1e2d45", borderRadius: 6, padding: 20, maxWidth: 340, width: "90%" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 13, color: C.gold, marginBottom: 4 }}>【{itemName}】を使用する</div>
        <div style={{ fontSize: 10, color: "#5a7090", marginBottom: 4 }}>タイミング: {data.timing}</div>
        <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.8, marginBottom: 14 }}>{data.desc}</div>
        {!canUse && <div style={{ fontSize: 10, color: C.red, marginBottom: 8 }}>使用条件を満たしていません</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => canUse && onConfirm()} disabled={!canUse} style={{ flex: 1, padding: "8px", cursor: canUse ? "pointer" : "not-allowed", borderRadius: 3, background: canUse ? "rgba(200,160,64,0.2)" : "rgba(255,255,255,0.02)", border: canUse ? "1px solid #8b6914" : "1px solid #1e2535", color: canUse ? C.gold : "#2a3545", fontSize: 12 }}>使用する</button>
          <button onClick={onCancel} style={{ flex: 1, padding: "8px", cursor: "pointer", borderRadius: 3, background: "rgba(255,255,255,0.03)", border: "1px solid #1e2535", color: C.textFaint, fontSize: 12 }}>キャンセル</button>
        </div>
      </div>
    </div>
  );
}
 
// ─── SkillActivateModal ───────────────────────────────────────────
function SkillActivateModal({ skillName, skillType, desc, onConfirm, onCancel }) {
  const typeColor = SKILL_TYPE_COLOR[skillType] || C.text;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onCancel}>
      <div style={{ background: "#0c1020", border: "1px solid #1e2d45", borderRadius: 6, padding: 20, maxWidth: 360, width: "90%" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ padding: "2px 7px", background: `${typeColor}18`, border: `1px solid ${typeColor}50`, borderRadius: 10, fontSize: 9, color: typeColor }}>{skillType}</span>
          <span style={{ fontSize: 13, color: C.gold }}>《{skillName}》を発動する</span>
        </div>
        <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.8, marginBottom: 14 }}>{desc}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onConfirm} style={{ flex: 1, padding: "8px", cursor: "pointer", borderRadius: 3, background: "rgba(200,160,64,0.2)", border: "1px solid #8b6914", color: C.gold, fontSize: 12 }}>発動する</button>
          <button onClick={onCancel}  style={{ flex: 1, padding: "8px", cursor: "pointer", borderRadius: 3, background: "rgba(255,255,255,0.03)", border: "1px solid #1e2535", color: C.textFaint, fontSize: 12 }}>キャンセル</button>
        </div>
      </div>
    </div>
  );
}
 
// ─── PCCard ───────────────────────────────────────────────────────
export function PCCard({ pc, gs, isGm, onUpdatePc, getSpot }) {
  const[itemModal, setItemModal]   = useState(null);
  const [skillModal, setSkillModal] = useState(null);
  const[expanded, setExpanded]     = useState(false);
  const[gmEdit, setGmEdit]         = useState(false);
 
  const resources     = pc.resources || INIT_RESOURCES();
  const items         = pc.items     || INIT_ITEMS();
  const badStatus     = pc.badStatus ||[];
  const skill         = pc.skillId ? PERSONALITY_SKILLS[pc.skillId] : null;
  const isCustomChar  = pc.charId?.startsWith("custom_");
  const hasActed      = (gs.actedPcs ||[]).includes(pc.uid);
  const isActing      = gs.currentScene?.pcUid === pc.uid;
  const skillCanActivate = skill && skill.type !== "オート";
  const currentSpotName  = getSpot(pc.currentSpot)?.name || "-";
 
  const useItem = itemName => {
    const data = ITEM_DATA[itemName];
    if (!data) return;
    onUpdatePc(data.use(pc));
    setItemModal(null);
  };
 
  const activateSkill = () => {
    onUpdatePc({ ...pc, skillActivatedThisSession: (pc.skillActivatedThisSession || 0) + 1, log:[...(pc.log || []), `《${skill?.name}》を発動`] });
    setSkillModal(null);
  };
 
  const adjustResource = (key, delta) => {
    const r = resources[key] || { cur: 0, max: 1 };
    const newCur = Math.max(0, Math.min(r.cur + delta, r.max));
    const updated = { ...resources,[key]: { ...r, cur: newCur } };
    if (key === "霊力") updated.攻撃力 = { ...updated.攻撃力, cur: 1 + Math.floor(newCur / 5) };
    onUpdatePc({ ...pc, resources: updated });
  };
 
  const resKeys  =["やる気", "残り人数", "スペカ", "グレイズ", "霊力", "攻撃力"];
  const itemKeys = Object.keys(INIT_ITEMS());
 
  return (
    <div style={{ border: `1px solid ${isActing ? C.blue : expanded ? "#2a3545" : C.border}`, borderRadius: 5, marginBottom: 6, overflow: "hidden", transition: "border 0.2s" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", cursor: "pointer", background: isActing ? C.blueBg : expanded ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.01)" }} onClick={() => setExpanded(v => !v)}>
        <CharSprite spriteRow={pc.spriteRow ?? -1} spriteCol={pc.spriteCol ?? -1} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pc.name}</span>
            {isActing ? <span style={{ fontSize: 9, color: C.blue }}>▶ シーン進行中</span> : hasActed ? <span style={{ fontSize: 9, color: C.textFaint }}>✓ 行動済み</span> : <span style={{ fontSize: 9, color: C.gold }}>未行動</span>}
          </div>
          <div style={{ fontSize: 9, color: C.textFaint }}>
            {pc.charName} {(pc.tags ||[]).length > 0 && `《${pc.tags.join("》《")}》`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <span style={{ fontSize: 9, color: "#f9a825" }}>やる気{resources.やる気?.cur || 0}/{resources.やる気?.max || 3}</span>
          <span style={{ fontSize: 9, color: "#ab47bc" }}>霊力{resources.霊力?.cur || 0}</span>
        </div>
      </div>
 
      {expanded && (
        <div style={{ padding: "10px 12px", borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid #111828`, paddingBottom: 3, marginBottom: 8 }}>リソース</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginBottom: 10 }}>
            {resKeys.map(k => {
              const r = resources[k] || { cur: 0, max: 1 };
              return (
                <div key={k} style={{ padding: "4px 6px", background: "rgba(255,255,255,0.02)", border: `1px solid ${C.border}`, borderRadius: 3, textAlign: "center" }}>
                  <div style={{ fontSize: 8, color: C.textFaint, marginBottom: 1 }}>【{k}】</div>
                  <div style={{ fontSize: 12, color: C.gold }}>{r.cur}{r.max > 1 && <span style={{ fontSize: 8, color: C.textFaint }}>/{r.max}</span>}</div>
                  {isGm && gmEdit && (
                    <div style={{ display: "flex", gap: 2, justifyContent: "center", marginTop: 2 }}>
                      <button onClick={() => adjustResource(k, -1)} style={{ width: 14, height: 14, fontSize: 9, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, cursor: "pointer", borderRadius: 2, padding: 0 }}>−</button>
                      <button onClick={() => adjustResource(k, +1)} style={{ width: 14, height: 14, fontSize: 9, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, cursor: "pointer", borderRadius: 2, padding: 0 }}>＋</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
 
          <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid #111828`, paddingBottom: 3, marginBottom: 8 }}>アイテム</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
            {itemKeys.map(k => {
              const count  = items[k] || 0;
              const canUse = ITEM_DATA[k]?.canUse(pc);
              if (count === 0 && !isGm) return null;
              return (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 3, padding: "3px 7px", borderRadius: 12, cursor: count > 0 ? "pointer" : "default", background: canUse ? "rgba(200,160,64,0.15)" : "rgba(255,255,255,0.03)", border: `1px solid ${canUse ? C.goldDim : C.border}` }} onClick={() => count > 0 && setItemModal(k)}>
                  <span style={{ fontSize: 10, color: canUse ? C.gold : C.textFaint }}>{k}</span>
                  <span style={{ fontSize: 9, color: canUse ? C.gold : C.textFaint, padding: "0 4px", background: "rgba(0,0,0,0.3)", borderRadius: 8 }}>{count}</span>
                </div>
              );
            })}
            <button onClick={() => setGmEdit(v => !v)} style={{ padding: "2px 8px", fontSize: 9, cursor: "pointer", borderRadius: 10, background: gmEdit ? "rgba(192,57,43,0.2)" : "rgba(255,255,255,0.03)", border: `1px solid ${gmEdit ? "#8b1a1a" : C.border}`, color: gmEdit ? C.red : C.textFaint }}>{gmEdit ? "編集終了" : "GM編集"}</button>
            {isGm && gmEdit && (
              <div style={{ width: "100%", marginTop: 4 }}>
                <div style={{ fontSize: 8, color: C.textFaint, marginBottom: 4 }}>アイテム直接編集:</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {itemKeys.map(k => (
                    <div key={k} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                      <span style={{ fontSize: 9, color: C.textFaint }}>{k}:</span>
                      <button onClick={() => onUpdatePc({ ...pc, items: { ...items, [k]: Math.max(0, (items[k] || 0) - 1) } })} style={{ width: 14, height: 14, fontSize: 9, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, cursor: "pointer", borderRadius: 2, padding: 0 }}>−</button>
                      <span style={{ fontSize: 9, color: C.gold, minWidth: 12, textAlign: "center" }}>{items[k] || 0}</span>
                      <button onClick={() => onUpdatePc({ ...pc, items: { ...items, [k]: (items[k] || 0) + 1 } })} style={{ width: 14, height: 14, fontSize: 9, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, cursor: "pointer", borderRadius: 2, padding: 0 }}>＋</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
 
          {badStatus.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid #111828`, paddingBottom: 3, marginBottom: 6 }}>変調</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {badStatus.map(bs => {
                  const bData = Object.values(BAD_STATUS_TABLE).find(x => x.name === bs);
                  return (
                    <div key={bs} style={{ padding: "4px 8px", background: "rgba(224,112,96,0.15)", border: `1px solid ${C.redBorder}`, borderRadius: 4 }}>
                      <div style={{ fontSize: 10, color: C.red, marginBottom: 2, fontWeight: "bold" }}>《{bs}》</div>
                      <div style={{ fontSize: 8, color: C.textDim, lineHeight: 1.4 }}>{bData?.desc}</div>
                      {isGm && gmEdit && <button onClick={() => onUpdatePc({ ...pc, badStatus: badStatus.filter(x => x !== bs) })} style={{ marginTop: 4, padding: "2px 6px", fontSize: 8, background: "rgba(255,255,255,0.05)", border: `1px solid ${C.border}`, color: C.textFaint, cursor: "pointer", borderRadius: 2 }}>解除</button>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
 
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid #111828`, paddingBottom: 3, marginBottom: 6 }}>絆</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {(pc.bonds ||[]).length > 0
                ? pc.bonds.map(b => <span key={b} style={{ padding: "2px 8px", background: "rgba(200,160,64,0.1)", border: `1px solid ${C.goldDim}50`, borderRadius: 10, fontSize: 10, color: C.gold }}>《{b}》</span>)
                : <span style={{ fontSize: 9, color: "#2a3545" }}>なし</span>
              }
            </div>
          </div>
 
          <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid #111828`, paddingBottom: 3, marginBottom: 8 }}>スキル</div>
          {skill && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ padding: "1px 6px", background: `${SKILL_TYPE_COLOR[skill.type] || C.text}18`, border: `1px solid ${SKILL_TYPE_COLOR[skill.type] || C.text}50`, borderRadius: 8, fontSize: 8, color: SKILL_TYPE_COLOR[skill.type] || C.text }}>{skill.type}</span>
                <span style={{ fontSize: 11, color: skillCanActivate ? C.gold : "#81c784" }}>《{skill.name}》</span>
                {skill.type === "オート" && <span style={{ fontSize: 8, color: "#81c784" }}>常時発動中</span>}
              </div>
              <div style={{ fontSize: 9, color: C.textFaint, lineHeight: 1.7, marginBottom: 6 }}>{skill.desc}</div>
              {skillCanActivate && !isCustomChar && <button onClick={() => setSkillModal(true)} style={{ padding: "4px 12px", cursor: "pointer", borderRadius: 3, fontSize: 10, background: "rgba(200,160,64,0.2)", border: "1px solid #8b6914", color: C.gold }}>発動する</button>}
            </div>
          )}
          {pc.abilitySkill && (
            <div style={{ marginTop: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ padding: "1px 6px", background: `${SKILL_TYPE_COLOR[pc.abilitySkill.type] || "#90caf9"}18`, border: `1px solid ${SKILL_TYPE_COLOR[pc.abilitySkill.type] || "#90caf9"}50`, borderRadius: 8, fontSize: 8, color: SKILL_TYPE_COLOR[pc.abilitySkill.type] || "#90caf9" }}>{pc.abilitySkill.type}</span>
                <span style={{ fontSize: 11, color: "#90caf9" }}>《{pc.abilitySkill.name}》</span>
              </div>
              <div style={{ fontSize: 9, color: C.textFaint, lineHeight: 1.7, marginBottom: 6 }}>{pc.abilitySkill.desc}</div>
              {pc.abilitySkill.type !== "オート" && !isCustomChar && <button onClick={() => setSkillModal({ name: pc.abilitySkill.name, type: pc.abilitySkill.type, desc: pc.abilitySkill.desc, key: "ability" })} style={{ padding: "4px 12px", cursor: "pointer", borderRadius: 3, fontSize: 10, background: "rgba(144,202,249,0.15)", border: "1px solid #1565c080", color: "#90caf9" }}>発動する</button>}
            </div>
          )}
        </div>
      )}
 
      {itemModal && <ItemUseModal itemName={itemModal} pc={pc} onConfirm={() => useItem(itemModal)} onCancel={() => setItemModal(null)} />}
      {skillModal && skill && <SkillActivateModal skillName={skill.name} skillType={skill.type} desc={skill.desc} onConfirm={activateSkill} onCancel={() => setSkillModal(null)} />}
    </div>
  );
}
 
// ─── ActionRenderer (イベント効果実行エンジン) ─────────────────────────
function ActionRenderer({ act, pc, gs, upd, animateDice, SPOTS, getSpot, isDone }) {
  const [selectedLose, setSelectedLose] = useState(null);

  if (isDone) {
    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.3s ease" }}>
        <div style={{ fontSize: 11, color: C.textDim, marginBottom: 12 }}>イベント効果の適用が完了しました</div>
        <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "explore_clue" } }))} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>手がかりの処理へ</button>
      </div>
    );
  }

  if (!act) return null;

  const proceed = (logs =[], extraUpdates = {}) => {
    setSelectedLose(null);
    upd(p => {
      const newPcs = p.pcs.map(x => {
        if (x.uid !== pc.uid) return x;
        const base = { ...x };
        if (extraUpdates.pc) {
          if (extraUpdates.pc.resources) base.resources = { ...base.resources, ...extraUpdates.pc.resources };
          if (extraUpdates.pc.items) base.items = { ...base.items, ...extraUpdates.pc.items };
          if (extraUpdates.pc.badStatus) base.badStatus = extraUpdates.pc.badStatus;
          if (extraUpdates.pc.bonds) base.bonds = extraUpdates.pc.bonds;
          if (extraUpdates.pc.tags) base.tags = extraUpdates.pc.tags;
          if (extraUpdates.pc.flags) base.flags = { ...base.flags, ...extraUpdates.pc.flags };
          if (extraUpdates.pc.currentSpot) base.currentSpot = extraUpdates.pc.currentSpot;
        }
        return base;
      });
      const p2 = extraUpdates.pc ? { ...p, pcs: newPcs } : p;
      const p3 = extraUpdates.gs ? { ...p2, ...extraUpdates.gs } : p2;
      return { 
        ...p3, 
        currentScene: { ...p3.currentScene, currentActionIndex: (p3.currentScene.currentActionIndex || 0) + 1 }, 
        log:[...logs.reverse(), ...p3.log] 
      };
    });
  };

  // 1. GAIN_REIRYOKU
  if (act.type === "GAIN_REIRYOKU") {
    if (act.amount === "1D6") {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.gold, marginBottom: 8, fontSize: 11 }}>【霊力増加】ダイスを振って回復量を決めます</div>
          <button onClick={() => animateDice(1, "霊力回復", res => {
            const gain = res[0];
            let nextCur = pc.resources.霊力?.cur || 0;
            if (!(pc.badStatus ||[]).includes("スランプ")) {
              nextCur = Math.min(pc.resources.霊力?.max || 20, nextCur + gain);
            }
            proceed([`${pc.name} は霊力を ${gain} 点獲得した`], {
              pc: { resources: { ...pc.resources, 霊力: { ...pc.resources.霊力, cur: nextCur }, 攻撃力: { ...pc.resources.攻撃力, cur: 1 + Math.floor(nextCur / 5) } } }
            });
          })} style={btnFull(C.goldBg, C.goldDim, C.gold)}>🎲 1D6 を振る</button>
        </div>
      );
    } else {
      const gain = parseInt(act.amount) || 0;
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.gold, marginBottom: 8, fontSize: 11 }}>【霊力増加】霊力を {gain} 点獲得します</div>
          <button onClick={() => {
            let nextCur = pc.resources.霊力?.cur || 0;
            if (!(pc.badStatus ||[]).includes("スランプ")) {
              nextCur = Math.min(pc.resources.霊力?.max || 20, nextCur + gain);
            }
            proceed([`${pc.name} は霊力を ${gain} 点獲得した`], {
              pc: { resources: { ...pc.resources, 霊力: { ...pc.resources.霊力, cur: nextCur }, 攻撃力: { ...pc.resources.攻撃力, cur: 1 + Math.floor(nextCur / 5) } } }
            });
          }} style={btnFull(C.goldBg, C.goldDim, C.gold)}>適用する</button>
        </div>
      );
    }
  }

  // 2. LOSE_REIRYOKU
  if (act.type === "LOSE_REIRYOKU") {
    const lose = parseInt(act.amount) || 0;
    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
        <div style={{ color: C.red, marginBottom: 8, fontSize: 11 }}>【霊力減少】霊力を {lose} 点失います</div>
        <button onClick={() => {
          const nextCur = Math.max(0, (pc.resources.霊力?.cur || 0) - lose);
          proceed([`${pc.name} は霊力を ${lose} 点失った`], {
            pc: { resources: { ...pc.resources, 霊力: { ...pc.resources.霊力, cur: nextCur }, 攻撃力: { ...pc.resources.攻撃力, cur: 1 + Math.floor(nextCur / 5) } } }
          });
        }} style={btnFull(C.redBg, C.redBorder, C.red)}>適用する</button>
      </div>
    );
  }

  // 3. GAIN_MOTIVE
  if (act.type === "GAIN_MOTIVE") {
    const gain = parseInt(act.amount) || 0;
    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
        <button onClick={() => {
          let nextCur = pc.resources.やる気?.cur || 0;
          if (!(pc.badStatus ||[]).includes("だるい")) {
            nextCur = Math.min(pc.resources.やる気?.max || 3, nextCur + gain);
          }
          proceed([`${pc.name} はやる気を ${gain} 点獲得した`], {
            pc: { resources: { ...pc.resources, やる気: { ...pc.resources.やる気, cur: nextCur } } }
          });
        }} style={btnFull(C.goldBg, C.goldDim, C.gold)}>やる気を {gain} 点獲得する</button>
      </div>
    );
  }

  // 4. LOSE_MOTIVE
  if (act.type === "LOSE_MOTIVE") {
    const lose = parseInt(act.amount) || 0;
    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
        <button onClick={() => {
          const nextCur = Math.max(0, (pc.resources.やる気?.cur || 0) - lose);
          proceed([`${pc.name} はやる気を ${lose} 点失った`], {
            pc: { resources: { ...pc.resources, やる気: { ...pc.resources.やる気, cur: nextCur } } }
          });
        }} style={btnFull(C.redBg, C.redBorder, C.red)}>やる気を {lose} 点失う</button>
      </div>
    );
  }

  // 5. GAIN_ITEM
  if (act.type === "GAIN_ITEM") {
    const count = parseInt(act.count) || 1;
    if (act.item === "random") {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <button onClick={() => animateDice(1, "アイテム獲得", res => {
            const itemNames =["お酒", "小銭", "お守り", "Pアイテム", "残機のかけら", "スペカのかけら"];
            const itemName = itemNames[res[0] - 1];
            proceed([`${pc.name} は【${itemName}】を ${count} 個獲得した`], {
              pc: { items: { ...pc.items, [itemName]: (pc.items[itemName] || 0) + count } }
            });
          })} style={btnFull(C.goldBg, C.goldDim, C.gold)}>🎲 ランダムなアイテムを獲得</button>
        </div>
      );
    } else if (act.item === "any") {
      const itemNames =["お酒", "小銭", "お守り", "Pアイテム", "残機のかけら", "スペカのかけら"];
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.gold, marginBottom: 8, fontSize: 11 }}>獲得するアイテムを選んでください</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {itemNames.map(itemName => (
              <button key={itemName} onClick={() => {
                proceed([`${pc.name} は【${itemName}】を ${count} 個獲得した`], {
                  pc: { items: { ...pc.items, [itemName]: (pc.items[itemName] || 0) + count } }
                });
              }} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text)}>{itemName}</button>
            ))}
          </div>
        </div>
      );
    } else {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <button onClick={() => {
            proceed([`${pc.name} は【${act.item}】を ${count} 個獲得した`], {
              pc: { items: { ...pc.items, [act.item]: (pc.items[act.item] || 0) + count } }
            });
          }} style={btnFull(C.goldBg, C.goldDim, C.gold)}>【{act.item}】を獲得する</button>
        </div>
      );
    }
  }

  // 6. LOSE_ITEM
  if (act.type === "LOSE_ITEM") {
    const ownedItems = Object.entries(pc.items || {}).filter(([k, v]) => v > 0).map(([k]) => k);
    if (ownedItems.length === 0) {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.textDim, marginBottom: 8, fontSize: 11 }}>失うアイテムを持っていません</div>
          <button onClick={() => proceed()} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>次へ</button>
        </div>
      );
    }
    
    if (act.item === "all") {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.red, marginBottom: 8, fontSize: 11 }}>すべてのアイテムを失います</div>
          <button onClick={() => {
            proceed([`${pc.name} は所持しているアイテムを全て失った`], {
              pc: { items: { お酒: 0, 小銭: 0, お守り: 0, Pアイテム: 0, 残機のかけら: 0, スペカかけら: 0, 妖器: 0 } }
            });
          }} style={btnFull(C.redBg, C.redBorder, C.red)}>適用する</button>
        </div>
      );
    } else if (act.item === "random") {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <button onClick={() => {
            const loseItem = ownedItems[Math.floor(Math.random() * ownedItems.length)];
            proceed([`${pc.name} は【${loseItem}】を失った`], {
              pc: { items: { ...pc.items, [loseItem]: Math.max(0, pc.items[loseItem] - 1) } }
            });
          }} style={btnFull(C.redBg, C.redBorder, C.red)}>🎲 ランダムにアイテムを失う</button>
        </div>
      );
    } else if (act.item === "any") {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.red, marginBottom: 8, fontSize: 11 }}>失うアイテムを選んでください</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {ownedItems.map(itemName => (
              <button key={itemName} onClick={() => {
                proceed([`${pc.name} は【${itemName}】を失った`], {
                  pc: { items: { ...pc.items, [itemName]: Math.max(0, pc.items[itemName] - 1) } }
                });
              }} style={btnFull("rgba(192,57,43,0.15)", C.redBorder, C.red)}>{itemName}</button>
            ))}
          </div>
        </div>
      );
    }
  }

  // 7. GAIN_SELECT_ITEM
  if (act.type === "GAIN_SELECT_ITEM") {
    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
        <div style={{ color: C.gold, marginBottom: 8, fontSize: 11 }}>獲得するアイテムを1つ選んでください</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 4 }}>
          {act.select.map(itemName => (
            <button key={itemName} onClick={() => {
              proceed([`${pc.name} は【${itemName}】を獲得した`], {
                pc: { items: { ...pc.items,[itemName]: (pc.items[itemName] || 0) + 1 } }
              });
            }} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text)}>{itemName}</button>
          ))}
        </div>
      </div>
    );
  }

  // 8. OPTIONAL_TRADE
  if (act.type === "OPTIONAL_TRADE") {
    const ownedItems = Object.entries(pc.items || {}).filter(([k, v]) => v > 0).map(([k]) => k);
    if (ownedItems.length === 0) {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.textDim, marginBottom: 8, fontSize: 11 }}>交換できるアイテムを持っていません</div>
          <button onClick={() => proceed()} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>次へ</button>
        </div>
      );
    }
    
    if (!selectedLose) {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.text, marginBottom: 8, fontSize: 11 }}>アイテムを手放して交換しますか？</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 8 }}>
            {ownedItems.map(itemName => (
              <button key={itemName} onClick={() => setSelectedLose(itemName)} style={btnFull("rgba(192,57,43,0.15)", C.redBorder, C.red)}>{itemName} を手放す</button>
            ))}
          </div>
          <button onClick={() => proceed()} style={btnFull("rgba(255,255,255,0.05)", C.border, C.textFaint)}>交換しない</button>
        </div>
      );
    }

    if (act.gain === "any") {
      const itemNames =["お酒", "小銭", "お守り", "Pアイテム", "残機のかけら", "スペカのかけら"];
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.gold, marginBottom: 8, fontSize: 11 }}>【{selectedLose}】と交換で獲得するアイテムを選んでください</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {itemNames.map(itemName => (
              <button key={itemName} onClick={() => {
                proceed([`${pc.name} は【${selectedLose}】を手放し、【${itemName}】を獲得した`], {
                  pc: { items: { ...pc.items, [selectedLose]: Math.max(0, pc.items[selectedLose] - 1), [itemName]: (pc.items[itemName] || 0) + 1 } }
                });
              }} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text)}>{itemName}</button>
            ))}
          </div>
        </div>
      );
    } else if (act.gain === "random") {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <button onClick={() => animateDice(1, "アイテム交換", res => {
            const itemNames =["お酒", "小銭", "お守り", "Pアイテム", "残機のかけら", "スペカのかけら"];
            const itemName = itemNames[res[0] - 1];
            proceed([`${pc.name} は【${selectedLose}】を手放し、【${itemName}】を獲得した`], {
              pc: { items: { ...pc.items, [selectedLose]: Math.max(0, pc.items[selectedLose] - 1), [itemName]: (pc.items[itemName] || 0) + 1 } }
            });
          })} style={btnFull(C.goldBg, C.goldDim, C.gold)}>🎲 ランダムなアイテムを獲得する</button>
        </div>
      );
    }
  }

  // 9. GAIN_BAD_STATUS / CURE_BAD_STATUS
  if (act.type === "GAIN_BAD_STATUS") {
    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
        <button onClick={() => animateDice(1, "変調決定", res => {
          const bsName = BAD_STATUS_TABLE[res[0]].name;
          const newBs  = Array.from(new Set([...(pc.badStatus || []), bsName]));
          const nextYaruki = bsName === "だるい" ? 1 : pc.resources.やる気?.cur;
          proceed([`${pc.name} は変調《${bsName}》を獲得した`], {
            pc: { badStatus: newBs, resources: { ...pc.resources, やる気: { ...pc.resources.やる気, cur: nextYaruki } } }
          });
        })} style={btnFull(C.redBg, C.redBorder, C.red)}>🎲 ランダムな変調を獲得する (1D6)</button>
      </div>
    );
  }

  if (act.type === "CURE_BAD_STATUS") {
    const bs = pc.badStatus ||[];
    if (bs.length === 0) {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.textDim, marginBottom: 8, fontSize: 11 }}>回復する変調がありません</div>
          <button onClick={() => proceed()} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>次へ</button>
        </div>
      );
    }
    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
        <div style={{ color: C.gold, marginBottom: 8, fontSize: 11 }}>解除する変調を選んでください</div>
        {bs.map(b => (
          <button key={b} onClick={() => {
            proceed([`${pc.name} は変調《${b}》を解除した`], {
              pc: { badStatus: pc.badStatus.filter(x => x !== b) }
            });
          }} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text, { marginBottom: 4 })}>《{b}》を解除</button>
        ))}
      </div>
    );
  }

  // 10. STOP_MOVEMENT
  if (act.type === "STOP_MOVEMENT") {
    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
        <div style={{ color: C.red, marginBottom: 8, fontSize: 11 }}>足止めを受けました</div>
        <button onClick={() => {
          proceed([`${pc.name} は足止めを受けた`], { pc: { flags: { ...pc.flags, stopped: true } } });
        }} style={btnFull(C.redBg, C.redBorder, C.red)}>適用する</button>
      </div>
    );
  }

  // 11. STOP_IF_NO_ITEM
  if (act.type === "STOP_IF_NO_ITEM") {
    const hasItem = Object.values(pc.items || {}).some(v => v > 0);
    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
        <button onClick={() => {
          if (!hasItem) {
             proceed([`${pc.name} はアイテムを持っていなかったため、足止めを受けた`], { pc: { flags: { ...pc.flags, stopped: true } } });
          } else {
             proceed();
          }
        }} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>アイテムの所持を確認する</button>
      </div>
    );
  }

  // 12. GAIN_BOND
  if (act.type === "GAIN_BOND") {
    if ((pc.badStatus ||[]).includes("不機嫌")) {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.red, marginBottom: 8, fontSize: 11 }}>変調《不機嫌》のため絆を獲得できません</div>
          <button onClick={() => proceed()} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>次へ</button>
        </div>
      );
    }

    if (act.target === "self") {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <button onClick={() => {
             const bonds = Array.from(new Set([...(pc.bonds || []), pc.name]));
             proceed([`${pc.name} は自身への絆を獲得した`], { pc: { bonds } });
          }} style={btnFull(C.goldBg, C.goldDim, C.gold)}>自身への絆を獲得する</button>
        </div>
      );
    }

    if (act.target === "here") {
      const others = gs.pcs.filter(p => p.uid !== pc.uid && p.currentSpot === pc.currentSpot && !(p.badStatus ||[]).includes("不機嫌"));
      if (others.length === 0) {
        return (
          <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
            <div style={{ color: C.textDim, marginBottom: 8, fontSize: 11 }}>同じスポットに絆を獲得できるキャラクターがいません</div>
            <button onClick={() => proceed()} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>次へ</button>
          </div>
        );
      }
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.gold, marginBottom: 8, fontSize: 11 }}>絆を獲得するキャラクターを選んでください</div>
          {others.map(o => (
            <button key={o.uid} onClick={() => {
              const bonds = Array.from(new Set([...(pc.bonds || []), o.charName || o.name]));
              proceed([`${pc.name} は《${o.charName || o.name}への絆》を獲得した`], { pc: { bonds } });
            }} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text, { marginBottom: 4 })}>
              {o.name}
            </button>
          ))}
        </div>
      );
    }

    if (act.target === "elsewhere") {
      const others = gs.pcs.filter(p => p.uid !== pc.uid && p.currentSpot !== pc.currentSpot && !(p.badStatus ||[]).includes("不機嫌"));
      if (others.length === 0) {
        return (
          <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
            <div style={{ color: C.textDim, marginBottom: 8, fontSize: 11 }}>他のスポットに絆を獲得できるキャラクターがいません</div>
            <button onClick={() => proceed()} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>次へ</button>
          </div>
        );
      }
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.gold, marginBottom: 8, fontSize: 11 }}>絆を獲得するキャラクターを選んでください</div>
          <select value={selectedLose || ""} onChange={e => setSelectedLose(e.target.value)} style={{ width: "100%", padding: 6, marginBottom: 8, background: "rgba(255,255,255,0.05)", color: C.text }}>
             <option value="">キャラクターを選択...</option>
             {others.map(o => <option key={o.uid} value={o.charName || o.name}>{o.name}</option>)}
          </select>
          <button disabled={!selectedLose} onClick={() => {
             const bonds = Array.from(new Set([...(pc.bonds || []), selectedLose]));
             proceed([`${pc.name} は《${selectedLose}への絆》を獲得した`], { pc: { bonds } });
          }} style={btnFull(selectedLose ? C.goldBg : "rgba(255,255,255,0.05)", C.border, selectedLose ? C.gold : C.textFaint)}>獲得する</button>
        </div>
      );
    }

    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
        <button onClick={() => {
           const bonds = Array.from(new Set([...(pc.bonds || []), act.target]));
           proceed([`${pc.name} は《${act.target}への絆》を獲得した`], { pc: { bonds } });
        }} style={btnFull(C.goldBg, C.goldDim, C.gold)}>《{act.target}への絆》を獲得する</button>
      </div>
    );
  }

  // 13. LOSE_LIFE
  if (act.type === "LOSE_LIFE") {
    const lose = parseInt(act.amount) || 1;
    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
        <button onClick={() => {
          const nextCur = Math.max(0, (pc.resources.残り人数?.cur || 0) - lose);
          proceed([`${pc.name} は残り人数を ${lose} 点失った`], {
            pc: { resources: { ...pc.resources, 残り人数: { ...pc.resources.残り人数, cur: nextCur } } }
          });
        }} style={btnFull(C.redBg, C.redBorder, C.red)}>残り人数を {lose} 点失う</button>
      </div>
    );
  }

  // 14. MOVE
  if (act.type === "MOVE") {
    if (act.spot === "adjacent") {
      const adjacentIds = EDGES.filter(([a, b]) => a === pc.currentSpot || b === pc.currentSpot).map(([a, b]) => a === pc.currentSpot ? b : a);
      const candidates = SPOTS.filter(s => adjacentIds.includes(s.id));
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.gold, marginBottom: 8, fontSize: 11 }}>移動先（隣接スポット）を選んでください</div>
          {candidates.map(s => (
            <button key={s.id} onClick={() => {
              proceed([`${pc.name} は [${s.name}] に移動した`], { pc: { currentSpot: s.id } });
            }} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text, { marginBottom: 4 })}>[{s.roll}] {s.name}</button>
          ))}
        </div>
      );
    }

    if (act.spot === "random") {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <button onClick={() => animateDice(2, "ランダム移動", res => {
            const nextSpotId = getSpotByD66(res[0], res[1], SPOTS);
            if (nextSpotId) {
              proceed([`${pc.name} は[${getSpot(nextSpotId)?.name}] に移動した`], { pc: { currentSpot: nextSpotId } });
            } else {
              proceed(["(移動先が見つからなかった)"]);
            }
          })} style={btnFull(C.goldBg, C.goldDim, C.gold)}>🎲 ランダムなスポットへ移動</button>
        </div>
      );
    }
    
    if (act.spot === "base_or_any") {
       if (pc.baseSpotId === "dream") {
          return (
             <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
               <div style={{ color: C.gold, marginBottom: 8, fontSize: 11 }}>拠点が夢の世界のため、任意の場所に移動します</div>
               <select 
                 value={selectedLose || ""} 
                 onChange={e => setSelectedLose(e.target.value)} 
                 style={{ width: "100%", padding: 6, marginBottom: 8, background: "rgba(255,255,255,0.05)", color: C.text }}
               >
                 <option value="">移動先を選択...</option>
                 {SPOTS.filter(s => s.id !== "dream").map(s => (
                   <option key={s.id} value={s.id}>[{s.roll}] {s.name}</option>
                 ))}
               </select>
               <button 
                 disabled={!selectedLose} 
                 onClick={() => {
                   proceed([`${pc.name} は[${getSpot(selectedLose)?.name}] に移動した`], { pc: { currentSpot: selectedLose } });
                 }} 
                 style={btnFull(selectedLose ? C.goldBg : "rgba(255,255,255,0.05)", C.border, selectedLose ? C.gold : C.textFaint)}
               >
                 移動する
               </button>
             </div>
          );
       } else {
          return (
             <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
               <button onClick={() => {
                 proceed([`${pc.name} は拠点に移動した`], { pc: { currentSpot: pc.baseSpotId } });
               }} style={btnFull(C.goldBg, C.goldDim, C.gold)}>拠点に移動する</button>
             </div>
          );
       }
    }

    if (act.spot === "pc") {
      const others = gs.pcs.filter(p => p.uid !== pc.uid);
      if (others.length === 0) {
        return (
          <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
            <div style={{ color: C.textDim, marginBottom: 8, fontSize: 11 }}>移動できるPCがいません</div>
            <button onClick={() => proceed()} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>次へ</button>
          </div>
        );
      }
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.gold, marginBottom: 8, fontSize: 11 }}>移動先のPCを選んでください</div>
          {others.map(o => (
            <button key={o.uid} onClick={() => {
              const extraPc = { currentSpot: o.currentSpot };
              if (act.gainBond && !(pc.badStatus ||[]).includes("不機嫌") && !(o.badStatus ||[]).includes("不機嫌")) {
                extraPc.bonds = Array.from(new Set([...(pc.bonds || []), o.charName || o.name]));
              }
              proceed([`${pc.name} は ${o.name} のいるスポットへ移動した`], { pc: extraPc });
            }} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text, { marginBottom: 4 })}>
              {o.name}
            </button>
          ))}
        </div>
      );
    }
  }

  // 15. GAIN_SPELL
  if (act.type === "GAIN_SPELL") {
    const gain = parseInt(act.amount) || 1;
    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
        <button onClick={() => {
          let nextCur = pc.resources.スペカ?.cur || 0;
          nextCur = Math.min(pc.resources.スペカ?.max || 5, nextCur + gain);
          proceed([`${pc.name} はスペルカードを ${gain} 点獲得した`], {
            pc: { resources: { ...pc.resources, スペカ: { ...pc.resources.スペカ, cur: nextCur } } }
          });
        }} style={btnFull(C.goldBg, C.goldDim, C.gold)}>スペルカードを {gain} 点獲得する</button>
      </div>
    );
  }

  // 16. GAIN_TAG
  if (act.type === "GAIN_TAG") {
    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
        <button onClick={() => {
          proceed([`${pc.name} はセッション中《${act.tag}》のタグを得た`], {
            pc: { tags: Array.from(new Set([...(pc.tags || []), act.tag])) }
          });
        }} style={btnFull(C.goldBg, C.goldDim, C.gold)}>タグ《{act.tag}》を獲得する</button>
      </div>
    );
  }

  // 17. GAIN_CLUE
  if (act.type === "GAIN_CLUE") {
    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
        <button onClick={() => animateDice(2, "手がかり配置", res => {
          const nextSpotId = getSpotByD66(res[0], res[1], SPOTS);
          if (nextSpotId) {
             const newClues = Array.from(new Set([...(gs.clues || []), nextSpotId]));
             proceed([`手がかりを【${getSpot(nextSpotId)?.name}】に配置した`], { gs: { clues: newClues } });
          } else {
             proceed(["(手がかりの配置先が見つからなかった)"]);
          }
        })} style={btnFull(C.goldBg, C.goldDim, C.gold)}>🎲 手がかりを配置する</button>
      </div>
    );
  }

  // フォールバック
  return (
    <div style={{ textAlign: "center" }}>
      <button onClick={() => proceed()} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>次へ (未実装: {act.type})</button>
    </div>
  );
}
 
// ─── ScenePanel ───────────────────────────────────────────────────
function ScenePanel({ gs, upd, user, isGm, getSpot, animateDice, SPOTS }) {
  const sc = gs.currentScene;
  if (!sc) return null;
  const pc = gs.pcs.find(p => p.uid === sc.pcUid);
  if (!pc) return null;
 
  const isMyTurn  = pc.uid === user?.uid || isGm;
  const spotDetail = SPOT_DETAILS[pc.currentSpot] || { tags: [], events:[], desc: "" };
 
  const writeLog = msg => upd(p => ({ ...p, log: [msg, ...p.log] }));
  const endScene = ()  => upd(p => ({ ...p, actedPcs:[...(p.actedPcs || []), pc.uid], currentScene: null, log:[`${pc.name} のシーンを終了した`, ...p.log] }));
 
  const placeClueWithAnimation = count => {
    animateDice(count * 2, count === 1 ? "手がかり1つ配置" : "手がかり2つ配置", res => {
      upd(p => {
        let newClues = [...(p.clues || [])];
        const logs   =[];
        for (let i = 0; i < count; i++) {
          const d1 = res[i * 2], d2 = res[i * 2 + 1];
          const spotId = getSpotByD66(d1, d2, SPOTS);
          if (spotId) {
            if (!newClues.includes(spotId)) newClues.push(spotId);
            logs.push(`${pc.name} は手がかりを [${spotId}] ${getSpot(spotId)?.name} に配置した（出目: ${d1}, ${d2}）`);
          }
        }
        return { ...p, clues: newClues, currentScene: { ...p.currentScene, phase: "action_done" }, log: [...logs.reverse(), ...p.log] };
      });
    });
  };
 
  const chooseStay = () => {
    upd(p => {
      const x = p.pcs.find(x => x.uid === pc.uid);
      const r = x.resources.やる気 || { cur: 0, max: 3 };
      const isDebuffed = (x.badStatus ||[]).includes("だるい");
      const newPcs = p.pcs.map(y =>
        y.uid !== pc.uid ? y
        : isDebuffed ? y
        : { ...y, resources: { ...y.resources, やる気: { ...r, cur: Math.min(r.max, r.cur + 1) } } }
      );
      const logText = isDebuffed
        ? `${pc.name} はその場にとどまったが、変調《だるい》のためやる気は回復しなかった`
        : `${pc.name} はその場にとどまり、やる気を1点回復した`;
      return { ...p, pcs: newPcs, currentScene: { ...p.currentScene, phase: "action" }, log:[logText, ...p.log] };
    });
  };
 
  const chooseMove = () => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "move_roll" } }));
 
  const rollMoveDice = () => {
    const count = pc.resources.やる気?.cur || 1;
    animateDice(count, "移動ダイス", res => upd(p => ({ ...p, currentScene: { ...p.currentScene, moveDice: res } })));
  };
 
  const selectMoveDie = val => {
    upd(p => {
      let logAdd = `${pc.name} は移動ダイスで「${val}」を選んだ`;
      if (val === 6) {
        return { ...p, currentScene: { ...p.currentScene, phase: "happening_roll" }, log: [logAdd + "（ハプニング発生！）", ...p.log] };
      }
      let actualVal = val;
      if ((pc.badStatus ||[]).includes("疲れた")) {
        actualVal = Math.max(0, val - 1);
        logAdd += `（※変調《疲れた》のため移動距離が ${actualVal} に減少）`;
      }
      return { ...p, currentScene: { ...p.currentScene, phase: "move_dest", selectedMoveDie: actualVal }, log: [logAdd, ...p.log] };
    });
  };
 
  const confirmMove = () => {
    if (!sc.selectedDestSpot) return;
    upd(p => {
      const pcs   = p.pcs.map(x => x.uid === pc.uid ? { ...x, currentSpot: p.currentScene.selectedDestSpot } : x);
      const sName = getSpot(p.currentScene.selectedDestSpot)?.name;
      return { ...p, pcs, currentScene: { ...p.currentScene, phase: "action" }, log:[`${pc.name} は [${sName}] に移動した`, ...p.log] };
    });
  };
 
  const startExplore = () => {
    const hasTag    = spotDetail.tags.some(t => (pc.tags ||[]).includes(t) || pc.charName === t || pc.skillName === t);
    let diceCount   = 2 + (hasTag ? 1 : 0);
    if ((pc.badStatus ||[]).includes("怪我")) diceCount = Math.min(2, diceCount);
    upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "explore_select", actionDiceCount: diceCount, hasTagBonus: hasTag } }));
  };
 
  const selectEvent  = ev  => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "explore_roll", selectedEvent: ev } }));
  const rollExplore  = ()  => animateDice(sc.actionDiceCount || 2, "行為判定", res => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "explore_result", actionDice: res } })));
 
  const acquireClue = questId => {
    upd(p => {
      const spotId   = pc.currentSpot;
      const newClues = (p.clues ||[]).filter(c => c !== spotId);
      const newQuests = p.quests.map(q => q.id === questId ? { ...q, clues: (q.clues || 0) + 1 } : q);
      return { ...p, clues: newClues, quests: newQuests, currentScene: { ...p.currentScene, phase: "action_done" }, log: [`${pc.name} は [${spotId}] で手がかりを獲得し、クエスト「${newQuests.find(q => q.id === questId)?.name}」に配置した`, ...p.log] };
    });
  };
 
  const hasClueHere = gs.clues?.includes(pc.currentSpot);
 
  return (
    <div style={{ padding: 10, background: "rgba(25,118,210,0.1)", borderBottom: `1px solid ${C.blueBorder}`, flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <CharSprite spriteRow={pc.spriteRow ?? -1} spriteCol={pc.spriteCol ?? -1} size={32} />
        <div>
          <div style={{ fontSize: 10, color: C.blue }}>現在のシーンプレイヤー</div>
          <div style={{ fontSize: 13, color: C.text }}>
            {pc.name} <span style={{ fontSize: 9, color: C.textFaint }}>@ {getSpot(pc.currentSpot)?.name}</span>
          </div>
        </div>
      </div>
 
      {!isMyTurn ? (
        <div style={{ fontSize: 11, color: C.textFaint, textAlign: "center", padding: "8px 0" }}>{pc.name} の操作を待っています…</div>
      ) : (
        <div>
          {sc.phase === "move_or_stay" && (
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={chooseMove} style={btnFull(C.blueBg,  C.blueBorder,  C.blue)}>移動する（やる気D）</button>
              <button onClick={chooseStay} style={btnFull(C.greenBg, C.greenBorder, C.green)}>とどまる（やる気+1）</button>
            </div>
          )}
 
          {sc.phase === "move_roll" && !sc.moveDice?.length && (
            <button onClick={rollMoveDice} style={btnFull(C.goldBg, C.goldDim, C.gold)}>🎲 やる気（{pc.resources.やる気?.cur || 1}）個のダイスを振る</button>
          )}
          {sc.phase === "move_roll" && sc.moveDice?.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 6, textAlign: "center" }}>移動する距離の出目を選んでください</div>
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                {sc.moveDice.map((d, i) => (
                  <button key={i} onClick={() => selectMoveDie(d)} style={{ width: 40, height: 40, background: "rgba(14,20,36,0.95)", border: `2px solid ${d === 6 ? C.redBorder : C.border}`, borderRadius: 5, fontSize: 18, color: d === 6 ? C.red : C.blue, cursor: "pointer" }}>{d}</button>
                ))}
              </div>
              {sc.moveDice.includes(6) && <div style={{ fontSize: 10, color: C.red, textAlign: "center", marginTop: 4 }}>※6を選ぶとハプニングが発生します</div>}
            </div>
          )}
 
          {sc.phase === "happening_roll" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 14, color: C.red, marginBottom: 8, fontWeight: "bold" }}>⚠️ ハプニング発生！</div>
              <button onClick={() => animateDice(1, "ハプニング表", res => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "happening_result", happeningDice: res[0] } })))} style={btnFull(C.redBg, C.redBorder, C.red)}>🎲 ハプニング表を振る</button>
            </div>
          )}
 
          {sc.phase === "happening_result" && (() => {
            const h = {
              1: { title: "仲間が恋しい。", desc: "任意のPC1人を選ぶこと。強制的に選んだPCのいるスポットに移動する。" },
              2: { title: "【拠点】が恋しい。", desc: "強制的にあなたの【拠点】に移動する。" },
              3: { title: "あれ？行き過ぎてしまったかも。", desc: "ダイスを1つ振り、今いるスポットから出目の分だけ離れたスポット1つを選んで移動する。" },
              4: { title: "道に迷ってしまった。", desc: "D66を振って出た目と同じ番号のスポットに移動する。" },
              5: { title: "問題なし。", desc: "今いるスポットから6スポット分離れた距離までにある任意のスポットに移動する。" },
              6: { title: "「あなたは食べてもいい人類？」", desc: "通りがかりの妖怪に襲われた！\n（※今回は「問題なし」と同様に、6マス以内への移動として処理します）" },
            }[sc.happeningDice];
            const proceed = () => {
              const d = sc.happeningDice;
              if (d === 1) {
                const others = gs.pcs.filter(p => p.uid !== pc.uid);
                upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: others.length === 0 ? "action" : "happening_1" } }));
              } else if (d === 2) {
                upd(p => { const pcs = p.pcs.map(x => x.uid === pc.uid ? { ...x, currentSpot: pc.baseSpotId } : x); return { ...p, pcs, currentScene: { ...p.currentScene, phase: "action" }, log:[`${pc.name} は強制的に拠点へ移動した`, ...p.log] }; });
              } else if (d === 3) {
                upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "happening_3_roll" } }));
              } else if (d === 4) {
                upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "happening_4_roll" } }));
              } else {
                upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "move_dest", selectedMoveDie: 6 } }));
              }
            };
            return (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 22, color: C.gold, marginBottom: 4 }}>[{sc.happeningDice}]</div>
                <div style={{ fontSize: 13, color: C.red, marginBottom: 8 }}>{h.title}</div>
                <div style={{ fontSize: 10, color: C.textDim, whiteSpace: "pre-wrap", marginBottom: 14, lineHeight: 1.5 }}>{h.desc}</div>
                <button onClick={proceed} style={btnFull(C.goldBg, C.goldDim, C.gold)}>この処理を進める</button>
              </div>
            );
          })()}
 
          {sc.phase === "happening_1" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8 }}>合流するPC（スポット）を選択してください</div>
              {gs.pcs.filter(p => p.uid !== pc.uid).map(other => (
                <button key={other.uid} onClick={() => {
                  upd(p => { const pcs = p.pcs.map(x => x.uid === pc.uid ? { ...x, currentSpot: other.currentSpot } : x); return { ...p, pcs, currentScene: { ...p.currentScene, phase: "action" }, log:[`${pc.name} は ${other.name} と合流した`, ...p.log] }; });
                }} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text, { marginBottom: 4 })}>
                  {other.name} （{getSpot(other.currentSpot)?.name}）
                </button>
              ))}
            </div>
          )}
 
          {sc.phase === "happening_3_roll" && (
            <div style={{ textAlign: "center" }}>
              <button onClick={() => animateDice(1, "移動距離", res => {
                upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "move_dest", exactMoveDist: res[0], selectedMoveDie: res[0] } }));
              })} style={btnFull(C.goldBg, C.goldDim, C.gold)}>🎲 距離を振る (1D6)</button>
            </div>
          )}
 
          {sc.phase === "happening_4_roll" && (
            <div style={{ textAlign: "center" }}>
              <button onClick={() => animateDice(2, "道に迷う", res => {
                const nextSpotId = getSpotByD66(res[0], res[1], SPOTS);
                upd(p => {
                  const newPcs = p.pcs.map(x => x.uid === pc.uid ? { ...x, currentSpot: nextSpotId || x.currentSpot } : x);
                  return { ...p, pcs: newPcs, currentScene: { ...p.currentScene, phase: "action" }, log:[`${pc.name} は道に迷い [${getSpot(nextSpotId)?.name}] に辿り着いた`, ...p.log] };
                });
              })} style={btnFull(C.goldBg, C.goldDim, C.gold)}>🎲 移動先を振る (D66)</button>
            </div>
          )}
 
          {sc.phase === "move_dest" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: C.gold, marginBottom: 4, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {isGm && !sc.exactMoveDist && <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, selectedMoveDie: Math.max(0, sc.selectedMoveDie - 1) } }))} style={btnSmall}>-</button>}
                <span>{sc.exactMoveDist ? `【ちょうど ${sc.exactMoveDist} マス移動】` : `【最大 ${sc.selectedMoveDie} マス移動可能】`}</span>
                {isGm && !sc.exactMoveDist && <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, selectedMoveDie: sc.selectedMoveDie + 1 } }))} style={btnSmall}>+</button>}
              </div>
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>マップ上の光っているスポットをクリックしてください。</div>
              {sc.selectedDestSpot ? (
                <div style={{ padding: 8, background: "rgba(200,160,64,0.1)", border: `1px solid ${C.goldDim}`, borderRadius: 4, marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: C.text, marginBottom: 6 }}>選択中: <span style={{ color: C.gold, fontWeight: "bold" }}>{getSpot(sc.selectedDestSpot)?.name}</span></div>
                  <button onClick={confirmMove} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>ここへ移動する</button>
                </div>
              ) : (
                <div style={{ padding: 8, border: `1px dashed ${C.border}`, color: C.textFaint, fontSize: 10, marginBottom: 8 }}>未選択</div>
              )}
              <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "action" } }))} style={{ ...btnFull("none", "none", C.textFaint), fontSize: 10 }}>移動せずにアクションへ進む</button>
            </div>
          )}
 
          {sc.phase === "action" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button onClick={startExplore} style={btnFull(C.greenBg, C.greenBorder, C.green)}>🔍 探索イベントの実行</button>
              <button onClick={() => writeLog(`${pc.name} はアクションスキルを使用した`)} style={btnFull("rgba(255,255,255,0.05)", C.border, C.textFaint)}>💡 アクションスキルの使用</button>
              <div style={{ marginTop: 8 }}>
                <button onClick={endScene} style={btnFull(C.redBg, C.redBorder, C.red)}>🎬 このシーンを終了する</button>
              </div>
            </div>
          )}
 
          {sc.phase === "explore_select" && (
            <div>
              <div style={{ fontSize: 10, color: C.gold, marginBottom: 8, borderBottom: `1px solid ${C.gold}40` }}>探索イベントを選択</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {(SPOT_DETAILS[pc.currentSpot]?.events ||[]).map((ev, i) => (
                  <button key={i} onClick={() => selectEvent(ev)} style={btnFull("rgba(255,255,255,0.03)", C.border, C.text, { textAlign: "left", padding: "8px" })}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                      <span style={{ fontSize: 11 }}>{ev.name}</span>
                      <span style={{ fontSize: 10, color: C.blue }}>目標: {ev.target}</span>
                    </div>
                    <div style={{ fontSize: 8, color: C.textFaint, lineHeight: 1.3, whiteSpace: "pre-wrap" }}>{ev.effect}</div>
                  </button>
                ))}
              </div>
              <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "action" } }))} style={{ ...btnFull("none", "none", C.textFaint), marginTop: 10, fontSize: 10 }}>← 戻る</button>
            </div>
          )}
 
          {sc.phase === "explore_roll" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ padding: 8, background: "rgba(200,160,64,0.05)", borderRadius: 4, marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: C.gold }}>{sc.selectedEvent?.name}</div>
                <div style={{ fontSize: 10, color: C.blue }}>目標値: {sc.selectedEvent?.target}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 12 }}>
                <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, actionDiceCount: Math.max(1, sc.actionDiceCount - 1) } }))} style={btnSmall}>-</button>
                <span style={{ fontSize: 20, color: C.gold }}>{sc.actionDiceCount} 個</span>
                <button onClick={() => {
                  let next = sc.actionDiceCount + 1;
                  if ((pc.badStatus ||[]).includes("怪我")) next = Math.min(2, next);
                  upd(p => ({ ...p, currentScene: { ...p.currentScene, actionDiceCount: next } }));
                }} style={btnSmall}>+</button>
              </div>
              <button onClick={rollExplore} style={btnFull(C.goldBg, C.goldDim, C.gold)}>🎲 判定ダイスを振る</button>
            </div>
          )}
 
          {sc.phase === "special_cure" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 13, color: C.gold, marginBottom: 14, fontWeight: "bold" }}>🌿 解除する変調を選択</div>
              {(pc.badStatus ||[]).map(bs => (
                <button key={bs} onClick={() => {
                  upd(p => {
                    const newBs  = pc.badStatus.filter(x => x !== bs);
                    const newPcs = p.pcs.map(x => x.uid === pc.uid ? { ...x, badStatus: newBs } : x);
                    return { ...p, pcs: newPcs, currentScene: { ...p.currentScene, phase: "explore_result", specialResolved: true }, log:[`${pc.name} は変調《${bs}》を解除した`, ...p.log] };
                  });
                }} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text, { marginBottom: 4 })}>《{bs}》を解除</button>
              ))}
              <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "explore_result" } }))} style={{ ...btnFull("none", "none", C.textFaint), marginTop: 10 }}>戻る</button>
            </div>
          )}
 
          {sc.phase === "explore_result" && (() => {
            const maxDie       = Math.max(...(sc.actionDice ||[0]));
            const isFumble     = sc.actionDice?.length > 0 && sc.actionDice.every(d => d === 1);
            const isSpecial    = sc.actionDice?.includes(6);
            const isSuccess    = maxDie >= (sc.selectedEvent?.target || 0) && !isFumble;
            const pendingFumble  = isFumble  && !sc.fumbleResolved;
            const pendingSpecial = isSpecial && !isFumble && !sc.specialResolved;
            const canProceed   = !pendingFumble && !pendingSpecial;
 
            return (
              <div style={{ textAlign: "center" }}>
                <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 12 }}>
                  {sc.actionDice?.map((d, i) => (
                    <div key={i} style={{ width: 32, height: 32, background: "rgba(14,20,36,0.95)", border: `1px solid ${d === 6 ? C.gold : d === 1 ? C.red : C.blueBorder}`, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: d === 6 ? C.gold : d === 1 ? C.red : C.blue }}>{d}</div>
                  ))}
                </div>
 
                <div style={{ fontSize: 18, color: isSuccess ? C.green : C.red, fontWeight: "bold", marginBottom: 12 }}>
                  {isFumble ? "ファンブル！" : isSuccess ? "成功！" : "失敗…"}
                </div>
 
                {pendingSpecial && (
                  <div style={{ marginBottom: 12, padding: 10, background: "rgba(200,160,64,0.1)", border: "1px solid #8b691460", borderRadius: 4 }}>
                    <div style={{ fontSize: 11, color: C.gold, marginBottom: 8 }}>✨ スペシャル報酬を選択</div>
                    <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                      <button onClick={() => animateDice(1, "霊力回復", res => {
                        upd(p => {
                          const gain    = (pc.badStatus ||[]).includes("スランプ") ? 0 : res[0];
                          const nextCur = Math.min(pc.resources.霊力.max, (pc.resources.霊力.cur || 0) + gain);
                          const newPcs  = p.pcs.map(x => x.uid !== pc.uid ? x : { ...x, resources: { ...x.resources, 霊力: { ...x.resources.霊力, cur: nextCur }, 攻撃力: { ...x.resources.攻撃力, cur: 1 + Math.floor(nextCur / 5) } } });
                          return { ...p, pcs: newPcs, currentScene: { ...p.currentScene, specialResolved: true }, log:[`${pc.name} は霊力を ${gain} 点回復した`, ...p.log] };
                        });
                      })} style={btnFull(C.goldBg, C.goldDim, C.gold, { fontSize: 10 })}>霊力回復 (1D6)</button>
                      {(pc.badStatus ||[]).length > 0 && <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "special_cure" } }))} style={btnFull(C.blueBg, C.blueBorder, C.blue, { fontSize: 10 })}>変調解除</button>}
                    </div>
                  </div>
                )}
 
                {pendingFumble && (
                  <div style={{ marginBottom: 12, padding: 10, background: "rgba(224,112,96,0.1)", border: "1px solid #e0706060", borderRadius: 4 }}>
                    <div style={{ fontSize: 11, color: C.red, marginBottom: 8 }}>💀 変調を獲得します</div>
                    <button onClick={() => animateDice(1, "変調決定", res => {
                      const bsName = BAD_STATUS_TABLE[res[0]].name;
                      upd(p => {
                        const newBs  = Array.from(new Set([...(pc.badStatus || []), bsName]));
                        const newPcs = p.pcs.map(x => x.uid !== pc.uid ? x : { ...x, badStatus: newBs, resources: { ...x.resources, やる気: { ...x.resources.やる気, cur: bsName === "だるい" ? 1 : x.resources.やる気.cur } } });
                        return { ...p, pcs: newPcs, currentScene: { ...p.currentScene, fumbleResolved: true, fumbleStatus: bsName }, log:[`${pc.name} は変調《${bsName}》を獲得した`, ...p.log] };
                      });
                    })} style={btnFull(C.redBg, C.redBorder, C.red, { fontSize: 10 })}>🎲 変調表を振る (1D6)</button>
                  </div>
                )}
 
                {canProceed && (
                  <div style={{ animation: "fadeUp 0.3s ease" }}>
                    <div style={{ padding: 10, background: "rgba(255,255,255,0.03)", borderRadius: 4, fontSize: 10, color: C.textDim, textAlign: "left", whiteSpace: "pre-wrap", marginBottom: 12 }}>
                      <div style={{ color: C.gold, marginBottom: 4 }}>【イベント効果】</div>
                      {sc.selectedEvent?.effect}
                    </div>
                    <button onClick={() => {
                       const event = sc.selectedEvent;
                       const actions =[];
                       if (event.onAlways) actions.push(...event.onAlways);
                       if (isSuccess && event.onSuccess) actions.push(...event.onSuccess);
                       if (!isSuccess && event.onFailure) actions.push(...event.onFailure);
                       
                       upd(p => ({
                         ...p,
                         currentScene: {
                           ...p.currentScene,
                           phase: "explore_apply_effect",
                           eventActions: actions,
                           currentActionIndex: 0,
                           isSuccess // 手がかり処理のために残す
                         }
                       }));
                    }} style={btnFull(C.goldBg, C.goldDim, C.gold)}>イベント効果を適用する</button>
                  </div>
                )}
              </div>
            );
          })()}

          {sc.phase === "explore_apply_effect" && (
            <ActionRenderer 
              act={(sc.eventActions || [])[sc.currentActionIndex || 0]} 
              pc={pc} gs={gs} upd={upd} animateDice={animateDice} 
              SPOTS={SPOTS} getSpot={getSpot} 
              isDone={(sc.currentActionIndex || 0) >= (sc.eventActions ||[]).length}
            />
          )}

          {sc.phase === "explore_clue" && (() => {
            if (sc.isSuccess) {
              if (hasClueHere) {
                return (
                  <div style={{ padding: 8, background: "rgba(0,229,255,0.1)", border: "1px solid #00e5ff60", borderRadius: 4 }}>
                    <div style={{ fontSize: 10, color: "#00e5ff", marginBottom: 6 }}>💡 手がかりを獲得！クエストを選択してください。</div>
                    {(gs.quests ||[]).filter(q => !q.solved && q.revealed).map(q => (
                      <button key={q.id} onClick={() => acquireClue(q.id)} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text, { fontSize: 10, marginBottom: 4 })}>「{q.name}」</button>
                    ))}
                    <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "action_done" } }))} style={{ ...btnFull("none", "none", C.textFaint), marginTop: 8 }}>クエストに配置しない</button>
                  </div>
                );
              } else {
                return (
                  <div style={{ textAlign: "center" }}>
                    <button onClick={() => placeClueWithAnimation(2)} style={btnFull(C.goldBg, C.goldDim, C.gold)}>🎲 手がかりを2つ配置</button>
                  </div>
                );
              }
            } else {
              return (
                <div style={{ textAlign: "center" }}>
                  <button onClick={() => placeClueWithAnimation(1)} style={btnFull(C.redBg, C.redBorder, C.red)}>🎲 手がかりを1つ配置</button>
                </div>
              );
            }
          })()}
 
          {sc.phase === "action_done" && (
            <div style={{ textAlign: "center", animation: "fadeUp 0.3s ease" }}>
              <div style={{ fontSize: 11, color: C.textDim, marginBottom: 12 }}>全てのアクションが終了しました</div>
              <button onClick={endScene} style={btnFull(C.redBg, C.redBorder, C.red)}>🎬 シーンを終了する</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
 
// ─── RightPanel ───────────────────────────────────────────────────
export function RightPanel({ gs, upd, sceneData, setSceneData, isGm, user, room, CYCLES, CYCLE_COLORS, NEWSPAPER, getSpot, doNewspaper, doAdvanceCycle, doReiryoku, doTransitionToExplore, pendingAction, setPendingAction, SPOTS }) {
  const [tab, setTab]             = useState("progress");
  const[diceResult, setDiceResult] = useState(null);
  const [diceAnim, setDiceAnim]   = useState(false);
  const [paperModal, setPaperModal] = useState(null);
  const[sceneSelect, setSceneSelect] = useState("");
  const timerRef = useRef(null);
 
  const cycleIdx   = gs.cycleIdx || 0;
  const isIntro    = gs.sessionPhase === "intro" || gs.sessionPhase === "intro_main";
  const isMorning  = cycleIdx === 0;
  const cycleColor = CYCLE_COLORS[cycleIdx];
 
  const rollD6 = () => Math.floor(Math.random() * 6) + 1;
  const animateDice = (count, label, cb) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setDiceAnim(true);
    let f = 0;
    timerRef.current = setInterval(() => {
      f++;
      setDiceResult(Array(count).fill(0).map(rollD6));
      if (f >= 14) {
        clearInterval(timerRef.current);
        const res = Array(count).fill(0).map(rollD6);
        setDiceResult(res);
        setDiceAnim(false);
        if (cb) cb(res);
      }
    }, 80);
  };
 
  const handleNewspaper = () => {
    animateDice(2, "文々。新聞表", res => {
      const val   = Math.min(res[0], res[1]) * 10 + Math.max(res[0], res[1]);
      const paper = NEWSPAPER[val] || { title: `出目${val}`, effect: "（データなし）" };
      doNewspaper({ roll: val, dice: res, ...paper });
      setTimeout(() => setPaperModal({ roll: val, dice: res, ...paper }), 300);
    });
  };
 
  const startScene = () => {
    if (!sceneSelect) return;
    const targetPc = gs.pcs.find(p => p.uid === sceneSelect);
    if (!targetPc) return;
    upd(p => ({
      ...p,
      currentScene: { pcUid: sceneSelect, phase: "move_or_stay", moveDice:[], actionDice:[], actionDiceCount: 2 },
      log:[`🎬 ${targetPc.name} のシーンが開始された`, ...p.log],
    }));
    setSceneSelect("");
  };
 
  const unactedPcs = (gs.pcs || []).filter(pc => !(gs.actedPcs ||[]).includes(pc.uid));
 
  const getMainAction = () => {
    if (gs.currentScene) return null;
    if (isIntro) return { label: "🎬 探索フェイズへ移行する", fn: () => setPendingAction("toExplore"), color: "#1976d2" };
    if (isMorning) {
      if (!gs.newspaper) return { label: "📰 文々。新聞を読む", fn: handleNewspaper, color: C.blue };
      if (!gs.cluePlaced) return {
        label: "🔍 手がかりを配置",
        color: C.green,
        fn: () => animateDice(2, "朝の手がかり配置", res => {
          const spotId = getSpotByD66(res[0], res[1], SPOTS);
          if (spotId) {
            upd(p => ({ ...p, cluePlaced: true, clues:[...new Set([...p.clues, spotId])], log: [`手がかりを [${spotId}] ${getSpot(spotId)?.name} に配置（出目: ${res[0]}, ${res[1]}）`, ...p.log] }));
          }
        }),
      };
    }
    if (cycleIdx !== 3 && !gs.reiryokuDone) return { label: "✦ 霊力の増加", fn: doReiryoku, color: "#ab47bc" };
    if (unactedPcs.length === 0) return { label: `🌙 ${cycleIdx === 3 ? "翌日の朝" : "次のサイクル"}へ`, fn: () => setPendingAction("advance"), color: "#f57c00" };
    return null;
  };
  const ma = isGm ? getMainAction() : null;
 
  const TABS = isGm
    ? [["progress", "進行"],["pcs", "PC一覧"], ["scene", "描写"], ["log", "ログ"]]
    : [["progress", "進行"],["pcs", "PC一覧"], ["log", "ログ"]];
 
  return (
    <div style={{ width: 300, display: "flex", flexDirection: "column", background: "#0b0d14", borderLeft: `1px solid ${C.border}`, flexShrink: 0, overflow: "hidden", fontFamily: "serif" }}>
      <style>{`@keyframes fadeUp { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } } @keyframes rollSpin { 50% { transform: scale(1.15) } }`}</style>
 
      <div style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, background: "#08090f", flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: C.gold, letterSpacing: 2 }}>{isIntro ? "✦ 導入フェイズ" : "✦ 探索フェイズ"}</span>
          {!isIntro && <div style={{ padding: "2px 10px", background: `${cycleColor}18`, border: `1px solid ${cycleColor}40`, borderRadius: 10, fontSize: 10, color: cycleColor }}>{gs.day}日目・{CYCLES[cycleIdx]}</div>}
        </div>
      </div>
 
      {gs.currentScene && <ScenePanel gs={gs} upd={upd} user={user} isGm={isGm} getSpot={getSpot} animateDice={animateDice} SPOTS={SPOTS} />}
 
      {!gs.currentScene && isGm && (
        <div style={{ padding: "8px", borderBottom: `1px solid ${C.border}`, flexShrink: 0, background: "rgba(255,255,255,0.01)" }}>
          {ma ? (
            <button onClick={ma.fn} style={{ width: "100%", padding: "9px", borderRadius: 4, cursor: "pointer", background: `${ma.color}20`, border: `1px solid ${ma.color}50`, color: ma.color, fontSize: 12, letterSpacing: 1 }}>{ma.label}</button>
          ) : (
            <div>
              <div style={{ fontSize: 9, color: C.textDim, marginBottom: 4 }}>▶ シーンプレイヤーの選択</div>
              <div style={{ display: "flex", gap: 6 }}>
                <select value={sceneSelect} onChange={e => setSceneSelect(e.target.value)} style={{ flex: 1, padding: "6px", fontSize: 11, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.text, borderRadius: 3 }}>
                  <option value="">未行動のPCを選択...</option>
                  {unactedPcs.map(pc => <option key={pc.uid} value={pc.uid}>{pc.name}</option>)}
                </select>
                <button onClick={startScene} disabled={!sceneSelect} style={{ padding: "0 12px", background: C.goldBg, border: `1px solid ${C.goldDim}`, color: C.gold, borderRadius: 3, cursor: sceneSelect ? "pointer" : "not-allowed", fontSize: 11 }}>開始</button>
              </div>
            </div>
          )}
        </div>
      )}
 
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        {TABS.map(([id, label]) => (
          <div key={id} style={{ flex: 1, padding: "6px 2px", textAlign: "center", fontSize: 10, cursor: "pointer", color: tab === id ? C.gold : "#1e2535", borderBottom: tab === id ? `2px solid ${C.gold}` : "2px solid transparent", background: tab === id ? "rgba(200,160,64,0.05)" : "transparent" }} onClick={() => setTab(id)}>{label}</div>
        ))}
      </div>
 
      <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
        {tab === "progress" && (
          <div>
            <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid #111828`, paddingBottom: 3, marginBottom: 6 }}>クエスト</div>
            {(gs.quests ||[]).length === 0 ? (
              <div style={{ fontSize: 10, color: "#2a3545", marginBottom: 8 }}>なし</div>
            ) : (
              (gs.quests ||[]).map(q => (
                <div key={q.id || q.name} style={{ padding: "6px 8px", marginBottom: 4, background: q.solved ? "rgba(27,94,32,0.08)" : "rgba(255,255,255,0.02)", border: `1px solid ${q.solved ? "#1b5e20" : C.border}`, borderRadius: 3 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 11, color: q.solved ? "#4caf50" : C.gold, textDecoration: q.solved ? "line-through" : "none" }}>【Lv.{q.level}】{q.name}</span>
                    {isGm && (
                      <button onClick={() => upd(p => {
                        const isNowSolved = !q.solved;
                        const newQuests = p.quests.map(x => x.id === q.id ? { ...x, solved: isNowSolved } : x);
                        if (isNowSolved) {
                          (p.scenarioData?.quests ||[]).forEach(scQ => {
                            if (scQ.unlockType === "quest" && scQ.unlockQuestId === q.id) {
                              if (!newQuests.find(nq => nq.id === scQ.id)) {
                                newQuests.push({ ...scQ, revealed: true, solved: false });
                              }
                            }
                          });
                        }
                        return { ...p, quests: newQuests };
                      })} style={{ width: 18, height: 18, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, cursor: "pointer", borderRadius: 2, fontSize: 10, padding: 0 }}>
                        {q.solved ? "↩" : "✓"}
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: 9, color: C.textFaint, marginTop: 2 }}>{q.summary}</div>
                  {q.clues > 0 && <div style={{ fontSize: 9, color: "#00bcd4", marginTop: 4 }}>💡 割り当てられた手がかり: {q.clues} / {q.level}</div>}
                  {isGm && !q.solved && q.truth && <div style={{ fontSize: 8, color: "#3a6040", marginTop: 2 }}>🔒 {q.truth}</div>}
                </div>
              ))
            )}
            {!isIntro && (gs.clues ||[]).length > 0 && (
              <>
                <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid #111828`, paddingBottom: 3, marginBottom: 6, marginTop: 10 }}>手がかり配置済み</div>
                {gs.clues.map(id => (
                  <div key={id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, padding: "2px 0" }}>
                    <span style={{ color: "#00bcd4" }}>💡[{getSpot(id)?.roll}] {getSpot(id)?.name}</span>
                    {isGm && <button onClick={() => upd(p => ({ ...p, clues: p.clues.filter(c => c !== id) }))} style={{ width: 16, height: 16, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.red, cursor: "pointer", borderRadius: 2, fontSize: 10, padding: 0 }}>✕</button>}
                  </div>
                ))}
              </>
            )}
            {gs.newspaper && !isIntro && (
              <>
                <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid #111828`, paddingBottom: 3, marginBottom: 6, marginTop: 10 }}>本日の新聞</div>
                <div style={{ padding: "6px 8px", background: "rgba(25,50,90,0.15)", border: "1px solid #1e3a5a", borderRadius: 4, cursor: "pointer" }} onClick={() => setPaperModal(gs.newspaper)}>
                  <div style={{ fontSize: 9, color: "#3a5070" }}>[{gs.newspaper.roll}]</div>
                  <div style={{ fontSize: 11, color: "#60c0f0" }}>{gs.newspaper.title}</div>
                </div>
              </>
            )}
            {diceResult && (
              <div style={{ marginTop: 12, textAlign: "center" }}>
                <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 4 }}>
                  {diceResult.map((d, i) => (
                    <div key={i} style={{ width: 40, height: 40, border: "2px solid #1e3a5a", borderRadius: 5, background: "rgba(14,20,36,0.95)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: "#60c0f0", fontWeight: "bold", animation: diceAnim ? "rollSpin 0.25s ease infinite" : "none" }}>{d}</div>
                  ))}
                </div>
                {!diceAnim && <div style={{ fontSize: 16, color: C.gold }}>{diceResult.join("")}</div>}
              </div>
            )}
          </div>
        )}
 
        {tab === "pcs" && (
          <div>
            {(gs.pcs ||[]).length === 0
              ? <div style={{ fontSize: 10, color: "#2a3545" }}>PCなし</div>
              : (gs.pcs ||[]).map(pc => (
                  <PCCard
                    key={pc.uid}
                    pc={pc}
                    gs={gs}
                    isGm={isGm}
                    onUpdatePc={updPc => upd(p => ({ ...p, pcs: p.pcs.map(x => x.uid === pc.uid ? updPc : x) }))}
                    getSpot={getSpot}
                  />
                ))
            }
          </div>
        )}
 
        {tab === "scene" && isGm && (
          <div>
            <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid #111828`, paddingBottom: 3, marginBottom: 8 }}>描写モード</div>
            <button onClick={() => upd(p => ({ ...p, sceneMode: !p.sceneMode }))} style={{ width: "100%", padding: "8px", borderRadius: 4, cursor: "pointer", marginBottom: 8, background: gs.sceneMode ? "rgba(121,134,203,0.2)" : "rgba(255,255,255,0.03)", border: gs.sceneMode ? "1px solid #7986cb60" : `1px solid ${C.border}`, color: gs.sceneMode ? "#9fa8da" : C.textFaint, fontSize: 12 }}>
              {gs.sceneMode ? "🎭 描写モード ON（クリックで解除）" : "🎭 描写モードを開始"}
            </button>
            <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 3 }}>テキスト（PLに表示）</div>
            <textarea value={gs.sceneText || ""} onChange={e => upd(p => ({ ...p, sceneText: e.target.value }))} placeholder="PLに見せたいテキスト…" style={{ width: "100%", boxSizing: "border-box", padding: "5px 7px", fontSize: 11, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.text, borderRadius: 3, height: 80, resize: "vertical" }} />
 
            <div style={{ fontSize: 9, color: C.textFaint, marginTop: 8, marginBottom: 3 }}>背景画像</div>
            {sceneData.bg ? (
              <div style={{ position: "relative", marginBottom: 6 }}>
                <img src={sceneData.bg} alt="" style={{ width: "100%", height: 70, objectFit: "cover", borderRadius: 3, border: `1px solid ${C.border}` }} />
                <button onClick={() => setSceneData(d => ({ ...d, bg: null }))} style={{ position: "absolute", top: 4, right: 4, width: 18, height: 18, background: "rgba(8,8,12,0.9)", border: "1px solid #3a1a1a", color: C.red, cursor: "pointer", borderRadius: 2, fontSize: 11, padding: 0 }}>✕</button>
              </div>
            ) : (
              <label style={{ display: "block", padding: "8px", textAlign: "center", border: `1px dashed ${C.border}`, borderRadius: 3, cursor: "pointer", fontSize: 10, color: C.textFaint, marginBottom: 6 }}>
                ＋ 背景画像
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => {
                  const f = e.target.files[0];
                  if (!f) return;
                  const reader = new FileReader();
                  reader.onload = ev => {
                    const img = new Image();
                    img.onload = () => {
                      const scale  = Math.min(1, 1280 / img.width);
                      const canvas = document.createElement("canvas");
                      canvas.width  = img.width  * scale;
                      canvas.height = img.height * scale;
                      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
                      setSceneData(d => ({ ...d, bg: canvas.toDataURL("image/jpeg", 0.8) }));
                    };
                    img.src = ev.target.result;
                  };
                  reader.readAsDataURL(f);
                }} />
              </label>
            )}
 
            <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 3 }}>立ち絵（最大4体）</div>
            {(sceneData.portraits ||[]).map((p, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
                <img src={p.img} alt="" style={{ width: 28, height: 48, objectFit: "contain", border: `1px solid ${C.border}`, borderRadius: 2 }} />
                <input value={p.name || ""} style={{ flex: 1, padding: "3px 5px", fontSize: 10, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.text, borderRadius: 2 }} onChange={e => setSceneData(d => ({ ...d, portraits: d.portraits.map((x, j) => j === i ? { ...x, name: e.target.value } : x) }))} placeholder="キャラ名" />
                <button onClick={() => setSceneData(d => ({ ...d, portraits: d.portraits.filter((_, j) => j !== i) }))} style={{ width: 18, height: 18, background: "rgba(192,57,43,0.2)", border: "1px solid #5a1a1a", color: C.red, cursor: "pointer", borderRadius: 2, fontSize: 10, padding: 0 }}>✕</button>
              </div>
            ))}
            {(sceneData.portraits ||[]).length < 4 && (
              <label style={{ display: "block", padding: "5px", textAlign: "center", border: `1px dashed ${C.border}`, borderRadius: 3, cursor: "pointer", fontSize: 10, color: C.textFaint }}>
                ＋ 立ち絵を追加
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => {
                  const f = e.target.files[0];
                  if (!f) return;
                  const reader = new FileReader();
                  reader.onload = ev => {
                    const img = new Image();
                    img.onload = () => {
                      const scale  = Math.min(1, 600 / img.width);
                      const canvas = document.createElement("canvas");
                      canvas.width  = img.width  * scale;
                      canvas.height = img.height * scale;
                      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
                      setSceneData(d => ({ ...d, portraits:[...(d.portraits || []), { img: canvas.toDataURL("image/jpeg", 0.85), name: "" }] }));
                    };
                    img.src = ev.target.result;
                  };
                  reader.readAsDataURL(f);
                }} />
              </label>
            )}
          </div>
        )}
 
        {tab === "log" && (
          <div>
            <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid #111828`, paddingBottom: 3, marginBottom: 6 }}>セッションログ</div>
            {(gs.log ||[]).length === 0 && <div style={{ fontSize: 10, color: "#2a3545" }}>なし</div>}
            {(gs.log ||[]).map((e, i) => <div key={i} style={{ fontSize: 10, color: "#6a7a8a", padding: "3px 0", borderBottom: "1px solid #0c0f18" }}>{e}</div>)}
          </div>
        )}
      </div>
 
      {paperModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setPaperModal(null)}>
          <div style={{ background: "#0c1020", border: "1px solid #1e2d45", borderRadius: 6, padding: 20, maxWidth: 380, width: "90%", animation: "fadeUp 0.2s ease" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 9, letterSpacing: 3, color: "#2a3a50", textAlign: "center", marginBottom: 4 }}>— 文々。新聞 —</div>
            {paperModal.dice && (
              <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 8 }}>
                {paperModal.dice.map((d, i) => (
                  <div key={i} style={{ width: 44, height: 44, border: "2px solid #1e3a5a", borderRadius: 6, background: "rgba(14,20,36,0.95)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: "#60c0f0", fontWeight: "bold" }}>{d}</div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 18, color: "#1976d2", textAlign: "center", marginBottom: 6 }}>[{paperModal.roll}]</div>
            <div style={{ fontSize: 13, color: "#60c0f0", marginBottom: 8, textAlign: "center" }}>{paperModal.title}</div>
            <div style={{ fontSize: 11, color: "#4a6070", lineHeight: 1.8 }}>{paperModal.effect}</div>
            <button onClick={() => setPaperModal(null)} style={{ marginTop: 12, width: "100%", padding: "7px", background: "rgba(192,57,43,0.15)", border: "1px solid #5a1a1a", color: C.red, cursor: "pointer", borderRadius: 3, fontSize: 12 }}>確認した</button>
          </div>
        </div>
      )}
    </div>
  );
}
