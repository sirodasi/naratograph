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
//   official      : true なら「公式」バッジ表示（幻想ナラトグラフ公式作のサンプル等）。
//                   ★保存方法（収録/エディター）とは独立＝収録でも自作はあり得る。
//   author        : 作者クレジット（任意・自由記述。"公式" と別に「作: 〇〇」を表示）
//   keywords      : PL・GMに公開するキーワード（タグ）の配列。例 ["梅雨","結婚式"]
//   difficulty    : "Easy" | "Normal" | "Hard" | "Lunatic"
//   playerCountMin / playerCountMax : 推奨人数
//   limit         : "N日目の{朝|昼|夕|夜}" 形式のリミット
//   bannedChars[] : 選択不可キャラ名
//   intro / backstory : 導入文
//   quests[]      : クエスト定義（solutionType, level, enemy, massBattle, preBattleFlavorRoll 等）
//   phaseNotes    : 各フェイズの特殊処理メモ（GM向け）{ intro, explore, battle, epilogue }
//   finalBattleEnemies[] / finalBattleOptionalEnemies[] : 決戦の敵
//   （Hard/Lunatic データ項目）blockedSpots[] / spotRebind{} など
//
// ※ 真にコードでしか表現できない挙動だけ hooks（registry）に落とす。データで足りるものはデータで。

export const EASY_NORMAL = [
  {
    "backstory": "初夏、雨の日の憂愁を取り戻すように、賑わいを見せる人間の里の中にも、居は一際賑わっている一角があった。そこで開かれていたのは、華やかなる婚礼の儀礼。人生の晴れ舞台にして、人間の里で執り行われる祝い事の中でも、代表的なものの一つである。\nその祝言の場には参列者のほかにも、子供から老人まで、たくさんの見物人が集まっていた。通りすがりの買い物客は足を止め、幼い少女は目を輝かせて新郎新婦を覗き見ている。\n真っ白なドレスに、かっちりとしたタキシード。\n新郎新婦の服装が、里にそぐわぬ洋装だったからだ。\n\n「随分と珍しい様式だな。本当に祝言なのか？」\n「最近流行りなのよ。あの白い洋装に、宝石がついた指輪。珍しい品がたくさん必要だから、職人たちは大忙しみたいよ」\n\n見物客が噂する中、祝言は進む。里を賑わせる新たな流行と、幸せな新婚生活の始まり。少し変わった、人間の里の日常。――そのはずだった。\n\n幻想ナラトグラフ「ハレを飾るは幸か不幸か」\n\nまだ湿気が残る空気に、彼女は少し汗ばんだ額を拭う。休んでなどいられない、梅雨の晴れ間は短いのだ。",
    "bannedChars": [
      "河城にとり",
      "洩矢諏訪子",
      "火焔猫燐",
      "封獣ぬえ"
    ],
    "difficulty": "Easy",
    "finalBattleEnemies": [
      {
        "attack": 7,
        "ds": {
          "desc": "ショットステップで振るダイスの数は「1」減少する。自身が対戦者であるラウンド中、観戦者として「援護射撃」「かばう」のいずれかを行うことができる。",
          "name": "使い魔",
          "type": "official"
        },
        "dsCustomName": "",
        "dsDesc": "ショットステップで振るダイスの数は「1」減少する。自身が対戦者であるラウンド中、観戦者として「援護射撃」「かばう」のいずれかを行うことができる。",
        "dsName": "使い魔",
        "dsType": "official",
        "life": 3,
        "name": "封獣ぬえ",
        "sc1effect": "",
        "sc1mode": "existing",
        "sc1name": "正体不明「忿怒のレッドUFO襲来」",
        "sc1ref": "正体不明「忿怒のレッドUFO襲来」",
        "sc2effect": "",
        "sc2mode": "existing",
        "sc2name": "鵺符「弾幕キメラ」",
        "sc2ref": "鵺符「弾幕キメラ」",
        "spellcard": 2
      }
    ],
    "id": "hare",
    "official": true,
    "author": "猫憑ノコ",
    "keywords": [
      "結婚",
      "妖怪退治"
    ],
    "limit": "3日目の夜",
    "name": "ハレを飾るは幸か不幸か",
    "notes": "",
    "playerCountMax": 4,
    "playerCountMin": 2,
    "quests": [
      {
        "enemy": {
          "attack": 5,
          "danmakuSkillCustomName": "",
          "danmakuSkillDesc": "",
          "danmakuSkillName": "",
          "danmakuSkillType": "none",
          "name": "",
          "sc1effect": "",
          "sc1name": "",
          "sc2effect": "",
          "sc2name": "",
          "spellcard": 1
        },
        "id": 1778130029087.593,
        "level": 2,
        "location": "22",
        "name": "洋婚が起こす災いとは？",
        "solutionType": "行為判定",
        "specifiedTag": "巫女",
        "summary": "里では「洋婚を挙げた夫婦には災いが起こる」と噂になっているようだ。小鈴は「誰かが何かを企んでいる」と考えているようだが...？\nまずは、洋婚を挙げた夫婦と、彼らに起こる災いについて調査してみるのがよさそうだ。",
        "truth": "どうやら、洋婚を挙げた夫婦に対して、火事や怪我、病気、夫婦関係のもつれなど、様々な「災い」が起こるというのは事実のようだ。また、その一方で、気になる情報を耳にすることもできた。災いを逃れようと、守矢神社を参拝する新婚夫婦が増えているというのだ。どうにも、人間の里の中では、「洋式の結婚式は外の世界の神を信仰する儀式であり、幻想郷の神をないがしろにしている。だから神の怒りに触れ、祟られているのだ」と考えているものがおり、そう考える人々、特に洋婚を挙げた新婚夫婦が、災いを逃れるために参拝に来るのだという。\nここは守矢神社で話を聞いてみるのも良いだろう。",
        "unlockCondition": "",
        "unlockQuestId": "",
        "unlockType": "start"
      },
      {
        "enemy": {
          "attack": 5,
          "danmakuSkillCustomName": "",
          "danmakuSkillDesc": "",
          "danmakuSkillName": "",
          "danmakuSkillType": "none",
          "dsType": "none",
          "life": 2,
          "name": "火焔猫燐",
          "sc1effect": "",
          "sc1mode": "existing",
          "sc1name": "恨霊「スプリーンイーター」",
          "sc1ref": "夢符「二重結界」",
          "sc2effect": "",
          "sc2name": "",
          "spellcard": 1
        },
        "id": 1778130101933.1113,
        "level": 2,
        "location": "46B",
        "name": "ダイヤモンドの出処を探れ",
        "solutionType": "弾幕ごっこ",
        "specifiedTag": "",
        "summary": "夫婦に災いが起こる原因は、どうやら洋婚ではなくダイヤモンドにあるようだ。\n本来里にないはずの大量のダイヤモンドは、里の外から持ち込まれたに違いない。\n呪われた宝石は、いったいどこからやってきたのだろう？",
        "truth": "ダイヤモンドの出処について調べていると、ある噂が耳に入る。なんと、灼熱地獄跡の怨霊の管理人であるお燐が、ダイヤモンドを大量に持っているというのだ。\n呪われたダイヤモンドの出処はここに違いない！お燐を問い詰めに行こう！",
        "unlockCondition": "",
        "unlockQuestId": "1778130029087.593",
        "unlockType": "quest"
      },
      {
        "enemy": {
          "attack": 5,
          "danmakuSkillCustomName": "",
          "danmakuSkillDesc": "",
          "danmakuSkillName": "",
          "danmakuSkillType": "none",
          "name": "",
          "sc1effect": "",
          "sc1name": "",
          "sc2effect": "",
          "sc2name": "",
          "spellcard": 1
        },
        "id": 1778130244541.16,
        "level": 2,
        "location": "",
        "name": "商人の正体見たり、妖怪娘",
        "solutionType": "自動解決",
        "specifiedTag": "",
        "summary": "呪われたダイヤモンドを地底から人間の里に卸しているのは、謎の妖怪らしい。\n商人の居場所は分からないが、そいつが小異変の黒幕に違いない！\n居場所を突き止めて妖怪商人を捕まえ、小異変を解決しよう！",
        "truth": "妖怪商人は、晴れた日の夕暮れ時に、地底から人間の里へ向かう道中に現れるらしい。\n梅雨の時期で雨続きだが、どうやら丁度よく、近いタイミングで晴れるようだ。\nそこで待ち伏せすれば、捕まえることができるだろう。",
        "unlockCondition": "",
        "unlockQuestId": "1778130101933.1113",
        "unlockType": "quest"
      }
    ],
    "startSpotType": "fixed"
  },
  {
  "backstory": "軒先のつららが、ぽたり、ぽたりと雫を落としている。\n幻想郷を白く閉ざしていた長い冬が、ようやく緩み始めた。屋根の雪は重たげに崩れ、道のぬかるみからは、気の早い蕗の薹が顔を覗かせている。\n雪解けの季節。何かが終わり、何かが始まる、落ち着かない頃合いだ。\n\n人間の里もまた、どこか浮き足立っていた。\n冬ごもりから解き放たれた人々が、久方ぶりに通りへ繰り出している。だが——その手のひらには、いつからか、奇妙な筒が握られていた。\n覗けば、色とりどりの硝子が、回すたびに、二度と同じ形にならぬ模様を結ぶ。万華鏡。外の世界の玩具によく似た、それでいて、どこか作り物めいて美しすぎる代物。\n\n「ねえ、見て。雪解け水の底に、こんな綺麗な世界が沈んでいたなんてねえ……」\n筒を覗き込んだまま、その娘は、もう半刻もそうしている。\n呼びかけても、振り向きもしない。\n\n幻想ナラトグラフ「雪解け万華鏡奇譚」。\n\nとけてゆくのは、雪ばかりではないのかもしれない。",
  "bannedChars": [
    "物部布都",
    "霍青娥"
  ],
  "createdAt": 1781363523958,
  "difficulty": "Normal",
  "finalBattleEnemies": [
    {
      "attack": 7,
      "customPortrait": "data:image/webp;base64,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",
      "ds": {
        "customName": "",
        "desc": "対戦者のラウンドの回避ステップ中に使用。1番マスと3番マス、4番マスと6番マスはそれぞれ相互に隣接しているものとして扱う。",
        "name": "壁抜け",
        "type": "official"
      },
      "evade": 3,
      "life": 3,
      "name": "霍青娥",
      "primary": false,
      "sc1effect": "",
      "sc1mode": "existing",
      "sc1name": "邪符「ヤンシャオグイ」",
      "sc1ref": "邪符「ヤンシャオグイ」",
      "sc2effect": "",
      "sc2mode": "existing",
      "sc2name": "通霊「トンリン芳香」",
      "sc2ref": "通霊「トンリン芳香」",
      "spellcard": 2
    }
  ],
  "id": "yukidoke-kaleidoscope",
  "author": "しろだし",
  "keywords": [
    "雪解け",
    "不穏",
    "万華鏡"
  ],
  "limit": "3日目の夜",
  "name": "雪解け万華鏡奇譚",
  "notes": "",
  "playerCountMax": 4,
  "playerCountMin": 2,
  "quests": [
    {
      "enemy": {
        "attack": 5,
        "ds": {
          "customName": "",
          "desc": "",
          "name": "",
          "type": "none"
        },
        "evade": 3,
        "life": 2,
        "name": "",
        "sc1effect": "",
        "sc1mode": "custom",
        "sc1name": "",
        "sc1ref": "",
        "sc2effect": "",
        "sc2mode": "custom",
        "sc2name": "",
        "sc2ref": "",
        "spellcard": 1
      },
      "id": 1781363676441.8503,
      "level": 2,
      "location": "11",
      "massBattle": false,
      "name": "不穏な万華鏡の噂",
      "solutionType": "行為判定",
      "specifiedTag": "人間",
      "summary": "里では「万華鏡を覗いた者が、心を奪われたように様子を変える」と噂になっている。\nまずは、万華鏡そのものと、それを覗いた里人たちに何が起きているのかを調べてみるのがよさそうだ。",
      "truth": "聞き込みを進めると、万華鏡は里をうろつく一人の行商人から、タダ同然で配られていることが分かった。覗いた里人は皆「雪解けの向こうの永遠の世界」を口にし、心ここにあらずの状態だ。\nまずは里の広場でその行商人の話を聞き出すべく、聞き込みを続けてみよう。",
      "unlockCondition": "",
      "unlockQuestId": "",
      "unlockType": "start"
    },
    {
      "enemy": {
        "attack": 5,
        "ds": {
          "customName": "",
          "desc": "",
          "name": "",
          "type": "none"
        },
        "evade": 3,
        "life": 2,
        "name": "宮古芳香",
        "sc1effect": "",
        "sc1mode": "existing",
        "sc1name": "屍符「キョンシーラッシュ」",
        "sc1ref": "恋符「マスタースパーク」",
        "sc2effect": "",
        "sc2mode": "custom",
        "sc2name": "",
        "sc2ref": "",
        "spellcard": 1
      },
      "id": 1781363677259.8364,
      "level": 2,
      "location": "12",
      "massBattle": false,
      "name": "万華鏡を配る者を捜せ",
      "solutionType": "弾幕ごっこ",
      "specifiedTag": "",
      "summary": "万華鏡の出所は、里をうろつく謎の行商人らしい。\n青白い肌のその少女を見つけ出し、誰の差し金で呪具を配っているのか、問い詰めよう。",
      "truth": "行商人の足取りを追うと、彼女が日中は里に現れ、夜は命蓮寺の裏手の墓地をねぐらにしているらしいと分かった。\nどうやら、まともに口をきいてくれる相手ではなさそうだ。夜の墓地で待ち伏せ、力ずくでも素性を吐かせよう。",
      "unlockCondition": "",
      "unlockQuestId": "1781363676441.8503",
      "unlockType": "quest"
    },
    {
      "enemy": {
        "attack": 5,
        "ds": {
          "customName": "",
          "desc": "",
          "name": "",
          "type": "none"
        },
        "evade": 3,
        "life": 2,
        "name": "",
        "sc1effect": "",
        "sc1mode": "custom",
        "sc1name": "",
        "sc1ref": "",
        "sc2effect": "",
        "sc2mode": "custom",
        "sc2name": "",
        "sc2ref": "",
        "spellcard": 1
      },
      "id": 1781363677379.8252,
      "level": 2,
      "location": "",
      "massBattle": false,
      "name": "雪解けの誘い",
      "solutionType": "自動解決",
      "specifiedTag": "",
      "summary": "黒幕が神霊廟の仙人・霍青娥だと分かった。\nだが、いきなり仙界へ乗り込む前に、あの万華鏡の呪いが何なのか、青娥が何を狙っているのかを掴んでおきたい。\n心を奪われた里人たちの様子や、幻想郷のあちこちに漂う噂をかき集め、青娥の企みの全貌を明らかにしよう。",
      "truth": "集めた断片をつなぎ合わせると、青娥の狙いが見えてきた。\nあの万華鏡は、覗いた人間の心を仙界——青娥のもとへと、少しずつ手繰り寄せる仙術の呪具だ。青娥は雪解けで人々の心が緩むこの時季を狙い、万華鏡越しに「永遠に美しい仙界の幻」を見せて人間たちを誘い、“弟子（信者）”を集めようとしているのだ。\nこのまま放っておけば、里から人の心が雪解け水のように流れ出てしまう。里人の心を取り戻すには、今すぐ神霊廟へ乗り込み、青娥本人を止めるしかない。",
      "unlockCondition": "",
      "unlockQuestId": "1781363677259.8364",
      "unlockType": "quest"
    }
  ],
  "startSpotId": "",
  "startSpotType": "fixed",
  "updatedAt": 1781364231608
  },
];
