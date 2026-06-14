// ── 実績（アチーブメント）定義 ────────────────────────────────────────
// 2層: type "session"（1セッション内）/ "lifetime"（通算）。bad:true は不名誉枠。
// check(ctx) が true で解除。ctx は buildAchContext() が生成する平坦な統計オブジェクト。
//
// ctx のセッション値（当該PC）:
//   spots(数), graze(決戦累計), specials, fumbles, intervene, interveneDecisive,
//   spells(決戦宣言), clues, items, badStatus, dsDecisive(決戦の異種弾幕数),
//   livesDropped(決戦で残り人数減), livesZero(決戦で0到達), moved, yaruki,
//   won(決戦勝利), lost(決戦敗北), allQuests, bondsAll(他PC全員絆),
//   specialBondGained(成長で特別な絆), growthBoth(成長＋強化を両方)
// ctx の通算値（集計後）:
//   L_sessions, L_chars, L_bondTargets, L_wins, L_graze, L_specials, L_ds,
//   L_spots, L_maxEnh(あるキャラの強化達成数), L_intimacy10, L_intervene,
//   L_fumbles, L_losses

import { SPOTS, OFFICIAL_DANMAKU_SKILLS } from "./gameData";
export const SPOT_TOTAL = SPOTS.length;                 // 全スポット数（27）
export const DS_TOTAL   = OFFICIAL_DANMAKU_SKILLS.length; // 弾幕スキル総数（13）

export const ACHIEVEMENTS = [
  // ── セッション実績（ポジティブ） ──
  { id: "muso",      type: "session", name: "無傷の舞",     desc: "決戦フェイズで【残り人数】を一度も減らさずに勝利", check: c => c.won && !c.livesDropped },
  { id: "kamiichi",  type: "session", name: "紙一重の達人", desc: "1決戦で【グレイズ】を累計15点以上獲得",          check: c => c.graze >= 15 },
  { id: "kenkyaku",  type: "session", name: "健脚自慢",     desc: "1セッションで異なるスポットを8箇所以上訪れる",   check: c => c.spots >= 8 },
  { id: "happo",     type: "session", name: "八方美人",     desc: "1セッションで同卓の他PC全員への絆を獲得",       check: c => c.bondsAll },
  { id: "shuyaku",   type: "session", name: "主役の星回り", desc: "1セッション中に行為判定でスペシャルを3回出す",  check: c => c.specials >= 3 },
  { id: "denko",     type: "session", name: "電光石火",     desc: "リミットより3サイクル以上前に全クエストを解決する", check: c => c.allQuests && c.slack >= 3 },
  { id: "fukutsu",   type: "session", name: "不屈の闘志",   desc: "【残り人数】が1まで減った状態を経て決戦に勝利", check: c => c.livesOne && c.won },
  { id: "gekisen",   type: "session", name: "激戦を制す",   desc: "決戦が8ラウンド以上続いた末に勝利する",        check: c => c.decisiveRounds >= 8 && c.won },
  { id: "hachimen",  type: "session", name: "八面六臂",     desc: "1セッションで援護射撃・かばうを合計5回行う",    check: c => c.intervene >= 5 },
  { id: "spellmst",  type: "session", name: "スペルマスター", desc: "1決戦でスペルカードを3回以上宣言する",         check: c => c.spells >= 3 },
  { id: "senri",     type: "session", name: "千里眼",       desc: "1セッションで手がかりを5個以上発見・配置する",  check: c => c.clues >= 5 },
  { id: "fuku",      type: "session", name: "福の神",       desc: "1セッションでアイテムを6個以上獲得する",        check: c => c.items >= 6 },
  { id: "kokou",     type: "session", name: "孤高の勝利",   desc: "援護・かばうを一度も使わず決戦に勝利する",      check: c => c.won && c.interveneDecisive === 0 },
  { id: "enmusubi",  type: "session", name: "縁結び",       desc: "成長で「特別な絆」を獲得する",                  check: c => c.specialBondGained },
  { id: "taiki",     type: "session", name: "大器晩成",     desc: "セッション終了時に「成長」と「強化」を両方行う", check: c => c.growthBoth },
  // ── セッション実績（不名誉枠） ──
  { id: "chindochu", type: "session", bad: true, name: "珍道中",       desc: "1セッションで【変調】を3つ以上抱える",        check: c => c.badStatus >= 3 },
  { id: "karamawari",type: "session", bad: true, name: "空回り",       desc: "1セッションで行為判定のファンブルを3回以上出す", check: c => c.fumbles >= 3 },
  { id: "banji",     type: "session", bad: true, name: "万事休す",     desc: "決戦に敗北する",                              check: c => c.lost },
  { id: "debusho",   type: "session", bad: true, name: "出不精",       desc: "1セッションで一度もスポットを移動しない",      check: c => !c.moved },
  { id: "sukkara",   type: "session", bad: true, name: "すっからかん", desc: "セッション終了時に【やる気】が最低値(1)",   check: c => c.yaruki <= 1 },

  // ── 超ニッチ実績（特定状況の達成） ──
  { id: "gyakkyo",   type: "session", name: "逆境の覇者",   desc: "【変調】を3つ以上抱えた状態で決戦に勝利する",    check: c => c.badStatus >= 3 && c.won },
  { id: "shunsatsu", type: "session", name: "瞬殺",         desc: "決戦を3ラウンド以内に勝利する",                check: c => c.won && c.decisiveRounds > 0 && c.decisiveRounds <= 3 },
  { id: "fushicho",  type: "session", name: "不死鳥の証明", desc: "1決戦で『不死身』を3回以上使って勝利する",      check: c => c.immortalUses >= 3 && c.won },
  { id: "kyokai",    type: "session", name: "境界跳躍",     desc: "八雲紫が通常移動を一度も行わず、全エリアを踏破する", check: c => c.isMurasaki && c.normalMoves === 0 && c.allAreas },
  { id: "fukochu",   type: "session", name: "不幸中の幸い", desc: "紫苑の不運が効いている間にスペシャルを2回以上出し、その間ファンブルしない", check: c => c.unluckySpecials >= 2 && !c.unluckyFumbled },
  { id: "hanrei",    type: "session", name: "半霊の見切り", desc: "妖夢が喰らいボム宣言後の回避成功から六根清浄斬を発動して勝利する", check: c => c.isYoumu && c.kuraibomuSuccess && c.usedRokkon && c.won },
  { id: "nezumi",    type: "session", name: "鼠算式探索",   desc: "全クエストを、ナズーリンの探し物で置いた手がかりのみで解決する", check: c => c.isNazrin && c.allQuests && c.cluesSearchOnly },
  { id: "amanojaku", type: "session", bad: true, name: "天邪鬼の悪運", desc: "逆転スキルが有効な状態で全ダイス6の逆転ファンブルを引く", check: c => c.flipFumble },

  // ── 通算実績（ポジティブ） ──
  { id: "senkyaku",  type: "lifetime", name: "千客万来",   desc: "通算で15人以上の異なるキャラと絆を結ぶ",        check: c => c.L_bondTargets >= 15 },
  { id: "rekisen",   type: "lifetime", name: "歴戦の証",   desc: "通算で5回セッションを完走する",                check: c => c.L_sessions >= 5 },
  { id: "hyakka",    type: "lifetime", name: "百花繚乱",   desc: "通算で15人以上の異なるキャラをPCとして遊ぶ",    check: c => c.L_chars >= 15 },
  { id: "nushi",     type: "lifetime", name: "幻想郷の主", desc: "通算で全60キャラをPCとして遊ぶ",               check: c => c.L_chars >= 60 },
  { id: "joshou",    type: "lifetime", name: "常勝将軍",   desc: "通算で決戦に10回勝利する",                     check: c => c.L_wins >= 10 },
  { id: "grazek",    type: "lifetime", name: "グレイズ狂", desc: "通算で【グレイズ】を累計300点獲得する",        check: c => c.L_graze >= 300 },
  { id: "kyoun",     type: "lifetime", name: "強運の星",   desc: "通算でスペシャルを50回出す",                   check: c => c.L_specials >= 50 },
  { id: "hakase",    type: "lifetime", name: "弾幕博士",   desc: "通算で全13種の弾幕スキルを使用する",            check: c => c.L_ds >= DS_TOTAL },
  { id: "tanken",    type: "lifetime", name: "探検家",     desc: "通算で全27スポットを訪れる",                   check: c => c.L_spots >= SPOT_TOTAL },
  { id: "seicho",    type: "lifetime", name: "成長の鬼",   desc: "1人のキャラで強化3種（追加スペカ・能力＋・特別な絆）を全達成", check: c => c.L_maxEnh >= 3 },
  { id: "bakugyaku", type: "lifetime", name: "莫逆の友",   desc: "特別な絆の親密度を10（最大）まで高める",        check: c => c.L_intimacy10 },
  // ── 通算実績（不名誉枠） ──
  { id: "yakudoshi", type: "lifetime", bad: true, name: "厄年", desc: "通算でファンブルを30回出す",                check: c => c.L_fumbles >= 30 },
];

export const getAchievement = (id) => ACHIEVEMENTS.find(a => a.id === id);

// pc.ach への記録ヘルパー。pcs 配列の uid のPCの ach を fn で更新した新配列を返す（不変）。
// fn は現在の ach（コピー）を受け取り、更新後の ach を返す。
export function bumpAch(pcs, uid, fn) {
  if (!uid) return pcs;
  return (pcs || []).map(p => p.uid === uid ? { ...p, ach: fn({ ...(p.ach || {}) }) } : p);
}
// 配列フィールドに distinct 追加
export const achAddTo = (ach, key, val) => { const arr = ach[key] || []; return arr.includes(val) ? arr : [...arr, val]; };

// 当該PCのセッション統計（pc.ach）＋最終gs から、判定用の平坦コンテキストを作る。
// life は集計後（このセッション分を含む）の通算統計。
export function buildAchContext(pc, gs, life) {
  const ach = pc.ach || {};
  const isDecisiveWin = gs.battle?.result === "pc_win";
  const isDecisiveLoss = gs.battle?.result === "npc_win" || gs.battle?.result === "defeat";
  // 他PC全員への絆
  const others = (gs.pcs || []).filter(p => p.uid !== pc.uid);
  const bonds = pc.bonds || [];
  const bondsAll = others.length > 0 && others.every(o => bonds.includes(`${o.charName}への絆`));
  // 全クエスト解決
  const scenarioQuests = gs.scenarioData?.quests || [];
  const solved = (gs.quests || []).filter(q => q.solved).length;
  const allQuests = scenarioQuests.length > 0 && solved >= scenarioQuests.length;
  // 全エリア踏破（境界跳躍用）: 訪れたスポットの area が全エリアを網羅するか
  const visitedAreas = new Set((ach.spots || []).map(sid => SPOTS.find(s => s.id === sid)?.area).filter(Boolean));
  const totalAreas = new Set(SPOTS.map(s => s.area)).size;
  const allAreas = visitedAreas.size >= totalAreas;
  return {
    spots: (ach.spots || []).length,
    graze: ach.graze || 0,
    specials: ach.specials || 0,
    fumbles: ach.fumbles || 0,
    intervene: ach.intervene || 0,
    interveneDecisive: ach.interveneDecisive || 0,
    spells: ach.spells || 0,
    clues: ach.clues || 0,
    items: ach.items || 0,
    // 激戦を制す: 決戦（最終battle）の継続ラウンド数
    decisiveRounds: gs.battle?.round || 0,
    // 電光石火: 決戦移行時にリミットまで残っていたサイクル数（doTransitionToBattle で記録）
    slack: gs.battleSlack || 0,
    livesDropped: !!ach.livesDropped,
    livesOne: !!ach.livesOne,
    livesZero: !!ach.livesZero,
    flipFumble: !!ach.flipFumble,
    immortalUses: ach.immortalUses || 0,
    moved: !!ach.moved,
    normalMoves: ach.normalMoves || 0,
    allAreas,
    isMurasaki: pc.charId === "八雲紫",
    unluckySpecials: ach.unluckySpecials || 0,
    unluckyFumbled: !!ach.unluckyFumbled,
    isYoumu: pc.charId === "魂魄妖夢",
    kuraibomuSuccess: !!ach.kuraibomuSuccess,
    usedRokkon: !!ach.usedRokkon,
    isNazrin: pc.charId === "ナズーリン",
    cluesSearchOnly: !!gs.searchCluePlaced && !gs.nonSearchCluePlaced,
    yaruki: pc.resources?.やる気?.cur ?? 0,
    won: isDecisiveWin,
    lost: isDecisiveLoss,
    allQuests,
    bondsAll,
    badStatus: (pc.badStatus || []).length,
    specialBondGained: !!ach.specialBondGained,
    growthBoth: !!ach.growthBoth,
    // 通算
    L_sessions: life.sessions || 0,
    L_chars: (life.chars || []).length,
    L_bondTargets: (life.bondTargets || []).length,
    L_wins: life.wins || 0,
    L_graze: life.graze || 0,
    L_specials: life.specials || 0,
    L_ds: (life.ds || []).length,
    L_spots: (life.spots || []).length,
    L_maxEnh: life.maxEnh || 0,
    L_intimacy10: !!life.intimacy10,
    L_intervene: life.intervene || 0,
    L_fumbles: life.fumbles || 0,
    L_losses: life.losses || 0,
  };
}

const uniq = (arr) => Array.from(new Set(arr));

// このセッション分を通算統計 life に集計する（破壊せず新オブジェクトを返す）。
export function aggregateLifetime(prevLife, pc, gs) {
  const ach = pc.ach || {};
  const life = { ...(prevLife || {}) };
  life.sessions = (life.sessions || 0) + 1;
  life.chars = uniq([...(life.chars || []), pc.charId].filter(Boolean));
  const bondTargets = (pc.bonds || []).map(b => { const m = b.match(/^(.+)への絆$/); return m ? m[1] : null; }).filter(Boolean);
  life.bondTargets = uniq([...(life.bondTargets || []), ...bondTargets]);
  if (gs.battle?.result === "pc_win") life.wins = (life.wins || 0) + 1;
  if (gs.battle?.result === "npc_win" || gs.battle?.result === "defeat") life.losses = (life.losses || 0) + 1;
  life.graze = (life.graze || 0) + (ach.grazeTotal || 0);
  life.specials = (life.specials || 0) + (ach.specials || 0);
  life.fumbles = (life.fumbles || 0) + (ach.fumbles || 0);
  life.intervene = (life.intervene || 0) + (ach.intervene || 0);
  // 弾幕博士: 最終決戦で使った弾幕を通算に追加（簡易・最終battleのみ）
  life.ds = uniq([...(life.ds || []), ...(gs.battle?.usedds?.[pc.uid] || [])]);
  life.spots = uniq([...(life.spots || []), ...(ach.spots || [])]);
  // 強化達成数（成長キャラのインスタンスから最大値）と親密度10は session 側で記録した値を反映
  if ((ach.enhCount || 0) > (life.maxEnh || 0)) life.maxEnh = ach.enhCount;
  if (ach.intimacy10) life.intimacy10 = true;
  return life;
}
