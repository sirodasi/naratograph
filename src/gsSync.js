// ゲームステート（gs = rooms/{code}/state）同期の純粋ロジック。
// React / Firebase に依存しないため単体テスト可能（src/__tests__/gsSync.test.js）。
//
// 書き込みは App.jsx の upd() が runTransaction で行う。トランザクションは競合時に
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
export function publicQuest(q) {
  if (!q || typeof q !== "object" || q.solved || !("truth" in q)) return q;
  const { truth: _truth, ...rest } = q;
  return rest;
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
    quests: toArray(gs.quests).map(q => (q && !q.truth && byId.get(String(q.id))?.truth) ? { ...q, truth: byId.get(String(q.id)).truth } : q),
  };
}

// 解決済みクエストへ真相を付与し、それを条件とするクエストを解放する。変更が無ければ null。
export function reconcileQuests(quests, scenarioQuests) {
  const scQs = toArray(scenarioQuests).filter(Boolean);
  if (!scQs.length) return null;
  const byId = new Map(scQs.map(q => [String(q.id), q]));
  let changed = false;
  const next = toArray(quests).map(q => {
    if (q?.solved && !q.truth) {
      const truth = byId.get(String(q.id))?.truth;
      if (truth) { changed = true; return { ...q, truth }; }
    }
    return q;
  });
  const have = new Set(next.map(q => String(q?.id)));
  next.filter(q => q?.solved).forEach(sq => {
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
