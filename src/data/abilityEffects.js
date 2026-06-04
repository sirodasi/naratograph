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
  "比類なき脚力を持つ程度の能力":   { freq: null, auto: true, kind: "gain_yaruki", params: { amount: 2 } }, // （導入フェイズ開始時）やる気+2
  "比類なき脚力を持つ程度の能力＋": { freq: null, auto: true, kind: "gain_yaruki", params: { amount: 2 }, note: "加えて夜の終了時にやる気減少を受けない（App.jsxで処理）" }, // やる気+2＋夜のやる気減少免除

  "あらゆる薬を作る程度の能力":   { freq: null, auto: true, kind: "cure_bad_status" }, // 八意永琳：同スポットのキャラの変調1つを除去
  "あらゆる薬を作る程度の能力＋": { freq: null, auto: true, kind: "cure_bad_status", params: { grantTag: "絶好調" } }, // 八意永琳＋：除去＋絶好調タグ
  "水難事故を引き起こす程度の能力":   { freq: null, auto: true, kind: "party_move" }, // 村紗：同スポットのキャラと共に好きなスポットへ移動
  "水難事故を引き起こす程度の能力＋": { freq: null, auto: true, kind: "party_move", params: { selfOptional: true } }, // 村紗＋：自分は移動しない選択可
  "人間を驚かす程度の能力":   { freq: null, auto: true, kind: "surprise_bond" }, // 多々良小傘：同スポット1人に2D:4、成功→絆＋やる気/失敗→相手が自分への絆
  "人間を驚かす程度の能力＋": { freq: null, auto: true, kind: "surprise_bond", params: { declareX: true } }, // ＋：X(3-6)を宣言し 2D:X
  "水を操る程度の能力":   { freq: "day", auto: true, kind: "spend_item_gain_random", params: { randomCount: 2 } }, // 河城にとり：アイテム1つ失ってランダム2つ
  "水を操る程度の能力＋": { freq: "day", auto: true, kind: "spend_item_gain_random", params: { randomCount: 2, allowChoice: true } }, // にとり＋：ランダム2 or 好き1

  // ── サポート（ダイス振り直し系・文脈依存。探索の行為判定結果画面で対応） ──
  // 運命を操る：出目を全て裏返す（1↔6,2↔5,3↔4）。探索結果画面に振り直しUIあり（ScenePanel）。
  // ＋（好きな数だけ裏返す）は選択UI未実装のためGM対応。発動ボタンは他文脈用の手動フォールバック。
  "運命を操る程度の能力":   { note: "ダイスを振った直後に出目を全て裏返す（探索は結果画面で自動対応／他文脈はGM）" },
  "運命を操る程度の能力＋": { note: "ダイスを振った直後に好きな数だけ出目を裏返す（探索は結果画面で選択式・自動対応）" },
  // 風水を操る：自分の行為判定で選んだ任意のダイスを振り直す（探索結果画面に選択UIあり）。
  "風水を操る程度の能力":   { note: "1日1回、自分の行為判定で選んだダイスを振り直す（探索は結果画面で自動対応）" },
  "風水を操る程度の能力＋": { note: "振り直し後さらに1つの出目を+1（+1部分はGM対応）" },
  // 狂気を操る：同スポットの保持者が霊力3消費で対象の判定ダイス1つを振り直す（探索結果画面に観戦UIあり）。
  "狂気を操る程度の能力":   { note: "同スポットの判定で霊力3消費しダイス1つ振り直し（探索は結果画面で自動対応）" },
  "狂気を操る程度の能力＋": { note: "霊力3点ごとに1つ振り直し（探索は結果画面で複数選択・自動対応）" },
  // 距離を操る：誰かの移動ダイスをやる気1消費で振り直す（move_roll 画面にUIあり）。base=6以外、＋=全部。
  "距離を操る程度の能力":   { note: "移動ダイスをやる気1で振り直す（6以外・移動画面で自動対応）" },
  "距離を操る程度の能力＋": { note: "移動ダイスをやる気1で振り直す（6含む全部・移動画面で自動対応）" },
  // 喉の病気を癒す：同スポットの保持者が他者のファンブルを無効化（探索結果画面に観戦UIあり）。
  "喉の病気を癒す程度の能力":   { note: "同スポットの他者のファンブルを通常の失敗にする（探索は結果画面で自動対応）" },
  "喉の病気を癒す程度の能力＋": { note: "同スポットの他者のファンブルを無効化し判定をやり直す（探索は結果画面で自動対応）" },

  // ── サポート（黒い応援欄＝bondUsed===true を操作） ──
  "感情を操る程度の能力":   { freq: null, auto: true, kind: "refresh_other_cheer_slot" }, // 秦こころ：他キャラの使用済み応援欄を1つ解除
  "感情を操る程度の能力＋": { freq: null, auto: true, kind: "refresh_other_cheer_slot" }, // 秦こころ＋（トリガー条件が広いだけで効果は同一）

  // ── サポート（タイミングを見て使用） ──
  "花を操る程度の能力":   { freq: null, auto: true, kind: "gain_rei", params: { amount: 10 } }, // 風見幽香（導入フェイズ開始時）：霊力+10
  "花を操る程度の能力＋": { freq: null, auto: true, kind: "set_rei", params: { value: 10 } },   // 風見幽香＋：霊力が10以下のとき霊力を10にする
  "ありとあらゆるものを破壊する程度の能力":   { freq: "session", auto: true, kind: "destroy_one" }, // フランドール：キャラ1人のタグ/変調/アイテム1つを失わせる
  "ありとあらゆるものを破壊する程度の能力＋": { freq: "day",     auto: true, kind: "destroy_one" }, // フランドール＋：1日1回

  // ── オート（常時パッシブ・発動ボタンなし。効果は各サイトに組込み） ──
  "虚無を操る程度の能力":   { passive: true, note: "霊力の最大値が25・攻撃力の最大値が6（常時）" }, // applyAbilityPassiveStats で反映
  "虚無を操る程度の能力＋": { passive: true, note: "霊力の最大値が29・攻撃力の最大値が6（常時）" },
  // パチュリー：移動しなかったシーンでは探索の判定ダイス+1（startAction に組込み済み）。＋は拠点でも+1。
  "火＋水＋木＋金＋土＋日＋月を操る程度の能力":   { passive: true, note: "移動しなかったシーンでは判定ダイス+1（探索）" },
  "火＋水＋木＋金＋土＋日＋月を操る程度の能力＋": { passive: true, note: "移動しなかったシーン or 拠点では判定ダイス+1（探索）" },
  // 剣術（effectiveAttackPower で実効攻撃力に反映）/ 怪力乱神（finishBattle で勝利時付与）
  "剣術を扱う程度の能力":   { passive: true, note: "決戦以外の弾幕ごっこで攻撃力が4固定" },
  "剣術を扱う程度の能力＋": { passive: true, note: "弾幕ごっこで攻撃力が4未満なら4扱い" },
  "怪力乱神を持つ程度の能力":   { passive: true, note: "探索中の弾幕ごっこ勝利でやる気+1" },
  "怪力乱神を持つ程度の能力＋": { passive: true, note: "探索中の弾幕ごっこ勝利でやる気+1・霊力D6" },
  // 無意識（こいし）：シーン終了時に隣接スポットへ移動（action_done に移動UI）。＋のサイクル終了移動はGM対応。
  "無意識を操る程度の能力":   { passive: true, note: "シーン終了時に1スポット離れたスポットへ移動（自動対応）" },
  "無意識を操る程度の能力＋": { passive: true, note: "シーン終了時＋サイクル終了時に移動（サイクル終了分はGM対応）" },
  // 何でもひっくり返す：同スポットの行為判定で ファンブル/スペシャル 条件が反転（探索結果画面に反映）。＋の解除宣言はGM対応。
  "何でもひっくり返す程度の能力":   { passive: true, note: "同スポットの行為判定で全6=ファンブル/1あり=スペシャル（探索は自動対応）" },
  "何でもひっくり返す程度の能力＋": { passive: true, note: "同上。解除の宣言で一時無効化（解除はGM対応）" },
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

// pc の現在有効な能力（成長後は growthAbility が as を置換）を返す。
export function getActiveAbility(pc) {
  if (!pc) return null;
  return (pc.growthAbilityUnlocked && pc.growthAbility?.name) ? pc.growthAbility : (pc.as || null);
}

// ability = { name, type, desc } を受け取り、対応する効果メタを返す（無ければ null）。
export function getAbilityEffect(ability) {
  if (!ability?.name) return null;
  const e = ABILITY_EFFECTS[ability.name];
  if (!e) return null;
  if (e.byType) return e.byType[ability.type] || null;
  return e;
}
