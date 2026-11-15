// SessionView から分割: PCカード（能力・アイテム・行動）とキャラ詳細
import { useState, useEffect, useRef } from "react";
import { CharSprite } from "../CharSprite";
import { sfx } from "../audio";
import { EDGES } from "../data/gameData";
import { C, btnFull } from "../styles/colors";
import { getAbilityEffect, applyAbilityPassiveStats } from "../data/abilityEffects";
import { achAddTo } from "../data/achievements";
import { BAD_STATUS_TABLE, INIT_ITEMS, INIT_RESOURCES, ITEM_DATA, ITEM_NAMES, PS_ONCE_FLAG, SKILL_TYPE_COLOR, SpellCard, buildSpellCard, gainIntimacy, getSpotByD66 } from "./shared";

// 発動可能スキルの強調：ブロック枠（左アクセント＋淡い地＋内側グロー）と発動ボタン
export const skillReadyBox = (color) => ({ borderLeft: `3px solid ${color}`, background: `${color}12`, borderRadius: 4, padding: "6px 8px", boxShadow: `inset 0 0 0 1px ${color}26` });
export const skillActivateBtn = (color) => ({ padding: "5px 14px", cursor: "pointer", borderRadius: 4, fontSize: 11, fontWeight: 700, background: `${color}30`, border: `1px solid ${color}`, color, boxShadow: `0 0 7px ${color}45` });

// ─── ItemUseModal ─────────────────────────────────────────────────
export function ItemUseModal({ itemName, pc, onConfirm, onCancel }) {
  const data = ITEM_DATA[itemName];
  if (!data) return null;
  const canUse = data.canUse(pc);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={onCancel}>
      <SpellCard color={C.gold} title={`✦ 【${itemName}】を使用する`} style={{ maxWidth: 340, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 4, letterSpacing: 2 }}>タイミング: {data.timing}</div>
        <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.8, marginBottom: 14 }}>{data.desc}</div>
        {!canUse && <div style={{ fontSize: 10, color: C.red, marginBottom: 8 }}>使用条件を満たしていません</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => canUse && onConfirm()} disabled={!canUse} style={{ flex: 1, padding: "8px", cursor: canUse ? "pointer" : "not-allowed", borderRadius: 2, background: canUse ? C.goldBg : "rgba(255,255,255,0.02)", border: canUse ? `1px solid ${C.goldDim}` : `1px solid ${C.border}`, color: canUse ? C.gold : C.textFaint, fontSize: 12 }}>使用する</button>
          <button onClick={onCancel} style={{ flex: 1, padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
        </div>
      </SpellCard>
    </div>
  );
}

// ─── SkillActivateModal ───────────────────────────────────────────
export function SkillActivateModal({ skillName, skillType, desc, onConfirm, onCancel }) {
  const typeColor = SKILL_TYPE_COLOR[skillType] || C.text;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={onCancel}>
      <SpellCard color={typeColor} title={`✦ 《${skillName}》を発動する`} headerRight={<span style={{ padding: "2px 8px", background: `${typeColor}18`, border: `1px solid ${typeColor}50`, borderRadius: 10, fontSize: 9, color: typeColor }}>{skillType}</span>} style={{ maxWidth: 360, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.8, marginBottom: 14 }}>{desc}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onConfirm} style={{ flex: 1, padding: "8px", cursor: "pointer", borderRadius: 2, background: C.goldBg, border: `1px solid ${C.goldDim}`, color: C.gold, fontSize: 12 }}>発動する</button>
          <button onClick={onCancel}  style={{ flex: 1, padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
        </div>
      </SpellCard>
    </div>
  );
}

// CharDetailModal 内のセクション見出し（render 内で定義しないようモジュールレベルに）
export function Section({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  );
}

// ─── CharDetailModal（キャラクター詳細・読み取り専用） ────────────────
export function CharDetailModal({ pc, onClose }) {
  const skill   = pc.ps || null;
  const isGrownAbility = !!(pc.growthAbilityUnlocked && pc.growthAbility?.name);
  const ability = isGrownAbility ? pc.growthAbility : (pc.as || null);
  const danmaku = pc.ds || null;
  const spellTexts = [
    ...(pc.spellCards || []),
    ...(pc.growthSpellUnlocked && pc.growthSpellCard ? [pc.growthSpellCard] : []),
  ].filter(Boolean);
  const spells  = spellTexts.map(t => buildSpellCard(t)).filter(Boolean);
  const bonds   = pc.bonds || [];
  const badStatus = pc.badStatus || [];
  const resKeys = ["やる気", "残り人数", "スペルカード", "グレイズ", "霊力", "攻撃力"];
  const resources = pc.resources || {};

  const renderSkill = (s, accentColor) => (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
        {s.type && <span style={{ padding: "1px 6px", background: `${SKILL_TYPE_COLOR[s.type] || accentColor}18`, border: `1px solid ${SKILL_TYPE_COLOR[s.type] || accentColor}50`, borderRadius: 8, fontSize: 8, color: SKILL_TYPE_COLOR[s.type] || accentColor }}>{s.type}</span>}
        <span style={{ fontSize: 11, color: accentColor }}>《{s.name}》</span>
      </div>
      <div style={{ fontSize: 9, color: C.textDim, lineHeight: 1.7 }}>{s.desc}</div>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 120, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={onClose}>
      <SpellCard
        color={C.gold}
        title={`✦ ${pc.charName}`}
        headerRight={(pc.tags || []).length > 0 ? <span style={{ fontSize: 9, color: C.gold }}>《{pc.tags.join("》《")}》</span> : null}
        style={{ maxWidth: 460, width: "92%", maxHeight: "86vh", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }}
        contentStyle={{ padding: 0 }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: "12px 16px", maxHeight: "calc(86vh - 70px)", overflowY: "auto" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
            {pc.customPortrait
              ? <img src={pc.customPortrait} style={{ width: 56, height: 56, borderRadius: 6, objectFit: "cover", border: `1px solid ${C.goldDim}` }} />
              : <CharSprite spriteRow={pc.spriteRow ?? -1} spriteCol={pc.spriteCol ?? -1} size={56} />}
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {resKeys.map(k => {
                const r = resources[k] || { cur: 0, max: 1 };
                return (
                  <div key={k} style={{ padding: "3px 7px", background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, borderRadius: 3, textAlign: "center", minWidth: 44 }}>
                    <div style={{ fontSize: 7, color: C.textFaint }}>{k}</div>
                    <div style={{ fontSize: 12, color: C.gold }}>{r.cur}{r.max > 1 && <span style={{ fontSize: 7, color: C.textFaint }}>/{r.max}</span>}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {skill && <Section label="個性スキル">{renderSkill(skill, skill.type !== "オート" ? C.gold : "#81c784")}</Section>}
          {ability && <Section label={isGrownAbility ? "能力スキル＋（成長）" : "能力スキル"}>{renderSkill(ability, "#90caf9")}</Section>}
          {danmaku && <Section label="弾幕スキル">{renderSkill({ ...danmaku, type: danmaku.type || null }, C.red)}</Section>}

          {spells.length > 0 && (
            <Section label="スペルカード">
              {spells.map((sp, i) => (
                <div key={i} style={{ marginBottom: 8, padding: "7px 10px", background: "rgba(200,160,64,0.06)", border: `1px solid ${C.goldDim}55`, borderRadius: 4 }}>
                  <div style={{ fontSize: 11, color: C.gold, marginBottom: 3 }}>{sp.name}</div>
                  <div style={{ fontSize: 9, color: C.textDim, lineHeight: 1.6 }}>{sp.textBody || sp.text}</div>
                  {sp.condition && <div style={{ fontSize: 9, color: C.red, marginTop: 3 }}>⚠ {sp.condition}</div>}
                </div>
              ))}
            </Section>
          )}

          {pc.specialBond && (
            <Section label="特別な絆">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ padding: "3px 10px", background: "rgba(255,213,79,0.14)", border: `1px solid ${C.goldDim}`, borderRadius: 10, fontSize: 11, color: C.gold }}>《{pc.specialBond.target}への{pc.specialBond.word || "敬意"}》</span>
                <span style={{ fontSize: 10, color: C.textDim }}>親密度 <span style={{ color: C.gold, fontWeight: "bold" }}>{pc.specialBond.intimacy ?? 1}</span> / 10</span>
              </div>
            </Section>
          )}

          {bonds.length > 0 && (
            <Section label="絆">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {bonds.map(b => {
                  const isFrom = b.endsWith("からの絆");
                  return (
                    <span key={b} style={{ padding: "2px 8px", background: isFrom ? "rgba(156,39,176,0.1)" : "rgba(200,160,64,0.1)", border: `1px solid ${isFrom ? C.purpleBorder : C.goldDim}50`, borderRadius: 10, fontSize: 10, color: isFrom ? C.purple : C.gold }}>《{b}》</span>
                  );
                })}
              </div>
            </Section>
          )}

          {badStatus.length > 0 && (
            <Section label="変調">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {badStatus.map(bs => {
                  const bData = Object.values(BAD_STATUS_TABLE).find(x => x.name === bs);
                  return (
                    <div key={bs} style={{ padding: "4px 8px", background: "rgba(224,112,96,0.15)", border: `1px solid ${C.redBorder}`, borderRadius: 4 }}>
                      <div style={{ fontSize: 10, color: C.red, fontWeight: "bold" }}>《{bs}》</div>
                      <div style={{ fontSize: 8, color: C.textDim, lineHeight: 1.4 }}>{bData?.desc}</div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}
        </div>
      </SpellCard>
    </div>
  );
}

// ─── PCCard ───────────────────────────────────────────────────────
export function PCCard({ pc, gs, isGm, onUpdatePc, upd, animateDice, getSpot, SPOTS, isOnline = false }) {
  const [itemModal, setItemModal]   = useState(null);
  const [skillModal, setSkillModal] = useState(null);
  const [abilityModal, setAbilityModal] = useState(null);
  const [abilityItemPick, setAbilityItemPick] = useState(null);
  const [abilityCure, setAbilityCure] = useState(null); // 変調除去ピッカー { name, freq, params, targetUid }
  const [abilityRefresh, setAbilityRefresh] = useState(null); // 応援欄リフレッシュ { name, freq, targetUid }
  const [abilityMove, setAbilityMove] = useState(null); // パーティ移動 { name, freq, params, selected[], moveSelf }
  const [abilitySurprise, setAbilitySurprise] = useState(null); // 絆獲得判定 { name, freq, params, targetUid, x }
  const [abilitySpend, setAbilitySpend] = useState(null); // アイテム消費獲得 { name, freq, params, spendItem, mode }
  const [abilityDestroy, setAbilityDestroy] = useState(null); // 破壊 { name, freq, targetUid, category }
  const [abilityReturn, setAbilityReturn] = useState(null); // 密と疎：帰還先変更 { name, freq, params, selected[], destSpot }
  const [abilityScenePick, setAbilityScenePick] = useState(null); // 吉弔：追加シーン対象選択 { name, freq }
  const [abilityBoost, setAbilityBoost] = useState(null); // 核融合：同スポット他PCのやる気+ { name, freq, amount }
  const [minionMove, setMinionMove] = useState(null); // 手下移動：移動する手下のid（null=非選択）
  const [abilitySearchClue, setAbilitySearchClue] = useState(null); // 探し物：手がかり配置スポット選択 { name, freq }
  const [abilityReadMind, setAbilityReadMind] = useState(null); // 心を読む：絆取得対象選択 { name, freq }
  const [abilityReiBoost, setAbilityReiBoost] = useState(null); // あらゆるものの背中：霊力増加対象選択 { name, freq, amount, selected[] }
  const [abilityBoundary, setAbilityBoundary] = useState(null); // 境界：移動先選択 { name, freq, consume, mustBase }
  const [abilityFortune, setAbilityFortune] = useState(null); // 財産を消費させる：対象/アイテム選択 { name, freq, targetUid }
  const [expanded, setExpanded]     = useState(false);
  const [gmEdit, setGmEdit]         = useState(false);
  const [detailModal, setDetailModal] = useState(false);
  const [resFlash, setResFlash]     = useState({});
  const prevResRef                  = useRef(null);
  const prevOnceFlagRef             = useRef(null);

  const resources     = pc.resources || INIT_RESOURCES();
  const items         = pc.items     || INIT_ITEMS();
  const badStatus     = pc.badStatus || [];
  const skill         = pc.ps || null;
  const isAbilityGrown = !!pc.growthAbilityUnlocked;
  // 能力スキルの強化後は能力スキル＋（growthAbility）が基本能力（as）を置き換える
  const activeAbility  = (isAbilityGrown && pc.growthAbility?.name) ? pc.growthAbility : pc.as;
  const isCustomChar  = pc.charId?.startsWith("custom_");
  const hasActed      = (gs.actedPcs ||[]).includes(pc.uid);
  const isActing      = gs.currentScene?.pcUid === pc.uid;
  // 強調表示用：個性スキルが今すぐ発動可能か＋その色（型色）
  const psColor = SKILL_TYPE_COLOR[skill?.type] || C.gold;
  const abColor = SKILL_TYPE_COLOR[activeAbility?.type] || "#90caf9";
  const _currentSpotName  = getSpot(pc.currentSpot)?.name || "-";

  const consumeItem = itemName => {
    const data = ITEM_DATA[itemName];
    if (!data) return;
    sfx.itemUse();
    onUpdatePc(data.use(pc, gs));
    setItemModal(null);
  };

  const activateSkill = () => {
    setSkillModal(null);
    const skillName = skill?.name;

    if (skillName === "真面目") {
      // D6点 霊力獲得
      animateDice(1, "真面目（霊力回復）", res => {
        const gain = res[0];
        const r = pc.resources.霊力 || { cur: 0, max: 20 };
        if ((pc.badStatus || []).includes("スランプ")) {
          onUpdatePc({ ...pc, skillActivatedThisSession: (pc.skillActivatedThisSession || 0) + 1 });
          return;
        }
        const nextCur = Math.min(r.max, r.cur + gain);
        onUpdatePc({ ...pc,
          skillActivatedThisSession: (pc.skillActivatedThisSession || 0) + 1,
          resources: { ...pc.resources,
            霊力: { ...r, cur: nextCur },
            攻撃力: { ...pc.resources.攻撃力, cur: 1 + Math.floor(nextCur / 5) }
          }
        });
      });
      return;
    }

    if (skillName === "怠け者") {
      // 自身への絆を獲得
      const selfBond = `${pc.charName}自身への絆`;
      const bonds = [...(pc.bonds || [])];
      if (!bonds.includes(selfBond)) bonds.push(selfBond);
      onUpdatePc({ ...pc, skillActivatedThisSession: (pc.skillActivatedThisSession || 0) + 1, bonds, bondUsed: { ...(pc.bondUsed || {}), [selfBond]: false } });
      return;
    }

    if (skillName === "信仰") {
      // 好きなタグを1つ獲得
      const tag = window.prompt("獲得するタグ名を入力してください");
      if (!tag || !tag.trim()) return;
      const tags = [...(pc.tags || [])];
      if (!tags.includes(tag.trim())) tags.push(tag.trim());
      onUpdatePc({ ...pc, skillActivatedThisSession: (pc.skillActivatedThisSession || 0) + 1, tags });
      return;
    }

    if (skillName === "胡乱" && upd) {
      // 全手がかり除去→ランダム再配置
      upd(p => {
        const count = (p.clues || []).length;
        if (count === 0) return { ...p, pcs: p.pcs.map(x => x.uid !== pc.uid ? x : { ...x, skillActivatedThisSession: (x.skillActivatedThisSession || 0) + 1 }), log: [`${pc.charName}《胡乱》: 手がかりがありませんでした`, ...p.log] };
        const spotIds = (SPOTS || []).map(s => s.id);
        const newClues = [];
        for (let i = 0; i < count; i++) {
          newClues.push(spotIds[Math.floor(Math.random() * spotIds.length)]);
        }
        return { ...p,
          clues: newClues,
          nonSearchCluePlaced: true, // 実績(鼠算式探索): 探し物以外の手がかり配置
          pcs: p.pcs.map(x => x.uid !== pc.uid ? x : { ...x, skillActivatedThisSession: (x.skillActivatedThisSession || 0) + 1 }),
          log: [`${pc.charName}《胡乱》: 手がかり${count}つをランダムに再配置した`, ...p.log]
        };
      });
      return;
    }

    if (skillName === "カリスマ") {
      // 1セッション1回 手下登場（GM手動）
      if (pc[PS_ONCE_FLAG]) return;
      onUpdatePc({ ...pc, skillActivatedThisSession: (pc.skillActivatedThisSession || 0) + 1, [PS_ONCE_FLAG]: true });
      return;
    }

    // その他：カウント+ログのみ
    onUpdatePc({ ...pc, skillActivatedThisSession: (pc.skillActivatedThisSession || 0) + 1 });
  };

  // ─── 能力スキル（as / growthAbility）の発動 ───────────────────────────
  // 使用回数フラグ。pc.abilityUse = { [能力名]: { day, session, sceneId } }
  const abilitySceneId = () => gs.currentScene?.pcUid ?? null;
  const abilityUsedUp = (ability) => {
    const meta = getAbilityEffect(ability);
    const freq = meta?.freq;
    if (!freq) return false;
    const u = pc.abilityUse?.[ability.name];
    if (!u) return false;
    if (freq === "day")     return u.day === gs.day;
    if (freq === "session") return !!u.session;
    if (freq === "scene")   return u.sceneId === abilitySceneId();
    return false;
  };
  // base(pc派生) に使用回数フラグを記録して返す
  const withAbilityUse = (base, name, freq) => {
    if (!freq) return base;
    const use = { ...(pc.abilityUse || {}) };
    const cur = { ...(use[name] || {}) };
    if (freq === "day")     cur.day = gs.day;
    if (freq === "session") cur.session = true;
    if (freq === "scene")   cur.sceneId = abilitySceneId();
    use[name] = cur;
    return { ...base, abilityUse: use };
  };

  const activateAbility = (ability) => {
    setAbilityModal(null);
    if (!ability?.name) return;
    const meta = getAbilityEffect(ability);
    const name = ability.name;
    const freq = meta?.freq || null;
    // pc派生 base にログを添えて単一 upd で書き込む（二重書き込み回避）
    const commit = (base, logMsg) => upd(p => ({
      ...p,
      pcs: p.pcs.map(x => x.uid === pc.uid ? base : x),
      log: [logMsg, ...p.log],
    }));

    if (meta?.auto && meta.kind === "gain_yaruki") {
      const amt = meta.params?.amount || 1;
      const r = pc.resources.やる気 || { cur: 0, max: 99 };
      sfx.skillActivate();
      commit(withAbilityUse({ ...pc, resources: { ...pc.resources, やる気: { ...r, cur: Math.min(r.max, r.cur + amt) } } }, name, freq),
        `🔵 ${pc.charName} が能力《${name}》を発動：やる気+${amt}`);
      return;
    }
    if (meta?.auto && meta.kind === "gain_rei") {
      const amt = meta.params?.amount || 1;
      const r = pc.resources.霊力 || { cur: 0, max: 20 };
      const nextCur = Math.min(r.max, r.cur + amt);
      sfx.skillActivate();
      commit(withAbilityUse({ ...pc, resources: { ...pc.resources, 霊力: { ...r, cur: nextCur }, 攻撃力: { ...pc.resources.攻撃力, cur: 1 + Math.floor(nextCur / 5) } } }, name, freq),
        `🔵 ${pc.charName} が能力《${name}》を発動：霊力+${amt}`);
      return;
    }
    if (meta?.auto && meta.kind === "set_rei") {
      // 霊力を指定値にする（既に上回っていれば据え置き＝不利益を出さない）
      const v = meta.params?.value || 10;
      const r = pc.resources.霊力 || { cur: 0, max: 20 };
      const nextCur = Math.max(r.cur, Math.min(r.max, v));
      sfx.skillActivate();
      commit(withAbilityUse({ ...pc, resources: { ...pc.resources, 霊力: { ...r, cur: nextCur }, 攻撃力: { ...pc.resources.攻撃力, cur: 1 + Math.floor(nextCur / 5) } } }, name, freq),
        `🔵 ${pc.charName} が能力《${name}》を発動：霊力を${nextCur}にした`);
      return;
    }
    if (meta?.auto && meta.kind === "gain_random_item") {
      const count = meta.params?.count || 1;
      animateDice(count, `${name}（アイテム獲得）`, res => {
        const names = res.map(d => ITEM_NAMES[d - 1]);
        const nextItems = { ...pc.items };
        names.forEach(n => { nextItems[n] = (nextItems[n] || 0) + 1; });
        commit(withAbilityUse({ ...pc, items: nextItems }, name, freq),
          `🔵 ${pc.charName} が能力《${name}》を発動：【${names.join("】【")}】を獲得`);
      });
      return;
    }
    if (meta?.auto && meta.kind === "gain_yaruki_selfbond") {
      const amt = meta.params?.amount || 1;
      const r = pc.resources.やる気 || { cur: 0, max: 99 };
      const selfBond = `${pc.charName}自身への絆`;
      const bonds = (pc.bonds || []).includes(selfBond) ? pc.bonds : [...(pc.bonds || []), selfBond];
      sfx.skillActivate();
      commit(withAbilityUse({ ...pc,
        resources: { ...pc.resources, やる気: { ...r, cur: Math.min(r.max, r.cur + amt) } },
        bonds,
        bondUsed: { ...(pc.bondUsed || {}), [selfBond]: false },
      }, name, freq),
        `🔵 ${pc.charName} が能力《${name}》を発動：やる気+${amt}・《${selfBond}》を獲得`);
      return;
    }
    if (meta?.auto && meta.kind === "gain_choice_item") {
      // 好きなアイテムを1つ選んで獲得（ピッカーを開く）
      setAbilityItemPick({ name, freq });
      return;
    }
    if (meta?.auto && meta.kind === "cure_bad_status") {
      // 同スポットのキャラの変調1つを除去（対象→変調の2段ピッカー）
      setAbilityCure({ name, freq, params: meta.params || {}, targetUid: null });
      return;
    }
    if (meta?.auto && meta.kind === "refresh_other_cheer_slot") {
      // 他キャラの使用済み応援欄（bondUsed===true）を1つ解除（対象→絆の2段ピッカー）
      setAbilityRefresh({ name, freq, targetUid: null });
      return;
    }
    if (meta?.auto && meta.kind === "party_move") {
      // 同スポットのキャラを連れて好きなスポットへ移動（連れる対象→移動先）
      setAbilityMove({ name, freq, params: meta.params || {}, selected: [], moveSelf: true });
      return;
    }
    if (meta?.auto && meta.kind === "surprise_bond") {
      // 同スポット1人に行為判定→成功で絆＋やる気／失敗で相手が自分への絆
      setAbilitySurprise({ name, freq, params: meta.params || {}, targetUid: null, x: 4 });
      return;
    }
    if (meta?.auto && meta.kind === "spend_item_gain_random") {
      // 所持アイテム1つを失ってランダム（or 好きな）アイテムを獲得
      setAbilitySpend({ name, freq, params: meta.params || {}, spendItem: null, mode: null });
      return;
    }
    if (meta?.auto && meta.kind === "destroy_one") {
      // キャラ1人のタグ/変調/アイテムのうち1つを失わせる
      setAbilityDestroy({ name, freq, targetUid: null, category: null });
      return;
    }
    if (meta?.auto && meta.kind === "set_return_spot") {
      // 帰還先を変更（自分＋選んだPCを任意スポットへ）
      setAbilityReturn({ name, freq, params: meta.params || {}, selected: [], destSpot: null });
      return;
    }
    if (meta?.auto && meta.kind === "redo_own_scene") {
      // 自分のシーンをもう一度（行動済みを解除し、再度シーンプレイヤーに選べるように）
      sfx.skillActivate();
      upd(p => ({
        ...p,
        pcs: p.pcs.map(x => x.uid !== pc.uid ? x : withAbilityUse({ ...x }, name, freq)),
        actedPcs: (p.actedPcs || []).filter(u => u !== pc.uid),
        log: [`🔵 ${pc.charName} が能力《${name}》を発動：もう一度シーンを行える（行動済みを解除）`, ...p.log],
      }));
      return;
    }
    if (meta?.auto && meta.kind === "grant_extra_scene") {
      // 選んだPCがもう一度シーンを行えるようにする（対象選択ピッカー）
      setAbilityScenePick({ name, freq });
      return;
    }
    if (meta?.auto && meta.kind === "reactive_gain") {
      // 発火時に押す手動トリガー：やる気/霊力を獲得（reiDice なら D6 を振る）
      const pr = meta.params || {};
      const applyGains = (reiGain) => {
        const yr = pc.resources.やる気 || { cur: 0, max: 99 };
        const rr = pc.resources.霊力 || { cur: 0, max: 20 };
        const newYaruki = Math.min(yr.max, yr.cur + (pr.yaruki || 0));
        const newRei = Math.min(rr.max, rr.cur + reiGain);
        const parts = [];
        if (pr.yaruki) parts.push(`やる気+${pr.yaruki}`);
        if (reiGain) parts.push(`霊力+${reiGain}`);
        commit(withAbilityUse({ ...pc, resources: { ...pc.resources, やる気: { ...yr, cur: newYaruki }, 霊力: { ...rr, cur: newRei }, 攻撃力: { ...pc.resources.攻撃力, cur: 1 + Math.floor(newRei / 5) } } }, name, freq),
          `🔵 ${pc.charName} が能力《${name}》を発動：${parts.join("・") || "獲得"}`);
      };
      if (pr.reiDice) {
        animateDice(1, `${name}（霊力獲得）`, res => applyGains(res[0]));
      } else {
        sfx.skillActivate();
        applyGains(pr.rei || 0);
      }
      return;
    }
    if (meta?.auto && meta.kind === "boost_other_yaruki") {
      // 同スポットの他PCのやる気獲得に+α（対象選択ピッカー）
      setAbilityBoost({ name, freq, amount: meta.params?.amount || 1 });
      return;
    }
    if (meta?.auto && meta.kind === "set_unlucky_phase") {
      // このフェイズ中、全員が出目すべて2以下でファンブル（gs.unluckyPhase）
      sfx.skillActivate();
      upd(p => ({
        ...p,
        pcs: p.pcs.map(x => x.uid === pc.uid ? withAbilityUse({ ...x }, name, freq) : x),
        unluckyPhase: true,
        log: [`🔵 ${pc.charName} が能力《${name}》を発動：このフェイズ中、全員の判定が出目2以下でファンブルになる`, ...p.log],
      }));
      return;
    }
    if (meta?.auto && meta.kind === "read_mind") {
      // 誰かがあなたへの絆を取得した時：その相手への絆を取得（対象ピッカー）
      setAbilityReadMind({ name, freq });
      return;
    }
    if (meta?.auto && meta.kind === "select_rei_boost") {
      // 霊力増加+α の対象キャラを選ぶ（複数選択）
      const cur = (gs.reiBoostTargets?.uids) || [];
      setAbilityReiBoost({ name, freq, amount: meta.params?.amount || 1, selected: cur, target: "rei" });
      return;
    }
    if (meta?.auto && meta.kind === "select_item_swap") {
      // アイテム交換できる対象キャラを選ぶ（複数選択）
      const cur = gs.itemSwapTargets || [];
      setAbilityReiBoost({ name, freq, amount: 0, selected: cur, target: "itemSwap" });
      return;
    }
    if (meta?.auto && meta.kind === "toggle_untargetable") {
      // 正体を判らなくする：自分を特殊効果の対象に選べなくする（トグル）
      sfx.skillActivate();
      commit({ ...pc, untargetable: !pc.untargetable }, `🔵 ${pc.charName} が能力《${name}》を発動：対象に${pc.untargetable ? "選べるように戻した" : "選べなくした"}`);
      return;
    }
    if (meta?.auto && meta.kind === "set_eternity_night") {
      // 永遠と須臾：この夜サイクルの終了で帰還/やる気減少を行わず夜をもう一度（base=リミット-1）
      sfx.skillActivate();
      upd(p => ({
        ...p,
        pcs: p.pcs.map(x => x.uid === pc.uid ? withAbilityUse({ ...x }, name, freq) : x),
        eternityNight: true,
        eternityShorten: !!meta.params?.shorten,
        log: [`🔵 ${pc.charName} が能力《${name}》を発動：この夜サイクルの終了で夜をもう一度行う（帰還・やる気減少なし${meta.params?.shorten ? "・リミット-1" : ""}）`, ...p.log],
      }));
      return;
    }
    if (meta?.auto && meta.kind === "consume_others_item") {
      // 財産を消費させる：他者のアイテム1つを消費し、その効果を自分に適用（対象→アイテムの2段ピッカー）
      setAbilityFortune({ name, freq, targetUid: null });
      return;
    }
    if (meta?.auto && meta.kind === "boundary_move") {
      // 境界: ダイス1つ→（base:偶数でやる気-1）→任意/拠点移動＋アクション
      const isPlus = meta.params?.plus;
      animateDice(1, `${name}（境界）`, res => {
        const even = res[0] % 2 === 0;
        const curYaruki = pc.resources.やる気?.cur || 0;
        const consume = (!isPlus && even) ? 1 : 0;
        const afterYaruki = curYaruki - consume;
        const mustBase = isPlus ? (even && curYaruki === 1) : (afterYaruki === 1);
        setAbilityBoundary({ name, freq, consume, mustBase });
      });
      return;
    }
    if (meta?.auto && meta.kind === "search_place_clue") {
      // 2D:4 判定 → 成功なら任意スポットに手がかり配置（ピッカー）／失敗ならランダムスポットに配置
      animateDice(2, `${name}（2D:4）`, res => {
        const success = Math.max(...res) >= 4;
        if (success) {
          // 使用フラグだけ先に記録し、配置先をピッカーで選ぶ
          commit(withAbilityUse({ ...pc }, name, freq), `🔵 ${pc.charName} が能力《${name}》発動：成功(出目${res.join(",")})→手がかりを配置するスポットを選択`);
          setAbilitySearchClue({ name, freq });
        } else {
          const spots = (SPOTS || []).filter(s => s.id !== "dream");
          const dest = spots[Math.floor(Math.random() * spots.length)];
          upd(p => ({
            ...p,
            pcs: p.pcs.map(x => x.uid === pc.uid ? withAbilityUse({ ...x }, name, freq) : x),
            clues: Array.from(new Set([...(p.clues || []), dest.id])),
            searchCluePlaced: true, // 実績(鼠算式探索): 探し物由来の手がかり
            log: [`🔵 ${pc.charName} が能力《${name}》発動：失敗(出目${res.join(",")})→ランダムに [${dest.name}] へ手がかりを配置`, ...p.log],
          }));
        }
      });
      return;
    }
    if (meta?.auto && meta.kind === "gain_bonds_same_spot") {
      // 同スポットの自分以外のキャラ全員への絆を取得（交流）
      const others = (gs.pcs || []).filter(x => x.uid !== pc.uid && x.currentSpot === pc.currentSpot && !(x.badStatus || []).includes("不機嫌"));
      if (others.length === 0) { commit(withAbilityUse({ ...pc }, name, freq), `🔵 ${pc.charName} が能力《${name}》発動：同スポットに対象がいません`); return; }
      const newBonds = [...(pc.bonds || [])];
      const newBondUsed = { ...(pc.bondUsed || {}) };
      others.forEach(o => { const b = `${o.charName}への絆`; if (!newBonds.includes(b)) newBonds.push(b); newBondUsed[b] = false; });
      sfx.skillActivate();
      commit(withAbilityUse({ ...pc, bonds: newBonds, bondUsed: newBondUsed }, name, freq),
        `🔵 ${pc.charName} が能力《${name}》発動：${others.map(o => o.charName).join("・")} への絆を取得`);
      return;
    }
    if (meta?.auto && meta.kind === "disguise") {
      // なりすまし：化ける（解除トグル）。化ける相手はプロンプトで指定。
      if (pc.disguisedAs) {
        sfx.skillActivate();
        commit({ ...pc, disguisedAs: null }, `🔵 ${pc.charName} が《${name}》の変身を解除した`);
        return;
      }
      const target = window.prompt("化けるキャラクター名を入力してください");
      if (!target || !target.trim()) return;
      sfx.skillActivate();
      commit(withAbilityUse({ ...pc, disguisedAs: target.trim() }, name, freq),
        `🔵 ${pc.charName} が能力《${name}》を発動：${target.trim()} に化けた（絆取得時の選択はGM）`);
      return;
    }
    if (meta?.auto && meta.kind === "consume_rei_newspaper") {
      // 念写：霊力を消費して文々。新聞表を振る（表ロールはGM）
      const pr = meta.params || {};
      const doConsume = (amt) => {
        const r = pc.resources.霊力 || { cur: 0, max: 20 };
        const nextCur = Math.max(0, r.cur - amt);
        commit(withAbilityUse({ ...pc, resources: { ...pc.resources, 霊力: { ...r, cur: nextCur }, 攻撃力: { ...pc.resources.攻撃力, cur: 1 + Math.floor(nextCur / 5) } } }, name, freq),
          `🔵 ${pc.charName} が能力《${name}》を発動：霊力-${amt} → GMが文々。新聞表を振ってください`);
      };
      if (pr.reiDice) animateDice(1, `${name}（霊力消費）`, res => doConsume(res[0]));
      else { sfx.skillActivate(); doConsume(pr.rei || 1); }
      return;
    }
    if (meta?.auto && meta.kind === "spawn_minion") {
      // 手下をマップに登場させる（あなたのスポット or 拠点）。式神はSC消費＋手下シーン再処理。
      const pr = meta.params || {};
      const spot = pr.at === "base" ? (pc.baseSpotId || pc.currentSpot) : pc.currentSpot;
      const scCost = pr.costSC || (pr.costSCorRei ? 1 : 0);
      const sc = pc.resources.スペルカード || { cur: 0, max: 99 };
      const costPatch = scCost ? { resources: { ...pc.resources, スペルカード: { ...sc, cur: Math.max(0, sc.cur - scCost) } } } : {};
      // 式神: 既に手下がいればそれを使う（いなければ拠点に登場）
      const existing = pr.redoScene ? (gs.minions || []).find(m => m.ownerUid === pc.uid) : null;
      const minionId = existing ? existing.id : `m_${pc.uid}_${Date.now()}`;
      const minionSpot = existing ? existing.currentSpot : spot;
      sfx.skillActivate();
      upd(p => ({
        ...p,
        pcs: p.pcs.map(x => x.uid !== pc.uid ? x : withAbilityUse({ ...x, ...costPatch }, name, freq)),
        minions: existing ? (p.minions || []) : [...(p.minions || []), { id: minionId, ownerUid: pc.uid, ownerName: pc.charName, currentSpot: spot }],
        ...(pr.redoScene ? { actedPcs: (p.actedPcs || []).filter(u => u !== pc.uid), currentScene: { pcUid: pc.uid, minionId, phase: "move_or_stay", startSpot: minionSpot, moveDice: [], actionDice: [], actionDiceCount: 2 } } : {}),
        log: [`🔵 ${pc.charName} が能力《${name}》を発動：${existing ? "手下" : `手下を[${getSpot(spot)?.name}]に登場し`}でシーンを再処理${scCost ? `（SC-${scCost}）` : ""}`, ...p.log],
      }));
      return;
    }

    // 手動フォールバック：発動ログのみ（効果はGMが処理）
    sfx.skillActivate();
    commit(withAbilityUse({ ...pc }, name, freq),
      `🔵 ${pc.charName} が能力《${name}》を発動（効果はGMが処理）`);
  };

  // gain_choice_item：ピッカーで選んだアイテムを獲得して確定する
  const confirmAbilityItem = (itemName) => {
    const pick = abilityItemPick;
    setAbilityItemPick(null);
    if (!pick) return;
    const nextItems = { ...pc.items, [itemName]: (pc.items?.[itemName] || 0) + 1 };
    const base = withAbilityUse({ ...pc, items: nextItems }, pick.name, pick.freq);
    upd(p => ({
      ...p,
      pcs: p.pcs.map(x => x.uid === pc.uid ? base : x),
      log: [`🔵 ${pc.charName} が能力《${pick.name}》を発動：【${itemName}】を獲得`, ...p.log],
    }));
  };

  // cure_bad_status：対象キャラの変調 bsName を除去（＋params.grantTag があればタグ付与）
  const confirmCure = (targetUid, bsName) => {
    const cure = abilityCure;
    setAbilityCure(null);
    if (!cure) return;
    const grantTag = cure.params?.grantTag;
    upd(p => {
      const selfBase = withAbilityUse({ ...pc }, cure.name, cure.freq);
      const target = p.pcs.find(x => x.uid === targetUid);
      const targetName = target?.charName || "対象";
      return {
        ...p,
        pcs: p.pcs.map(x => {
          // 発動者の使用回数フラグ
          let nx = x.uid === pc.uid ? { ...x, abilityUse: selfBase.abilityUse } : x;
          if (x.uid === targetUid) {
            const nextBs = (x.badStatus || []).filter(b => b !== bsName);
            const nextTags = grantTag && !(x.tags || []).includes(grantTag) ? [...(x.tags || []), grantTag] : x.tags;
            nx = { ...nx, badStatus: nextBs, tags: nextTags };
          }
          return nx;
        }),
        log: [`🔵 ${pc.charName} が能力《${cure.name}》を発動：${targetName} の変調《${bsName}》を除去${grantTag ? `し《${grantTag}》タグを付与` : ""}`, ...p.log],
      };
    });
  };

  // refresh_other_cheer_slot：対象キャラの使用済み応援欄（bondUsed[bond]）を1つ解除
  const confirmRefresh = (targetUid, bond) => {
    const rf = abilityRefresh;
    setAbilityRefresh(null);
    if (!rf) return;
    upd(p => {
      const selfBase = withAbilityUse({ ...pc }, rf.name, rf.freq);
      const targetName = p.pcs.find(x => x.uid === targetUid)?.charName || "対象";
      return {
        ...p,
        pcs: p.pcs.map(x => {
          let nx = x.uid === pc.uid ? { ...x, abilityUse: selfBase.abilityUse } : x;
          if (x.uid === targetUid) nx = { ...nx, bondUsed: { ...(x.bondUsed || {}), [bond]: false } };
          return nx;
        }),
        log: [`🔵 ${pc.charName} が能力《${rf.name}》を発動：${targetName} の《${bond}》の応援欄を1つ解除`, ...p.log],
      };
    });
  };

  // party_move：自分（任意）＋選んだ同スポットキャラを destSpot へ移動
  const confirmPartyMove = (destSpot) => {
    const mv = abilityMove;
    setAbilityMove(null);
    if (!mv) return;
    const moveSet = new Set(mv.selected);
    if (mv.moveSelf) moveSet.add(pc.uid);
    const destName = getSpot(destSpot)?.name || destSpot;
    upd(p => {
      const selfBase = withAbilityUse({ ...pc }, mv.name, mv.freq);
      return {
        ...p,
        pcs: p.pcs.map(x => {
          let nx = x;
          if (x.uid === pc.uid) nx = { ...nx, abilityUse: selfBase.abilityUse };
          if (moveSet.has(x.uid)) nx = { ...nx, currentSpot: destSpot };
          return nx;
        }),
        log: [`🔵 ${pc.charName} が能力《${mv.name}》を発動：${[...moveSet].map(u => p.pcs.find(x => x.uid === u)?.charName).filter(Boolean).join("・")} を【${destName}】へ移動`, ...p.log],
      };
    });
  };

  // surprise_bond：同スポット1人に 2D:X 判定。成功→自分が相手への絆＋やる気1／失敗→相手が自分への絆
  const runSurprise = () => {
    const sp = abilitySurprise;
    if (!sp || !sp.targetUid) return;
    setAbilitySurprise(null);
    const target = gs.pcs.find(x => x.uid === sp.targetUid);
    const targetName = target?.charName || "対象";
    const x = sp.params?.declareX ? sp.x : 4;
    animateDice(2, `${sp.name}（2D:${x}）`, res => {
      const success = Math.max(...res) >= x;
      const selfUse = withAbilityUse({ ...pc }, sp.name, sp.freq).abilityUse;
      upd(p => {
        if (success) {
          const bond = `${targetName}への絆`;
          return {
            ...p,
            pcs: p.pcs.map(z => z.uid !== pc.uid ? z : {
              ...z, abilityUse: selfUse,
              bonds: (z.bonds || []).includes(bond) ? z.bonds : [...(z.bonds || []), bond],
              bondUsed: { ...(z.bondUsed || {}), [bond]: false },
              resources: { ...z.resources, やる気: { ...(z.resources.やる気 || { cur: 0, max: 99 }), cur: Math.min((z.resources.やる気?.max || 99), (z.resources.やる気?.cur || 0) + 1) } },
            }),
            log: [`🔵 ${pc.charName} が能力《${sp.name}》発動：成功(出目${res.join(",")})→《${bond}》とやる気+1を獲得`, ...p.log],
          };
        }
        const bond = `${pc.charName}への絆`;
        return {
          ...p,
          pcs: p.pcs.map(z => {
            if (z.uid === pc.uid) return { ...z, abilityUse: selfUse };
            if (z.uid === sp.targetUid) return { ...z,
              bonds: (z.bonds || []).includes(bond) ? z.bonds : [...(z.bonds || []), bond],
              bondUsed: { ...(z.bondUsed || {}), [bond]: false } };
            return z;
          }),
          log: [`🔵 ${pc.charName} が能力《${sp.name}》発動：失敗(出目${res.join(",")})→${targetName} が《${bond}》を獲得`, ...p.log],
        };
      });
    });
  };

  // spend_item_gain_random：spendItem を1つ失い、ランダム n 個 or 好きな1つを獲得
  const runSpendRandom = () => {
    const sd = abilitySpend;
    if (!sd?.spendItem) return;
    setAbilitySpend(null);
    const n = sd.params?.randomCount || 2;
    const spent = sd.spendItem;
    animateDice(n, `${sd.name}（アイテム獲得）`, res => {
      const got = res.map(d => ITEM_NAMES[d - 1]);
      upd(p => {
        const base = withAbilityUse({ ...pc }, sd.name, sd.freq);
        const items = { ...pc.items };
        items[spent] = Math.max(0, (items[spent] || 0) - 1);
        got.forEach(nm => { items[nm] = (items[nm] || 0) + 1; });
        return {
          ...p,
          pcs: p.pcs.map(z => z.uid === pc.uid ? { ...base, items } : z),
          log: [`🔵 ${pc.charName} が能力《${sd.name}》を発動：【${spent}】を失い【${got.join("】【")}】を獲得`, ...p.log],
        };
      });
    });
  };
  const runSpendChoice = (gainItem) => {
    const sd = abilitySpend;
    if (!sd?.spendItem) return;
    setAbilitySpend(null);
    const spent = sd.spendItem;
    upd(p => {
      const base = withAbilityUse({ ...pc }, sd.name, sd.freq);
      const items = { ...pc.items };
      items[spent] = Math.max(0, (items[spent] || 0) - 1);
      items[gainItem] = (items[gainItem] || 0) + 1;
      return {
        ...p,
        pcs: p.pcs.map(z => z.uid === pc.uid ? { ...base, items } : z),
        log: [`🔵 ${pc.charName} が能力《${sd.name}》を発動：【${spent}】を失い【${gainItem}】を獲得`, ...p.log],
      };
    });
  };

  // destroy_one：対象キャラの category(タグ/変調/アイテム) の value を1つ失わせる
  const confirmDestroy = (targetUid, category, value) => {
    const dz = abilityDestroy;
    setAbilityDestroy(null);
    if (!dz) return;
    upd(p => {
      const selfUse = withAbilityUse({ ...pc }, dz.name, dz.freq).abilityUse;
      const targetName = p.pcs.find(x => x.uid === targetUid)?.charName || "対象";
      return {
        ...p,
        pcs: p.pcs.map(x => {
          let nx = x.uid === pc.uid ? { ...x, abilityUse: selfUse } : x;
          if (x.uid === targetUid) {
            if (category === "タグ")   nx = { ...nx, tags: (x.tags || []).filter(t => t !== value) };
            if (category === "変調")   nx = { ...nx, badStatus: (x.badStatus || []).filter(b => b !== value) };
            if (category === "アイテム") nx = { ...nx, items: { ...(x.items || {}), [value]: Math.max(0, (x.items?.[value] || 0) - 1) } };
          }
          return nx;
        }),
        log: [`🔵 ${pc.charName} が能力《${dz.name}》を発動：${targetName} の${category}《${value}》を破壊`, ...p.log],
      };
    });
  };

  // set_return_spot：自分＋選んだPCの帰還先(returnSpotId)を destSpot にする（＋は夜のやる気減少もスキップ）
  const confirmReturn = (destSpot) => {
    const rt = abilityReturn;
    setAbilityReturn(null);
    if (!rt) return;
    const targetSet = new Set([pc.uid, ...rt.selected]);
    const yarukiSkip = !!rt.params?.yarukiSkip;
    const destName = getSpot(destSpot)?.name || destSpot;
    upd(p => {
      const selfBase = withAbilityUse({ ...pc }, rt.name, rt.freq).abilityUse;
      return {
        ...p,
        pcs: p.pcs.map(x => {
          let nx = x.uid === pc.uid ? { ...x, abilityUse: selfBase } : x;
          if (targetSet.has(x.uid)) nx = { ...nx, returnSpotId: destSpot, ...(yarukiSkip ? { returnYarukiSkip: true } : {}) };
          return nx;
        }),
        log: [`🔵 ${pc.charName} が能力《${rt.name}》を発動：${[...targetSet].map(u => p.pcs.find(x => x.uid === u)?.charName).filter(Boolean).join("・")} の帰還先を【${destName}】に${yarukiSkip ? "（夜のやる気減少なし）" : ""}`, ...p.log],
      };
    });
  };

  // grant_extra_scene：選んだPCを行動済みから外し、もう一度シーンを行えるようにする
  const confirmScenePick = (targetUid) => {
    const sp = abilityScenePick;
    setAbilityScenePick(null);
    if (!sp) return;
    upd(p => {
      const selfBase = withAbilityUse({ ...pc }, sp.name, sp.freq).abilityUse;
      const targetName = p.pcs.find(x => x.uid === targetUid)?.charName || "対象";
      return {
        ...p,
        pcs: p.pcs.map(x => x.uid === pc.uid ? { ...x, abilityUse: selfBase } : x),
        actedPcs: (p.actedPcs || []).filter(u => u !== targetUid),
        log: [`🔵 ${pc.charName} が能力《${sp.name}》を発動：${targetName} がもう一度シーンを行える`, ...p.log],
      };
    });
  };

  // search_place_clue（探し物）成功時：選んだスポットに手がかりを配置
  const confirmSearchClue = (spotId) => {
    setAbilitySearchClue(null);
    upd(p => ({
      ...p,
      clues: Array.from(new Set([...(p.clues || []), spotId])),
      searchCluePlaced: true, // 実績(鼠算式探索): 探し物由来の手がかり
      log: [`🔵 ${pc.charName} の《探し物を探し当てる程度の能力》：[${getSpot(spotId)?.name}] へ手がかりを配置`, ...p.log],
    }));
  };

  // read_mind（心を読む）：対象への絆を取得し、対象が持つ「pcへの絆」をチェック済みにする
  const confirmReadMind = (targetUid) => {
    const rm = abilityReadMind;
    setAbilityReadMind(null);
    if (!rm) return;
    upd(p => {
      const selfBase = withAbilityUse({ ...pc }, rm.name, rm.freq).abilityUse;
      const target = p.pcs.find(x => x.uid === targetUid);
      const targetName = target?.charName || "対象";
      const bond = `${targetName}への絆`;
      const myBond = `${pc.charName}への絆`;
      return {
        ...p,
        pcs: p.pcs.map(x => {
          if (x.uid === pc.uid) {
            const bonds = (x.bonds || []).includes(bond) ? x.bonds : [...(x.bonds || []), bond];
            return { ...x, abilityUse: selfBase, bonds, bondUsed: { ...(x.bondUsed || {}), [bond]: false } };
          }
          if (x.uid === targetUid) return { ...x, bondUsed: { ...(x.bondUsed || {}), [myBond]: true } }; // さとりへの絆をチェック
          return x;
        }),
        log: [`🔵 ${pc.charName} が能力《${rm.name}》を発動：《${bond}》を取得（${targetName} の応援欄をチェック）`, ...p.log],
      };
    });
  };

  // consume_others_item（財産を消費させる）：対象のアイテムを1つ消費し、その効果を自分(pc)に適用
  const confirmFortune = (targetUid, item) => {
    const ft = abilityFortune;
    setAbilityFortune(null);
    if (!ft || !ITEM_DATA[item]) return;
    upd(p => {
      // 十分な数を持たせたクローンに use を適用し、結果の resources/flags のみ自分に適用（自分の所持アイテムは不変）
      const clone = { ...pc, items: { ...pc.items, [item]: 3 }, flags: { ...pc.flags } };
      const after = ITEM_DATA[item].use(clone, p);
      const targetName = p.pcs.find(x => x.uid === targetUid)?.charName || "対象";
      return {
        ...p,
        pcs: p.pcs.map(x => {
          if (x.uid === pc.uid) return withAbilityUse({ ...x, resources: after.resources, flags: after.flags }, ft.name, ft.freq);
          if (x.uid === targetUid) return { ...x, items: { ...(x.items || {}), [item]: Math.max(0, (x.items?.[item] || 0) - 1) } };
          return x;
        }),
        log: [`🔵 ${pc.charName} が能力《${ft.name}》発動：${targetName} の【${item}】を消費し、その効果を自分に適用`, ...p.log],
      };
    });
  };

  // boundary_move（境界）：選んだスポットへ移動し、シーン中ならアクションフェイズへ（やる気消費）
  const confirmBoundary = (spotId) => {
    const bd = abilityBoundary;
    setAbilityBoundary(null);
    if (!bd) return;
    upd(p => ({
      ...p,
      pcs: p.pcs.map(x => {
        if (x.uid !== pc.uid) return x;
        let nx = withAbilityUse({ ...x, currentSpot: spotId }, bd.name, bd.freq);
        if (bd.consume) { const yr = nx.resources.やる気 || { cur: 0, max: 99 }; nx = { ...nx, resources: { ...nx.resources, やる気: { ...yr, cur: Math.max(0, yr.cur - bd.consume) } } }; }
        // 実績(境界跳躍): 境界移動はエリア踏破に数えるが normalMoves には数えない
        const ca = nx.ach || {};
        nx = { ...nx, ach: { ...ca, moved: true, spots: achAddTo(ca, "spots", spotId) } };
        return nx;
      }),
      currentScene: p.currentScene?.pcUid === pc.uid ? { ...p.currentScene, phase: "action" } : p.currentScene,
      log: [`🔵 ${pc.charName} が能力《${bd.name}》発動：[${getSpot(spotId)?.name}] へ移動${bd.consume ? `（やる気-${bd.consume}）` : ""}＋アクション`, ...p.log],
    }));
  };

  // select_rei_boost / select_item_swap：選んだキャラを対象に設定（霊力増加 or アイテム交換）
  const confirmReiBoost = () => {
    const rb = abilityReiBoost;
    setAbilityReiBoost(null);
    if (!rb) return;
    const names = rb.selected.map(u => gs.pcs.find(x => x.uid === u)?.charName).filter(Boolean).join("・") || "（なし）";
    upd(p => ({
      ...p,
      pcs: p.pcs.map(x => x.uid === pc.uid ? withAbilityUse({ ...x }, rb.name, rb.freq) : x),
      ...(rb.target === "itemSwap" ? { itemSwapTargets: rb.selected } : { reiBoostTargets: { uids: rb.selected, amount: rb.amount } }),
      log: [`🔵 ${pc.charName} が能力《${rb.name}》を発動：${names} を${rb.target === "itemSwap" ? "アイテム交換可能に" : `霊力増加+${rb.amount}に`}設定`, ...p.log],
    }));
  };

  // boost_other_yaruki（核融合）：同スポットの他PCのやる気を amount だけ増やす
  const confirmBoost = (targetUid) => {
    const bs = abilityBoost;
    setAbilityBoost(null);
    if (!bs) return;
    upd(p => {
      const selfBase = withAbilityUse({ ...pc }, bs.name, bs.freq).abilityUse;
      const targetName = p.pcs.find(x => x.uid === targetUid)?.charName || "対象";
      return {
        ...p,
        pcs: p.pcs.map(x => {
          let nx = x.uid === pc.uid ? { ...x, abilityUse: selfBase } : x;
          if (x.uid === targetUid) {
            const yr = x.resources.やる気 || { cur: 0, max: 99 };
            nx = { ...nx, resources: { ...nx.resources, やる気: { ...yr, cur: Math.min(yr.max, yr.cur + bs.amount) } } };
          }
          return nx;
        }),
        log: [`🔵 ${pc.charName} が能力《${bs.name}》を発動：${targetName} のやる気+${bs.amount}`, ...p.log],
      };
    });
  };

  const adjustResource = (key, delta) => {
    const r = resources[key] || { cur: 0, max: 1 };
    const newCur = Math.max(0, Math.min(r.cur + delta, r.max));
    const updated = { ...resources,[key]: { ...r, cur: newCur } };
    if (key === "霊力") updated.攻撃力 = { ...updated.攻撃力, cur: 1 + Math.floor(newCur / 5) };
    onUpdatePc({ ...pc, resources: updated });
  };

  const resKeys  = ["やる気", "残り人数", "スペルカード", "グレイズ", "霊力", "攻撃力"];
  const itemKeys = Object.keys(INIT_ITEMS());

  useEffect(() => {
    const snapshot = Object.fromEntries(resKeys.map(k => [k, resources[k]?.cur ?? 0]));
    if (prevResRef.current === null) { prevResRef.current = snapshot; return; }
    const changed = {};
    for (const k of resKeys) {
      const cur = snapshot[k], prev = prevResRef.current[k];
      if (cur !== prev) changed[k] = cur > prev ? "up" : "down";
    }
    prevResRef.current = snapshot;
    if (Object.keys(changed).length > 0) {
      setResFlash(f => {
        const next = { ...f };
        for (const k of Object.keys(changed)) next[k] = { tick: ((f[k]?.tick ?? 0) + 1), dir: changed[k] };
        return next;
      });
    }
  }, [pc.resources]); // eslint-disable-line

  // 一発限り（1セッション1回）スキルの発動を検出して効果音を鳴らす
  const onceFlag = !!pc[PS_ONCE_FLAG];
  useEffect(() => {
    if (prevOnceFlagRef.current === null) { prevOnceFlagRef.current = onceFlag; return; }
    if (!prevOnceFlagRef.current && onceFlag) sfx.skillActivate();
    prevOnceFlagRef.current = onceFlag;
  }, [onceFlag]);

  return (
    <div style={{ border: `1px solid ${isActing ? C.blue : C.border}`, borderRadius: 2, marginBottom: 6, overflow: "hidden", transition: "border 0.2s, box-shadow 0.2s", boxShadow: isActing ? `0 0 16px ${C.blue}28` : "none", background: isActing ? `${C.blue}06` : "transparent" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", cursor: "pointer", background: isActing ? C.blueBg : expanded ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.01)" }} onClick={() => setExpanded(v => !v)}>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <CharSprite spriteRow={pc.spriteRow ?? -1} spriteCol={pc.spriteCol ?? -1} size={36} />
          <span
            title={isOnline ? "オンライン" : "オフライン"}
            style={{ position: "absolute", right: -1, bottom: -1, width: 9, height: 9, borderRadius: "50%", background: isOnline ? "#4caf50" : "#5a6070", border: "1.5px solid #0b0d14", boxShadow: isOnline ? "0 0 5px rgba(76,175,80,0.8)" : "none" }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pc.charName}</span>
            {isActing ? <span style={{ fontSize: 9, color: C.blue }}>▶ シーン進行中</span> : hasActed ? <span style={{ fontSize: 9, color: C.textFaint }}>✓ 行動済み</span> : <span style={{ fontSize: 9, color: C.gold }}>未行動</span>}
          </div>
          <div style={{ fontSize: 9, color: C.textFaint }}>
            {(pc.tags || []).length > 0 && `《${pc.tags.join("》《")}》`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ fontSize: 9, color: "#f9a825" }}>やる気{resources.やる気?.cur || 0}/{resources.やる気?.max || 3}</span>
          <span style={{ fontSize: 9, color: "#ab47bc" }}>霊力{resources.霊力?.cur || 0}</span>
          <button
            onClick={e => { e.stopPropagation(); setDetailModal(true); }}
            title="詳細を表示"
            style={{ width: 20, height: 20, fontSize: 11, lineHeight: 1, cursor: "pointer", borderRadius: 3, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, color: C.textDim, padding: 0 }}
          >🔍</button>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: "10px 12px", borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginBottom: 8 }}>リソース</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginBottom: 10 }}>
            {resKeys.map(k => {
              const r = resources[k] || { cur: 0, max: 1 };
              return (
                <div key={k} style={{ padding: "4px 6px", background: "rgba(255,255,255,0.02)", border: `1px solid ${C.border}`, borderRadius: 3, textAlign: "center" }}>
                  <div style={{ fontSize: 8, color: C.textFaint, marginBottom: 1 }}>【{k}】</div>
                  <div key={`${k}-${resFlash[k]?.tick ?? 0}`} style={{ fontSize: 12, color: C.gold, animation: resFlash[k] ? `${resFlash[k].dir === "up" ? "resFlashUp" : "resFlashDown"} 0.55s ease forwards` : "none" }}>{r.cur}{r.max > 1 && <span style={{ fontSize: 8, color: C.textFaint }}>/{r.max}</span>}</div>
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

          <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginBottom: 8 }}>アイテム</div>
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
                {/* 強化解禁トグル（能力スキル＋／成長スペルカードは別々の強化選択肢） */}
                {(pc.growthAbility?.name || pc.growthSpellCard) && (
                  <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 8, color: C.textFaint }}>強化解禁:</span>
                    {pc.growthAbility?.name && (
                      <button onClick={() => upd(p => ({
                        ...p,
                        pcs: p.pcs.map(x => x.uid === pc.uid ? applyAbilityPassiveStats({ ...x, growthAbilityUnlocked: !x.growthAbilityUnlocked }) : x),
                        log: [`🌟 ${pc.charName} は${pc.growthAbilityUnlocked ? "能力スキル＋を解除した" : "能力スキルを強化した（能力スキル＋）"}`, ...p.log],
                      }))} style={{ padding: "2px 8px", fontSize: 9, cursor: "pointer", borderRadius: 10, background: isAbilityGrown ? "rgba(255,213,79,0.18)" : "rgba(255,255,255,0.03)", border: `1px solid ${isAbilityGrown ? C.goldDim : C.border}`, color: isAbilityGrown ? C.gold : C.textFaint }}>
                        {isAbilityGrown ? "能力＋（解除）" : "能力＋に強化"}
                      </button>
                    )}
                    {pc.growthSpellCard && (
                      <button onClick={() => upd(p => ({
                        ...p,
                        pcs: p.pcs.map(x => x.uid === pc.uid ? { ...x, growthSpellUnlocked: !x.growthSpellUnlocked } : x),
                        log: [`🌟 ${pc.charName} は${pc.growthSpellUnlocked ? "成長スペカを解除した" : "追加スペルカードを取得した"}`, ...p.log],
                      }))} style={{ padding: "2px 8px", fontSize: 9, cursor: "pointer", borderRadius: 10, background: pc.growthSpellUnlocked ? "rgba(255,213,79,0.18)" : "rgba(255,255,255,0.03)", border: `1px solid ${pc.growthSpellUnlocked ? C.goldDim : C.border}`, color: pc.growthSpellUnlocked ? C.gold : C.textFaint }}>
                        {pc.growthSpellUnlocked ? "追加スペカ（解除）" : "追加スペカ取得"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {badStatus.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginBottom: 6 }}>変調</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {badStatus.map(bs => {
                  const bData = Object.values(BAD_STATUS_TABLE).find(x => x.name === bs);
                  return (
                    <div key={bs} style={{ padding: "4px 8px", background: "rgba(224,112,96,0.15)", border: `1px solid ${C.redBorder}`, borderRadius: 4, animation: "badStatusIn 0.45s cubic-bezier(0.34,1.56,0.64,1) both" }}>
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
            <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginBottom: 6 }}>絆</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {(pc.bonds || []).map(b => {
                const isFrom = b.endsWith("からの絆");
                return (
                  <span key={b} style={{ 
                    padding: "2px 8px", 
                    background: isFrom ? "rgba(156,39,176,0.1)" : "rgba(200,160,64,0.1)", 
                    border: `1px solid ${isFrom ? C.purpleBorder : C.goldDim}50`, 
                    borderRadius: 10, fontSize: 10, 
                    color: isFrom ? C.purple : C.gold 
                  }}>
                    《{b}》
                  </span>
                );
              })}
            </div>
          </div>

          <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginBottom: 8 }}>スキル</div>
          
          {/* 個性スキルの表示 */}
          {skill && (() => {
            const isPassive = skill.passive;
            const hasCustomUI = skill.hasCustomUI;
            const isCustomChar = pc.charId?.startsWith("custom_");
            // 発動ボタンを出す条件（専用UIがなく、パッシブでもないこと）
            const canActivate = !isCustomChar && !hasCustomUI && !isPassive;
            const isUsedUp = skill.name === "カリスマ" && pc[PS_ONCE_FLAG];
            const isReady = canActivate && !isUsedUp;

            return (
            <div style={{ marginBottom: 6, ...(isReady ? skillReadyBox(psColor) : {}) }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ padding: "1px 6px", background: `${SKILL_TYPE_COLOR[skill.type] || C.text}18`, border: `1px solid ${SKILL_TYPE_COLOR[skill.type] || C.text}50`, borderRadius: 8, fontSize: 8, color: SKILL_TYPE_COLOR[skill.type] || C.text, flexShrink: 0, whiteSpace: "nowrap" }}>{skill.type}</span>
                <span style={{ fontSize: 11, fontWeight: isReady ? 700 : 400, color: isReady ? psColor : "#81c784", flex: 1, minWidth: 0, wordBreak: "keep-all" }}>《{skill.name}》</span>
                
                {isPassive && <span style={{ fontSize: 8, color: "#81c784", flexShrink: 0, whiteSpace: "nowrap" }}>常時発動中</span>}
                {hasCustomUI && <span style={{ fontSize: 8, color: "#ffb74d", flexShrink: 0, whiteSpace: "nowrap" }}>タイミング発動</span>}
                
                {isReady && <span style={{ fontSize: 8, color: psColor, marginLeft: "auto", flexShrink: 0, whiteSpace: "nowrap" }}>● 発動可能</span>}
              </div>
              <div style={{ fontSize: 9, color: C.textFaint, lineHeight: 1.7, marginBottom: 6 }}>{skill.desc}</div>

              {/* 馬鹿: 免疫変調の選択 */}
              {skill.name === "馬鹿" && !isCustomChar && (
                <div style={{ marginBottom: 6 }}>
                  {pc.badStatusImmune
                    ? <div style={{ fontSize: 9, color: "#81c784" }}>🛡 免疫中: 《{pc.badStatusImmune}》</div>
                    : (
                      <div>
                        <div style={{ fontSize: 9, color: C.textDim, marginBottom: 4 }}>免疫にする変調を選んでください:</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {Object.values(BAD_STATUS_TABLE).map(bs => (
                            <button key={bs.name} onClick={() => onUpdatePc({ ...pc, badStatusImmune: bs.name })}
                              style={{ padding: "3px 8px", fontSize: 9, cursor: "pointer", borderRadius: 3, background: "rgba(255,255,255,0.05)", border: `1px solid ${C.border}`, color: C.textDim, flexShrink: 0, whiteSpace: "nowrap" }}>
                              {bs.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  }
                </div>
              )}

              {/* カリスマ: 1セッション1回表示 */}
              {skill.name === "カリスマ" && pc[PS_ONCE_FLAG] && (
                <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 4 }}>（このセッションは使用済み）</div>
              )}

              {isCustomChar ? null : (
                canActivate ? (
                  isUsedUp
                    ? <div style={{ fontSize: 9, color: C.textFaint }}>（使用済み）</div>
                    : <button onClick={() => setSkillModal(true)} style={skillActivateBtn(psColor)}>発動する</button>
                ) : hasCustomUI ? (
                  <div style={{ fontSize: 9, color: "#ffb74d", padding: "4px 8px", background: "rgba(255,183,77,0.1)", borderRadius: 4, border: "1px solid rgba(255,183,77,0.3)" }}>
                    💡 条件を満たした際、専用のボタンが表示されます
                  </div>
                ) : isPassive && skill.name !== "馬鹿" ? (
                  <div style={{ fontSize: 9, color: "#81c784", padding: "4px 8px", background: "rgba(129,199,132,0.1)", borderRadius: 4, border: "1px solid rgba(129,199,132,0.3)" }}>
                    ⚙️ 常に効果が適用されています
                  </div>
                ) : null
              )}
            </div>
            );
          })()}

          {/* 能力スキルの表示 */}
          {activeAbility?.name && (() => {
            const meta = getAbilityEffect(activeAbility);
            const hasCustomUI = meta?.hasCustomUI;
            const isPassive = meta?.passive;
            const isReactive = meta?.reactive;
            // 発動ボタンを出す条件（専用UIがなく、パッシブでもないか、あるいは手動リアクティブ指定がある場合）
            const canActivate = !isCustomChar && (isReactive || (!hasCustomUI && !isPassive));
            const isReady = !!activeAbility?.name && canActivate && !abilityUsedUp(activeAbility);

            return (
              <div style={{ marginTop: 6, ...(isReady ? skillReadyBox(abColor) : {}) }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <span style={{ padding: "1px 6px", background: `${abColor}18`, border: `1px solid ${abColor}50`, borderRadius: 8, fontSize: 8, color: abColor, flexShrink: 0, whiteSpace: "nowrap" }}>{activeAbility.type}</span>
                  <span style={{ fontSize: 11, fontWeight: isReady ? 700 : 400, color: isReady ? abColor : "#90caf9", flex: 1, minWidth: 0, wordBreak: "keep-all" }}>《{activeAbility.name}》</span>
                  {isAbilityGrown && pc.growthAbility?.name && <span style={{ padding: "1px 5px", background: "rgba(255,213,79,0.16)", border: `1px solid ${C.goldDim}`, borderRadius: 8, fontSize: 8, color: C.gold, flexShrink: 0, whiteSpace: "nowrap" }}>成長</span>}
                  
                  {isPassive && !isReactive && <span style={{ fontSize: 8, color: "#81c784", flexShrink: 0, whiteSpace: "nowrap" }}>常時発動中</span>}
                  {hasCustomUI && <span style={{ fontSize: 8, color: "#ffb74d", flexShrink: 0, whiteSpace: "nowrap" }}>タイミング発動</span>}
                  
                  {isReady && <span style={{ fontSize: 8, color: abColor, marginLeft: "auto", flexShrink: 0, whiteSpace: "nowrap" }}>● 発動可能</span>}
                </div>
                <div style={{ fontSize: 9, color: C.textFaint, lineHeight: 1.7, marginBottom: 6 }}>{activeAbility.desc}</div>
                {pc.disguisedAs && <div style={{ fontSize: 9, color: "#ce93d8", marginBottom: 4 }}>🦝 変身中：{pc.disguisedAs} として扱う</div>}
                {pc.untargetable && <div style={{ fontSize: 9, color: "#90caf9", marginBottom: 4 }}>👁 対象外：特殊効果の対象に選ばれない</div>}
                
                {/* 正邪: ひっくり返すの無効化トグル */}
                {activeAbility?.name === "何でもひっくり返す程度の能力＋" && !isCustomChar && (
                  <div style={{ marginBottom: 6 }}>
                    <button onClick={() => onUpdatePc({ ...pc, abilityToggleOff: !pc.abilityToggleOff })}
                      style={{ padding: "3px 8px", fontSize: 9, cursor: "pointer", borderRadius: 3, background: pc.abilityToggleOff ? "rgba(224,112,96,0.15)" : "rgba(255,255,255,0.05)", border: `1px solid ${pc.abilityToggleOff ? C.redBorder : C.border}`, color: pc.abilityToggleOff ? C.red : C.textDim }}>
                      {pc.abilityToggleOff ? "🛡 現在: 特殊効果 無効化中（クリックで有効化）" : "現在: 特殊効果 有効（クリックで無効化）"}
                    </button>
                  </div>
                )}

                {isCustomChar ? null : (
                  canActivate ? (
                    abilityUsedUp(activeAbility)
                      ? <div style={{ fontSize: 9, color: C.textFaint }}>（使用済み）</div>
                      : <button onClick={() => setAbilityModal(activeAbility)} style={skillActivateBtn(abColor)}>発動する</button>
                  ) : hasCustomUI ? (
                    <div style={{ fontSize: 9, color: "#ffb74d", padding: "4px 8px", background: "rgba(255,183,77,0.1)", borderRadius: 4, border: "1px solid rgba(255,183,77,0.3)" }}>
                      💡 条件を満たした際、専用のボタンが表示されます
                    </div>
                  ) : isPassive ? (
                    <div style={{ fontSize: 9, color: "#81c784", padding: "4px 8px", background: "rgba(129,199,132,0.1)", borderRadius: 4, border: "1px solid rgba(129,199,132,0.3)" }}>
                      ⚙️ 常に効果が適用されています
                    </div>
                  ) : null
                )}
              </div>
            );
          })()}

          {/* 所有権を失わせる（千亦）: 対象に選ばれたキャラはアイテム交換（1つ失い1つ獲得）できる */}
          {(gs.itemSwapTargets || []).includes(pc.uid) && !isCustomChar && ITEM_NAMES.some(n => (pc.items?.[n] || 0) > 0) && (
            <button onClick={() => setAbilitySpend({ name: "所有権を失わせる（交換）", freq: null, params: { swapOnly: true }, spendItem: null, mode: null })} style={{ ...btnFull("rgba(129,199,132,0.12)", C.greenBorder, C.green, { fontSize: 10 }), marginTop: 6 }}>🔄 アイテム交換（所有権）</button>
          )}

          {/* 手下（minion）操作パネル: 自分の手下を移動/アクション/除去 */}
          {(gs.minions || []).some(m => m.ownerUid === pc.uid) && (
            <div style={{ marginTop: 6, padding: 6, background: "rgba(206,147,216,0.08)", border: "1px solid #ce93d850", borderRadius: 4 }}>
              <div style={{ fontSize: 9, color: "#ce93d8", marginBottom: 4 }}>手 手下（{(gs.minions || []).filter(m => m.ownerUid === pc.uid).length}）</div>
              {(gs.minions || []).filter(m => m.ownerUid === pc.uid).map((m, i) => (
                <div key={m.id} style={{ marginBottom: 4 }}>
                  <div style={{ fontSize: 9, color: C.textDim, marginBottom: 2 }}>手下{i + 1} @ {getSpot(m.currentSpot)?.name || "-"}</div>
                  {minionMove === m.id ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
                      {(SPOTS || []).map(s => (
                        <button key={s.id} onClick={() => { setMinionMove(null); upd(p => ({ ...p, minions: (p.minions || []).map(x => x.id === m.id ? { ...x, currentSpot: s.id } : x), log: [`手 ${pc.charName} の手下が[${s.name}]へ移動`, ...p.log] })); }} style={btnFull("rgba(206,147,216,0.12)", "#ce93d850", "#ce93d8", { fontSize: 8, padding: "3px 4px" })}>{s.name}</button>
                      ))}
                      <button onClick={() => setMinionMove(null)} style={btnFull("rgba(255,255,255,0.04)", C.border, C.textFaint, { fontSize: 8, padding: "3px 4px" })}>やめる</button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                      <button onClick={() => setMinionMove(m.id)} style={btnFull("rgba(206,147,216,0.12)", "#ce93d850", "#ce93d8", { width: "auto", fontSize: 8, padding: "3px 6px" })}>移動</button>
                      {/* 手下でシーンを行う（袿姫/藍）: 手下のスポットでアクション、効果は所有者が受ける */}
                      {!gs.currentScene && (
                        <button onClick={() => upd(p => ({ ...p, currentScene: { pcUid: pc.uid, minionId: m.id, phase: "move_or_stay", startSpot: m.currentSpot, moveDice: [], actionDice: [], actionDiceCount: 2 }, log: [`🎬 ${pc.charName} の手下がシーン（移動とアクション）を行う @ ${getSpot(m.currentSpot)?.name}`, ...p.log] }))} style={btnFull("rgba(206,147,216,0.12)", "#ce93d850", "#ce93d8", { width: "auto", fontSize: 8, padding: "3px 6px" })}>手下でシーン</button>
                      )}
                      <button onClick={() => upd(p => ({ ...p, minions: (p.minions || []).filter(x => x.id !== m.id), log: [`手 ${pc.charName} の手下が退場した`, ...p.log] }))} style={btnFull("rgba(255,255,255,0.04)", C.border, C.textFaint, { width: "auto", fontSize: 8, padding: "3px 6px" })}>除去</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {pc.flags?.liveAvailable && gs.cycleIdx === 2 && (
            <div style={{ marginTop: 8 }}>
              <button onClick={() => {
                onUpdatePc({
                  ...pc,
                  currentSpot: gs.newspaper?.targetSpot || pc.currentSpot,
                  resources: { ...pc.resources, やる気: { ...pc.resources.やる気, cur: Math.min(pc.resources.やる気.max, (pc.resources.やる気?.cur || 0) + 1) } },
                  flags: { ...pc.flags, liveAvailable: false },
                  log: [...(pc.log||[]), `${pc.charName} はゲリラライブ会場に移動し、やる気を1回復した！`]
                });
              }} style={btnFull(C.blueBg, C.blueBorder, C.blue, { fontSize: 10 })}>🎵 ゲリラライブ会場へ移動（やる気+1）</button>
            </div>
          )}

          {pc.flags?.canCureBadStatus && (pc.badStatus || []).length > 0 && (
            <div style={{ marginTop: 8, padding: 6, background: "rgba(255,255,255,0.03)", borderRadius: 4 }}>
              <div style={{ fontSize: 9, color: C.textDim, marginBottom: 4 }}>📰 ストレッチ効果で変調を1つ解除できます</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {pc.badStatus.map(bs => (
                  <button key={bs} onClick={() => {
                    onUpdatePc({
                      ...pc,
                      badStatus: pc.badStatus.filter(x => x !== bs),
                      flags: { ...pc.flags, canCureBadStatus: false },
                      log: [...(pc.log||[]), `${pc.charName} は新聞効果で変調《${bs}》を解除した`]
                    });
                  }} style={btnFull(C.blueBg, C.blueBorder, C.blue, { padding: "4px", fontSize: 10, width: "auto" })}>
                    {bs} を解除
                  </button>
                ))}
              </div>
            </div>
          )}

          {gs.cycleIdx === 3 && skill?.name !== "アウトドア派" && (
            <div style={{ marginTop: 8, padding: 6, background: "rgba(255,255,255,0.03)", borderRadius: 4 }}>
              <div style={{ fontSize: 9, color: C.textDim, marginBottom: 4 }}>今夜の帰還先</div>
              <div style={{ display: "flex", gap: 4 }}>
                <button onClick={() => onUpdatePc({...pc, returnSpotId: pc.baseSpotId})} style={btnFull(pc.returnSpotId === pc.baseSpotId || !pc.returnSpotId ? C.goldBg : "rgba(255,255,255,0.02)", pc.returnSpotId === pc.baseSpotId || !pc.returnSpotId ? C.goldDim : C.border, pc.returnSpotId === pc.baseSpotId || !pc.returnSpotId ? C.gold : C.textDim, { padding: "4px", fontSize: 10 })}>
                  拠点 ({getSpot(pc.baseSpotId)?.name})
                </button>
                {gs.newspaper?.targetSpot && (gs.newspaper.roll === 14 || gs.newspaper.roll % 11 === 0) && (
                  <button onClick={() => onUpdatePc({...pc, returnSpotId: gs.newspaper.targetSpot})} style={btnFull(pc.returnSpotId === gs.newspaper.targetSpot ? C.goldBg : "rgba(255,255,255,0.02)", pc.returnSpotId === gs.newspaper.targetSpot ? C.goldDim : C.border, pc.returnSpotId === gs.newspaper.targetSpot ? C.gold : C.textDim, { padding: "4px", fontSize: 10 })}>
                    📰 {getSpot(gs.newspaper.targetSpot)?.name}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* アウトドア派: 夜帰還不要の表示 */}
          {gs.cycleIdx === 3 && skill?.name === "アウトドア派" && (
            <div style={{ marginTop: 8, padding: 6, background: "rgba(129,199,132,0.1)", border: `1px solid #81c78440`, borderRadius: 4 }}>
              <div style={{ fontSize: 9, color: "#81c784" }}>🌙《アウトドア派》帰還不要 — 現在地で夜を過ごします</div>
            </div>
          )}

          {/* 不夜城: 夜サイクル終了時に深夜サイクル追加（1回限り） */}
          {gs.cycleIdx === 3 && skill?.name === "不夜城" && !pc[PS_ONCE_FLAG] && upd && (
            <div style={{ marginTop: 8 }}>
              <button onClick={() => {
                const motive = pc.resources.やる気?.cur || 0;
                if (motive < 1) return;
                upd(p => ({
                  ...p,
                  pcs: p.pcs.map(x => x.uid !== pc.uid ? x : {
                    ...x, resources: { ...x.resources, やる気: { ...x.resources.やる気, cur: motive - 1 } },
                    [PS_ONCE_FLAG]: true
                  }),
                  log: [`${pc.charName}《不夜城》: やる気1消費して深夜サイクルを追加！`, ...p.log]
                }));
              }} style={btnFull("rgba(129,199,132,0.15)", "#81c78440", "#81c784", { fontSize: 10 })}>
                🌃《不夜城》深夜サイクルを追加（やる気-1）
              </button>
            </div>
          )}

          {/* ご執心: 導入フェイズ中に絆を獲得 */}
          {gs.sessionPhase === "intro" && skill?.name === "ご執心" && !pc[PS_ONCE_FLAG] && (
            <div style={{ marginTop: 8 }}>
              <button onClick={() => {
                const target = window.prompt("絆を獲得するキャラクター名を入力してください");
                if (!target || !target.trim()) return;
                const bondName = `${target.trim()}への絆`;
                const bonds = [...(pc.bonds || [])];
                if (!bonds.includes(bondName)) bonds.push(bondName);
                onUpdatePc({ ...pc, bonds, bondUsed: { ...(pc.bondUsed || {}), [bondName]: false }, [PS_ONCE_FLAG]: true });
              }} style={btnFull("rgba(255,183,77,0.15)", "#ffb74d40", "#ffb74d", { fontSize: 10 })}>
                💛《ご執心》絆を獲得する
              </button>
            </div>
          )}

          {/* 用意周到: 探索フェイズ開始時に任意アイテム1つ獲得（1回限り） */}
          {gs.sessionPhase === "explore" && skill?.name === "用意周到" && !pc[PS_ONCE_FLAG] && (
            <div style={{ marginTop: 8, padding: 6, background: "rgba(255,183,77,0.08)", border: `1px solid #ffb74d30`, borderRadius: 4 }}>
              <div style={{ fontSize: 9, color: "#ffb74d", marginBottom: 6 }}>🎒《用意周到》アイテム1つを獲得</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                {ITEM_NAMES.filter(n => n !== "妖器").map(itemName => (
                  <button key={itemName} onClick={() => {
                    onUpdatePc({ ...pc,
                      items: { ...pc.items, [itemName]: (pc.items?.[itemName] || 0) + 1 },
                      [PS_ONCE_FLAG]: true
                    });
                  }} style={{ padding: "4px 6px", fontSize: 9, cursor: "pointer", borderRadius: 3, background: "rgba(255,255,255,0.05)", border: `1px solid ${C.border}`, color: C.text }}>
                    {itemName}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {itemModal && <ItemUseModal itemName={itemModal} pc={pc} onConfirm={() => consumeItem(itemModal)} onCancel={() => setItemModal(null)} />}
      {skillModal && skill && <SkillActivateModal skillName={skill.name} skillType={skill.type} desc={skill.desc} onConfirm={activateSkill} onCancel={() => setSkillModal(null)} />}
      {abilityModal && <SkillActivateModal skillName={abilityModal.name} skillType={abilityModal.type} desc={abilityModal.desc} onConfirm={() => activateAbility(abilityModal)} onCancel={() => setAbilityModal(null)} />}
      {abilityItemPick && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilityItemPick(null)}>
          <SpellCard color="#90caf9" title="✦ 好きなアイテムを1つ獲得" style={{ maxWidth: 340, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
              {ITEM_NAMES.map(n => (
                <button key={n} onClick={() => confirmAbilityItem(n)} style={btnFull("rgba(144,202,249,0.12)", "#1565c080", "#90caf9", { fontSize: 11 })}>{n}</button>
              ))}
            </div>
            <button onClick={() => setAbilityItemPick(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
          </SpellCard>
        </div>
      )}
      {abilityCure && (() => {
        // 同スポットのキャラ（変調を持つ者）を対象に取り、変調を1つ除去
        const sameSpot = (gs.pcs || []).filter(x => x.currentSpot === pc.currentSpot && (x.badStatus || []).length > 0);
        const target = abilityCure.targetUid ? gs.pcs.find(x => x.uid === abilityCure.targetUid) : null;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilityCure(null)}>
            <SpellCard color="#90caf9" title={`✦ ${abilityCure.name}`} style={{ maxWidth: 340, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
              {!target ? (
                <div>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>変調を除去する対象（同スポット）を選択</div>
                  {sameSpot.length === 0 ? (
                    <div style={{ fontSize: 10, color: C.textFaint, textAlign: "center", padding: "6px 0" }}>同スポットに変調を持つキャラがいません</div>
                  ) : (
                    <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                      {sameSpot.map(x => (
                        <button key={x.uid} onClick={() => setAbilityCure({ ...abilityCure, targetUid: x.uid })} style={btnFull("rgba(144,202,249,0.1)", "#1565c080", "#90caf9", { fontSize: 11 })}>
                          {x.charName}（{(x.badStatus || []).join("・")}）
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>{target.charName} の除去する変調を選択</div>
                  <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                    {(target.badStatus || []).map(bs => (
                      <button key={bs} onClick={() => confirmCure(target.uid, bs)} style={btnFull("rgba(224,112,96,0.12)", C.redBorder, C.red, { fontSize: 11 })}>《{bs}》を除去</button>
                    ))}
                  </div>
                </div>
              )}
              <button onClick={() => setAbilityCure(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
            </SpellCard>
          </div>
        );
      })()}
      {abilityRefresh && (() => {
        // 使用済み応援欄（bondUsed===true）を持つキャラ → その絆を選んで解除
        const usedOf = (x) => (x.bonds || []).filter(b => x.bondUsed?.[b]);
        const candidates = (gs.pcs || []).filter(x => usedOf(x).length > 0);
        const target = abilityRefresh.targetUid ? gs.pcs.find(x => x.uid === abilityRefresh.targetUid) : null;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilityRefresh(null)}>
            <SpellCard color="#90caf9" title={`✦ ${abilityRefresh.name}`} style={{ maxWidth: 340, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
              {!target ? (
                <div>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>応援欄を解除する対象（使用済み絆を持つキャラ）を選択</div>
                  {candidates.length === 0 ? (
                    <div style={{ fontSize: 10, color: C.textFaint, textAlign: "center", padding: "6px 0" }}>使用済み応援欄を持つキャラがいません</div>
                  ) : (
                    <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                      {candidates.map(x => (
                        <button key={x.uid} onClick={() => setAbilityRefresh({ ...abilityRefresh, targetUid: x.uid })} style={btnFull("rgba(144,202,249,0.1)", "#1565c080", "#90caf9", { fontSize: 11 })}>{x.charName}</button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>{target.charName} の解除する応援欄を選択</div>
                  <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                    {usedOf(target).map(b => (
                      <button key={b} onClick={() => confirmRefresh(target.uid, b)} style={btnFull("rgba(200,160,64,0.12)", C.goldDim, C.gold, { fontSize: 11 })}>《{b}》（■→□）</button>
                    ))}
                  </div>
                </div>
              )}
              <button onClick={() => setAbilityRefresh(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
            </SpellCard>
          </div>
        );
      })()}
      {abilityMove && (() => {
        // 同スポットの他キャラを連れる対象として選び、移動先を決める
        const sameSpot = (gs.pcs || []).filter(x => x.uid !== pc.uid && x.currentSpot === pc.currentSpot);
        const toggle = (uid) => setAbilityMove(m => ({ ...m, selected: m.selected.includes(uid) ? m.selected.filter(u => u !== uid) : [...m.selected, uid] }));
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilityMove(null)}>
            <SpellCard color="#90caf9" title={`✦ ${abilityMove.name}`} style={{ maxWidth: 360, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 6 }}>連れて移動するキャラ（同スポット）を選択</div>
              {sameSpot.length === 0
                ? <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 8 }}>同スポットに他のキャラがいません</div>
                : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                    {sameSpot.map(x => {
                      const on = abilityMove.selected.includes(x.uid);
                      return <button key={x.uid} onClick={() => toggle(x.uid)} style={btnFull(on ? "rgba(144,202,249,0.25)" : "rgba(255,255,255,0.04)", on ? "#1565c0" : C.border, on ? "#90caf9" : C.textDim, { fontSize: 10, padding: "4px 8px" })}>{on ? "✓ " : ""}{x.charName}</button>;
                    })}
                  </div>
                )}
              {abilityMove.params?.selfOptional && (
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: C.textDim, marginBottom: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={abilityMove.moveSelf} onChange={e => setAbilityMove(m => ({ ...m, moveSelf: e.target.checked }))} />
                  自分も移動する
                </label>
              )}
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 6 }}>移動先のスポットを選択</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 10, maxHeight: 200, overflowY: "auto" }}>
                {(SPOTS || []).map(s => (
                  <button key={s.id} onClick={() => confirmPartyMove(s.id)} style={btnFull(s.id === pc.currentSpot ? "rgba(255,255,255,0.02)" : "rgba(144,202,249,0.1)", s.id === pc.currentSpot ? C.border : "#1565c080", s.id === pc.currentSpot ? C.textFaint : "#90caf9", { fontSize: 10, padding: "5px 6px" })}>{s.name}</button>
                ))}
              </div>
              <button onClick={() => setAbilityMove(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
            </SpellCard>
          </div>
        );
      })()}
      {abilitySurprise && (() => {
        const sameSpot = (gs.pcs || []).filter(x => x.uid !== pc.uid && x.currentSpot === pc.currentSpot);
        const target = abilitySurprise.targetUid ? gs.pcs.find(x => x.uid === abilitySurprise.targetUid) : null;
        const declareX = abilitySurprise.params?.declareX;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilitySurprise(null)}>
            <SpellCard color="#90caf9" title={`✦ ${abilitySurprise.name}`} style={{ maxWidth: 340, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>対象（同スポットの他キャラ）を選択</div>
              {sameSpot.length === 0 ? (
                <div style={{ fontSize: 10, color: C.textFaint, textAlign: "center", padding: "6px 0" }}>同スポットに他のキャラがいません</div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
                  {sameSpot.map(x => {
                    const on = abilitySurprise.targetUid === x.uid;
                    return <button key={x.uid} onClick={() => setAbilitySurprise(s => ({ ...s, targetUid: x.uid }))} style={btnFull(on ? "rgba(144,202,249,0.25)" : "rgba(255,255,255,0.04)", on ? "#1565c0" : C.border, on ? "#90caf9" : C.textDim, { fontSize: 10, padding: "4px 8px" })}>{on ? "✓ " : ""}{x.charName}</button>;
                  })}
                </div>
              )}
              {declareX && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4 }}>目標値 X（3〜6）を宣言</div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {[3, 4, 5, 6].map(n => (
                      <button key={n} onClick={() => setAbilitySurprise(s => ({ ...s, x: n }))} style={btnFull(abilitySurprise.x === n ? "rgba(255,213,79,0.2)" : "rgba(255,255,255,0.04)", abilitySurprise.x === n ? C.goldDim : C.border, abilitySurprise.x === n ? C.gold : C.textDim, { fontSize: 11, padding: "5px 0" })}>{n}</button>
                    ))}
                  </div>
                </div>
              )}
              <button disabled={!target} onClick={runSurprise} style={{ width: "100%", padding: "8px", marginBottom: 6, cursor: target ? "pointer" : "default", borderRadius: 2, background: target ? C.blueBg : "rgba(255,255,255,0.03)", border: `1px solid ${target ? C.blueBorder : C.border}`, color: target ? C.blue : C.textFaint, fontSize: 12 }}>
                🎲 2D:{declareX ? abilitySurprise.x : 4} で判定する
              </button>
              <button onClick={() => setAbilitySurprise(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
            </SpellCard>
          </div>
        );
      })()}
      {abilitySpend && (() => {
        const owned = ITEM_NAMES.filter(n => (pc.items?.[n] || 0) > 0);
        const allowChoice = abilitySpend.params?.allowChoice;
        const n = abilitySpend.params?.randomCount || 2;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilitySpend(null)}>
            <SpellCard color="#90caf9" title={`✦ ${abilitySpend.name}`} style={{ maxWidth: 340, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
              {!abilitySpend.spendItem ? (
                <div>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>失うアイテムを1つ選択</div>
                  {owned.length === 0 ? (
                    <div style={{ fontSize: 10, color: C.textFaint, textAlign: "center", padding: "6px 0" }}>失えるアイテムがありません</div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
                      {owned.map(it => (
                        <button key={it} onClick={() => setAbilitySpend(s => ({ ...s, spendItem: it, ...(s.params?.swapOnly ? { mode: "choice" } : {}) }))} style={btnFull("rgba(224,112,96,0.1)", C.redBorder, C.red, { fontSize: 11 })}>{it}（{pc.items[it]}）</button>
                      ))}
                    </div>
                  )}
                </div>
              ) : abilitySpend.mode === "choice" ? (
                <div>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>【{abilitySpend.spendItem}】を失い、好きなアイテムを1つ獲得</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
                    {ITEM_NAMES.map(it => (
                      <button key={it} onClick={() => runSpendChoice(it)} style={btnFull("rgba(144,202,249,0.12)", "#1565c080", "#90caf9", { fontSize: 11 })}>{it}</button>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 10 }}>【{abilitySpend.spendItem}】を失って獲得方法を選択</div>
                  <button onClick={runSpendRandom} style={{ ...btnFull(C.goldBg, C.goldDim, C.gold, { fontSize: 11 }), marginBottom: 6 }}>🎲 ランダムに{n}つ獲得</button>
                  {allowChoice && (
                    <button onClick={() => setAbilitySpend(s => ({ ...s, mode: "choice" }))} style={{ ...btnFull("rgba(144,202,249,0.12)", "#1565c080", "#90caf9", { fontSize: 11 }), marginBottom: 6 }}>好きなアイテムを1つ獲得</button>
                  )}
                </div>
              )}
              <button onClick={() => setAbilitySpend(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
            </SpellCard>
          </div>
        );
      })()}
      {abilityDestroy && (() => {
        const target = abilityDestroy.targetUid ? gs.pcs.find(x => x.uid === abilityDestroy.targetUid) : null;
        const ownedItems = target ? ITEM_NAMES.filter(it => (target.items?.[it] || 0) > 0) : [];
        const cats = target ? [
          ["タグ", target.tags || []],
          ["変調", target.badStatus || []],
          ["アイテム", ownedItems],
        ].filter(([, arr]) => arr.length > 0) : [];
        const curList = abilityDestroy.category === "タグ" ? (target?.tags || [])
          : abilityDestroy.category === "変調" ? (target?.badStatus || [])
          : abilityDestroy.category === "アイテム" ? ownedItems : [];
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilityDestroy(null)}>
            <SpellCard color={C.red} title={`✦ ${abilityDestroy.name}`} style={{ maxWidth: 340, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
              {!target ? (
                <div>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>破壊する対象キャラを選択</div>
                  <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                    {(gs.pcs || []).filter(x => !x.untargetable).map(x => (
                      <button key={x.uid} onClick={() => setAbilityDestroy(d => ({ ...d, targetUid: x.uid }))} style={btnFull("rgba(224,112,96,0.1)", C.redBorder, C.red, { fontSize: 11 })}>{x.charName}</button>
                    ))}
                  </div>
                </div>
              ) : !abilityDestroy.category ? (
                <div>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>{target.charName} の破壊するカテゴリを選択</div>
                  {cats.length === 0 ? (
                    <div style={{ fontSize: 10, color: C.textFaint, textAlign: "center", padding: "6px 0" }}>破壊できる対象がありません</div>
                  ) : (
                    <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                      {cats.map(([cat, arr]) => (
                        <button key={cat} onClick={() => setAbilityDestroy(d => ({ ...d, category: cat }))} style={btnFull("rgba(224,112,96,0.1)", C.redBorder, C.red, { fontSize: 11 })}>{cat}（{arr.length}）</button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>{target.charName} の{abilityDestroy.category}から破壊するものを選択</div>
                  <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                    {curList.map(v => (
                      <button key={v} onClick={() => confirmDestroy(target.uid, abilityDestroy.category, v)} style={btnFull("rgba(224,112,96,0.12)", C.redBorder, C.red, { fontSize: 11 })}>《{v}》を破壊</button>
                    ))}
                  </div>
                </div>
              )}
              <button onClick={() => setAbilityDestroy(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
            </SpellCard>
          </div>
        );
      })()}
      {abilityReturn && (() => {
        const others = (gs.pcs || []).filter(x => x.uid !== pc.uid);
        const toggle = (uid) => setAbilityReturn(m => ({ ...m, selected: m.selected.includes(uid) ? m.selected.filter(u => u !== uid) : [...m.selected, uid] }));
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilityReturn(null)}>
            <SpellCard color="#90caf9" title={`✦ ${abilityReturn.name}`} style={{ maxWidth: 360, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 6 }}>一緒に帰還先を変えるPC（自分は常に対象）を選択</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                {others.map(x => {
                  const on = abilityReturn.selected.includes(x.uid);
                  return <button key={x.uid} onClick={() => toggle(x.uid)} style={btnFull(on ? "rgba(144,202,249,0.25)" : "rgba(255,255,255,0.04)", on ? "#1565c0" : C.border, on ? "#90caf9" : C.textDim, { fontSize: 10, padding: "4px 8px" })}>{on ? "✓ " : ""}{x.charName}</button>;
                })}
              </div>
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 6 }}>帰還先のスポットを選択{abilityReturn.params?.yarukiSkip ? "（夜のやる気減少なし）" : ""}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 10, maxHeight: 200, overflowY: "auto" }}>
                {(SPOTS || []).map(s => (
                  <button key={s.id} onClick={() => confirmReturn(s.id)} style={btnFull("rgba(144,202,249,0.1)", "#1565c080", "#90caf9", { fontSize: 10, padding: "5px 6px" })}>{s.name}</button>
                ))}
              </div>
              <button onClick={() => setAbilityReturn(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
            </SpellCard>
          </div>
        );
      })()}
      {abilityScenePick && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilityScenePick(null)}>
          <SpellCard color="#90caf9" title={`✦ ${abilityScenePick.name}`} style={{ maxWidth: 340, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>もう一度シーンを行えるようにするPCを選択</div>
            <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
              {(gs.pcs || []).map(x => (
                <button key={x.uid} onClick={() => confirmScenePick(x.uid)} style={btnFull("rgba(144,202,249,0.1)", "#1565c080", "#90caf9", { fontSize: 11 })}>{x.charName}{(gs.actedPcs || []).includes(x.uid) ? "（行動済み）" : ""}</button>
              ))}
            </div>
            <button onClick={() => setAbilityScenePick(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
          </SpellCard>
        </div>
      )}
      {abilityBoost && (() => {
        const sameSpot = (gs.pcs || []).filter(x => x.uid !== pc.uid && x.currentSpot === pc.currentSpot && !x.untargetable);
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilityBoost(null)}>
            <SpellCard color="#90caf9" title={`✦ ${abilityBoost.name}`} style={{ maxWidth: 340, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>やる気を+{abilityBoost.amount}する同スポットのPCを選択</div>
              {sameSpot.length === 0 ? (
                <div style={{ fontSize: 10, color: C.textFaint, textAlign: "center", padding: "6px 0" }}>同スポットに他のPCがいません</div>
              ) : (
                <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                  {sameSpot.map(x => (
                    <button key={x.uid} onClick={() => confirmBoost(x.uid)} style={btnFull("rgba(144,202,249,0.1)", "#1565c080", "#90caf9", { fontSize: 11 })}>{x.charName}</button>
                  ))}
                </div>
              )}
              <button onClick={() => setAbilityBoost(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
            </SpellCard>
          </div>
        );
      })()}
      {abilitySearchClue && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilitySearchClue(null)}>
          <SpellCard color={C.gold} title={`✦ ${abilitySearchClue.name}`} style={{ maxWidth: 360, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>手がかりを配置するスポットを選択</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 10, maxHeight: 220, overflowY: "auto" }}>
              {(SPOTS || []).filter(s => s.id !== "dream").map(s => (
                <button key={s.id} onClick={() => confirmSearchClue(s.id)} style={btnFull(gs.clues?.includes(s.id) ? "rgba(255,255,255,0.02)" : "rgba(200,160,64,0.12)", gs.clues?.includes(s.id) ? C.border : C.goldDim, gs.clues?.includes(s.id) ? C.textFaint : C.gold, { fontSize: 10, padding: "5px 6px" })}>{s.name}{gs.clues?.includes(s.id) ? "（有）" : ""}</button>
              ))}
            </div>
            <button onClick={() => setAbilitySearchClue(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
          </SpellCard>
        </div>
      )}
      {abilityReiBoost && (() => {
        const toggle = (uid) => setAbilityReiBoost(m => ({ ...m, selected: m.selected.includes(uid) ? m.selected.filter(u => u !== uid) : [...m.selected, uid] }));
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilityReiBoost(null)}>
            <SpellCard color="#90caf9" title={`✦ ${abilityReiBoost.name}`} style={{ maxWidth: 340, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>{abilityReiBoost.target === "itemSwap" ? "アイテム交換できる対象キャラを選択（複数可）" : `霊力増加を+${abilityReiBoost.amount}する対象キャラを選択（複数可）`}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
                {(gs.pcs || []).map(x => {
                  const on = abilityReiBoost.selected.includes(x.uid);
                  return <button key={x.uid} onClick={() => toggle(x.uid)} style={btnFull(on ? "rgba(144,202,249,0.25)" : "rgba(255,255,255,0.04)", on ? "#1565c0" : C.border, on ? "#90caf9" : C.textDim, { fontSize: 10, padding: "4px 8px" })}>{on ? "✓ " : ""}{x.charName}</button>;
                })}
              </div>
              <button onClick={confirmReiBoost} style={{ ...btnFull(C.blueBg, C.blueBorder, C.blue, { fontSize: 12 }), marginBottom: 6, width: "100%" }}>決定</button>
              <button onClick={() => setAbilityReiBoost(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
            </SpellCard>
          </div>
        );
      })()}
      {abilityFortune && (() => {
        const target = abilityFortune.targetUid ? gs.pcs.find(x => x.uid === abilityFortune.targetUid) : null;
        const candidates = (gs.pcs || []).filter(x => x.uid !== pc.uid && ITEM_NAMES.some(n => (x.items?.[n] || 0) > 0) && !x.untargetable);
        const targetItems = target ? ITEM_NAMES.filter(n => (target.items?.[n] || 0) > 0) : [];
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilityFortune(null)}>
            <SpellCard color="#90caf9" title={`✦ ${abilityFortune.name}`} style={{ maxWidth: 340, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
              {!target ? (
                <div>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>アイテムを消費させる対象を選択</div>
                  {candidates.length === 0 ? (
                    <div style={{ fontSize: 10, color: C.textFaint, textAlign: "center", padding: "6px 0" }}>アイテムを持つ他キャラがいません</div>
                  ) : (
                    <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                      {candidates.map(x => (
                        <button key={x.uid} onClick={() => setAbilityFortune(f => ({ ...f, targetUid: x.uid }))} style={btnFull("rgba(144,202,249,0.1)", "#1565c080", "#90caf9", { fontSize: 11 })}>{x.charName}</button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>{target.charName} の消費するアイテムを選択（効果は自分に適用）</div>
                  <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                    {targetItems.map(it => (
                      <button key={it} onClick={() => confirmFortune(target.uid, it)} style={btnFull("rgba(144,202,249,0.12)", "#1565c080", "#90caf9", { fontSize: 11 })}>{it}（{target.items[it]}）— {ITEM_DATA[it]?.desc?.slice(0, 16)}…</button>
                    ))}
                  </div>
                </div>
              )}
              <button onClick={() => setAbilityFortune(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
            </SpellCard>
          </div>
        );
      })()}
      {abilityBoundary && (() => {
        const dests = abilityBoundary.mustBase
          ? (SPOTS || []).filter(s => s.id === (pc.baseSpotId || "11"))
          : (SPOTS || []).filter(s => s.id !== "dream");
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilityBoundary(null)}>
            <SpellCard color="#90caf9" title={`✦ ${abilityBoundary.name}`} style={{ maxWidth: 360, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>{abilityBoundary.mustBase ? "拠点へ移動してアクション" : "移動先のスポットを選択（その後アクション）"}{abilityBoundary.consume ? "（やる気-1）" : ""}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 10, maxHeight: 220, overflowY: "auto" }}>
                {dests.map(s => (
                  <button key={s.id} onClick={() => confirmBoundary(s.id)} style={btnFull("rgba(144,202,249,0.1)", "#1565c080", "#90caf9", { fontSize: 10, padding: "5px 6px" })}>{s.name}</button>
                ))}
              </div>
              <button onClick={() => setAbilityBoundary(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
            </SpellCard>
          </div>
        );
      })()}
      {abilityReadMind && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilityReadMind(null)}>
          <SpellCard color="#ce93d8" title={`✦ ${abilityReadMind.name}`} style={{ maxWidth: 340, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>あなたへの絆を取得したキャラを選択（その相手への絆を取得）</div>
            <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
              {(gs.pcs || []).filter(x => x.uid !== pc.uid).map(x => (
                <button key={x.uid} onClick={() => confirmReadMind(x.uid)} style={btnFull("rgba(206,147,216,0.1)", "#ce93d850", "#ce93d8", { fontSize: 11 })}>{x.charName}</button>
              ))}
            </div>
            <button onClick={() => setAbilityReadMind(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
          </SpellCard>
        </div>
      )}
      {detailModal && <CharDetailModal pc={pc} onClose={() => setDetailModal(false)} />}
    </div>
  );
}

// ─── ActionRenderer (イベント効果実行エンジン) ─────────────────────────
export function ActionRenderer({ act, pc, gs, upd, animateDice, SPOTS, getSpot, isDone }) {
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
          if (extraUpdates.pc.items) {
            const sumQty = m => Object.values(m || {}).reduce((s, v) => s + (typeof v === "number" ? v : 1), 0);
            const oldQty = sumQty(base.items);
            base.items = { ...base.items, ...extraUpdates.pc.items };
            const gained = Math.max(0, sumQty(base.items) - oldQty);
            if (gained > 0) { const ca = base.ach || {}; base.ach = { ...ca, items: (ca.items || 0) + gained }; }
          }
          if (extraUpdates.pc.badStatus) base.badStatus = extraUpdates.pc.badStatus;
          if (extraUpdates.pc.bonds) {
            // 新規に獲得した絆は応援欄を未使用にする（再獲得=リフレッシュは handleBond 側で処理）
            const newBonds = extraUpdates.pc.bonds.filter(b => !(x.bonds || []).includes(b));
            base.bonds = extraUpdates.pc.bonds;
            if (newBonds.length > 0) {
              base.bondUsed = { ...(base.bondUsed || {}) };
              newBonds.forEach(b => { base.bondUsed[b] = false; });
            }
          }
          if (extraUpdates.pc.bondUsed) base.bondUsed = { ...(base.bondUsed || {}), ...extraUpdates.pc.bondUsed };
          if (extraUpdates.pc.tags) base.tags = extraUpdates.pc.tags;
          if (extraUpdates.pc.flags) base.flags = { ...base.flags, ...extraUpdates.pc.flags };
          if (extraUpdates.pc.currentSpot) {
            base.currentSpot = extraUpdates.pc.currentSpot;
            const ca = base.ach || {};
            // 通常移動（境界などの能力移動は confirmBoundary 等で別計上）。normalMoves は #8 用
            base.ach = { ...ca, moved: true, normalMoves: (ca.normalMoves || 0) + 1, spots: achAddTo(ca, "spots", extraUpdates.pc.currentSpot) };
          }
        }
        if (extraUpdates.achInc) base.ach = extraUpdates.achInc({ ...(base.ach || {}) });
        return base;
      });
      // 交流（他者への絆の新規獲得）を検出 → 特別な絆の親密度 +1D6（acting pc を対象に持つ保持者）
      const acquiredKouryu = extraUpdates.pc?.bonds && extraUpdates.pc.bonds.some(b => !(pc.bonds || []).includes(b) && !b.includes("自身への絆"));
      let finalPcs = newPcs, intimacyLogs = [];
      if (acquiredKouryu) {
        const r = gainIntimacy(newPcs, pc.uid, Math.ceil(Math.random() * 6), `${pc.charName}の交流`);
        finalPcs = r.pcs; intimacyLogs = r.logs;
      }
      const p2 = (extraUpdates.pc || acquiredKouryu) ? { ...p, pcs: finalPcs } : p;
      const p3 = extraUpdates.gs ? { ...p2, ...extraUpdates.gs } : p2;
      return {
        ...p3,
        currentScene: { ...p3.currentScene, currentActionIndex: (p3.currentScene.currentActionIndex || 0) + 1 },
        log:[...intimacyLogs, ...logs.reverse(), ...p3.log]
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
            if (!(pc.badStatus || []).includes("スランプ")) {
              nextCur = Math.min(pc.resources.霊力?.max || 20, nextCur + gain);
            }
            proceed([`${pc.charName} は霊力を ${gain} 点獲得した`], {
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
            if (!(pc.badStatus || []).includes("スランプ")) {
              nextCur = Math.min(pc.resources.霊力?.max || 20, nextCur + gain);
            }
            proceed([`${pc.charName} は霊力を ${gain} 点獲得した`], {
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
          proceed([`${pc.charName} は霊力を ${lose} 点失った`], {
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
          if (!(pc.badStatus || []).includes("だるい")) {
            nextCur = Math.min(pc.resources.やる気?.max || 3, nextCur + gain);
          }
          proceed([`${pc.charName} はやる気を ${gain} 点獲得した`], {
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
          proceed([`${pc.charName} はやる気を ${lose} 点失った`], {
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
          <button onClick={() => animateDice(count, "アイテム獲得", res => {
            // count 個のダイスをそれぞれ振り、各出目に対応するアイテムを1個ずつ獲得する
            const names = res.map(d => ITEM_NAMES[d - 1]);
            const nextItems = { ...pc.items };
            names.forEach(n => { nextItems[n] = (nextItems[n] || 0) + 1; });
            proceed([`${pc.charName} は【${names.join("】【")}】を獲得した`], {
              pc: { items: nextItems }
            });
          })} style={btnFull(C.goldBg, C.goldDim, C.gold)}>🎲 ランダムなアイテムを{count > 1 ? `${count}つ` : ""}獲得</button>
        </div>
      );
    } else if (act.item === "any") {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.gold, marginBottom: 8, fontSize: 11 }}>獲得するアイテムを選んでください</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {ITEM_NAMES.map(itemName => (
              <button key={itemName} onClick={() => {
                proceed([`${pc.charName} は【${itemName}】を ${count} 個獲得した`], {
                  pc: { items: { ...pc.items, [itemName]: (pc.items[itemName] || 0) + count } }
                });
              }} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text)}>{itemName}</button>
            ))}
          </div>
        </div>
      );
    } else {
      // 赤貧: 小銭獲得時に任意アイテムへ変換
      if (act.item === "小銭" && pc.ps?.name === "赤貧") {
        return (
          <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
            <div style={{ color: "#ffb74d", marginBottom: 8, fontSize: 11 }}>《赤貧》【小銭】は失われ、代わりに任意アイテムを1つ獲得します</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
              {ITEM_NAMES.filter(n => n !== "小銭").map(itemName => (
                <button key={itemName} onClick={() => {
                  proceed([`${pc.charName}《赤貧》: 【小銭】→【${itemName}】へ変換して獲得した`], {
                    pc: { items: { ...pc.items, [itemName]: (pc.items[itemName] || 0) + count } }
                  });
                }} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text)}>{itemName}</button>
              ))}
            </div>
          </div>
        );
      }
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <button onClick={() => {
            proceed([`${pc.charName} は【${act.item}】を ${count} 個獲得した`], {
              pc: { items: { ...pc.items, [act.item]: (pc.items[act.item] || 0) + count } }
            });
          }} style={btnFull(C.goldBg, C.goldDim, C.gold)}>【{act.item}】を獲得する</button>
        </div>
      );
    }
  }

  // 6. LOSE_ITEM
  if (act.type === "LOSE_ITEM") {
    const ownedItems = Object.entries(pc.items || {}).filter(([_k, v]) => v > 0).map(([k]) => k);
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
            proceed([`${pc.charName} は所持しているアイテムを全て失った`], {
              pc: { items: { お酒: 0, 小銭: 0, お守り: 0, Pアイテム: 0, 残機のかけら: 0, スペカのかけら: 0, 妖器: 0 } }
            });
          }} style={btnFull(C.redBg, C.redBorder, C.red)}>適用する</button>
        </div>
      );
    } else if (act.item === "random") {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <button onClick={() => {
            const loseItem = ownedItems[Math.floor(Math.random() * ownedItems.length)];
            proceed([`${pc.charName} は【${loseItem}】を失った`], {
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
                proceed([`${pc.charName} は【${itemName}】を失った`], {
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
              proceed([`${pc.charName} は【${itemName}】を獲得した`], {
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
    const ownedItems = Object.entries(pc.items || {}).filter(([_k, v]) => v > 0).map(([k]) => k);
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
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.gold, marginBottom: 8, fontSize: 11 }}>【{selectedLose}】と交換で獲得するアイテムを選んでください</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {ITEM_NAMES.map(itemName => (
              <button key={itemName} onClick={() => {
                proceed([`${pc.charName} は【${selectedLose}】を手放し、【${itemName}】を獲得した`], {
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
            const itemName = ITEM_NAMES[res[0] - 1];
            proceed([`${pc.charName} は【${selectedLose}】を手放し、【${itemName}】を獲得した`], {
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
          proceed([`${pc.charName} は変調《${bsName}》を獲得した`], {
            pc: { badStatus: newBs, resources: { ...pc.resources, やる気: { ...pc.resources.やる気, cur: nextYaruki } } }
          });
        })} style={btnFull(C.redBg, C.redBorder, C.red)}>🎲 ランダムな変調を獲得する (1D6)</button>
      </div>
    );
  }

  if (act.type === "CURE_BAD_STATUS") {
    const bs = pc.badStatus || [];
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
            proceed([`${pc.charName} は変調《${b}》を解除した`], {
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
          proceed([`${pc.charName} は足止めを受けた`], { pc: { flags: { ...pc.flags, stopped: true } } });
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
            proceed([`${pc.charName} はアイテムを持っていなかったため、足止めを受けた`], { pc: { flags: { ...pc.flags, stopped: true } } });
          } else {
            proceed();
          }
        }} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>アイテムの所持を確認する</button>
      </div>
    );
  }

  // 12. GAIN_BOND
  if (act.type === "GAIN_BOND") {
    if ((pc.badStatus || []).includes("不機嫌")) {
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
            const selfB = `${pc.charName}への絆`;
            const bonds = Array.from(new Set([...(pc.bonds || []), selfB]));
            proceed([`${pc.charName} は自身への絆を獲得した`], { pc: { bonds, bondUsed: { [selfB]: false } } });
          }} style={btnFull(C.goldBg, C.goldDim, C.gold)}>自身への絆を獲得する</button>
        </div>
      );
    }

    if (act.target === "here") {
      const others = gs.pcs.filter(p => p.uid !== pc.uid && p.currentSpot === pc.currentSpot && !(p.badStatus || []).includes("不機嫌"));
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
              const newB = `${o.charName || o.name}への絆`;
              const bonds = Array.from(new Set([...(pc.bonds || []), newB]));
              proceed([`${pc.charName} は《${o.charName || o.name}への絆》を獲得した`], { pc: { bonds, bondUsed: { [newB]: false } } });
            }} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text, { marginBottom: 4 })}>
              {o.name}
            </button>
          ))}
        </div>
      );
    }

    if (act.target === "elsewhere") {
      const others = gs.pcs.filter(p => p.uid !== pc.uid && p.currentSpot !== pc.currentSpot && !(p.badStatus || []).includes("不機嫌"));
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
            const newB = `${selectedLose}への絆`;
            const bonds = Array.from(new Set([...(pc.bonds || []), newB]));
            proceed([`${pc.charName} は《${selectedLose}への絆》を獲得した`], { pc: { bonds, bondUsed: { [newB]: false } } });
          }} style={btnFull(selectedLose ? C.goldBg : "rgba(255,255,255,0.05)", C.border, selectedLose ? C.gold : C.textFaint)}>獲得する</button>
        </div>
      );
    }

    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
        <button onClick={() => {
          const newB = `${act.target}への絆`;
          const bonds = Array.from(new Set([...(pc.bonds || []), newB]));
          proceed([`${pc.charName} は《${act.target}への絆》を獲得した`], { pc: { bonds, bondUsed: { [newB]: false } } });
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
          proceed([`${pc.charName} は残り人数を ${lose} 点失った`], {
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
              proceed([`${pc.charName} は [${s.name}] に移動した`], { pc: { currentSpot: s.id } });
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
              proceed([`${pc.charName} は[${getSpot(nextSpotId)?.name}] に移動した`], { pc: { currentSpot: nextSpotId } });
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
                proceed([`${pc.charName} は[${getSpot(selectedLose)?.name}] に移動した`], { pc: { currentSpot: selectedLose } });
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
              proceed([`${pc.charName} は拠点に移動した`], { pc: { currentSpot: pc.baseSpotId } });
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
              if (act.gainBond && !(pc.badStatus || []).includes("不機嫌") && !(o.badStatus || []).includes("不機嫌")) {
                const newB = `${o.charName || o.name}への絆`;
                extraPc.bonds = Array.from(new Set([...(pc.bonds || []), newB]));
                extraPc.bondUsed = { [newB]: false };
              }
              proceed([`${pc.charName} は ${o.name} のいるスポットへ移動した`], { pc: extraPc });
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
          let nextCur = pc.resources.スペルカード?.cur || 0;
          nextCur = Math.min(pc.resources.スペルカード?.max || 5, nextCur + gain);
          proceed([`${pc.charName} はスペルカードを ${gain} 点獲得した`], {
            pc: { resources: { ...pc.resources, スペルカード: { ...pc.resources.スペルカード, cur: nextCur } } }
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
          proceed([`${pc.charName} はセッション中《${act.tag}》のタグを得た`], {
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
            proceed([`手がかりを【${getSpot(nextSpotId)?.name}】に配置した`], { gs: { clues: newClues, nonSearchCluePlaced: true }, achInc: a => ({ ...a, clues: (a.clues || 0) + 1 }) });
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
