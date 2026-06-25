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
      "アクション": { freq: "day", auto: true, kind: "gain_choice_item", params: { count: 1 } },
      "オート":     { passive: true, note: "やる気消費が常時「1点」軽減＋やる気1点消費で判定ダイス+1（パッシブ）" },
    },
  },
  "気を使う程度の能力":           { freq: null, auto: true, kind: "gain_yaruki", params: { amount: 1 } },
  "気を使う程度の能力＋":         { freq: null, auto: true, kind: "gain_yaruki_selfbond", params: { amount: 1 } },
  "比類なき脚力を持つ程度の能力":   { freq: null, auto: true, kind: "gain_yaruki", params: { amount: 2 } },
  "比類なき脚力を持つ程度の能力＋": { freq: null, auto: true, kind: "gain_yaruki", params: { amount: 2 }, note: "加えて夜の終了時にやる気減少を受けない（自動処理）" },

  // ── 手下（minion）システム ──
  "人形を操る程度の能力":   { freq: null, auto: true, kind: "spawn_minion", params: { at: "spot" }, note: "登場後、手下にアクションを行わせる" },
  "人形を操る程度の能力＋": { freq: null, auto: true, kind: "spawn_minion", params: { at: "spot" }, note: "登場後、手下にアクションか移動を行わせる" },
  "偶像を作り出す程度の能力":   { freq: null, auto: true, kind: "spawn_minion", params: { at: "spot" }, note: "あなたのシーンで手下が代わりに移動とアクション" },
  "偶像を作り出す程度の能力＋": { freq: null, auto: true, kind: "spawn_minion", params: { at: "spot" }, note: "同上＋1日1度シーン終了直前にアクション消費なしで使用可" },
  "式神を操る程度の能力":   { freq: null, auto: true, kind: "spawn_minion", params: { at: "base", costSC: 1, redoScene: true }, note: "シーン終了時にSC1消費。手下がいなければ拠点に登場し、手下シーンを再処理" },
  "式神を操る程度の能力＋": { freq: null, auto: true, kind: "spawn_minion", params: { at: "base", costSCorRei: true, redoScene: true }, note: "SC1点か霊力5点消費。同上" },

  "化けさせる程度の能力":   { freq: null, auto: true, kind: "disguise", note: "選んだキャラとしても扱う。絆取得時の選択はGM。任意のタイミングで解除可" },
  "化けさせる程度の能力＋": { freq: null, auto: true, kind: "disguise", note: "同上＋1日1度シーン終了直前にアクション消費なしで使用可" },
  "念写をする程度の能力":   { freq: null, auto: true, kind: "consume_rei_newspaper", params: { reiDice: true }, note: "霊力D6消費後、GMが文々。新聞表を振る" },
  "念写をする程度の能力＋": { freq: null, auto: true, kind: "consume_rei_newspaper", params: { rei: 1 }, note: "霊力1消費後、GMが文々。新聞表を振る" },

  "探し物を探し当てる程度の能力":   { freq: "day", auto: true, kind: "search_place_clue" },
  "探し物を探し当てる程度の能力＋": { freq: "day", auto: true, kind: "search_place_clue", note: "探索イベントの実行として扱い特殊効果も発生（特殊効果はGM）" },
  "十人の話を同時に聞く程度の能力":   { freq: null, auto: true, kind: "gain_bonds_same_spot", note: "探索イベント実行シーンで自動取得（ボタンで適用）" },
  "十人の話を同時に聞く程度の能力＋": { freq: null, auto: true, kind: "gain_bonds_same_spot_choice", note: "相手に自分への絆を取らせるか選択" },

  "あらゆる薬を作る程度の能力":   { freq: null, auto: true, kind: "cure_bad_status" },
  "あらゆる薬を作る程度の能力＋": { freq: null, auto: true, kind: "cure_bad_status", params: { grantTag: "絶好調" } },
  "水難事故を引き起こす程度の能力":   { freq: null, auto: true, kind: "party_move" },
  "水難事故を引き起こす程度の能力＋": { freq: null, auto: true, kind: "party_move", params: { selfOptional: true } },
  "人間を驚かす程度の能力":   { freq: null, auto: true, kind: "surprise_bond" },
  "人間を驚かす程度の能力＋": { freq: null, auto: true, kind: "surprise_bond", params: { declareX: true } },
  "時間を操る程度の能力":   { freq: "session", auto: true, kind: "redo_own_scene" },
  "時間を操る程度の能力＋": { freq: "session", auto: true, kind: "redo_own_scene" },
  "逆らう気力を失わせる程度の能力":   { freq: "session", auto: true, kind: "grant_extra_scene" },
  "逆らう気力を失わせる程度の能力＋": { freq: null,      auto: true, kind: "grant_extra_scene", note: "1セッション2回（回数管理はGM）" },
  "境界を操る程度の能力":   { freq: null, auto: true, kind: "boundary_move" },
  "境界を操る程度の能力＋": { freq: null, auto: true, kind: "boundary_move", params: { plus: true } },
  "永遠と須臾を操る程度の能力":   { freq: "session", auto: true, kind: "set_eternity_night", params: { shorten: true } },
  "永遠と須臾を操る程度の能力＋": { freq: "session", auto: true, kind: "set_eternity_night" },
  "夢を喰い、夢を創る程度の能力":   { freq: null, auto: true, kind: "party_move", note: "夢の世界へ移動（同スポットのキャラ1人まで同行）" },
  "夢を喰い、夢を創る程度の能力＋": { freq: null, auto: true, kind: "party_move", params: { selfOptional: true }, note: "移動の代わりに夢の世界へ（同行1人まで）" },
  "水を操る程度の能力":   { freq: "day", auto: true, kind: "spend_item_gain_random", params: { randomCount: 2 } },
  "水を操る程度の能力＋": { freq: "day", auto: true, kind: "spend_item_gain_random", params: { randomCount: 2, allowChoice: true } },

  // ── リアクティブ（発火時に押す手動トリガー。reactive:true でボタンを出す） ──
  "死体を持ち去る程度の能力":   { freq: "scene", auto: true, reactive: true, kind: "reactive_gain", params: { yaruki: 1 }, note: "残り人数減少時に発動" },
  "死体を持ち去る程度の能力＋": { freq: "scene", auto: true, reactive: true, kind: "reactive_gain", params: { yaruki: 1, reiDice: true }, note: "誰かの残り人数減少時に発動" },
  "何でも吸収する程度の能力":   { freq: null, auto: true, reactive: true, kind: "reactive_gain", params: { reiDice: true }, note: "ランダム/任意選択の対象になった時（処理回避はGM）" },
  "何でも吸収する程度の能力＋": { freq: null, auto: true, reactive: true, kind: "reactive_gain", params: { rei: 6 }, note: "同上（霊力6固定）" },
  "核融合を操る程度の能力":   { freq: null, auto: true, reactive: true, kind: "boost_other_yaruki", params: { amount: 1 }, note: "同スポットの他PCのやる気獲得時に発動" },
  "核融合を操る程度の能力＋": { freq: null, auto: true, reactive: true, kind: "boost_other_yaruki", params: { amount: 2 }, note: "同上（+2）" },
  "財産を消費させる程度の能力":   { freq: "day", auto: true, reactive: true, kind: "consume_others_item" },
  "財産を消費させる程度の能力＋": { freq: null,  auto: true, reactive: true, kind: "consume_others_item", note: "回数制限なし" },
  "正体を判らなくする程度の能力":   { freq: null, auto: true, reactive: true, kind: "toggle_untargetable", note: "1日1回、特殊効果の対象に選べなくする" },
  "正体を判らなくする程度の能力＋": { freq: null, auto: true, reactive: true, kind: "toggle_untargetable", note: "回数制限なし" },

  // ── サポート（ダイス振り直しや特定フェーズ専用。専用UIを持つため hasCustomUI: true とし、一覧のボタンを案内化） ──
  "運命を操る程度の能力":   { hasCustomUI: true, note: "ダイスを振った直後に出目を全て裏返す（探索は結果画面で自動対応／他文脈はGM）" },
  "運命を操る程度の能力＋": { hasCustomUI: true, note: "ダイスを振った直後に好きな数だけ出目を裏返す（探索は結果画面で選択式・自動対応）" },
  "風水を操る程度の能力":   { hasCustomUI: true, note: "1日1回、自分の行為判定で選んだダイスを振り直す（探索は結果画面で自動対応）" },
  "風水を操る程度の能力＋": { hasCustomUI: true, note: "振り直し後さらに1つの出目を+1（探索は結果画面で自動対応）" },
  "狂気を操る程度の能力":   { hasCustomUI: true, note: "同スポットの判定で霊力3消費しダイス1つ振り直し（探索は結果画面で自動対応）" },
  "狂気を操る程度の能力＋": { hasCustomUI: true, note: "霊力3点ごとに1つ振り直し（探索は結果画面で複数選択・自動対応）" },
  "距離を操る程度の能力":   { hasCustomUI: true, note: "移動ダイスをやる気1で振り直す（6以外・移動画面で自動対応）" },
  "距離を操る程度の能力＋": { hasCustomUI: true, note: "移動ダイスをやる気1で振り直す（6含む全部・移動画面で自動対応）" },
  "喉の病気を癒す程度の能力":   { hasCustomUI: true, note: "同スポットの他者のファンブルを通常の失敗にする（探索は結果画面で自動対応）" },
  "喉の病気を癒す程度の能力＋": { hasCustomUI: true, note: "同スポットの他者のファンブルを無効化し判定をやり直す（探索は結果画面で自動対応）" },
  "魂の弱い所に入り込む程度の能力":   { hasCustomUI: true, note: "使用済み絆でも応援可・失敗でファンブル（探索の応援で自動対応）" },
  "魂の弱い所に入り込む程度の能力＋": { hasCustomUI: true, note: "同上＋通常応援に加え合計2回まで（回数管理はGM対応）" },
  "人を狂わす程度の能力":   { hasCustomUI: true, note: "絆なしでも応援可・失敗でファンブル（探索の応援で自動対応）" },
  "人を狂わす程度の能力＋": { hasCustomUI: true, note: "同上＋応援時に判定ダイスを増やさない選択も可（探索の応援で自動対応）" },
  "奇跡を起こす程度の能力":   { hasCustomUI: true, note: "応援の代わりに出目を1つ+1（探索は結果画面で自動対応・絆消費）" },
  "奇跡を起こす程度の能力＋": { hasCustomUI: true, note: "応援（振り足し）に加えて出目を1つ+1（探索は結果画面で対応・絆消費）" },
  "気質を見極める程度の能力":   { hasCustomUI: true, note: "自分が応援された時に出目を1つ+1（探索は結果画面で自動対応）" },
  "気質を見極める程度の能力＋": { hasCustomUI: true, note: "応援に加えて出目を1つ+1（探索は結果画面で自動対応）" },
  "動物を導く程度の能力":   { hasCustomUI: true, note: "応援で選んだ出目を振り直す（1日1回・探索は結果画面で自動対応・絆消費）" },
  "動物を導く程度の能力＋": { hasCustomUI: true, note: "応援で選んだ出目を振り直す（制限なし・探索は結果画面で自動対応・絆消費）" },
  "風を操る程度の能力":   { hasCustomUI: true, note: "新聞表を振り直す（やる気1消費・新聞モーダルで自動対応）" },
  "風を操る程度の能力＋": { hasCustomUI: true, note: "新聞表を振り直す（やる気消費なし・新聞モーダルで自動対応）" },
  "空を飛ぶ程度の能力":   { hasCustomUI: true, note: "1日1回、表を振った直後に全ダイスを振り直せる（自動：振り直しプロンプト）" },
  "空を飛ぶ程度の能力＋": { hasCustomUI: true, note: "1日1回、表を振った直後に全ダイスを振り直せる（行為判定以外の他処理はGM）" },
  "坤を創造する程度の能力":   { hasCustomUI: true, note: "人間の里⇔守矢神社の移動置換（保持者がセッションにいる時、11/22のPCに移動UI）" },
  "死を操る程度の能力":   { hasCustomUI: true, note: "移動の代わりに異世界エリア⇔それ以外へワープ（移動画面で自動対応）" },
  "死を操る程度の能力＋": { hasCustomUI: true, note: "移動直前にワープし、その後に通常移動も行う（移動画面で自動対応）" },
  "超能力を操る程度の能力":   { hasCustomUI: true, note: "シーン終了時にコマを取り除き次シーン開始時にランダム配置（結果画面で自動対応）" },
  "超能力を操る程度の能力＋": { hasCustomUI: true, note: "同上＋霊力D6を増加（結果画面で自動対応）" },
  
  "自分も含めて不運にする程度の能力":   { freq: "session", auto: true, reactive: true, kind: "set_unlucky_phase" },
  "自分も含めて不運にする程度の能力＋": { freq: null,      auto: true, reactive: true, kind: "set_unlucky_phase" },
  "心を読む程度の能力":   { freq: null, auto: true, reactive: true, kind: "read_mind" },
  "心を読む程度の能力＋": { freq: null, auto: true, reactive: true, kind: "read_mind", note: "相手が持つ任意の絆1つを取得する選択も可（その選択はGM）" },
  "あらゆるものの背中に扉を作る程度の能力":   { freq: null, auto: true, reactive: true, kind: "select_rei_boost", params: { amount: 1 }, note: "選んだキャラの霊力増加を+1（対象選択）" },
  "あらゆるものの背中に扉を作る程度の能力＋": { freq: null, auto: true, reactive: true, kind: "select_rei_boost", params: { amount: 2 }, note: "選んだキャラの霊力増加を+2（対象選択）" },
  "所有権を失わせる程度の能力":   { freq: null, auto: true, reactive: true, kind: "select_item_swap", note: "選んだキャラがアイテム交換可能に（＋の弾幕スキル取得はGM）" },
  "所有権を失わせる程度の能力＋": { freq: null, auto: true, reactive: true, kind: "select_item_swap", note: "同上＋任意の弾幕スキル取得も可（弾幕スキルはGM）" },
  "ありとあらゆるものを破壊する程度の能力":   { freq: "session", auto: true, reactive: true, kind: "destroy_one" },
  "ありとあらゆるものを破壊する程度の能力＋": { freq: "day",     auto: true, reactive: true, kind: "destroy_one" },
  "感情を操る程度の能力":   { freq: null, auto: true, reactive: true, kind: "refresh_other_cheer_slot" },
  "感情を操る程度の能力＋": { freq: null, auto: true, reactive: true, kind: "refresh_other_cheer_slot" },
  "密と疎を操る程度の能力":   { freq: null, auto: true, reactive: true, kind: "set_return_spot" },
  "密と疎を操る程度の能力＋": { freq: null, auto: true, reactive: true, kind: "set_return_spot", params: { yarukiSkip: true } },

  // ── オート（常時パッシブ・発動ボタンなし。効果は各サイトに組込み） ──
  "虚無を操る程度の能力":   { passive: true, note: "霊力の最大値が25・攻撃力の最大値が6（常時）" },
  "虚無を操る程度の能力＋": { passive: true, note: "霊力の最大値が29・攻撃力の最大値が6（常時）" },
  "冷気を操る程度の能力":   { passive: true, note: "大蝦蟇の池・霧の湖を拠点として扱う（拠点判定に反映）" },
  "冷気を操る程度の能力＋": { passive: true, note: "上記＋セッション開始時に選んだ1スポットも拠点（選択分はGM対応）" },
  "乾を創造する程度の能力":   { passive: true, note: "間欠泉地下センター・守矢神社を拠点として扱う（拠点判定に反映）" },
  "乾を創造する程度の能力＋": { passive: true, note: "上記＋拠点同士がルートで繋がる（移動BFSで自動対応）" },
  "壁をすり抜けられる程度の能力":   { passive: true, note: "移動時、同エリア内のスポット同士がルートで繋がる（移動BFSで自動対応）" },
  "壁をすり抜けられる程度の能力＋": { passive: true, note: "同上＋現在地と10の位±1のスポットも繋がる（移動BFSで自動対応）" },
  "坤を創造する程度の能力＋":       { passive: true, note: "人間の里↔守矢神社にルート（保持者本人に自動対応・他キャラへの付与はGM）" },
  "火＋水＋木＋金＋土＋日＋月を操る程度の能力":   { passive: true, note: "移動しなかったシーンでは判定ダイス+1（探索）" },
  "火＋水＋木＋金＋土＋日＋月を操る程度の能力＋": { passive: true, note: "移動しなかったシーン or 拠点では判定ダイス+1（探索）" },
  "老いることも死ぬこともない程度の能力":   { passive: true, note: "決戦以外で《不死身》の霊力消費が3点（自動対応）" },
  "老いることも死ぬこともない程度の能力＋": { passive: true, note: "決戦以外で《不死身》の霊力消費が2点（自動対応）" },
  "剣術を扱う程度の能力":   { passive: true, note: "決戦以外の弾幕ごっこで攻撃力が4固定" },
  "剣術を扱う程度の能力＋": { passive: true, note: "弾幕ごっこで攻撃力が4未満なら4扱い" },
  "怪力乱神を持つ程度の能力":   { passive: true, note: "探索中の弾幕ごっこ勝利でやる気+1" },
  "怪力乱神を持つ程度の能力＋": { passive: true, note: "探索中の弾幕ごっこ勝利でやる気+1・霊力D6" },
  "神仏を見つけ出す程度の能力":   { passive: true, note: "シーン終了時に《神》タグへの絆の応援欄を解除（自動対応）" },
  "神仏を見つけ出す程度の能力＋": { passive: true, note: "シーン終了時に《巫女》《神》タグへの絆の応援欄を解除（自動対応）" },
  "無意識を操る程度の能力":   { passive: true, note: "シーン終了時に1スポット離れたスポットへ移動（自動対応）" },
  "無意識を操る程度の能力＋": { passive: true, note: "シーン終了時＋サイクル終了時に移動（サイクル終了分はGM対応）" },
  "何でもひっくり返す程度の能力":   { passive: true, note: "同スポットの行為判定で全6=ファンブル/1あり=スペシャル（探索は自動対応）" },
  "何でもひっくり返す程度の能力＋": { passive: true, note: "同上。解除の宣言で一時無効化（右パネルでトグル）" },
  "打ち出の小槌を扱う程度の能力":   { passive: true, note: "弾幕以外で判定ダイス+1。出目が全て2以下でファンブル（探索は自動対応）" },
  "打ち出の小槌を扱う程度の能力＋": { passive: true, note: "弾幕以外で判定ダイス+1。半分以上が1かつ残り2でファンブル（探索は自動対応）" },
};

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

export function getActiveAbility(pc) {
  if (!pc) return null;
  return (pc.growthAbilityUnlocked && pc.growthAbility?.name) ? pc.growthAbility : (pc.as || null);
}

export function getBaseSpots(pc) {
  const bases = new Set();
  if (pc?.baseSpotId) bases.add(pc.baseSpotId);
  const name = getActiveAbility(pc)?.name;
  if (name === "冷気を操る程度の能力" || name === "冷気を操る程度の能力＋") { bases.add("24"); bases.add("34"); }
  if (name === "乾を創造する程度の能力" || name === "乾を創造する程度の能力＋") { bases.add("15"); bases.add("22"); }
  return [...bases];
}

export function isAtBase(pc) {
  return !!pc && getBaseSpots(pc).includes(pc.currentSpot);
}

export function getAbilityEffect(ability) {
  if (!ability?.name) return null;
  const e = ABILITY_EFFECTS[ability.name];
  if (!e) return null;
  if (e.byType) return e.byType[ability.type] || null;
  return e;
}