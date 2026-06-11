// ── シナリオ拡張点リゾルバ ──────────────────────────────────────────
//
// エンジン本体（App.jsx / SessionView.jsx）は、シナリオ固有の挙動をここ経由で
// 解決する。各リゾルバは「scenarioData のデータ項目」と「シナリオフック（registry）」
// の両方を統合し、どちらも無ければ素の既定値を返す。
//
// これにより Hard/Lunatic シナリオは、まずデータ項目で表現を試み、表現しきれない
// ものだけをコードフックに落とす、という段階的な拡張ができる。

import { getScenarioHooks, BUILTIN_SPECIAL } from "./registry";
import { EASY_NORMAL } from "./data/easy-normal";

export { getScenarioHooks, SCENARIO_HOOKS } from "./registry";

// ビルトイン（コード同梱）シナリオ一覧。Easy/Normal（data/easy-normal.js）＋
// Hard/Lunatic（hard|lunatic/*.js を registry が glob 集約）を id でユニーク化して返す。
// 選択UI（ScenarioSelector）はこれを「★公式シナリオ」として自作シナリオと併記する。
export function getBuiltinScenarios() {
  const seen = new Set();
  const out = [];
  for (const sc of [...EASY_NORMAL, ...BUILTIN_SPECIAL]) {
    if (!sc?.id || seen.has(sc.id)) continue;
    seen.add(sc.id);
    out.push({ ...sc, builtin: true });
  }
  return out;
}

// 探索フェイズで訪問できないスポットID一覧を返す。
// scenarioData.blockedSpots（データ）と、フック blockedSpots(gs)（コード）を統合する。
export function getBlockedSpots(scenarioData, gs) {
  const fromData = scenarioData?.blockedSpots || [];
  const hook = getScenarioHooks(scenarioData).blockedSpots;
  if (typeof hook !== "function") return fromData;
  const fromHook = hook(gs) || [];
  return [...new Set([...fromData, ...fromHook])];
}

// 拠点スポットIDのリダイレクトを解決する（例: 紅魔館封鎖時に霧の湖を拠点として扱う）。
// scenarioData.spotRebind（{ 元スポットID: 代替スポットID }）→ フック resolveBaseSpot の順に適用。
export function resolveBaseSpot(scenarioData, baseSpotId, gs) {
  const rebind = scenarioData?.spotRebind || {};
  let next = rebind[baseSpotId] ?? baseSpotId;
  const hook = getScenarioHooks(scenarioData).resolveBaseSpot;
  if (typeof hook === "function") next = hook(next, gs) ?? next;
  return next;
}

// クエストの弾幕ごっこ開始前に挟む「演出だけの行為判定」設定を返す（無ければ null）。
// quest.preBattleFlavorRoll が true なら既定（目標値6）、オブジェクトなら target を上書き。
// 演出専用のためスペシャル・ファンブルは発生させない。
export function getPreBattleFlavorRoll(quest) {
  const v = quest?.preBattleFlavorRoll;
  if (!v) return null;
  if (v === true) return { target: 6 };
  return { target: v.target ?? 6 };
}
