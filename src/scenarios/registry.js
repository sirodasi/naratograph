// ── シナリオ固有フックの登録簿（Hard / Lunatic） ────────────────────────
//
// Hard/Lunatic のうち、データ項目（blockedSpots / spotRebind / preBattleFlavorRoll
// 等）では表現しきれない挙動は「コードフック」で実装する。1シナリオ＝1ファイルで
// src/scenarios/hard|lunatic/ に置き、データもフックも同梱して自己完結させる。
//
// 各ファイルの形（いずれか）:
//   export const data  = { id: "scarlet-forbidden", name: "...", difficulty: "Hard", ... };
//   export const hooks = { blockedSpots(gs) {...}, resolveBaseSpot(spotId, gs) {...}, ... };
// もしくは default export で { data, hooks } を返してもよい。
//
// import.meta.glob で hard/ lunatic/ を一括取り込みするため、**ファイルを置くだけで登録**
// される（このファイルを毎回編集する必要はない）。`_` 始まりのファイルはテンプレ等として
// 読み込みから除外する。
//
// フックの想定シグネチャ（すべて任意。未実装はエンジンの既定動作にフォールバック）:
//   blockedSpots(gs): string[]            … 探索不可スポットIDを動的に返す
//   resolveBaseSpot(spotId, gs): string   … 拠点スポットIDをリダイレクトする
//   setupBattle(kind, gs): object | null  … 決戦などの戦闘セットアップを差し替える（PvP用・将来）

const modules = import.meta.glob(["./hard/*.js", "./lunatic/*.js"], { eager: true });

export const SCENARIO_HOOKS = {};   // { [scenarioId]: hooks }
export const BUILTIN_SPECIAL = [];  // Hard/Lunatic の scenarioData 一覧

for (const [path, mod] of Object.entries(modules)) {
  if (/\/_/.test(path)) continue; // _ 始まり（テンプレ等）は除外
  const m = mod?.default && (mod.default.data || mod.default.hooks) ? mod.default : mod;
  const data  = m?.data || (m?.id ? m : null); // { data, hooks } 形式 / data 直 のどちらも許容
  const hooks = m?.hooks || null;
  if (!data?.id) continue;
  BUILTIN_SPECIAL.push(data);
  if (hooks) SCENARIO_HOOKS[data.id] = hooks;
}

// scenarioData からフックオブジェクトを引く（未登録なら空オブジェクト）。
export function getScenarioHooks(scenarioData) {
  if (!scenarioData) return {};
  return SCENARIO_HOOKS[scenarioData.id] || {};
}
