// ── シナリオ固有フックの登録簿 ──────────────────────────────────────
//
// Hard / Lunatic シナリオのうち、データ項目（blockedSpots / spotRebind /
// preBattleFlavorRoll 等）では表現しきれない挙動は、ここに
// 「シナリオID → フックオブジェクト」として登録する。
//
// 各フックは実装したいメソッドだけを持てばよく、未実装のものはエンジンの
// デフォルト動作にフォールバックする。エンジン本体はフックの有無を意識せず、
// scenarios/index.js のリゾルバ経由で呼び出すだけにすること。
//
// 例:
//   import scarletForbidden from "./scarlet-forbidden";
//   export const SCENARIO_HOOKS = { "scarlet-forbidden": scarletForbidden };
//
// フックの想定シグネチャ（すべて任意）:
//   blockedSpots(gs): string[]              … 探索不可スポットIDを動的に返す
//   resolveBaseSpot(spotId, gs): string     … 拠点スポットIDをリダイレクトする
//   setupBattle(kind, gs): object | null    … 決戦などの戦闘セットアップを差し替える

export const SCENARIO_HOOKS = {};

// scenarioData からフックオブジェクトを引く（未登録なら空オブジェクト）。
export function getScenarioHooks(scenarioData) {
  if (!scenarioData) return {};
  return SCENARIO_HOOKS[scenarioData.id] || {};
}
