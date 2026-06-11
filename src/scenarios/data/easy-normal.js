// ── ビルトイン・シナリオ（Easy / Normal：特殊処理なし）をまとめるデータファイル ──
//
// 特殊なコード処理（フック）を必要としない Easy/Normal シナリオは、ここに
// プレーンな scenarioData オブジェクトとして列挙する。Hard/Lunatic で
// コードフックが要るものは src/scenarios/hard|lunatic/ に1ファイルずつ置く。
//
// scenarioData の形は ScenarioEditor が保存・出力するものと同一。
// ＝ ScenarioEditor でGUI作成 →（将来追加する）JSONエクスポート → ここに貼る、が想定ワークフロー。
//
// 主なフィールド（ScenarioEditor 準拠）:
//   id            : 一意なID（kebab-case 推奨。フック登録キー・部屋への識別子に使う）
//   name          : 表示名
//   difficulty    : "Easy" | "Normal" | "Hard" | "Lunatic"
//   playerCountMin / playerCountMax : 推奨人数
//   limit         : "N日目の{朝|昼|夕|夜}" 形式のリミット
//   bannedChars[] : 選択不可キャラ名
//   intro / backstory : 導入文
//   quests[]      : クエスト定義（solutionType, level, enemy, massBattle, preBattleFlavorRoll 等）
//   finalBattleEnemies[] / finalBattleOptionalEnemies[] : 決戦の敵
//   （Hard/Lunatic データ項目）blockedSpots[] / spotRebind{} など
//
// ※ 真にコードでしか表現できない挙動だけ hooks（registry）に落とす。データで足りるものはデータで。

export const EASY_NORMAL = [
  // 例（コメントアウト。実シナリオを追加するときの雛形）:
  // {
  //   id: "first-night",
  //   name: "はじめての夜",
  //   difficulty: "Easy",
  //   playerCountMin: 2, playerCountMax: 4,
  //   limit: "3日目の夜",
  //   bannedChars: [],
  //   intro: "……",
  //   quests: [ /* ... */ ],
  //   finalBattleEnemies: [ /* ... */ ],
  // },
];
