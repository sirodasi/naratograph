// ゲームステート（gs = rooms/{code}/state）同期の純粋ロジック。
// React / Firebase に依存しないため単体テスト可能（src/__tests__/gsSync.test.js）。
//
// 書き込みは SessionApp.jsx の upd() が runTransaction で行う。トランザクションは競合時に
// サーバー値で更新関数を再実行するため、更新関数は「現在の gs → 次の gs」の純関数である必要がある。
// ここではその前後処理（正規化・ログ上限と退避・undefined 除去）を提供する。

import { OFFICIAL_DANMAKU_SKILLS } from "./data/gameData";
import { CHARACTERS, PERSONALITY_SKILLS } from "./data/characters";

const toArray = (v) => Array.isArray(v) ? v : (v && typeof v === "object" ? Object.values(v) : []);

export const LOG_CAP = 400; // gs.log の最大保持件数（超過分は rooms/{code}/logArchive へ退避）

export const DEFAULT_GS = {
  sessionPhase: "intro",
  day: 1,
  cycleIdx: 0,
  clues: [],
  newspaper: null,
  newspaperDone: false,
  cluePlaced: false,
  reiryokuDone: false,
  resources: { やる気: [1, 3], 残り人数: [2, 5], スペルカード: [1, 5], グレイズ: [0, 5], 霊力: [0, 20], 攻撃力: [1, 5] },
  items: { お酒: 0, 小銭: 0, お守り: 0, Pアイテム: 0, 残機のかけら: 0, スペカのかけら: 0 },
  quests: [],
  log: [],
  pcs: [],
  sceneMode: false,
  sceneText: "",
  banner: null,
  actedPcs: [],
  dice: { rolling: false, results: [], label: "" },
  diceHistory: [],
  bgm: { explore: "", battle: "", end: "" },
  currentScene: null,
};

// Firebase は値に undefined を含むと set が例外を投げる（"contains undefined in property ..."）。
// 空オブジェクト/配列を書くと除去される影響で、次回の読み戻しが undefined になり、それを再書込すると失敗する。
// 書込直前にオブジェクトのキーから undefined を再帰的に除去して防御する（ローカル state は元のまま）。
export function stripUndefined(v) {
  if (Array.isArray(v)) return v.map(stripUndefined).filter(x => x !== undefined);
  if (v && typeof v === "object") {
    const out = {};
    for (const k in v) if (v[k] !== undefined) out[k] = stripUndefined(v[k]);
    return out;
  }
  return v;
}

// シナリオデータの互換性チェックと正規化（旧仕様の dsType/dsName 等を nested ds に変換）
export function normalizeScenario(s) {
  if (!s) return s;
  const clone = { ...s };
  const normEnemy = (en) => {
    if (!en || en.ds) return en; // 既に正規化済み
    const type = en.dsType || (en.dsName ? "official" : (en.dsCustomName || en.dsDesc ? "custom" : "none"));
    const name = en.dsName || en.dsCustomName || "";
    const desc = en.dsDesc || (type === "official" ? (OFFICIAL_DANMAKU_SKILLS.find(x => x.name === en.dsName)?.desc || "") : en.dsDesc || "");
    return { ...en, ds: { type, name, desc, customName: en.dsCustomName || "" } };
  };
  // 秘匿後の公開版（quests 等を持たない）に空配列を足さないよう、存在する場合のみ正規化する
  if (s.finalBattleEnemies) clone.finalBattleEnemies = toArray(s.finalBattleEnemies).map(normEnemy);
  if (s.quests) clone.quests = toArray(s.quests).map(q => (!q || !q.enemy || q.enemy.ds) ? q : { ...q, enemy: normEnemy(q.enemy) });
  return clone;
}

export function normalizePc(p) {
  const charData = CHARACTERS.find(c => c.id === p.charId) ?? null;
  const personality = p.ps ?? (p.skillId ? {
    id:   p.skillId,
    name: p.skillName ?? PERSONALITY_SKILLS[p.skillId]?.name ?? "",
    type: PERSONALITY_SKILLS[p.skillId]?.type ?? null,
    desc: PERSONALITY_SKILLS[p.skillId]?.desc ?? null,
  } : null);
  return {
    ...p,
    as:  p.as  ?? charData?.as  ?? null,
    ds:  p.ds  ?? charData?.ds  ?? null,
    ps: personality,
    // currentSpot が空文字/未設定の既存データを救済（探索フェーズで "" だと移動・表示が壊れる）
    currentSpot: p.currentSpot || "11",
  };
}

// Firebase から読んだ生の state を、UI・更新関数が前提とする形に揃える。
// （Firebase は空配列を消し、疎な配列をオブジェクトで返すため、配列フィールドは必ず配列化する）
// raw が null/非オブジェクトなら null（＝ state 未作成）。
export function normalizeGs(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    ...DEFAULT_GS, ...raw,
    resources: { ...DEFAULT_GS.resources, ...(raw.resources || {}) },
    items:     { ...DEFAULT_GS.items,     ...(raw.items     || {}) },
    pcs:    toArray(raw.pcs).filter(Boolean).map(normalizePc),
    scenarioData: normalizeScenario(raw.scenarioData) ?? null,
    quests: toArray(raw.quests),
    clues:  toArray(raw.clues),
    log:    toArray(raw.log),
  };
}

// 1 回の更新を計算する（トランザクションの更新関数から呼ぶ純関数）。
//   prev: 正規化済みの現在値 / fn: 更新関数またはオブジェクト
// 戻り値:
//   next     … 書き込む値（ログは LOG_CAP 件に切り詰め済み・logBase 更新済み）
//   logGrew  … ログが増えた＝意味のある操作か（アンドゥ履歴の対象。切り詰め「前」の件数で判定）
//   archived … logArchive へ退避するエントリ { "e0000123": "..." }（無ければ null）
// 退避キーは通し番号（logBase 起点）なので、アンドゥ後に同じ範囲を再退避しても同じキーへの上書きで重複しない。
export function computeGsUpdate(prev, fn, logCap = LOG_CAP) {
  let next = typeof fn === "function" ? fn(prev) : fn;
  const logGrew = (next?.log?.length || 0) > (prev?.log?.length || 0);
  let archived = null;
  if (next?.log?.length > logCap) {
    const base = next.logBase ?? prev?.logBase ?? 0;
    const dropped = next.log.slice(logCap).reverse(); // prepend 運用なので末尾が最古 → 反転して古い順
    archived = {};
    // "e" 接頭辞: 数字だけのキーだと SDK が配列として読み戻すことがあるため
    dropped.forEach((entry, i) => { archived["e" + String(base + i).padStart(7, "0")] = entry; });
    next = { ...next, log: next.log.slice(0, logCap), logBase: base + dropped.length };
  }
  // どのクライアントの書き込みでも秘匿情報（シナリオの答え・未解決クエストの真相）を gs に載せない
  next = sanitizeGsForWrite(next);
  return { next, logGrew, archived };
}

// ─── シナリオ秘匿 ─────────────────────────────────────────────
// rooms/{code} 配下は参加者全員が読めるため、シナリオの答えや未登場の敵・クエストは
// roomSecrets/{code}/gm/scenarioData（GM のみ読める）に置き、gs / room には公開版だけを書く。
// GM のクライアントは秘匿版を合成して表示し（mergeScenarioSecret）、クエスト解決時の
// 真相公開・次クエスト解放は GM クライアントの reconcileQuests が行う。
// 終幕（epilogue/end）で GM が全文を公開すると gs.scenarioRevealed = true になり、以降は秘匿しない。

// GM 専用のフィールド（公開版から取り除く）
export const SECRET_SCENARIO_KEYS = ["quests", "finalBattleEnemies", "finalBattleOptionalEnemies", "phaseNotes", "notes"];

export function publicScenario(sd) {
  if (!sd || typeof sd !== "object") return sd ?? null;
  const out = { ...sd };
  const qs = toArray(sd.quests);
  if (qs.length) out.questCount = qs.length; // 全クエスト数だけは進行判定用に公開
  SECRET_SCENARIO_KEYS.forEach(k => { delete out[k]; });
  return out;
}

// 未解決クエストの真相は公開しない
// 公開用のクエスト: 未解決なら真相を外す。敵データ（能力・スペルカード）は解決の有無に関わらず外し、
// 「敵がいるか」だけを残す（戦闘の開始時に GM のクライアントが秘匿シナリオから補う。fillAwaitingEnemies）
export function publicQuest(q) {
  if (!q || typeof q !== "object") return q;
  let out = q;
  if (!q.solved && "truth" in q) { const { truth: _truth, ...rest } = out; out = rest; }
  if (out.enemy || out.extraEnemies) {
    const { enemy, extraEnemies, ...rest } = out;
    out = { ...rest, hasEnemy: !!enemy || !!out.hasEnemy, extraEnemyCount: toArray(extraEnemies).filter(Boolean).length };
  }
  return out;
}

// gs を書き込む直前に秘匿情報を取り除く（どのクライアントの書き込みでも漏れないように）
export function sanitizeGsForWrite(gs) {
  if (!gs || typeof gs !== "object" || gs.scenarioRevealed) return gs;
  return { ...gs, scenarioData: publicScenario(gs.scenarioData), quests: toArray(gs.quests).map(publicQuest) };
}

// GM 表示用: 公開 gs に秘匿シナリオを重ねる（未解決クエストの真相も GM には見せる）
export function mergeScenarioSecret(gs, secret) {
  if (!gs || !secret) return gs;
  const byId = new Map(toArray(secret.quests).filter(Boolean).map(q => [String(q.id), q]));
  return {
    ...gs,
    scenarioData: { ...(gs.scenarioData || {}), ...secret },
    // 公開版に無い真相と敵データを GM の表示用に戻す（公開の承認状況は rooms/{code}/questGate で別に管理する）
    quests: toArray(gs.quests).map(q => {
      const sq = q && byId.get(String(q.id));
      if (!sq) return q;
      let out = q;
      if (!q.truth && sq.truth) out = { ...out, truth: sq.truth };
      if (!q.enemy && sq.enemy) out = { ...out, enemy: sq.enemy, extraEnemies: sq.extraEnemies };
      return out;
    }),
  };
}

// ─── 公開 state と、画面・更新関数が扱う gs（ビュー）の変換 ─────────────
// Firebase 上では GM しか書けない／読めないデータを state の外に置き、クライアントでは従来どおり 1 つの gs として扱う。
//   ・GM の要求の定義（見出し・対象・ダイス・表…）: rooms/{code}/gmRequests/{id}（GM だけが書ける。全員が読める）
//     PL の回答は state.reqResponses[id][uid]（参加者が書ける）。ビューでは gs.gmRequests = [{ ...定義, responses }]
//   ・タイミングのメモ（GM 用）: roomSecrets/{code}/gm/custom/reminders（GM だけが読み書きできる）。ビューでは gs.custom.reminders
export const SECRET_CUSTOM_KEYS = ["reminders"];

const requestDefsList = (defs) => toArray(defs).filter(d => d && d.id)
  .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || String(a.id).localeCompare(String(b.id)));

// state（normalizeGs 済み）→ ビュー。secretCustom は GM のときだけ渡す
export function viewOfState(state, { requestDefs = null, secretCustom = null } = {}) {
  if (!state) return state;
  const { reqResponses = {}, gmRequests: _legacy, ...rest } = state;
  const view = {
    ...rest,
    gmRequests: requestDefsList(requestDefs).map(d => ({ ...d, responses: reqResponses?.[d.id] || {} })),
  };
  if (secretCustom) {
    const extra = {};
    SECRET_CUSTOM_KEYS.forEach(k => { if (secretCustom[k] != null) extra[k] = secretCustom[k]; });
    view.custom = { ...(view.custom || {}), ...extra };
  }
  return view;
}

// ビュー → { state, requestDefs, secretCustom }
//   prevState: 更新前の state（このクライアントが定義を知らない要求の回答は、消さずにそのまま残す）
//   knownIds: 更新前のビューにあった要求の id（このクライアントが定義を知っていたもの）
//   authoritative: GM（定義の正本を持つ）なら、定義の無い回答を片付ける
//   keepSecretCustom: true なら、state にある秘匿の独自要素（旧形式のタイミングのメモ）をそのまま残す。
//     PL の書き込みと、GM 用の場所へ写し終える前の GM の書き込みで使う（写す前に消して失わないように）
export function splitView(view, { prevState = null, knownIds = [], authoritative = false, keepSecretCustom = false } = {}) {
  if (!view || typeof view !== "object") return { state: view, requestDefs: null, secretCustom: null };
  const { gmRequests, ...rest } = view;
  const reqs = toArray(gmRequests).filter(r => r && r.id);
  const requestDefs = {};
  const fromView = {};
  reqs.forEach(({ responses, ...def }) => {
    requestDefs[def.id] = def;
    if (responses && Object.keys(responses).length) fromView[def.id] = responses;
  });
  const known = new Set(knownIds.map(String));
  const keep = {};
  if (!authoritative) {
    Object.entries(prevState?.reqResponses || {}).forEach(([id, resp]) => { if (!known.has(id) && !requestDefs[id]) keep[id] = resp; });
  }
  const reqResponses = { ...keep, ...fromView };
  let custom = rest.custom && typeof rest.custom === "object" ? { ...rest.custom } : rest.custom;
  const secretCustom = {};
  SECRET_CUSTOM_KEYS.forEach(k => {
    secretCustom[k] = (custom && typeof custom === "object") ? (custom[k] ?? null) : null;
    if (custom && typeof custom === "object") delete custom[k];
    // 旧形式の値は、更新後のビューの custom がどんな形（null・無し）でも残す
    if (keepSecretCustom && prevState?.custom?.[k] != null) {
      custom = { ...((custom && typeof custom === "object") ? custom : {}), [k]: prevState.custom[k] };
    }
  });
  const state = { ...rest, ...(custom !== undefined ? { custom } : {}), reqResponses: Object.keys(reqResponses).length ? reqResponses : null };
  return { state, requestDefs, secretCustom };
}

// 解決済みクエストへ真相を付与し、それを条件とするクエストを解放する。変更が無ければ null。
// onlyIds: 指定したクエスト（GM が公開を承認したもの）だけを対象にする。null なら解決済みのすべて（自動で公開する設定）
export function reconcileQuests(quests, scenarioQuests, onlyIds = null) {
  const scQs = toArray(scenarioQuests).filter(Boolean);
  if (!scQs.length) return null;
  const byId = new Map(scQs.map(q => [String(q.id), q]));
  const allowed = onlyIds ? new Set(toArray(onlyIds).map(String)) : null;
  const ok = (q) => !allowed || allowed.has(String(q?.id));
  let changed = false;
  const next = toArray(quests).map(q => {
    if (q?.solved && !q.truth && ok(q)) {
      const truth = byId.get(String(q.id))?.truth;
      if (truth) { changed = true; return { ...q, truth }; }
    }
    return q;
  });
  const have = new Set(next.map(q => String(q?.id)));
  // 次のクエストの解放も、真相を公開した（承認した）クエストの分だけ
  next.filter(q => q?.solved && ok(q)).forEach(sq => {
    scQs.forEach(scQ => {
      if (scQ.unlockType === "quest" && String(scQ.unlockQuestId) === String(sq.id) && !have.has(String(scQ.id))) {
        next.push(publicQuest({ ...scQ, revealed: true, solved: false, clues: 0 }));
        have.add(String(scQ.id));
        changed = true;
      }
    });
  });
  return changed ? next : null;
}

// ─── 旧形式のタイミングのメモの移行（state.custom.reminders → roomSecrets/{code}/gm/custom/reminders/{id}） ──
const reminderList = (v) => (Array.isArray(v) ? v : Object.values(v || {})).filter(r => r && r.id);
// GM 用の場所に無い旧形式のメモだけを { [id]: メモ } で返す（既にあるメモ・別タブで足されたメモは上書きしない）
export function legacyReminderPatch(legacy, onServer) {
  const have = new Set(reminderList(onServer).map(r => String(r.id)));
  return Object.fromEntries(reminderList(legacy).filter(r => !have.has(String(r.id))).map(r => [r.id, r]));
}
// 写した後のサーバーの値に、まだ無い旧形式のメモ（1件でもあれば state から消してはいけない）
export function missingLegacyReminders(legacy, onServer) {
  const have = new Set(reminderList(onServer).map(r => String(r.id)));
  return reminderList(legacy).filter(r => !have.has(String(r.id)));
}

// 配列の番号をキーにして保存されたメモを id キーへ直す（トランザクションの更新関数。変更が無ければ undefined＝中止）。
// 同じ id のキーが既にあれば、そちら（後から id キーで保存・編集されたもの）を優先し、番号キーの古い写しは消すだけにする
export function convertReminderKeys(cur) {
  if (!cur || typeof cur !== "object") return undefined;
  let changed = false;
  const next = { ...cur };
  Object.entries(cur).forEach(([k, r]) => {
    if (r && r.id && String(r.id) !== k) {
      if (next[r.id] == null) next[r.id] = r;
      delete next[k];
      changed = true;
    }
  });
  return changed ? next : undefined;
}
// id ごとの写し: 書き込む時点でまだ無いときだけ書く（別タブが先に写した・編集したメモは上書きしない）
export const insertReminderIfAbsent = (item) => (cur) => (cur == null ? item : undefined);

// 旧形式の部屋（公開記録が無い）で GM に確かめてもらうクエストの候補。
// 候補は秘匿シナリオにあるクエストだけ（PL が足した架空のクエストは出さない）。名前は秘匿シナリオのもの。
// 「登場済み」の初期値は最初のクエスト（unlockType が start）だけ、「真相公開済み」は GM が選ぶまで付けない
// （PL が gs.quests に書いた solved や真相は、承認の証拠にしない）
export function questGateCandidates(publicQuests, scenarioQuests) {
  const scById = new Map(toArray(scenarioQuests).filter(Boolean).map(q => [String(q.id), q]));
  return toArray(publicQuests).filter(q => q && scById.has(String(q.id))).map(q => {
    const sq = scById.get(String(q.id));
    return { id: q.id, name: sq.name || q.name, solved: !!q.solved, start: (sq.unlockType ?? "start") === "start" };
  });
}


// 承認で解放したクエストの「確認待ち（gatePending = 付けた操作の opId）」を外す。
// 外すのは、指定の操作（opId）が付けた確認待ちだけ（別の承認が付け直したものは触らない）。変化が無ければ同じ配列を返す
export function clearOwnGatePending(quests, ids, opId) {
  const want = new Set(toArray(ids).map(String));
  const mine = (q) => q?.gatePending === opId && want.has(String(q.id));
  const list = toArray(quests);
  if (!list.some(mine)) return quests;
  return list.map(q => (mine(q) ? (({ gatePending: _g, ...rest }) => rest)(q) : q));
}

// 再読み込み等で保存のやり直しが失われた確認待ちの回復の判定（GM の公開記録が根拠）。
//   ・公開記録で既に登場済み → "clear"（その記録をサーバーで確かめてから確認待ちを外す。value = 記録の値）
//   ・秘匿シナリオで「クエスト解決時」に公開されるクエストで、元のクエストが公開記録で承認済み
//     → "reveal"（登場済みの記録を書いてから外す。value = 元のクエストを承認した操作の opId。
//        その承認を取り消すと、この記録も一緒に外れる）
//   ・どちらでもない → 何もしない（元のクエストが承認待ちに戻るので、GM が再承認すれば進む）
//   公開条件が「クエスト解決時」以外（カスタム等）なら、unlockQuestId が残っていても根拠にしない
export function gateRecoveryActions(quests, scenarioQuests, gate) {
  if (!gate) return [];
  const scById = new Map(toArray(scenarioQuests).filter(Boolean).map(q => [String(q.id), q]));
  return toArray(quests).filter(q => q?.gatePending).flatMap(q => {
    const opId = q.gatePending;
    if (gate.revealed?.[q.id]) return [{ id: q.id, opId, action: "clear", value: gate.revealed[q.id] }];
    const sq = scById.get(String(q.id));
    if (sq?.unlockType !== "quest") return [];
    const parent = sq.unlockQuestId;
    if (parent != null && parent !== "" && gate.approved?.[parent]) return [{ id: q.id, opId, action: "reveal", value: gate.approved[parent] }];
    return [];
  });
}
