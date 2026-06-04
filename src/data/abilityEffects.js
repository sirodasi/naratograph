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
  // ドレミー：自分＋同スポットのキャラを夢の世界へ移動（party_move 雛形を流用。移動先で「夢の世界」を選ぶ。同行は1人まで=GM運用）
  "夢を喰い、夢を創る程度の能力":   { freq: null, auto: true, kind: "party_move", note: "夢の世界へ移動（同スポットのキャラ1人まで同行）" },
  "夢を喰い、夢を創る程度の能力＋": { freq: null, auto: true, kind: "party_move", params: { selfOptional: true }, note: "移動の代わりに夢の世界へ（同行1人まで）" },
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

  // 魂の弱い所に入り込む：使用済み（黒い応援欄）の絆でも応援できる。応援した判定が失敗するとファンブル（探索で自動対応）。
  // ＋の「2回まで応援」の回数管理はGM対応。
  "魂の弱い所に入り込む程度の能力":   { passive: true, note: "使用済み絆でも応援可・失敗でファンブル（探索の応援で自動対応）" },
  "魂の弱い所に入り込む程度の能力＋": { passive: true, note: "同上＋通常応援に加え合計2回まで（回数管理はGM対応）" },
  // 人を狂わす：絆を持たない相手にも応援可（1フェイズ1回・kuruwasuUsedで近似）。失敗でファンブル（探索で自動対応）。
  "人を狂わす程度の能力":   { passive: true, note: "絆なしでも応援可・失敗でファンブル（探索の応援で自動対応）" },
  "人を狂わす程度の能力＋": { passive: true, note: "同上＋応援時に判定ダイスを増やさない選択も可（その選択はGM対応）" },

  // 奇跡を起こす：応援の代わりに（＋は加えて）すでに振られた出目を1つ+1する（探索結果画面に観戦UIあり・絆消費）。
  "奇跡を起こす程度の能力":   { passive: true, note: "応援の代わりに出目を1つ+1（探索は結果画面で自動対応・絆消費）" },
  "奇跡を起こす程度の能力＋": { passive: true, note: "応援（振り足し）に加えて出目を1つ+1（探索は結果画面で対応・絆消費）" },
  // 気質を見極める：自分が応援された時、出目を1つ+1（探索結果画面に判定者側UIあり・1判定1回）。base=応援の代わり/＋=加えて はGM運用。
  "気質を見極める程度の能力":   { passive: true, note: "自分が応援された時に出目を1つ+1（探索は結果画面で自動対応）" },
  "気質を見極める程度の能力＋": { passive: true, note: "応援に加えて出目を1つ+1（探索は結果画面で自動対応）" },
  // 動物を導く：応援時に選んだ出目を振り直す（base=1日1回/＋=制限なし）。探索結果画面に観戦選択UIあり・絆消費。
  "動物を導く程度の能力":   { passive: true, note: "応援で選んだ出目を振り直す（1日1回・探索は結果画面で自動対応・絆消費）" },
  "動物を導く程度の能力＋": { passive: true, note: "応援で選んだ出目を振り直す（制限なし・探索は結果画面で自動対応・絆消費）" },

  // ── サポート（黒い応援欄＝bondUsed===true を操作） ──
  "感情を操る程度の能力":   { freq: null, auto: true, kind: "refresh_other_cheer_slot" }, // 秦こころ：他キャラの使用済み応援欄を1つ解除
  "感情を操る程度の能力＋": { freq: null, auto: true, kind: "refresh_other_cheer_slot" }, // 秦こころ＋（トリガー条件が広いだけで効果は同一）
  // 密と疎（伊吹萃香）：帰還先を変更（自分＋選んだPCを任意スポットへ帰還）。＋は夜のやる気減少もスキップ。
  "密と疎を操る程度の能力":   { freq: null, auto: true, kind: "set_return_spot" },
  "密と疎を操る程度の能力＋": { freq: null, auto: true, kind: "set_return_spot", params: { yarukiSkip: true } },

  // ── サポート（タイミングを見て使用） ──
  "花を操る程度の能力":   { freq: null, auto: true, kind: "gain_rei", params: { amount: 10 } }, // 風見幽香（導入フェイズ開始時）：霊力+10
  "花を操る程度の能力＋": { freq: null, auto: true, kind: "set_rei", params: { value: 10 } },   // 風見幽香＋：霊力が10以下のとき霊力を10にする
  "ありとあらゆるものを破壊する程度の能力":   { freq: "session", auto: true, kind: "destroy_one" }, // フランドール：キャラ1人のタグ/変調/アイテム1つを失わせる
  "ありとあらゆるものを破壊する程度の能力＋": { freq: "day",     auto: true, kind: "destroy_one" }, // フランドール＋：1日1回

  // ── オート（常時パッシブ・発動ボタンなし。効果は各サイトに組込み） ──
  "虚無を操る程度の能力":   { passive: true, note: "霊力の最大値が25・攻撃力の最大値が6（常時）" }, // applyAbilityPassiveStats で反映
  "虚無を操る程度の能力＋": { passive: true, note: "霊力の最大値が29・攻撃力の最大値が6（常時）" },
  // 拠点拡張（getBaseSpots/isAtBase で反映）。冷気＝大蝦蟇の池・霧の湖／乾＝間欠泉地下センター・守矢神社。
  "冷気を操る程度の能力":   { passive: true, note: "大蝦蟇の池・霧の湖を拠点として扱う（拠点判定に反映）" },
  "冷気を操る程度の能力＋": { passive: true, note: "上記＋セッション開始時に選んだ1スポットも拠点（選択分はGM対応）" },
  "乾を創造する程度の能力":   { passive: true, note: "間欠泉地下センター・守矢神社を拠点として扱う（拠点判定に反映）" },
  "乾を創造する程度の能力＋": { passive: true, note: "上記＋拠点同士がルートで繋がる（移動BFSで自動対応）" },
  // 移動BFS拡張（App.jsx getAbilityMoveEdges で getDistances に追加エッジを供給）
  "壁をすり抜けられる程度の能力":   { passive: true, note: "移動時、同エリア内のスポット同士がルートで繋がる（移動BFSで自動対応）" },
  "壁をすり抜けられる程度の能力＋": { passive: true, note: "同上＋現在地と10の位±1のスポットも繋がる（移動BFSで自動対応）" },
  "坤を創造する程度の能力＋":       { passive: true, note: "人間の里↔守矢神社にルート（保持者本人に自動対応・他キャラへの付与はGM）" },
  // 死を操る：異世界エリアとそれ以外を行き来するワープ（move_or_stay にUIあり）。base=移動の代わり/＋=ワープ後に通常移動。
  "死を操る程度の能力":   { passive: true, note: "移動の代わりに異世界エリア⇔それ以外へワープ（移動画面で自動対応）" },
  "死を操る程度の能力＋": { passive: true, note: "移動直前にワープし、その後に通常移動も行う（移動画面で自動対応）" },
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
  // 打ち出の小槌：弾幕以外の行為判定で判定ダイス+1（代償の低出目ファンブルも）。探索の startAction / explore_result に組込み。
  "打ち出の小槌を扱う程度の能力":   { passive: true, note: "弾幕以外で判定ダイス+1。出目が全て2以下でファンブル（探索は自動対応）" },
  "打ち出の小槌を扱う程度の能力＋": { passive: true, note: "弾幕以外で判定ダイス+1。半分以上が1かつ残り2でファンブル（探索は自動対応）" },
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

// pc が「拠点として扱う」スポットID配列を返す（拠点拡張能力を反映）。
// 冷気を操る（チルノ）＝大蝦蟇の池(24)・霧の湖(34)、乾を創造する（神奈子）＝間欠泉地下センター(15)・守矢神社(22)。
// ＋で追加選択できるスポットはGM運用（ここでは固定スポットのみ）。
export function getBaseSpots(pc) {
  const bases = new Set();
  if (pc?.baseSpotId) bases.add(pc.baseSpotId);
  const name = getActiveAbility(pc)?.name;
  if (name === "冷気を操る程度の能力" || name === "冷気を操る程度の能力＋") { bases.add("24"); bases.add("34"); }
  if (name === "乾を創造する程度の能力" || name === "乾を創造する程度の能力＋") { bases.add("15"); bases.add("22"); }
  return [...bases];
}

// pc が拠点にいるか（拠点拡張を反映）
export function isAtBase(pc) {
  return !!pc && getBaseSpots(pc).includes(pc.currentSpot);
}

// ability = { name, type, desc } を受け取り、対応する効果メタを返す（無ければ null）。
export function getAbilityEffect(ability) {
  if (!ability?.name) return null;
  const e = ABILITY_EFFECTS[ability.name];
  if (!e) return null;
  if (e.byType) return e.byType[ability.type] || null;
  return e;
}
