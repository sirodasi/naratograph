// 異変再現などの「独自要素」を GM がセッション中に組み立てて運用するための純粋ロジック
// （React/Firebase 非依存・単体テスト対象: src/__tests__/customRules.test.js）。
//
// 定義（何があるか）は gs.custom に、値（いくつか・誰が持つか）は各所に置く:
//   gs.custom = {
//     stats:  [{ id, name, scope: "pc"|"global"|"battle", min, max?, init }],  独自ステータス
//     global: { [statId]: n },                                                  全体共有ステータスの値
//     cats:   [{ id, name, cap? }],                                             独自アイテムの分類（所持上限）
//     items:  [{ id, name, desc, cat? }],                                       独自アイテム
//     tables: [{ id, name, dice: "d6"|"2d6"|"d66", rows: [{ min, max, text }] }],カスタム表
//     tokens: [{ id, name, color, unique }],                                    マップの独自コマの種類
//     mapTokens: [{ id, kind, spot }],                                          マップ上に置かれた独自コマ
//     states: [{ id, name, desc, color }],                                      独自の状態
//     rules:  [{ id, title, text }],                                            ルールの掲示
//   }
//   pc.custom     = { vals: { [statId]: n }, items: [{ iid, def, used? }], states: [stateId] }
//   battle.customVals = { [statId]: n }   ← 戦闘中だけのステータス（戦闘ごとに作り直されるので自然にリセット）
//
// いずれも upd に渡す更新関数（p => next）。乱数は呼び出し側で振って引数で渡す（トランザクション再実行対策）。
import { CYCLES } from "./data/gameData";

const toArray = (v) => Array.isArray(v) ? v : (v && typeof v === "object" ? Object.values(v) : []);

export const STAT_SCOPES = { pc: "PC個別", global: "全体共有", battle: "戦闘中のみ" };
export const TABLE_DICE = { d6: "D6", "2d6": "2D6", d66: "D66" };
export const DEF_KINDS = ["stats", "cats", "items", "tables", "tokens", "states", "rules"];

// Firebase の空配列消失・疎配列のオブジェクト化に耐える読み出し
export function getCustom(gs) {
  const c = gs?.custom || {};
  const out = { global: c.global || {} };
  DEF_KINDS.forEach(k => { out[k] = toArray(c[k]).filter(Boolean); });
  out.mapTokens = toArray(c.mapTokens).filter(Boolean);
  out.tables = out.tables.map(t => ({ ...t, rows: toArray(t.rows).filter(Boolean) }));
  return out;
}

export const hasCustomContent = (gs) => {
  const c = getCustom(gs);
  return DEF_KINDS.some(k => c[k].length > 0);
};

const withCustom = (p, patch) => ({ ...p, custom: { ...(p.custom || {}), ...patch } });
const logOf = (p, msg) => [msg, ...(p.log || [])];
const pcName = (p, uid) => (p.pcs || []).find(x => x.uid === uid)?.charName || "？";
const mapPc = (p, uid, fn) => (p.pcs || []).map(x => x.uid === uid ? fn(x) : x);
const pcCustom = (pc) => {
  const c = pc?.custom || {};
  return { vals: c.vals || {}, items: toArray(c.items).filter(Boolean), states: toArray(c.states).filter(Boolean) };
};
export { pcCustom };

// ─── 定義の追加・更新・削除 ─────────────────────────────────────
export function upsertDef(p, kind, def) {
  if (!DEF_KINDS.includes(kind) || !def?.id) return p;
  const list = getCustom(p)[kind];
  const exists = list.some(x => x.id === def.id);
  const next = exists ? list.map(x => x.id === def.id ? { ...x, ...def } : x) : [...list, def];
  return withCustom(p, { [kind]: next });
}

// 定義を消すと、それを参照している値・所持品・コマもまとめて片付ける
export function removeDef(p, kind, id) {
  const c = getCustom(p);
  const list = c[kind].filter(x => x.id !== id);
  let next = withCustom(p, { [kind]: list });
  if (kind === "stats") {
    const { [id]: _g, ...global } = c.global;
    next = withCustom(next, { global });
    next = { ...next, pcs: (next.pcs || []).map(pc => {
      const pcc = pcCustom(pc);
      if (!(id in pcc.vals)) return pc;
      const { [id]: _v, ...vals } = pcc.vals;
      return { ...pc, custom: { ...pc.custom, vals } };
    }) };
    if (next.battle?.customVals && id in next.battle.customVals) {
      const { [id]: _b, ...customVals } = next.battle.customVals;
      next = { ...next, battle: { ...next.battle, customVals } };
    }
  }
  if (kind === "items") {
    next = { ...next, pcs: (next.pcs || []).map(pc => {
      const pcc = pcCustom(pc);
      if (!pcc.items.some(it => it.def === id)) return pc;
      return { ...pc, custom: { ...pc.custom, items: pcc.items.filter(it => it.def !== id) } };
    }) };
  }
  if (kind === "cats") {
    next = withCustom(next, { items: getCustom(next).items.map(it => it.cat === id ? { ...it, cat: null } : it) });
  }
  if (kind === "tokens") next = withCustom(next, { mapTokens: c.mapTokens.filter(t => t.kind !== id) });
  if (kind === "states") {
    next = { ...next, pcs: (next.pcs || []).map(pc => {
      const pcc = pcCustom(pc);
      if (!pcc.states.includes(id)) return pc;
      return { ...pc, custom: { ...pc.custom, states: pcc.states.filter(s => s !== id) } };
    }) };
  }
  return next;
}

// ─── 独自ステータス ──────────────────────────────────────────────
const clampStat = (def, v) => {
  let n = Math.round(Number(v) || 0);
  if (def.min != null && def.min !== "") n = Math.max(Number(def.min), n);
  if (def.max != null && def.max !== "") n = Math.min(Number(def.max), n);
  return n;
};
const initOf = (def) => clampStat(def, def.init ?? 0);

// 現在値（未設定なら初期値）。scope=pc は uid 必須、battle は戦闘中のみ意味を持つ
export function getStatValue(gs, def, uid) {
  if (!def) return 0;
  if (def.scope === "global") return gs?.custom?.global?.[def.id] ?? initOf(def);
  if (def.scope === "battle") return gs?.battle?.customVals?.[def.id] ?? initOf(def);
  const pc = (gs?.pcs || []).find(x => x.uid === uid);
  return pcCustom(pc).vals[def.id] ?? initOf(def);
}

// 値を設定する（最小値・最大値で丸める）。変化が無ければ p をそのまま返す
export function setStat(p, statId, value, uid) {
  const def = getCustom(p).stats.find(s => s.id === statId);
  if (!def) return p;
  if (def.scope === "pc" && !uid) return p;
  if (def.scope === "battle" && !p.battle?.active) return p;
  const before = getStatValue(p, def, uid);
  const after = clampStat(def, value);
  if (before === after) return p;
  const who = def.scope === "pc" ? `${pcName(p, uid)} の` : "";
  const msg = `✨ GM: ${who}【${def.name}】${before} → ${after}`;
  if (def.scope === "global") {
    return { ...withCustom(p, { global: { ...getCustom(p).global, [statId]: after } }), log: logOf(p, msg) };
  }
  if (def.scope === "battle") {
    return { ...p, battle: { ...p.battle, customVals: { ...(p.battle.customVals || {}), [statId]: after } }, log: logOf(p, msg) };
  }
  return {
    ...p,
    pcs: mapPc(p, uid, pc => ({ ...pc, custom: { ...pc.custom, vals: { ...pcCustom(pc).vals, [statId]: after } } })),
    log: logOf(p, msg),
  };
}

export function adjustStat(p, statId, delta, uid) {
  const def = getCustom(p).stats.find(s => s.id === statId);
  if (!def) return p;
  return setStat(p, statId, getStatValue(p, def, uid) + delta, uid);
}

// ─── 独自アイテム ────────────────────────────────────────────────
// 分類の所持上限を超えるか（超えても付与はする。ルール上「1つ選んで捨てる」のでログで知らせる）
export function overCap(gs, uid, catId) {
  if (!catId) return null;
  const c = getCustom(gs);
  const cat = c.cats.find(x => x.id === catId);
  if (!cat?.cap) return null;
  const pc = (gs.pcs || []).find(x => x.uid === uid);
  const count = pcCustom(pc).items.filter(it => c.items.find(d => d.id === it.def)?.cat === catId).length;
  return count > Number(cat.cap) ? { cat, count } : null;
}

const capNote = (p, uid, catId) => {
  const o = overCap(p, uid, catId);
  return o ? `（⚠ ${o.cat.name}が上限${o.cat.cap}を超過：1つ選んで捨てること）` : "";
};

export function giveItem(p, uid, defId, iid, source = "GM") {
  const def = getCustom(p).items.find(x => x.id === defId);
  if (!def || !iid || !(p.pcs || []).some(x => x.uid === uid)) return p;
  const pcs = mapPc(p, uid, pc => ({ ...pc, custom: { ...pc.custom, items: [...pcCustom(pc).items, { iid, def: defId }] } }));
  const next = { ...p, pcs };
  return { ...next, log: logOf(p, `💰 ${source}: ${pcName(p, uid)} が【${def.name}】を獲得${capNote(next, uid, def.cat)}`) };
}

// how: "use"（使って失う）/ "discard"（捨てる）/ "gm"（GM が没収）
export function removeItem(p, uid, iid, how = "discard") {
  const pc = (p.pcs || []).find(x => x.uid === uid);
  const it = pcCustom(pc).items.find(x => x.iid === iid);
  if (!it) return p;
  const name = getCustom(p).items.find(d => d.id === it.def)?.name || "？";
  const verb = how === "use" ? "を使用した" : how === "gm" ? "を失った（GM）" : "を捨てた";
  return {
    ...p,
    pcs: mapPc(p, uid, x => ({ ...x, custom: { ...x.custom, items: pcCustom(x).items.filter(y => y.iid !== iid) } })),
    log: logOf(p, `${how === "use" ? "🔵" : "🗑"} ${pc.charName} が【${name}】${verb}`),
  };
}

// 使用済 ⇔ 未使用（アビリティカードの「使用」タイプ等）
export function toggleItemUsed(p, uid, iid) {
  const pc = (p.pcs || []).find(x => x.uid === uid);
  const it = pcCustom(pc).items.find(x => x.iid === iid);
  if (!it) return p;
  const name = getCustom(p).items.find(d => d.id === it.def)?.name || "？";
  return {
    ...p,
    pcs: mapPc(p, uid, x => ({ ...x, custom: { ...x.custom, items: pcCustom(x).items.map(y => y.iid === iid ? { ...y, used: !y.used } : y) } })),
    log: logOf(p, `🔵 ${pc.charName} の【${name}】を${it.used ? "未使用に戻した" : "使用済にした"}`),
  };
}

export function transferItem(p, fromUid, toUid, iid) {
  if (fromUid === toUid) return p;
  const from = (p.pcs || []).find(x => x.uid === fromUid);
  const it = pcCustom(from).items.find(x => x.iid === iid);
  if (!it || !(p.pcs || []).some(x => x.uid === toUid)) return p;
  const def = getCustom(p).items.find(d => d.id === it.def);
  const pcs = (p.pcs || []).map(x => {
    if (x.uid === fromUid) return { ...x, custom: { ...x.custom, items: pcCustom(x).items.filter(y => y.iid !== iid) } };
    if (x.uid === toUid) return { ...x, custom: { ...x.custom, items: [...pcCustom(x).items, it] } };
    return x;
  });
  const next = { ...p, pcs };
  return { ...next, log: logOf(p, `🔵 ${from.charName} が【${def?.name || "？"}】を ${pcName(p, toUid)} に渡した${capNote(next, toUid, def?.cat)}`) };
}

// ─── カスタム表 ──────────────────────────────────────────────────
// 「1-2 赤」「3 青」「11-16 不死鳥の尾」形式の行テキストを rows に変換（解釈できない行は無視）
export function parseTableRows(text) {
  return String(text || "").split("\n").map(line => {
    const m = line.trim().match(/^(\d+)\s*(?:[-~〜～ー]\s*(\d+))?\s*[:：\s]\s*(.+)$/);
    if (!m) return null;
    const a = parseInt(m[1]); const b = m[2] ? parseInt(m[2]) : a;
    return { min: Math.min(a, b), max: Math.max(a, b), text: m[3].trim() };
  }).filter(Boolean);
}

export const rowsToText = (rows) => toArray(rows).map(r => `${r.min === r.max ? r.min : `${r.min}-${r.max}`} ${r.text}`).join("\n");

export const tableDiceCount = (dice) => dice === "d6" ? 1 : 2;

// 振った出目 → 表の値（D66 は小さい方が十の位）
export function tableValue(dice, rolled) {
  if (dice === "d66") return Math.min(rolled[0], rolled[1]) * 10 + Math.max(rolled[0], rolled[1]);
  if (dice === "2d6") return rolled[0] + rolled[1];
  return rolled[0];
}

export function lookupTable(table, value) {
  return toArray(table?.rows).find(r => value >= r.min && value <= r.max) || null;
}

// 表を振った結果をログに残す（rolls は呼び出し側で振った出目の配列の配列）。結果一覧を返すのは UI 側で計算する
export function logTableRoll(p, tableId, rolls) {
  const t = getCustom(p).tables.find(x => x.id === tableId);
  if (!t || !rolls?.length) return p;
  const parts = rolls.map(r => {
    const v = tableValue(t.dice, r);
    return `${v}→${lookupTable(t, v)?.text || "（該当なし）"}`;
  });
  return { ...p, log: logOf(p, `🎲 表「${t.name}」(${TABLE_DICE[t.dice] || t.dice}): ${parts.join(" / ")}`) };
}

// 結果テキストと同名の独自アイテムがあれば返す（表の結果から直接渡すため）
export const itemByName = (gs, text) => getCustom(gs).items.find(d => d.name === String(text || "").trim()) || null;

// ─── マップの独自コマ ────────────────────────────────────────────
// spotIds の各スポットに kind のコマを置く。unique の種類は同じスポットに 2 つ置かない
export function placeTokens(p, kindId, spotIds, ids, spotName = (id) => id) {
  const c = getCustom(p);
  const kind = c.tokens.find(k => k.id === kindId);
  if (!kind) return p;
  const tokens = [...c.mapTokens];
  const placed = [];
  spotIds.forEach((spot, i) => {
    if (!spot || !ids[i]) return;
    if (kind.unique && tokens.some(t => t.kind === kindId && t.spot === spot)) return;
    tokens.push({ id: ids[i], kind: kindId, spot });
    placed.push(spotName(spot));
  });
  if (!placed.length) return p;
  return { ...withCustom(p, { mapTokens: tokens }), log: logOf(p, `📍 GM: 【${kind.name}】を配置（${placed.join("・")}）`) };
}

export function removeToken(p, tokenId, spotName = (id) => id) {
  const c = getCustom(p);
  const t = c.mapTokens.find(x => x.id === tokenId);
  if (!t) return p;
  const kind = c.tokens.find(k => k.id === t.kind);
  return { ...withCustom(p, { mapTokens: c.mapTokens.filter(x => x.id !== tokenId) }), log: logOf(p, `📍 GM: ${spotName(t.spot)} の【${kind?.name || "コマ"}】を取り除いた`) };
}

export function clearTokens(p, kindId) {
  const c = getCustom(p);
  const kind = c.tokens.find(k => k.id === kindId);
  const rest = c.mapTokens.filter(x => x.kind !== kindId);
  if (rest.length === c.mapTokens.length) return p;
  return { ...withCustom(p, { mapTokens: rest }), log: logOf(p, `📍 GM: 【${kind?.name || "コマ"}】を全て取り除いた`) };
}

// ランダム配置の候補（unique なら既に置かれたスポットを除く）
export function tokenCandidates(gs, kindId, spots) {
  const c = getCustom(gs);
  const kind = c.tokens.find(k => k.id === kindId);
  const taken = new Set(c.mapTokens.filter(t => t.kind === kindId).map(t => t.spot));
  return spots.filter(s => s.id !== "dream" && !(kind?.unique && taken.has(s.id)));
}

// ─── 独自の状態 ──────────────────────────────────────────────────
export function toggleState(p, uid, stateId) {
  const def = getCustom(p).states.find(s => s.id === stateId);
  const pc = (p.pcs || []).find(x => x.uid === uid);
  if (!def || !pc) return p;
  const has = pcCustom(pc).states.includes(stateId);
  return {
    ...p,
    pcs: mapPc(p, uid, x => ({ ...x, custom: { ...x.custom, states: has ? pcCustom(x).states.filter(s => s !== stateId) : [...pcCustom(x).states, stateId] } })),
    log: logOf(p, has ? `✅ GM: ${pc.charName} の《${def.name}》が解除された` : `★ GM: ${pc.charName} が《${def.name}》になった`),
  };
}

// ─── 時間操作 ────────────────────────────────────────────────────
const clockLabel = (day, ci) => `${day}日目・${CYCLES[ci]}`;

// 日付とサイクルを直接設定する（行動済み・シーン・霊力増加の済みフラグはリセット）
export function setClock(p, day, cycleIdx) {
  const d = Math.max(1, Math.min(9, parseInt(day) || 1));
  const ci = Math.max(0, Math.min(CYCLES.length - 1, parseInt(cycleIdx) || 0));
  if (d === (p.day || 1) && ci === (p.cycleIdx || 0)) return p;
  const dayChanged = d !== (p.day || 1);
  return {
    ...p, day: d, cycleIdx: ci,
    actedPcs: [], currentScene: null, reiryokuDone: false,
    ...(dayChanged ? { newspaper: null, newspaperDone: false, cluePlaced: false } : {}),
    log: logOf(p, `⏳ GM: 時刻を ${clockLabel(p.day || 1, p.cycleIdx || 0)} → ${clockLabel(d, ci)} に変更`),
  };
}

// 現在のサイクルをもう一度行う（時刻は進めず、帰還・やる気減少もしない。永夜異変の繰り返し等）
export function repeatCycle(p) {
  return {
    ...p, actedPcs: [], currentScene: null, reiryokuDone: false,
    log: logOf(p, `⏳ GM: ${clockLabel(p.day || 1, p.cycleIdx || 0)}サイクルをもう一度行う`),
  };
}

export const limitLabel = (day, ci) => `${day}日目の${CYCLES[ci]}`;

export function setLimit(p, day, cycleIdx) {
  const d = Math.max(1, Math.min(9, parseInt(day) || 1));
  const ci = Math.max(0, Math.min(CYCLES.length - 1, parseInt(cycleIdx) || 0));
  const lim = limitLabel(d, ci);
  if (lim === (p.limit || "3日目の夜")) return p;
  return { ...p, limit: lim, log: logOf(p, `⏳ GM: リミットを ${p.limit || "3日目の夜"} → ${lim} に変更`) };
}

export function parseLimit(lim) {
  const m = String(lim || "3日目の夜").match(/^(\d+)日目の(.+)$/);
  return { day: m ? parseInt(m[1]) : 3, cycleIdx: m ? Math.max(0, CYCLES.indexOf(m[2])) : 3 };
}

// ─── ルールの掲示 ────────────────────────────────────────────────
// upsertDef(p, "rules", { id, title, text }) / removeDef(p, "rules", id) をそのまま使う。
// 掲示したことはログに残す
export function postRule(p, rule) {
  if (!rule?.id || !(rule.title || "").trim()) return p;
  const isNew = !getCustom(p).rules.some(r => r.id === rule.id);
  const next = upsertDef(p, "rules", { id: rule.id, title: rule.title.trim(), text: (rule.text || "").trim() });
  return isNew ? { ...next, log: logOf(p, `📜 GM: ルール「${rule.title.trim()}」を掲示した`) } : next;
}
