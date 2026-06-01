// ─── スペルカード効果データ ───────────────────────────────────────────────────
//
// auto: "full"    = 完全自動処理可能
//       "partial" = プレイヤーの選択入力が必要（指定マス・選択肢など）
//       "manual"  = GM手動処理（複雑な条件・状態参照が必要）
//
// timing: "shot"          = ショットステップ（デフォルト）
//         "round_start"   = ラウンド開始時
//         "round_end"     = ラウンド終了時
//         "hit_check_end" = 当たり判定ステップ終了時
//         "on_dodge_fail" = 回避失敗時（喰らいボム系）
//
// steps[].type:
//   "random"            - ランダム×N
//   "self"              - 自機マス×N
//   "enemy"             - 敵機マス×N
//   "designated"        - 指定マス×N（プレイヤーが選択）
//   "adjacent_enemy"    - 隣接マス×N（回避側のいるマスの上下左右隣接マス全て・自動）
//   "fixed_cells"       - 特定マス（cells配列で指定）
//   "mirrored_adj_self" - 自機と同番号の回避側フィールドのマスの上下左右隣接マス
//   "clear_all_then_random"    - 全弾幕除去→ランダム×除去数×multiplier
//   "clear_chosen_then_random" - 任意N個除去→ランダム×除去数×multiplier（partial）
//   "clear_enemy_adj_then"     - 敵機隣接マスの弾幕除去→後続処理
//
// steps[].after[]: 配置後に追加処理
//   "vertical_of_placed"     - 配置した各マスの上下隣接に×count
//   "horizontal_of_placed"   - 配置した各マスの左右隣接に×count
//   "all_neighbors_of_placed"- 配置した各マスの上下左右隣接に×count
//   "double_each_placed"     - 配置した各マスにさらに×1
//   "remove_attacker_mirror" - 配置したマスと同番号の自フィールドの弾幕を除去×count
//
// effects[].type: 弾幕配置以外の効果
//   "reduce_enemy_evasion"   - 回避側の回避力をこのラウンド中-N
//   "increase_enemy_evasion" - 回避側の回避力をこのラウンド中+N
//   "reduce_own_evasion"     - 攻撃側の回避力を次回避まで-N
//   "enemy_move_adjacent"    - 回避側が隣接マスへ任意移動
//   "pre_self_move_adjacent" - 配置前に自機が隣接マスへ任意移動
//   "extra_support_cover"    - 援護射撃/かばうをこのラウンドN回まで追加宣言可
//   "self_move_empty"        - 自機が弾幕なし任意マスへ移動
//   "no_sc_cost"             - このスペルカードはSC消費なし
//   "cancel_hp_reduction"    - 残り人数減少を打ち消す（リザレクション系）
//
// condition: 使用条件
//   attacker_in_cells: [1,2,3]  - 攻撃側がいるマスの条件
//   enemy_cell_empty: true       - 回避側のいるマスに弾幕なし
//   own_evasion_min: 1           - 自分の回避力がN以上
//   attacker_adj_all_empty: true - 自機マスと隣接マス全てに弾幕なし
//   no_support_this_round: true  - このラウンド援護射撃を行っていない
//   graze_available: true        - グレイズが1点以上
//
// ──────────────────────────────────────────────────────────────────────────────

export const SPELL_CARD_EFFECTS = {

  // ═══════════════════════════════════════════════════════ 博麗霊夢
  "霊符「夢想封印」": {
    auto: "partial",
    steps: [{ type: "designated", count: 2 }],
  },
  "夢符「二重結界」": {
    auto: "full",
    steps: [{ type: "adjacent_enemy", count: 1 }],
  },
  "神技「八方龍殺陣」": {
    auto: "full",
    steps: [{ type: "self", count: 2 }],
  },

  // ═══════════════════════════════════════════════════════ 霧雨魔理沙
  "恋符「マスタースパーク」": {
    auto: "full",
    steps: [{ type: "self", count: 1, after: [{ type: "vertical_of_placed", count: 2 }] }],
  },
  "魔符「スターダストレヴァリエ」": {
    auto: "full",
    steps: [{ type: "random", count: 4 }],
  },
  "彗星「ブレイジングスター」": {
    auto: "partial",
    steps: [{ type: "directional_move_shoot", countPerCell: 2 }],
    note: "上下左右いずれかの方向を選択→自機を移動させながら経路マスと同番号の回避側マスに×2",
  },

  // ═══════════════════════════════════════════════════════ チルノ
  "氷符「アイシクルフォール」": {
    auto: "full",
    steps: [{ type: "random", count: 4 }],
  },
  "涷符「パーフェクトフリーズ」": {
    auto: "full",
    steps: [{ type: "clear_all_then_random", multiplier: 1 }],
  },
  "涷符「マイナスK」": {
    auto: "partial",
    steps: [{ type: "clear_chosen_then_random", choose: 3, multiplier: 2 }],
  },

  // ═══════════════════════════════════════════════════════ 紅美鈴
  "華符「セラギネラ９」": {
    auto: "full",
    steps: [{ type: "random", count: 4 }],
  },
  "彩符「彩光風鈴」": {
    auto: "full",
    condition: { attacker_in_cells: [1, 2, 3] },
    steps: [
      { type: "fixed_cells", cells: [2, 4, 6], count: 1 },
      { type: "self", count: 1 },
    ],
  },
  "彩華「虹色太極拳」": {
    auto: "partial",
    steps: [{ type: "self", count: 2 }],
    effects: [{ type: "attacker_chooses_respawn" }],
    note: "このSCで残り人数が減少したとき、再配置マスを攻撃側が決定",
  },

  // ═══════════════════════════════════════════════════════ パチュリー・ノーレッジ
  "火水木金土符「賢者の石」": {
    auto: "full",
    steps: [{ type: "random", count: { type: "stat", stat: "攻撃力" } }],
  },
  "日符「ロイヤルフレア」": {
    auto: "full",
    timing: "round_end",
    steps: [{ type: "fill_empty_cells", count: 1 }],
  },
  "月＆木符「サテライトヒマワリ」": {
    auto: "full",
    steps: [{ type: "clear_mirrored_adj_then_random", multiplier: 2 }],
    note: "自機マスと同番号の回避側マス隣接の弾幕を全除去→除去数×2のランダム",
  },

  // ═══════════════════════════════════════════════════════ 十六夜咲夜
  "幻符「殺人ドール」": {
    auto: "full",
    steps: [{ type: "enemy", count: 1 }],
    effects: [{ type: "reduce_enemy_evasion", amount: 1 }],
  },
  "時符「プライベートスクェア」": {
    auto: "partial",
    steps: [{ type: "designated", count: 3 }],
    condition_on_placement: { exclude_enemy_cell: true },
  },
  "傷魂「ソウルスカルプチュア」": {
    auto: "full",
    condition: { enemy_cell_empty: true },
    steps: [{ type: "random", count: 5 }],
  },

  // ═══════════════════════════════════════════════════════ レミリア・スカーレット
  "神槍「スピア・ザ・グングニル」": {
    auto: "full",
    steps: [{ type: "self", count: 1, after: [{ type: "vertical_of_placed", count: 2 }] }],
  },
  "紅符「不夜城レッド」": {
    auto: "full",
    steps: [{ type: "self", count: 2 }],
  },

  // ═══════════════════════════════════════════════════════ フランドール・スカーレット
  "禁忌「レーヴァテイン」": {
    auto: "full",
    steps: [{ type: "self", count: 1, after: [{ type: "horizontal_of_placed", count: 1 }] }],
  },
  "禁忌「フォーオブアカインド」": {
    auto: "full",
    timing: "round_start",
    effects: [{ type: "extra_support_cover", count: 3 }],
  },
  "QED「495年の波紋」": {
    auto: "full",
    steps: [{ type: "non_adjacent_to_mirrored", count: 1 }],
    note: "自機と同番号の回避側マスに上下左右隣接するマス以外の全マスに×1",
  },

  // ═══════════════════════════════════════════════════════ アリス・マーガトロイド
  "咒詛「魔彩光の上海人形」": {
    auto: "full",
    effects: [{ type: "double_support_cover" }],
    note: "ショットステップ中：援護射撃/かばうのいずれかを2回行う",
  },
  "魔符「アーティフルサクリファイス」": {
    auto: "full",
    steps: [{ type: "random", count: 1, after: [{ type: "all_neighbors_of_placed", count: 1 }] }],
  },
  "呪符「ストロードールカミカゼ」": {
    auto: "manual",
    steps: [{ type: "designated", count: { type: "battle_track", stat: "skipped_support_cover", multiplier: 2 } }],
    note: "X=前回このSC使用後〜今回までの援護/かばうスキップ回数×2",
  },

  // ═══════════════════════════════════════════════════════ 魂魄妖夢
  "獄界剣「二百由旬の一閃」": {
    auto: "full",
    condition: { attacker_in_cells: [1, 2, 3] },
    steps: [
      { type: "fixed_cells", cells: [1, 2, 3], count: 1 },
      { type: "self", count: 1 },
    ],
  },
  "人鬼「未来永劫斬」": {
    auto: "full",
    steps: [{ type: "self", count: 2 }],
  },
  "空観剣「六根清浄斬」": {
    auto: "full",
    steps: [{ type: "self", count: 1 }],
    note: "喰らいボム宣言後に回避成功時も追加SC消費なしで使用可能",
  },

  // ═══════════════════════════════════════════════════════ 西行寺幽々子
  "死符「ギャストリドリーム」": {
    auto: "full",
    steps: [{ type: "adjacent_enemy", count: 1 }],
  },
  "蝶符「鳳蝶紋の死槍」": {
    auto: "full",
    steps: [{ type: "self", count: 2 }],
  },
  "桜符「西行桜吹雪」": {
    auto: "full",
    condition: { enemy_cell_empty: true },
    steps: [{ type: "random", count: 5 }],
  },

  // ═══════════════════════════════════════════════════════ 八雲藍
  "式輝「四面楚歌チャーミング」": {
    auto: "full",
    steps: [{ type: "adjacent_enemy", count: 1 }],
  },
  "式神「橙」": {
    auto: "full",
    steps: [
      { type: "random", count: 3 },
      { type: "self", count: 1 },
    ],
    note: "《橙からの絆》としても扱う（応援時SC×1消費）",
  },
  "式輝「プリンセス天狐」": {
    auto: "partial",
    steps: [{ type: "enemy", count: 1 }],
    effects: [{ type: "self_move_any" }],
  },

  // ═══════════════════════════════════════════════════════ 八雲紫
  "境符「四重結界」": {
    auto: "partial",
    steps: [{ type: "adjacent_enemy", count: 1 }],
    effects: [{ type: "enemy_move_adjacent" }],
  },
  "廃線「ぶらり廃駅下車の旅」": {
    auto: "full",
    steps: [{ type: "fixed_cells", cells: [2, 2, 5, 5], count: 1 }],
    note: "2番マスに×2、5番マスに×2",
  },
  "式神「八雲藍」": {
    auto: "partial",
    steps: [
      { type: "random", count: 3 },
      { type: "designated", count: 1 },
    ],
    note: "ランダム処理を先に行い、その後指定マス処理を行う。《八雲藍からの絆》としても扱う",
  },

  // ═══════════════════════════════════════════════════════ 伊吹萃香
  "萃符「戸隠山投げ」": {
    auto: "full",
    steps: [
      { type: "self", count: 1 },
      { type: "random", count: 1 },
      { type: "self_if_same_cell", count: 1 },
    ],
    note: "攻守が同マスの場合のみ自機マスに追加×1",
  },
  "鬼符「ミッシングパワー」": {
    auto: "full",
    steps: [{ type: "self", count: 1, after: [{ type: "all_neighbors_of_placed", count: 1 }] }],
    effects: [{ type: "reduce_own_evasion", amount: 1 }],
  },
  "「百万鬼夜行」": {
    auto: "full",
    steps: [{ type: "random", count: 5 }],
    effects: [{ type: "reduce_own_evasion", amount: 1 }],
  },

  // ═══════════════════════════════════════════════════════ 鈴仙・優曇華院・イナバ
  "散符「真実の月」": {
    auto: "partial",
    steps: [{ type: "clear_chosen_then_random", choose: { max: 3 }, multiplier: 2 }],
  },
  "「幻朧月睨」": {
    auto: "manual",
    note: "回避側の任意弾幕を除去→2回目の回避直前に元のマスに再配置",
  },
  "月眼「月兎遠隔催眠術」": {
    auto: "full",
    steps: [{ type: "move_all_vertical" }],
    note: "全弾幕を上下隣接マスに移動",
  },

  // ═══════════════════════════════════════════════════════ 八意永琳
  "操神「オモイカネディバイス」": {
    auto: "manual",
    note: "このラウンド中、回避側は左右→上下の順番でしか回避方向を選べない",
  },
  "薬符「壺中の大銀河」": {
    auto: "full",
    steps: [{ type: "adjacent_enemy", count: 1 }],
  },
  "薬符「胡蝶夢丸ナイトメア」": {
    auto: "full",
    steps: [{ type: "mirrored_adj_self", count: 1 }],
    note: "自機マスと同番号の回避側マスの上下左右隣接マスに×1",
  },

  // ═══════════════════════════════════════════════════════ 蓬莱山輝夜
  "神宝「ブディストダイアモンド」": {
    auto: "full",
    steps: [{ type: "random", count: 2, after: [{ type: "vertical_of_placed", count: 1 }] }],
  },
  "神宝「ブリリアントドラゴンバレッタ」": {
    auto: "full",
    steps: [
      { type: "enemy", count: 1 },
      { type: "random", count: 2 },
    ],
  },
  "新難題「金閣寺の一枚天井」": {
    auto: "partial",
    steps: [{ type: "designated", count: 1, after: [{ type: "horizontal_of_placed", count: 1 }] }],
  },

  // ═══════════════════════════════════════════════════════ 藤原妹紅
  "蓬莱「凱風快晴・フジヤマヴォルケイノ」": {
    auto: "partial",
    steps: [{ type: "designated", count: { type: "battle_track", stat: "hp_reduced_count" } }],
    note: "X=このセッション中に自分の残り人数が減少した回数",
  },
  "「リザレクション」": {
    auto: "manual",
    timing: "on_dodge_fail",
    effects: [{ type: "cancel_hp_reduction" }],
    note: "残り人数が減少するときに使用。その処理を打ち消す（発生はしたものとして扱う）",
  },
  "滅罪「正直者の死」": {
    auto: "partial",
    steps: [{ type: "adjacent_enemy", count: 2 }],
    effects: [{ type: "enemy_may_stay_on_dodge" }],
    note: "このラウンドの回避で成功時、回避側はその場にとどまることを選べる",
  },

  // ═══════════════════════════════════════════════════════ 射命丸文
  "風神「風神木の葉隠れ」": {
    auto: "full",
    steps: [{ type: "adjacent_enemy", count: 1 }],
  },
  "「幻想風靡」": {
    auto: "manual",
    note: "自機を隣接空きマスへ移動→同番号回避側マスに×1、これを4回まで繰り返す",
  },
  "望遠「キャンディッドショット」": {
    auto: "partial",
    steps: [{ type: "designated", count: 1, after: [{ type: "remove_attacker_mirror", count: 1 }] }],
    note: "配置マスと同番号の自フィールドマスの弾幕を除去。自機マスなら2個除去",
  },

  // ═══════════════════════════════════════════════════════ 風見幽香
  "花符「幻想郷の開花」": {
    auto: "full",
    steps: [{ type: "random", count: 4 }],
  },
  "幻想「花鳥風月、嘯風弄月」": {
    auto: "full",
    steps: [{ type: "adjacent_enemy", count: 1 }],
  },
  "「幻想春花」": {
    auto: "full",
    steps: [{ type: "random", count: 1 }],
    effects: [{ type: "no_sc_cost" }],
  },

  // ═══════════════════════════════════════════════════════ 小野塚小町
  "死神「ヒガンルトゥール」": {
    auto: "partial",
    steps: [{ type: "designated", count: 2 }],
  },
  "死歌「八重霧の渡し」": {
    auto: "partial",
    effects: [{ type: "pre_self_move_adjacent" }],
    steps: [{ type: "self", count: 2 }],
  },
  "薄命「余命幾許も無し」": {
    auto: "full",
    steps: [{ type: "enemy", count: 1 }],
    effects: [{ type: "extra_hp_loss_if_same_cell_fail" }],
    note: "直後の回避で自機と同番号に回避側がいて回避失敗→追加で残り人数-1",
  },

  // ═══════════════════════════════════════════════════════ 河城にとり
  "光学「オプティカルカモフラージュ」": {
    auto: "partial",
    steps: [{ type: "random", count: 2 }],
    effects: [{ type: "next_dodge_no_evasion_loss" }],
    note: "回避を行う前に宣言。次の回避判定後1回だけ回避力を減少させずに回避可能",
  },
  "河童「お化けキューカンバー」": {
    auto: "full",
    steps: [{ type: "adjacent_enemy", count: 1 }],
  },
  "水符「河童のポロロッカ」": {
    auto: "full",
    condition: { attacker_adj_all_empty: true },
    steps: [{ type: "random", count: 5 }],
  },

  // ═══════════════════════════════════════════════════════ 東風谷早苗
  "秘術「グレイソーマタージ」": {
    auto: "partial",
    steps: [{ type: "choice_fixed", options: [[1, 3, 5], [2, 4, 6]], count: 1 }],
    note: "奇数列(1,3,5)か偶数列(2,4,6)のいずれかを選び各マスに×1",
  },
  "蛙符「手管の蝦蟇」": {
    auto: "full",
    timing: "round_end",
    steps: [{ type: "fill_empty_cells", count: 1 }],
  },
  "神徳「五穀豊穣ライスシャワー」": {
    auto: "full",
    steps: [{ type: "random", count: 5 }],
    effects: [{ type: "costs_rei", amount: 1 }],
  },

  // ═══════════════════════════════════════════════════════ 八坂神奈子
  "神祭「エクスパンデッド・オンバシラ」": {
    auto: "full",
    steps: [{ type: "fixed_cells", cells: [1, 3, 4, 6], count: 1 }],
  },
  "贄符「御射山御狩神事」": {
    auto: "full",
    steps: [{ type: "enemy", count: 2 }],
    effects: [{ type: "increase_enemy_evasion", amount: 1 }],
  },
  "御柱「オンバシラバンカーバスター」": {
    auto: "full",
    steps: [{ type: "random", count: 2, after: [{ type: "vertical_of_placed", count: 1 }] }],
  },

  // ═══════════════════════════════════════════════════════ 洩矢諏訪子
  "土着神「ケロちゃん風雨に負けず」": {
    auto: "full",
    steps: [{ type: "random", count: 4 }],
  },
  "神具「洩矢の鉄の輪」": {
    auto: "partial",
    steps: [{ type: "designated", count: 2 }],
  },
  "祟符「ミシャグジさま」": {
    auto: "full",
    steps: [{ type: "fill_empty_cells", count: 1 }],
  },

  // ═══════════════════════════════════════════════════════ 比那名居天子
  "要石「天地開闢プレス」": {
    auto: "full",
    steps: [{ type: "self", count: 2 }],
  },
  "「全人類の緋想天」": {
    auto: "full",
    steps: [{ type: "self", count: 1, after: [{ type: "vertical_of_placed", count: 2 }] }],
  },
  "要石「乾坤鳴動砲」": {
    auto: "full",
    steps: [
      { type: "self", count: 1 },
      { type: "enemy", count: 1 },
    ],
    note: "2マスが隣接していなければ、2番/5番マスのうち両方と隣接するマスに×1追加",
  },

  // ═══════════════════════════════════════════════════════ 星熊勇儀
  "怪輪「地獄の苦輪」": {
    auto: "full",
    steps: [{ type: "random", count: 2, after: [{ type: "vertical_of_placed", count: 1 }] }],
  },
  "力業「大江山嵐」": {
    auto: "full",
    steps: [{ type: "random", count: 4 }],
  },
  "四天王奥義「三歩必殺」": {
    auto: "manual",
    note: "直後の回避ステップで回避判定ごとに1D→同番号マスに×1。3回目は×2",
  },

  // ═══════════════════════════════════════════════════════ 古明地さとり
  "想起「(特殊効果を参照)」": {
    auto: "manual",
    note: "《想起「恐怖症催眠術」》使用中のみ有効。このセッション中使用済みSCの1つと同じ効果",
  },
  "想起「恐怖症催眠術」": {
    auto: "partial",
    steps: [{ type: "designated", count: 1 }],
  },
  "脳符「ブレインフィンガープリント」": {
    auto: "manual",
    note: "使用時2D振る。直後の回避で最初の回避成功→移動直後に上記ダイス番号マスに×1ずつ",
  },

  // ═══════════════════════════════════════════════════════ 火焔猫燐
  "恨霊「スプリーンイーター」": {
    auto: "full",
    steps: [{ type: "adjacent_enemy", count: 1 }],
  },
  "呪精「ゾンビフェアリー」": {
    auto: "manual",
    note: "直後の回避で成功のたびに、除去される弾幕のうち1つを残す",
  },
  "酔歩「キャットランダムウォーク」": {
    auto: "manual",
    note: "自機を空きマスへ繰り返し移動→移動回数をXとしてランダム×X",
  },

  // ═══════════════════════════════════════════════════════ 霊烏路空
  "爆符「メガフレア」": {
    auto: "full",
    steps: [{ type: "random", count: 1, after: [{ type: "add_to_placed", count: 3 }] }],
    note: "配置したマスにさらに3つ追加",
  },
  "「地獄の人工太陽」": {
    auto: "full",
    timing: "round_end",
    steps: [{ type: "fill_empty_cells", count: 1 }],
  },
  "「太陽を盗んだ鴉」": {
    auto: "full",
    condition: { enemy_cell_empty: true },
    steps: [{ type: "random", count: 5 }],
    effects: [{ type: "self_hp_loss_if_no_damage" }],
    note: "このラウンドで残り人数が減少しなければ自分の残り人数-1",
  },

  // ═══════════════════════════════════════════════════════ 古明地こいし
  "本能「イドの開放」": {
    auto: "full",
    steps: [{ type: "adjacent_enemy", count: 1 }],
    effects: [{ type: "enemy_move_adjacent_if_same_number" }],
    note: "回避側のいるマスが自機と同番号の場合、回避側を上下左右隣接マスへ移動",
  },
  "抑制「スーパーエゴ」": {
    auto: "full",
    steps: [{ type: "adjacent_enemy", count: 1 }],
    effects: [{ type: "enemy_forced_to_attacker_number_cell" }],
    note: "配置後、回避側を自機マスと同番号の回避側フィールドマスへ強制移動",
  },
  "「サブタレイニアンローズ」": {
    auto: "manual",
    note: "直後の回避で成功のたびに、除去される弾幕のうち1つを残す",
  },

  // ═══════════════════════════════════════════════════════ ナズーリン
  "視符「ナズーリンペンデュラム」": {
    auto: "full",
    steps: [{ type: "random", count: 3, after: [{ type: "remove_attacker_mirror", count: 1 }] }],
  },
  "棒符「ナズーリンロッド」": {
    auto: "full",
    steps: [{ type: "adjacent_enemy", count: 1 }],
  },
  "宝塔「グレイテイストトレジャー」": {
    auto: "full",
    steps: [{ type: "clear_enemy_adj_then_random", multiplier: 2 }],
  },

  // ═══════════════════════════════════════════════════════ 多々良小傘
  "雨傘「超撥水かさかさお化け」": {
    auto: "full",
    steps: [{ type: "random", count: { type: "stat", stat: "攻撃力" } }],
  },
  "後光「からかさ驚きフラッシュ」": {
    auto: "full",
    steps: [{ type: "adjacent_enemy", count: 1 }],
  },
  "虹符「オーバー・ザ・レインボー」": {
    auto: "partial",
    steps: [{ type: "choice_fixed", options: [[2, 3, 5], [1, 2, 4]], count: 1 }],
  },

  // ═══════════════════════════════════════════════════════ 村紗水蜜
  "転覆「道連れアンカー」": {
    auto: "full",
    steps: [
      { type: "self", count: 1 },
      { type: "enemy", count: 1 },
    ],
  },
  "幽霊「シンガーゴースト」": {
    auto: "partial",
    steps: [{ type: "random", count: 4 }],
    effects: [{ type: "self_move_empty" }],
  },
  "舟符「キャプテンムラサの不幸な出航」": {
    auto: "full",
    steps: [{ type: "random", count: 5 }],
    effects: [{ type: "reduce_own_evasion", amount: 1 }],
  },

  // ═══════════════════════════════════════════════════════ 聖白蓮
  "超人「聖白蓮」": {
    auto: "full",
    steps: [{ type: "self", count: 1, after: [{ type: "horizontal_of_placed", count: 1 }] }],
  },
  "飛鉢「フライングファンタスティカ」": {
    auto: "full",
    steps: [{ type: "mirrored_adj_self", count: 1 }],
    note: "自機マスと同番号の回避側マスに上下左右隣接する全マスに×1",
  },
  "「アーンギラサヴェーダ」": {
    auto: "partial",
    effects: [
      { type: "self_move_to_enemy_number" },
      { type: "roll_1d_then_enemy_move_and_place", count: 1 },
    ],
    note: "自機を回避側と同番号マスへ移動→1D振り→回避側をそのマスへ移動→弾幕×1配置",
  },

  // ═══════════════════════════════════════════════════════ 封獣ぬえ
  "正体不明「忿怒のレッドUFO襲来」": {
    auto: "partial",
    timing: "round_start",
    effects: [{ type: "extra_support_cover_with_die_choice", count: 2 }],
    note: "援護/かばうを2回まで宣言可。その処理でダイス目を任意選択（同じ目は不可）",
  },
  "鵺符「弾幕キメラ」": {
    auto: "full",
    steps: [{ type: "clear_enemy_adj_then_enemy", max: 2 }],
    note: "敵機隣接マスの弾幕を除去（最大2）→除去数と同じ分の敵機マスに配置",
  },
  "「遊星よりの弾幕X」": {
    auto: "full",
    steps: [{ type: "random_clear_then_double", count: 4 }],
    note: "ランダム×4。配置マスの既存弾幕を除去→新たに2つずつ配置",
  },

  // ═══════════════════════════════════════════════════════ 姫海棠はたて
  "連写「ラピッドショット」": {
    auto: "full",
    steps: [{ type: "random", count: 3, after: [{ type: "remove_attacker_mirror", count: 1 }] }],
  },
  "遠眼「天狗サイコグラフィ」": {
    auto: "partial",
    steps: [{ type: "designated", count: 1, after: [{ type: "remove_attacker_mirror", count: 1 }] }],
  },
  "写真「籠もりパパラッチ」": {
    auto: "full",
    steps: [{ type: "random", count: 5 }],
    effects: [{ type: "remove_from_enemy_cell", count: 1 }],
    note: "配置直後、回避側のいるマスの弾幕を1つ除去",
  },

  // ═══════════════════════════════════════════════════════ 霍青娥
  "邪符「ヤンシャオグイ」": {
    auto: "full",
    steps: [
      { type: "clear_enemy_cell" },
      { type: "enemy", count: 2 },
    ],
    note: "使用時点で回避側のいるマスに弾幕があれば全て除去してから配置",
  },
  "通霊「トンリン芳香」": {
    auto: "full",
    steps: [
      { type: "random", count: 2 },
      { type: "enemy", count: 1 },
    ],
    note: "《宮古芳香からの絆》としても扱う（応援時SC×1消費）",
  },
  "仙術「壁抜けワームホール」": {
    auto: "partial",
    effects: [{ type: "self_move_any" }],
    steps: [{ type: "mirrored_adj_self", count: 1 }],
  },

  // ═══════════════════════════════════════════════════════ 物部布都
  "投皿「物部の八十瓮」": {
    auto: "full",
    steps: [{ type: "clear_enemy_adj_then_random", multiplier: 1 }],
  },
  "炎符「廃仏の炎風」": {
    auto: "full",
    steps: [{ type: "adjacent_enemy", count: 1 }],
  },
  "「大火の改新」": {
    auto: "full",
    timing: "round_end",
    steps: [{ type: "fill_empty_cells", count: 1 }],
  },

  // ═══════════════════════════════════════════════════════ 豊聡耳神子
  "眼光「十七条のレーザー」": {
    auto: "full",
    steps: [{ type: "enemy_cross_h", count: 1 }],
    note: "回避側の左右隣接マスと、それら各マスの上下隣接マスに×1",
  },
  "人符「勧善懲悪は古の良き典なり」": {
    auto: "full",
    steps: [{ type: "enemy", count: 1, after: [{ type: "vertical_of_placed", count: 1 }] }],
  },
  "召喚「豪族乱舞」": {
    auto: "full",
    steps: [{ type: "random", count: 3 }],
    note: "《物部布都からの絆》or《蘇我屠自古からの絆》としても扱う（応援時SC×1消費、×2でSC×2消費）",
  },

  // ═══════════════════════════════════════════════════════ 二ツ岩マミゾウ
  "変化「鳥獣戯画」": {
    auto: "partial",
    steps: [{ type: "designated", count: 2 }],
  },
  "変化「分福熱湯風呂」": {
    auto: "full",
    steps: [{ type: "self", count: 2 }],
  },
  "変化「まぬけ巫女の偽調伏」": {
    auto: "manual",
    note: "《化けさせる程度の能力》使用中のみ有効。選んだキャラの任意SCと同じ効果",
  },

  // ═══════════════════════════════════════════════════════ 秦こころ
  "怒面「怒れる忌狼の面」": {
    auto: "partial",
    effects: [{ type: "pre_self_move_adjacent" }],
    steps: [{ type: "self", count: 2 }],
  },
  "憂面「杞人地を憂う」": {
    auto: "full",
    condition: { own_evasion_min: 1 },
    steps: [{ type: "enemy", count: 2 }],
    effects: [{ type: "costs_own_evasion", amount: 1 }],
  },
  "「仮面喪心舞　暗黒能楽」": {
    auto: "full",
    steps: [{ type: "self", count: 2 }],
  },

  // ═══════════════════════════════════════════════════════ 鬼人正邪
  "逆符「鏡の国の弾幕」": {
    auto: "full",
    steps: [{ type: "mirror_bullet_counts" }],
    note: "弾幕1個のマス→3個、3個以上のマス→1個に置き直す",
  },
  "逆転「リバースヒエラルキー」": {
    auto: "full",
    steps: [{ type: "shift_cells_up1" }],
    note: "全弾幕を1番号大きいマスへ移動（6→1）",
  },
  "逆符「天地有用」": {
    auto: "full",
    steps: [{ type: "move_all_vertical" }],
  },

  // ═══════════════════════════════════════════════════════ 少名針妙丸
  "小槌「大きくなあれ」": {
    auto: "full",
    steps: [{ type: "double_single_bullets" }],
    note: "弾幕が1個だけのマスにそれぞれ+1",
  },
  "輝針「鬼ごろし両目突きの針」": {
    auto: "partial",
    steps: [{ type: "designated", count: 2 }],
  },
  "小槌「お前が大きくなあれ」": {
    auto: "partial",
    steps: [{ type: "designated", count: 1 }],
    effects: [{ type: "reduce_enemy_evasion", amount: 1 }],
  },

  // ═══════════════════════════════════════════════════════ 宇佐見菫子
  "銃符「3Dプリンターガン」": {
    auto: "partial",
    steps: [{ type: "roll_check_then_place", check: { dice: 2, target: 6 }, success: [{ type: "enemy", count: 3 }], fail: [] }],
  },
  "念力「サイコキネシスアプリ」": {
    auto: "partial",
    steps: [{ type: "roll_check_then_place", check: { dice: 2, target: 4 }, success: [{ type: "designated", count: 3 }], fail: [{ type: "designated", count: 1 }] }],
  },
  "紙符「ESPカード手裏剣」": {
    auto: "partial",
    steps: [{ type: "roll_check_then_place", check: { dice: 2, target: 4 }, success: [{ type: "random", count: 5 }], fail: [{ type: "random", count: 3 }] }],
  },

  // ═══════════════════════════════════════════════════════ 茨木華扇
  "龍符「ドラゴンズグロウル」": {
    auto: "full",
    steps: [{ type: "self", count: 2 }],
  },
  "包符「義腕プロテウス」": {
    auto: "full",
    steps: [{ type: "enemy", count: 1, after: [{ type: "horizontal_of_placed", count: 1 }] }],
  },
  "鷹符「ホークビーコン」": {
    auto: "full",
    steps: [{ type: "random", count: 2 }],
    effects: [{ type: "extra_familiar_per_round_this_phase" }],
    note: "フェイズ終了まで、《使い魔》に加えてさらに1ラウンドに1回の援護/かばうが追加",
  },

  // ═══════════════════════════════════════════════════════ ドレミー・スイート
  "夢符「ドリームキャッチャー」": {
    auto: "partial",
    steps: [{ type: "adjacent_enemy", count: 1 }],
    effects: [{ type: "optional_clear_then_random" }],
    note: "配置後、任意数を除去→除去数分のランダムを行うことができる",
  },
  "胡蝶「バタフライサプランテーション」": {
    auto: "full",
    steps: [{ type: "mirrored_adj_self", count: 1 }],
  },
  "羊符「ナイトメア・オブ・キメラ」": {
    auto: "full",
    steps: [{ type: "clear_all_then_random", multiplier: 1, count: 6 }],
    note: "全マスから1つずつ除去→ランダム×6",
  },

  // ═══════════════════════════════════════════════════════ クラウンピース
  "獄符「フラッシュアンドストライプ」": {
    auto: "partial",
    steps: [{ type: "choice_fixed", options: [[4, 5, 6], [1, 2, 3]], count: 1 }],
  },
  "獄炎「グレイズインフェルノ」": {
    auto: "manual",
    note: "最初の回避成功後、回避側のいたマスの全弾幕を上下左右隣接の任意1マスへ移動（攻撃側が選ぶ）",
  },
  "「フェイクアポロ」": {
    auto: "full",
    steps: [{ type: "random_3d_clear_then_all_neighbors", count: 3 }],
    note: "3D振り→3マスをランダム選択→各マスの弾幕除去→上下左右隣接に×1ずつ",
  },

  // ═══════════════════════════════════════════════════════ 高麗野あうん
  "独楽「コマ犬回し」": {
    auto: "full",
    steps: [{ type: "mirrored_adj_self", count: 1 }],
  },
  "狗符「山狗の散歩」": {
    auto: "partial",
    steps: [{ type: "designated", count: 2 }],
  },
  "狛符「独り阿吽の呼吸」": {
    auto: "full",
    steps: [{ type: "duplicate_previous_shot" }],
    note: "直前のショットで配置したマスに+1ずつ（同マス複数配置は1つのみ）",
  },

  // ═══════════════════════════════════════════════════════ 摩多羅隠岐奈
  "後符「絶対秘神の後光」": {
    auto: "full",
    steps: [{ type: "move_all_vertical" }],
  },
  "扉符「太古に失われた背中」": {
    auto: "full",
    steps: [{ type: "random", count: 2 }],
    effects: [{ type: "shift_non_25_horizontal" }],
    note: "配置後、2番/5番以外のマスの弾幕を左右隣接マスへ移動",
  },
  "秘儀「マターラドゥッカ」": {
    auto: "full",
    steps: [{ type: "clear_enemy_adj_then_enemy", multiplier: 0.5, round: "ceil" }],
    note: "敵機隣接マスの弾幕を全除去→除去数の半分（切り上げ）の敵機マスに配置",
  },

  // ═══════════════════════════════════════════════════════ 依神女苑
  "貧符「超貧乏玉」": {
    auto: "full",
    steps: [{ type: "enemy", count: 1, after: [{ type: "vertical_of_placed", count: 1 }] }],
  },
  "「クイーンオブバブル」": {
    auto: "full",
    steps: [
      { type: "enemy", count: 1 },
      { type: "self", count: 1 },
    ],
  },
  "「アブソリュートルーザー」": {
    auto: "manual",
    note: "このラウンド中、相手の判定ダイスに1が1つ以上あれば（スペシャルでなければ）失敗",
  },

  // ═══════════════════════════════════════════════════════ 依神紫苑
  "貧符「ミスチャンススキャッター」": {
    auto: "partial",
    effects: [{ type: "pre_self_move_adjacent" }],
    steps: [{ type: "self", count: 2 }],
  },
  "「最凶最悪の極貧不幸神」": {
    auto: "full",
    steps: [{ type: "adjacent_enemy", count: 1 }],
  },

  // ═══════════════════════════════════════════════════════ 庭渡久侘歌
  "鬼符「鬼渡の試練」": {
    auto: "partial",
    steps: [{ type: "designated", count: 2 }],
  },
  "光符「見渡しの試練」": {
    auto: "full",
    steps: [{ type: "enemy_cross_h", count: 1 }],
  },
  "血戦「全霊鬼渡り」": {
    auto: "full",
    steps: [{ type: "enemy", count: 1 }],
    effects: [{ type: "place_at_enemy_after_first_dodge", count: 1 }],
    note: "直後の回避で最初の回避成功→移動先マスに×1配置",
  },

  // ═══════════════════════════════════════════════════════ 吉弔八千慧
  "亀符「亀甲地獄」": {
    auto: "full",
    steps: [{ type: "adjacent_enemy", count: 1 }],
  },
  "龍符「龍紋弾」": {
    auto: "full",
    steps: [{ type: "random", count: 2, after: [{ type: "double_each_placed", count: 1 }] }],
  },
  "亀符「吉弔大結界」": {
    auto: "partial",
    steps: [{ type: "adjacent_enemy", count: 2 }],
    effects: [{ type: "enemy_may_stay_on_dodge" }],
  },

  // ═══════════════════════════════════════════════════════ 埴安神袿姫
  "線形「線形造形術」": {
    auto: "full",
    steps: [{ type: "adjacent_enemy", count: 1 }],
  },
  "埴輪「偶像人馬造形術」": {
    auto: "full",
    timing: "round_start",
    effects: [{ type: "extra_support_cover", count: 3 }],
  },
  "「鬼形造形術」": {
    auto: "full",
    condition: { no_support_this_round: true },
    steps: [{ type: "random", count: 5 }],
  },

  // ═══════════════════════════════════════════════════════ 驪駒早鬼
  "勁疾技「ブラックペガサス流星弾」": {
    auto: "partial",
    steps: [{ type: "random", count: 3 }],
    effects: [{ type: "optional_redo_random", count: 3 }],
    note: "配置後、除去してもう一度ランダム×3を行うことができる（任意）",
  },
  "勁疾技「マッスルエクスプロージョン」": {
    auto: "full",
    effects: [{ type: "random_3d_after_first_dodge", count: 3 }],
    note: "直後の回避で最初の回避成功→移動直後に3D振りランダム3マスへ×1",
  },
  "天星馬「ペガサスクロス」": {
    auto: "full",
    steps: [{ type: "random", count: 5 }],
    effects: [{ type: "remove_if_hit_enemy_cell" }],
    note: "配置で回避側のいるマスに弾幕が置かれた場合、その弾幕を取り除く",
  },

  // ═══════════════════════════════════════════════════════ 管牧典
  "狐符「フォックスワインダー」": {
    auto: "partial",
    steps: [{ type: "designated", count: 2 }],
  },
  "管狐「シリンダーフォックス」": {
    auto: "full",
    steps: [{ type: "random_2d_exclude_then_fill", count: 1 }],
    note: "2D振り→出た目以外の全マスに×1ずつ",
  },
  "狐符「遅効性の管狐弾」": {
    auto: "full",
    effects: [{ type: "random_3d_after_first_dodge", count: 3 }],
  },

  // ═══════════════════════════════════════════════════════ 天弓千亦
  "「バレットドミニオン」": {
    auto: "full",
    steps: [{ type: "random", count: { type: "stat", stat: "グレイズ", multiplier: 2 } }],
    effects: [{ type: "reset_graze" }],
  },
  "「バレットマーケット」": {
    auto: "partial",
    steps: [{ type: "designated", count: { type: "stat", stat: "グレイズ" } }],
    effects: [{ type: "reset_graze" }],
  },
  "「闇市場のミシガンロール」": {
    auto: "full",
    steps: [{ type: "random", count: 2 }],
    effects: [{ type: "mirror_graze_gain" }],
    note: "直後の回避ステップ中、相手がグレイズを獲得したとき同量獲得",
  },

  // ═══════════════════════════════════════════════════════ 饕餮尤魔
  "宿怨「ゴージライザー」": {
    auto: "full",
    steps: [{ type: "random", count: 4 }],
  },
  "剛欲「この世に存在してはならない暴食」": {
    auto: "partial",
    steps: [{ type: "self", count: 2 }],
    effects: [{ type: "enemy_move_adjacent" }],
  },
  "「お腹を空かせたグリードモンスター」": {
    auto: "full",
    steps: [{ type: "clear_all_then_random", multiplier: 2 }],
    note: "全マスから1つずつ除去→除去数×2のランダム",
  },

  // ═══════════════════════════════════════════════════════ 日白残無
  "「純霊弾」": {
    auto: "full",
    steps: [{ type: "random", count: 4 }],
  },
  "「無心純霊弾」": {
    auto: "partial",
    condition: { after_another_spell_same_step: true },
    steps: [{ type: "designated", count: 2 }],
    note: "同ステップで別のSCを使用した直後にのみ使用可能",
  },
  "「亡羊のキングダム」": {
    auto: "manual",
    timing: "hit_check_end",
    note: "当たり判定ステップ終了時に使用。もう一度自分が攻撃側となる手番を行う",
  },
};

// ─── ユーティリティ ──────────────────────────────────────────────────────────

/** スペルカード名からeffectデータを取得（文字列内の名前部分を抽出して検索） */
export function getSpellCardEffect(spellCardString) {
  if (!spellCardString) return null;
  // "符名「カード名」..." の形式から「」内を取り出す
  const match = spellCardString.match(/^[^「]*「([^」]+)」/);
  const nameWithBracket = match ? `${spellCardString.split("「")[0]}「${match[1]}」` : null;
  if (nameWithBracket && SPELL_CARD_EFFECTS[nameWithBracket]) {
    return SPELL_CARD_EFFECTS[nameWithBracket];
  }
  // 完全一致でも検索
  return SPELL_CARD_EFFECTS[spellCardString] || null;
}

/** スペルカード文字列からカード名のみを抽出 */
export function extractSpellCardName(spellCardString) {
  if (!spellCardString) return spellCardString;
  const bracketIdx = spellCardString.indexOf("】");
  // 【...】パターンが終わる位置まではカード名+効果表記なので名前部分だけ返す
  const firstBracket = spellCardString.indexOf("【");
  if (firstBracket > 0) return spellCardString.slice(0, firstBracket).trim();
  // 【がない場合はスペースや説明文が続く可能性があるのでそのまま返す
  return spellCardString;
}
