// GM 介入ツールの純粋ロジック（React/Firebase 非依存・単体テスト対象）。
// シナリオ独自の処理を Editor に作り込む代わりに、セッション中に GM が
//   ・PL にダイスを振らせる（ダイス要求。目標値つきなら行為判定として応援も可）
//   ・PL に選択させる／告知する（選択要求・告知）
//   ・臨時の弾幕ごっこを始める（終了後は中断したシーンへ戻る）
// を行えるようにする。いずれも gs の更新関数（upd に渡す p => next）として書き、
// トランザクションで再実行されても結果が変わらないよう、乱数は呼び出し側で振って引数で渡す。
import { SPECIAL_BOND_CHEER, KURUWASU_BOND, BAD_STATUS_TABLE, buildBattleNpc } from "./session/shared";
import { getActiveAbility } from "./data/abilityEffects";
import { TABLE_DICE, tableDiceCount, tableValue, lookupTable, itemByName, giveItem } from "./customRules";

const toArray = (v) => Array.isArray(v) ? v : (v && typeof v === "object" ? Object.values(v) : []);

// ─── 要求（gs.gmRequests） ───────────────────────────────────────
// { id, kind: "dice"|"choice"|"notice", title, text, targets: [uid], createdAt,
//   dice?: { count, mode: "nd6"|"d66", target? }, options?: [string],
//   table?: { id, name, dice, rows, give? }   ← カスタム表を振らせる場合（作成時点の表を写して持つ。give=結果と同名の独自アイテムを渡す）
//   responses: { [uid]: { dice?, cheers?, confirmed?, choice?, ack?, byGm? } } }
export const REQUEST_KINDS = { dice: "ダイス", choice: "選択", notice: "告知" };
export const MAX_REQUESTS = 12;

export const getRequests = (gs) => toArray(gs?.gmRequests).filter(Boolean);

const pcName = (p, uid) => (p.pcs || []).find(x => x.uid === uid)?.charName || "？";

const diceText = (d) => d.mode === "d66" ? "D66" : `${d.count}D6`;
const reqDiceText = (r) => r.table ? `表「${r.table.name}」(${TABLE_DICE[r.table.dice] || r.table.dice})` : diceText(r.dice);

// 表の要求の結果 { value, text, item }（振っていなければ null）
export function tableResult(req, resp, gs) {
  const dice = toArray(resp?.dice);
  if (!req?.table || !dice.length) return null;
  const value = tableValue(req.table.dice, dice);
  const text = lookupTable(req.table, value)?.text || null;
  return { value, text, item: text && gs ? itemByName(gs, text) : null };
}

// 要求を作る。spec: { kind, title, text, targets, dice?, options? }。id/createdAt は呼び出し側で決める。
export function addRequest(p, spec, id, now) {
  const targets = [...new Set((spec.targets || []).filter(Boolean))];
  if (!targets.length) return p;
  const req = { id, kind: spec.kind, title: (spec.title || "").trim(), text: (spec.text || "").trim(), targets, createdAt: now, responses: {} };
  if (spec.kind === "dice" && spec.table?.id) {
    const t = spec.table;
    const rows = toArray(t.rows).filter(Boolean);
    if (!rows.length) return p;
    req.table = { id: t.id, name: t.name || "表", dice: t.dice, rows, ...(t.give ? { give: true } : {}) };
    req.dice = t.dice === "d66" ? { count: 2, mode: "d66" } : { count: tableDiceCount(t.dice), mode: "nd6" };
  } else if (spec.kind === "dice") {
    const mode = spec.dice?.mode === "d66" ? "d66" : "nd6";
    const count = mode === "d66" ? 2 : Math.max(1, Math.min(10, parseInt(spec.dice?.count) || 1));
    const target = mode === "nd6" && spec.dice?.target ? Math.max(1, Math.min(6, parseInt(spec.dice.target) || 0)) : null;
    req.dice = { count, mode, ...(target ? { target } : {}) };
  }
  if (spec.kind === "choice") {
    req.options = (spec.options || []).map(s => String(s).trim()).filter(Boolean);
    if (req.options.length < 2) return p;
  }
  const names = targets.map(uid => pcName(p, uid)).join("・");
  const head = spec.kind === "dice"
    ? `🎲 GM: ${names} に${req.title ? `「${req.title}」の` : ""}${reqDiceText(req)}${req.dice.target ? `（目標値${req.dice.target}）` : ""}を要求`
    : spec.kind === "choice"
    ? `❓ GM: ${names} に選択を要求${req.title ? `「${req.title}」` : ""}（${req.options.join(" / ")}）`
    : `📣 GM: ${req.title ? `「${req.title}」` : "告知"}${req.text ? ` ${req.text}` : ""}`;
  return { ...p, gmRequests: [...getRequests(p), req].slice(-MAX_REQUESTS), log: [head, ...(p.log || [])] };
}

export function removeRequest(p, id) {
  return { ...p, gmRequests: getRequests(p).filter(r => r.id !== id) };
}

const patchResponse = (p, id, uid, fn) => {
  let hit = false;
  const gmRequests = getRequests(p).map(r => {
    if (r.id !== id || !(r.targets || []).includes(uid)) return r;
    const cur = (r.responses || {})[uid] || {};
    const next = fn(cur, r);
    if (next === cur) return r;
    hit = true;
    return { ...r, responses: { ...(r.responses || {}), [uid]: next } };
  });
  return hit ? { ...p, gmRequests } : null;
};

export const d66Value = (dice) => Math.min(dice[0], dice[1]) * 10 + Math.max(dice[0], dice[1]);

// 行為判定の評価（探索/クエストと同じ基準）: 最大値≧目標で成功、全て1でファンブル、6を含めばスペシャル。
// unlucky = 《自分も含めて不運にする程度の能力》（全て2以下でファンブル）
// fragile = 失敗するとファンブルになる応援（魂の弱い所／人を狂わす）を受けた判定
export function evalJudgment(dice, target, unlucky = false, fragile = false) {
  const arr = toArray(dice);
  if (!arr.length) return null;
  const max = Math.max(...arr);
  const baseFumble = arr.every(d => d === 1) || (unlucky && arr.every(d => d <= 2));
  const isFumble = baseFumble || (fragile && max < target);
  const success = max >= target && !isFumble;
  const isSpecial = arr.includes(6) && !isFumble;
  return { max, success, isFumble, isSpecial };
}

// その判定が「失敗でファンブル」の応援を受けているか
export const isFragileResp = (resp) => toArray(resp?.cheers).some(c => c?.fragile);

export function describeDice(req, resp, unlucky = false) {
  const dice = toArray(resp?.dice);
  if (!dice.length) return "";
  if (req.table) {
    const v = tableValue(req.table.dice, dice);
    return `${v}${req.table.dice === "d6" ? "" : `（${dice.join(",")}）`} → ${lookupTable(req.table, v)?.text || "（該当なし）"}`;
  }
  if (req.dice?.mode === "d66") return `D66 → ${d66Value(dice)}（${dice.join(",")}）`;
  const base = `${dice.join(",")}${dice.length > 1 ? `（合計${dice.reduce((a, b) => a + b, 0)}）` : ""}`;
  if (!req.dice?.target) return base;
  const j = evalJudgment(dice, req.dice.target, unlucky, isFragileResp(resp));
  const verdict = j.isFumble ? "ファンブル" : j.success ? (j.isSpecial ? "成功・スペシャル" : "成功") : (j.isSpecial ? "失敗（スペシャル）" : "失敗");
  return `${base} → ${verdict}`;
}

// ダイス要求に振った結果を記録（dice は呼び出し側で振る）。目標値なしならその場で確定。
// 表の要求で give 指定なら、結果と同名の独自アイテムを渡す（iid は呼び出し側で決める）。
export function respondDice(p, id, uid, dice, byGm = false, iid = null) {
  const next = patchResponse(p, id, uid, (cur, r) => {
    if (toArray(cur.dice).length) return cur; // 二重振り防止
    return { ...cur, dice, ...(r.dice?.target ? {} : { confirmed: true }), ...(byGm ? { byGm: true } : {}) };
  });
  if (!next) return p;
  const req = getRequests(next).find(r => r.id === id);
  const resp = req.responses[uid];
  const label = req.title ? `「${req.title}」` : req.table ? `表「${req.table.name}」` : "ダイス要求";
  const logged = { ...next, log: [`🎲 ${pcName(p, uid)} の${label}: ${describeDice(req, resp, p.unluckyPhase)}${byGm ? "（GM代理）" : ""}`, ...(p.log || [])] };
  const item = req.table?.give && iid ? tableResult(req, resp, logged)?.item : null;
  return item ? giveTableItem(logged, id, uid, iid) : logged;
}

// 表の結果と同名の独自アイテムを、振った PC に渡す（1回だけ。responses[uid].given で記録）
export function giveTableItem(p, id, uid, iid) {
  const req = getRequests(p).find(r => r.id === id);
  const resp = req?.responses?.[uid];
  const item = tableResult(req, resp, p)?.item;
  if (!item || resp.given || !iid) return p;
  // 先に渡し、実際に渡せた（PC がいる）ときだけ「渡し済み」にする（同じ更新の中で両方）
  const granted = giveItem(p, uid, item.id, iid, `表「${req.table.name}」`);
  if (granted === p) return p;
  return patchResponse(granted, id, uid, (cur) => ({ ...cur, given: true })) || p;
}

// 応援（判定後の振り足し）。応援者の絆の消費は cheerConsumePatch。
// fragile = 失敗でファンブルになる応援（魂の弱い所／人を狂わす）。cheers に記録し、判定の評価に反映する。
export function addCheerDice(p, id, judgeUid, cheererUid, bondName, dice, fragile = false) {
  // 応援できるかをトランザクション内の最新の状態で確かめ直す（振っている間に移動した・絆を使い切った等）
  const judge = (p.pcs || []).find(x => x.uid === judgeUid);
  if (!judge || !cheerOptions(p.pcs, judge).some(o => o.cheerer.uid === cheererUid && o.bondName === bondName && !!o.fragile === !!fragile)) return p;
  let added = false;
  const next = patchResponse(p, id, judgeUid, (cur) => {
    if (!toArray(cur.dice).length || cur.confirmed) return cur;
    added = true;
    const cheer = { by: cheererUid, bond: bondName, ...(fragile ? { fragile: true } : {}) };
    return { ...cur, dice: [...toArray(cur.dice), ...dice], cheers: [...toArray(cur.cheers), cheer] };
  });
  if (!next || !added) return p;
  const pcs = next.pcs.map(x => x.uid !== cheererUid ? x : { ...x, ...cheerConsumePatch(x, bondName, judgeUid) });
  const cheerer = p.pcs.find(x => x.uid === cheererUid);
  const how = bondName === KURUWASU_BOND ? "絆なしで"
    : bondName === SPECIAL_BOND_CHEER ? `《${cheerer?.specialBond?.target}への${cheerer?.specialBond?.word || "敬意"}》で` : `《${bondName}》で`;
  return { ...next, pcs, log: [`💪 ${cheerer?.charName} が${how}応援！ダイスを${dice.length}個振り足した（出目${dice.join(",")}）${fragile ? "（失敗でファンブル）" : ""}`, ...(p.log || [])] };
}

export function confirmDice(p, id, uid) {
  const next = patchResponse(p, id, uid, (cur) => (!toArray(cur.dice).length || cur.confirmed) ? cur : { ...cur, confirmed: true });
  if (!next) return p;
  const req = getRequests(next).find(r => r.id === id);
  return { ...next, log: [`✅ ${pcName(p, uid)} の判定確定: ${describeDice(req, req.responses[uid], p.unluckyPhase)}`, ...(p.log || [])] };
}

export function respondChoice(p, id, uid, idx, byGm = false) {
  const next = patchResponse(p, id, uid, (cur, r) => (cur.choice != null || !r.options?.[idx]) ? cur : { ...cur, choice: idx, ...(byGm ? { byGm: true } : {}) });
  if (!next) return p;
  const req = getRequests(next).find(r => r.id === id);
  return { ...next, log: [`❓ ${pcName(p, uid)} の選択${req.title ? `「${req.title}」` : ""}: ${req.options[idx]}${byGm ? "（GM代理）" : ""}`, ...(p.log || [])] };
}

export function ackNotice(p, id, uid) {
  return patchResponse(p, id, uid, (cur) => cur.ack ? cur : { ...cur, ack: true }) || p;
}

// 回答済みか（ダイス=確定済み / 選択=選んだ / 告知=確認した）
export function isAnswered(req, uid) {
  const r = (req.responses || {})[uid];
  if (!r) return false;
  return req.kind === "dice" ? !!r.confirmed : req.kind === "choice" ? r.choice != null : !!r.ack;
}

// uid にとって操作が必要な要求（自分が対象で未回答）
export const pendingFor = (gs, uid) => getRequests(gs).filter(r => (r.targets || []).includes(uid) && !isAnswered(r, uid));

// ─── 応援（探索/クエストと共通の判定） ─────────────────────────────
// 《judge への絆》（自分の判定なら自身絆、我儘なら全絆）で、未使用のもの
export function getCheerBonds(cheerer, judgePc) {
  const usedOf = (b) => cheerer.bondUsed?.[b];
  if (cheerer.uid === judgePc.uid) {
    if (cheerer.ps?.name === "我儘") return (cheerer.bonds || []).filter(b => !usedOf(b));
    const selfBonds = [`${judgePc.charName}自身への絆`, `${judgePc.charName}への絆`];
    return selfBonds.filter(sb => (cheerer.bonds || []).includes(sb) && !usedOf(sb));
  }
  const bondName = `${judgePc.charName}への絆`;
  return (cheerer.bonds || []).includes(bondName) && !usedOf(bondName) ? [bondName] : [];
}

// 特別な絆（成長）による応援
export function getSpecialBondCheer(cheerer, judgePc) {
  const sb = cheerer.specialBond;
  if (!sb || sb.targetUid !== judgePc.uid || cheerer.uid === judgePc.uid || sb.used) return [];
  return [SPECIAL_BOND_CHEER];
}

// 魂の弱い所に入り込む程度の能力（オート）: 使用済み（黒い応援欄）の絆でも応援できる。失敗でファンブル。
export function getFragileCheerBonds(cheerer, judgePc) {
  if (cheerer.uid === judgePc.uid) return [];
  const name = getActiveAbility(cheerer)?.name;
  if (name !== "魂の弱い所に入り込む程度の能力" && name !== "魂の弱い所に入り込む程度の能力＋") return [];
  const bondName = `${judgePc.charName}への絆`;
  // すでに使用済み（bondUsed）の絆を持つ場合のみ（未使用なら通常応援で出る）
  return ((cheerer.bonds || []).includes(bondName) && cheerer.bondUsed?.[bondName]) ? [bondName] : [];
}

// 人を狂わす程度の能力（サポート）: 絆を持たない相手にも応援できる（相手ごとに1回・kuruwasuUsed で近似）。失敗でファンブル。
export function getKuruwasuCheer(cheerer, judgePc) {
  if (cheerer.uid === judgePc.uid) return [];
  const name = getActiveAbility(cheerer)?.name;
  if (name !== "人を狂わす程度の能力" && name !== "人を狂わす程度の能力＋") return [];
  if ((cheerer.bonds || []).includes(`${judgePc.charName}への絆`)) return []; // 絆を持つなら通常応援
  if (cheerer.kuruwasuUsed?.[judgePc.uid]) return [];                        // この相手には使用済み
  return [KURUWASU_BOND];
}

// 応援者の消費（絆なし応援は kuruwasuUsed[判定者]、特別な絆は specialBond.used、通常は bondUsed[絆名]）
export const cheerConsumePatch = (x, bondName, judgeUid) =>
  bondName === KURUWASU_BOND
    ? { kuruwasuUsed: { ...(x.kuruwasuUsed || {}), [judgeUid]: true } }
    : bondName === SPECIAL_BOND_CHEER
    ? { specialBond: { ...x.specialBond, used: true } }
    : { bondUsed: { ...(x.bondUsed || {}), [bondName]: true } };

// 同スポットの PC による応援候補 [{ cheerer, bondName, diceN, fragile }]
export function cheerOptions(pcs, judgePc) {
  const out = [];
  (pcs || []).forEach(cheerer => {
    if (cheerer.currentSpot !== judgePc.currentSpot) return;
    getCheerBonds(cheerer, judgePc).forEach(bondName => out.push({ cheerer, bondName, diceN: 1, fragile: false }));
    getSpecialBondCheer(cheerer, judgePc).forEach(bondName =>
      out.push({ cheerer, bondName, diceN: (cheerer.specialBond?.intimacy ?? 1) >= 10 ? 2 : 1, fragile: false }));
    getFragileCheerBonds(cheerer, judgePc).forEach(bondName => out.push({ cheerer, bondName, diceN: 1, fragile: true }));
    getKuruwasuCheer(cheerer, judgePc).forEach(bondName => out.push({ cheerer, bondName, diceN: 1, fragile: true }));
  });
  return out;
}

// ─── 臨時の弾幕ごっこ ───────────────────────────────────────────
// シナリオに登録された敵（クエスト敵・集団戦の追加敵・決戦の敵/候補）を名前で重複排除して列挙
export function scenarioEnemies(scenarioData) {
  const sd = scenarioData || {};
  const list = [];
  toArray(sd.quests).forEach(q => {
    if (q?.enemy) list.push({ enemy: q.enemy, from: `クエスト「${q.name || ""}」` });
    toArray(q?.extraEnemies).forEach(e => list.push({ enemy: e, from: `クエスト「${q.name || ""}」追加敵` }));
  });
  toArray(sd.finalBattleEnemies).forEach(e => list.push({ enemy: e, from: "決戦" }));
  toArray(sd.finalBattleOptionalEnemies).forEach(e => list.push({ enemy: e, from: "決戦候補" }));
  const seen = new Set();
  return list.filter(({ enemy }) => {
    const key = `${enemy?.name || ""}|${enemy?.life}|${enemy?.attack}`;
    if (!enemy?.name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 臨時の弾幕ごっこを開始する。進行中のシーンは battle.resumeScene に退避し、終了時に戻す。
export function startAdhocBattle(p, { enemies, participantPcUids, title }, stamp) {
  const npcs = toArray(enemies).map((en, i) => buildBattleNpc(en, `adhoc_${i}_${stamp}`)).filter(Boolean);
  const uids = toArray(participantPcUids).filter(Boolean);
  if (!npcs.length || !uids.length || p.battle?.active) return p;
  const label = (title || "").trim() || npcs.map(n => n.name).join("・");
  return {
    ...p,
    currentScene: null,
    battle: {
      active: true,
      type: npcs.length > 1 || uids.length > 1 ? "mass" : "normal",
      phase: "setup",
      adhoc: true,
      isFinal: false, // 集団戦（mass）でも決戦ではない（旧形式の「mass かつ questId なし＝決戦」判定に掛からないように）
      title: label,
      participantPcUids: uids,
      ...(p.currentScene?.pcUid ? { scenePcUid: p.currentScene.pcUid } : {}),
      ...(p.currentScene ? { resumeScene: p.currentScene } : {}),
      participants: { npcs },
    },
    log: [`⚔ GM: 弾幕ごっこ「${label}」を開始！（${uids.map(u => pcName(p, u)).join("・")} vs ${npcs.map(n => n.name).join("・")}）`, ...(p.log || [])],
  };
}

// 戦闘を閉じるときの共通パッチ: 中断していたシーンを戻し、退避データを消す
export function closeBattlePatch(p) {
  const resume = p.battle?.resumeScene;
  const { resumeScene: _r, ...rest } = p.battle || {};
  return { currentScene: resume || p.currentScene || null, battle: { ...rest, active: false } };
}

// ─── PC の GM 編集 ─────────────────────────────────────────────
export const BAD_STATUS_NAMES = Object.values(BAD_STATUS_TABLE).map(x => x.name);

const mapPc = (p, uid, fn) => ({ ...p, pcs: (p.pcs || []).map(x => x.uid === uid ? fn(x) : x) });
const withLog = (p, line) => ({ ...p, log: [line, ...(p.log || [])] });

export function gmAddBadStatus(p, uid, name) {
  const pc = (p.pcs || []).find(x => x.uid === uid);
  if (!pc || !name || (pc.badStatus || []).includes(name)) return p;
  return withLog(mapPc(p, uid, x => ({ ...x, badStatus: [...(x.badStatus || []), name] })), `★ GM: ${pc.charName} に変調《${name}》を付与`);
}

export function gmAddBond(p, uid, bond) {
  const pc = (p.pcs || []).find(x => x.uid === uid);
  const b = (bond || "").trim();
  if (!pc || !b) return p;
  return withLog(mapPc(p, uid, x => ({
    ...x,
    bonds: (x.bonds || []).includes(b) ? x.bonds : [...(x.bonds || []), b],
    bondUsed: { ...(x.bondUsed || {}), [b]: false },
  })), `💙 GM: ${pc.charName} が《${b}》を獲得`);
}

export function gmRemoveBond(p, uid, bond) {
  const pc = (p.pcs || []).find(x => x.uid === uid);
  if (!pc || !(pc.bonds || []).includes(bond)) return p;
  return withLog(mapPc(p, uid, x => {
    const { [bond]: _u, ...bondUsed } = x.bondUsed || {};
    return { ...x, bonds: (x.bonds || []).filter(b => b !== bond), bondUsed };
  }), `GM: ${pc.charName} の《${bond}》を削除`);
}

export function gmToggleBondUsed(p, uid, bond) {
  const pc = (p.pcs || []).find(x => x.uid === uid);
  if (!pc) return p;
  const used = !pc.bondUsed?.[bond];
  return withLog(mapPc(p, uid, x => ({ ...x, bondUsed: { ...(x.bondUsed || {}), [bond]: used } })),
    `GM: ${pc.charName} の《${bond}》の応援欄を${used ? "使用済み" : "未使用"}にした`);
}

export function gmMovePc(p, uid, spotId, spotName) {
  const pc = (p.pcs || []).find(x => x.uid === uid);
  if (!pc || spotId == null || spotId === "" || pc.currentSpot === spotId) return p;
  return withLog(mapPc(p, uid, x => ({ ...x, currentSpot: spotId, offMap: null })), `🏃 GM: ${pc.charName} を [${spotName || spotId}] へ移動`);
}

export function gmToggleActed(p, uid) {
  const pc = (p.pcs || []).find(x => x.uid === uid);
  if (!pc) return p;
  const acted = toArray(p.actedPcs);
  const was = acted.includes(uid);
  return withLog({ ...p, actedPcs: was ? acted.filter(u => u !== uid) : [...acted, uid] },
    `GM: ${pc.charName} を${was ? "未行動" : "行動済み"}にした`);
}

export function gmResetAbilityUse(p, uid) {
  const pc = (p.pcs || []).find(x => x.uid === uid);
  if (!pc) return p;
  return withLog(mapPc(p, uid, x => ({ ...x, abilityUse: null })), `GM: ${pc.charName} の能力スキルの使用回数をリセット`);
}

export function gmAdjustMax(p, uid, key, delta) {
  const pc = (p.pcs || []).find(x => x.uid === uid);
  const r = pc?.resources?.[key];
  if (!r) return p;
  const max = Math.max(1, (r.max ?? 1) + delta);
  if (max === r.max) return p;
  return withLog(mapPc(p, uid, x => ({ ...x, resources: { ...x.resources, [key]: { ...r, max, cur: Math.min(r.cur ?? 0, max) } } })),
    `GM: ${pc.charName} の【${key}】の最大値 ${r.max}→${max}`);
}
