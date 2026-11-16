// 弾幕ごっこ中の GM 介入（盤面編集）の純粋ロジック（React/Firebase 非依存・単体テスト: gmBattle.test.js）。
// 異変再現の「霊撃」「チェリーアイテム」「UFO」「ラストスペル」、アビリティカードの「装備」などを
// GM が手で処理できるようにする。いずれも upd に渡す更新関数（p => next）。乱数は呼び出し側で振る。
//
// battle に持つ値:
//   grids[entityId]   … そのキャラクターの弾幕フィールド（既存）
//   fieldTokens       … [{ id, owner: entityId, cell, kind }]  独自コマ（種類は gs.custom.tokens を流用）。戦闘中は保持
//   grantedDs         … { [entityId]: [弾幕スキル名] }  このラウンドだけ修得している弾幕スキル（handleCleanup でリセット）
//   extraEvade        … { entityId, returnTo }  GM が発生させた追加の回避ステップ。回避後は returnTo へ（ラウンド終了時リセット）
import { OFFICIAL_DANMAKU_SKILLS } from "./data/gameData";
import { getCustom } from "./customRules";

const toArray = (v) => Array.isArray(v) ? v : (v && typeof v === "object" ? Object.values(v) : []);
const EMPTY = [0, 0, 0, 0, 0, 0];

export const isPcEntity = (p, id) => (p.pcs || []).some(x => x.uid === id);
export const entityOf = (p, id) => (p.pcs || []).find(x => x.uid === id) || (p.battle?.participants?.npcs || []).find(n => n.id === id) || null;
export const entityName = (p, id) => { const e = entityOf(p, id); return e?.charName || e?.name || "？"; };
const logOf = (p, msg) => [msg, ...(p.log || [])];
const withBattle = (p, patch) => ({ ...p, battle: { ...p.battle, ...patch } });
const active = (p) => !!p.battle?.active;

// ─── 弾幕の追加・除去 ────────────────────────────────────────────
export function adjustBullets(p, entityId, cell, delta) {
  if (!active(p) || cell < 1 || cell > 6) return p;
  const grid = [...(p.battle.grids?.[entityId] || EMPTY)];
  const next = Math.max(0, (grid[cell - 1] || 0) + delta);
  if (next === grid[cell - 1]) return p;
  grid[cell - 1] = next;
  const verb = delta > 0 ? `に弾幕を${delta}つ追加` : `の弾幕を${-delta}つ除去`;
  return { ...withBattle(p, { grids: { ...p.battle.grids, [entityId]: grid } }), log: logOf(p, `🎯 GM: ${entityName(p, entityId)} のフィールド ${cell}番マス${verb}（${next}個）`) };
}

// 出目（1〜6）の配列どおりに弾幕を置く（6D を振って配置する等）
export function placeBulletsByDice(p, entityId, dice, label = "") {
  if (!active(p) || !dice?.length) return p;
  const grid = [...(p.battle.grids?.[entityId] || EMPTY)];
  dice.forEach(d => { if (d >= 1 && d <= 6) grid[d - 1] = (grid[d - 1] || 0) + 1; });
  return { ...withBattle(p, { grids: { ...p.battle.grids, [entityId]: grid } }), log: logOf(p, `🎯 GM: ${label ? `${label}：` : ""}${entityName(p, entityId)} のフィールドに弾幕を配置（出目 ${dice.join(",")}）`) };
}

export function clearField(p, entityId, label = "") {
  if (!active(p)) return p;
  const grid = p.battle.grids?.[entityId] || EMPTY;
  if (!grid.some(v => v > 0)) return p;
  return { ...withBattle(p, { grids: { ...p.battle.grids, [entityId]: [...EMPTY] } }), log: logOf(p, `🎯 GM: ${label ? `${label}：` : ""}${entityName(p, entityId)} のフィールドの弾幕を全て取り除いた`) };
}

// 弾幕フィールド上の駒を GM が動かす
export function moveEntity(p, entityId, cell) {
  if (!active(p) || cell < 1 || cell > 6 || p.battle.positions?.[entityId] === cell) return p;
  return { ...withBattle(p, { positions: { ...p.battle.positions, [entityId]: cell } }), log: logOf(p, `🎯 GM: ${entityName(p, entityId)} を ${cell}番マスへ移動`) };
}

// 残り人数の補正（PC/NPC 共通）
export function adjustLives(p, entityId, delta) {
  if (!active(p)) return p;
  const e = entityOf(p, entityId);
  if (!e) return p;
  const r = e.resources?.残り人数 || { cur: 0, max: 3 };
  const cur = Math.max(0, Math.min(r.max ?? 9, (r.cur || 0) + delta));
  if (cur === r.cur) return p;
  const upd1 = (x) => ({ ...x, resources: { ...x.resources, 残り人数: { ...r, cur } } });
  const msg = `🎯 GM: ${entityName(p, entityId)} の残り人数 ${r.cur} → ${cur}`;
  if (isPcEntity(p, entityId)) return { ...p, pcs: p.pcs.map(x => x.uid === entityId ? upd1(x) : x), log: logOf(p, msg) };
  return { ...withBattle(p, { participants: { ...p.battle.participants, npcs: p.battle.participants.npcs.map(n => n.id === entityId ? upd1(n) : n) } }), log: logOf(p, msg) };
}

// ─── 回避・被弾の流れ ────────────────────────────────────────────
// 回避側の処理が終わった後のフェイズ（battle.jsx の afterDefensePhase と同じ規則 + 追加の回避ステップ）
export function afterDefense(b, isAttackerPc) {
  if (b?.extraEvade?.returnTo) return b.extraEvade.returnTo;
  const attackerIsFirst = b?.startOrder === "npc" ? !isAttackerPc : isAttackerPc;
  if (attackerIsFirst) return isAttackerPc ? "npc_shot_intro" : "pc_shot_intro";
  return "round_end_check";
}

const evadeOf = (e) => e?.resources?.回避力?.cur || 3;

// 当たり判定中の被弾を無効にして次へ進める（霊撃など「被弾が確定していても無効にする」効果）
export function cancelHit(p, label = "") {
  const b = p.battle;
  if (!active(p) || (b.phase !== "pc_hit_check" && b.phase !== "npc_hit_check")) return p;
  const defenderIsPc = b.phase === "pc_hit_check";
  const defenderId = defenderIsPc ? b.pcCombatant : b.npcCombatant;
  const next = afterDefense(b, !defenderIsPc);
  const pc = (p.pcs || []).find(x => x.uid === b.pcCombatant);
  return {
    ...withBattle(p, {
      phase: next, evadeRoll: null,
      currentEvadeDice: next === "pc_evade_intro" ? evadeOf(pc) : b.currentEvadeDice,
    }),
    log: logOf(p, `🛡 GM: ${label ? `${label}：` : ""}${entityName(p, defenderId)} の被弾を無効にした`),
  };
}

// 追加の回避ステップ（ラストスペル等）: 対象の対戦者のフィールドに出目どおり弾幕を置き、その対戦者の回避ステップを始める。
// 回避ステップが終わると returnTo（既定はラウンド終了判定）へ進む。
export function startExtraEvade(p, isPc, dice, label = "追加の回避ステップ", returnTo = "round_end_check") {
  const b = p.battle;
  if (!active(p)) return p;
  const entityId = isPc ? b.pcCombatant : b.npcCombatant;
  if (!entityId) return p;
  const placed = placeBulletsByDice(p, entityId, dice || [], label);
  return {
    ...withBattle(placed, {
      phase: isPc ? "pc_evade_intro" : "npc_evade_intro",
      evadeRoll: null,
      currentEvadeDice: evadeOf(entityOf(p, entityId)),
      extraEvade: { entityId, returnTo },
    }),
    log: logOf(placed, `⚡ GM: ${label} — ${entityName(p, entityId)} が回避ステップを行う（終了後は${returnTo === "round_end_check" ? "ラウンド終了判定" : returnTo}へ）`),
  };
}

// ─── 弾幕フィールド上の独自コマ ──────────────────────────────────
export const getFieldTokens = (b) => toArray(b?.fieldTokens).filter(Boolean);

export function placeFieldToken(p, owner, cell, kindId, id) {
  if (!active(p) || !id || cell < 1 || cell > 6) return p;
  const kind = getCustom(p).tokens.find(k => k.id === kindId);
  if (!kind) return p;
  return {
    ...withBattle(p, { fieldTokens: [...getFieldTokens(p.battle), { id, owner, cell, kind: kindId }] }),
    log: logOf(p, `📍 GM: ${entityName(p, owner)} のフィールド ${cell}番マスに【${kind.name}】を置いた`),
  };
}

// 取り除く（how: "remove" GM が除去 / "collect" キャラクターが獲得）
export function takeFieldTokens(p, ids, how = "remove", byId = null) {
  const list = getFieldTokens(p.battle);
  const taken = list.filter(t => ids.includes(t.id));
  if (!active(p) || !taken.length) return p;
  const kinds = getCustom(p).tokens;
  const counts = {};
  taken.forEach(t => { const n = kinds.find(k => k.id === t.kind)?.name || "コマ"; counts[n] = (counts[n] || 0) + 1; });
  const what = Object.entries(counts).map(([n, c]) => `【${n}】×${c}`).join("・");
  const msg = how === "collect"
    ? `💰 ${entityName(p, byId || taken[0].owner)} が ${what} を獲得した（${taken[0].cell}番マス）`
    : `📍 GM: ${what} を取り除いた`;
  return { ...withBattle(p, { fieldTokens: list.filter(t => !ids.includes(t.id)) }), log: logOf(p, msg) };
}

// 注意が必要なコマ: 駒がそのマスにいる（踏んだ）／そのマスに弾幕が置かれている
export function fieldTokenAlerts(b) {
  const groups = {};
  getFieldTokens(b).forEach(t => {
    const standing = b?.positions?.[t.owner] === t.cell;
    const bullets = (b?.grids?.[t.owner] || EMPTY)[t.cell - 1] > 0;
    if (!standing && !bullets) return;
    const key = `${t.owner}:${t.cell}`;
    (groups[key] = groups[key] || { owner: t.owner, cell: t.cell, standing, bullets, tokens: [] }).tokens.push(t);
  });
  return Object.values(groups);
}

// ─── このラウンドだけの弾幕スキル（アビリティカードの「装備」等） ───
export const OFFICIAL_DS_NAMES = OFFICIAL_DANMAKU_SKILLS.map(s => s.name);

export function grantSkill(p, entityId, skillName, label = "") {
  if (!active(p) || !OFFICIAL_DS_NAMES.includes(skillName)) return p;
  const cur = toArray(p.battle.grantedDs?.[entityId]);
  if (cur.includes(skillName)) return p;
  return {
    ...withBattle(p, { grantedDs: { ...(p.battle.grantedDs || {}), [entityId]: [...cur, skillName] } }),
    log: logOf(p, `✦ GM: ${label ? `${label}：` : ""}${entityName(p, entityId)} はこのラウンド中《${skillName}》を修得している`),
  };
}

export function revokeSkill(p, entityId, skillName) {
  const cur = toArray(p.battle?.grantedDs?.[entityId]);
  if (!cur.includes(skillName)) return p;
  return {
    ...withBattle(p, { grantedDs: { ...p.battle.grantedDs, [entityId]: cur.filter(s => s !== skillName) } }),
    log: logOf(p, `✦ GM: ${entityName(p, entityId)} の《${skillName}》（一時修得）を外した`),
  };
}

// 一時修得スキルをエンティティに載せる（hasOfficialSkill が battleGrantDs を見る）。付与が無ければ同じ参照を返す
export function withGrants(b, entity) {
  if (!entity) return entity;
  const id = entity.uid || entity.id;
  const g = toArray(b?.grantedDs?.[id]);
  return g.length ? { ...entity, battleGrantDs: g } : entity;
}

// ラウンド終了時のリセット項目（handleCleanup が battle に混ぜる）
export const ROUND_RESET = { grantedDs: null, extraEvade: null };
