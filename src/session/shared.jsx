// SessionView から分割: 複数の画面で共有する定数・ヘルパー・小さな共通コンポーネント
import { C } from "../styles/colors";
import { getSpellCardEffect } from "../data/spellCardEffects";

// ─── SpellCard フレームコンポーネント ────────────────────────────────
// 東方のスペルカード風の二重枠＋四隅ダイヤ装飾フレーム
export function SpellCard({ color = C.gold, title, headerRight, children, style = {}, contentStyle = {}, onClick }) {
  const dim = color + "44";
  const glow = color + "1a";
  return (
    <div onClick={onClick} style={{
      position: "relative",
      border: `1px solid ${color}`,
      borderRadius: 2,
      background: "rgba(4,4,12,0.93)",
      boxShadow: `0 0 20px ${glow}, inset 0 0 24px rgba(0,0,0,0.55)`,
      ...style,
    }}>
      {/* 内側の細枠 */}
      <div style={{
        position: "absolute", inset: 5,
        border: `1px solid ${dim}`,
        borderRadius: 1,
        pointerEvents: "none",
      }} />
      {/* 四隅のダイヤ装飾 */}
      {[{ top: -5, left: 12 }, { top: -5, right: 12 }, { bottom: -5, left: 12 }, { bottom: -5, right: 12 }].map((pos, i) => (
        <div key={i} style={{ position: "absolute", width: 10, height: 10, background: color, transform: "rotate(45deg)", ...pos }} />
      ))}
      {/* コンテンツ（内側枠より手前） */}
      <div style={{ position: "relative", zIndex: 1 }}>
        {title && (
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "8px 16px 7px",
            borderBottom: `1px solid ${dim}`,
            background: `linear-gradient(90deg, ${color}18 0%, transparent 70%)`,
          }}>
            <span style={{ fontSize: 11, color, letterSpacing: 3, fontFamily: "'Noto Serif JP', serif" }}>{title}</span>
            {headerRight}
          </div>
        )}
        <div style={{ padding: "10px 12px", ...contentStyle }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── ユーティリティ ───────────────────────────────────────────────
export function getSpotByD66(d1, d2, SPOTS) {
  const val = Math.min(d1, d2) * 10 + Math.max(d1, d2);
  const candidates = SPOTS.filter(s => s.roll === val);
  if (candidates.length === 2) {
    return (d1 < d2 ? candidates.find(s => s.id.endsWith("A")) : candidates.find(s => s.id.endsWith("B")))?.id;
  } else if (candidates.length === 1) {
    return candidates[0].id;
  }
  return null;
}

// ─── アイテムデータ ───────────────────────────────────────────────

export const ITEM_DATA = {
  "お酒": {
    timing: "いつでも",
    desc:    "自身の【やる気】が「1点」回復します。",
    canUse:  pc => (pc.items?.["お酒"] || 0) > 0 && !(pc.badStatus || []).includes("二日酔い"),
    use: (pc, gs) => {
      const resources = { ...pc.resources };
      if (!(pc.badStatus || []).includes("だるい")) {
        const r = resources.やる気 || { cur: 0, max: 3 };
        const isPremiumFriday = gs?.newspaper?.roll === 12 && pc.currentSpot === "11";
        const healAmount = isPremiumFriday ? 2 : 1;

        resources.やる気 = { cur: Math.min(r.cur + healAmount, r.max), max: r.max };
      }
      return { ...pc, items: { ...pc.items, "お酒": Math.max(0, (pc.items["お酒"] || 0) - 1) }, resources };
    },
  },
  "小銭": {
    timing: "行為判定直前",
    desc:    "次の行為判定の判定ダイス数が「1」増加します。",
    canUse:  () => false,
    use: (pc, _gs) => ({ ...pc, items: { ...pc.items, "小銭": Math.max(0, (pc.items["小銭"] || 0) - 1) }, flags: { ...pc.flags, money: true } }),
  },
  "お守り": {
    timing: "移動処理中",
    desc:    "移動で「6」が出たとき、ハプニングが発生せず6マス先まで移動できます。",
    canUse:  () => false,
    use: (pc, _gs) => ({ ...pc, items: { ...pc.items, "お守り": Math.max(0, (pc.items["お守り"] || 0) - 1) }, flags: { ...pc.flags, amulet: true } }),
  },
  "Pアイテム": {
    timing: "いつでも",
    desc:    "【霊力】を「3点」獲得します。",
    canUse:  pc => (pc.items?.["Pアイテム"] || 0) > 0 && !(pc.badStatus || []).includes("二日酔い"),
    use: (pc, _gs) => {
      const resources = { ...pc.resources };
      if (!(pc.badStatus || []).includes("スランプ")) {
        const r = resources.霊力 || { cur: 0, max: 30 };
        resources.霊力 = { cur: Math.min(r.cur + 3, r.max), max: r.max };
        // 攻撃力は霊力から決まる（他の霊力変化と同じく 1 + 霊力/5）
        resources.攻撃力 = { ...(resources.攻撃力 || { max: 99 }), cur: 1 + Math.floor(resources.霊力.cur / 5) };
      }
      return { ...pc, items: { ...pc.items, "Pアイテム": Math.max(0, (pc.items["Pアイテム"] || 0) - 1) }, resources };
    },
  },
  "残機のかけら": {
    timing: "いつでも",
    desc:    "3つ消費して【残り人数】を「1点」獲得します。（3つ以上保持時のみ）",
    canUse:  pc => (pc.items?.["残機のかけら"] || 0) >= 3 && !(pc.badStatus || []).includes("二日酔い"),
    use: (pc, _gs) => {
      const resources = { ...pc.resources };
      const r = resources.残り人数 || { cur: 0, max: 5 };
      resources.残り人数 = { cur: Math.min(r.cur + 1, r.max), max: r.max };
      return { ...pc, items: { ...pc.items, "残機のかけら": Math.max(0, (pc.items["残機のかけら"] || 0) - 3) }, resources };
    },
  },
  "スペカのかけら": {
    timing: "いつでも",
    desc:    "2つ消費して【スペルカード】を「1点」獲得します。（2つ以上保持時のみ）",
    canUse:  pc => (pc.items?.["スペカのかけら"] || 0) >= 2 && !(pc.badStatus || []).includes("二日酔い"),
    use: (pc, _gs) => {
      const resources = { ...pc.resources };
      const r = resources.スペルカード || { cur: 0, max: 5 };
      resources.スペルカード = { cur: Math.min(r.cur + 1, r.max), max: r.max };
      return { ...pc, items: { ...pc.items, "スペカのかけら": Math.max(0, (pc.items["スペカのかけら"] || 0) - 2) }, resources };
    },
  },
  "妖器": {
    timing: "弾幕ごっこ前",
    desc:    "1ラウンドの間【攻撃力】が1点増加します。（輝針城の限定アイテム）",
    canUse:  pc => (pc.items?.["妖器"] || 0) > 0 && !(pc.badStatus || []).includes("二日酔い"),
    use: (pc, _gs) => {
      return { ...pc, items: { ...pc.items, "妖器": Math.max(0, (pc.items["妖器"] || 0) - 1) }, flags: { ...pc.flags, youki: true } };
    },
  },
};

export const ITEM_NAMES = ["お酒", "小銭", "お守り", "Pアイテム", "残機のかけら", "スペカのかけら"];

export const INIT_ITEMS = () => ({
  お酒: 0, 小銭: 0, お守り: 0, Pアイテム: 0, 残機のかけら: 0, スペカのかけら: 0, 妖器: 0,
});

export const BAD_STATUS_TABLE = {
  1: { name: "だるい",   desc: "あなたの【やる気】は「1点」となり、いかなる処理によっても回復しません。" },
  2: { name: "スランプ", desc: "いかなる処理によってもあなたの【霊力】は増加しなくなります。" },
  3: { name: "二日酔い", desc: "あなたはアイテムを使用することができません。" },
  4: { name: "怪我",     desc: "行為判定の際にダイスを2つまでしか振ることができなくなります。" },
  5: { name: "不機嫌",   desc: "あなたは絆を獲得できなくなり、他のキャラクターもあなたへの絆を獲得できません。" },
  6: { name: "疲れた",   desc: "「移動」の処理で移動できる距離が1スポット分少なくなります。" },
};

export const SKILL_TYPE_COLOR = { "オート": "#81c784", "アクション": "#64b5f6", "サポート": "#ffb74d" };
// 人を狂わす程度の能力の「絆なし応援」を表す擬似絆ラベル（bondUsed ではなく kuruwasuUsed[対象] を消費）
export const KURUWASU_BOND = "（絆なし応援）";
// 特別な絆の応援を表す擬似絆ラベル（成長で獲得した specialBond を使う応援）
export const SPECIAL_BOND_CHEER = "（特別な絆応援）";

// 特別な絆の親密度: targetUid を対象に持つ特別な絆の保持者全員の親密度を amount 増やす（初期1・最大10）。
// 増加（対象のスペシャル/交流）のたびに応援欄(used)をリフレッシュする。
// 戻り値 { pcs, logs }（変化があった保持者のログ）。
export function gainIntimacy(pcs, targetUid, amount, reason) {
  if (!targetUid || amount <= 0) return { pcs, logs: [] };
  const logs = [];
  const next = (pcs || []).map(pc => {
    if (pc.specialBond && pc.specialBond.targetUid === targetUid && pc.uid !== targetUid) {
      const cur = pc.specialBond.intimacy ?? 1;
      const ni = Math.min(10, cur + amount);
      if (ni !== cur || pc.specialBond.used) {
        logs.push(`💞 ${pc.charName} の《${pc.specialBond.target}への${pc.specialBond.word || "敬意"}》親密度 ${cur}→${ni}${reason ? `（${reason}）` : ""}`);
      }
      return { ...pc, specialBond: { ...pc.specialBond, intimacy: ni, used: false } };
    }
    return pc;
  });
  return { pcs: next, logs };
}

// 変調免疫チェック（馬鹿スキル用）
export function isBadStatusImmune(pc, bsName) {
  return pc?.ps?.name === "馬鹿" && pc.badStatusImmune === bsName;
}

// 個性スキルの一回限り使用済みフラグキー
export const PS_ONCE_FLAG = "psUsedThisSession";

// ─── 描写エフェクト（背景パーティクル・色調） ──────────────────────────────
export const FX_PARTICLES = {
  sakura: { char: "❀", color: "#f7b8d0", size: [10, 22], dur: [6, 12], count: 26, line: false, label: "桜" },
  snow:   { char: "•", color: "#eaf4ff", size: [5, 12], dur: [7, 15], count: 38, line: false, label: "雪" },
  petal:  { char: "✦", color: "#fff3c0", size: [8, 16], dur: [8, 16], count: 22, line: false, label: "光粒" },
  rain:   { char: "",  color: "rgba(170,200,255,0.5)", size: [10, 22], dur: [0.5, 1.1], count: 64, line: true, label: "雨" },
};
export const FX_TONE = {
  sunset: { bg: "rgba(255,120,45,0.26)", label: "夕焼け" },
  night:  { bg: "rgba(26,40,86,0.46)",   label: "夜" },
  sepia:  { bg: "rgba(120,92,52,0.40)",  label: "セピア" },
  dark:   { bg: "rgba(0,0,0,0.6)",       label: "暗転" },
  warm:   { bg: "rgba(255,180,90,0.16)", label: "暖色" },
};

// 描写画像を Firebase Storage 経由で保存するか。Spark プランは Storage が Blaze 必須で使えないため
// false（data URL で RTDB に直接保存）。Blaze にアップグレードしバケット＋CORS を設定したら true に。
export const SCENE_IMG_USE_STORAGE = false;

// 弾幕ごっこのフェーズ表示用ラベル
export const PHASE_LABELS = {
  setup:             "対戦準備",
  round_start:       "対戦者選出",
  pc_shot_intro:     "PCショット宣言",
  pc_shot_roll:      "PCショット",
  pc_shot_after:     "PCショット後",
  npc_shot_intro:    "NPCショット宣言",
  npc_shot_roll:     "NPCショット",
  npc_shot_after:    "NPCショット後",
  pc_evade_intro:    "PC回避判定",
  pc_evade_result:   "PC回避結果",
  pc_evade_move:     "PC回避移動",
  npc_evade_intro:   "NPC回避判定",
  npc_evade_move:    "NPC回避移動",
  pc_hit_check:      "PC当たり判定",
  npc_hit_check:     "NPC当たり判定",
  pc_hit_recovery:   "PC復帰",
  npc_hit_recovery:  "NPC復帰",
  pc_dropout:        "PC脱落",
  npc_dropout:       "NPC脱落",
  round_end_check:   "ラウンド終了確認",
  cleanup:           "ラウンド終了処理",
  result:            "結果",
};

export const TIMING_RULES = [
  { key: "round_start", re: /ラウンドの?開始時/       },
  { key: "evade",       re: /回避ステップ/            },
  { key: "hit",         re: /被弾|【残り人数】を減少/ },
];

export const EFFECT_PATTERNS = [
  { type: "SELF",     re: /【自機マス×(\d+)】/g                },
  { type: "ENEMY",    re: /【敵機マス×(\d+)】/g               },
  { type: "ADJACENT", re: /【隣接マス×(\d+)】/g               },
  { type: "CHOOSE",   re: /【指定マス×(\d+)】/g               },
  { type: "RANDOM",   re: /【ランダム×(\d+|X)】/g             },
  { type: "FIXED",    re: /【(\d+)番マス×(\d+)】/g           },
];

// スペカ条件文を抽出する
// 条件文は通常「このスペルカード」で始まり、キーワード(できない等)を含む。
// 名前や効果記号【...×N】と同じ文（句点なし）に連結されているケースに対応するため、
// まず「このスペルカード」位置で前段を切り捨ててから、「。」で文区切りして該当文を返す。
export const CONDITION_KEYWORD_RE = /(?:できない|限り使用できない|場合にしか使用できない)/;
export function extractCondition(text) {
  if (!text) return null;
  const startIdx = text.indexOf("このスペルカード");
  const searchText = startIdx >= 0 ? text.slice(startIdx) : text;
  const sentences = searchText.split("。").map(s => s.trim()).filter(Boolean);
  const condSentence = sentences.find(s => CONDITION_KEYWORD_RE.test(s));
  return condSentence ? condSentence + "。" : null;
}

// 弾幕スキル使用済み判定（純粋関数版・BattleView 内クロージャと同仕様）
// usedds の形式: { [attackerId]: string[] }
export function isSkillUsed(usedds, attackerId, skillName) {
  return !!(usedds && usedds[attackerId] && usedds[attackerId].includes(skillName));
}

// 弾幕スキルを使用済みに追加（純粋関数版・元のオブジェクトは変更しない）
export function markSkillUsed(usedds, attackerId, skillName) {
  if (!attackerId) return usedds || {};
  const base = usedds || {};
  return {
    ...base,
    [attackerId]: [...(base[attackerId] || []), skillName],
  };
}

// ─── 戦闘NPC生成 / 勝敗判定（純粋関数・クエスト戦/決戦で共用） ─────────
// シナリオの enemy データ（クエスト enemy / extraEnemies / finalBattleEnemies 等）を
// 戦闘中の NPC オブジェクトに変換する。回避力・グレイズも含め全戦闘で統一する。
// opts.primary または enemy.primary が真なら primary フラグを付与（決戦の主敵）。
export function buildBattleNpc(enemy, id, opts = {}) {
  if (!enemy) return null;
  const npc = {
    id,
    name: enemy.name || "敵",
    resources: {
      残り人数: { cur: enemy.life, max: 5 },
      スペルカード: { cur: enemy.spellcard, max: 5 },
      攻撃力: { cur: enemy.attack, max: 99 },
      // 0 はそのまま 0（回避ダイスなし）。未設定・空欄・数値でない値だけ既定の 3
      回避力: { cur: (enemy.evade === "" || enemy.evade == null || !Number.isFinite(Number(enemy.evade))) ? 3 : Number(enemy.evade), max: 3 },
      グレイズ: { cur: 0, max: 5 },
    },
    ds: enemy.ds ?? { name: enemy.dsName || enemy.dsCustomName || "", desc: enemy.dsDesc || "" },
    spellCards: [
      { name: enemy.sc1name, desc: enemy.sc1effect, ...(enemy.sc1ref ? { ref: enemy.sc1ref } : {}) },
      { name: enemy.sc2name, desc: enemy.sc2effect, ...(enemy.sc2ref ? { ref: enemy.sc2ref } : {}) },
    ].filter(s => s.name),
  };
  if (opts.primary || enemy.primary) npc.primary = true;
  if (enemy.customPortrait) npc.customPortrait = enemy.customPortrait;
  return npc;
}

export function parseSpell(text) {
  // タイミング
  let timing = "standard";
  for (const { key, re } of TIMING_RULES) {
    if (re.test(text)) { timing = key; break; }
  }

  // 効果タイミング（宣言はstandard・効果発揮がラウンド終了時）
  const effectTiming = /ラウンドの?終了時/.test(text) ? "round_end" : "immediate";

  // 効果リスト
  const effects = [];
  for (const { type, re } of EFFECT_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (type === "FIXED") {
        effects.push({ type, cell: parseInt(m[1]), count: parseInt(m[2]) });
      } else {
        effects.push({ type, count: m[1] === "X" ? -1 : parseInt(m[1]) });
      }
    }
  }

  // 宣言条件（テキスト抽出のみ、自動チェックはしない）
  const condition = extractCondition(text);

  // 本文から条件文を取り除いたもの（重複表示の防止に使う）
  // 原文の末尾に「。」が無い条件文にも対応する（表示用の condition には「。」を補っている）
  const textBody = condition
    ? (text.includes(condition) ? text.replace(condition, "") : text.replace(condition.replace(/。$/, ""), "")).trim()
    : text;

  return {
    timing,
    effectTiming,
    effects,
    manual: effects.length === 0,  // キーワードなし → 手動
    condition,
    textBody,
  };
}

// declareSpell（および周辺）が宣言時に自動処理する structured.effects の type 一覧。
// ここに無い effect type は「GM が手動で処理する」案内を宣言UIに出す（黙殺防止）。
// 効果を自動化したら、ここへ type を追加すると案内が自動的に消える。
export const AUTO_HANDLED_EFFECTS = new Set([
  "extra_support_cover",
  "extra_support_cover_with_die_choice",
  "double_support_cover",                 // 上海人形: 援護/かばう2回
  "extra_familiar_per_round_this_phase",  // ホークビーコン: フェイズ中・毎ラウンド1回
  "enemy_forced_to_attacker_number_cell",
  "enemy_move_adjacent_if_same_number",
  "enemy_move_adjacent",
  "self_move_any",
  "self_move_empty",
  "pre_self_move_adjacent",       // 死歌/怒面/貧符: 配置前に自機を隣接マスへ移動
  "shift_non_25_horizontal",
  // ─ 回避ステップのフラグ系 ─
  "enemy_may_stay_on_dodge",     // 正直者の死/吉弔大結界: 回避側がその場にとどまれる
  "next_dodge_no_evasion_loss",  // オプティカルカモフラージュ: 次の回避で回避力を消費しない
  // ─ 任意実行 ─
  "optional_redo_random",        // ブラックペガサス流星弾: 任意で再配置
  "optional_clear_then_random",  // ドリームキャッチャー: 任意数除去→ランダム
  // ─ ラウンド終了時の自己ペナルティ ─
  "self_hp_loss_if_no_damage",   // 太陽を盗んだ鴉: 被弾なしならラウンド終了時に残り人数-1
  // ─ 回避中のグレイズ同調 ─
  "mirror_graze_gain",           // ミシガンロール: 相手のグレイズ獲得時に同量獲得
  // ─ 被弾時の追加ダメージ ─
  "extra_hp_loss_if_same_cell_fail",  // 余命幾許: 同番号マスで回避失敗→追加で残り人数-1
  // ─ 回避成功直後の追加配置 ─
  "place_at_enemy_after_first_dodge", // 全霊鬼渡り: 回避側の移動先マスに配置
  "random_3d_after_first_dodge",      // マッスル/狐符: 回避成功直後に3D振り追加配置
  // ─ 配置直後の grid 操作（declareSpell のランダム配置後に自動処理） ─
  "remove_from_enemy_cell",
  "remove_if_hit_enemy_cell",
  // ─ 回避力変動（resources.回避力.cur を一時変更、ラウンド終了で復元） ─
  "reduce_enemy_evasion",
  "increase_enemy_evasion",
  "reduce_own_evasion",
  "costs_own_evasion",
  // ─ 宣言時の即時リソース操作 ─
  "reset_graze",   // バレットドミニオン/マーケット: グレイズを0に
  "costs_rei",     // 五穀豊穣ライスシャワー: 霊力消費
  "no_sc_cost",    // 幻想春花: SC消費なし
]);

// スペカテキスト/スペルオブジェクトからフルオブジェクトを組み立てる
export function buildSpellCard(card) {
  if (!card) return null;

  const text = typeof card === "string"
    ? card
    : card.text ?? card.desc ?? "";

  const nameMatch = text.match(/^(.+?[」])/);
  const name = typeof card === "string"
    ? (nameMatch ? nameMatch[1] : text.slice(0, 20))
    : card.name ?? (nameMatch ? nameMatch[1] : text.slice(0, 20));

  const parsed = parseSpell(text);
  const structured = getSpellCardEffect((typeof card === "object" ? card.ref : null) || name) || null;

  // 構造化データの timing が round_end なら effectTiming に反映
  if (structured?.timing === "round_end") parsed.effectTiming = "round_end";
  // 構造化データの timing は宣言タイミング判定の正本（テキスト解析より優先）
  if (structured?.timing) parsed.timing = structured.timing;
  // 構造化データが full/partial なら手動フラグを解除
  if (structured && structured.auto !== "manual") parsed.manual = false;

  const displayText = text || (structured
    ? (structured.note || `【${name}】の効果は自動処理されます（${structured.auto === "full" ? "完全自動" : structured.auto === "partial" ? "一部自動" : "GM手動"}）`)
    : "");

  // 自動処理できない structured.effects（要GM手動）を抽出。宣言UIで警告表示に使う。
  const manualEffects = (structured?.effects || [])
    .filter(e => !AUTO_HANDLED_EFFECTS.has(e.type))
    .map(e => e.type);

  return {
    ...card,
    name,
    text: displayText,
    ...parsed,
    structured,
    manualEffects,
    structuredNote: structured?.note || null,
  };
}

// ─── 成長セレモニー（PCの成長／強化） ──────────────────────────────
// ルール: セッション終了時、各PCは「成長」(弾幕スキル再修得＋タグ獲得・両方可)と
// 「強化」(追加スペカ／能力スキル＋／特別な絆・いずれか1つ、各強化は生涯1回)を受けられる。
// 永続化は Firebase grownChars/{uid}/{instanceId}（成長キャラはインスタンス単位で分離）。親密度のライブ機構は別途。
export const ENHANCE_LABELS = { spell: "追加スペルカードの取得", ability: "能力スキルの強化（＋）", bond: "特別な絆の獲得" };

// ─── ConfirmModal ─────────────────────────────────────────────────
export function ConfirmModal({ title, body, onOk, onCancel, okLabel = "実行する", okColor = C.red }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={onCancel}>
      <SpellCard color={okColor} title={`◆ ${title}`} style={{ maxWidth: 360, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
        {body && <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.8, marginBottom: 16, whiteSpace: "pre-wrap" }}>{body}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onOk}     style={{ flex: 1, padding: "8px", cursor: "pointer", borderRadius: 2, background: `${okColor}20`, border: `1px solid ${okColor}80`, color: okColor, fontSize: 12 }}>{okLabel}</button>
          <button onClick={onCancel} style={{ flex: 1, padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
        </div>
      </SpellCard>
    </div>
  );
}

export const INIT_RESOURCES = () => ({
  やる気:     { cur: 1, max: 3  },
  残り人数:   { cur: 2, max: 5  },
  スペルカード:     { cur: 1, max: 5  },
  グレイズ:   { cur: 0, max: 999 },
  霊力:       { cur: 0, max: 20 },
  攻撃力:     { cur: 1, max: 5  },
});
