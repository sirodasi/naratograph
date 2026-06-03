// ─── 能力スキル効果定義 ───────────────────────────────────────────────
// 能力スキル（pc.as）/ 能力スキル＋（pc.growthAbility）の自動処理メタデータ。
// スペルカード（spellCardEffects.js）と同じく、データ定義とハンドラを分離する。
//
// activateAbility（SessionView.jsx の PCCard 内）がこのメタを引いて処理する:
//   - auto:true かつ kind が実装済み      → 自動適用
//   - 未登録 / auto なし / kind 未実装     → 「発動ログ＋効果説明（GM手動）」フォールバック
//
// フィールド:
//   freq    使用回数制限。"day"=1日1回 / "session"=1セッション1回 /
//           "scene"=1シーン1回 / null=制限なし（アクション消費等で自然に律速）。
//   auto    true なら activateAbility が自動適用を試みる。
//   kind    activateAbility 内のハンドラ識別子。
//   params  ハンドラ引数。
//   passive true は常時パッシブ（オート型）。発動ボタンを持たず、効果は各処理側に組み込む。
//   note    手動フォールバック時に補足表示する文字列。
//
// 重複名（「魔法を使う程度の能力」＝霧雨魔理沙[アクション] / 聖白蓮[オート]）は
// byType で type ごとに分岐する。getAbilityEffect が ability.type で解決する。

export const ABILITY_EFFECTS = {
  // ── アクション（能動・シーンのアクションを消費して使用） ──
  "魔法を使う程度の能力": {
    byType: {
      "アクション": { freq: "day", auto: true, kind: "gain_random_item", params: { count: 1 } }, // 霧雨魔理沙
      "オート":     { passive: true, note: "やる気消費が常時「1点」軽減される（パッシブ）" },        // 聖白蓮
    },
  },
  "魔法を使う程度の能力＋": {
    byType: {
      "アクション": { freq: "day", auto: true, kind: "gain_choice_item", params: { count: 1 } }, // 霧雨魔理沙＋：好きなアイテム1つ
      "オート":     { passive: true, note: "やる気消費が常時「1点」軽減＋やる気1点消費で判定ダイス+1（パッシブ）" }, // 聖白蓮＋
    },
  },
  "気を使う程度の能力":           { freq: null, auto: true, kind: "gain_yaruki", params: { amount: 1 } }, // 紅美鈴
  "気を使う程度の能力＋":         { freq: null, auto: true, kind: "gain_yaruki_selfbond", params: { amount: 1 } }, // 紅美鈴＋：やる気1点＋自身への絆
  "比類なき脚力を持つ程度の能力": { freq: null, auto: true, kind: "gain_yaruki", params: { amount: 2 } }, // （導入フェイズ開始時）

  "あらゆる薬を作る程度の能力":   { freq: null, auto: true, kind: "cure_bad_status" }, // 八意永琳：同スポットのキャラの変調1つを除去
  "あらゆる薬を作る程度の能力＋": { freq: null, auto: true, kind: "cure_bad_status", params: { grantTag: "絶好調" } }, // 八意永琳＋：除去＋絶好調タグ
  "水難事故を引き起こす程度の能力":   { freq: null, auto: true, kind: "party_move" }, // 村紗：同スポットのキャラと共に好きなスポットへ移動
  "水難事故を引き起こす程度の能力＋": { freq: null, auto: true, kind: "party_move", params: { selfOptional: true } }, // 村紗＋：自分は移動しない選択可
  "人間を驚かす程度の能力":   { freq: null, auto: true, kind: "surprise_bond" }, // 多々良小傘：同スポット1人に2D:4、成功→絆＋やる気/失敗→相手が自分への絆
  "人間を驚かす程度の能力＋": { freq: null, auto: true, kind: "surprise_bond", params: { declareX: true } }, // ＋：X(3-6)を宣言し 2D:X

  // ── サポート（黒い応援欄＝bondUsed===true を操作） ──
  "感情を操る程度の能力":   { freq: null, auto: true, kind: "refresh_other_cheer_slot" }, // 古明地こいし：他キャラの使用済み応援欄を1つ解除
  "感情を操る程度の能力＋": { freq: null, auto: true, kind: "refresh_other_cheer_slot" }, // ＋（トリガー条件が広いだけで効果は同一）

  // ── サポート（タイミングを見て使用） ──
  "花を操る程度の能力": { freq: null, auto: true, kind: "gain_rei", params: { amount: 10 } }, // 風見幽香（導入フェイズ開始時）

  // ── オート（常時パッシブ・発動ボタンなし。効果は各サイトに組込み） ──
  "虚無を操る程度の能力":   { passive: true, note: "霊力の最大値が25・攻撃力の最大値が6（常時）" }, // applyAbilityPassiveStats で反映
  "虚無を操る程度の能力＋": { passive: true, note: "霊力の最大値が29・攻撃力の最大値が6（常時）" },
};

// オート・パッシブのうち、ステータス上限を変えるもの（虚無を操る程度の能力）を pc に反映する。
// 能力スキル＋解禁状態（growthAbilityUnlocked）を考慮して現在有効な能力で判定する。
// PC構築時（App.jsx）と成長トグル時に呼び、霊力/攻撃力の最大値を補正する。
export function applyAbilityPassiveStats(pc) {
  if (!pc) return pc;
  const active = (pc.growthAbilityUnlocked && pc.growthAbility?.name) ? pc.growthAbility : pc.as;
  const name = active?.name;
  let reiMax = null;
  if (name === "虚無を操る程度の能力")   reiMax = 25;
  if (name === "虚無を操る程度の能力＋") reiMax = 29;
  if (reiMax == null) return pc;
  const rei = pc.resources?.霊力   || { cur: 0, max: 20 };
  const atk = pc.resources?.攻撃力 || { cur: 1, max: 5 };
  return {
    ...pc,
    resources: {
      ...pc.resources,
      霊力:   { ...rei, max: reiMax, cur: Math.min(rei.cur, reiMax) },
      攻撃力: { ...atk, max: 6 },
    },
  };
}

// ability = { name, type, desc } を受け取り、対応する効果メタを返す（無ければ null）。
export function getAbilityEffect(ability) {
  if (!ability?.name) return null;
  const e = ABILITY_EFFECTS[ability.name];
  if (!e) return null;
  if (e.byType) return e.byType[ability.type] || null;
  return e;
}
