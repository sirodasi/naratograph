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
//     reminders: [{ id, timing, text, finalOnly? }],                           タイミングのメモ（GM にだけ表示）
//   }
//   pc.custom     = { vals: { [statId]: n }, items: [{ iid, def, used? }], states: [stateId] }
//   battle.customVals = { [statId]: n }   ← 戦闘中だけのステータス（戦闘ごとに作り直されるので自然にリセット）
//
// いずれも upd に渡す更新関数（p => next）。乱数は呼び出し側で振って引数で渡す（トランザクション再実行対策）。
import { CYCLES } from "./data/gameData";

const toArray = (v) => Array.isArray(v) ? v : (v && typeof v === "object" ? Object.values(v) : []);

export const STAT_SCOPES = { pc: "PC個別", global: "全体共有", battle: "戦闘中のみ" };
export const TABLE_DICE = { d6: "D6", "2d6": "2D6", d66: "D66" };
export const DEF_KINDS = ["stats", "cats", "items", "tables", "tokens", "states", "rules", "reminders"];

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

// ─── 異変再現プリセット（B） ─────────────────────────────────────
// プリセット = 定義一式（ステータス・分類・アイテム・表・コマ種類・状態・ルール文）＋任意の時刻設定。
//   { name, desc, defs: { stats, cats, items, tables, tokens, states, rules }, clock?: { day, cycleIdx, limitDay, limitCycleIdx } }
// 組み込み（公式）は src/data/ihenPresets.js、GM の自作は users/{uid}/ihenPresets/{id}。
// 適用時は各定義の id を「key__元の id」にして gs.custom へ入れるので、複数のプリセットを同時に使っても衝突せず、
// 同じプリセットを再適用すると同じ id に上書き（値は保持）、解除でそのプリセット由来の定義だけを消せる。
export const PRESET_SEP = "__";
export const baseId = (id) => String(id).split(PRESET_SEP).pop();
const PRESET_KINDS = DEF_KINDS; // stats, cats, items, tables, tokens, states, rules, reminders

// Firebase から読んだ（空配列が消えた・疎配列がオブジェクトになった）プリセットを整える
export function normalizePreset(raw) {
  if (!raw || typeof raw !== "object") return null;
  const defs = {};
  PRESET_KINDS.forEach(k => { defs[k] = toArray(raw.defs?.[k]).filter(Boolean); });
  defs.tables = defs.tables.map(t => ({ ...t, rows: toArray(t.rows).filter(Boolean) }));
  return { ...raw, name: raw.name || "（名称なし）", desc: raw.desc || "", defs };
}

export const presetSummary = (preset) => {
  const d = normalizePreset(preset)?.defs || {};
  const parts = [["stats", "ステータス"], ["items", "アイテム"], ["tables", "表"], ["tokens", "コマ"], ["states", "状態"], ["rules", "ルール"], ["reminders", "メモ"]]
    .map(([k, n]) => d[k]?.length ? `${n}${d[k].length}` : null).filter(Boolean);
  return parts.join("・") || "空";
};

export const appliedPresets = (gs) => toArray(gs?.custom?.applied).filter(Boolean);

// 現在の gs.custom の定義をプリセットとして書き出す（値・配置済みコマは含めない）
export function presetFromGs(gs, name, desc = "") {
  const c = getCustom(gs);
  const defs = {};
  PRESET_KINDS.forEach(k => {
    defs[k] = c[k].map(d => {
      const out = { ...d, id: baseId(d.id) };
      if (k === "items" && d.cat) out.cat = baseId(d.cat);
      return out;
    });
  });
  return { name: String(name || "").trim() || "（名称なし）", desc: String(desc || "").trim(), defs };
}

// opts: { pcCount, withClock }
export function applyPreset(p, preset0, key, opts = {}) {
  const preset = normalizePreset(preset0);
  if (!preset || !key) return p;
  const pid = (id) => `${key}${PRESET_SEP}${baseId(id)}`;
  let next = p;
  PRESET_KINDS.forEach(k => {
    preset.defs[k].forEach(d => {
      const def = { ...d, id: pid(d.id) };
      if (k === "items" && d.cat) def.cat = pid(d.cat);
      delete def.initFromPcCount;
      next = upsertDef(next, k, def);
    });
  });
  // 初期値が「PC の人数」の全体共有ステータス（刻符ノルマ等）。既に値があれば触らない（再適用で上書きしない）
  const global = { ...getCustom(next).global };
  preset.defs.stats.forEach(s => {
    if (s.scope === "global" && s.initFromPcCount && global[pid(s.id)] == null) global[pid(s.id)] = Math.max(0, opts.pcCount || 0);
  });
  const applied = [...appliedPresets(next).filter(a => a.key !== key), { key, name: preset.name }];
  next = withCustom(next, { global, applied });
  if (opts.withClock && preset.clock) {
    const { day, cycleIdx, limitDay, limitCycleIdx } = preset.clock;
    if (day) next = setClock(next, day, cycleIdx ?? 0);
    if (limitDay) next = setLimit(next, limitDay, limitCycleIdx ?? 3);
  }
  return { ...next, log: [`📜 GM: 異変再現「${preset.name}」を適用した`, ...(next.log || [])] };
}

// そのプリセット由来の定義（と値・所持品・コマ・状態）をまとめて外す
export function unapplyPreset(p, key) {
  const name = appliedPresets(p).find(a => a.key === key)?.name;
  const prefix = `${key}${PRESET_SEP}`;
  let next = p;
  PRESET_KINDS.forEach(k => {
    getCustom(next)[k].filter(d => String(d.id).startsWith(prefix)).forEach(d => { next = removeDef(next, k, d.id); });
  });
  next = withCustom(next, { applied: appliedPresets(next).filter(a => a.key !== key) });
  return { ...next, log: [`📜 GM: 異変再現「${name || key}」を解除した`, ...(p.log || [])] };
}

// ─── プリセットの JSON 書き出し・読み込み ─────────────────────────
// 他の GM と自作の異変再現を受け渡すためのファイル形式。
//   { format: PRESET_FILE_FORMAT, version, name, desc, defs, clock? }
// 読み込み時は中身を信用せず、種類ごとに既知の項目だけを取り出して整える（id は Firebase のキーにも使われるため安全な文字に）。
export const PRESET_FILE_FORMAT = "gensou-naratograph/ihen-preset";
export const PRESET_FILE_VERSION = 1;
const FILE_LIMITS = { defs: 200, rows: 100, name: 80, text: 4000 };

const str = (v, max = FILE_LIMITS.name) => (typeof v === "string" || typeof v === "number" ? String(v) : "").trim().slice(0, max);
const intOr = (v, fallback) => {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : fallback;
};
const clampInt = (v, lo, hi, fallback) => {
  const n = intOr(v, fallback);
  return n == null ? n : Math.max(lo, Math.min(hi, n));
};
const colorOr = (v) => (typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : undefined);
// 「.#$[]/」・空白・プリセット区切り（__）を含まない短い id にする
export const safeDefId = (id) => baseId(str(id, 60)).replace(/[.#$/[\]\s]/g, "_").replace(/_{2,}/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

const DEF_SANITIZERS = {
  stats: (d) => {
    const name = str(d.name);
    if (!name) return null;
    const scope = STAT_SCOPES[d.scope] ? d.scope : "pc";
    const out = { name, scope, min: intOr(d.min, null), max: intOr(d.max, null), init: intOr(d.init, 0) };
    if (scope === "global" && d.initFromPcCount === true) out.initFromPcCount = true;
    return out;
  },
  cats: (d) => { const name = str(d.name); return name ? { name, cap: intOr(d.cap, null) } : null; },
  items: (d) => { const name = str(d.name); return name ? { name, cat: d.cat ? safeDefId(d.cat) : null, desc: str(d.desc, FILE_LIMITS.text) } : null; },
  tables: (d) => {
    const name = str(d.name);
    if (!name) return null;
    const rows = toArray(d.rows).filter(r => r && typeof r === "object").slice(0, FILE_LIMITS.rows).map(r => {
      const min = intOr(r.min, null), max = intOr(r.max, min);
      return min == null ? null : { min, max: max ?? min, text: str(r.text, FILE_LIMITS.text) };
    }).filter(Boolean);
    return { name, dice: TABLE_DICE[d.dice] ? d.dice : "d6", rows };
  },
  tokens: (d) => { const name = str(d.name); return name ? { name, color: colorOr(d.color) || "#e8a0b8", unique: d.unique !== false } : null; },
  states: (d) => { const name = str(d.name); return name ? { name, desc: str(d.desc, FILE_LIMITS.text), color: colorOr(d.color) || "#e8a0b8" } : null; },
  rules: (d) => { const title = str(d.title); return title ? { title, text: str(d.text, FILE_LIMITS.text) } : null; },
  reminders: (d) => {
    const text = str(d.text, FILE_LIMITS.text);
    if (!text || !REMINDER_TIMINGS.some(t => t.key === d.timing)) return null;
    return { timing: d.timing, text, finalOnly: isBattleTiming(d.timing) && d.finalOnly === true };
  },
};

// 任意のオブジェクトを安全なプリセットに整える（不正な定義は捨てる）。読み込みと編集画面の保存で使う
export function sanitizePreset(raw) {
  if (!raw || typeof raw !== "object") return null;
  const defs = {};
  PRESET_KINDS.forEach(k => {
    const used = new Set();
    defs[k] = toArray(raw.defs?.[k]).filter(d => d && typeof d === "object").slice(0, FILE_LIMITS.defs).map((d, i) => {
      const body = DEF_SANITIZERS[k](d);
      if (!body) return null;
      let id = safeDefId(d.id) || `${k.slice(0, 2)}${i + 1}`;
      while (used.has(id)) id = `${id}_${i + 1}`;
      used.add(id);
      return { id, ...body };
    }).filter(Boolean);
  });
  // 存在しない分類への参照は外す
  const catIds = new Set(defs.cats.map(c => c.id));
  defs.items = defs.items.map(it => (it.cat && !catIds.has(it.cat) ? { ...it, cat: null } : it));
  const out = { name: str(raw.name) || "（名称なし）", desc: str(raw.desc, FILE_LIMITS.text), defs };
  const ck = raw.clock;
  if (ck && typeof ck === "object" && (ck.day || ck.limitDay)) {
    const clock = {};
    if (ck.day) { clock.day = clampInt(ck.day, 1, 9, 1); clock.cycleIdx = clampInt(ck.cycleIdx, 0, 3, 0); }
    if (ck.limitDay) { clock.limitDay = clampInt(ck.limitDay, 1, 9, 3); clock.limitCycleIdx = clampInt(ck.limitCycleIdx, 0, 3, 3); }
    out.clock = clock;
  }
  return out;
}

const hasAnyDef = (preset) => PRESET_KINDS.some(k => preset.defs[k].length > 0);

// 書き出し用のオブジェクト（保存日時や Firebase の id は含めない）
export function presetToFile(preset) {
  const p = sanitizePreset(normalizePreset(preset)) || { name: "", desc: "", defs: {} };
  return { format: PRESET_FILE_FORMAT, version: PRESET_FILE_VERSION, name: p.name, desc: p.desc, defs: p.defs, ...(p.clock ? { clock: p.clock } : {}) };
}

export const presetFileName = (preset) => `異変再現_${(str(preset?.name) || "preset").replace(/[\\/:*?"<>|\s]+/g, "_")}.json`;

// ファイルの中身（文字列）→ { preset } または { error }
export function parsePresetFile(text) {
  let raw;
  try { raw = JSON.parse(String(text ?? "")); }
  catch { return { error: "JSON として読み込めませんでした" }; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "プリセットのファイルではありません" };
  if (raw.format !== undefined && raw.format !== PRESET_FILE_FORMAT) return { error: "異変再現プリセットのファイルではありません" };
  if (raw.format === undefined && (!raw.defs || typeof raw.defs !== "object")) return { error: "異変再現プリセットのファイルではありません" };
  if (Number(raw.version) > PRESET_FILE_VERSION) return { error: "新しい版のアプリで書き出されたファイルです。アプリを更新してから読み込んでください" };
  const preset = sanitizePreset(raw);
  if (!hasAnyDef(preset)) return { error: "読み込める定義がありませんでした" };
  return { preset };
}

// ─── タイミングのメモ（GM 向けリマインダー） ─────────────────────
// 自動処理はしない方針なので、「サイクル開始時にかけらを置く」などの手順を GM が忘れないよう、
// そのタイミングが来たら GM の画面にメモを出す。検出は GM クライアントが gs の変化から行う（gs には何も書かない）。
export const REMINDER_TIMINGS = [
  { key: "day_start", label: "日の開始時" },
  { key: "cycle_start", label: "サイクル開始時" },
  { key: "scene_start", label: "シーン開始時" },
  { key: "scene_end", label: "シーン終了時" },
  { key: "cycle_end", label: "サイクル終了時（全員が行動済み）" },
  { key: "battle_start", label: "弾幕ごっこ開始時", battle: true },
  { key: "round_start", label: "ラウンド開始時", battle: true },
  { key: "round_end", label: "ラウンド終了時", battle: true },
  { key: "battle_end", label: "弾幕ごっこ終了時", battle: true },
];
export const timingLabel = (key) => REMINDER_TIMINGS.find(t => t.key === key)?.label || key;
export const isBattleTiming = (key) => !!REMINDER_TIMINGS.find(t => t.key === key)?.battle;

// タイミング検出に使う gs の要約（前回との比較用）
export function timingSnapshot(gs) {
  const pcs = toArray(gs?.pcs).filter(Boolean);
  const acted = toArray(gs?.actedPcs);
  const b = gs?.battle;
  const active = !!b?.active;
  return {
    phase: gs?.sessionPhase || null,
    day: gs?.day || 1,
    ci: gs?.cycleIdx || 0,
    acted: acted.length,
    allActed: pcs.length > 0 && pcs.every(pc => acted.includes(pc.uid)),
    scene: gs?.currentScene?.pcUid || null,
    battle: active,
    final: active && !!(b.isFinal ?? (b.type === "mass" && !b.questId)),
    round: active ? (b.round || 1) : 0,
    bphase: active ? (b.phase || null) : null,
  };
}

const ROUND_ENDING = ["round_end_check", "cleanup"];

// 前回と今回の要約から、通過したタイミングを順に返す [{ key, final }]
export function detectTimings(prev, cur) {
  if (!prev || !cur) return [];
  const out = [];
  const push = (key, final = false) => out.push({ key, final });
  const explore = cur.phase === "explore" && !cur.battle;
  const endReady = (s) => s.phase === "explore" && !s.battle && s.allActed && !s.scene;

  // シーン（弾幕ごっこの前後で退避・復帰する分は数えない）
  if (!prev.battle && !cur.battle && prev.scene !== cur.scene) {
    if (prev.scene) push("scene_end");
  }
  // 弾幕ごっこの終了（ラウンド途中で決着した場合、ラウンド終了時のメモは出さない）
  if (prev.battle && !cur.battle) push("battle_end", prev.final);
  // サイクル
  if (explore) {
    const fromIntro = String(prev.phase || "").startsWith("intro");
    const clockMoved = prev.day !== cur.day || prev.ci !== cur.ci;
    const reset = prev.phase === "explore" && prev.allActed && prev.acted > 0 && cur.acted === 0; // 同じサイクルの繰り返し等
    const newCycle = fromIntro || clockMoved || reset;
    if (newCycle) {
      // 全員の行動を待たずに進めた場合も、終了時のメモはここで出す
      if (prev.phase === "explore" && !endReady(prev)) push("cycle_end");
      if (fromIntro || prev.day !== cur.day) push("day_start");
      push("cycle_start");
    } else if (endReady(cur) && !endReady(prev)) {
      push("cycle_end");
    }
  }
  if (!prev.battle && !cur.battle && prev.scene !== cur.scene && cur.scene) push("scene_start");

  // 弾幕ごっこ
  if (!prev.battle && cur.battle) {
    push("battle_start", cur.final);
    if (cur.bphase === "round_start") push("round_start", cur.final);
  } else if (prev.battle && cur.battle) {
    const ending = ROUND_ENDING.includes(cur.bphase);
    const wasEnding = ROUND_ENDING.includes(prev.bphase);
    if ((ending && !wasEnding) || (cur.round > prev.round && !wasEnding)) push("round_end", cur.final);
    if (cur.bphase === "round_start" && prev.bphase !== "round_start") push("round_start", cur.final);
  }
  return out;
}

// 通過したタイミングに登録されたメモ [{ key, label, final, items: [reminder] }]（メモの無いタイミングは除く）
export function remindersFor(gs, events) {
  const list = getCustom(gs).reminders;
  return toArray(events).map(ev => ({
    ...ev,
    label: timingLabel(ev.key),
    items: list.filter(r => r.timing === ev.key && (!r.finalOnly || ev.final)),
  })).filter(g => g.items.length > 0);
}
