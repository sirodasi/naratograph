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
        "ninzu": 3,
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
    "author": "幻想ナラトグラフ",
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
          "ninzu": 2,
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
          "ninzu": 2,
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
          "ninzu": 2,
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
];
