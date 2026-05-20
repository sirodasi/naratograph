import { useState, useEffect } from "react";
import { CharSprite } from "./Lobby";
import { SPOT_DETAILS } from "./data/spots";
import { EDGES, ADJACENT_MAP, OFFICIAL_DANMAKU_SKILLS } from "./data/gameData";
import { C, btnFull, btnSmall } from "./styles/colors";

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
    canUse:  pc => (pc.items?.["お酒"] || 0) > 0 && !(pc.badStatus || []).includes("二日酔い"),
    use: (pc, gs) => {
      const resources = { ...pc.resources };
      if (!(pc.badStatus || []).includes("だるい")) {
        const r = resources.やる気 || { cur: 0, max: 3 };
        const isPremiumFriday = gs?.newspaper?.roll === 12 && pc.currentSpot === "11";
        const healAmount = isPremiumFriday ? 2 : 1;

        resources.やる気 = { cur: Math.min(r.cur + healAmount, r.max), max: r.max };
      }
      return { ...pc, items: { ...pc.items, "お酒": Math.max(0, (pc.items["お酒"] || 0) - 1) }, resources };
    },
  },
  "小銭": {
    timing: "行為判定直前",
    desc:    "次の行為判定の判定ダイス数が「1」増加します。",
    canUse:  () => false,
    use: (pc, gs) => ({ ...pc, items: { ...pc.items, "小銭": Math.max(0, (pc.items["小銭"] || 0) - 1) }, flags: { ...pc.flags, money: true } }),
  },
  "お守り": {
    timing: "移動処理中",
    desc:    "移動で「6」が出たとき、ハプニングが発生せず6マス先まで移動できます。",
    canUse:  () => false,
    use: (pc, gs) => ({ ...pc, items: { ...pc.items, "お守り": Math.max(0, (pc.items["お守り"] || 0) - 1) }, flags: { ...pc.flags, amulet: true } }),
  },
  "Pアイテム": {
    timing: "いつでも",
    desc:    "【霊力】を「3点」獲得します。",
    canUse:  pc => (pc.items?.["Pアイテム"] || 0) > 0 && !(pc.badStatus || []).includes("二日酔い"),
    use: (pc, gs) => {
      const resources = { ...pc.resources };
      if (!(pc.badStatus || []).includes("スランプ")) {
        const r = resources.霊力 || { cur: 0, max: 30 };
        resources.霊力 = { cur: Math.min(r.cur + 3, r.max), max: r.max };
      }
      return { ...pc, items: { ...pc.items, "Pアイテム": Math.max(0, (pc.items["Pアイテム"] || 0) - 1) }, resources };
    },
  },
  "残機のかけら": {
    timing: "いつでも",
    desc:    "3つ消費して【残り人数】を「1点」獲得します。（3つ以上保持時のみ）",
    canUse:  pc => (pc.items?.["残機のかけら"] || 0) >= 3 && !(pc.badStatus || []).includes("二日酔い"),
    use: (pc, gs) => {
      const resources = { ...pc.resources };
      const r = resources.残り人数 || { cur: 0, max: 5 };
      resources.残り人数 = { cur: Math.min(r.cur + 1, r.max), max: r.max };
      return { ...pc, items: { ...pc.items, "残機のかけら": Math.max(0, (pc.items["残機のかけら"] || 0) - 3) }, resources };
    },
  },
  "スペカのかけら": {
    timing: "いつでも",
    desc:    "2つ消費して【スペルカード】を「1点」獲得します。（2つ以上保持時のみ）",
    canUse:  pc => (pc.items?.["スペカのかけら"] || 0) >= 2 && !(pc.badStatus || []).includes("二日酔い"),
    use: (pc, gs) => {
      const resources = { ...pc.resources };
      const r = resources.スペルカード || { cur: 0, max: 5 };
      resources.スペルカード = { cur: Math.min(r.cur + 1, r.max), max: r.max };
      return { ...pc, items: { ...pc.items, "スペカのかけら": Math.max(0, (pc.items["スペカのかけら"] || 0) - 2) }, resources };
    },
  },
  "妖器": {
    timing: "弾幕ごっこ前",
    desc:    "1ラウンドの間【攻撃力】が1点増加します。（輝針城の限定アイテム）",
    canUse:  pc => (pc.items?.["妖器"] || 0) > 0 && !(pc.badStatus || []).includes("二日酔い"),
    use: (pc, gs) => {
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
  スペルカード:     { cur: 1, max: 5  },
  グレイズ:   { cur: 0, max: 999 },
  霊力:       { cur: 0, max: 20 },
  攻撃力:     { cur: 1, max: 5  },
});

export const ITEM_NAMES = ["お酒", "小銭", "お守り", "Pアイテム", "残機のかけら", "スペカのかけら"];

export const INIT_ITEMS = () => ({
  お酒: 0, 小銭: 0, お守り: 0, Pアイテム: 0, 残機のかけら: 0, スペカのかけら: 0, 妖器: 0,
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

function BattleGrid({ name, grid, pos, isCombatant, isNpc, sprite, isDead, highlightCells = [], onCellClick }) {
  const cells = [1, 2, 3, 4, 5, 6];
  const campColor = isNpc ? C.red : C.blue;
  
  return (
    <div style={{ 
      width: 180, opacity: isDead ? 0.4 : 1, 
      border: `2px solid ${isCombatant ? campColor : C.border}`, 
      borderRadius: 8, background: "rgba(10,12,20,0.8)", padding: 6 
    }}>
      <style>{`
        @keyframes pulseHighlight {
          0% { box-shadow: inset 0 0 2px ${C.blue}; background: rgba(100, 181, 246, 0.1); }
          50% { box-shadow: inset 0 0 15px ${C.blue}; background: rgba(100, 181, 246, 0.3); }
          100% { box-shadow: inset 0 0 2px ${C.blue}; background: rgba(100, 181, 246, 0.1); }
        }
      `}</style>
      <div style={{ fontSize: 10, color: isCombatant ? campColor : C.textDim, textAlign: "center", marginBottom: 4, fontWeight: "bold" }}>
        {name}
      </div>
      
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gridTemplateRows: "repeat(2, 50px)", gap: 4 }}>
        {cells.map(num => {
          const danmakuCount = grid ? grid[num - 1] : 0;
          const hasChar = pos === num;
          const isHighlighted = highlightCells.includes(num);
          
          return (
            <div 
              key={num} 
              onClick={() => isHighlighted && onCellClick && onCellClick(num)}
              style={{ 
                position: "relative",
                background: "rgba(255,255,255,0.03)", 
                border: `1px solid ${hasChar ? campColor : isHighlighted ? C.blue : "rgba(255,255,255,0.1)"}`,
                borderRadius: 4,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: isHighlighted ? "pointer" : "default",
                animation: isHighlighted ? "pulseHighlight 1.5s infinite" : "none",
                transition: "all 0.2s"
              }}
            >
              <div style={{ position: "absolute", top: 2, left: 3, fontSize: 8, color: "rgba(255,255,255,0.2)" }}>{num}</div>
              
              {danmakuCount > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 1, justifyContent: "center", padding: 2 }}>
                  {[...Array(danmakuCount)].map((_, i) => (
                    <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: isNpc ? C.blue : C.red }} />
                  ))}
                </div>
              )}
              
              {hasChar && (
                <div style={{ position: "absolute", inset: 2, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}>
                  {sprite}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TIMING_RULES = [
  { key: "round_start", re: /ラウンドの?開始時/       },
  { key: "evade",       re: /回避ステップ/            },
  { key: "hit",         re: /被弾|【残り人数】を減少/ },
];

const EFFECT_PATTERNS = [
  { type: "SELF",     re: /【自機マス×(\d+)】/g                },
  { type: "ENEMY",    re: /【敵機マス×(\d+)】/g               },
  { type: "ADJACENT", re: /【隣接マス×(\d+)】/g               },
  { type: "CHOOSE",   re: /【指定マス×(\d+)】/g               },
  { type: "RANDOM",   re: /【ランダム×(\d+|X)】/g             },
  { type: "FIXED",    re: /【(\d+)番マス×(\d+)】/g           },
];

const CONDITION_RE = /(?:[^。]*(?:できない|限り使用できない|場合にしか使用できない)[^。]*。?)/;

// ─── 弾幕スキルユーティリティ（BattleView / BattleRightPanel 共用） ─────
export function hasOfficialSkill(entity, skillName) {
  if (!entity) return false;
  const dsName = (entity.ds && entity.ds.name) || entity.dsName
    || entity.skillName || (entity.ps && entity.ps.name) || null;
  if (!dsName) return false;
  const isOfficial = OFFICIAL_DANMAKU_SKILLS.some(s => s.name === dsName);
  return isOfficial && dsName === skillName;
}

export function parseSpell(text) {
  // タイミング
  let timing = "standard";
  for (const { key, re } of TIMING_RULES) {
    if (re.test(text)) { timing = key; break; }
  }

  // 効果タイミング（宣言はstandard・効果発揮がラウンド終了時）
  const effectTiming = /ラウンドの?終了時/.test(text) ? "round_end" : "immediate";

  // 効果リスト
  const effects = [];
  for (const { type, re } of EFFECT_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (type === "FIXED") {
        effects.push({ type, cell: parseInt(m[1]), count: parseInt(m[2]) });
      } else {
        effects.push({ type, count: m[1] === "X" ? -1 : parseInt(m[1]) });
      }
    }
  }

  // 宣言条件（テキスト抽出のみ、自動チェックはしない）
  const condMatch = CONDITION_RE.exec(text);
  const condition = condMatch ? condMatch[0].trim() : null;

  return {
    timing,
    effectTiming,
    effects,
    manual: effects.length === 0,  // キーワードなし → 手動
    condition,
  };
}

// スペカテキスト/スペルオブジェクトからフルオブジェクトを組み立てる
export function buildSpellCard(card) {
  if (!card) return null;

  const text = typeof card === "string"
    ? card
    : card.text ?? card.desc ?? "";

  const nameMatch = text.match(/^(.+?[」])/);
  const name = typeof card === "string"
    ? (nameMatch ? nameMatch[1] : text.slice(0, 20))
    : card.name ?? (nameMatch ? nameMatch[1] : text.slice(0, 20));

  return {
    ...card,
    name,
    text,
    ...parseSpell(text),
  };
}

export function BattleView({ gs, upd, user, isGm, animateDice }) {
  const b = gs.battle;
  if (!b) return null;

  const pcs = gs.pcs || [];
  const npcs = b.participants?.npcs || [];

  const alivePcs = pcs.filter(p => (p.resources?.残り人数?.cur || 0) > 0);
  const aliveNpcs = npcs.filter(n => (n.resources?.残り人数?.cur || 0) > 0);

  let unactedPcs = alivePcs.filter(p => !(b.actedPcs || []).includes(p.uid));
  let unactedNpcs = aliveNpcs.filter(n => !(b.actedNpcs || []).includes(n.id));

  useEffect(() => {
    if (b.phase !== "round_start") return;
    const shouldResetPcs = unactedPcs.length === 0 && alivePcs.length > 0 && (b.actedPcs || []).length > 0;
    const shouldResetNpcs = unactedNpcs.length === 0 && aliveNpcs.length > 0 && (b.actedNpcs || []).length > 0;
    if (!shouldResetPcs && !shouldResetNpcs) return;

    const nextActedPcs = shouldResetPcs ? [] : (b.actedPcs || []);
    const nextActedNpcs = shouldResetNpcs ? [] : (b.actedNpcs || []);
    const resetLogs = [];
    if (shouldResetPcs) resetLogs.push("🔄 PC陣営が全員行動したため、全員未行動に戻ります。");
    if (shouldResetNpcs) resetLogs.push("🔄 NPC陣営が全員行動したため、全員未行動に戻ります。");

    upd(p => ({
      ...p,
      battle: {
        ...p.battle,
        actedPcs: nextActedPcs,
        actedNpcs: nextActedNpcs
      },
      log: [...resetLogs.reverse(), ...p.log]
    }));
  }, [b.phase, alivePcs.length, aliveNpcs.length, unactedPcs.length, unactedNpcs.length, b.actedPcs?.length, b.actedNpcs?.length, upd]);

  // 使い魔: スキップ → ショットイントロで自動援護射撃（PC/NPC両対応）
  useEffect(() => {
    if (b.familiarAction !== "skip_to_support") return;
    if (b.phase === "pc_shot_intro") {
      upd(p => {
        const pc = p.pcs.find(x => x.uid === p.battle.pcCombatant);
        if (!pc || !hasOfficialSkill(pc, "使い魔")) return p;
        return {
          ...p,
          battle: { ...p.battle, supportDice: (p.battle.supportDice || 0) + 1, familiarAction: "done" },
          log: [`💠 ${pc.charName} の使い魔が自動援護射撃！攻撃ダイス+1`, ...p.log],
        };
      });
    } else if (b.phase === "npc_shot_intro") {
      upd(p => {
        const npc = p.battle.participants.npcs.find(n => n.id === p.battle.npcCombatant);
        if (!npc || !hasOfficialSkill(npc, "使い魔")) return p;
        return {
          ...p,
          battle: { ...p.battle, supportDice: (p.battle.supportDice || 0) + 1, familiarAction: "done" },
          log: [`💠 ${npc.name} の使い魔が自動援護射撃！攻撃ダイス+1`, ...p.log],
        };
      });
    }
  }, [b.phase, b.familiarAction, upd]);

  const handleSupportFire = (userUid) => {
    upd(p => ({
      ...p,
      battle: {
        ...p.battle,
        supportDice: (p.battle.supportDice || 0) + 1,
        usedIntervention: { ...p.battle.usedIntervention, [userUid]: "support" }
      },
      log: [`💥 ${pcs.find(x => x.uid === userUid)?.charName} の援護射撃！攻撃ダイスが増加します。`, ...p.log]
    }));
  };

  const handleCover = (userUid, targetUid) => {
    animateDice(1, "かばう", (res) => {
      const die = res[0];
      upd(p => {
        const currentGrid = [...(p.battle.grids[targetUid] || [0,0,0,0,0,0])];
        let success = false;
        if (currentGrid[die - 1] > 0) {
          currentGrid[die - 1] -= 1;
          success = true;
        }
        return {
          ...p,
          battle: {
            ...p.battle,
            grids: { ...p.battle.grids, [targetUid]: currentGrid },
            usedIntervention: { ...p.battle.usedIntervention, [userUid]: "cover" }
          },
          log: [`🛡️ ${pcs.find(x => x.uid === userUid)?.charName} が ${die}番マスをかばった！ ${success ? "弾幕を除去しました。" : "しかしそこには弾幕がなかった！"}`, ...p.log]
        };
      });
    });
  };

  const handleAutoFamiliarCover = (targetId) => {
    animateDice(1, "使い魔かばう（自動）", (res) => {
      const die = res[0];
      upd(p => {
        const grid = [...(p.battle.grids[targetId] || [0,0,0,0,0,0])];
        const success = grid[die - 1] > 0;
        if (success) grid[die - 1] -= 1;
        const pc = p.pcs.find(x => x.uid === targetId);
        const npc = p.battle.participants.npcs.find(n => n.id === targetId);
        const name = pc?.charName || npc?.name || targetId;
        return {
          ...p,
          battle: { ...p.battle, grids: { ...p.battle.grids, [targetId]: grid }, familiarAction: "done" },
          log: [`🛡 使い魔が自動でかばった！${die}番マス ${success ? "弾幕除去" : "弾幕なし"}（${name}のマス）`, ...p.log],
        };
      });
    });
  };

  const executeShot = (isPc) => {
    const attacker = isPc ? pcs.find(p => p.uid === b.pcCombatant) : npcs.find(n => n.id === b.npcCombatant);
    const bonus = b.supportDice || 0;
    // ★ 使い魔スキル: ショットダイス数 -1
    const hasFamiliar = hasOfficialSkill(attacker, "使い魔");
    const totalDice = Math.max(1, attacker.resources.攻撃力.cur + bonus - (hasFamiliar ? 1 : 0));

    const attackerId = isPc ? b.pcCombatant : b.npcCombatant;
    const defenderId = isPc ? b.npcCombatant : b.pcCombatant;

    animateDice(totalDice, `${isPc ? "PC" : "NPC"}ショット`, (results) => {
      upd(p => {
        const currentGrid = [...(p.battle.grids[defenderId] || [0,0,0,0,0,0])];
        results.forEach(d => { if (d >= 1 && d <= 6) currentGrid[d - 1] += 1; });
        return {
          ...p,
          battle: {
            ...p.battle,
            supportDice: 0,
            lastShotDice: results,
            lastShotIsPc: isPc,
            lastShotAttackerId: attackerId,
            lastShotDefenderId: defenderId,
            grids: { ...p.battle.grids, [defenderId]: currentGrid },
            phase: isPc ? "pc_shot_after" : "npc_shot_after",
          }
        };
      });
    });
  };

  const executePcShot = () => executeShot(true);
  const executeNpcShot = () => executeShot(false);

  // ─── スペルカード関連 ─────────────────────────────────────────────

  // グリッドに弾幕を配置するヘルパー（攻撃側フィールド）
  const placeSpellBullets = (attackerGrid, effects, attackerPos, defenderPos, customCount = null) => {
    const grid = [...attackerGrid];
    const ADJACENT_MAP = { 1:[2,4], 2:[1,3,5], 3:[2,6], 4:[1,5], 5:[4,6,2], 6:[3,5] };

    for (const ef of effects) {
      const count = ef.count === -1 ? (customCount ?? 1) : ef.count;
      if (ef.type === "SELF") {
        grid[attackerPos - 1] = (grid[attackerPos - 1] || 0) + count;
      } else if (ef.type === "ENEMY") {
        grid[defenderPos - 1] = (grid[defenderPos - 1] || 0) + count;
      } else if (ef.type === "ADJACENT") {
        const adj = ADJACENT_MAP[defenderPos] || [];
        adj.forEach(cell => { grid[cell - 1] = (grid[cell - 1] || 0) + count; });
      } else if (ef.type === "FIXED") {
        grid[ef.cell - 1] = (grid[ef.cell - 1] || 0) + ef.count;
      }
      // RANDOM は別途ダイスで処理、CHOOSE は手動選択で処理
    }
    return grid;
  };

  // RANDOM エフェクトをダイスで処理
  const resolveRandomEffects = (effects, defenderGridId, customCount, cb) => {
    const randoms = effects.filter(e => e.type === "RANDOM");
    if (randoms.length === 0) { cb({}); return; }

    const totalDice = randoms.reduce((sum, e) => sum + (e.count === -1 ? (customCount ?? 1) : e.count), 0);
    animateDice(totalDice, "スペルカード（ランダム配置）", res => {
      const grid = [...(b.grids?.[defenderGridId] || [0,0,0,0,0,0])];
      res.forEach(d => { grid[d - 1] = (grid[d - 1] || 0) + 1; });
      cb({ [defenderGridId]: grid });
    });
  };

  // スペルカード宣言のメイン処理
  const declareSpell = (spellCard, isPcAttacker, customCount = null) => {
    const attackerId = isPcAttacker ? b.pcCombatant : b.npcCombatant;
    const defenderId = isPcAttacker ? b.npcCombatant : b.pcCombatant;
    const attPos = b.positions?.[attackerId] || 1;
    const defPos = b.positions?.[defenderId] || 1;
    const attackerGrid = b.grids?.[attackerId] || [0,0,0,0,0,0];

    // スペカ点数を消費
    const consumeSpell = (p) => isPcAttacker
      ? { ...p, pcs: p.pcs.map(x => x.uid !== attackerId ? x : {
          ...x, resources: { ...x.resources, スペルカード: { ...x.resources.スペルカード, cur: Math.max(0, (x.resources.スペルカード?.cur || 0) - 1) } }
        })}
      : { ...p, battle: { ...p.battle, participants: { ...p.battle.participants, npcs: p.battle.participants.npcs.map(n => n.id !== attackerId ? n : {
          ...n, resources: { ...n.resources, スペルカード: { ...n.resources.スペルカード, cur: Math.max(0, (n.resources.スペルカード?.cur || 0) - 1) } }
        })}}};

    const nonRandomEffects = spellCard.effects.filter(e => e.type !== "RANDOM" && e.type !== "CHOOSE");
    const hasRandom = spellCard.effects.some(e => e.type === "RANDOM");
    const hasChoose = spellCard.effects.some(e => e.type === "CHOOSE");

    // effectTiming が round_end のものは grids に反映せず pendingSpell に保存
    if (spellCard.effectTiming === "round_end") {
      upd(p => ({
        ...consumeSpell(p),
        battle: { ...p.battle, pendingSpell: { ...spellCard, attackerId, defenderPos: defPos } },
        log: [`🔮 ${isPcAttacker ? combatantPc?.charName : combatantNpc?.name}：${spellCard.name}！ (ラウンド終了時に効果)`, ...p.log],
      }));
      return;
    }

    // manual または CHOOSE → 宣言のみ記録して CHOOSE フェーズへ
    if (spellCard.manual) {
      upd(p => ({
        ...consumeSpell(p),
        battle: {
          ...p.battle,
          lastSpellUsed: spellCard.name,
          manualSpell: { ...spellCard, attackerId, defenderId, defenderPos: defPos }
        },
        log: [`🔮 ${isPcAttacker ? combatantPc?.charName : combatantNpc?.name}：${spellCard.name}！ (効果はGMが手動処理)`, ...p.log],
      }));
      return;
    }

    // 非ランダム効果を即座に適用
    const defenderGrid = b.grids?.[defenderId] || [0,0,0,0,0,0];
    const updatedGrid = placeSpellBullets(defenderGrid, nonRandomEffects, attPos, defPos, customCount);

    if (hasChoose) {
      // CHOOSE → 選択フェーズへ
      const chooseCount = spellCard.effects.find(e => e.type === "CHOOSE")?.count ?? 1;
      upd(p => ({
        ...consumeSpell(p),
        battle: {
          ...p.battle,
          grids: { ...p.battle.grids, [defenderGrid]: updatedGrid },
          spellChoose: { attackerId, defenderId, remaining: chooseCount === -1 ? (customCount ?? 1) : chooseCount, selected: [] },
          lastSpellUsed: spellCard.name,
        },
        log: [`🔮 ${isPcAttacker ? combatantPc?.charName : combatantNpc?.name}：${spellCard.name}！ (マスを選択してください)`, ...p.log],
      }));
      return;
    }

    if (hasRandom) {
      // ランダム配置のダイスロール
      upd(p => consumeSpell(p));
      resolveRandomEffects(spellCard.effects, defenderId, customCount, gridPatch => {
        upd(p => ({
          ...p,
          battle: {
            ...p.battle,
            grids: { ...p.battle.grids, [defenderId]: updatedGrid.map((v, i) => v + (gridPatch[defenderId]?.[i] || 0)), },
            lastSpellUsed: spellCard.name,
          },
          log: [`🔮 ${isPcAttacker ? combatantPc?.charName : combatantNpc?.name}：${spellCard.name}！`, ...p.log],
        }));
      });
      return;
    }

    // 完全自動
    upd(p => ({
      ...consumeSpell(p),
      battle: {
        ...p.battle,
        grids: { ...p.battle.grids, [defenderId]: updatedGrid },
        lastSpellUsed: spellCard.name,
      },
      log: [`🔮 ${isPcAttacker ? combatantPc?.charName : combatantNpc?.name}：${spellCard.name}！`, ...p.log],
    }));
  };

  // CHOOSE: グリッドのマスをクリックして弾幕を配置
  const handleSpellChooseCell = (cell) => {
    const sc = b.spellChoose;
    if (!sc) return;
    if (sc.selected.includes(cell)) return;  // 同じマスは選べない
    const newSelected = [...sc.selected, cell];
    const targetId = sc.defenderId || sc.attackerId;
    const grid = [...(b.grids?.[targetId] || [0,0,0,0,0,0])];
    grid[cell - 1] = (grid[cell - 1] || 0) + 1;

    if (newSelected.length >= sc.remaining) {
      // 選択完了
      upd(p => ({
        ...p,
        battle: {
          ...p.battle,
          grids: { ...p.battle.grids, [targetId]: grid },
          spellChoose: null,
        },
      }));
    } else {
      upd(p => ({
        ...p,
        battle: {
          ...p.battle,
          grids: { ...p.battle.grids, [targetId]: grid },
          spellChoose: { ...sc, selected: newSelected },
        },
      }));
    }
  };

  // ラウンド終了時の pendingSpell 適用
  const applyPendingSpell = () => {
    const ps = b.pendingSpell;
    if (!ps) return;
    const grid = b.grids?.[ps.attackerId] || [0,0,0,0,0,0];
    // manual のものはテキスト表示のみ（グリッド変更なし）
    upd(p => ({
      ...p,
      battle: {
        ...p.battle,
        grids: ps.manual ? p.battle.grids : { ...p.battle.grids, [ps.attackerId]: grid },
        pendingSpell: null,
      },
      log: [`⏰ ${ps.name} の効果が発動した`, ...p.log],
    }));
  };

  const updateCombatantPosition = (combatantId, targetCellNum) => {
    if (!combatantId) return;
    upd(p => ({
      ...p,
      battle: {
        ...p.battle,
        positions: { ...p.battle.positions, [combatantId]: targetCellNum }
      }
    }));
  };

  const changeBulletCount = (combatantId, cell, delta) => {
    if (!combatantId) return;
    upd(p => {
      const oldGrid = [...(p.battle.grids[combatantId] || [0,0,0,0,0,0])];
      const updated = Math.max(0, (oldGrid[cell - 1] || 0) + delta);
      oldGrid[cell - 1] = updated;
      return {
        ...p,
        battle: {
          ...p.battle,
          grids: { ...p.battle.grids, [combatantId]: oldGrid }
        }
      };
    });
  };

  const clearManualSpell = () => {
    upd(p => ({
      ...p,
      battle: { ...p.battle, manualSpell: null }
    }));
  };

  const isDanmakuUsed = (attackerId, skillName) => {
    return !!(b.usedds && b.usedds[attackerId] && b.usedds[attackerId].includes(skillName));
  };

  const markDanmakuUsed = (attackerId, skillName) => {
    if (!attackerId) return;
    upd(p => ({
      ...p,
      battle: {
        ...p.battle,
        usedds: {
          ...(p.battle.usedds || {}),
          [attackerId]: [...((p.battle.usedds || {})[attackerId] || []), skillName]
        }
      }
    }));
  };

  // 近接攻撃: ショット直前に同じマスなら相手のそのマスに弾幕+1
  const tryApplyProximity = (attackerId, defenderId) => {
    const attackerPos = b.positions?.[attackerId];
    const defenderPos = b.positions?.[defenderId];
    if (!attackerPos || !defenderPos) return false;
    const attacker = pcs.find(p => p.uid === attackerId) || npcs.find(n => n.id === attackerId);
    if (!hasOfficialSkill(attacker, "近接攻撃")) return false;
    if (isDanmakuUsed(attackerId, "近接攻撃")) return false;
    if (attackerPos !== defenderPos) return false;

    // そのマスに弾幕を1追加
    upd(p => {
      const grid = [...(p.battle.grids?.[defenderId] || [0,0,0,0,0,0])];
      grid[defenderPos - 1] = (grid[defenderPos - 1] || 0) + 1;
      return {
        ...p,
        battle: { ...p.battle, grids: { ...p.battle.grids, [defenderId]: grid } },
        log: [`💥 ${attacker.charName || attacker.name} の『近接攻撃』が発動：${defenderPos}番マスに弾幕が追加されました。`, ...p.log]
      };
    });
    markDanmakuUsed(attackerId, "近接攻撃");
    return true;
  };

  // ホーミング: ロール直後に1つの出目を任意の出目に変更して重複を作る等に利用
  // ホーミング: PLが「変更するダイスのインデックス」と「変更後の値」を選択する
  // → battle.homingSelect に選択状態を保存し、renderShotAfter でUIを出す
  const tryApplyHoming = (attackerId, defenderId, diceResults) => {
    const attacker = pcs.find(p => p.uid === attackerId) || npcs.find(n => n.id === attackerId);
    if (!hasOfficialSkill(attacker, "ホーミング")) return false;
    if (isDanmakuUsed(attackerId, "ホーミング")) return false;
    if (!diceResults || diceResults.length === 0) return false;
    // 選択UIを起動（step1: どのダイスを変えるか）
    upd(p => ({ ...p, battle: { ...p.battle, homingSelect: { attackerId, defenderId, dice: diceResults, step: "pick_die", selectedDieIdx: null } } }));
    return true;
  };

  // ホーミング確定: グリッドの弾幕を直接移動（旧マス-1 → 新マス+1）し lastShotDice も更新
  const confirmHoming = (newValue) => {
    const hs = b.homingSelect;
    if (!hs || hs.selectedDieIdx === null) return;
    const newDice = [...hs.dice];
    const old     = newDice[hs.selectedDieIdx];
    newDice[hs.selectedDieIdx] = newValue;
    const att = pcs.find(p => p.uid === hs.attackerId) || npcs.find(n => n.id === hs.attackerId);
    markDanmakuUsed(hs.attackerId, "ホーミング");
    upd(p => {
      const grid = [...(p.battle.grids[hs.defenderId] || [0,0,0,0,0,0])];
      if (grid[old - 1] > 0) grid[old - 1] -= 1;
      grid[newValue - 1] += 1;
      return {
        ...p,
        battle: {
          ...p.battle,
          lastShotDice: newDice,
          grids: { ...p.battle.grids, [hs.defenderId]: grid },
          homingSelect: null,
        },
        log: [`🔭 ${att?.charName || att?.name} の「ホーミング」発動：${old}番マス → ${newValue}番マスに弾幕を移動`, ...p.log]
      };
    });
  };

  // ワイドショット: PLが「移動先の空きマス」と「移動元（弾幕があるマス）」を
  //   ペアで1つ以上選択する → battle.wideShotSelect に状態を保存
  const tryApplyWideShot = (attackerId, defenderId) => {
    const attacker = pcs.find(p => p.uid === attackerId) || npcs.find(n => n.id === attackerId);
    if (!hasOfficialSkill(attacker, "ワイドショット")) return false;
    if (isDanmakuUsed(attackerId, "ワイドショット")) return false;
    const grid = b.grids?.[defenderId] ? [...b.grids[defenderId]] : [0,0,0,0,0,0];
    const hasEmpty  = grid.some(v => v === 0);
    const hasBullet = grid.some(v => v > 0);
    if (!hasEmpty || !hasBullet) return false;
    // 選択UIを起動
    upd(p => ({ ...p, battle: { ...p.battle,
      wideShotSelect: { attackerId, defenderId, pendingGrid: [...grid], pairs: [], step: "pick_empty" }
    }}));
    return true;
  };

  // ワイドショット: 空きマスを選択（step pick_empty → pick_source）
  const wideShotPickEmpty = (emptyCell) => {
    const ws = b.wideShotSelect;
    if (!ws || ws.step !== "pick_empty") return;
    upd(p => ({ ...p, battle: { ...p.battle,
      wideShotSelect: { ...ws, step: "pick_source", selectedEmpty: emptyCell }
    }}));
  };

  // ワイドショット: 移動元マスを選択してペアを確定
  const wideShotPickSource = (sourceCell) => {
    const ws = b.wideShotSelect;
    if (!ws || ws.step !== "pick_source") return;
    const newGrid = [...ws.pendingGrid];
    newGrid[ws.selectedEmpty - 1] = (newGrid[ws.selectedEmpty - 1] || 0) + 1;
    newGrid[sourceCell - 1]       = Math.max(0, (newGrid[sourceCell - 1] || 0) - 1);
    const newPairs = [...(ws.pairs || []), { from: sourceCell, to: ws.selectedEmpty }];
    // 移動元として使ったマスは目的地として選べないため除外して判定
    const usedSources = newPairs.map(p => p.from);
    const stillEmpty  = newGrid.some((v, i) => v === 0 && !usedSources.includes(i + 1));
    const stillBullet = newGrid.some(v => v > 0);
    upd(p => ({ ...p, battle: { ...p.battle,
      wideShotSelect: { ...ws, pendingGrid: newGrid, pairs: newPairs,
        step: stillEmpty && stillBullet ? "pick_empty" : "done",
        selectedEmpty: null }
    }}));
  };

  // ワイドショット確定
  const confirmWideShot = () => {
    const ws = b.wideShotSelect;
    if (!ws || !(ws.pairs || []).length) return;
    const att = pcs.find(p => p.uid === ws.attackerId) || npcs.find(n => n.id === ws.attackerId);
    markDanmakuUsed(ws.attackerId, "ワイドショット");
    upd(p => ({ ...p,
      battle: { ...p.battle, grids: { ...p.battle.grids, [ws.defenderId]: ws.pendingGrid }, wideShotSelect: null },
      log: [`🔀 ${att?.charName || att?.name} の「ワイドショット」発動：${(ws.pairs || []).map(pr => `${pr.from}→${pr.to}`).join(", ")}番マス`, ...p.log]
    }));
  };

  // 高速移動: 自身のいるマスに弾幕がない場合、任意のマスへ移動できる
  const openHighSpeedSelect = (attackerId) => {
    upd(p => ({ ...p, battle: { ...p.battle, highSpeedSelect: { attackerId } } }));
  };

  const confirmHighSpeed = (cellNum) => {
    const hs = b.highSpeedSelect;
    if (!hs) return;
    upd(p => {
      const attacker = p.pcs.find(x => x.uid === hs.attackerId) || p.battle.participants.npcs.find(n => n.id === hs.attackerId);
      return {
        ...p,
        battle: { ...p.battle, positions: { ...p.battle.positions, [hs.attackerId]: cellNum }, highSpeedSelect: null },
        log: [`⚡ ${attacker?.charName || attacker?.name} の『高速移動』：${cellNum}番マスへ移動しました。`, ...p.log]
      };
    });
    markDanmakuUsed(hs.attackerId, "高速移動");
  };

  // 大威力: 重複出目があれば選択してそのマスに+1（複数種類の重複は選択UI）
  const openBigPowerSelect = (attackerId, defenderId, diceResults) => {
    const counts = {};
    diceResults.forEach(d => { counts[d] = (counts[d] || 0) + 1; });
    const dupValues = Object.entries(counts).filter(([, c]) => c >= 2).map(([v]) => Number(v));
    if (dupValues.length === 0) return;
    if (dupValues.length === 1) {
      const value = dupValues[0];
      upd(p => {
        const grid = [...(p.battle.grids?.[defenderId] || [0,0,0,0,0,0])];
        grid[value - 1] = (grid[value - 1] || 0) + 1;
        const att = p.pcs.find(x => x.uid === attackerId) || p.battle.participants.npcs.find(n => n.id === attackerId);
        return {
          ...p,
          battle: { ...p.battle, grids: { ...p.battle.grids, [defenderId]: grid } },
          log: [`💥 ${att?.charName || att?.name} の『大威力』：出目 ${value} のマスに弾幕が1つ追加されました。`, ...p.log]
        };
      });
      markDanmakuUsed(attackerId, "大威力");
    } else {
      upd(p => ({ ...p, battle: { ...p.battle, bigPowerSelect: { attackerId, defenderId, dupValues } } }));
    }
  };

  const confirmBigPower = (value) => {
    const bp = b.bigPowerSelect;
    if (!bp) return;
    upd(p => {
      const grid = [...(p.battle.grids?.[bp.defenderId] || [0,0,0,0,0,0])];
      grid[value - 1] = (grid[value - 1] || 0) + 1;
      const att = p.pcs.find(x => x.uid === bp.attackerId) || p.battle.participants.npcs.find(n => n.id === bp.attackerId);
      return {
        ...p,
        battle: { ...p.battle, grids: { ...p.battle.grids, [bp.defenderId]: grid }, bigPowerSelect: null },
        log: [`💥 ${att?.charName || att?.name} の『大威力』：出目 ${value} のマスに弾幕が1つ追加されました。`, ...p.log]
      };
    });
    markDanmakuUsed(bp.attackerId, "大威力");
  };

  // 弾消し: マス選択UIを開く
  const openEraseSelect = (attackerId, defenderId) => {
    upd(p => ({ ...p, battle: { ...p.battle, eraseSelect: { attackerId, targetFieldId: defenderId } } }));
  };

  const confirmErase = (cellNum) => {
    const es = b.eraseSelect;
    if (!es) return;
    upd(p => {
      const grid = [...(p.battle.grids[es.targetFieldId] || [0,0,0,0,0,0])];
      if ((grid[cellNum - 1] || 0) <= 0) return p;
      grid[cellNum - 1] -= 1;
      const attacker = p.pcs.find(x => x.uid === es.attackerId) || p.battle.participants.npcs.find(n => n.id === es.attackerId);
      return {
        ...p,
        battle: { ...p.battle, grids: { ...p.battle.grids, [es.targetFieldId]: grid }, eraseSelect: null },
        log: [`🧹 ${attacker?.charName || attacker?.name} の『弾消し』：${cellNum}番マスの弾幕を1つ取り除きました。`, ...p.log]
      };
    });
    markDanmakuUsed(es.attackerId, "弾消し");
  };

  // ショットロールへ進む（スキルはIntroのボタンで事前使用）
  const handleProceedToShotRoll = (isPc, nextPhase) => {
    upd(p => ({ ...p, battle: { ...p.battle, phase: nextPhase } }));
  };

  const combatantPc = pcs.find(p => p.uid === b.pcCombatant);
  const combatantNpc = npcs.find(n => n.id === b.npcCombatant);
  const currentPos = b.positions?.[b.pcCombatant];
  const danmakuAtPos = b.grids?.[b.pcCombatant]?.[currentPos - 1] || 0;
  const evadeTarget = danmakuAtPos + 3;
  const npcPos = b.positions?.[b.npcCombatant];
  const npcDanmakuAtPos = b.grids?.[b.npcCombatant]?.[npcPos - 1] || 0;

  const getDefaultEvadeDice = (entity) => entity?.resources?.回避力?.cur || 3;

  const getEvadeNeighbors = (pos, wallPass) => {
    const base = ADJACENT_MAP[pos] || [];
    if (!wallPass) return base;
    const extras = { 1: [3], 3: [1], 4: [6], 6: [4] };
    return [...new Set([...base, ...(extras[pos] || [])])];
  };

  const afterDefensePhase = (isAttackerPc) => {
    const attackerIsFirst = b.startOrder === "npc" ? !isAttackerPc : isAttackerPc;
    if (attackerIsFirst) {
      return isAttackerPc ? "npc_shot_intro" : "pc_shot_intro";
    } else {
      return "round_end_check";
    }
  };

  const getEvadeDiceCount = (isPc) => {
    const combatant = isPc ? combatantPc : combatantNpc;
    return b.currentEvadeDice ?? getDefaultEvadeDice(combatant);
  };

  const handleEvadeRoll = (isPc) => {
    const combatant = isPc ? pcs.find(p => p.uid === b.pcCombatant) : npcs.find(n => n.id === b.npcCombatant);
    const pos = b.positions[isPc ? b.pcCombatant : b.npcCombatant];
    const bulletCount = b.grids[isPc ? b.pcCombatant : b.npcCombatant][pos - 1];
    const targetValue = bulletCount + 3;
    const diceCount = getEvadeDiceCount(isPc);
    
    animateDice(diceCount, `${isPc ? "PC" : "NPC"}回避判定`, (res) => {
      const maxDie = Math.max(...res);
      const isFumble = res.every(d => d === 1);
      const isSpecial = res.includes(6) && !isFumble;
      const isSuccess = maxDie >= targetValue && !isFumble;
      const resultNotice = isFumble ? "ファンブル！" : isSpecial ? "スペシャル！" : "";

      if (isSuccess) {
        upd(p => ({
          ...p,
          battle: { ...p.battle, phase: isPc ? "pc_evade_move" : "npc_evade_move" },
          log: [`✨ ${combatant.charName || combatant.name} は回避判定に成功！(出目:${res.join(",")})${resultNotice ? ` ${resultNotice}` : ""}` + (isPc ? " 移動先を選択してください。" : ""), ...p.log]
        }));
      } else {
        upd(p => ({
          ...p,
          battle: { ...p.battle, phase: isPc ? "pc_hit_check" : "npc_hit_check" },
          log: [`💀 ${combatant.charName || combatant.name} は回避に失敗... (出目:${res.join(",")})${resultNotice ? ` ${resultNotice}` : ""}`, ...p.log]
        }));
      }
    });
  };

  const handleEvadeMove = (isPc, targetCellNum) => {
    const combatantId = isPc ? b.pcCombatant : b.npcCombatant;
    const oldPos = b.positions[combatantId];
    if (!getEvadeNeighbors(oldPos, b.wallPass).includes(targetCellNum)) return;
    const bulletsCleared = b.grids[combatantId][oldPos - 1] || 0;

    upd(p => {
      const newGrid = [...p.battle.grids[combatantId]];
      newGrid[oldPos - 1] = 0;

      const currentEntity = isPc ? p.pcs.find(x => x.uid === combatantId) : p.battle.participants.npcs.find(n => n.id === combatantId);
      const currentGraze = currentEntity.resources.グレイズ?.cur || 0;
      const nextGraze = currentGraze + bulletsCleared;
      const currentDice = p.battle.currentEvadeDice ?? getDefaultEvadeDice(currentEntity);
      const nextDice = Math.max(0, currentDice - 1);

      const updatedEntity = {
        ...currentEntity,
        resources: {
          ...currentEntity.resources,
          グレイズ: { ...currentEntity.resources.グレイズ, cur: nextGraze }
        }
      };

      const updatedPcs = isPc
        ? p.pcs.map(pc => pc.uid === combatantId ? updatedEntity : pc)
        : p.pcs;

      const updatedNpcs = isPc
        ? p.battle.participants.npcs
        : p.battle.participants.npcs.map(npc => npc.id === combatantId ? updatedEntity : npc);

      return {
        ...p,
        pcs: updatedPcs,
        battle: {
          ...p.battle,
          participants: {
            ...p.battle.participants,
            npcs: updatedNpcs
          },
          positions: { ...p.battle.positions, [combatantId]: targetCellNum },
          grids: { ...p.battle.grids, [combatantId]: newGrid },
          currentEvadeDice: nextDice,
          phase: isPc
            ? (nextDice > 0 ? "pc_evade_intro" : afterDefensePhase(false))
            : (nextDice > 0 ? "npc_evade_intro" : "npc_hit_check")
        },
        log: [
          `🏃 ${currentEntity.charName || currentEntity.name} は ${targetCellNum}番マスへ移動。`,
          `✨ ${bulletsCleared}点のグレイズを獲得！(現在:${nextGraze}点)`,
          ...p.log
        ]
      };
    });
  };

  const handleRecovery = (isPc, targetCellNum) => {
    const combatantId = isPc ? b.pcCombatant : b.npcCombatant;
    const nextPhase = afterDefensePhase(!isPc);

    upd(p => ({
      ...p,
      battle: {
        ...p.battle,
        positions: { ...p.battle.positions, [combatantId]: targetCellNum },
        phase: nextPhase,
        currentEvadeDice: isPc ? getDefaultEvadeDice(p.pcs.find(x => x.uid === combatantId)) : p.battle.currentEvadeDice
      },
      log: [`✨ ${isPc ? pcs.find(x => x.uid === combatantId)?.charName : npcs.find(n => n.id === combatantId)?.name} は ${targetCellNum}番マスに復帰した。`, ...p.log]
    }));
  };

  const applyHit = (isPc, targetId) => {
    upd(p => {
      const target = isPc ? p.pcs.find(x => x.uid === targetId) : p.battle.participants.npcs.find(n => n.id === targetId);
      const newLives = Math.max(0, (target.resources.残り人数?.cur || 0) - 1);
      
      let nextRei = target.resources.霊力?.cur || 0;
      let nextSpe = target.resources.スペルカード?.cur || 0;
      let nextAtk = target.resources.攻撃力?.cur || 1;

      if (isPc && newLives === 1) {
        nextRei = target.resources.霊力?.max || 20;
        nextAtk = 1 + Math.floor(nextRei / 5);
      }
      if (newLives === 1) {
        nextSpe = Math.min(target.resources.スペルカード?.max || 9, nextSpe + 1);
      }

      const updatedTarget = {
        ...target,
        resources: {
          ...target.resources,
          残り人数: { ...target.resources.残り人数, cur: newLives },
          ...(isPc ? {
            霊力: { ...target.resources.霊力, cur: nextRei },
            攻撃力: { ...target.resources.攻撃力, cur: nextAtk }
          } : {}),
          スペルカード: { ...target.resources.スペルカード, cur: nextSpe }
        }
      };

      const nextEntities = isPc 
        ? p.pcs.map(pc => pc.uid === targetId ? updatedTarget : pc)
        : p.battle.participants.npcs.map(n => n.id === targetId ? updatedTarget : n);

      const clearedGrid = [0, 0, 0, 0, 0, 0];

      const nextBattle = {
        ...p.battle,
        grids: { ...p.battle.grids, [targetId]: clearedGrid },
        phase: isPc ? (newLives > 0 ? "pc_hit_recovery" : "pc_dropout") : (newLives > 0 ? "npc_hit_recovery" : "npc_dropout"),
        ...(isPc ? {} : { participants: { ...p.battle.participants, npcs: nextEntities } }),
      };

      return {
        ...p,
        ...(isPc ? { pcs: nextEntities } : {}),
        battle: nextBattle,
        log: [
          `💥 ${target.charName || target.name} は被弾した！ 残り人数: ${newLives}`,
          isPc && newLives === 1 ? `🔥 霊力が最大まで回復した！` : null,
          newLives === 1 ? `🔮 ${target.name} はスペルカードを1点獲得した！` : null,
          ...p.log
        ].filter(Boolean)
      };
    });
  };

  const applyPcHit = (pcUid) => applyHit(true, pcUid);
  const applyNpcHit = (npcId) => applyHit(false, npcId);

  // 低速弾: マス選択UIを開く（count>=2 のマスのみ保護可能）
  const openSlowBulletSelect = (ownerId, targetId) => {
    upd(p => ({ ...p, battle: { ...p.battle, slowBulletSelect: { ownerId, targetId } } }));
  };

  const confirmSlowBullet = (cellNum) => {
    const sb = b.slowBulletSelect;
    if (!sb) return;
    upd(p => {
      const grid = [...(p.battle.grids[sb.targetId] || [0,0,0,0,0,0])];
      grid[cellNum - 1] = (grid[cellNum - 1] || 0) + 1;
      const owner = p.pcs.find(x => x.uid === sb.ownerId) || p.battle.participants.npcs.find(n => n.id === sb.ownerId);
      return {
        ...p,
        battle: { ...p.battle, grids: { ...p.battle.grids, [sb.targetId]: grid }, slowBulletSelect: null },
        log: [`🐌 ${owner?.charName || owner?.name} の『低速弾』：${cellNum}番マスの弾幕を保護しました。`, ...p.log]
      };
    });
    markDanmakuUsed(sb.ownerId, "低速弾");
  };

  const handleCleanup = () => {
    upd(p => {
      const currentB = p.battle;
      const nextGrids = {};
      
      Object.keys(currentB.grids).forEach(id => {
        nextGrids[id] = currentB.grids[id].map(val => val >= 3 ? 2 : val === 2 ? 1 : val);
      });

      const nextActedPcs = [...new Set([...(currentB.actedPcs || []), currentB.pcCombatant])];
      const nextActedNpcs = [...new Set([...(currentB.actedNpcs || []), currentB.npcCombatant])];
      
      return {
        ...p,
        battle: {
          ...currentB,
          phase: "round_start",
          round: currentB.round + 1,
          grids: nextGrids,
          actedPcs: nextActedPcs,
          actedNpcs: nextActedNpcs,
          pcCombatant: null,
          npcCombatant: null,
          lastSpellUsed: null,
          wallPass: null,
          homingSelect: null,
          wideShotSelect: null,
          slowBulletSelect: null,
          usedds: {},
          currentEvadeDice: getDefaultEvadeDice(pcs.find(pc => pc.uid === currentB.pcCombatant)),
          supportDice: 0,
          usedIntervention: {},
          familiarAction: null,
          tempSelectedPc: null,
          tempSelectedNpc: null
        },
        log: [`📋 ラウンド ${currentB.round} 終了。弾幕が減衰しました。`, ...p.log]
      };
    });
  };

  const renderShotIntro = (isPc) => {
    const combatant = isPc ? combatantPc : npcs.find(n => n.id === b.npcCombatant);
    const title = isPc ? "PLAYER ATTACK TURN" : "NPC ATTACK TURN";
    const titleColor = isPc ? C.blue : C.red;
    const nextPhase = isPc ? "pc_shot_roll" : "npc_shot_roll";
    const buttonLabel = isPc ? "準備完了 🎲" : "ショット開始 🎲";
    const buttonStyle = isPc ? btnFull(C.blueBg, C.blueBorder, C.blue) : btnFull(C.redBg, C.redBorder, C.red);
    const canProceed = isPc ? (user.uid === b.pcCombatant || isGm) : isGm;

    return (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#040608" }}>
        <div style={{ textAlign: "center", animation: "fadeUp 0.8s ease" }}>
          <div style={{ fontSize: 12, color: titleColor, letterSpacing: 4, marginBottom: 10 }}>{title}</div>
          <div style={{ fontSize: 32, color: "#fff", fontWeight: "bold", textShadow: `0 0 20px ${titleColor}55` }}>{combatant?.charName || combatant?.name}</div>
          <div style={{ fontSize: 14, color: C.textDim, marginTop: 10 }}>のショットステップ</div>
          {/* 使い魔: PC先攻のショット直前に援護射撃 or スキップ（→後でかばう自動発動）を確認 */}
          {canProceed && b.startOrder === "pc" && hasOfficialSkill(combatantPc, "使い魔") && b.familiarAction === null && (
            <div style={{ marginTop: 12, marginBottom: 4, padding: 10, background: "rgba(100,181,246,0.08)", border: `1px solid ${C.blueBorder}`, borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: C.blue, marginBottom: 4 }}>🐾 使い魔 — 援護射撃する？</div>
              <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 8 }}>スキップすると後でかばうが自動発動します</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => { handleSupportFire(b.pcCombatant); upd(p => ({ ...p, battle: { ...p.battle, familiarAction: "support" } })); }}
                  style={btnFull("rgba(100,181,246,0.18)", C.blueBorder, C.blue, { flex: 1, fontSize: 10 })}>
                  💠 援護射撃する
                </button>
                <button
                  onClick={() => upd(p => ({ ...p, battle: { ...p.battle, familiarAction: "skip_to_cover" } }))}
                  style={btnFull("rgba(255,255,255,0.04)", C.border, C.textDim, { flex: 1, fontSize: 10 })}>
                  ⏭ スキップ
                </button>
              </div>
            </div>
          )}
          {canProceed && b.startOrder === "pc" && hasOfficialSkill(combatantPc, "使い魔") && b.familiarAction === "skip_to_cover" && (
            <div style={{ fontSize: 9, color: C.gold, marginTop: 8 }}>✅ かばうを後で自動発動します</div>
          )}

          {/* 使い魔: NPC先攻のショット直前に援護射撃 or スキップ（→後でかばう自動発動）を確認 */}
          {canProceed && b.startOrder === "npc" && hasOfficialSkill(combatantNpc, "使い魔") && b.familiarAction === null && (
            <div style={{ marginTop: 12, marginBottom: 4, padding: 10, background: "rgba(192,57,43,0.08)", border: `1px solid ${C.redBorder}`, borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: C.red, marginBottom: 4 }}>🐾 使い魔 — 援護射撃する？</div>
              <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 8 }}>スキップすると後でかばうが自動発動します</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => upd(p => ({
                    ...p,
                    battle: { ...p.battle, supportDice: (p.battle.supportDice || 0) + 1, familiarAction: "support" },
                    log: [`💠 ${combatantNpc?.name} の使い魔が援護射撃！攻撃ダイス+1`, ...p.log],
                  }))}
                  style={btnFull("rgba(192,57,43,0.18)", C.redBorder, C.red, { flex: 1, fontSize: 10 })}>
                  💠 援護射撃する
                </button>
                <button
                  onClick={() => upd(p => ({ ...p, battle: { ...p.battle, familiarAction: "skip_to_cover" } }))}
                  style={btnFull("rgba(255,255,255,0.04)", C.border, C.textDim, { flex: 1, fontSize: 10 })}>
                  ⏭ スキップ
                </button>
              </div>
            </div>
          )}
          {canProceed && b.startOrder === "npc" && hasOfficialSkill(combatantNpc, "使い魔") && b.familiarAction === "skip_to_cover" && (
            <div style={{ fontSize: 9, color: C.gold, marginTop: 8 }}>✅ かばうを後で自動発動します</div>
          )}

          {/* ⚡ ショット直前スキル（近接攻撃・弾消し） */}
          {canProceed && (() => {
            const attackerId = isPc ? b.pcCombatant : b.npcCombatant;
            const defenderId = isPc ? b.npcCombatant : b.pcCombatant;
            const attacker   = isPc ? combatantPc : combatantNpc;
            const canProximity = hasOfficialSkill(attacker, "近接攻撃") && !isDanmakuUsed(attackerId, "近接攻撃");
            const canErase     = hasOfficialSkill(attacker, "弾消し")   && !isDanmakuUsed(attackerId, "弾消し");
            const defGrid      = b.grids?.[defenderId] || [0,0,0,0,0,0];
            const hasBullet    = defGrid.some(v => v > 0);
            const samePos      = b.positions?.[attackerId] === b.positions?.[defenderId];
            return (canProximity || canErase) ? (
              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 6, width: 240 }}>
                <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 1 }}>⚡ 弾幕スキル（ダイス直前）</div>
                {canProximity && (
                  <button onClick={() => tryApplyProximity(attackerId, defenderId)}
                    disabled={!samePos}
                    style={btnFull("rgba(255,100,100,0.18)", C.redBorder, C.red, { opacity: samePos ? 1 : 0.35 })}>
                    💥 近接攻撃{samePos ? "" : "（同マスでない）"}
                  </button>
                )}
                {canErase && !b.eraseSelect && (
                  <button onClick={() => openEraseSelect(attackerId, defenderId)}
                    disabled={!hasBullet}
                    style={btnFull("rgba(200,160,64,0.18)", C.goldDim, C.gold, { opacity: hasBullet ? 1 : 0.35 })}>
                    🧹 弾消し{hasBullet ? "" : "（弾幕なし）"}
                  </button>
                )}
                {/* 弾消し選択UI */}
                {b.eraseSelect && b.eraseSelect.attackerId === attackerId && (() => {
                  const grid = b.grids?.[b.eraseSelect.targetFieldId] || [0,0,0,0,0,0];
                  return (
                    <div style={{ padding: 8, background: "rgba(200,160,64,0.12)", border: `1px solid ${C.goldDim}`, borderRadius: 4 }}>
                      <div style={{ fontSize: 9, color: C.gold, marginBottom: 5 }}>🧹 弾消し — 取り除くマスを選んでください</div>
                      <div style={{ display: "flex", gap: 5, justifyContent: "center", marginBottom: 5 }}>
                        {grid.map((v, i) => (
                          <button key={i} onClick={() => v > 0 && confirmErase(i + 1)}
                            disabled={v === 0}
                            style={{ width: 34, height: 34, background: v > 0 ? "rgba(200,160,64,0.2)" : "rgba(255,255,255,0.02)", border: `1px solid ${v > 0 ? C.gold : C.border}`, borderRadius: 4, fontSize: 13, color: v > 0 ? C.gold : C.textFaint, cursor: v > 0 ? "pointer" : "default" }}>
                            {i + 1}{v > 0 ? `(${v})` : ""}
                          </button>
                        ))}
                      </div>
                      <button onClick={() => upd(p => ({ ...p, battle: { ...p.battle, eraseSelect: null } }))}
                        style={{ fontSize: 9, color: C.textFaint, background: "none", border: "none", cursor: "pointer" }}>キャンセル</button>
                    </div>
                  );
                })()}
              </div>
            ) : null;
          })()}

          {canProceed && !b.eraseSelect &&
            !(isPc && b.startOrder === "pc" && hasOfficialSkill(combatantPc, "使い魔") && b.familiarAction === null) &&
            !(!isPc && b.startOrder === "npc" && hasOfficialSkill(combatantNpc, "使い魔") && b.familiarAction === null) && (
            <button
              onClick={() => handleProceedToShotRoll(isPc, nextPhase)}
              style={{ ...buttonStyle, marginTop: 30, width: 200 }}
            >
              {buttonLabel}
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderShotRoll = (isPc) => {
    const attacker = isPc ? combatantPc : npcs.find(n => n.id === b.npcCombatant);
    const hasFamiliarAttacker = hasOfficialSkill(attacker, "使い魔");
    const diceCount = Math.max(1, (attacker?.resources?.攻撃力?.cur || 0) + (b.supportDice || 0) - (hasFamiliarAttacker ? 1 : 0));
    const title = isPc ? "PC攻撃ステップ" : "NPC攻撃ステップ";
    const name = attacker?.charName || attacker?.name;
    const cardColor = isPc ? C.blue : C.red;
    const buttonStyle = isPc ? btnFull(C.blueBg, C.blueBorder, C.blue) : btnFull(C.redBg, C.redBorder, C.red);
    const canRoll = isPc ? (user.uid === b.pcCombatant || isGm) : isGm;

    return (
      <div style={{ background: "rgba(0,0,0,0.8)", padding: 15, borderRadius: 8, border: `1px solid ${cardColor}`, textAlign: "center", animation: "fadeUp 0.3s ease" }}>
        <div style={{ color: cardColor, fontSize: 11, marginBottom: 4 }}>{title}</div>
        <div style={{ color: "#fff", fontSize: 13, marginBottom: 12 }}>{name} の攻撃</div>
        {b.supportDice > 0 && <div style={{ fontSize: 10, color: C.red, marginBottom: 8 }}>援護射撃ボーナス: +{b.supportDice}D</div>}
        {canRoll && (
          <button onClick={() => executeShot(isPc)} style={buttonStyle}>
            🎲 ショットを放つ ({diceCount}D)
          </button>
        )}
      </div>
    );
  };

  const renderSpellStep = (isPcAttacker, timing = "standard") => {
    const attacker    = isPcAttacker ? combatantPc : combatantNpc;
    const spellsRaw   = isPcAttacker
      ? [...(attacker?.spellCards || []), ...(attacker?.growthSpellUnlocked ? [attacker?.growthSpellCard] : [])]
      : [...(attacker?.spellCards || [])];
    const spells      = spellsRaw.filter(Boolean).map(t => buildSpellCard(t));
    const available   = spells.filter(s => s.timing === timing);
    const spellPts    = attacker?.resources?.スペルカード?.cur || 0;
    const canDeclare  = isPcAttacker ? (isGm || user.uid === b.pcCombatant) : isGm;
    const cardColor   = isPcAttacker ? C.blue : C.red;
    const borderColor = isPcAttacker ? C.blueBorder : C.redBorder;

    // CHOOSE 選択中
    if (b.spellChoose && b.spellChoose.attackerId === (isPcAttacker ? b.pcCombatant : b.npcCombatant)) {
      const remaining = b.spellChoose.remaining - b.spellChoose.selected.length;
      return (
        <div style={{ background: "rgba(0,0,0,0.85)", padding: 12, borderRadius: 8, border: `1px solid ${C.gold}`, marginTop: 10 }}>
          <div style={{ fontSize: 11, color: C.gold, marginBottom: 6 }}>🔮 マスを {remaining} 箇所選択してください</div>
          <div style={{ fontSize: 9, color: C.textDim }}>（グリッド上のマス番号をクリック）</div>
          <div style={{ display: "flex", gap: 4, marginTop: 8, justifyContent: "center" }}>
            {[1,2,3,4,5,6].map(cell => {
              const alreadySelected = b.spellChoose.selected.includes(cell);
              return (
                <button key={cell} onClick={() => handleSpellChooseCell(cell)}
                  disabled={alreadySelected || !canDeclare}
                  style={{ width: 32, height: 32, borderRadius: 4, cursor: alreadySelected ? "default" : "pointer",
                    background: alreadySelected ? "rgba(200,160,64,0.3)" : "rgba(255,255,255,0.05)",
                    border: `1px solid ${alreadySelected ? C.gold : C.border}`, color: alreadySelected ? C.gold : C.text, fontSize: 13 }}>
                  {cell}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    // 使用可能なスペカも点数もなく宣言済みでもなければパネル不要
    if (available.length === 0 || b.lastSpellUsed || spellPts <= 0 || !canDeclare) return null;

    return (
      <div style={{ background: "rgba(0,0,0,0.85)", padding: 12, borderRadius: 8, border: `1px solid ${borderColor}`, marginTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: cardColor }}>
            🔮 スペルカード宣言 — {attacker?.charName || attacker?.name}
          </div>
          <div style={{ fontSize: 10, color: C.gold }}>残り {spellPts} 点</div>
        </div>

        {available.map((spell, i) => {
          const [expanded, setExpanded] = [false, () => {}];
          return (
            <div key={i} style={{ marginBottom: 6, border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>
              <div style={{ padding: "6px 8px", background: "rgba(255,255,255,0.03)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: spell.manual ? C.textDim : C.gold, marginBottom: 2 }}>{spell.name}</div>
                    <div style={{ fontSize: 9, color: C.textFaint, lineHeight: 1.5 }}>{spell.text}</div>
                    {spell.condition && (
                      <div style={{ fontSize: 9, color: C.red, marginTop: 3 }}>⚠ {spell.condition}</div>
                    )}
                    {spell.manual && (
                      <div style={{ fontSize: 9, color: "#5a6070", marginTop: 3 }}>★ 効果はGMが手動処理</div>
                    )}
                    {spell.effectTiming === "round_end" && (
                      <div style={{ fontSize: 9, color: "#ef9a9a", marginTop: 3 }}>⏰ ラウンド終了時に効果発動</div>
                    )}
                    {spell.effects.some(e => e.count === -1) && (
                      <div style={{ fontSize: 9, color: C.blue, marginTop: 3 }}>※ 枚数は宣言時に確認</div>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      const needCount = spell.effects.some(e => e.count === -1);
                      if (needCount) {
                        const n = parseInt(window.prompt("配置する弾幕の数を入力してください", "1"));
                        if (!isNaN(n) && n > 0) declareSpell(spell, isPcAttacker, n);
                      } else {
                        declareSpell(spell, isPcAttacker, null);
                      }
                    }}
                    style={{ flexShrink: 0, padding: "4px 10px", fontSize: 10, cursor: "pointer",
                      background: "rgba(200,160,64,0.2)",
                      border: `1px solid ${C.goldDim}`,
                      color: C.gold, borderRadius: 3 }}
                  >宣言</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderManualSpellControls = () => {
    const spell = b.manualSpell || b.pendingSpell;
    if (!spell || !isGm) return null;

    const pcId = b.pcCombatant;
    const npcId = b.npcCombatant;
    const pcGrid = b.grids?.[pcId] || [0,0,0,0,0,0];
    const npcGrid = b.grids?.[npcId] || [0,0,0,0,0,0];
    const pcPos = b.positions?.[pcId] || 0;
    const npcPos = b.positions?.[npcId] || 0;

    const renderEntityEditor = (entityId, label, grid, pos) => (
      <div style={{ flex: 1, minWidth: 220, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, borderRadius: 8, padding: 10 }}>
        <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>{label}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0,1fr))", gap: 6, marginBottom: 8 }}>
          {grid.map((count, index) => (
            <div key={index} style={{ padding: 8, background: "rgba(255,255,255,0.04)", borderRadius: 6, textAlign: "center" }}>
              <div style={{ fontSize: 10, color: C.textDim }}>#{index + 1}</div>
              <div style={{ fontSize: 14, color: C.text, marginTop: 4 }}>{count}</div>
              <div style={{ display: "flex", gap: 4, justifyContent: "center", marginTop: 6 }}>
                <button onClick={() => changeBulletCount(entityId, index + 1, -1)} style={{ width: 22, height: 22, fontSize: 12, borderRadius: 4, border: `1px solid ${C.border}`, background: "rgba(255,255,255,0.05)", color: C.text }}>-</button>
                <button onClick={() => changeBulletCount(entityId, index + 1, 1)} style={{ width: 22, height: 22, fontSize: 12, borderRadius: 4, border: `1px solid ${C.border}`, background: "rgba(255,255,255,0.05)", color: C.text }}>+</button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 10, color: C.textDim, marginBottom: 6 }}>現在の位置: {pos || "-"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0,1fr))", gap: 4 }}>
          {[1,2,3,4,5,6].map(num => (
            <button key={num} onClick={() => updateCombatantPosition(entityId, num)}
              style={{ padding: 6, borderRadius: 4, border: `1px solid ${num === pos ? C.gold : C.border}`, background: num === pos ? "rgba(255,215,0,0.12)" : "rgba(255,255,255,0.04)", color: C.text, fontSize: 11 }}>
              {num}
            </button>
          ))}
        </div>
      </div>
    );

    return (
      <div style={{ background: "rgba(0,0,0,0.82)", padding: 12, borderRadius: 10, border: `1px solid ${C.goldDim}`, marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 11, color: C.gold, marginBottom: 4 }}>🛠️ 手動スペル処理</div>
            <div style={{ fontSize: 10, color: C.textDim, marginBottom: 6 }}>{spell.name}</div>
            <div style={{ fontSize: 9, color: C.textFaint, lineHeight: 1.5 }}>{spell.text}</div>
            <div style={{ fontSize: 9, color: C.textDim, marginTop: 4 }}>
              PC/NPC の移動と弾幕数を調整できます。
            </div>
          </div>
          <button onClick={clearManualSpell} style={{ ...btnFull("rgba(255,255,255,0.08)", C.border, C.text), height: 32, alignSelf: "flex-start" }}>
            完了
          </button>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
          {renderEntityEditor(pcId, "PC", pcGrid, pcPos)}
          {renderEntityEditor(npcId, "NPC", npcGrid, npcPos)}
        </div>
      </div>
    );
  };

  const renderShotAfter = (isPc) => {
    const nextPhase = isPc ? "npc_evade_intro" : "pc_evade_intro";
    const attacker = isPc ? combatantPc : combatantNpc;
    const defenderId = isPc ? b.npcCombatant : b.pcCombatant;
    const attackerId = isPc ? b.pcCombatant : b.npcCombatant;
    const canProceed = isPc ? (isGm || user.uid === b.pcCombatant) : isGm;
    const buttonStyle = btnFull(C.blueBg, C.blueBorder, C.blue);
    const canUseWideShot = hasOfficialSkill(attacker, "ワイドショット") && !isDanmakuUsed(attackerId, "ワイドショット");
    const attackerPos = b.positions?.[attackerId];
    const attackerCellEmpty = attackerPos ? (b.grids?.[attackerId]?.[attackerPos - 1] || 0) === 0 : true;
    const canUseHighSpeed = canProceed && hasOfficialSkill(attacker, "高速移動") && !isDanmakuUsed(attackerId, "高速移動") && attackerCellEmpty && !b.highSpeedSelect;

    const dice = b.lastShotDice || [];
    const counts = {};
    dice.forEach(d => { counts[d] = (counts[d] || 0) + 1; });
    const hasDupe    = Object.values(counts).some(c => c >= 2);
    const defGrid    = b.grids?.[defenderId] || [0,0,0,0,0,0];
    const hasEmpty   = defGrid.some(v => v === 0);
    const hasBullet  = defGrid.some(v => v > 0);

    // ホーミング・大威力はダイス直後のみ（dice が残っている間）
    // 選択UI表示中は対応ボタンを隠す（二重起動防止）
    const canHoming   = canProceed && dice.length > 0 && hasOfficialSkill(attacker, "ホーミング")   && !isDanmakuUsed(attackerId, "ホーミング") && !b.homingSelect;
    const canBigPower = canProceed && dice.length > 0 && hasOfficialSkill(attacker, "大威力")     && !isDanmakuUsed(attackerId, "大威力") && !b.bigPowerSelect;

    return (
      <div style={{ background: "rgba(0,0,0,0.8)", padding: 15, borderRadius: 8, border: `1px solid ${C.greenBorder}`, textAlign: "center", animation: "fadeUp 0.3s ease" }}>
        <div style={{ color: C.green, fontSize: 11, marginBottom: 6 }}>ショット完了</div>

        {/* ダイス結果表示 */}
        {dice.length > 0 && (
          <div style={{ display: "flex", gap: 5, justifyContent: "center", marginBottom: 10 }}>
            {dice.map((d, i) => (
              <div key={i} style={{ width: 30, height: 30, background: "rgba(14,20,36,0.95)", border: `1px solid ${C.blueBorder}`, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: C.blue, fontWeight: "bold" }}>{d}</div>
            ))}
          </div>
        )}

        {/* ⚡ 弾幕スキル（ダイス直後タイミング） */}
        {/* ホーミング選択UI */}
        {b.homingSelect && (() => {
          const hs   = b.homingSelect;
          const isOwner = isGm || user.uid === hs.attackerId;
          if (!isOwner) return <div style={{ fontSize: 10, color: C.textDim }}>🔭 相手がホーミングを選択中…</div>;
          if (hs.step === "pick_die") return (
            <div style={{ marginBottom: 10, padding: 10, background: "rgba(100,181,246,0.1)", border: `1px solid ${C.blueBorder}`, borderRadius: 5 }}>
              <div style={{ fontSize: 10, color: C.blue, marginBottom: 6 }}>🔭 ホーミング — 変更するダイスを選んでください</div>
              <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                {hs.dice.map((d, i) => (
                  <button key={i} onClick={() => upd(p => ({ ...p, battle: { ...p.battle, homingSelect: { ...hs, step: "pick_value", selectedDieIdx: i } } }))}
                    style={{ width: 34, height: 34, background: "rgba(14,20,36,0.95)", border: `2px solid ${C.blue}`, borderRadius: 5, fontSize: 16, color: C.blue, cursor: "pointer", fontWeight: "bold" }}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          );
          if (hs.step === "pick_value") return (
            <div style={{ marginBottom: 10, padding: 10, background: "rgba(100,181,246,0.1)", border: `1px solid ${C.blueBorder}`, borderRadius: 5 }}>
              <div style={{ fontSize: 10, color: C.blue, marginBottom: 6 }}>🔭 ホーミング — {hs.dice[hs.selectedDieIdx]} を何に変えますか？</div>
              <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 6 }}>
                {[1,2,3,4,5,6].map(v => (
                  <button key={v} onClick={() => confirmHoming(v)}
                    disabled={v === hs.dice[hs.selectedDieIdx]}
                    style={{ width: 32, height: 32, background: v === hs.dice[hs.selectedDieIdx] ? "rgba(255,255,255,0.02)" : "rgba(100,181,246,0.15)", border: `1px solid ${C.blueBorder}`, borderRadius: 4, fontSize: 14, color: v === hs.dice[hs.selectedDieIdx] ? C.textFaint : C.blue, cursor: v === hs.dice[hs.selectedDieIdx] ? "default" : "pointer", fontWeight: "bold" }}>
                    {v}
                  </button>
                ))}
              </div>
              <button onClick={() => upd(p => ({ ...p, battle: { ...p.battle, homingSelect: { ...hs, step: "pick_die", selectedDieIdx: null } } }))}
                style={{ fontSize: 9, color: C.textFaint, background: "none", border: "none", cursor: "pointer" }}>← 選び直す</button>
            </div>
          );
          return null;
        })()}

        {/* 大威力選択UI */}
        {b.bigPowerSelect && b.bigPowerSelect.attackerId === attackerId && (() => {
          const bp = b.bigPowerSelect;
          const isOwner = isGm || user.uid === bp.attackerId;
          if (!isOwner) return <div style={{ fontSize: 10, color: C.textDim }}>💥 相手が大威力を選択中…</div>;
          return (
            <div style={{ marginBottom: 10, padding: 10, background: "rgba(255,183,77,0.1)", border: `1px solid ${C.goldDim}`, borderRadius: 5 }}>
              <div style={{ fontSize: 10, color: C.gold, marginBottom: 6 }}>💥 大威力 — 追加するマスを選んでください</div>
              <div style={{ display: "flex", gap: 5, justifyContent: "center", marginBottom: 5 }}>
                {bp.dupValues.map(v => (
                  <button key={v} onClick={() => confirmBigPower(v)}
                    style={{ width: 34, height: 34, background: "rgba(255,183,77,0.2)", border: `1px solid ${C.gold}`, borderRadius: 4, fontSize: 14, color: C.gold, cursor: "pointer", fontWeight: "bold" }}>
                    {v}
                  </button>
                ))}
              </div>
              <button onClick={() => upd(p => ({ ...p, battle: { ...p.battle, bigPowerSelect: null } }))}
                style={{ fontSize: 9, color: C.textFaint, background: "none", border: "none", cursor: "pointer" }}>キャンセル</button>
            </div>
          );
        })()}

        {/* ワイドショット選択UI */}
        {b.wideShotSelect && (() => {
          const ws  = b.wideShotSelect;
          const isOwner = isGm || user.uid === ws.attackerId;
          if (!isOwner) return <div style={{ fontSize: 10, color: C.textDim }}>🔀 相手がワイドショットを選択中…</div>;
          const grid = ws.pendingGrid;
          if (ws.step === "done") return (
            <div style={{ marginBottom: 10, padding: 10, background: "rgba(206,147,216,0.1)", border: "1px solid #7b1fa2", borderRadius: 5 }}>
              <div style={{ fontSize: 10, color: C.purple, marginBottom: 6 }}>🔀 選択完了: {(ws.pairs || []).map(pr => `${pr.from}→${pr.to}`).join(", ")}</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={confirmWideShot} style={btnFull("rgba(206,147,216,0.2)", "#7b1fa2", C.purple, { flex: 1 })}>確定する</button>
                <button onClick={() => upd(p => ({ ...p, battle: { ...p.battle, wideShotSelect: null } }))} style={btnFull("none", C.border, C.textFaint, { flex: 1 })}>キャンセル</button>
              </div>
            </div>
          );
          if (ws.step === "pick_empty") return (
            <div style={{ marginBottom: 10, padding: 10, background: "rgba(206,147,216,0.1)", border: "1px solid #7b1fa2", borderRadius: 5 }}>
              <div style={{ fontSize: 10, color: C.purple, marginBottom: 6 }}>🔀 ワイドショット — 移動先の空きマスを選んでください</div>
              {(ws.pairs || []).length > 0 && <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 4 }}>確定済み: {(ws.pairs || []).map(pr => `${pr.from}→${pr.to}`).join(", ")}</div>}
              <div style={{ display: "flex", gap: 5, justifyContent: "center", marginBottom: 6 }}>
                {(() => {
                  const usedSources = (ws.pairs || []).map(p => p.from);
                  return grid.map((v, i) => {
                    const isSelectable = v === 0 && !usedSources.includes(i + 1);
                    return (
                      <button key={i} onClick={() => isSelectable && wideShotPickEmpty(i + 1)}
                        disabled={!isSelectable}
                        style={{ width: 34, height: 34, background: isSelectable ? "rgba(206,147,216,0.2)" : "rgba(255,255,255,0.03)", border: `2px solid ${isSelectable ? C.purple : C.border}`, borderRadius: 5, fontSize: 13, color: isSelectable ? C.purple : C.textFaint, cursor: isSelectable ? "pointer" : "default", fontWeight: "bold" }}>
                        {i + 1}
                      </button>
                    );
                  });
                })()}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {(ws.pairs || []).length > 0 && <button onClick={confirmWideShot} style={btnFull("rgba(206,147,216,0.15)", "#7b1fa2", C.purple, { flex: 1, fontSize: 10 })}>この内容で確定</button>}
                <button onClick={() => upd(p => ({ ...p, battle: { ...p.battle, wideShotSelect: null } }))} style={btnFull("none", C.border, C.textFaint, { flex: 1, fontSize: 10 })}>キャンセル</button>
              </div>
            </div>
          );
          if (ws.step === "pick_source") return (
            <div style={{ marginBottom: 10, padding: 10, background: "rgba(206,147,216,0.1)", border: "1px solid #7b1fa2", borderRadius: 5 }}>
              <div style={{ fontSize: 10, color: C.purple, marginBottom: 6 }}>🔀 ワイドショット — {ws.selectedEmpty}番マスに移す弾幕のマスを選んでください</div>
              <div style={{ display: "flex", gap: 5, justifyContent: "center", marginBottom: 6 }}>
                {grid.map((v, i) => (
                  <button key={i} onClick={() => v > 0 && wideShotPickSource(i + 1)}
                    disabled={v === 0}
                    style={{ width: 34, height: 34, background: v > 0 ? "rgba(206,147,216,0.2)" : "rgba(255,255,255,0.03)", border: `2px solid ${v > 0 ? "#e040fb" : C.border}`, borderRadius: 5, fontSize: 13, color: v > 0 ? "#e040fb" : C.textFaint, cursor: v > 0 ? "pointer" : "default", fontWeight: "bold" }}>
                    {i + 1}{v > 0 ? `(${v})` : ""}
                  </button>
                ))}
              </div>
              <button onClick={() => upd(p => ({ ...p, battle: { ...p.battle, wideShotSelect: { ...ws, step: "pick_empty", selectedEmpty: null } } }))}
                style={{ fontSize: 9, color: C.textFaint, background: "none", border: "none", cursor: "pointer" }}>← 空きマス選択に戻る</button>
            </div>
          );
          return null;
        })()}

        {/* 高速移動選択UI */}
        {b.highSpeedSelect && b.highSpeedSelect.attackerId === attackerId && (() => {
          const hs = b.highSpeedSelect;
          const isOwner = isGm || user.uid === hs.attackerId;
          if (!isOwner) return <div style={{ fontSize: 10, color: C.textDim }}>⚡ 相手が高速移動を選択中…</div>;
          const curPos = b.positions?.[hs.attackerId];
          return (
            <div style={{ marginBottom: 10, padding: 10, background: "rgba(100,181,246,0.1)", border: `1px solid ${C.blueBorder}`, borderRadius: 5 }}>
              <div style={{ fontSize: 10, color: C.blue, marginBottom: 6 }}>⚡ 高速移動 — 移動先を選んでください</div>
              <div style={{ display: "flex", gap: 5, justifyContent: "center", marginBottom: 5 }}>
                {[1,2,3,4,5,6].map(num => (
                  <button key={num} onClick={() => confirmHighSpeed(num)}
                    disabled={num === curPos}
                    style={{ width: 34, height: 34, background: num === curPos ? "rgba(255,255,255,0.02)" : "rgba(100,181,246,0.15)", border: `1px solid ${num === curPos ? C.border : C.blueBorder}`, borderRadius: 4, fontSize: 14, color: num === curPos ? C.textFaint : C.blue, cursor: num === curPos ? "default" : "pointer", fontWeight: "bold" }}>
                    {num}
                  </button>
                ))}
              </div>
              <button onClick={() => upd(p => ({ ...p, battle: { ...p.battle, highSpeedSelect: null } }))}
                style={{ fontSize: 9, color: C.textFaint, background: "none", border: "none", cursor: "pointer" }}>キャンセル</button>
            </div>
          );
        })()}

        {(canHoming || canBigPower || canUseWideShot || canUseHighSpeed) && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 1, marginBottom: 5 }}>⚡ 弾幕スキル</div>

            {canHoming && (
              <button onClick={() => { tryApplyHoming(attackerId, defenderId, dice); }}
                style={{ ...btnFull("rgba(100,181,246,0.18)", C.blueBorder, C.blue), marginBottom: 4 }}>
                🔭 ホーミング（出目を1つ変更）
              </button>
            )}
            {canBigPower && (
              <button onClick={() => openBigPowerSelect(attackerId, defenderId, dice)}
                disabled={!hasDupe}
                style={{ ...btnFull("rgba(255,183,77,0.18)", C.goldDim, C.gold, { opacity: hasDupe ? 1 : 0.35 }), marginBottom: 4 }}>
                💥 大威力{hasDupe ? "" : "（重複出目なし）"}
              </button>
            )}
            {canUseWideShot && !b.wideShotSelect && (
              <button onClick={() => tryApplyWideShot(attackerId, defenderId)}
                disabled={!hasEmpty || !hasBullet}
                style={{ ...btnFull("rgba(206,147,216,0.18)", "#7b1fa2", C.purple, { opacity: hasEmpty && hasBullet ? 1 : 0.35 }), marginBottom: 4 }}>
                🔀 ワイドショット{hasEmpty && hasBullet ? "" : "（条件未達）"}
              </button>
            )}
            {canUseHighSpeed && (
              <button onClick={() => openHighSpeedSelect(attackerId)}
                disabled={!attackerCellEmpty}
                style={{ ...btnFull("rgba(100,181,246,0.18)", C.blueBorder, C.blue, { opacity: attackerCellEmpty ? 1 : 0.35 }), marginBottom: 4 }}>
                ⚡ 高速移動{attackerCellEmpty ? "" : "（現在地に弾幕あり）"}
              </button>
            )}
          </div>
        )}

        <div style={{ color: C.textDim, fontSize: 10, marginBottom: 8 }}>観戦者は「かばう」を使用できます</div>

        {/* 使い魔: かばう or スキップ確認（PC/NPC両対応） */}
        {(() => {
          const hasPcFamiliar = hasOfficialSkill(combatantPc, "使い魔");
          const hasNpcFamiliar = hasOfficialSkill(combatantNpc, "使い魔");
          const canPcFamiliarDecide = isGm || user.uid === b.pcCombatant;

          // Case A: PC has 使い魔, NPC先攻 → after NPC shot, offer かばう to PC
          const isCoverDecision = !isPc && b.startOrder === "npc" && hasPcFamiliar && b.familiarAction === null;
          const isAutoFamiliarCover = !isPc && hasPcFamiliar && b.familiarAction === "skip_to_cover";

          // Case D: NPC has 使い魔, PC先攻 → after PC shot, offer かばう to GM (protects NPC)
          const isNpcCoverDecision = isPc && b.startOrder === "pc" && hasNpcFamiliar && b.familiarAction === null;
          const isNpcAutoFamiliarCover = isPc && hasNpcFamiliar && b.familiarAction === "skip_to_cover";

          if (isCoverDecision && canPcFamiliarDecide) return (
            <div style={{ marginBottom: 8, padding: 10, background: "rgba(200,160,64,0.08)", border: `1px solid ${C.goldDim}`, borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: C.gold, marginBottom: 4 }}>🐾 使い魔 — かばう？</div>
              <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 8 }}>スキップすると後で援護射撃が自動発動します</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => {
                    animateDice(1, "かばう", (res) => {
                      const die = res[0];
                      upd(p => {
                        const grid = [...(p.battle.grids[b.pcCombatant] || [0,0,0,0,0,0])];
                        const success = grid[die - 1] > 0;
                        if (success) grid[die - 1] -= 1;
                        return {
                          ...p,
                          battle: { ...p.battle, grids: { ...p.battle.grids, [b.pcCombatant]: grid }, familiarAction: "cover" },
                          log: [`🛡 ${combatantPc?.charName} がかばった！${die}番マス ${success ? "弾幕除去" : "弾幕なし"}`, ...p.log],
                        };
                      });
                    });
                  }}
                  style={btnFull("rgba(200,160,64,0.18)", C.goldDim, C.gold, { flex: 1, fontSize: 10 })}>
                  🛡 かばう
                </button>
                <button
                  onClick={() => upd(p => ({ ...p, battle: { ...p.battle, familiarAction: "skip_to_support" } }))}
                  style={btnFull("rgba(255,255,255,0.04)", C.border, C.textDim, { flex: 1, fontSize: 10 })}>
                  ⏭ スキップ
                </button>
              </div>
            </div>
          );
          if (isAutoFamiliarCover && canPcFamiliarDecide) return (
            <div style={{ marginBottom: 8, padding: 10, background: "rgba(100,181,246,0.08)", border: `1px solid ${C.blueBorder}`, borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: C.blue, marginBottom: 6 }}>🛡 使い魔が自動でかばいます</div>
              <button onClick={() => handleAutoFamiliarCover(b.pcCombatant)}
                style={btnFull("rgba(100,181,246,0.18)", C.blueBorder, C.blue)}>
                🎲 ダイスを振って自動かばう実行
              </button>
            </div>
          );
          if (isNpcCoverDecision && isGm) return (
            <div style={{ marginBottom: 8, padding: 10, background: "rgba(192,57,43,0.08)", border: `1px solid ${C.redBorder}`, borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: C.red, marginBottom: 4 }}>🐾 使い魔 — かばう？（NPC）</div>
              <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 8 }}>スキップすると後で援護射撃が自動発動します</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => {
                    animateDice(1, "かばう", (res) => {
                      const die = res[0];
                      upd(p => {
                        const grid = [...(p.battle.grids[b.npcCombatant] || [0,0,0,0,0,0])];
                        const success = grid[die - 1] > 0;
                        if (success) grid[die - 1] -= 1;
                        return {
                          ...p,
                          battle: { ...p.battle, grids: { ...p.battle.grids, [b.npcCombatant]: grid }, familiarAction: "cover" },
                          log: [`🛡 ${combatantNpc?.name} の使い魔がかばった！${die}番マス ${success ? "弾幕除去" : "弾幕なし"}`, ...p.log],
                        };
                      });
                    });
                  }}
                  style={btnFull("rgba(192,57,43,0.18)", C.redBorder, C.red, { flex: 1, fontSize: 10 })}>
                  🛡 かばう
                </button>
                <button
                  onClick={() => upd(p => ({ ...p, battle: { ...p.battle, familiarAction: "skip_to_support" } }))}
                  style={btnFull("rgba(255,255,255,0.04)", C.border, C.textDim, { flex: 1, fontSize: 10 })}>
                  ⏭ スキップ
                </button>
              </div>
            </div>
          );
          if (isNpcAutoFamiliarCover && isGm) return (
            <div style={{ marginBottom: 8, padding: 10, background: "rgba(192,57,43,0.08)", border: `1px solid ${C.redBorder}`, borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: C.red, marginBottom: 6 }}>🛡 使い魔が自動でかばいます（NPC）</div>
              <button onClick={() => handleAutoFamiliarCover(b.npcCombatant)}
                style={btnFull("rgba(192,57,43,0.18)", C.redBorder, C.red)}>
                🎲 ダイスを振って自動かばう実行
              </button>
            </div>
          );
          return null;
        })()}

        {renderSpellStep(isPc, "standard")}

        {b.pendingSpell && (
          <div style={{ marginTop: 8, padding: "5px 8px", background: "rgba(239,154,154,0.1)", border: "1px solid #c62828", borderRadius: 4 }}>
            <div style={{ fontSize: 9, color: "#ef9a9a" }}>⏰ 宣言済: {b.pendingSpell.name}（ラウンド終了時に効果）</div>
          </div>
        )}

        {(() => {
          const hasPcFamiliar = hasOfficialSkill(combatantPc, "使い魔");
          const hasNpcFamiliar = hasOfficialSkill(combatantNpc, "使い魔");
          const isCoverDecision = !isPc && b.startOrder === "npc" && hasPcFamiliar && b.familiarAction === null;
          const isAutoFamiliarCover = !isPc && hasPcFamiliar && b.familiarAction === "skip_to_cover";
          const isNpcCoverDecision = isPc && b.startOrder === "pc" && hasNpcFamiliar && b.familiarAction === null;
          const isNpcAutoFamiliarCover = isPc && hasNpcFamiliar && b.familiarAction === "skip_to_cover";
          const blocked = isCoverDecision || isAutoFamiliarCover || isNpcCoverDecision || isNpcAutoFamiliarCover;
          return canProceed && !b.spellChoose && !b.homingSelect && !b.wideShotSelect && !b.highSpeedSelect && !b.bigPowerSelect && !blocked && (
            <button
              onClick={() => {
                upd(p => ({
                  ...p,
                  battle: {
                    ...p.battle,
                    phase: nextPhase,
                    lastShotDice: null,
                    currentEvadeDice: nextPhase === "pc_evade_intro"
                      ? getDefaultEvadeDice(combatantPc)
                      : getDefaultEvadeDice(combatantNpc)
                  }
                }));
              }}
              style={{ ...buttonStyle, marginTop: 8 }}
            >
              回避ステップへ進む
            </button>
          );
        })()}
      </div>
    );
  };

  const renderEvadeIntro = (isPc) => {
    const combatant = isPc ? combatantPc : combatantNpc;
    const targetValue = isPc ? evadeTarget : npcDanmakuAtPos + 3;
    const bulletCount = isPc ? danmakuAtPos : npcDanmakuAtPos;
    const titleColor = isPc ? C.blue : C.red;
    const borderColor = isPc ? C.blueBorder : C.redBorder;
    const isPlayable = isPc ? (user.uid === b.pcCombatant || isGm) : isGm;
    const canAutoSuccess = bulletCount === 0;
    const remainingDice = getEvadeDiceCount(isPc);
    const canProceed = isPc ? (user.uid === b.pcCombatant || isGm) : isGm;

    return (
      <div style={{ background: "rgba(0,0,0,0.85)", padding: 15, borderRadius: 8, border: `1px solid ${borderColor}`, textAlign: "center" }}>
        <div style={{ color: titleColor, fontSize: 11, marginBottom: 4 }}>{isPc ? "回避ステップ" : "回避ステップ(NPC)"}</div>
        <div style={{ color: "#fff", fontSize: 13, marginBottom: 12 }}>{combatant?.charName || combatant?.name} の回避</div>
        {canAutoSuccess ? (
          <div>
            <div style={{ color: C.green, fontSize: 10, marginBottom: 10 }}>マスの弾幕が 0 なので自動成功です</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              {canProceed && (
                <>
                  <button onClick={() => upd(p => ({ ...p, battle: { ...p.battle, phase: isPc ? "pc_evade_move" : "npc_evade_move" } }))} style={btnFull(C.greenBg, C.greenBorder, C.green)}>移動先を選択</button>
                  <button onClick={() => upd(p => ({ ...p, battle: { ...p.battle, phase: isPc ? "pc_hit_check" : "npc_hit_check", currentEvadeDice: isPc ? getDefaultEvadeDice(combatantPc) : p.battle.currentEvadeDice } }))} style={btnFull("rgba(255,255,255,0.1)", C.border, C.text)}>その場にとどまる</button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div>
            <div style={{ color: C.gold, fontSize: 10, marginBottom: 10 }}>目標値: {targetValue} (弾幕 {bulletCount} + 3)</div>
            {isPlayable && (
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                {canProceed && (
                  <>
                    {remainingDice > 0 ? (
                      <>
                        <button onClick={() => handleEvadeRoll(isPc)} style={btnFull(isPc ? C.blueBg : C.redBg, isPc ? C.blueBorder : C.redBorder, isPc ? C.blue : C.red)}>
                          🎲 回避判定 ({remainingDice}D)
                        </button>
                        {isPc && (
                          <button onClick={() => upd(p => ({ ...p, battle: { ...p.battle, phase: "pc_hit_check", currentEvadeDice: getDefaultEvadeDice(combatantPc) } }))} style={btnFull("rgba(255,255,255,0.1)", C.border, C.text)}>
                            その場にとどまる
                          </button>
                        )}
                      </>
                    ) : (
                      <button onClick={() => upd(p => ({ ...p, battle: { ...p.battle, phase: isPc ? "pc_hit_check" : "npc_hit_check", currentEvadeDice: isPc ? getDefaultEvadeDice(combatantPc) : p.battle.currentEvadeDice } }))} style={btnFull("rgba(255,255,255,0.08)", C.border, C.text)}>
                        回避ダイスがなくなりました。判定へ
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      {renderSpellStep(!isPc, "evade")}

      {/* ⚡ 壁抜け（防御側が回避ステップ中に使用） */}
      {isPlayable && (() => {
        const defenderId = isPc ? b.pcCombatant : b.npcCombatant;
        const defender   = isPc ? combatantPc : combatantNpc;
        const canWallPass = hasOfficialSkill(defender, "壁抜け") && !isDanmakuUsed(defenderId, "壁抜け") && !b.wallPass;
        return canWallPass ? (
          <button
            onClick={() => {
              markDanmakuUsed(defenderId, "壁抜け");
              upd(p => ({ ...p,
                battle: { ...p.battle, wallPass: true },
                log: [`🧱 ${defender?.charName || defender?.name} の「壁抜け」が発動：1↔3番・4↔6番が隣接扱いになります。`, ...p.log]
              }));
            }}
            style={{ ...btnFull("rgba(200,160,64,0.18)", C.goldDim, C.gold), marginTop: 6 }}>
            🧱 壁抜け（1↔3・4↔6番を隣接扱い）
          </button>
        ) : b.wallPass ? (
          <div style={{ fontSize: 9, color: C.gold, marginTop: 4 }}>🧱 壁抜け発動中</div>
        ) : null;
      })()}
      </div>
    );
  };

  const renderEvadeMove = (isPc) => {
    const borderColor = isPc ? C.blue : C.red;
    const textColor = isPc ? C.blue : C.red;

    return (
      <div style={{ background: "rgba(0,0,0,0.85)", padding: "12px 20px", borderRadius: 8, border: `1px solid ${borderColor}`, textAlign: "center", animation: "fadeUp 0.3s ease" }}>
        <div style={{ color: textColor, fontSize: 12, fontWeight: "bold", marginBottom: 4 }}>移動先を選択</div>
        <div style={{ color: "#fff", fontSize: 10 }}>ハイライトされた隣接マスをクリックしてください</div>
        {isGm && (
          <div style={{ marginTop: 8, fontSize: 9, color: C.textFaint }}>※GMはPLの代わりに操作可能です</div>
        )}
      </div>
    );
  };

  const renderHitCheck = (isPc) => {
    const targetId = isPc ? b.pcCombatant : b.npcCombatant;
    const target = isPc ? combatantPc : combatantNpc;
    const count = b.grids?.[targetId]?.[b.positions?.[targetId] - 1] || 0;
    const isSafe = count === 0;
    const canApply = isPc ? (user.uid === b.pcCombatant || isGm) : isGm;
    const applyHandler = () => isPc ? applyPcHit(targetId) : applyNpcHit(targetId);
    const cardBorder = isSafe ? C.green : C.red;

    return (
      <div style={{ background: "rgba(0,0,0,0.85)", padding: 15, borderRadius: 8, border: `2px solid ${cardBorder}`, textAlign: "center" }}>
        <div style={{ color: "#fff", fontSize: 12, marginBottom: 8 }}>{isPc ? "当たり判定ステップ" : "当たり判定ステップ(NPC)"}</div>
        {renderSpellStep(isPc, "hit")}

        {/* ⚡ 不死身スキル */}
        {!isSafe && (() => {
          const defenderId = isPc ? b.pcCombatant : b.npcCombatant;
          const defender   = isPc ? combatantPc : combatantNpc;
          const canImmortal = hasOfficialSkill(defender, "不死身") && !isDanmakuUsed(defenderId, "不死身");
          const reiryoku = (defender?.resources?.霊力?.cur || 0);
          const canAfford = reiryoku >= 10;
          return canImmortal ? (
            <div style={{ marginBottom: 10, padding: "8px 10px", background: "rgba(255,100,100,0.1)", border: `1px solid ${C.redBorder}`, borderRadius: 5 }}>
              <div style={{ fontSize: 10, color: C.red, marginBottom: 4 }}>💀 不死身 — 霊力10点消費で被弾を打ち消す</div>
              <div style={{ fontSize: 9, color: C.textDim, marginBottom: 6 }}>現在霊力: {reiryoku}点{!canAfford ? "（不足）" : ""}</div>
              <button
                disabled={!canAfford}
                onClick={() => {
                  markDanmakuUsed(defenderId, "不死身");
                  const next = afterDefensePhase(!isPc);
                  if (isPc) {
                    upd(p => ({ ...p,
                      pcs: p.pcs.map(x => x.uid !== defenderId ? x : { ...x, resources: { ...x.resources, 霊力: { ...x.resources.霊力, cur: x.resources.霊力.cur - 10 } } }),
                      battle: { ...p.battle, phase: next },
                      log: [`🛡 ${combatantPc?.charName} の『不死身』が発動（霊力-10）`, ...p.log]
                    }));
                  } else {
                    upd(p => ({ ...p,
                      battle: { ...p.battle, phase: next,
                        participants: { ...p.battle.participants, npcs: p.battle.participants.npcs.map(n => n.id !== defenderId ? n : { ...n, resources: { ...n.resources, 霊力: { ...n.resources.霊力, cur: n.resources.霊力.cur - 10 } } }) }
                      },
                      log: [`🛡 ${combatantNpc?.name} の『不死身』が発動（霊力-10）`, ...p.log]
                    }));
                  }
                }}
                style={btnFull("rgba(192,57,43,0.25)", C.redBorder, C.red, { opacity: canAfford ? 1 : 0.35 })}>
                🛡 不死身を発動する
              </button>
            </div>
          ) : null;
        })()}

        {isSafe ? (
          <div>
            <div style={{ color: C.green, fontSize: 14, fontWeight: "bold", marginBottom: 10 }}>回避成功（SAFE）</div>
            <button onClick={() => {
              const isAttackerPc = b.phase === "npc_hit_check";
              const next = afterDefensePhase(isAttackerPc);
              upd(p => ({ ...p, battle: { ...p.battle, phase: next,
                currentEvadeDice: next === "pc_evade_intro" ? getDefaultEvadeDice(combatantPc) : p.battle.currentEvadeDice
              } }));
            }} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>
              {afterDefensePhase(b.phase === "npc_hit_check") === "round_end_check" ? "ラウンド終了へ" : "後攻ショットへ"}
            </button>
          </div>
        ) : (
          <div>
            <div style={{ color: C.red, fontSize: 14, fontWeight: "bold", marginBottom: 10 }}>被弾（HIT!!）</div>
            {canApply && (
              <button onClick={applyHandler} style={btnFull(C.redBg, C.redBorder, C.red)}>ダメージを適用</button>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderDropout = (isPc) => {
    const combatant = isPc ? combatantPc : combatantNpc;
    return (
      <div style={{ background: "rgba(0,0,0,0.85)", padding: 20, borderRadius: 8, border: `2px solid ${C.red}`, textAlign: "center" }}>
        <div style={{ color: C.red, fontSize: 16, fontWeight: "bold", marginBottom: 10 }}>脱落</div>
        <div style={{ color: "#fff", fontSize: 11, marginBottom: 15 }}>{combatant?.charName || combatant?.name} は戦線から離脱しました...</div>
        {isGm && (
          <button onClick={() => upd(p => ({ ...p, battle: { ...p.battle, phase: "cleanup" } }))} style={btnFull(C.border, C.border, C.textFaint)}>ラウンド終了処理へ</button>
        )}
      </div>
    );
  };

  if (b.phase === "setup" && isGm) {
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#040608" }}>
        <div style={{ background: "#0c1020", border: `1px solid ${C.border}`, padding: 30, borderRadius: 8, maxWidth: 500, width: "90%" }}>
          <div style={{ fontSize: 18, color: C.gold, marginBottom: 20, textAlign: "center", letterSpacing: 4 }}>弾幕ごっこ準備</div>
          
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8 }}>対戦形式: {b.type === "mass" ? "集団戦" : "通常戦"}</div>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>参加PC: {pcs.map(p => p.charName).join(", ")}</div>
            <div style={{ fontSize: 11, color: C.textDim }}>相手: {npcs.map(n => n.name).join(", ")}</div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8 }}>先攻を選択</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[{ key: "pc", label: "PC先攻" }, { key: "npc", label: "NPC先攻" }].map(opt => (
                <button
                  key={opt.key}
                  onClick={() => upd(p => ({ ...p, battle: { ...p.battle, startOrder: opt.key } }))}
                  style={btnFull(
                    b.startOrder === opt.key ? C.goldBg : "rgba(255,255,255,0.05)",
                    b.startOrder === opt.key ? C.goldDim : C.border,
                    b.startOrder === opt.key ? C.gold : C.text,
                    { flex: 1 }
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <button 
            disabled={!b.startOrder}
            onClick={() => {
              const positions = {};
              const grids = {};
              pcs.forEach(p => { 
                positions[p.uid] = Math.floor(Math.random() * 6) + 1;
                grids[p.uid] = [0,0,0,0,0,0];
              });
              npcs.forEach(n => { 
                positions[n.id] = Math.floor(Math.random() * 6) + 1;
                grids[n.id] = [0,0,0,0,0,0];
              });

              upd(p => ({
                ...p,
                battle: {
                  ...p.battle,
                  phase: "round_start",
                  positions,
                  grids,
                  round: 1,
                  actedPcs: [],
                  actedNpcs: [],
                  log: ["⚖️ 弾幕ごっこ開始！規約に従い、正々堂々と戦いましょう。"]
                }
              }));
            }}
            style={btnFull(C.redBg, C.redBorder, C.red, { padding: "12px", opacity: b.startOrder ? 1 : 0.3, marginTop: 4 })}
          >
            対戦を開始する
          </button>
        </div>
      </div>
    );
  }

  if (b.phase === "result") {
    const isVictory  = b.result === "pc_win";
    const isMass     = b.type === "mass";
    const questId    = b.questId;
    const relatedQ   = questId ? (gs.quests || []).find(q => String(q.id) === String(questId)) : null;

    const finishBattle = () => {
      upd(p => {
        let nextQuests = p.quests || [];

        if (isVictory && questId) {
          nextQuests = nextQuests.map(q => String(q.id) === String(questId) ? { ...q, solved: true } : q);
          const allScenarioQuests = p.scenarioData?.quests || [];
          allScenarioQuests.forEach(scQ => {
            if (scQ.unlockType === "quest" && String(scQ.unlockQuestId) === String(questId)) {
              if (!nextQuests.find(nq => String(nq.id) === String(scQ.id))) {
                nextQuests.push({ ...scQ, revealed: true, solved: false, clues: 0 });
              }
            }
          });
        }

        const nextSessionPhase = (isVictory && isMass) ? "end" : "explore";
        const logLine = isVictory
          ? (isMass ? "🏆 最終決戦制覇！セッション終了！" : `🏆 弾幕ごっこ勝利！クエスト「${relatedQ?.name || ""}」が解決されました。`)
          : (isMass ? "💀 最終決戦敗北...セッション終了。" : "💀 弾幕ごっこ敗北...探索フェイズへ戻ります。");

        return {
          ...p,
          quests: nextQuests,
          sessionPhase: nextSessionPhase,
          battle: { ...p.battle, active: false },
          log: [logLine, ...p.log]
        };
      });
    };

    const borderColor = isVictory ? C.gold : C.red;
    const titleColor  = isVictory ? C.gold : C.red;
    const title       = isVictory
      ? (isMass ? "🏆 最終決戦制覇！" : "🎉 勝利！")
      : (isMass ? "💀 最終決戦敗北..." : "💀 敗北...");

    return (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#040608" }}>
        <div style={{ background: "#0c1020", border: `2px solid ${borderColor}`, padding: 36, borderRadius: 10, maxWidth: 480, width: "90%", textAlign: "center" }}>
          <div style={{ fontSize: 22, color: titleColor, fontWeight: "bold", marginBottom: 16, letterSpacing: 2 }}>{title}</div>

          {isVictory && !isMass && relatedQ && (
            <div style={{ marginBottom: 14, padding: "10px 14px", background: "rgba(200,160,64,0.1)", border: `1px solid ${C.goldDim}`, borderRadius: 6 }}>
              <div style={{ fontSize: 11, color: C.gold, marginBottom: 4 }}>クエスト解決</div>
              <div style={{ fontSize: 13, color: "#fff" }}>「{relatedQ.name}」</div>
            </div>
          )}

          {isVictory && isMass && (
            <div style={{ marginBottom: 14, fontSize: 12, color: C.textDim, lineHeight: 1.7 }}>
              全ての強敵を撃破しました。<br />セッションが終了します。
            </div>
          )}

          {!isVictory && (
            <div style={{ marginBottom: 14, fontSize: 12, color: C.textDim }}>
              {isMass ? "最終決戦に敗れました。セッションが終了します。" : "残念でした。探索フェイズへ戻ります。"}
            </div>
          )}

          {isGm ? (
            <button onClick={finishBattle}
              style={btnFull(isVictory ? C.goldBg : C.redBg, isVictory ? C.goldDim : C.redBorder, isVictory ? C.gold : C.red)}>
              {isMass ? "セッション終了" : "探索フェイズへ戻る"}
            </button>
          ) : (
            <div style={{ fontSize: 10, color: C.textDim }}>GMが戦闘を終了するのを待っています...</div>
          )}
        </div>
      </div>
    );
  }

  if (b.phase === "round_start") {
    const checkReset = () => {
      let nextActedPcs = b.actedPcs || [];
      let nextActedNpcs = b.actedNpcs || [];
      let logs = [];

      if (unactedPcs.length === 0 && alivePcs.length > 0) {
        nextActedPcs = [];
        logs.push("🔄 PC陣営が全員行動したため、全員未行動に戻ります。");
      }
      if (unactedNpcs.length === 0 && aliveNpcs.length > 0) {
        nextActedNpcs = [];
        logs.push("🔄 NPC陣営が全員行動したため、全員未行動に戻ります。");
      }
      
      if (logs.length > 0) {
        upd(p => ({
          ...p,
          battle: { ...p.battle, actedPcs: nextActedPcs, actedNpcs: nextActedNpcs },
          log: [...logs.reverse(), ...p.log]
        }));
      }
    };

    const startRound = (pcUid, npcId) => {
      const pcChar = pcs.find(p => p.uid === pcUid);
      const npcChar = npcs.find(n => n.id === npcId);
      const order = b.startOrder || "pc";
      const firstPhase = order === "npc" ? "npc_shot_intro" : "pc_shot_intro";

      upd(p => ({
        ...p,
        battle: {
          ...p.battle,
          phase: firstPhase,
          pcCombatant: pcUid,
          npcCombatant: npcId,
          usedIntervention: {},
          familiarAction: null,
          usedds: {},
          homingSelect: null,
          wideShotSelect: null,
          eraseSelect: null,
          highSpeedSelect: null,
          bigPowerSelect: null,
          slowBulletSelect: null,
          spellChoose: null,
          lastSpellUsed: null,
          pendingSpell: null,
          lastShotDice: null,
          supportDice: 0,
          log: [`⚔️ ラウンド開始：${npcChar.name} vs ${pcChar.charName} （先攻: ${order === "pc" ? "PC" : "NPC"}）`, ...p.log]
        }
      }));
    };

    return (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#040608" }}>
        <div style={{ background: "#0c1020", border: `1px solid ${C.goldDim}`, padding: 30, borderRadius: 8, maxWidth: 500, width: "90%" }}>
          <div style={{ fontSize: 16, color: C.gold, marginBottom: 20, textAlign: "center" }}>ラウンド {b.round}：対戦者選出</div>
          
          {!isGm ? (
            <div style={{ textAlign: "center", color: C.textDim }}>GMが対戦者を選出しています...</div>
          ) : (
            <div>
              <div style={{ fontSize: 11, color: C.textDim, marginBottom: 10 }}>1. 出撃するPCを選択</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
                {alivePcs.map(p => {
                  const isActed = (b.actedPcs || []).includes(p.uid);
                  const isSelected = b.tempSelectedPc === p.uid;
                  return (
                    <button 
                      key={p.uid}
                      onClick={() => upd(pState => ({ ...pState, battle: { ...pState.battle, tempSelectedPc: p.uid } }))}
                      style={btnFull(isSelected ? C.blueBg : "rgba(255,255,255,0.05)", isSelected ? C.blue : C.border, isSelected ? C.blue : (isActed ? C.textFaint : C.text))}
                    >
                      {p.charName} {isActed ? "(行動済)" : ""}
                    </button>
                  );
                })}
              </div>

              <div style={{ fontSize: 11, color: C.textDim, marginBottom: 10 }}>2. 迎え撃つNPCを選択</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                {aliveNpcs.map(n => {
                  const isActed = (b.actedNpcs || []).includes(n.id);
                  const isSelected = b.tempSelectedNpc === n.id;
                  return (
                    <button 
                      key={n.id}
                      onClick={() => upd(pState => ({ ...pState, battle: { ...pState.battle, tempSelectedNpc: n.id } }))}
                      style={btnFull(isSelected ? C.redBg : "rgba(255,255,255,0.05)", isSelected ? C.red : C.border, isSelected ? C.red : (isActed ? C.textFaint : C.text))}
                    >
                      {n.name} {isActed ? "(行動済)" : ""}
                    </button>
                  );
                })}
              </div>

              {b.pcCombatant && b.npcCombatant && (<>
                {renderSpellStep(true,  "round_start")}
                {renderSpellStep(false, "round_start")}
              </>)}

              <button 
                disabled={!b.tempSelectedPc || !b.tempSelectedNpc}
                onClick={() => startRound(b.tempSelectedPc, b.tempSelectedNpc)}
                style={btnFull(C.goldBg, C.goldDim, C.gold, { opacity: (b.tempSelectedPc && b.tempSelectedNpc) ? 1 : 0.3 })}
              >
                この対戦で開始する
              </button>
              
              {unactedPcs.length === 0 && (
                <button onClick={checkReset} style={{...btnFull("none", "none", C.textFaint), marginTop: 10}}>全員の未行動状態をリセットする</button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", background: "#040608", display: "flex", flexDirection: "column", padding: 20, boxSizing: "border-box", gap: 30 }}>
      <BattleDiceTray diceResult={gs.dice?.results} diceAnim={gs.dice?.rolling} label={gs.dice?.label} />
      
      <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", gap: 15, flexWrap: "wrap", borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: 20 }}>
        {npcs.map(n => {
          const isCombatant = b.npcCombatant === n.id;
          
          const isRecovery = b.phase === "npc_hit_recovery" && isCombatant;
          const isEvadeMove = b.phase === "npc_evade_move" && isCombatant;

          let highlights = [];
          if (isGm) {
            if (isRecovery) highlights = [1, 2, 3, 4, 5, 6];
            else if (isEvadeMove) highlights = getEvadeNeighbors(b.positions[n.id], b.wallPass);
          }

          return (
            <BattleGrid 
              key={n.id}
              name={n.name}
              isNpc={true}
              isCombatant={isCombatant}
              grid={b.grids?.[n.id]}
              pos={b.positions?.[n.id]}
              isDead={n.resources.残り人数?.cur <= 0}
              highlightCells={highlights}
              onCellClick={(num) => {
                if (isRecovery) {
                  handleRecovery(false, num);
                } else if (isEvadeMove) {
                  handleEvadeMove(false, num);
                }
              }}
              sprite={<div style={{ fontSize: 24 }}>👿</div>}
            />
          );
        })}
      </div>

      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 10, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ background: "#080a14", border: `1px solid ${C.goldDim}`, color: C.gold, padding: "4px 20px", borderRadius: 20, fontSize: 12, fontWeight: "bold", boxShadow: "0 0 20px rgba(0,0,0,0.8)" }}>
          {b.phase.toUpperCase()}
        </div>

        {(b.phase === "pc_shot_intro" || b.phase === "npc_shot_intro") && renderShotIntro(b.phase === "pc_shot_intro")}

        {(b.phase === "pc_shot_roll" || b.phase === "npc_shot_roll") && renderShotRoll(b.phase === "pc_shot_roll")}

        {(b.phase === "pc_shot_after" || b.phase === "npc_shot_after") && renderShotAfter(b.phase === "pc_shot_after")}

        {renderManualSpellControls()}

        {(b.phase === "pc_evade_intro" || b.phase === "npc_evade_intro") && renderEvadeIntro(b.phase === "pc_evade_intro")}

        {(b.phase === "pc_evade_move" || b.phase === "npc_evade_move") && renderEvadeMove(b.phase === "pc_evade_move")}

        {(b.phase === "pc_hit_check" || b.phase === "npc_hit_check") && renderHitCheck(b.phase === "pc_hit_check")}

        {(b.phase === "pc_hit_recovery" || b.phase === "npc_hit_recovery") && (
          <div style={{ background: "rgba(0,0,0,0.85)", padding: 15, borderRadius: 8, border: `1px solid ${C.gold}`, textAlign: "center" }}>
            <div style={{ color: C.gold, fontSize: 12, fontWeight: "bold", marginBottom: 4 }}>復帰位置を選択</div>
            <div style={{ color: "#fff", fontSize: 10 }}>好きなマスをクリックして復帰してください</div>
          </div>
        )}

        {(b.phase === "pc_dropout" || b.phase === "npc_dropout") && renderDropout(b.phase === "pc_dropout")}

        {b.phase === "cleanup" && (() => {
          const allNpcsDead = aliveNpcs.length === 0;
          const allPcsDead  = alivePcs.length === 0;

          if (allNpcsDead) return (
            <div style={{ background: "rgba(0,0,0,0.9)", padding: 20, borderRadius: 8, border: `2px solid ${C.gold}`, textAlign: "center" }}>
              <div style={{ color: C.gold, fontSize: 18, fontWeight: "bold", marginBottom: 10 }}>🎉 PC陣営の勝利！</div>
              <div style={{ color: "#fff", fontSize: 11, marginBottom: 16 }}>全ての敵を撃破しました。</div>
              {isGm && (
                <button
                  onClick={() => upd(p => ({ ...p, battle: { ...p.battle, phase: "result", result: "pc_win" } }))}
                  style={btnFull(C.goldBg, C.goldDim, C.gold)}
                >
                  結果画面へ
                </button>
              )}
              {!isGm && <div style={{ fontSize: 10, color: C.textDim }}>GMが戦闘を終了するのを待っています...</div>}
            </div>
          );

          if (allPcsDead) return (
            <div style={{ background: "rgba(0,0,0,0.9)", padding: 20, borderRadius: 8, border: `2px solid ${C.red}`, textAlign: "center" }}>
              <div style={{ color: C.red, fontSize: 18, fontWeight: "bold", marginBottom: 10 }}>💀 NPC陣営の勝利...</div>
              <div style={{ color: "#fff", fontSize: 11, marginBottom: 16 }}>全てのPCが脱落しました。</div>
              {isGm && (
                <button
                  onClick={() => upd(p => ({ ...p, battle: { ...p.battle, phase: "result", result: "npc_win" } }))}
                  style={btnFull(C.redBg, C.redBorder, C.red)}
                >
                  結果画面へ
                </button>
              )}
              {!isGm && <div style={{ fontSize: 10, color: C.textDim }}>GMが戦闘を終了するのを待っています...</div>}
            </div>
          );

          return (
            <div style={{ background: "rgba(0,0,0,0.85)", padding: 15, borderRadius: 8, border: `1px solid ${C.gold}`, textAlign: "center" }}>
              <div style={{ color: C.gold, fontSize: 12, fontWeight: "bold", marginBottom: 10 }}>ラウンド終了処理</div>
              <div style={{ color: "#fff", fontSize: 11, marginBottom: 6 }}>
                脱落者が出ましたが、戦闘は続きます。
              </div>
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 14 }}>
                残存PC: {alivePcs.length}人 ／ 残存NPC: {aliveNpcs.length}体
              </div>
              {isGm && (
                <button onClick={handleCleanup} style={btnFull(C.goldBg, C.goldDim, C.gold)}>
                  次ラウンドへ ⏭️
                </button>
              )}
              {!isGm && <div style={{ fontSize: 10, color: C.textDim }}>GMが次ラウンドを開始するのを待っています...</div>}
            </div>
          );
        })()}

        {b.phase === "round_end_check" && (
          <div style={{ background: "rgba(0,0,0,0.85)", padding: 15, borderRadius: 8, border: `1px solid ${C.gold}`, textAlign: "center" }}>
            <div style={{ color: C.gold, fontSize: 12, fontWeight: "bold", marginBottom: 10 }}>ラウンド終了確認</div>
            <div style={{ color: "#fff", fontSize: 11, marginBottom: 12 }}>敵の回避に成功しました。このラウンドを終了して次に進みます。</div>
            {/* ⚡ 低速弾（ラウンド終了時：弾幕を1マス分保護） */}
            {(() => {
              const pcId  = b.pcCombatant;
              const npcId = b.npcCombatant;
              const noSelect = !b.slowBulletSelect;
              const showPcSlow  = noSelect && (isGm || user.uid === pcId)  && hasOfficialSkill(combatantPc,  "低速弾") && !isDanmakuUsed(pcId,  "低速弾");
              const showNpcSlow = noSelect && isGm && hasOfficialSkill(combatantNpc, "低速弾") && !isDanmakuUsed(npcId, "低速弾");

              // 選択UI
              if (b.slowBulletSelect) {
                const sb = b.slowBulletSelect;
                const isOwner = isGm || user.uid === sb.ownerId;
                const targetGrid = b.grids?.[sb.targetId] || [0,0,0,0,0,0];
                if (!isOwner) return <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>🐌 相手が低速弾を選択中…</div>;
                return (
                  <div style={{ marginBottom: 10, padding: 10, background: "rgba(100,200,100,0.08)", border: `1px solid ${C.greenBorder}`, borderRadius: 5 }}>
                    <div style={{ fontSize: 10, color: C.green, marginBottom: 6 }}>🐌 低速弾 — 保護するマスを選んでください（count≥2 のマスのみ有効）</div>
                    <div style={{ display: "flex", gap: 5, justifyContent: "center", marginBottom: 5 }}>
                      {targetGrid.map((v, i) => {
                        const canProtect = (v || 0) >= 2;
                        return (
                          <button key={i} onClick={() => canProtect && confirmSlowBullet(i + 1)}
                            disabled={!canProtect}
                            style={{ width: 34, height: 34, background: canProtect ? "rgba(100,200,100,0.2)" : "rgba(255,255,255,0.02)", border: `1px solid ${canProtect ? C.greenBorder : C.border}`, borderRadius: 4, fontSize: 13, color: canProtect ? C.green : C.textFaint, cursor: canProtect ? "pointer" : "default" }}>
                            {i + 1}{v > 0 ? `(${v})` : ""}
                          </button>
                        );
                      })}
                    </div>
                    <button onClick={() => upd(p => ({ ...p, battle: { ...p.battle, slowBulletSelect: null } }))}
                      style={{ fontSize: 9, color: C.textFaint, background: "none", border: "none", cursor: "pointer" }}>キャンセル</button>
                  </div>
                );
              }

              return (showPcSlow || showNpcSlow) ? (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 4 }}>⚡ 弾幕スキル（ラウンド終了時）</div>
                  {showPcSlow && (
                    <button onClick={() => openSlowBulletSelect(pcId, npcId)}
                      style={{ ...btnFull("rgba(100,181,246,0.18)", C.blueBorder, C.blue), marginBottom: 4 }}>
                      🐌 低速弾（{combatantPc?.charName || ""}）
                    </button>
                  )}
                  {showNpcSlow && (
                    <button onClick={() => openSlowBulletSelect(npcId, pcId)}
                      style={{ ...btnFull("rgba(255,100,100,0.18)", C.redBorder, C.red), marginBottom: 4 }}>
                      🐌 低速弾（{combatantNpc?.name || ""}）
                    </button>
                  )}
                </div>
              ) : null;
            })()}

            {b.pendingSpell && (
              <div style={{ marginBottom: 12, padding: "8px 10px", background: "rgba(239,154,154,0.1)", border: "1px solid #c62828", borderRadius: 5 }}>
                <div style={{ fontSize: 11, color: "#ef9a9a", marginBottom: 4 }}>⏰ {b.pendingSpell.name} — ラウンド終了時の効果が発動します</div>
                <div style={{ fontSize: 9, color: C.textFaint, lineHeight: 1.5, marginBottom: 8 }}>{b.pendingSpell.text}</div>
                {b.pendingSpell.manual && (
                  <div style={{ fontSize: 9, color: "#5a6070", marginBottom: 6 }}>★ GMが手動で効果を処理してください</div>
                )}
                {isGm && (
                  <button onClick={applyPendingSpell} style={{ ...btnFull("rgba(239,154,154,0.2)", "#c62828", "#ef9a9a"), marginTop: 4 }}>
                    効果を適用して次へ
                  </button>
                )}
              </div>
            )}
            {(isGm || user.uid === b.pcCombatant) && !b.pendingSpell && !b.slowBulletSelect && (
              <button onClick={handleCleanup} style={btnFull(C.goldBg, C.goldDim, C.gold)}>次ラウンドへ ⏭️</button>
            )}
          </div>
        )}
      </div>

      <div style={{ flex: 1, display: "flex", justifyContent: "center", gap: 20 }}>
        {pcs.map(p => {
          const isCombatant = b.pcCombatant === p.uid;
          const isMyTurn = p.uid === user.uid || isGm;

          const isRecovery = b.phase === "pc_hit_recovery" && isCombatant;
          const isEvadeMove = b.phase === "pc_evade_move" && isCombatant;
          
          const currentPos = b.positions?.[p.uid];

          let highlights = [];
          if (isRecovery) highlights = [1, 2, 3, 4, 5, 6];
          else if (isEvadeMove) highlights = getEvadeNeighbors(b.positions[p.uid], b.wallPass);

          return (
            <BattleGrid 
              key={p.uid}
              name={p.charName}
              isCombatant={isCombatant}
              grid={b.grids?.[p.uid]}
              pos={currentPos}
              highlightCells={isMyTurn ? highlights : []}
              onCellClick={(num) => {
                if (isRecovery) handleRecovery(p.uid, num);
                else if (isEvadeMove) handleEvadeMove(true, num);
              }}
              sprite={
                p.customPortrait 
                  ? <img src={p.customPortrait} style={{ width: "90%", height: "90%", objectFit: "cover", borderRadius: "50%" }} />
                  : <CharSprite spriteRow={p.spriteRow} spriteCol={p.spriteCol} size={40} />
              }
            />
          );
        })}
      </div>
    </div>
  );
}

export function BonusPhaseView({ gs, upd, user, isGm, animateDice }) {
  const bonusStatus = gs.bonusStatus || {};
  const myRemaining = bonusStatus[user?.uid] || 0;
  const myPc = gs.pcs.find(p => p.uid === user?.uid);

  const [mode, setMode] = useState("select");
  
  const finishAction = (logMsg, pcUpdate = {}) => {
    upd(p => {
      const nextPcs = p.pcs.map(x => x.uid === user.uid ? { ...x, ...pcUpdate } : x);
      return {
        ...p,
        pcs: nextPcs,
        bonusStatus: { ...p.bonusStatus, [user.uid]: Math.max(0, p.bonusStatus[user.uid] - 1) },
        log: [logMsg, ...p.log]
      };
    });
    setMode("select");
  };

  const handleSpirit = () => {
    animateDice(1, "ボーナス霊力", res => {
      const gain = res[0];
      let nextRei = myPc.resources.霊力.cur;
      if (!(myPc.badStatus || []).includes("スランプ")) {
        nextRei = Math.min(myPc.resources.霊力.max, nextRei + gain);
      }
      const nextAtk = 1 + Math.floor(nextRei / 5);
      finishAction(`✨ ${myPc.charName} はボーナスで霊力を ${gain} 点獲得した`, {
        resources: { 
          ...myPc.resources, 
          霊力: { ...myPc.resources.霊力, cur: nextRei },
          攻撃力: { ...myPc.resources.攻撃力, cur: nextAtk }
        }
      });
    });
  };

  const handleItem = () => {
    animateDice(1, "ボーナスアイテム", res => {
      const items = ["お酒", "小銭", "お守り", "Pアイテム", "残機のかけら", "スペカのかけら"];
      const itemName = items[res[0] - 1];
      finishAction(`✨ ${myPc.charName} はボーナスで【${itemName}】を獲得した`, {
        items: { ...myPc.items, [itemName]: (myPc.items[itemName] || 0) + 1 }
      });
    });
  };

  const handleBond = (targetName, isClearCheck = false) => {
    let nextBonds = [...(myPc.bonds || [])];
    let logMsg = "";
    if (isClearCheck) {
      logMsg = `✨ ${myPc.charName} は《${targetName}への絆》の応援欄をリフレッシュした`;
    } else {
      if (!nextBonds.includes(targetName)) nextBonds.push(targetName);
      logMsg = `✨ ${myPc.charName} はボーナスで《${targetName}への絆》を獲得した`;
    }
    finishAction(logMsg, { bonds: nextBonds });
  };

  const startFinalBattle = () => {
    upd(p => ({
      ...p,
      sessionPhase: "battle",
      battle: p.initialBattle || p.battle,
      bonusStatus: null,
      initialBattle: null,
      log: ["⚔️ 全員の準備が整いました。最終決戦を開始します！", ...p.log]
    }));
  };

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#040608", padding: 20 }}>
      <div style={{ background: "#0c1020", border: `1px solid ${C.goldDim}`, padding: 30, borderRadius: 8, maxWidth: 500, width: "90%", textAlign: "center" }}>
        <div style={{ fontSize: 18, color: C.gold, marginBottom: 10, letterSpacing: 4 }}>解決ボーナス</div>
        <div style={{ fontSize: 11, color: C.textDim, marginBottom: 20 }}>リミットまで余裕があったため、追加行動が可能です。</div>

        {/* 全員の進捗 */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginBottom: 24 }}>
          {gs.pcs.map(p => (
            <div key={p.uid} style={{ padding: "4px 10px", background: "rgba(255,255,255,0.03)", border: `1px solid ${bonusStatus[p.uid] > 0 ? C.gold : C.border}`, borderRadius: 4 }}>
              <div style={{ fontSize: 10, color: bonusStatus[p.uid] > 0 ? C.gold : C.textFaint }}>{p.charName}</div>
              <div style={{ fontSize: 9, color: C.textDim }}>残り: {bonusStatus[p.uid] || 0}回</div>
            </div>
          ))}
        </div>

        {myRemaining > 0 ? (
          <div style={{ animation: "fadeUp 0.3s ease" }}>
            <div style={{ fontSize: 12, color: C.text, marginBottom: 16 }}>行動を選択してください（残り {myRemaining} 回）</div>
            
            {mode === "select" && (
              <div style={{ display: "grid", gap: 10 }}>
                <button onClick={handleSpirit} style={btnFull(C.purpleBg, C.purpleBorder, C.purple)}>① 霊力を獲得（1D6）</button>
                <button onClick={handleItem} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>② アイテム表を振る（1D6）</button>
                <button onClick={() => setMode("bond_target")} style={btnFull(C.goldBg, C.goldDim, C.gold)}>③ 絆の獲得 / 回復</button>
              </div>
            )}

            {mode === "bond_target" && (
              <div style={{ animation: "fadeUp 0.2s ease" }}>
                <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>対象となるPCを選択してください</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {gs.pcs.filter(p => p.uid !== user.uid).map(p => (
                    <button key={p.uid} onClick={() => handleBond(p.charName)} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text)}>
                      {p.charName} への絆
                    </button>
                  ))}
                  <button onClick={() => setMode("select")} style={{ ...btnFull("none", "none", C.textFaint), marginTop: 10 }}>戻る</button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ padding: "20px 0" }}>
            <div style={{ fontSize: 13, color: C.green }}>✓ あなたのボーナス処理は完了しました</div>
            <div style={{ fontSize: 10, color: C.textFaint, marginTop: 4 }}>他のプレイヤーを待っています...</div>
          </div>
        )}

        {isGm && (
          <div style={{ marginTop: 40, borderTop: `1px solid ${C.border}`, paddingTop: 20 }}>
            <button onClick={startFinalBattle} style={btnFull(C.redBg, C.redBorder, C.red)}>
              全員の処理を終了して決戦へ移行する
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SessionEndView ───────────────────────────────────────────────
export function SessionEndView({ gs, upd, isGm }) {
  const isVictory = gs.battle?.result === "pc_win";
  const pcs = gs.pcs || [];

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#040608" }}>
      <div style={{ background: "#0c1020", border: `2px solid ${isVictory ? C.gold : C.red}`, padding: 36, borderRadius: 10, maxWidth: 520, width: "90%", textAlign: "center" }}>
        <div style={{ fontSize: 24, color: isVictory ? C.gold : C.red, fontWeight: "bold", marginBottom: 8, letterSpacing: 4 }}>
          {isVictory ? "CLEAR" : "GAME OVER"}
        </div>
        <div style={{ fontSize: 13, color: C.textDim, marginBottom: 24 }}>
          {isVictory ? "最終決戦を制覇しました。セッション終了です。" : "最終決戦に敗れました。セッション終了です。"}
        </div>

        {/* PC一覧サマリー */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", marginBottom: 24 }}>
          {pcs.map(pc => {
            const lives = pc.resources?.残り人数?.cur ?? 0;
            const spells = pc.resources?.スペルカード?.cur ?? 0;
            const graze = pc.resources?.グレイズ?.cur ?? 0;
            const isDead = lives <= 0;
            return (
              <div key={pc.uid} style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${isDead ? C.redBorder : C.border}`, borderRadius: 6, padding: "10px 14px", minWidth: 100 }}>
                <div style={{ fontSize: 12, color: isDead ? C.red : C.text, fontWeight: "bold", marginBottom: 6 }}>{pc.charName}</div>
                <div style={{ fontSize: 10, color: C.textDim, lineHeight: 1.8 }}>
                  <div>残り人数: <span style={{ color: lives > 0 ? C.green : C.red }}>{lives}</span></div>
                  <div>スペカ: <span style={{ color: C.blue }}>{spells}</span></div>
                  <div>グレイズ: <span style={{ color: C.gold }}>{graze}</span></div>
                </div>
              </div>
            );
          })}
        </div>

        {isGm && (
          <button
            onClick={() => {
              if (window.confirm("セッションを終了しますか？ルームが閉じられます。")) {
                upd(p => ({ ...p, sessionPhase: "ended", log: ["📖 セッション終了。", ...p.log] }));
              }
            }}
            style={{ padding: "10px 24px", background: isVictory ? C.goldBg : C.redBg, border: `1px solid ${isVictory ? C.goldDim : C.redBorder}`, borderRadius: 6, color: isVictory ? C.gold : C.red, fontSize: 13, cursor: "pointer", letterSpacing: 1 }}
          >
            セッション終了
          </button>
        )}
        {!isGm && <div style={{ fontSize: 10, color: C.textDim }}>GMがセッションを終了するのを待っています...</div>}
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
  const [itemModal, setItemModal]   = useState(null);
  const [skillModal, setSkillModal] = useState(null);
  const [expanded, setExpanded]     = useState(false);
  const [gmEdit, setGmEdit]         = useState(false);

  const resources     = pc.resources || INIT_RESOURCES();
  const items         = pc.items     || INIT_ITEMS();
  const badStatus     = pc.badStatus || [];
  const skill         = pc.ps || null;
  const isCustomChar  = pc.charId?.startsWith("custom_");
  const hasActed      = (gs.actedPcs ||[]).includes(pc.uid);
  const isActing      = gs.currentScene?.pcUid === pc.uid;
  const skillCanActivate = skill && skill.type !== "オート";
  const currentSpotName  = getSpot(pc.currentSpot)?.name || "-";

  const useItem = itemName => {
    const data = ITEM_DATA[itemName];
    if (!data) return;
    onUpdatePc(data.use(pc, gs));
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

  const resKeys  =["やる気", "残り人数", "スペルカード", "グレイズ", "霊力", "攻撃力"];
  const itemKeys = Object.keys(INIT_ITEMS());

  return (
    <div style={{ border: `1px solid ${isActing ? C.blue : expanded ? "#2a3545" : C.border}`, borderRadius: 5, marginBottom: 6, overflow: "hidden", transition: "border 0.2s" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", cursor: "pointer", background: isActing ? C.blueBg : expanded ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.01)" }} onClick={() => setExpanded(v => !v)}>
        <CharSprite spriteRow={pc.spriteRow ?? -1} spriteCol={pc.spriteCol ?? -1} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pc.charName}</span>
            {isActing ? <span style={{ fontSize: 9, color: C.blue }}>▶ シーン進行中</span> : hasActed ? <span style={{ fontSize: 9, color: C.textFaint }}>✓ 行動済み</span> : <span style={{ fontSize: 9, color: C.gold }}>未行動</span>}
          </div>
          <div style={{ fontSize: 9, color: C.textFaint }}>
            {(pc.tags || []).length > 0 && `《${pc.tags.join("》《")}》`}
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
          {pc.as && (
            <div style={{ marginTop: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ padding: "1px 6px", background: `${SKILL_TYPE_COLOR[pc.as.type] || "#90caf9"}18`, border: `1px solid ${SKILL_TYPE_COLOR[pc.as.type] || "#90caf9"}50`, borderRadius: 8, fontSize: 8, color: SKILL_TYPE_COLOR[pc.as.type] || "#90caf9" }}>{pc.as.type}</span>
                <span style={{ fontSize: 11, color: "#90caf9" }}>《{pc.as.name}》</span>
              </div>
              <div style={{ fontSize: 9, color: C.textFaint, lineHeight: 1.7, marginBottom: 6 }}>{pc.as.desc}</div>
              {pc.as.type !== "オート" && !isCustomChar && <button onClick={() => setSkillModal({ name: pc.as.name, type: pc.as.type, desc: pc.as.desc, key: "ability" })} style={{ padding: "4px 12px", cursor: "pointer", borderRadius: 3, fontSize: 10, background: "rgba(144,202,249,0.15)", border: "1px solid #1565c080", color: "#90caf9" }}>発動する</button>}
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

          {gs.cycleIdx === 3 && (
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
          <button onClick={() => animateDice(1, "アイテム獲得", res => {
            const itemName = ITEM_NAMES[res[0] - 1];
            proceed([`${pc.charName} は【${itemName}】を ${count} 個獲得した`], {
              pc: { items: { ...pc.items, [itemName]: (pc.items[itemName] || 0) + count } }
            });
          })} style={btnFull(C.goldBg, C.goldDim, C.gold)}>🎲 ランダムなアイテムを獲得</button>
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
            const bonds = Array.from(new Set([...(pc.bonds || []), `${pc.charName}への絆`]));
            proceed([`${pc.charName} は自身への絆を獲得した`], { pc: { bonds } });
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
              const bonds = Array.from(new Set([...(pc.bonds || []), `${o.charName || o.name}への絆`]));
              proceed([`${pc.charName} は《${o.charName || o.name}への絆》を獲得した`], { pc: { bonds } });
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
            const bonds = Array.from(new Set([...(pc.bonds || []), `${selectedLose}への絆`]));
            proceed([`${pc.charName} は《${selectedLose}への絆》を獲得した`], { pc: { bonds } });
          }} style={btnFull(selectedLose ? C.goldBg : "rgba(255,255,255,0.05)", C.border, selectedLose ? C.gold : C.textFaint)}>獲得する</button>
        </div>
      );
    }

    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
        <button onClick={() => {
          const bonds = Array.from(new Set([...(pc.bonds || []), `${act.target}への絆`]));
          proceed([`${pc.charName} は《${act.target}への絆》を獲得した`], { pc: { bonds } });
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
                extraPc.bonds = Array.from(new Set([...(pc.bonds || []), `${o.charName || o.name}への絆`]));
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
  const endScene = ()  => upd(p => ({ ...p, actedPcs:[...(p.actedPcs || []), pc.uid], currentScene: null, log:[`${pc.charName} のシーンを終了した`, ...p.log] }));

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
            logs.push(`${pc.charName} は手がかりを [${spotId}] ${getSpot(spotId)?.name} に配置した（出目: ${d1}, ${d2}）`);
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
      const isDebuffed = (x.badStatus || []).includes("だるい");
      const newPcs = p.pcs.map(y =>
        y.uid !== pc.uid ? y
        : isDebuffed ? y
        : { ...y, resources: { ...y.resources, やる気: { ...r, cur: Math.min(r.max, r.cur + 1) } } }
      );
      const logText = isDebuffed
        ? `${pc.charName} はその場にとどまったが、変調《だるい》のためやる気は回復しなかった`
        : `${pc.charName} はその場にとどまり、やる気を1点回復した`;
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
      let logAdd = `${pc.charName} は移動ダイスで「${val}」を選んだ`;

      if (val === 6) {
        return { ...p, currentScene: { ...p.currentScene, phase: "happening_roll" }, log: [logAdd + "（ハプニング発生！）", ...p.log] };
      }
      let actualVal = val;
      if ((pc.badStatus || []).includes("疲れた")) {
        actualVal = Math.max(0, val - 1);
        logAdd += `（※変調《疲れた》のため移動距離が ${actualVal} に減少）`;
      }
      if (p.newspaper?.roll === 24) {
        actualVal = Math.max(0, actualVal - 1);
        logAdd += `（※新聞[24:雨模様]のため減少）`;
      }
      return { ...p, currentScene: { ...p.currentScene, phase: "move_dest", selectedMoveDie: actualVal }, log: [logAdd, ...p.log] };
    });
  };

  const confirmMove = () => {
    if (!sc.selectedDestSpot) return;
    const dest = sc.selectedDestSpot;
    const sDetail = SPOTS.find(s => s.id === dest);

    const isMountain = sDetail?.area === "妖怪の山" && dest !== "22";
    const isHuman = (pc.tags || []).includes("人間");
    const news26 = gs.newspaper?.roll === 26 && isHuman && isMountain;
    const news35 = gs.newspaper?.roll === 35 && dest === gs.newspaper.targetSpot;
    if (news26 || news35) {
      animateDice(1, "霊力減少ペナルティ", res => {
        const dmg = res[0];
        upd(p => {
          const r = pc.resources.霊力 || { cur: 0, max: 20 };
          const nextRei = Math.max(0, r.cur - dmg);
          const pcs = p.pcs.map(x => x.uid === pc.uid ? {
            ...x,
            currentSpot: dest,
            resources: { ...x.resources, 霊力: { ...r, cur: nextRei }, 攻撃力: { ...x.resources.攻撃力, cur: 1 + Math.floor(nextRei / 5) } }
          } : x);
          const reason = news26 ? "《人間》の妖怪の山侵入ペナルティ(新聞26)" : "凶暴化した妖精の襲撃(新聞35)";
          return { ...p, pcs, currentScene: { ...p.currentScene, phase: "action" }, log:[`${pc.charName} は [${sDetail.name}] に移動したが、${reason}で霊力が ${dmg} 点減少した！`, ...p.log] };
        });
      });
    } else {
      upd(p => {
        const pcs   = p.pcs.map(x => x.uid === pc.uid ? { ...x, currentSpot: dest } : x);
        return { ...p, pcs, currentScene: { ...p.currentScene, phase: "action" }, log:[`${pc.charName} は [${sDetail?.name}] に移動した`, ...p.log] };
      });
    }
  };

  const startExplore = () => {
    if (gs.newspaper?.roll === 15 && pc.currentSpot === "15") {
      const r = pc.resources.やる気 || { cur: 0, max: 3 };
      upd(p => {
        const newPcs = p.pcs.map(x => x.uid === pc.uid ? { ...x, resources: { ...x.resources, やる気: { ...r, cur: r.max } } } : x);
        return { ...p, pcs: newPcs, log: [`${pc.charName} は間欠泉地下センターの足湯でやる気をMAXまで回復した！`, ...p.log] };
      });
    }

    const hasTag    = spotDetail.tags.some(t => (pc.tags || []).includes(t) || pc.charName === t || (pc.ps && pc.ps.name === t));
    let diceCount   = 2 + (hasTag ? 1 : 0);
    if ((pc.badStatus || []).includes("怪我")) diceCount = Math.min(2, diceCount);
    
    upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "explore_select", actionDiceCount: diceCount, hasTagBonus: hasTag } }));
  };

  const selectEvent  = ev  => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "explore_roll", selectedEvent: ev } }));
  const rollExplore  = ()  => animateDice(sc.actionDiceCount || 2, "行為判定", res => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "explore_result", actionDice: res } })));

  const acquireClue = questId => {
    upd(p => {
      const spotId   = pc.currentSpot;
      const newClues = (p.clues ||[]).filter(c => c !== spotId);

      let resolvedAuto = false;
      let nextQuests = p.quests.map(q => {
        if (String(q.id) === String(questId)) {
          const updatedClues = (q.clues || 0) + 1;
          const isReady = updatedClues >= q.level;
          if (q.solutionType === "自動解決" && isReady) {
            resolvedAuto = true;
            return { ...q, clues: updatedClues, solved: true };
          }
          return { ...q, clues: updatedClues };
        }
        return q;
      });

      if (resolvedAuto) {
        const allScenarioQuests = p.scenarioData?.quests || [];
        allScenarioQuests.forEach(scQ => {
          if (scQ.unlockType === "quest" && String(scQ.unlockQuestId) === String(questId)) {
            if (!nextQuests.find(nq => String(nq.id) === String(scQ.id))) {
              nextQuests.push({ ...scQ, revealed: true, solved: false, clues: 0 });
            }
          }
        });
      }

      const targetQName = nextQuests.find(q => String(q.id) === String(questId))?.name;
      const logMsg = `${pc.charName} は [${spotId}] で手がかりを獲得し、クエスト「${targetQName}」に配置した` + 
        (resolvedAuto ? "。クエストが自動解決されました！" : "");

      return { 
        ...p, 
        clues: newCluesOnSpots, 
        quests: nextQuests, 
        currentScene: { ...p.currentScene, phase: "action_done" }, 
        log: [logMsg, ...p.log] 
      };
    });
  };

  const hasClueHere = gs.clues?.includes(pc.currentSpot);

  const gainBond = targetName => {
    if ((pc.badStatus || []).includes("不機嫌")) {
      writeLog(`${pc.charName} は変調《不機嫌》のため絆を獲得できなかった`);
      return;
    }
    const targetPc = gs.pcs.find(p => p.charName === targetName);
    if (targetPc && (targetPc.badStatus || []).includes("不機嫌")) {
      writeLog(`${targetName} が変調《不機嫌》のため絆を獲得できなかった`);
      return;
    }

    upd(p => {
      const newPcs = p.pcs.map(x => {
        if (x.uid === pc.uid) {
          const bonds = [...(x.bonds || [])];
          if (!bonds.includes(targetName)) bonds.push(targetName);
          return { ...x, bonds };
        }
        if (p.newspaper?.roll === 34 && x.charName === targetName) {
          const bonds =[...(x.bonds || [])];
          if (!bonds.includes(pc.charName)) bonds.push(pc.charName);
          return { ...x, bonds };
        }
        return x;
      });
      return { ...p, pcs: newPcs, currentScene: { ...p.currentScene, phase: "action_done" }, log:[`${pc.charName} は《${targetName}への絆》を獲得した` + (p.newspaper?.roll === 34 ? `（新聞効果で双方向に獲得！）` : ""), ...p.log] };
    });
  };

  return (
    <div style={{ padding: 10, background: "rgba(25,118,210,0.1)", borderBottom: `1px solid ${C.blueBorder}`, flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <CharSprite spriteRow={pc.spriteRow ?? -1} spriteCol={pc.spriteCol ?? -1} size={32} />
        <div>
          <div style={{ fontSize: 10, color: C.blue }}>現在のシーンプレイヤー</div>
          <div style={{ fontSize: 13, color: C.text }}>
            {pc.charName} <span style={{ fontSize: 9, color: C.textFaint }}>@ {getSpot(pc.currentSpot)?.name}</span>
          </div>
        </div>
      </div>

      {!isMyTurn ? (
        <div style={{ fontSize: 11, color: C.textFaint, textAlign: "center", padding: "8px 0" }}>{pc.charName} の操作を待っています…</div>
      ) : (
        <div>
          {sc.phase === "move_or_stay" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={chooseMove} style={btnFull(C.blueBg,  C.blueBorder,  C.blue)}>移動する（やる気D）</button>
                <button onClick={chooseStay} style={btnFull(C.greenBg, C.greenBorder, C.green)}>とどまる（やる気+1）</button>
              </div>

              {(gs.quests || []).filter(q => !q.solved && q.revealed && (q.clues || 0) >= q.level).map(q => (
                <button 
                  key={q.id} 
                  onClick={() => {
                    const loc = q.location || pc.currentSpot;
                    upd(p => {
                      const newPcs = p.pcs.map(x => x.uid === pc.uid ? { ...x, currentSpot: loc } : x);
                      return {
                        ...p,
                        pcs: newPcs,
                        currentScene: { 
                          ...p.currentScene, 
                          phase: "quest_setup", 
                          questId: q.id,
                          questLocation: loc 
                        },
                        log: [`🎬 ${pc.charName} はクエスト「${q.name}」の解決に向かった！`, ...p.log]
                      };
                    });
                  }}
                  style={btnFull(C.goldBg, C.goldDim, C.gold, { marginTop: 4, fontWeight: "bold" })}
                >
                  ✨ クエストシーン：{q.name}
                </button>
              ))}
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
              {sc.moveDice.includes(6) && (
                <div style={{ fontSize: 10, color: C.red, textAlign: "center", marginTop: 4 }}>※6を選ぶとハプニングが発生します（お守りで回避可能）</div>
              )}
            </div>
          )}

          {sc.phase === "happening_roll" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 14, color: C.red, marginBottom: 8, fontWeight: "bold" }}>⚠️ ハプニング発生！</div>

              {pc.items?.["お守り"] > 0 && !(pc.badStatus || []).includes("二日酔い") && (
                <button onClick={() => {
                  upd(p => {
                    const nextPc = { ...pc, items: { ...pc.items, お守り: pc.items["お守り"] - 1 } };
                    return {
                      ...p,
                      pcs: p.pcs.map(x => x.uid === pc.uid ? nextPc : x),
                      currentScene: { ...p.currentScene, phase: "move_dest", exactMoveDist: null, selectedMoveDie: 6 },
                      log: [`${pc.charName} はお守りを使用し、ハプニングを無効化して6マス移動を選択した！`, ...p.log]
                    };
                  });
                }} style={{ ...btnFull("rgba(76,175,80,0.15)", C.greenBorder, C.green, { marginBottom: 12 }) }}>
                  🛡️ お守りを使用する（残り: {pc.items["お守り"]}）
                </button>
              )}

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
                upd(p => { const pcs = p.pcs.map(x => x.uid === pc.uid ? { ...x, currentSpot: pc.baseSpotId } : x); return { ...p, pcs, currentScene: { ...p.currentScene, phase: "action" }, log:[`${pc.charName} は強制的に拠点へ移動した`, ...p.log] }; });
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
                  upd(p => { const pcs = p.pcs.map(x => x.uid === pc.uid ? { ...x, currentSpot: other.currentSpot } : x); return { ...p, pcs, currentScene: { ...p.currentScene, phase: "action" }, log:[`${pc.charName} は ${other.name} と合流した`, ...p.log] }; });
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
                  return { ...p, pcs: newPcs, currentScene: { ...p.currentScene, phase: "action" }, log:[`${pc.charName} は道に迷い [${getSpot(nextSpotId)?.name}] に辿り着いた`, ...p.log] };
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
              {gs.newspaper?.roll === 13 && pc.currentSpot === "13" && (
                <button onClick={() => {
                  upd(p => {
                    const newPcs = p.pcs.map(x => x.uid === pc.uid ? { ...x, flags: { ...x.flags, kourindouNPC: true } } : x);
                    return { ...p, pcs: newPcs, currentScene: { ...p.currentScene, phase: "action_done" }, log: [`${pc.charName} はアクションを消費し、香霖堂のNPCの応援を取り付けた！`, ...p.log] };
                  });
                }} style={btnFull(C.purpleBg, C.purpleBorder, C.purple)}>🤝 香霖堂の新商品を見る（NPCの応援獲得）</button>
              )}

              {gs.newspaper?.roll === 45 && pc.currentSpot === "45" && (
                <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "gamble_select_item" } }))} style={btnFull(C.redBg, C.redBorder, C.red)}>🎲 鬼の賭博に挑戦</button>
              )}

              <button onClick={() => writeLog(`${pc.charName} はアクションスキルを使用した`)} style={btnFull("rgba(255,255,255,0.05)", C.border, C.textFaint)}>💡 アクションスキルの使用</button>
              <div style={{ marginTop: 8 }}>
                <button onClick={endScene} style={btnFull(C.redBg, C.redBorder, C.red)}>🎬 このシーンを終了する</button>
              </div>
            </div>
          )}

          {sc.phase === "gamble_select_item" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: C.gold, marginBottom: 8 }}>消費するアイテムを選んでください</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center", marginBottom: 12 }}>
                {Object.keys(INIT_ITEMS()).map(k => {
                  if ((pc.items[k] || 0) === 0) return null;
                  return (
                    <button key={k} onClick={() => {
                      upd(p => {
                        const newPcs = p.pcs.map(x => x.uid === pc.uid ? { ...x, items: { ...x.items, [k]: x.items[k] - 1 } } : x);
                        return { ...p, pcs: newPcs, currentScene: { ...p.currentScene, phase: "gamble_roll", gambleItem: k, gambleDiceCount: 2 } };
                      });
                    }} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text, { width: "auto" })}>{k}を消費</button>
                  );
                })}
              </div>
              <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "action" } }))} style={btnFull("none", "none", C.textFaint)}>戻る</button>
            </div>
          )}
          {sc.phase === "gamble_roll" && (
            <div style={{ textAlign: "center" }}>
              {pc.items?.["小銭"] > 0 && !(pc.badStatus || []).includes("二日酔い") && (
                <button onClick={() => {
                  upd(p => {
                    const nextCount = (p.currentScene.gambleDiceCount || 2) + 1;
                    const nextPc = { ...pc, items: { ...pc.items, 小銭: pc.items["小銭"] - 1 } };
                    return {
                      ...p,
                      pcs: p.pcs.map(x => x.uid === pc.uid ? nextPc : x),
                      currentScene: { ...p.currentScene, gambleDiceCount: nextCount },
                      log: [`${pc.charName} は小銭を使用し、判定ダイスを1つ増やした！`, ...p.log]
                    };
                  });
                }} style={{ ...btnFull("rgba(200,160,64,0.15)", C.goldDim, C.gold, { marginBottom: 12 }) }}>
                  💰 小銭を使用する（残り: {pc.items["小銭"]}）
                </button>
              )}

              <button onClick={() => animateDice(sc.gambleDiceCount || 2, "賭博の判定", res => {
                const max = Math.max(...res);
                const isFumble = res.every(d => d === 1);
                const success = max >= 6 && !isFumble;
                upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "gamble_result", gambleDice: res, gambleSuccess: success } }));
              })} style={btnFull(C.redBg, C.redBorder, C.red)}>🎲 {sc.gambleDiceCount || 2}D:6で勝負する</button>
            </div>
          )}
          {sc.phase === "gamble_result" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 8 }}>
                {sc.gambleDice?.map((d, i) => <div key={i} style={{ width: 36, height: 36, border: "1px solid #e07060", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{d}</div>)}
              </div>
              <div style={{ fontSize: 16, color: sc.gambleSuccess ? C.green : C.red, marginBottom: 12 }}>
                {sc.gambleSuccess ? "成功！ アイテムを3つ獲得できます" : "失敗… アイテムを失った"}
              </div>
              {sc.gambleSuccess ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center" }}>
                  {["お酒", "小銭", "お守り", "Pアイテム", "残機のかけら", "スペカのかけら"].map(k => (
                    <button key={k} onClick={() => {
                        gainItem(k, 1);
                        const count = (sc.gambleRewards || 0) + 1;
                        if (count >= 3) upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "action_done" } }));
                        else upd(p => ({ ...p, currentScene: { ...p.currentScene, gambleRewards: count } }));
                    }} style={btnFull("rgba(200,160,64,0.1)", C.goldDim, C.gold, { width: "auto" })}>+ {k}</button>
                  ))}
                  <div style={{ width: "100%", fontSize: 9, color: C.textDim, marginTop: 4 }}>残り獲得数: {3 - (sc.gambleRewards || 0)}</div>
                </div>
              ) : (
                <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "action_done" }, log: [`${pc.charName} は賭博に敗北した`, ...p.log] }))} style={btnFull("rgba(255,255,255,0.05)", C.border, C.textFaint)}>終了</button>
              )}
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
                  if ((pc.badStatus || []).includes("怪我")) next = Math.min(2, next);
                  upd(p => ({ ...p, currentScene: { ...p.currentScene, actionDiceCount: next } }));
                }} style={btnSmall}>+</button>
              </div>

              {pc.items?.["小銭"] > 0 && !(pc.badStatus || []).includes("二日酔い") && (
                <button onClick={() => {
                  upd(p => {
                    const nextCount = (p.currentScene.actionDiceCount || 2) + 1;
                    const nextPc = { ...pc, items: { ...pc.items, 小銭: pc.items["小銭"] - 1 } };
                    return {
                      ...p,
                      pcs: p.pcs.map(x => x.uid === pc.uid ? nextPc : x),
                      currentScene: { ...p.currentScene, actionDiceCount: nextCount },
                      log: [`${pc.charName} は小銭を使用し、判定ダイスを1つ増やした！`, ...p.log]
                    };
                  });
                }} style={{ ...btnFull("rgba(200,160,64,0.15)", C.goldDim, C.gold, { marginBottom: 12 }) }}>
                  💰 小銭を使用する（残り: {pc.items["小銭"]}）
                </button>
              )}

              <button onClick={rollExplore} style={btnFull(C.goldBg, C.goldDim, C.gold)}>🎲 判定ダイスを振る</button>
            </div>
          )}

          {sc.phase === "special_cure" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 13, color: C.gold, marginBottom: 14, fontWeight: "bold" }}>🌿 解除する変調を選択</div>
              {(pc.badStatus || []).map(bs => (
                <button key={bs} onClick={() => {
                  upd(p => {
                    const newBs  = pc.badStatus.filter(x => x !== bs);
                    const newPcs = p.pcs.map(x => x.uid === pc.uid ? { ...x, badStatus: newBs } : x);
                    return { ...p, pcs: newPcs, currentScene: { ...p.currentScene, phase: "explore_result", specialResolved: true }, log:[`${pc.charName} は変調《${bs}》を解除した`, ...p.log] };
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
                          const gain    = (pc.badStatus || []).includes("スランプ") ? 0 : res[0];
                          const nextCur = Math.min(pc.resources.霊力.max, (pc.resources.霊力.cur || 0) + gain);
                          const newPcs  = p.pcs.map(x => x.uid !== pc.uid ? x : { ...x, resources: { ...x.resources, 霊力: { ...x.resources.霊力, cur: nextCur }, 攻撃力: { ...x.resources.攻撃力, cur: 1 + Math.floor(nextCur / 5) } } });
                          return { ...p, pcs: newPcs, currentScene: { ...p.currentScene, specialResolved: true }, log:[`${pc.charName} は霊力を ${gain} 点回復した`, ...p.log] };
                        });
                      })} style={btnFull(C.goldBg, C.goldDim, C.gold, { fontSize: 10 })}>霊力回復 (1D6)</button>
                      {(pc.badStatus || []).length > 0 && <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "special_cure" } }))} style={btnFull(C.blueBg, C.blueBorder, C.blue, { fontSize: 10 })}>変調解除</button>}
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
                        return { ...p, pcs: newPcs, currentScene: { ...p.currentScene, fumbleResolved: true, fumbleStatus: bsName }, log:[`${pc.charName} は変調《${bsName}》を獲得した`, ...p.log] };
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
                          isSuccess
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
            const unrevealedQuests = gs.quests?.filter(q => !q.solved && q.revealed);
            const isNoAvailableQuestSlots = unrevealedQuests.length === 0 || unrevealedQuests.every(q => (q.clues || 0) >= q.level);
            const useClueEvents = room.config?.useClueEvents;
            
            if (sc.isSuccess) {
              if (hasClueHere) {
                return (
                  <div style={{ padding: 8, background: "rgba(0,229,255,0.1)", border: "1px solid #00e5ff60", borderRadius: 4 }}>
                    <div style={{ fontSize: 10, color: "#00e5ff", marginBottom: 6 }}>💡 手がかりを獲得！</div>

                    {unrevealedQuests.filter(q => (q.clues || 0) < q.level).map(q => (
                      <button key={q.id} onClick={() => acquireClue(q.id)} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text, { fontSize: 10, marginBottom: 4 })}>「{q.name}」</button>
                    ))}

                    {useClueEvents && isNoAvailableQuestSlots && (
                      <button onClick={() => animateDice(1, "手がかりイベント表", res => {
                        upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "clue_event_result", clueEventDice: res[0] } }));
                      })} style={btnFull(C.purpleBg, C.purpleBorder, C.purple, { marginTop: 4 })}>
                        📜 手がかりイベント表を振る
                      </button>
                    )}

                    <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "action_done" } }))} style={{ ...btnFull("none", "none", C.textFaint), marginTop: 8 }}>配置せず終了</button>
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

          {sc.phase === "quest_setup" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: C.gold, marginBottom: 12 }}>
                仲間の合流を待っています...<br/>
                <span style={{ fontSize: 9, color: C.textDim }}>（他のプレイヤーの画面に合流ボタンが表示されています）</span>
              </div>

              {isGm && (
                <button 
                  onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "quest_resolve" } }))}
                  style={btnFull(C.blueBg, C.blueBorder, C.blue)}
                >
                  全員揃ったので解決に進む
                </button>
              )}
            </div>
          )}

          {sc.phase === "quest_resolve" && (() => {
            const q = gs.quests?.find(x => x.id === sc.questId);
            return (
              <div style={{ textAlign: "center", animation: "fadeUp 0.3s ease" }}>
                <div style={{ fontSize: 13, color: C.gold, marginBottom: 8 }}>クエスト「{q?.name}」の解決</div>
                
                {isGm && (
                  <div style={{ marginTop: 16 }}>
                    {q?.solutionType === "自動解決" && (
                      <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "quest_done", isSuccess: true } }))} style={btnFull(C.greenBg, C.greenBorder, C.green)}>
                        自動解決でクリア！
                      </button>
                    )}
                    {q?.solutionType === "行為判定" && (
                      <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "quest_roll", rolls: {} } }))} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>
                        行為判定を開始する
                      </button>
                    )}
                    {q?.solutionType === "弾幕ごっこ" && (
                      <div style={{ fontSize: 11, color: C.red }}>弾幕ごっこは未実装です</div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {sc.phase === "quest_roll" && (() => {
            const q = gs.quests?.find(x => x.id === sc.questId);
            const pcsHere = gs.pcs.filter(p => p.currentSpot === sc.questLocation);
            const myPc = pcsHere.find(p => p.uid === user?.uid);
            
            const myRoll = sc.rolls?.[user?.uid];
            const anySuccess = Object.values(sc.rolls || {}).some(r => r.success);
            const allRolled = pcsHere.every(p => sc.rolls?.[p.uid]);
            
            const hasTag = myPc && q?.specifiedTag && q.specifiedTag.split(/[、,]/).some(t => (myPc.tags ||[]).includes(t.trim()) || myPc.charName === t.trim() || (myPc.ps && myPc.ps.name === t.trim()));
            const baseDice = 2 + (hasTag ? 1 : 0);
            const myDiceCount = sc.diceCounts?.[user?.uid] || baseDice;

            return (
              <div style={{ animation: "fadeUp 0.3s ease" }}>
                <div style={{ textAlign: "center", marginBottom: 12 }}>
                  <div style={{ fontSize: 13, color: C.gold }}>クエスト判定（目標値: 4）</div>
                  {q?.specifiedTag && <div style={{ fontSize: 10, color: C.textDim }}>指定タグ: {q.specifiedTag} {hasTag && <span style={{color: C.green}}>ボーナス適用！</span>}</div>}
                </div>

                <div style={{ display: "grid", gap: 6, marginBottom: 16 }}>
                  {pcsHere.map(p => {
                    const r = sc.rolls?.[p.uid];
                    return (
                      <div key={p.uid} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, borderRadius: 4 }}>
                        <div style={{ fontSize: 11, color: C.text }}>{p.charName}</div>
                        <div style={{ fontSize: 11, color: r ? (r.success ? C.green : C.red) : C.textFaint }}>
                          {r ? (r.success ? `成功 (${r.dice.join(", ")})` : `失敗 (${r.dice.join(", ")})`) : "待機中..."}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {!myRoll && myPc && !anySuccess && (
                  <div style={{ textAlign: "center", padding: 10, background: "rgba(0,0,0,0.2)", borderRadius: 6, border: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 11, color: C.text, marginBottom: 8 }}>あなたの判定ダイス: <span style={{color:C.gold, fontSize:14}}>{myDiceCount}</span> 個</div>
                    
                    <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 12 }}>
                      <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, diceCounts: { ...(p.currentScene.diceCounts||{}), [user.uid]: Math.max(1, myDiceCount - 1) } } }))} style={btnSmall}>-</button>
                      <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, diceCounts: { ...(p.currentScene.diceCounts||{}), [user.uid]: myDiceCount + 1 } } }))} style={btnSmall}>+</button>
                    </div>

                    {myPc.items?.["小銭"] > 0 && !(myPc.badStatus || []).includes("二日酔い") && (
                      <button onClick={() => {
                        upd(p => {
                          const nextCount = myDiceCount + 1;
                          const nextPc = { ...myPc, items: { ...myPc.items, 小銭: myPc.items["小銭"] - 1 } };
                          return {
                            ...p,
                            pcs: p.pcs.map(x => x.uid === myPc.uid ? nextPc : x),
                            currentScene: { ...p.currentScene, diceCounts: { ...(p.currentScene.diceCounts||{}), [user.uid]: nextCount } },
                            log: [`${myPc.charName} は小銭を使用し、クエスト判定のダイスを増やした！`, ...p.log]
                          };
                        });
                      }} style={{ ...btnFull("rgba(200,160,64,0.15)", C.goldDim, C.gold, { marginBottom: 10 }) }}>
                        💰 小銭を使用する（残り: {myPc.items["小銭"]}）
                      </button>
                    )}

                    <button onClick={() => animateDice(myDiceCount, "クエスト判定", res => {
                      const max = Math.max(...res);
                      const isFumble = res.every(d => d === 1);
                      const success = max >= 4 && !isFumble;
                      upd(p => ({
                        ...p,
                        currentScene: { ...p.currentScene, rolls: { ...(p.currentScene.rolls||{}), [user.uid]: { dice: res, success } } },
                        log: [`${myPc.charName} はクエスト「${q?.name}」の判定で ${res.join(", ")} を出し、${success ? "成功" : "失敗"}した！`, ...p.log]
                      }));
                    })} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>
                      🎲 行為判定を行う
                    </button>
                  </div>
                )}

                {anySuccess && isGm && (
                  <div style={{ textAlign: "center", marginTop: 16 }}>
                    <div style={{ fontSize: 13, color: C.green, marginBottom: 8 }}>✨ 判定成功！</div>
                    <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "quest_done", isSuccess: true } }))} style={btnFull(C.greenBg, C.greenBorder, C.green)}>
                      解決処理へ進む
                    </button>
                  </div>
                )}

                {allRolled && !anySuccess && (
                  <div style={{ textAlign: "center", marginTop: 16 }}>
                    <div style={{ fontSize: 13, color: C.red, marginBottom: 8 }}>💀 全員失敗...</div>
                    {(pc.uid === user?.uid) && (
                      <button onClick={() => animateDice(1, "ペナルティ表", res => {
                        upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "quest_penalty", penaltyDice: res[0] } }));
                      })} style={btnFull(C.redBg, C.redBorder, C.red)}>
                        🎲 ペナルティ表を振る
                      </button>
                    )}
                    {pc.uid !== user?.uid && <div style={{ fontSize: 10, color: C.textDim }}>シーンプレイヤーがペナルティ表を振ります...</div>}
                  </div>
                )}
              </div>
            );
          })()}

          {sc.phase === "quest_penalty" && (() => {
            const pcsHere = gs.pcs.filter(p => p.currentSpot === sc.questLocation);
            const myPc = pcsHere.find(p => p.uid === user?.uid);
            const d = sc.penaltyDice;
            const decisions = sc.penaltyDecisions || {};

            const allDecided = pcsHere.every(p => decisions[p.uid] !== undefined);
            const anyPaid = Object.values(decisions).some(v => v === true);

            const [selectedTarget, setSelectedTarget] = useState("");

            const makeDecision = (paid, updatedPc = null) => {
              upd(p => {
                const nextPcs = updatedPc ? p.pcs.map(x => x.uid === user.uid ? updatedPc : x) : p.pcs;
                return {
                  ...p,
                  pcs: nextPcs,
                  currentScene: { 
                    ...p.currentScene, 
                    penaltyDecisions: { ...(p.currentScene.penaltyDecisions || {}), [user.uid]: paid } 
                  }
                };
              });
            };
            
            const pData = {
              1: { title: "うぷ。頑張りすぎてしまったかも。", desc: "シーンプレイヤーのPCはランダムな【変調】1つを獲得する。\nその後、クエストは解決する。" },
              2: { title: "うっかりパワーを使いすぎてしまった。", desc: "シーンプレイヤーのPCは【霊力】を「D6点」消費する。\nその後、クエストは解決する。" },
              3: { title: "なかなかうまくいかない時って、一気に気分が萎えてしまうよね。", desc: "このシーンに登場しているPC全員の【やる気】が「1点」になる。\nその後、クエストは解決する。" },
              4: { title: "協力プレイでなんとか解決。", desc: "このシーンに登場しているPCは、自身の獲得している絆を1つ選んで消費できる。誰か一人が支払えばクエストは解決する。" },
              5: { title: "誰か、アレを持ってない！？", desc: "このシーンに登場しているPCは、所持している任意のアイテム1つを失うことができる。誰か一人が支払えばクエストは解決する。" },
              6: { title: "どうあがいても無理だった...", desc: "このクエストは解決されない。" }
            }[d];

            const applyAutoPenalty = () => {
              if (d === 1) {
                animateDice(1, "変調決定", res => {
                  const bsName = BAD_STATUS_TABLE[res[0]].name;
                  upd(p => {
                    const newBs = Array.from(new Set([...(pc.badStatus || []), bsName]));
                    const newPcs = p.pcs.map(x => x.uid === pc.uid ? { ...x, badStatus: newBs, resources: { ...x.resources, やる気: { ...x.resources.やる気, cur: bsName === "だるい" ? 1 : x.resources.やる気.cur } } } : x);
                    return { ...p, pcs: newPcs, currentScene: { ...p.currentScene, phase: "quest_done", isSuccess: true }, log: [`${pc.charName} はペナルティで変調《${bsName}》を獲得した。`, ...p.log] };
                  });
                });
              } else if (d === 2) {
                animateDice(1, "霊力減少", res => {
                  const dmg = res[0];
                  upd(p => {
                    const r = pc.resources.霊力 || { cur: 0, max: 20 };
                    const nextRei = Math.max(0, r.cur - dmg);
                    const newPcs = p.pcs.map(x => x.uid === pc.uid ? { ...x, resources: { ...x.resources, 霊力: { ...r, cur: nextRei }, 攻撃力: { ...x.resources.攻撃力, cur: 1 + Math.floor(nextRei / 5) } } } : x);
                    return { ...p, pcs: newPcs, currentScene: { ...p.currentScene, phase: "quest_done", isSuccess: true }, log: [`${pc.charName} はペナルティで霊力を ${dmg} 消費した。`, ...p.log] };
                  });
                });
              } else if (d === 3) {
                upd(p => {
                  const uidsHere = pcsHere.map(x => x.uid);
                  const newPcs = p.pcs.map(x => uidsHere.includes(x.uid) ? { ...x, resources: { ...x.resources, やる気: { ...x.resources.やる気, cur: 1 } } } : x);
                  return { ...p, pcs: newPcs, currentScene: { ...p.currentScene, phase: "quest_done", isSuccess: true }, log: [`ペナルティにより全員のやる気が 1 になった。`, ...p.log] };
                });
              }
            };

            return (
              <div style={{ textAlign: "center", animation: "fadeUp 0.3s ease" }}>
                <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>ペナルティ表: [{d}]</div>
                <div style={{ fontSize: 13, color: C.red, marginBottom: 8, fontWeight: "bold" }}>{pData.title}</div>
                <div style={{ fontSize: 10, color: C.text, whiteSpace: "pre-wrap", background: "rgba(192,57,43,0.15)", border: `1px solid ${C.redBorder}`, padding: 10, borderRadius: 4, marginBottom: 16 }}>
                  {pData.desc}
                </div>

                {isMyTurn && [1, 2, 3].includes(d) && (
                  <button onClick={applyAutoPenalty} style={btnFull(C.goldBg, C.goldDim, C.gold)}>ペナルティを受けて解決する</button>
                )}

                {[4, 5].includes(d) && !allDecided && (
                  <div style={{ background: "rgba(0,0,0,0.2)", padding: 10, borderRadius: 6, border: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 10, color: C.gold, marginBottom: 10, borderBottom: `1px solid ${C.border}`, paddingBottom: 4 }}>
                      全員の回答を待っています...
                    </div>
                    
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center", marginBottom: 12 }}>
                      {pcsHere.map(p => (
                        <div key={p.uid} style={{ fontSize: 9, padding: "2px 6px", borderRadius: 10, background: decisions[p.uid] === undefined ? "rgba(255,255,255,0.05)" : decisions[p.uid] ? C.greenBg : C.redBg, color: decisions[p.uid] === undefined ? C.textFaint : decisions[p.uid] ? C.green : C.red, border: `1px solid ${decisions[p.uid] === undefined ? C.border : decisions[p.uid] ? C.greenBorder : C.redBorder}` }}>
                          {p.charName}: {decisions[p.uid] === undefined ? "考え中" : decisions[p.uid] ? "支払う" : "パス"}
                        </div>
                      ))}
                    </div>

                    {myPc && decisions[user.uid] === undefined && (
                      <div style={{ animation: "fadeUp 0.2s ease" }}>
                        {d === 4 && (
                          <>
                            <select value={selectedTarget} onChange={e => setSelectedTarget(e.target.value)} style={{ ...iStyle, marginBottom: 8, fontSize: 11 }}>
                              <option value="">消費する絆を選択...</option>
                              {(myPc.bonds || []).map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                            <button 
                              disabled={!selectedTarget} 
                              onClick={() => {
                                const nextPc = { ...myPc, bonds: myPc.bonds.filter(b => b !== selectedTarget) };
                                makeDecision(true, nextPc);
                                upd(p => ({ ...p, log: [`${myPc.charName} は《${selectedTarget}への絆》を捧げて協力した！`, ...p.log] }));
                              }}
                              style={btnFull(selectedTarget ? C.greenBg : "rgba(255,255,255,0.05)", C.greenBorder, selectedTarget ? C.green : C.textFaint, { marginBottom: 6 })}
                            >
                              絆を消費して協力する
                            </button>
                          </>
                        )}
                        {d === 5 && (
                          <>
                            <select value={selectedTarget} onChange={e => setSelectedTarget(e.target.value)} style={{ ...iStyle, marginBottom: 8, fontSize: 11 }}>
                              <option value="">消費するアイテムを選択...</option>
                              {Object.entries(myPc.items || {}).filter(([_, count]) => count > 0).map(([name]) => <option key={name} value={name}>{name}</option>)}
                            </select>
                            <button 
                              disabled={!selectedTarget} 
                              onClick={() => {
                                const nextPc = { ...myPc, items: { ...myPc.items, [selectedTarget]: myPc.items[selectedTarget] - 1 } };
                                makeDecision(true, nextPc);
                                upd(p => ({ ...p, log: [`${myPc.charName} は【${selectedTarget}】を差し出して協力した！`, ...p.log] }));
                              }}
                              style={btnFull(selectedTarget ? C.greenBg : "rgba(255,255,255,0.05)", C.greenBorder, selectedTarget ? C.green : C.textFaint, { marginBottom: 6 })}
                            >
                              アイテムを消費して協力する
                            </button>
                          </>
                        )}
                        <button onClick={() => makeDecision(false)} style={btnFull(C.redBg, C.redBorder, C.red)}>パスする</button>
                      </div>
                    )}
                  </div>
                )}

                {[4, 5].includes(d) && allDecided && (
                  <div style={{ animation: "fadeUp 0.3s ease" }}>
                    <div style={{ fontSize: 16, color: anyPaid ? C.green : C.red, fontWeight: "bold", marginBottom: 12 }}>
                      {anyPaid ? "✨ 協力により解決！" : "💀 誰も協力できず解決失敗..."}
                    </div>
                    {isMyTurn && (
                      <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "quest_done", isSuccess: anyPaid } }))} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>
                        結果を確定して進む
                      </button>
                    )}
                  </div>
                )}

                {isMyTurn && d === 6 && (
                  <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "quest_done", isSuccess: false } }))} style={btnFull("rgba(255,255,255,0.05)", C.border, C.textFaint)}>クリアできずに終了する</button>
                )}
                
                {(!isMyTurn && ([1, 2, 3, 6].includes(d) || allDecided)) && (
                  <div style={{ fontSize: 10, color: C.textDim }}>シーンプレイヤーが処理を確定させています...</div>
                )}
              </div>
            );
          })()}

          {sc.phase === "quest_done" && (() => {
            const q = gs.quests?.find(x => x.id === sc.questId);
            
            const finishQuest = () => {
              if (sc.isSuccess) {
                animateDice(4, "手がかり2つ配置", res => {
                  const s1 = getSpotByD66(res[0], res[1], SPOTS);
                  const s2 = getSpotByD66(res[2], res[3], SPOTS);
                  upd(p => {
                    let nextQuests = p.quests.map(x => x.id === sc.questId ? { ...x, solved: true } : x);

                    const allScenarioQuests = p.scenarioData?.quests || [];
                    allScenarioQuests.forEach(scQ => {
                      if (scQ.unlockType === "quest" && String(scQ.unlockQuestId) === String(sc.questId)) {
                        if (!nextQuests.find(nq => String(nq.id) === String(scQ.id))) {
                          nextQuests.push({ ...scQ, revealed: true, solved: false, clues: 0 });
                        }
                      }
                    });

                    return {
                      ...p,
                      quests: nextQuests,
                      clues: [...new Set([...(p.clues||[]), s1, s2].filter(Boolean))],
                      actedPcs: [...(p.actedPcs || []), pc.uid],
                      currentScene: null,
                      log: [
                        `手がかりを [${getSpot(s1)?.name}] と [${getSpot(s2)?.name}] に配置した`,
                        `✨ クエスト「${q?.name}」を解決した！`,
                        `${pc.charName} のシーンを終了した`,
                        ...p.log
                      ]
                    };
                  });
                });
              } else {
                upd(p => ({
                  ...p,
                  actedPcs: [...(p.actedPcs || []), pc.uid],
                  currentScene: null,
                  log: [`クエスト「${q?.name}」は解決できなかった...`, `${pc.charName} のシーンを終了した`, ...p.log]
                }));
              }
            };

            return (
              <div style={{ textAlign: "center", animation: "fadeUp 0.3s ease" }}>
                {sc.isSuccess ? (
                  <>
                    <div style={{ fontSize: 16, color: C.gold, marginBottom: 8, fontWeight: "bold" }}>✨ クエスト解決！</div>
                    <div style={{ fontSize: 11, color: C.textDim, marginBottom: 16 }}>報酬としてランダムなスポット2箇所に手がかりが配置されます。</div>
                  </>
                ) : (
                  <div style={{ fontSize: 16, color: C.red, marginBottom: 16, fontWeight: "bold" }}>クエスト解決ならず...</div>
                )}
                {(isGm || pc.uid === user?.uid) && (
                  <button onClick={finishQuest} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>
                    {sc.isSuccess ? "🎲 手がかりを配置してシーン終了" : "シーンを終了する"}
                  </button>
                )}
              </div>
            );
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
export function RightPanel({ gs, upd, sceneData, setSceneData, isGm, user, room, animateDice, CYCLES, CYCLE_COLORS, NEWSPAPER, getSpot, doNewspaper, doAdvanceCycle, doReiryoku, doTransitionToExplore, pendingAction, setPendingAction, SPOTS }) {
  const [tab, setTab]             = useState("progress");
  const [expandedQuests, setExpandedQuests] = useState({});
  const [paperModal, setPaperModal] = useState(null);
  const [sceneSelect, setSceneSelect] = useState("");

  const cycleIdx   = gs.cycleIdx || 0;
  const isIntro    = gs.sessionPhase === "intro" || gs.sessionPhase === "intro_main";
  const isMorning  = cycleIdx === 0;
  const cycleColor = CYCLE_COLORS[cycleIdx];

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
      currentScene: { pcUid: sceneSelect, phase: "move_or_stay", moveDice: [], actionDice: [], actionDiceCount: 2 },
      log:[`🎬 ${targetPc.charName} のシーンが開始された`, ...p.log],
    }));
    setSceneSelect("");
  };

  const unactedPcs = (gs.pcs || []).filter(pc => !(gs.actedPcs ||[]).includes(pc.uid));

  const getMainAction = () => {
    if (gs.currentScene) return null;
    if (isIntro) return { label: "🎬 探索フェイズへ移行する", fn: () => setPendingAction("toExplore"), color: "#1976d2" };

    const allScenarioQuests = gs.scenarioData?.quests || [];
    const currentSolvedCount = (gs.quests || []).filter(q => q.solved).length;
    const isAllSolved = allScenarioQuests.length > 0 && currentSolvedCount >= allScenarioQuests.length;

    if (isAllSolved && gs.sessionPhase === "explore") {
      return {
        label: "⚔️ 決戦フェイズへ移行する",
        fn: () => setPendingAction("toBattle"),
        color: C.red
      };
    }

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

      return { label: `☀️ 昼のサイクルへ`, fn: () => setPendingAction("advance"), color: "#f57c00" };
    }
    if (cycleIdx !== 3 && !gs.reiryokuDone) return { label: "✦ 霊力の増加", fn: doReiryoku, color: "#ab47bc" };
    if (unactedPcs.length === 0) return { label: `🌙 ${cycleIdx === 3 ? "翌日の朝" : "次のサイクル"}へ`, fn: () => setPendingAction("advance"), color: "#f57c00" };
    return null;
  };
  const ma = isGm ? getMainAction() : null;

  const TABS = isGm
    ? [["progress", "進行"],["pcs", "PC一覧"], ["scene", "描写"], ["log", "ログ"]]
    : [["progress", "進行"],["pcs", "PC一覧"], ["log", "ログ"]];

  const joinQuest = () => {
    const myPc = gs.pcs.find(p => p.uid === user.uid);
    if (!myPc || !gs.currentScene?.questLocation) return;
    
    upd(p => ({
      ...p,
      pcs: p.pcs.map(x => x.uid === user.uid ? { ...x, currentSpot: gs.currentScene.questLocation } : x),
      log: [`🏃 ${myPc.charName} がクエストに合流した！`, ...p.log]
    }));
  };

  return (
    <div style={{ width: 300, display: "flex", flexDirection: "column", background: "#0b0d14", borderLeft: `1px solid ${C.border}`, flexShrink: 0, overflow: "hidden", fontFamily: "serif" }}>
      <style>{`@keyframes fadeUp { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } } @keyframes rollSpin { 50% { transform: scale(1.15) } }`}</style>

      <div style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, background: "#08090f", flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: C.gold, letterSpacing: 2 }}>
            {gs.battle?.active ? "⚖️ 弾幕ごっこ" : (gs.sessionPhase === "intro" ? "✦ 導入フェイズ" : "✦ 探索フェイズ")}
          </span>
          {gs.battle?.active ? (
            <div style={{ padding: "2px 10px", background: "rgba(224,112,96,0.18)", border: `1px solid ${C.redBorder}`, borderRadius: 10, fontSize: 10, color: C.red }}>
              ROUND {gs.battle.round}
            </div>
          ) : (
            !isIntro && <div style={{ padding: "2px 10px", background: `${cycleColor}18`, border: `1px solid ${cycleColor}40`, borderRadius: 10, fontSize: 10, color: cycleColor }}>{gs.day}日目・{CYCLES[cycleIdx]}</div>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
        {gs.battle?.active ? (
          <BattleRightPanel 
            gs={gs} 
            upd={upd} 
            user={user} 
            isGm={isGm} 
            getSpot={getSpot} 
          />
        ) : (
          <>
            {gs.currentScene?.phase === "quest_setup" && gs.currentScene?.pcUid !== user.uid && !isGm && (
              <div style={{ padding: "10px", background: "rgba(200,160,64,0.15)", borderBottom: `1px solid ${C.goldDim}`, animation: "fadeUp 0.3s ease" }}>
                <div style={{ fontSize: 10, color: C.gold, marginBottom: 6, textAlign: "center" }}>
                  🌟 クエストシーンが開始されました
                </div>
                <button 
                  onClick={joinQuest}
                  disabled={gs.pcs.find(p => p.uid === user.uid)?.currentSpot === gs.currentScene.questLocation}
                  style={btnFull(C.goldBg, C.goldDim, C.gold, { fontSize: 10 })}
                >
                  {gs.pcs.find(p => p.uid === user.uid)?.currentSpot === gs.currentScene.questLocation 
                    ? "合流済み" 
                    : "このクエストに合流する（移動）"}
                </button>
              </div>
            )}

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
                        {unactedPcs.map(pc => <option key={pc.uid} value={pc.uid}>{pc.charName}</option>)}
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
                    (gs.quests ||[]).map(q => {
                      const isExpanded = expandedQuests[q.id];
                      const isReadyToSolve = !q.solved && (q.clues || 0) >= q.level;
                      
                      const toggleExpand = () => {
                        setExpandedQuests(prev => ({ ...prev, [q.id]: !prev[q.id] }));
                      };

                      return (
                        <div key={q.id || q.name} style={{ marginBottom: 4, background: q.solved ? "rgba(27,94,32,0.08)" : "rgba(255,255,255,0.02)", border: `1px solid ${q.solved ? "#1b5e20" : isReadyToSolve ? C.goldDim : C.border}`, borderRadius: 3, overflow: "hidden" }}>
                          
                          <div 
                            onClick={toggleExpand}
                            style={{ padding: "6px 8px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, transition: "background 0.2s" }}
                            onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                          >
                            <div style={{ fontSize: 8, color: C.textFaint }}>{isExpanded ? "▼" : "▶"}</div>
                            
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <span style={{ fontSize: 11, color: q.solved ? "#4caf50" : isReadyToSolve ? C.gold : C.text, textDecoration: q.solved ? "line-through" : "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  【Lv.{q.level}】{q.name}
                                </span>
                                {isReadyToSolve && <span style={{ fontSize: 8, color: C.gold, animation: "fadeUp 0.5s ease infinite alternate" }}>✨</span>}
                              </div>
                              
                              {!q.solved && (
                                <div style={{ fontSize: 8, color: isReadyToSolve ? C.gold : "#00bcd4", marginTop: 1 }}>
                                  {isReadyToSolve ? "調査完了：解決可能" : `💡 手がかり: ${q.clues || 0}/${q.level}`}
                                </div>
                              )}
                            </div>

                            {isGm && (
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  upd(p => {
                                    const isNowSolved = !q.solved;
                                    let nextQuests = p.quests.map(x => x.id === q.id ? { ...x, solved: isNowSolved } : x);
                                    if (isNowSolved) {
                                      const allScenarioQuests = p.scenarioData?.quests || [];
                                      allScenarioQuests.forEach(scQ => {
                                        if (scQ.unlockType === "quest" && String(scQ.unlockQuestId) === String(q.id)) {
                                          if (!nextQuests.find(nq => String(nq.id) === String(scQ.id))) {
                                            nextQuests.push({ ...scQ, revealed: true, solved: false, clues: 0 });
                                          }
                                        }
                                      });
                                    }
                                    return { ...p, quests: nextQuests };
                                  });
                                }}
                                style={{ width: 20, height: 20, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: q.solved ? C.red : "#4caf50", cursor: "pointer", borderRadius: 2, fontSize: 12, padding: 0 }}
                                >
                                {q.solved ? "↩" : "✓"}
                              </button>
                            )}
                          </div>

                          {isExpanded && (
                            <div style={{ padding: "0 8px 8px 22px", borderTop: "1px solid rgba(255,255,255,0.03)", animation: "fadeUp 0.2s ease" }}>
                              <div style={{ fontSize: 9, color: C.textDim, marginTop: 6, lineHeight: 1.4 }}>{q.summary}</div>
                              
                              {(isReadyToSolve || q.solved || isGm) && (
                                <div style={{ marginTop: 6, padding: "4px 6px", background: "rgba(200,160,64,0.05)", borderRadius: 2, borderLeft: `2px solid ${C.goldDim}` }}>
                                  <div style={{ fontSize: 8, color: C.goldDim, letterSpacing: 1, fontWeight: "bold" }}>真相 / 解決場所</div>
                                  <div style={{ fontSize: 9, color: C.text, marginTop: 2, whiteSpace: "pre-wrap" }}>{q.truth || "（真相なし）"}</div>
                                  {q.location && (
                                    <div style={{ fontSize: 9, color: "#90caf9", marginTop: 2 }}>📍 解決場所: {getSpot(q.location)?.name || `スポット[${q.location}]`}</div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
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
                  {gs.dice?.results && (
                    <div style={{ marginTop: 12, textAlign: "center" }}>
                      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 4 }}>
                        {gs.dice.results.map((d, i) => (
                          <div key={i} style={{ width: 40, height: 40, border: "2px solid #1e3a5a", borderRadius: 5, background: "rgba(14,20,36,0.95)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: "#60c0f0", fontWeight: "bold", animation: gs.dice.rolling ? "rollSpin 0.25s ease infinite" : "none" }}>{d}</div>
                        ))}
                      </div>
                      {!gs.dice?.rolling && <div style={{ fontSize: 16, color: C.gold }}>{gs.dice?.results.join("")}</div>}
                    </div>
                  )}
                </div>
              )}

              {tab === "pcs" && (
                <div>
                  {(gs.pcs || []).length === 0
                    ? <div style={{ fontSize: 10, color: "#2a3545" }}>PCなし</div>
                    : (gs.pcs || []).map(pc => (
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

            {paperModal && (() => { 
              const r = paperModal.roll;
              const isZoro = [11, 22, 33, 44, 55, 66].includes(r);
              const needsSpot = [14, 35, 46].includes(r);
              const is25 = r === 25;
              const is36 = r === 36;
              const is23 = r === 23;
              const is56 = r === 56;

              const saveApplied = (extra = {}) => {
                upd(p => ({ ...p, newspaper: { ...p.newspaper, applied: true, ...extra } }));
                setPaperModal(prev => ({ ...prev, applied: true, ...extra }));
              };

              const applyZoro = () => {
                const target = "66";
                saveApplied({ targetSpot: target });
                upd(p => ({ ...p, log: [`新聞[${r}]の効果が適用された（帰還先に博麗神社を指定可能）`, ...p.log] }));
              };

              const rollTargetSpot = () => {
                animateDice(2, "対象スポットの決定", res => {
                  const spotId = getSpotByD66(res[0], res[1], SPOTS);
                  saveApplied({ targetSpot: spotId });
                  upd(p => ({ ...p, log: [`新聞[${r}]の対象スポットが [${getSpot(spotId)?.name}] に決定した`, ...p.log] }));
                });
              };

              const apply25 = () => {
                animateDice(4, "手がかり2箇所配置", res => {
                  const s1 = getSpotByD66(res[0], res[1], SPOTS);
                  const s2 = getSpotByD66(res[2], res[3], SPOTS);
                  upd(p => ({
                    ...p,
                    newspaper: { ...p.newspaper, applied: true },
                    clues: [...new Set([...(p.clues || []), s1, s2].filter(Boolean))],
                    log: [`新聞[25]の効果で [${getSpot(s1)?.name}] と [${getSpot(s2)?.name}] に手がかりが追加された`, ...p.log],
                  }));
                  setPaperModal(prev => ({ ...prev, applied: true }));
                });
              };

              const apply36 = () => {
                const count = (gs.clues || []).length;
                if (count > 0) {
                  animateDice(count * 2, "手がかり再配置", res => {
                    const newClues = [];
                    for (let i = 0; i < count; i++) {
                      const s = getSpotByD66(res[i * 2], res[i * 2 + 1], SPOTS);
                      if (s) newClues.push(s);
                    }
                    upd(p => ({
                      ...p,
                      newspaper: { ...p.newspaper, applied: true },
                      clues: [...new Set(newClues)],
                      log: [`新聞[36]の効果で、すべての手がかりが再配置された`, ...p.log],
                    }));
                    setPaperModal(prev => ({ ...prev, applied: true }));
                  });
                } else {
                  saveApplied();
                }
              };

              const apply23 = () => {
                upd(p => ({
                  ...p,
                  newspaper: { ...p.newspaper, applied: true },
                  pcs: p.pcs.map(pc => ({
                    ...pc,
                    resources: { ...pc.resources, やる気: { ...pc.resources.やる気, cur: Math.min(pc.resources.やる気.max, (pc.resources.やる気.cur || 0) + 1) } },
                  })),
                  log: [`新聞[23]の効果で、全員のやる気が1回復した！`, ...p.log],
                }));
                setPaperModal(prev => ({ ...prev, applied: true }));
              };

              const apply56 = () => {
                upd(p => ({
                  ...p,
                  newspaper: { ...p.newspaper, applied: true },
                  pcs: p.pcs.map(pc => ({ ...pc, flags: { ...pc.flags, canCureBadStatus: true } })),
                  log: [`新聞[56]の効果で、全員が任意の変調を1つ解除できるようになった！`, ...p.log],
                }));
                setPaperModal(prev => ({ ...prev, applied: true }));
              };

              const isActionNeeded = isZoro || needsSpot || is25 || is36 || is23 || is56;
              const canClose = !isActionNeeded || paperModal.applied;

              return (
                <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => canClose && setPaperModal(null)}>
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
                    <div style={{ fontSize: 11, color: "#4a6070", lineHeight: 1.8, marginBottom: 8 }}>{paperModal.effect}</div>
                    
                    {paperModal.targetSpot && (
                      <div style={{ padding: 6, background: "rgba(255,255,255,0.05)", borderRadius: 4, textAlign: "center", fontSize: 11, color: C.gold, animation: "fadeUp 0.3s ease" }}>
                        対象スポット: {getSpot(paperModal.targetSpot)?.name}
                      </div>
                    )}

                    {isGm && !paperModal.applied && isZoro && <button onClick={applyZoro} style={{ ...btnFull(C.blueBg, C.blueBorder, C.blue), marginTop: 12 }}>適用する</button>}
                    {isGm && !paperModal.applied && needsSpot && <button onClick={rollTargetSpot} style={{ ...btnFull(C.goldBg, C.goldDim, C.gold), marginTop: 12 }}>🎲 対象スポットを決定する</button>}
                    {isGm && !paperModal.applied && is25 && <button onClick={apply25} style={{ ...btnFull(C.goldBg, C.goldDim, C.gold), marginTop: 12 }}>🎲 手がかりを配置する</button>}
                    {isGm && !paperModal.applied && is36 && <button onClick={apply36} style={{ ...btnFull(C.goldBg, C.goldDim, C.gold), marginTop: 12 }}>🎲 手がかりを再配置する</button>}
                    {isGm && !paperModal.applied && is23 && <button onClick={apply23} style={{ ...btnFull(C.blueBg, C.blueBorder, C.blue), marginTop: 12 }}>適用する</button>}
                    {isGm && !paperModal.applied && is56 && <button onClick={apply56} style={{ ...btnFull(C.blueBg, C.blueBorder, C.blue), marginTop: 12 }}>適用する</button>}

                    {(!isGm || canClose) && (
                      <button onClick={() => setPaperModal(null)} style={{ ...btnFull("transparent", C.border, C.textFaint), marginTop: 12 }}>閉じる</button>
                    )}
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}

function BattleDiceTray({ diceResult, diceAnim, label }) {
  if (!diceResult?.length && !diceAnim) return <div style={{ height: 20 }} />;

  const displayLabel = label ? label : "DICE ROLL";

  return (
    <div style={{ 
      margin: "0 0 10px 0", 
      padding: "12px 14px", 
      background: "rgba(0,0,0,0.45)", 
      border: `1px solid ${C.border}`, 
      borderRadius: 10,
      textAlign: "center",
      animation: "fadeUp 0.3s ease"
    }}>
      <div style={{ fontSize: 9, color: C.gold, letterSpacing: 2, marginBottom: 8, textTransform: "uppercase" }}>
        {diceAnim ? `${displayLabel} を振っています...` : displayLabel}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
        {(diceResult || [1, 1]).map((d, i) => (
          <div key={i} style={{ 
            width: 36, height: 36, 
            background: diceAnim ? "linear-gradient(180deg, rgba(35,55,90,1), rgba(10,22,36,0.98))" : "rgba(14,20,36,0.95)", 
            border: `2px solid ${diceAnim ? "#64b5f6" : C.blueBorder}`,
            borderRadius: 8,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, color: "#90caf9", fontWeight: "bold",
            animation: diceAnim ? "rollSpin 0.2s ease infinite" : "none",
            boxShadow: diceAnim ? "0 0 18px rgba(96,192,240,0.25)" : "none"
          }}>
            {d}
          </div>
        ))}
      </div>
      {!diceAnim && diceResult && (
        <div style={{ fontSize: 12, color: "#fff", marginTop: 8, fontWeight: "bold" }}>
          RESULT: {diceResult.join(", ")}
        </div>
      )}
    </div>
  );
}

function BattleRightPanel({ gs, upd, user, isGm, getSpot, animateDice }) {
  const [battleTab, setBattleTab] = useState("info");
  const b = gs.battle;
  const pcCombatant = gs.pcs.find(p => p.uid === b.pcCombatant);
  const npcCombatant = b.participants.npcs.find(n => n.id === b.npcCombatant);

  const spectators = gs.pcs.filter(p =>
    p.uid !== b.pcCombatant &&
    (p.resources?.残り人数?.cur || 0) > 0
  );

  const isSpectator = spectators.some(p => p.uid === user.uid);
  const isCombatant = b.pcCombatant === user.uid;
  const interventionUsed = b.usedIntervention?.[user.uid];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, marginBottom: 10, flexShrink: 0 }}>
        <button 
          onClick={() => setBattleTab("info")}
          style={{ 
            flex: 1, padding: "6px", fontSize: 10, cursor: "pointer",
            background: battleTab === "info" ? "rgba(200,160,64,0.1)" : "transparent",
            color: battleTab === "info" ? C.gold : C.textFaint,
            border: "none", borderBottom: battleTab === "info" ? `2px solid ${C.gold}` : "2px solid transparent"
          }}
        >情報</button>
        <button 
          onClick={() => setBattleTab("log")}
          style={{ 
            flex: 1, padding: "6px", fontSize: 10, cursor: "pointer",
            background: battleTab === "log" ? "rgba(200,160,64,0.1)" : "transparent",
            color: battleTab === "log" ? C.gold : C.textFaint,
            border: "none", borderBottom: battleTab === "log" ? `2px solid ${C.gold}` : "2px solid transparent"
          }}
        >ログ</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", paddingRight: 4 }}>
        {battleTab === "info" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {!npcCombatant || !pcCombatant ? (
              <div style={{ padding: "20px 10px", textAlign: "center", color: C.textFaint, fontSize: 10 }}>
                対戦者を選出すると<br />ステータスが表示されます
              </div>
            ) : (<>
            <div style={{ padding: "8px 10px", background: "rgba(192,57,43,0.1)", border: `1px solid ${C.redBorder}`, borderRadius: 6 }}>
              <div style={{ fontSize: 8, color: C.red, letterSpacing: 2, marginBottom: 2 }}>ENEMY</div>
              <div style={{ fontSize: 11, color: "#fff", fontWeight: "bold" }}>{npcCombatant.name}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, marginTop: 4 }}>
                <div style={{ fontSize: 9, color: C.textDim }}>残り人数: <span style={{color:C.red}}>{npcCombatant.resources.残り人数?.cur ?? 0}</span></div>
                <div style={{ fontSize: 9, color: C.textDim }}>スペルカード: <span style={{color:C.purple}}>{npcCombatant.resources.スペルカード?.cur ?? 0}</span></div>
                <div style={{ fontSize: 9, color: C.textDim }}>攻撃力: <span style={{color:C.gold}}>{Math.max(1, (npcCombatant.resources.攻撃力?.cur ?? 0) - (hasOfficialSkill(npcCombatant, "使い魔") ? 1 : 0))}</span>{hasOfficialSkill(npcCombatant, "使い魔") && <span style={{fontSize:8,color:C.textFaint}}> (-1)</span>}</div>
                <div style={{ fontSize: 9, color: C.textDim, display: "flex", alignItems: "center", gap: 6 }}>
                  グレイズ: <span style={{color:C.green}}>{npcCombatant.resources.グレイズ?.cur ?? 0}点</span>
                  {isGm && (npcCombatant.resources.グレイズ?.cur ?? 0) >= 5 && (
                    <button
                      onClick={() => upd(p => {
                        const npc = p.battle.participants.npcs.find(n => n.id === b.npcCombatant);
                        if (!npc) return p;
                        const newGraze = (npc.resources.グレイズ?.cur || 0) - 5;
                        const newSpe   = Math.min((npc.resources.スペルカード?.max || 9), (npc.resources.スペルカード?.cur || 0) + 1);
                        return {
                          ...p,
                          battle: {
                            ...p.battle,
                            participants: {
                              ...p.battle.participants,
                              npcs: p.battle.participants.npcs.map(n => n.id !== b.npcCombatant ? n : {
                                ...n,
                                resources: {
                                  ...n.resources,
                                  グレイズ:     { ...n.resources.グレイズ,     cur: newGraze },
                                  スペルカード: { ...n.resources.スペルカード, cur: newSpe   },
                                },
                              }),
                            },
                          },
                          log: [`💠 ${npc.name} グレイズ5点消費 → スペルカード+1 (現在:${newSpe})`, ...p.log],
                        };
                      })}
                      style={{ fontSize: 8, padding: "1px 5px", background: "rgba(171,71,188,0.2)", border: "1px solid #7b1fa2", color: "#ce93d8", borderRadius: 3, cursor: "pointer" }}
                    >G→SC</button>
                  )}
                </div>
                <div style={{ fontSize: 9, color: C.textDim }}>回避力: <span style={{color:C.blue}}>{npcCombatant.resources.回避力?.cur ?? 3}</span></div>
              </div>
            </div>

            <div style={{ padding: "8px 10px", background: "rgba(25,118,210,0.1)", border: `1px solid ${C.blueBorder}`, borderRadius: 6 }}>
              <div style={{ fontSize: 8, color: C.blue, letterSpacing: 2, marginBottom: 2 }}>PLAYER</div>
              <div style={{ fontSize: 11, color: "#fff", fontWeight: "bold" }}>{pcCombatant.charName}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, marginTop: 4 }}>
                <div style={{ fontSize: 9, color: C.textDim }}>残り人数: <span style={{color:C.red}}>{pcCombatant.resources.残り人数?.cur ?? 0}</span></div>
                <div style={{ fontSize: 9, color: C.textDim }}>スペルカード: <span style={{color:C.purple}}>{pcCombatant.resources.スペルカード?.cur ?? 0}</span></div>
                <div style={{ fontSize: 9, color: C.textDim, display: "flex", alignItems: "center", gap: 6 }}>
                  グレイズ: <span style={{color:C.green}}>{pcCombatant.resources.グレイズ?.cur ?? 0}点</span>
                  {/* ⚡ 弾貨スキル: グレイズ4点 → スペルカード1点 */}
                  {hasOfficialSkill(pcCombatant, "弾貨") && (pcCombatant.resources.グレイズ?.cur ?? 0) >= 4 && (
                    <button
                      onClick={() => upd(p => {
                        const pc = p.pcs.find(x => x.uid === b.pcCombatant);
                        if (!pc) return p;
                        const ng = (pc.resources.グレイズ?.cur || 0) - 4;
                        const ns = Math.min((pc.resources.スペルカード?.max || 9), (pc.resources.スペルカード?.cur || 0) + 1);
                        return { ...p,
                          pcs: p.pcs.map(x => x.uid !== b.pcCombatant ? x : { ...x, resources: { ...x.resources,
                            グレイズ:     { ...x.resources.グレイズ,     cur: ng },
                            スペルカード: { ...x.resources.スペルカード, cur: ns },
                          }}),
                          log: [`💎 ${pc.charName} 弾貨：G4→SC+1(${ns})`, ...p.log],
                        };
                      })}
                      style={{ fontSize: 8, padding: "1px 5px", background: "rgba(100,181,246,0.2)", border: `1px solid ${C.blueBorder}`, color: C.blue, borderRadius: 3, cursor: "pointer" }}
                    >弾貨(4G→SC)</button>
                  )}
                  {(pcCombatant.resources.グレイズ?.cur ?? 0) >= 5 && (
                    <button
                      onClick={() => upd(p => {
                        const pc = p.pcs.find(x => x.uid === b.pcCombatant);
                        if (!pc) return p;
                        const newGraze = (pc.resources.グレイズ?.cur || 0) - 5;
                        const newSpe   = Math.min((pc.resources.スペルカード?.max || 9), (pc.resources.スペルカード?.cur || 0) + 1);
                        const newAtk   = pc.resources.攻撃力?.cur || 1;
                        return {
                          ...p,
                          pcs: p.pcs.map(x => x.uid !== b.pcCombatant ? x : {
                            ...x,
                            resources: {
                              ...x.resources,
                              グレイズ:       { ...x.resources.グレイズ,       cur: newGraze },
                              スペルカード: { ...x.resources.スペルカード, cur: newSpe   },
                            },
                          }),
                          log: [`💠 ${pc.charName} グレイズ5点消費 → スペルカード+1 (現在:${newSpe})`, ...p.log],
                        };
                      })}
                      style={{ fontSize: 8, padding: "1px 5px", background: "rgba(171,71,188,0.2)", border: "1px solid #7b1fa2", color: "#ce93d8", borderRadius: 3, cursor: "pointer" }}
                    >G→SC</button>
                  )}
                </div>
                <div style={{ fontSize: 9, color: C.textDim }}>回避力: <span style={{color:C.blue}}>{pcCombatant.resources.回避力?.cur ?? 3}</span></div>
              </div>
            </div>

            </>)}

            {isSpectator && pcCombatant && npcCombatant && (
              <div style={{ padding: 10, background: "rgba(200,160,64,0.1)", border: `1px solid ${C.goldDim}`, borderRadius: 6 }}>
                <div style={{ fontSize: 9, color: C.gold, letterSpacing: 1, marginBottom: 6 }}>観戦者介入</div>
                {interventionUsed ? (
                  <div style={{ fontSize: 9, color: C.textFaint, textAlign: "center" }}>使用済み ({interventionUsed === "support" ? "援護" : "かばう"})</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <button 
                      onClick={() => handleSupportFire(user.uid)}
                      disabled={b.phase !== "npc_shot_roll" && b.phase !== "pc_shot_roll"}
                      style={{...btnFull(C.redBg, C.redBorder, C.red), fontSize: 9, padding: "4px"}}
                    >💥 援護射撃</button>

                    <button 
                      onClick={() => handleCover(user.uid, b.phase === "npc_shot_after" ? b.pcCombatant : b.npcCombatant)}
                      disabled={b.phase !== "npc_shot_after" && b.phase !== "pc_shot_after"}
                      style={{...btnFull(C.greenBg, C.greenBorder, C.green), fontSize: 9, padding: "4px"}}
                    >🛡️ かばう</button>
                  </div>
                )}
              </div>
            )}

            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 8, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid #111828`, paddingBottom: 2, marginBottom: 4 }}>陣営状況</div>
              {gs.pcs.map(p => {
                const isDead = (p.resources?.残り人数?.cur || 0) <= 0;
                const isCombatant = p.uid === b.pcCombatant;
                const isActed = b.actedPcs?.includes(p.uid);
                return (
                  <div key={p.uid} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", opacity: isDead ? 0.4 : 1 }}>
                    <span style={{ fontSize: 10, color: isCombatant ? C.blue : C.text }}>{isCombatant ? "▶ " : ""}{p.charName}</span>
                    <span style={{ fontSize: 8, color: isDead ? C.red : (isActed ? C.textFaint : C.gold) }}>{isDead ? "脱落" : (isActed ? "済" : "未")}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {(gs.log || []).map((entry, i) => (
              <div key={i} style={{ 
                fontSize: 10, color: "#6a7a8a", padding: "4px 0", 
                borderBottom: "1px solid rgba(255,255,255,0.02)",
                lineHeight: 1.4 
              }}>
                {entry}
              </div>
            ))}
          </div>
        )}
      </div>

      {isGm && (
        <button 
          onClick={() => window.confirm("終了しますか？") && upd(p => ({ ...p, battle: { ...p.battle, active: false } }))}
          style={{ ...btnFull("none", C.redBorder, C.red), marginTop: 10, fontSize: 9, flexShrink: 0 }}
        >対戦を強制終了</button>
      )}
    </div>
  );
}