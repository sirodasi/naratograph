// ── Hard/Lunatic シナリオの雛形（コピーして使う） ─────────────────────────
//
// このファイルは `_` 始まりなので registry の glob には読み込まれない（テンプレ専用）。
// 新しい Hard/Lunatic シナリオを作るときは、このファイルを
//   src/scenarios/hard/<scenario-id>.js  または  src/scenarios/lunatic/<scenario-id>.js
// にコピーし、data / hooks を埋めるだけでよい（registry.js の編集は不要）。
//
// data はプレーンな scenarioData（ScenarioEditor 出力と同形）。コードでしか
// 表現できない挙動だけ hooks に実装する。データで足りるものはデータ項目で。

export const data = {
  id: "example-hard",              // 一意ID（フック登録キー＝この id と hooks が結びつく）
  name: "（雛形）特殊シナリオ",
  difficulty: "Hard",              // "Hard" | "Lunatic"
  playerCountMin: 2,
  playerCountMax: 4,
  limit: "3日目の夜",
  keywords: [],                    // PL・GMに公開するキーワード（タグ）。例 ["妖怪の山","ゆっくり"]
  bannedChars: [],
  intro: "……",
  quests: [],
  finalBattleEnemies: [],
  // 各フェイズの特殊処理メモ（GM向け・任意。主に探索）。集団戦処理などの注記に。
  // phaseNotes: { explore: "○○スポットでは集団戦…", battle: "", intro: "", epilogue: "" },

  // ── データで表現できる Hard/Lunatic 項目（リゾルバが解決） ──
  // blockedSpots: ["33"],                 // 探索不可スポット
  // spotRebind: { "33": "34" },           // 拠点リダイレクト（封鎖時の代替拠点）
  // quests[].preBattleFlavorRoll: true,   // 弾幕前の演出だけの行為判定
};

// ── コードフック（任意。実装したメソッドだけ書けばよい） ──
export const hooks = {
  // blockedSpots(gs) { return gs.day >= 2 ? ["33"] : []; },
  // resolveBaseSpot(spotId, gs) { return spotId; },
  // setupBattle(kind, gs) { return null; }, // PvP陣営決戦など（将来）
};
