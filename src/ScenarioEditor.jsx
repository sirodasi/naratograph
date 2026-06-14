import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { db, auth } from "./firebase";
import { ref, onValue, set, push, remove, get } from "firebase/database";
import { updateProfile } from "firebase/auth";
import { btn } from "./styles/colors";
import { OFFICIAL_DANMAKU_SKILLS, SPOTS } from "./data/gameData";
import { SPELL_CARD_EFFECTS } from "./data/spellCardEffects";
import { ACHIEVEMENTS } from "./data/achievements";
import { getBuiltinScenarios } from "./scenarios";

// コード同梱のビルトインシナリオ（静的。glob 集約済み）
const BUILTIN_SCENARIOS = getBuiltinScenarios();

// キャラクター名一覧（選択不可設定用・循環import回避のため独立定義）
const CHAR_NAMES = ["博麗霊夢", "霧雨魔理沙", "チルノ", "紅美鈴", "パチュリー・ノーレッジ", "十六夜咲夜", "レミリア・スカーレット", "フランドール・スカーレット", "アリス・マーガトロイド", "魂魄妖夢", "西行寺幽々子", "八雲藍", "八雲紫", "伊吹萃香", "鈴仙・優曇華院・イナバ", "八意永琳", "蓬莱山輝夜", "藤原妹紅", "射命丸文", "風見幽香", "小野塚小町", "河城にとり", "東風谷早苗", "八坂神奈子", "洩矢諏訪子", "比那名居天子", "星熊勇儀", "古明地さとり", "火焔猫燐", "霊烏路空", "古明地こいし", "ナズーリン", "多々良小傘", "村紗水蜜", "聖白蓮", "封獣ぬえ", "姫海棠はたて", "霍青娥", "物部布都", "豊聡耳神子", "二ツ岩マミゾウ", "秦こころ", "鬼人正邪", "少名針妙丸", "宇佐見菫子", "茨木華扇", "ドレミー・スイート", "クラウンピース", "高麗野あうん", "摩多羅隠岐奈", "依神女苑", "依神紫苑", "庭渡久侘歌", "吉弔八千慧", "埴安神袿姫", "驪駒早鬼", "管牧典", "天弓千亦", "饕餮尤魔", "日白残無"];

// ── 共通スタイル ──────────────────────────────────────
const BG = "#06080f";
const C = {
  gold:"#c8a040", goldDim:"#8b6914", goldBg:"rgba(200,160,64,0.12)",
  red:"#e07060", redBg:"rgba(192,57,43,0.18)", redBorder:"#8b1a1a",
  blue:"#64b5f6", blueBg:"rgba(25,118,210,0.15)", blueBorder:"#0d47a1",
  green:"#4caf50", greenBg:"rgba(27,94,32,0.18)", greenBorder:"#1b5e20",
  purple:"#ce93d8", purpleBg:"rgba(156,39,176,0.15)", purpleBorder:"#6a1b9a",
  text:"#c8b89a", textDim:"#8a9aaa", textFaint:"#5a6575",
  border:"#1a2535", card:"rgba(255,255,255,0.025)",
};
const iBase = { padding:"5px 8px", fontSize:11, background:"rgba(255,255,255,0.04)",
  border:`1px solid ${C.border}`, color:C.text, borderRadius:3, boxSizing:"border-box", width:"100%" };
const taBase = { ...iBase, resize:"vertical", fontFamily:"'Noto Serif JP', serif" };
function SecTitle({children}) {
  return <div style={{fontSize:9,color:C.textFaint,letterSpacing:2,borderBottom:`1px solid #111828`,paddingBottom:3,marginBottom:8,marginTop:12}}>{children}</div>;
}

// ── スペルカードエディタ ──────────────────────────────
const AUTO_COLOR  = { full: C.green, partial: "#f9a825", manual: C.red };
const AUTO_LABEL  = { full: "完全自動", partial: "一部自動", manual: "GM手動" };
const AUTO_NOTE   = {
  full:    "✓ 弾幕ごっこ中に自動で処理されます",
  partial: "⚠ プレイヤーの入力が一部必要です",
  manual:  "✕ GMが手動で処理してください",
};

function SpellCardEditor({ label, name, effect, mode = "custom", cardRef = "", onChange, warn = false }) {
  const structured = cardRef ? SPELL_CARD_EFFECTS[cardRef] : null;

  const handleModeChange = (m) => {
    onChange({ name: "", effect: "", mode: m, ref: "" });
  };

  const handleSelectRef = (refKey) => {
    // 効果を選択 → 名前はデフォルトでカード名をセット（あとから自由に変更可）
    onChange({ name: refKey, effect: "", mode: "existing", ref: refKey });
  };

  return (
    <div style={{ padding: 8, background: "rgba(0,0,0,0.2)", borderRadius: 4, border: `1px solid ${warn ? "#f9a825" : C.border}` }}>
      {/* ヘッダー: ラベル + モード切替 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ fontSize: 9, color: warn ? "#f9a825" : C.textFaint }}>
          {label}{warn && " ⚠ 名前または効果が未入力"}
        </div>
        <div style={{ display: "flex", gap: 3 }}>
          {[["existing", "既存から選択"], ["custom", "カスタム"]].map(([m, lbl]) => (
            <button key={m} onClick={() => handleModeChange(m)}
              style={{ ...btn(
                mode === m ? "rgba(200,160,64,0.2)" : "transparent",
                mode === m ? C.goldDim : C.border,
                mode === m ? C.gold : C.textFaint,
                { padding: "2px 8px", fontSize: 9 }
              )}}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {mode === "existing" ? (
        <div>
          {/* 効果選択 */}
          <div style={{ fontSize: 8, color: C.textFaint, marginBottom: 2 }}>効果</div>
          <select style={{ ...iBase, marginBottom: 6 }} value={cardRef || ""} onChange={e => handleSelectRef(e.target.value)}>
            <option value="">効果を選択…</option>
            {["full", "partial", "manual"].map(al => {
              const cards = SPELL_CARD_LIST.filter(c => c.auto === al);
              if (!cards.length) return null;
              return (
                <optgroup key={al} label={`── ${AUTO_LABEL[al]} ──`}>
                  {cards.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </optgroup>
              );
            })}
          </select>
          {/* 名前（自由入力） */}
          <div style={{ fontSize: 8, color: C.textFaint, marginBottom: 2 }}>スペルカード名（自由に変更可）</div>
          <input
            style={{ ...iBase, marginBottom: cardRef ? 4 : 0 }}
            value={name || ""}
            onChange={e => onChange({ name: e.target.value, effect, mode: "existing", ref: cardRef })}
            placeholder="スペルカード名（任意）"
          />
          {/* 効果プレビュー */}
          {cardRef && structured && (
            <div style={{ padding: "5px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 3, fontSize: 9, lineHeight: 1.7 }}>
              <span style={{ color: AUTO_COLOR[structured.auto], fontWeight: "bold" }}>
                ● {AUTO_LABEL[structured.auto]}
              </span>
              {structured.steps?.length > 0 && (
                <div style={{ color: C.textDim, marginTop: 2 }}>
                  弾幕: {structured.steps.map(summarizeStep).join(" / ")}
                </div>
              )}
              {structured.effects?.length > 0 && (
                <div style={{ color: C.textDim, marginTop: 2 }}>
                  効果: {structured.effects.map(summarizeEffect).join(" / ")}
                </div>
              )}
              {structured.note && (
                <div style={{ color: C.textFaint, marginTop: 2 }}>備考: {structured.note}</div>
              )}
              <div style={{ color: AUTO_COLOR[structured.auto], marginTop: 3 }}>
                {AUTO_NOTE[structured.auto]}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div>
          <input
            style={{ ...iBase, marginBottom: 4 }}
            value={name || ""}
            onChange={e => onChange({ name: e.target.value, effect, mode: "custom", ref: "" })}
            placeholder="スペルカード名（任意）"
          />
          <textarea
            style={{ ...iBase, height: 44, resize: "vertical" }}
            value={effect || ""}
            onChange={e => onChange({ name, effect: e.target.value, mode: "custom", ref: "" })}
            placeholder="効果テキスト（任意）"
          />
          {name && (
            <div style={{ fontSize: 9, color: "#f9a825", marginTop: 3 }}>
              ※カスタム効果のためGMが手動で処理してください
            </div>
          )}
        </div>
      )}
    </div>
  );
}
function Label({children}) {
  return <div style={{fontSize:9,color:C.textDim,marginBottom:2,marginTop:6}}>{children}</div>;
}
function Chip({label,color="#c8a040"}) {
  return <span style={{display:"inline-block",padding:"1px 7px",background:`${color}18`,border:`1px solid ${color}50`,borderRadius:10,fontSize:9,color,marginRight:4,marginBottom:2}}>{label}</span>;
}

// ── スペルカード効果リスト（選択UI用・効果重複を除外） ──
const _seenEffects = new Set();
const SPELL_CARD_LIST = Object.entries(SPELL_CARD_EFFECTS)
  .map(([name, data]) => ({
    name, auto: data.auto,
    steps: data.steps || [], effects: data.effects || [],
    note: data.note || "", timing: data.timing || "",
  }))
  .filter(c => {
    const key = JSON.stringify(c.steps) + "|" + c.timing + "|" + JSON.stringify(c.effects);
    if (_seenEffects.has(key)) return false;
    _seenEffects.add(key);
    return true;
  });

function summarizeStep(s) {
  const c = typeof s.count === "object" ? "X" : (s.count ?? 1);
  const after = (s.after || []).map(a => {
    if (a.type === "vertical_of_placed")    return `→上下×${a.count}`;
    if (a.type === "horizontal_of_placed")  return `→左右×${a.count}`;
    if (a.type === "all_neighbors_of_placed") return `→隣接全×${a.count}`;
    if (a.type === "double_each_placed")    return `→配置マス+${a.count}`;
    if (a.type === "add_to_placed")         return `→配置マス+${a.count}`;
    if (a.type === "remove_attacker_mirror") return `→自フィールド同番-${a.count}`;
    return "";
  }).filter(Boolean).join(" ");
  let base;
  switch (s.type) {
    case "self":                       base = `自機×${c}`; break;
    case "enemy":                      base = `敵機×${c}`; break;
    case "random":                     base = `ランダム×${c}`; break;
    case "adjacent_enemy":             base = `隣接マス全て×${c}`; break;
    case "designated":                 base = `指定×${c}`; break;
    case "mirrored_adj_self":          base = `自機同番隣接×${c}`; break;
    case "fixed_cells":                base = `固定マス(${(s.cells||[]).join(",")})×${c}`; break;
    case "fill_empty_cells":           base = `空きマス全て×${c}`; break;
    case "move_all_vertical":          base = "全弾幕→上下移動"; break;
    case "shift_cells_up1":            base = "全弾幕→+1シフト"; break;
    case "mirror_bullet_counts":       base = "弾幕数反転(1↔3)"; break;
    case "double_single_bullets":      base = "1個マス→2個"; break;
    case "clear_all_then_random":      base = `全除去→ランダム×${s.multiplier||1}倍`; break;
    case "clear_enemy_adj_then_random":base = `敵隣除去→ランダム×${s.multiplier||1}倍`; break;
    case "clear_enemy_adj_then_enemy": base = "敵隣除去→敵機に配置"; break;
    case "clear_mirrored_adj_then_random": base = `自機同番隣除去→ランダム×${s.multiplier||1}倍`; break;
    case "enemy_cross_h":              base = `敵横+縦×${c}`; break;
    case "non_adjacent_to_mirrored":   base = `自機同番隣接以外×${c}`; break;
    case "self_if_same_cell":          base = `同マス時のみ自機×${c}`; break;
    case "clear_enemy_cell":           base = "敵機マス全除去"; break;
    case "choice_fixed":               base = `選択列×${c}`; break;
    case "random_2d_exclude_then_fill":base = "2D除外→残マス×1"; break;
    default:                           base = s.type; break;
  }
  return after ? `${base} ${after}` : base;
}

function summarizeEffect(e) {
  switch (e.type) {
    case "reduce_enemy_evasion":              return `回避側回避力-${e.amount}`;
    case "increase_enemy_evasion":            return `回避側回避力+${e.amount}`;
    case "reduce_own_evasion":                return `自分回避力-${e.amount}`;
    case "enemy_move_adjacent":               return "回避側が隣接マスへ移動";
    case "pre_self_move_adjacent":            return "配置前に自機が隣接マスへ移動";
    case "extra_support_cover":               return `援護/かばうを+${e.count}回追加宣言可`;
    case "double_support_cover":              return "援護射撃/かばうを2回行う";
    case "self_move_empty":                   return "自機が空きマスへ移動";
    case "self_move_any":                     return "自機が任意マスへ移動";
    case "no_sc_cost":                        return "SC消費なし";
    case "cancel_hp_reduction":              return "残り人数減少を打ち消す";
    case "attacker_chooses_respawn":         return "再配置マスを攻撃側が決定";
    case "costs_rei":                         return `霊力${e.amount}消費`;
    case "costs_own_evasion":                return `自回避力${e.amount}消費`;
    case "extra_hp_loss_if_same_cell_fail":  return "同マス回避失敗時に追加人数減";
    case "next_dodge_no_evasion_loss":       return "次回避時に回避力消費なし";
    case "enemy_may_stay_on_dodge":          return "回避側が移動しなくてよい";
    case "remove_from_enemy_cell":           return `敵機マスから${e.count}除去`;
    case "reset_graze":                      return "グレイズをリセット";
    case "mirror_graze_gain":               return "グレイズ増加を相手に反映";
    default:                                 return e.type;
  }
}

// ── デフォルト値 ─────────────────────────────────────
const EMPTY_ENEMY = () => ({
  name: "",
  life: 2,        // 残り人数
  spellcard: 1,    // スペルカード
  attack: 5,       // 攻撃力
  evade: 3,        // 回避力
  customPortrait: null,  // 弾幕ごっこ中の立ち絵（未設定時は名前一致スプライト→絵文字）
  ds: { type: "none", name: "", desc: "", customName: "" },
  sc1name: "", sc1effect: "", sc1mode: "custom", sc1ref: "",
  sc2name: "", sc2effect: "", sc2mode: "custom", sc2ref: "",
});

const EMPTY_QUEST = () => ({
  id: Date.now() + Math.random(),
  name: "",
  summary: "",
  level: 1,
  unlockType: "start",      // "start" | "quest" | "custom"
  unlockQuestId: "",        // unlockType==="quest" のとき参照するクエストのid
  unlockCondition: "",      // unlockType==="custom" のときのテキスト
  solutionType: "行為判定",
  specifiedTag: "",
  location: "",
  truth: "",
  enemy: EMPTY_ENEMY(),
  massBattle: false,     // true なら弾幕ごっこを集団戦として処理
  extraEnemies: [],      // 集団戦時の追加敵（enemy に加えて参戦）
});

const EMPTY_SCENARIO = () => ({
  id: "",
  name: "",
  playerCountMin: 2,
  playerCountMax: 4,
  bannedChars: [],
  difficulty: "Normal",
  keywords: [],           // PL・GMに公開するキーワード（タグ）
  backstory: "",
  limit: "3日目の夜",
  quests: [],
  notes: "",
  phaseNotes: {},         // 各フェイズの特殊処理メモ（GM向け）{ intro, explore, battle, epilogue }
  startSpotType: "base",  // "base" (各PCの拠点) | "fixed" (全員同じスポット)
  startSpotId: "",        // startSpotType==="fixed" のときのスポットID
  blockedSpots: [],       // 探索フェイズ中に訪問不可のスポットID（Hard/Lunatic 追加ルール）
  spotRebind: {},         // 拠点リダイレクト { 封鎖スポットID: 代替スポットID }
  finalBattleEnemies: [],
  finalBattleOptionalEnemies: [],  // 決戦でGMが任意投入できる候補エネミー
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

const DIFFICULTIES = ["Easy","Normal","Hard","Lunatic"];
const SOLUTION_TYPES = ["行為判定","弾幕ごっこ","自動解決"];
const SOLUTION_COLORS = { "行為判定":C.blue, "弾幕ごっこ":C.red, "自動解決":C.green };

// ── 立ち絵アップロード（128px 正方形にセンタークロップして dataURL 化） ──────
function PortraitUpload({ value, onChange }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
      <div style={{ width:38, height:38, borderRadius:4, border:`1px solid ${C.border}`, overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(255,255,255,0.03)", flexShrink:0 }}>
        {value ? <img src={value} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : <span style={{ fontSize:16, opacity:0.5 }}>👿</span>}
      </div>
      <label style={{ padding:"4px 10px", border:`1px dashed ${C.border}`, borderRadius:3, cursor:"pointer", fontSize:9, color:C.textFaint }}>
        {value ? "立ち絵を変更" : "立ち絵を設定"}
        <input type="file" accept="image/*" style={{ display:"none" }} onChange={e => {
          const f = e.target.files[0];
          if (!f) return;
          const reader = new FileReader();
          reader.onload = ev => {
            const img = new Image();
            img.onload = () => {
              const size = 128;
              const s = Math.min(img.width, img.height);
              const canvas = document.createElement("canvas");
              canvas.width = size; canvas.height = size;
              canvas.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
              // 透過を保持: webp（小さい）→ 非対応ブラウザはPNGにフォールバック
              let url = canvas.toDataURL("image/webp", 0.85);
              if (!url.startsWith("data:image/webp")) url = canvas.toDataURL("image/png");
              onChange(url);
            };
            img.src = ev.target.result;
          };
          reader.readAsDataURL(f);
        }} />
      </label>
      {value && <button onClick={() => onChange(null)} style={{ background:"none", border:"none", color:C.textFaint, cursor:"pointer", fontSize:9 }}>削除</button>}
    </div>
  );
}

// ── 汎用エネミーエディタ（集団戦の追加敵・決戦の任意候補で共用） ──────────
function EnemyEditor({ enemy, onChange, showPrimary = false }) {
  const en = enemy || EMPTY_ENEMY();
  const upd = patch => onChange({ ...en, ...patch });
  const updDs = patch => onChange({ ...en, ds: { ...(en.ds || {}), ...patch } });
  const sc1mode = en.sc1mode || "custom";
  const sc2mode = en.sc2mode || "custom";
  return (
    <div style={{ padding:10, background:"rgba(255,255,255,0.02)", border:`1px solid ${C.border}`, borderRadius:4 }}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 52px 52px 52px 52px", gap:6, marginBottom:8 }}>
        <div><Label>エネミー名 *</Label><input style={iBase} value={en.name} onChange={e => upd({ name:e.target.value })} placeholder="敵名"/></div>
        <div><Label>残人数</Label><input type="number" min="1" max="99" style={iBase} value={en.life??2} onChange={e => upd({ life:parseInt(e.target.value)||1 })}/></div>
        <div><Label>スペカ</Label><input type="number" min="0" max="9" style={iBase} value={en.spellcard??1} onChange={e => upd({ spellcard:parseInt(e.target.value)||0 })}/></div>
        <div><Label>攻撃</Label><input type="number" min="0" max="99" style={iBase} value={en.attack??5} onChange={e => upd({ attack:parseInt(e.target.value)||0 })}/></div>
        <div><Label>回避</Label><input type="number" min="0" max="3" style={iBase} value={en.evade??3} onChange={e => upd({ evade:parseInt(e.target.value)||0 })}/></div>
      </div>

      <div style={{ marginBottom:8 }}>
        <Label>立ち絵（任意・未設定時は名前一致のキャラ絵）</Label>
        <PortraitUpload value={en.customPortrait || null} onChange={v => upd({ customPortrait: v })}/>
      </div>

      {showPrimary && (
        <button onClick={() => upd({ primary: !en.primary })}
          style={{ ...btn(en.primary?C.redBg:"rgba(255,255,255,0.02)", en.primary?C.redBorder:C.border, en.primary?C.red:C.textFaint, { padding:"3px 10px", fontSize:9, marginBottom:8 }) }}>
          {en.primary ? "☑" : "☐"} 主敵（撃破で決戦終了）
        </button>
      )}

      <Label>弾幕スキル</Label>
      <div style={{ display:"flex", gap:4, marginBottom:6 }}>
        {["none","official","custom"].map(v => (
          <button key={v} onClick={() => updDs({ type:v })}
            style={{ ...btn((en.ds?.type||"none")===v?"rgba(200,160,64,0.2)":"rgba(255,255,255,0.02)", (en.ds?.type||"none")===v?C.goldDim:C.border, (en.ds?.type||"none")===v?C.gold:C.textFaint, { padding:"3px 8px", fontSize:9 }) }}>
            {v==="none"?"なし":v==="official"?"公式":"カスタム"}
          </button>
        ))}
      </div>
      {en.ds?.type === "official" && (
        <select style={{...iBase, marginBottom:6}} value={en.ds?.name || ""} onChange={e => {
          const sk = OFFICIAL_DANMAKU_SKILLS.find(s => s.name === e.target.value);
          updDs({ name:e.target.value, desc:sk?.desc || "" });
        }}>
          <option value="">スキルを選択…</option>
          {OFFICIAL_DANMAKU_SKILLS.map(sk => <option key={sk.name} value={sk.name}>{sk.name}</option>)}
        </select>
      )}
      {en.ds?.type === "custom" && (
        <div style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:6 }}>
          <input style={iBase} value={en.ds?.customName || ""} onChange={e => updDs({ customName:e.target.value })} placeholder="スキル名"/>
          <textarea style={{...iBase, height:38}} value={en.ds?.desc || ""} onChange={e => updDs({ desc:e.target.value })} placeholder="スキル効果"/>
        </div>
      )}

      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
        <SpellCardEditor label="スペルカード①（任意）" name={en.sc1name||""} effect={en.sc1effect||""} mode={sc1mode} cardRef={en.sc1ref||""}
          onChange={({name,effect,mode,ref}) => onChange({ ...en, sc1name:name, sc1effect:effect, sc1mode:mode, sc1ref:ref||"" })}/>
        <SpellCardEditor label="スペルカード②（任意）" name={en.sc2name||""} effect={en.sc2effect||""} mode={sc2mode} cardRef={en.sc2ref||""}
          onChange={({name,effect,mode,ref}) => onChange({ ...en, sc2name:name, sc2effect:effect, sc2mode:mode, sc2ref:ref||"" })}/>
      </div>
    </div>
  );
}

// ── Quest Editor ─────────────────────────────────────
function QuestEditor({ quest, onChange, onDelete, index, allQuests }) {
  const [open, setOpen] = useState(false);
  const upd = (key, val) => onChange({ ...quest, [key]: val });
  const updEnemy = (key, val) => {
    // ds 関連は enemy.ds に格納する
    if (key === "ds") return onChange({ ...quest, enemy: { ...quest.enemy, ds: val } });
    if (key.startsWith("ds")) {
      const dsKey = key.replace(/^ds/, "");
      const k = dsKey.charAt(0).toLowerCase() + dsKey.slice(1);
      return onChange({ ...quest, enemy: { ...quest.enemy, ds: { ...(quest.enemy?.ds || {}), [k]: val } } });
    }
    return onChange({ ...quest, enemy: { ...quest.enemy, [key]: val } });
  };
  const solColor = SOLUTION_COLORS[quest.solutionType] || C.text;

  return (
    <div style={{ border:`1px solid ${open?solColor+"60":C.border}`, borderRadius:5, marginBottom:6, overflow:"hidden" }}>
      {/* Header row */}
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 10px", cursor:"pointer",
        background: open ? `${solColor}08` : "rgba(255,255,255,0.02)" }}
        onClick={() => setOpen(v => !v)}>
        <div style={{ width:18, height:18, borderRadius:"50%", background:C.goldBg, border:`1px solid ${C.goldDim}`,
          display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, color:C.gold, flexShrink:0 }}>
          {index+1}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <span style={{ fontSize:11, color: quest.name ? C.text : C.textFaint }}>
            {quest.name || "（クエスト名未設定）"}
          </span>
          {quest.level > 0 && <span style={{ fontSize:9, color:C.textFaint, marginLeft:6 }}>Lv.{quest.level}</span>}
        </div>
        {(quest.unlockType||"start")==="start" && <Chip label="開始時公開" color={C.textFaint}/>}
        {(quest.unlockType||"start")==="quest" && <Chip label="条件付き公開" color={C.gold}/>}
        {(quest.unlockType||"start")==="custom" && <Chip label="手動公開" color="#f9a825"/>}
        <Chip label={quest.solutionType} color={solColor} />
        <button onClick={e => {e.stopPropagation();onDelete();}}
          style={{ ...btn(C.redBg,C.redBorder,C.red,{padding:"2px 8px",fontSize:10}) }}>✕</button>
        <span style={{ color:C.textFaint, fontSize:12 }}>{open?"▲":"▼"}</span>
      </div>

      {open && (
        <div style={{ padding:"10px 12px", borderTop:`1px solid ${C.border}` }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            <div>
              <Label>クエスト名 *</Label>
              <input style={iBase} value={quest.name} onChange={e => upd("name",e.target.value)} placeholder="クエスト名"/>
            </div>
            <div>
              <Label>レベル</Label>
              <input type="number" min="1" max="9" style={{...iBase,width:60}} value={quest.level} onChange={e => upd("level",parseInt(e.target.value)||1)}/>
            </div>
          </div>

          <Label>概要</Label>
          <textarea style={{...taBase,height:52}} value={quest.summary} onChange={e => upd("summary",e.target.value)} placeholder="クエストの概要"/>

          <SecTitle>公開条件</SecTitle>
          <div style={{ display:"flex", gap:6, marginBottom:6 }}>
            {[["start","探索フェイズ開始時"],["quest","クエスト解決時"],["custom","カスタム"]].map(([v, label]) => (
              <button key={v} onClick={() => upd("unlockType",v)}
                style={{ ...btn(
                  (quest.unlockType||"start")=== v ? C.goldBg : "rgba(255,255,255,0.02)",
                  (quest.unlockType||"start")=== v ? C.goldDim : C.border,
                  (quest.unlockType||"start")=== v ? C.gold : C.textFaint,
                  {padding:"4px 10px",fontSize:10}
                )}}>
                {label}
              </button>
            ))}
          </div>
          {(quest.unlockType||"start")==="start" && (
            <div style={{ padding:"5px 8px", background:"rgba(255,255,255,0.02)", borderRadius:3, fontSize:9, color:C.textDim }}>
              ※探索フェイズ開始時に自動で公開されます
            </div>
          )}
          {(quest.unlockType||"start")==="quest" && (
            <div>
              <select style={iBase} value={quest.unlockQuestId||""}
                onChange={e => upd("unlockQuestId",e.target.value)}>
                <option value="">参照するクエストを選択…</option>
                {(allQuests||[]).filter(q => q.id!==quest.id&&q.name).map(q => (
                  <option key={q.id} value={q.id}>クエスト「{q.name}」</option>
                ))}
              </select>
              {quest.unlockQuestId && (
                <div style={{ fontSize:9, color:C.textDim, marginTop:4 }}>
                  ※選択したクエストが解決されると自動で公開されます
                </div>
              )}
              {!quest.unlockQuestId && (
                <div style={{ fontSize:9, color:"#f9a825", marginTop:4 }}>
                  ⚠ 参照するクエストを選択してください
                </div>
              )}
            </div>
          )}
          {(quest.unlockType||"start")==="custom" && (
            <div>
              <input style={iBase} value={quest.unlockCondition||""}
                onChange={e => upd("unlockCondition",e.target.value)}
                placeholder="例: 特定の手がかりを取得後"/>
              <div style={{ fontSize:9, color:"#f9a825", marginTop:4 }}>
                ※カスタム条件のためGMが手動でクエストを公開してください
              </div>
            </div>
          )}

          <Label>クエストの真相</Label>
          <textarea style={{...taBase,height:52}} value={quest.truth} onChange={e => upd("truth",e.target.value)} placeholder="クエストの真相"/>

          <SecTitle>解決方法</SecTitle>
          <div style={{ display:"flex", gap:6, marginBottom:10 }}>
            {SOLUTION_TYPES.map(t => (
              <button key={t} onClick={() => upd("solutionType",t)}
                style={{ ...btn(
                  quest.solutionType === t ? `${SOLUTION_COLORS[t]}20` : "rgba(255,255,255,0.02)",
                  quest.solutionType === t ? SOLUTION_COLORS[t] : C.border,
                  quest.solutionType === t ? SOLUTION_COLORS[t] : C.textFaint,
                  { padding:"5px 12px", fontWeight: quest.solutionType === t?"bold":"normal" }
                )}}>
                {t}
              </button>
            ))}
          </div>

          {/* 行為判定 */}
          {quest.solutionType==="行為判定" && (
            <div style={{ padding:10, background:C.blueBg, border:`1px solid ${C.blueBorder}60`, borderRadius:4 }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                <div>
                  <Label>指定タグ（任意）</Label>
                  <input style={iBase} value={quest.specifiedTag} onChange={e => upd("specifiedTag",e.target.value)} placeholder="例: 妖怪・巫女"/>
                </div>
                <div>
                  <Label>解決場所</Label>
                  <select style={iBase} value={quest.location || ""} onChange={e => upd("location", e.target.value)}>
                    <option value="">スポットを選択…</option>
                    {SPOTS.map(s => <option key={s.id} value={s.id}>{s.name}（{s.id}）</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* 弾幕ごっこ */}
          {quest.solutionType==="弾幕ごっこ" && (()=> {
            const en = quest.enemy || EMPTY_ENEMY();
            const sc1mode = en.sc1mode || "custom";
            const sc2mode = en.sc2mode || "custom";
            const sc1ok = sc1mode === "existing" ? !!en.sc1name : !!(en.sc1name && en.sc1effect);
            const sc1partial = sc1mode === "custom" && !!(en.sc1name || en.sc1effect) && !sc1ok;
            const sc2ok = sc2mode === "existing" ? !!en.sc2name : !!(en.sc2name && en.sc2effect);
            const sc2partial = sc2mode === "custom" && !!(en.sc2name || en.sc2effect) && !sc2ok;
            return (
              <div style={{ padding:12, background:C.redBg, border:`1px solid ${C.redBorder}60`, borderRadius:4 }}>
                {/* 基本ステータス */}
                <div style={{ display:"grid", gridTemplateColumns:"1fr 58px 58px 58px 58px", gap:8, marginBottom:4 }}>
                  <div>
                    <Label>エネミー名 *</Label>
                    <input style={iBase} value={en.name} onChange={e => updEnemy("name",e.target.value)} placeholder="例: 謎の妖怪"/>
                  </div>
                  <div>
                    <Label>残人数</Label>
                    <input type="number" min="1" max="99" style={iBase} value={en.life??2} onChange={e => updEnemy("life",parseInt(e.target.value)||1)}/>
                  </div>
                  <div>
                    <Label>スペカ</Label>
                    <input type="number" min="0" max="9" style={iBase} value={en.spellcard??1} onChange={e => updEnemy("spellcard",parseInt(e.target.value)||0)}/>
                  </div>
                  <div>
                    <Label>攻撃力</Label>
                    <input type="number" min="0" max="99" style={iBase} value={en.attack??5} onChange={e => updEnemy("attack",parseInt(e.target.value)||0)}/>
                  </div>
                  <div>
                    <Label>回避力</Label>
                    <input type="number" min="0" max="3" style={iBase} value={en.evade??3} onChange={e => updEnemy("evade",parseInt(e.target.value)||0)}/>
                  </div>
                </div>

                {/* 立ち絵 */}
                <div style={{ marginBottom:6 }}>
                  <Label>立ち絵（任意・未設定時は名前一致のキャラ絵）</Label>
                  <PortraitUpload value={en.customPortrait || null} onChange={v => updEnemy("customPortrait", v)}/>
                </div>

                {/* 弾幕スキル */}
                <Label>弾幕スキル（任意）</Label>
                <div style={{ display:"flex", gap:6, marginBottom:6 }}>
                  {["none","official","custom"].map(v => (
                    <button key={v} onClick={() => updEnemy("dsType", v)}
                      style={{ ...btn(
                        (en.ds?.type || "none") === v ? "rgba(200,160,64,0.2)" : "rgba(255,255,255,0.02)",
                        (en.ds?.type || "none") === v ? C.goldDim : C.border,
                        (en.ds?.type || "none") === v ? C.gold : C.textFaint,
                        {padding:"4px 10px",fontSize:10}
                      )}}>
                      {v === "none" ? "なし" : v === "official" ? "公式から選択" : "カスタム"}
                    </button>
                  ))}
                </div>
                {en.ds?.type === "official" && (
                  <div style={{ marginBottom:8 }}>
                    <select style={iBase} value={en.ds?.name || ""}
                      onChange={e => {
                        const sk = OFFICIAL_DANMAKU_SKILLS.find(s => s.name === e.target.value);
                        updEnemy("dsName", e.target.value);
                        updEnemy("dsDesc", sk?.desc || "");
                      }}>
                      <option value="">スキルを選択…</option>
                      {OFFICIAL_DANMAKU_SKILLS.map(sk => <option key={sk.name} value={sk.name}>{sk.name}</option>)}
                    </select>
                    {en.ds?.name && (
                      <div style={{ marginTop:5, padding:"5px 8px", background:"rgba(255,255,255,0.03)", borderRadius:3, fontSize:9, color:C.textDim, lineHeight:1.6 }}>
                        ※公式スキルのため弾幕ごっこ中に自動で処理されます<br/>{en.ds?.desc}
                      </div>
                    )}
                  </div>
                )}
                {en.ds?.type === "custom" && (
                  <div style={{ marginBottom:8 }}>
                    <Label>スキル名</Label>
                    <input style={{...iBase,marginBottom:4}} value={en.ds?.customName || ""} onChange={e => updEnemy("dsCustomName", e.target.value)} placeholder="スキル名"/>
                    <Label>効果テキスト</Label>
                    <textarea style={{...iBase,height:52,resize:"vertical"}} value={en.ds?.desc || ""} onChange={e => updEnemy("dsDesc", e.target.value)} placeholder="効果の説明"/>
                    <div style={{ fontSize:9, color:"#f9a825", marginTop:3 }}>※カスタムスキルのため弾幕ごっこ中に手動で処理してください</div>
                  </div>
                )}

                {/* スペルカード① */}
                <div style={{ marginTop: 8 }}>
                  <SpellCardEditor
                    label="スペルカード①（任意）"
                    name={en.sc1name || ""} effect={en.sc1effect || ""} mode={sc1mode}
                    cardRef={en.sc1ref || ""}
                    warn={sc1partial}
                    onChange={({ name, effect, mode, ref }) => onChange({
                      ...quest, enemy: { ...en, sc1name: name, sc1effect: effect, sc1mode: mode, sc1ref: ref || "" }
                    })}
                  />
                </div>

                {/* スペルカード② */}
                <div style={{ marginTop: 6 }}>
                  <SpellCardEditor
                    label="スペルカード②（任意）"
                    name={en.sc2name || ""} effect={en.sc2effect || ""} mode={sc2mode}
                    cardRef={en.sc2ref || ""}
                    warn={sc2partial}
                    onChange={({ name, effect, mode, ref }) => onChange({
                      ...quest, enemy: { ...en, sc2name: name, sc2effect: effect, sc2mode: mode, sc2ref: ref || "" }
                    })}
                  />
                </div>

                {/* 解決場所 */}
                <div style={{ marginTop:8 }}>
                  <Label>解決場所</Label>
                  <select style={iBase} value={quest.location || ""} onChange={e => upd("location", e.target.value)}>
                    <option value="">スポットを選択…</option>
                    {SPOTS.map(s => <option key={s.id} value={s.id}>{s.name}（{s.id}）</option>)}
                  </select>
                </div>

              </div>
            );
          })()}

          {/* 自動解決 */}
          {quest.solutionType==="自動解決" && (
            <div style={{ padding:8, background:C.greenBg, border:`1px solid ${C.greenBorder}60`, borderRadius:4, fontSize:10, color:C.textDim }}>
              解決場所は不要です。真相を公開するとその場でクエストが終了します。
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Scenario Form ─────────────────────────────────────
function ScenarioForm({ initial, onSave, onCancel }) {
  const [sc, setSc] = useState(initial || EMPTY_SCENARIO());
  const [saving, setSaving] = useState(false);
  const upd = (k,v) => setSc(p => ({...p,[k]:v}));

  const addQuest = () => setSc(p => ({...p, quests:[...(p.quests||[]), EMPTY_QUEST()]}));
  const updateQuest = (i,q) => setSc(p => ({...p, quests:p.quests.map((x, j) => j === i?q:x)}));
  const deleteQuest = (i) => setSc(p => ({...p, quests:p.quests.filter((_, j) => j!==i)}));
  const moveQuest = (i,dir) => setSc(p => {
    const qs=[...(p.quests||[])];
    const j=i+dir;
    if(j<0||j>=qs.length)return p;
    [qs[i],qs[j]]=[qs[j],qs[i]];
    return {...p,quests:qs};
  });

  const handleSave = async () => {
    if(!sc.name.trim()){alert("シナリオ名を入力してください");return;}
    // スペルカードの片方未入力チェック
    const badQuests = (sc.quests||[]).filter(q => {
      const en = q.enemy;
      if(q.solutionType!=="弾幕ごっこ"||!en) return false;
      const m1 = en.sc1mode || "custom";
      const m2 = en.sc2mode || "custom";
      const sc1partial = m1 === "custom" && !!(en.sc1name||en.sc1effect) && !(en.sc1name&&en.sc1effect);
      const sc2partial = m2 === "custom" && !!(en.sc2name||en.sc2effect) && !(en.sc2name&&en.sc2effect);
      return sc1partial||sc2partial;
    });
    if(badQuests.length>0){
      alert(`クエスト「${badQuests.map(q => q.name||"(名前なし)").join("・")}」のスペルカードで名前と効果のどちらか一方が未入力です。`);
      return;
    }
    setSaving(true);
    await onSave({...sc, updatedAt:Date.now()});
    setSaving(false);
  };

  const addFinalEnemy = () => setSc(p => ({ 
    ...p, 
    finalBattleEnemies: [...(p.finalBattleEnemies || []), EMPTY_ENEMY()] 
  }));

  const updateFinalEnemy = (i, en) => setSc(p => ({ 
    ...p, 
    finalBattleEnemies: p.finalBattleEnemies.map((x, j) => j === i ? en : x) 
  }));

  const deleteFinalEnemy = (i) => {
    if(!window.confirm("このエネミーを削除しますか？")) return;
    setSc(p => ({ ...p, finalBattleEnemies: p.finalBattleEnemies.filter((_, j) => j !== i) }));
  };

  return (
    <div style={{ background:BG, minHeight:"100vh", fontFamily:"'Noto Serif JP', serif", color:C.text, padding:16 }}>
      <style>{`::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#1a1e2a} button:hover{opacity:0.85} input,textarea,select{outline:none}`}</style>

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
        <div>
          <span style={{ fontSize:14, color:C.gold, letterSpacing:2 }}>幻想ナラトグラフ</span>
          <span style={{ fontSize:10, color:C.textDim, marginLeft:10 }}>
            {initial?.id ? "シナリオ編集" : "新規シナリオ作成"}
          </span>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={handleSave} disabled={saving}
            style={btn(C.goldBg,C.goldDim,C.gold,{padding:"7px 20px"})}>
            {saving?"保存中…":"💾 保存する"}
          </button>
          <button onClick={onCancel}
            style={btn("rgba(255,255,255,0.03)",C.border,C.textFaint,{padding:"7px 14px"})}>
            ← 戻る
          </button>
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"340px 1fr", gap:16, alignItems:"flex-start" }}>
        {/* 左列: 基本情報 */}
        <div>
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:6, padding:14, marginBottom:12 }}>
            <SecTitle>基本情報</SecTitle>
            <Label>シナリオ名 *</Label>
            <input style={iBase} value={sc.name} onChange={e => upd("name",e.target.value)} placeholder="シナリオタイトル"/>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              <div>
                <Label>最小人数</Label>
                <input type="number" min="1" max="8" style={iBase} value={sc.playerCountMin}
                  onChange={e => upd("playerCountMin",parseInt(e.target.value)||1)}/>
              </div>
              <div>
                <Label>最大人数</Label>
                <input type="number" min="1" max="8" style={iBase} value={sc.playerCountMax}
                  onChange={e => upd("playerCountMax",parseInt(e.target.value)||4)}/>
              </div>
            </div>
            <Label>難易度</Label>
            <select style={iBase} value={sc.difficulty} onChange={e => upd("difficulty",e.target.value)}>
              {DIFFICULTIES.map(d=><option key={d} value={d}>{d}</option>)}
            </select>
            <Label>リミット</Label>
            <input style={iBase} value={sc.limit} onChange={e => upd("limit",e.target.value)} placeholder="例: 3日目の夜"/>
            <Label>キーワード（PL・GMに公開・カンマ/読点区切り）</Label>
            <input style={iBase} value={(sc.keywords||[]).join("、")}
              onChange={e => upd("keywords", e.target.value.split(/[、,]/).map(s=>s.trim()).filter(Boolean))}
              placeholder="例: 梅雨、人間の里、結婚"/>
          </div>

          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:6, padding:14, marginBottom:12 }}>
            <SecTitle>選択不可キャラクター</SecTitle>
            <div style={{ fontSize:9, color:C.textFaint, marginBottom:8 }}>クリックで選択・解除</div>
            {/* 選択済みチップ */}
            {(sc.bannedChars||[]).length>0 && (
              <div style={{marginBottom:8,display:"flex",flexWrap:"wrap",gap:4}}>
                {sc.bannedChars.map(c => (
                  <span key={c} onClick={() => upd("bannedChars",(sc.bannedChars||[]).filter(x => x!==c))}
                    style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 8px",
                      background:"rgba(192,57,43,0.2)",border:`1px solid ${C.redBorder}`,
                      borderRadius:10,fontSize:9,color:C.red,cursor:"pointer"}}>
                    {c} <span style={{fontSize:10}}>✕</span>
                  </span>
                ))}
              </div>
            )}
            {/* キャラ一覧グリッド */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(72px,1fr))",gap:4,maxHeight:200,overflowY:"auto"}}>
              {CHAR_NAMES.map(name => {
                const banned=(sc.bannedChars||[]).includes(name);
                return(
                  <div key={name} onClick={() => {
                    const cur=sc.bannedChars||[];
                    upd("bannedChars",banned?cur.filter(x => x!==name):[...cur,name]);
                  }} style={{
                    padding:"3px 4px",borderRadius:4,cursor:"pointer",textAlign:"center",
                    background:banned?"rgba(192,57,43,0.18)":"rgba(255,255,255,0.02)",
                    border:`1px solid ${banned?C.redBorder:C.border}`,
                    opacity:banned?1:0.7,
                  }}>
                    <div style={{fontSize:8,color:banned?C.red:C.textDim,lineHeight:1.3}}>{name}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:6, padding:14 }}>
            <SecTitle>探索フェイズ開始スポット</SecTitle>
            <div style={{ display:"flex", gap:6, marginBottom:6 }}>
              {[["base","各PCの拠点"],["fixed","指定スポット"]].map(([v, label]) => (
                <button key={v} onClick={() => upd("startSpotType",v)}
                  style={{ ...btn(
                    (sc.startSpotType||"base")=== v ? C.goldBg : "rgba(255,255,255,0.02)",
                    (sc.startSpotType||"base")=== v ? C.goldDim : C.border,
                    (sc.startSpotType||"base")=== v ? C.gold : C.textFaint,
                    {padding:"4px 10px",fontSize:10}
                  )}}>
                  {label}
                </button>
              ))}
            </div>
            {(sc.startSpotType||"base")==="base" && (
              <div style={{ fontSize:9,color:C.textDim,padding:"4px 6px",background:"rgba(255,255,255,0.02)",borderRadius:3 }}>
                各PCはキャラクターの拠点スポットからスタートします
              </div>
            )}
            {(sc.startSpotType||"base")==="fixed" && (
              <div>
                <Label>スポットID（例: 11）</Label>
                <input style={{...iBase,width:80}} value={sc.startSpotId||""}
                  onChange={e => upd("startSpotId",e.target.value)}
                  placeholder="11"/>
                <div style={{ fontSize:9,color:C.textFaint,marginTop:3 }}>
                  全PCが同じスポットからスタートします
                </div>
              </div>
            )}
            <SecTitle>バックストーリー</SecTitle>
            <textarea style={{...taBase,height:160}} value={sc.backstory}
              onChange={e => upd("backstory",e.target.value)}
              placeholder="セッション開始時に表示されるバックストーリー。クリックで探索フェイズへ進む画面に使用されます。"/>
            <SecTitle>GMメモ</SecTitle>
            <textarea style={{...taBase,height:80}} value={sc.notes||""}
              onChange={e => upd("notes",e.target.value)}
              placeholder="GMだけが見るメモ（セッション中には非表示）"/>

            <SecTitle>各フェイズの特殊処理（GM向け・任意）</SecTitle>
            <div style={{ fontSize:9, color:C.textFaint, marginBottom:6 }}>各フェイズで必要な特殊処理を書き残します（例: 探索の集団戦処理、特定スポットの扱いなど）。主に探索フェイズ。</div>
            {[["intro","導入"],["explore","探索"],["battle","決戦"],["epilogue","終幕"]].map(([k,label])=>(
              <div key={k} style={{ marginBottom:4 }}>
                <Label>{label}</Label>
                <textarea style={{...taBase,height:48}} value={(sc.phaseNotes||{})[k]||""}
                  onChange={e => upd("phaseNotes", { ...(sc.phaseNotes||{}), [k]: e.target.value })}
                  placeholder={`${label}フェイズの特殊処理（任意）`}/>
              </div>
            ))}
          </div>

        </div>

        {/* 右列: クエスト */}
        <div>
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:6, padding:14 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <div style={{ fontSize:13, color:C.gold, letterSpacing:1 }}>クエスト一覧</div>
              <button onClick={addQuest} style={btn(C.goldBg,C.goldDim,C.gold,{padding:"5px 14px"})}>＋ クエストを追加</button>
            </div>

            {(sc.quests||[]).length === 0 && (
              <div style={{ fontSize:10, color:C.textFaint, textAlign:"center", padding:"20px 0" }}>
                クエストがありません。「＋ クエストを追加」で追加してください。
              </div>
            )}
            {(sc.quests||[]).map((q, i) => (
              <div key={q.id||i} style={{ position:"relative" }}>
                <div style={{ position:"absolute", left:-28, top:8, display:"flex", flexDirection:"column", gap:2 }}>
                  <button onClick={() => moveQuest(i,-1)} style={{ ...btn("rgba(255,255,255,0.03)",C.border,C.textFaint,{width:20,height:20,padding:0,fontSize:10}) }}>↑</button>
                  <button onClick={() => moveQuest(i,1)} style={{ ...btn("rgba(255,255,255,0.03)",C.border,C.textFaint,{width:20,height:20,padding:0,fontSize:10}) }}>↓</button>
                </div>
                <QuestEditor quest={q} index={i} onChange={nq => updateQuest(i,nq)} onDelete={() => deleteQuest(i)} allQuests={sc.quests||[]}/>
              </div>
            ))}
          </div>

          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: 14, marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, color: C.red, letterSpacing: 1, fontWeight: "bold" }}>⚔️ 決戦フェイズ：エネミー陣営</div>
              <div style={{ fontSize: 9, color: C.textDim, marginTop: 2 }}>決戦フェイズでPC全員と戦うNPCを登録します。</div>
            </div>
            <button onClick={addFinalEnemy} style={btn(C.redBg, C.redBorder, C.red, { padding: "5px 14px" })}>
              ＋ 敵を追加
            </button>
          </div>
          
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {(sc.finalBattleEnemies || []).map((en, i) => (
              <div key={i} style={{ padding: 12, background: "rgba(192,57,43,0.05)", borderRadius: 5, border: `1px solid ${C.redBorder}40` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: 6 }}>
                  <span style={{ fontSize: 10, color: C.red, fontWeight: "bold" }}>ENEMY #{i + 1}</span>
                  <button onClick={() => deleteFinalEnemy(i)} style={{ background: "none", border: "none", color: C.textFaint, cursor: "pointer", fontSize: 11 }}>✕ 削除</button>
                </div>
                <EnemyEditor enemy={en} showPrimary onChange={ne => updateFinalEnemy(i, ne)} />
              </div>
            ))}

            {(!sc.finalBattleEnemies || sc.finalBattleEnemies.length === 0) && (
              <div style={{ padding: "20px", textAlign: "center", border: `1px dashed ${C.redBorder}40`, borderRadius: 5 }}>
                <div style={{ fontSize: 11, color: C.textFaint }}>決戦フェイズの敵が登録されていません。</div>
                <div style={{ fontSize: 9, color: C.red, marginTop: 4 }}>※集団戦を行うには1人以上の敵が必要です。</div>
              </div>
            )}

          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

// ── Scenario Detail の小コンポーネント（render 内で定義しないようモジュールレベルに） ──
function Section({ title, children }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 10, color: C.gold, letterSpacing: 1, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}
function EnemyCard({ en, label }) {
  return (
    <div style={{ padding: "6px 8px", background: "rgba(192,57,43,0.06)", border: `1px solid ${C.redBorder}40`, borderRadius: 4, marginBottom: 4 }}>
      <div style={{ fontSize: 10, color: C.red }}>{en.name || "（無名）"}{en.primary && " ★主敵"}{label && <span style={{ color: C.textFaint }}> {label}</span>}</div>
      <div style={{ fontSize: 8, color: C.textDim, marginTop: 2 }}>攻撃{en.attack ?? "-"} / 残{en.life ?? "-"} / 人数{en.ninzu ?? "-"}{en.evade != null && ` / 回避${en.evade}`} / SC{en.spellcard ?? "-"}</div>
      {(en.ds?.name || en.dsName) && <div style={{ fontSize: 8, color: C.textFaint, marginTop: 1 }}>弾幕: {en.ds?.name || en.dsName}</div>}
      {[en.sc1name, en.sc2name].filter(Boolean).length > 0 && <div style={{ fontSize: 8, color: C.gold, marginTop: 1 }}>SC: {[en.sc1name, en.sc2name].filter(Boolean).join(" / ")}</div>}
    </div>
  );
}

// ── Scenario Detail（読み取り専用ビューア。収録シナリオの中身を確認する） ──
export function ScenarioDetail({ scenario: sc, onClose }) {
  const [gmOpen, setGmOpen] = useState(false); // GM向け（ネタバレ）を折りたたむ。既定で閉じる
  if (!sc) return null;
  const spotName = id => SPOTS.find(s => s.id === id)?.name || id || "—";
  const pre = { fontSize: 10, color: C.textDim, whiteSpace: "pre-wrap", lineHeight: 1.7, marginTop: 3 };
  const rebinds = Object.entries(sc.spotRebind || {});
  const phaseNotes = [["intro","導入"],["explore","探索"],["battle","決戦"],["epilogue","終幕"]].filter(([k]) => (sc.phaseNotes || {})[k]?.trim());
  // transform を持つ祖先（LobbyCard のアニメ等）の影響で position:fixed の基準がずれるのを避けるため body 直下へ Portal
  return createPortal((
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, animation: "backdropIn 0.15s ease" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#0a0c16", border: `1px solid ${C.goldDim}`, borderRadius: 8, padding: 20, maxWidth: 680, width: "100%", maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
          <div style={{ fontSize: 16, color: C.gold, flex: 1 }}>
            {sc.official && <span style={{ fontSize: 9, color: C.gold, border: `1px solid ${C.goldDim}`, borderRadius: 3, padding: "0 4px", marginRight: 6, verticalAlign: "middle" }}>公式</span>}
            {sc.name}
            {sc.author && <span style={{ fontSize: 9, color: C.textFaint, marginLeft: 8 }}>作: {sc.author}</span>}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.textFaint, cursor: "pointer", fontSize: 16, flexShrink: 0 }}>✕</button>
        </div>

        {/* 公開情報（PL・GMに公開） */}
        <Section title="公開情報（PL・GMに公開）">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
            <Chip label={sc.difficulty} color={C.gold} />
            <Chip label={`${sc.playerCountMin}〜${sc.playerCountMax}人`} color={C.blue} />
            <Chip label={`リミット: ${sc.limit}`} color={C.textDim} />
          </div>
          {(sc.keywords || []).length > 0 && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
              {sc.keywords.map((k, i) => <Chip key={i} label={`# ${k}`} color={C.blue} />)}
            </div>
          )}
          {sc.bannedChars?.length > 0 && <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 6 }}>選択不可キャラ: {sc.bannedChars.join("・")}</div>}
          {sc.backstory && <div style={{ fontSize: 9, color: C.gold, marginBottom: 2 }}>バックストーリー</div>}
          {sc.backstory && <div style={pre}>{sc.backstory}</div>}
        </Section>

        {/* GM向け（ネタバレ）— クリックで展開。既定は折りたたみ */}
        <div onClick={() => setGmOpen(v => !v)} style={{ marginTop: 16, padding: "7px 10px", background: "rgba(192,57,43,0.08)", border: `1px solid ${C.redBorder}`, borderRadius: 5, fontSize: 11, color: C.red, letterSpacing: 1, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
          <span>{gmOpen ? "▼" : "▶"}</span>🔒 GM向け（各フェイズの処理・クエスト詳細・ネタバレ）
          {!gmOpen && <span style={{ fontSize: 9, color: C.textFaint, marginLeft: "auto" }}>クリックで展開</span>}
        </div>

        {gmOpen && (<>
        {phaseNotes.length > 0 && (
          <Section title="各フェイズの特殊処理">
            {phaseNotes.map(([k, label]) => (
              <div key={k} style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 9, color: C.gold }}>{label}フェイズ</div>
                <div style={pre}>{sc.phaseNotes[k]}</div>
              </div>
            ))}
          </Section>
        )}

        {(sc.blockedSpots?.length > 0 || rebinds.length > 0) && (
          <Section title="特殊ルール">
            {sc.blockedSpots?.length > 0 && <div style={{ fontSize: 10, color: C.red }}>立入禁止: {sc.blockedSpots.map(spotName).join("・")}</div>}
            {rebinds.length > 0 && <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>拠点リダイレクト: {rebinds.map(([a, b]) => `${spotName(a)}→${spotName(b)}`).join(" / ")}</div>}
          </Section>
        )}

        <Section title={`クエスト（${(sc.quests || []).length}）`}>
          {(sc.quests || []).map((q, i) => (
            <div key={i} style={{ padding: "8px 10px", marginBottom: 6, background: "rgba(255,255,255,0.02)", border: `1px solid ${C.border}`, borderRadius: 4 }}>
              <div style={{ fontSize: 11, color: C.text }}>#{i + 1} {q.name || "（無名クエスト）"}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 3 }}>
                {q.solutionType && <Chip label={q.solutionType} color={C.gold} />}
                {q.location && <Chip label={`@${spotName(q.location)}`} color={C.blue} />}
                {q.level != null && <Chip label={`Lv${q.level}`} color={C.textDim} />}
                {q.specifiedTag && <Chip label={`指定:${q.specifiedTag}`} color={C.textFaint} />}
                {q.massBattle && <Chip label="集団戦" color={C.red} />}
                {q.preBattleFlavorRoll && <Chip label={`演出判定(目標${q.preBattleFlavorRoll.target ?? 6})`} color={C.gold} />}
              </div>
              {q.summary && <div style={pre}>{q.summary}</div>}
              {q.truth && <details style={{ marginTop: 4 }}><summary style={{ fontSize: 9, color: C.gold, cursor: "pointer" }}>真相（ネタバレ）</summary><div style={pre}>{q.truth}</div></details>}
              {(q.enemy?.name || q.enemy?.dsName || q.enemy?.sc1name) && <div style={{ marginTop: 5 }}><EnemyCard en={q.enemy} /></div>}
              {q.massBattle && (q.extraEnemies || []).map((e, j) => <EnemyCard key={j} en={e} label="追加敵" />)}
            </div>
          ))}
        </Section>

        <Section title="決戦フェイズ">
          {(sc.finalBattleEnemies || []).map((e, i) => <EnemyCard key={i} en={e} />)}
          {(sc.finalBattleOptionalEnemies || []).length > 0 && (
            <>
              <div style={{ fontSize: 9, color: C.gold, margin: "6px 0 3px" }}>追加候補エネミー（GMが任意投入）</div>
              {sc.finalBattleOptionalEnemies.map((e, i) => <EnemyCard key={i} en={e} label="候補" />)}
            </>
          )}
        </Section>

        {sc.notes && <Section title="GMメモ"><div style={pre}>{sc.notes}</div></Section>}
        </>)}
      </div>
    </div>
  ), document.body);
}

// ── Scenario List ─────────────────────────────────────
function ScenarioList({ onSelect, onEdit, selectedId, items }) {
  const [loaded, setLoaded] = useState([]);
  const [loading, setLoading] = useState(!items);
  const user = auth.currentUser;

  useEffect(()=> {
    if(items)return; // items 指定時は外部（ビルトイン等）なので Firebase は読まない
    if(!user)return;
    const r = ref(db, `users/${user.uid}/scenarios`);
    const unsub = onValue(r, snap => {
      if(snap.exists()){
        const arr = Object.entries(snap.val()).map(([id, v]) => ({...v,id}));
        arr.sort((a, b) => (b.updatedAt||0)-(a.updatedAt||0));
        setLoaded(arr);
      } else {
        setLoaded([]);
      }
      setLoading(false);
    });
    return() => unsub();
  },[user, items]);

  const scenarios = items || loaded;

  const diffColor = { "Easy":C.green, "Normal":C.blue, "Hard":C.gold, "Lunatic":C.purple };

  if(loading) return <div style={{fontSize:10,color:C.textFaint}}>読み込み中…</div>;

  return(
    <div>
      {scenarios.length === 0&&<div style={{fontSize:10,color:C.textFaint}}>保存済みシナリオはありません</div>}
      {scenarios.map(sc => (
        <div key={sc.id} onClick={() => onSelect&&onSelect(sc)}
          style={{ padding:"10px 12px", marginBottom:6, borderRadius:5, cursor:onSelect?"pointer":"default",
            background: selectedId === sc.id ? C.goldBg : C.card,
            border:`1px solid ${selectedId === sc.id ? C.goldDim : C.border}`,
          }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:12, color: selectedId === sc.id ? C.gold : C.text, marginBottom:2 }}>
                {sc.official && <span style={{ fontSize:8, color:C.gold, border:`1px solid ${C.goldDim}`, borderRadius:3, padding:"0 4px", marginRight:5, verticalAlign:"middle" }}>公式</span>}
                {sc.name}
              </div>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                <Chip label={`${sc.playerCountMin}〜${sc.playerCountMax}人`} color={C.blue}/>
                <Chip label={sc.difficulty} color={diffColor[sc.difficulty]||C.text}/>
                <Chip label={`リミット: ${sc.limit}`} color={C.textDim}/>
                {sc.author && <Chip label={`作: ${sc.author}`} color={C.textFaint}/>}
              </div>
            </div>
            {onEdit && (
              <button onClick={e => {e.stopPropagation();onEdit(sc);}}
                style={{ ...btn("rgba(255,255,255,0.04)",C.border,C.textDim,{padding:"3px 10px",fontSize:10,flexShrink:0}) }}>
                編集
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── BGMプリセット編集（GMが事前に設定。users/{uid}/bgm。プロフィール・準備フェイズで共用）──
export function BgmPresetEditor({ uid }) {
  const [bgm, setBgm] = useState({ explore: "", battle: "", end: "" });
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!uid) return;
    get(ref(db, `users/${uid}/bgm`)).then(snap => { if (snap.exists()) setBgm({ explore: "", battle: "", end: "", ...snap.val() }); }).catch(() => {});
  }, [uid]);
  const save = async () => {
    try {
      await set(ref(db, `users/${uid}/bgm`), { explore: bgm.explore || "", battle: bgm.battle || "", end: bgm.end || "" });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e) { console.error(e); }
  };
  return (
    <div>
      <div style={{ fontSize: 9, color: C.textFaint, lineHeight: 1.6, marginBottom: 8 }}>
        各フェーズで自動再生するBGM（直接再生できる音声ファイルのURL: mp3/ogg 等）。セッション中に個別設定が無ければこれが流れます。著作権・利用規約はGMの責任で確認してください。
      </div>
      {[["explore", "探索 / 導入"], ["battle", "弾幕ごっこ / 決戦"], ["end", "終了 / 終幕"]].map(([k, label]) => (
        <div key={k} style={{ marginBottom: 7 }}>
          <div style={{ fontSize: 9, color: C.textDim, marginBottom: 2 }}>{label}</div>
          <input value={bgm[k] || ""} onChange={e => setBgm(b => ({ ...b, [k]: e.target.value }))} placeholder="https://…（mp3/ogg）" style={{ ...iBase, width: "100%", boxSizing: "border-box", fontSize: 11 }} />
        </div>
      ))}
      <button onClick={save} style={btn(saved ? C.greenBg : C.goldBg, saved ? C.greenBorder : C.goldDim, saved ? C.green : C.gold, { padding: "6px 18px", marginTop: 2 })}>{saved ? "✓ 保存しました" : "💾 BGMプリセットを保存"}</button>
    </div>
  );
}

// ── Profile Page ──────────────────────────────────────
function ProfilePage({ onClose }) {
  const [view, setView] = useState("account"); // account | scenarios | builtin | rooms | grown | achievements
  const [detailSc, setDetailSc] = useState(null); // 収録シナリオ詳細モーダル
  const [editTarget, setEditTarget] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [newName, setNewName] = useState(() => auth.currentUser?.displayName || "");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [grownChars, setGrownChars] = useState({}); // { instanceId: { charId, charName, ds, tags, enhancementsUsed, specialBond, ... } }
  const [achievements, setAchievements] = useState({}); // { [id]: { at } }
  const user = auth.currentUser;

  useEffect(()=> {
    if(!user)return;
    // RTDB の表示名を取得（無ければ Auth の displayName）。setState は非同期コールバック内のみ（effect本体では呼ばない）
    get(ref(db,`users/${user.uid}/displayName`))
      .then(snap=> setNewName(snap.exists()&&snap.val() ? snap.val() : (user.displayName||"")))
      .catch(()=> setNewName(user.displayName||""));
  },[user]);

  // 自分が建てた部屋を取得
  useEffect(()=> {
    if(!user)return;
    const r = ref(db,"rooms");
    const unsub = onValue(r,snap => {
      if(snap.exists()){
        const arr = Object.entries(snap.val())
          .filter(([, v]) => v.gmUid === user.uid)
          .map(([code, v]) => ({code,...v}));
        arr.sort((a, b) => (b.createdAt||0)-(a.createdAt||0));
        setRooms(arr);
      } else setRooms([]);
      setRoomsLoading(false);
    });
    return() => unsub();
  },[user]);

  // 自分の成長キャラ（インスタンス）を取得
  useEffect(()=> {
    if(!user)return;
    const r = ref(db,`grownChars/${user.uid}`);
    const unsub = onValue(r,snap => { setGrownChars(snap.exists() ? snap.val() : {}); });
    return() => unsub();
  },[user]);

  // 自分の実績を取得
  useEffect(()=> {
    if(!user)return;
    const r = ref(db,`users/${user.uid}/achievements`);
    const unsub = onValue(r,snap => { setAchievements(snap.exists() ? snap.val() : {}); });
    return() => unsub();
  },[user]);

  const deleteGrown = async(iid, name)=> {
    if(!confirm(`成長キャラ「${name}」を削除しますか？（元に戻せません）`))return;
    await remove(ref(db,`grownChars/${user.uid}/${iid}`));
  };

  const saveName = async()=> {
    const u = auth.currentUser; // 最新のユーザーを取得（キャプチャ済み user の失効対策）
    if(!newName.trim()||!u||nameSaving)return;
    const trimmed = newName.trim();
    setNameSaving(true);
    try {
      // RTDB に保存（確実）。updateProfile（Authプロフィール）は端末によりハング/失敗するため best-effort
      await set(ref(db,`users/${u.uid}/displayName`), trimmed);
      updateProfile(u,{displayName:trimmed}).catch(()=> {});
      setNameSaved(true);
      setTimeout(() => setNameSaved(false),2500);
    } catch(e) {
      console.error("表示名の保存に失敗", e);
      alert("表示名の保存に失敗しました。通信状況を確認して、もう一度お試しください。");
    } finally {
      setNameSaving(false); // 成功/失敗に関わらず必ず解除
    }
  };

  const saveScenario = async(sc)=> {
    const id = sc.id || push(ref(db,`users/${user.uid}/scenarios`)).key;
    await set(ref(db,`users/${user.uid}/scenarios/${id}`),{...sc,id});
    setEditTarget(null);
  };

  const deleteRoom = async(code)=> {
    if(!confirm(`部屋「${code}」を削除しますか？
（セッションデータも消去されます）`))return;
    await remove(ref(db,`rooms/${code}`));
  };

  const phaseLabel = p => ({prep:"準備中",explore:"探索中",scene:"シーン中",end:"終了"}[p]||p||"不明");
  const phaseColor = p => ({prep:C.blue,explore:C.green,scene:C.purple,end:C.textFaint}[p]||C.textFaint);

  if(editTarget) return(
    <ScenarioForm
      initial={editTarget==="new"?null:editTarget}
      onSave={saveScenario}
      onCancel={() => setEditTarget(null)}
    />
  );

  const TABS = [["account","アカウント"],["scenarios","シナリオ"],["builtin","収録シナリオ"],["rooms","部屋一覧"],["grown","成長キャラ"],["achievements","実績"]];
  const ENH_LABEL = { spell:"追加スペカ取得", ability:"能力スキル＋", bond:"特別な絆" };

  return(
    <div style={{background:BG,minHeight:"100vh",fontFamily:"'Noto Serif JP', serif",color:C.text,padding:16}}>
      <style>{`::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#1a1e2a} button:hover{opacity:0.85} input{outline:none}`}</style>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div>
          <span style={{fontSize:14,color:C.gold,letterSpacing:2}}>幻想ナラトグラフ</span>
          <span style={{fontSize:10,color:C.textDim,marginLeft:10}}>プロフィール</span>
        </div>
        <button onClick={onClose} style={btn("rgba(255,255,255,0.03)",C.border,C.textFaint,{padding:"5px 14px"})}>← ロビーに戻る</button>
      </div>

      <div style={{display:"flex",gap:6,marginBottom:20}}>
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setView(id)} style={{
            ...btn(view === id?C.goldBg:"rgba(255,255,255,0.02)",view === id?C.goldDim:C.border,view === id?C.gold:C.textFaint),
          }}>{label}</button>
        ))}
      </div>

      {/* ── アカウント ── */}
      {view==="account"&&(
        <div style={{maxWidth:480}}>
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:6,padding:16,marginBottom:12}}>
            <div style={{fontSize:12,color:C.gold,marginBottom:14}}>アカウント情報</div>

            <div style={{marginBottom:6,fontSize:9,color:C.textFaint}}>Googleアカウント</div>
            <div style={{fontSize:11,color:C.textDim,marginBottom:16,padding:"6px 8px",background:"rgba(255,255,255,0.02)",borderRadius:3,border:`1px solid ${C.border}`}}>
              {user?.email||"—"}
            </div>

            <div style={{marginBottom:6,fontSize:9,color:C.textFaint}}>セッション表示名</div>
            <div style={{display:"flex",gap:8}}>
              <input value={newName} onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && saveName()}
                style={{...iBase,flex:1,fontSize:13}}
                placeholder="表示名を入力"/>
              <button onClick={saveName} disabled={nameSaving||!newName.trim()}
                style={{...btn(nameSaved?C.greenBg:C.goldBg,nameSaved?C.greenBorder:C.goldDim,nameSaved?C.green:C.gold,{padding:"5px 16px",flexShrink:0})}}>
                {nameSaved?"✓ 保存済み":nameSaving?"保存中…":"変更する"}
              </button>
            </div>
            <div style={{fontSize:9,color:C.textFaint,marginTop:6}}>この名前はセッション中にGM・PLに表示されます</div>
          </div>

          {/* BGMプリセット（事前設定） */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:6,padding:16,marginBottom:12}}>
            <div style={{fontSize:12,color:C.gold,marginBottom:12}}>🎵 BGMプリセット（事前設定）</div>
            <BgmPresetEditor uid={user?.uid} />
          </div>
        </div>
      )}

      {/* ── シナリオ ── */}
      {view==="scenarios"&&(
        <div style={{maxWidth:700}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{fontSize:12,color:C.text}}>保存済みシナリオ</div>
            <button onClick={() => setEditTarget("new")} style={btn(C.goldBg,C.goldDim,C.gold,{padding:"6px 16px"})}>
              ＋ 新規シナリオを作成
            </button>
          </div>
          <ScenarioList onEdit={sc => setEditTarget(sc)} onSelect={null}/>
        </div>
      )}

      {/* ── 部屋一覧 ── */}
      {view==="rooms"&&(
        <div style={{maxWidth:700}}>
          <div style={{fontSize:12,color:C.text,marginBottom:12}}>自分が作成した部屋</div>
          {roomsLoading&&<div style={{fontSize:10,color:C.textFaint}}>読み込み中…</div>}
          {!roomsLoading&&rooms.length === 0&&(
            <div style={{fontSize:10,color:C.textFaint,padding:"16px 0"}}>作成した部屋はありません</div>
          )}
          {rooms.map(room => {
            const plCount = Object.values(room.players||{}).filter(p => p.role==="pl").length;
            const date = room.createdAt ? new Date(room.createdAt).toLocaleDateString("ja-JP") : "—";
            return(
              <div key={room.code} style={{
                padding:"12px 14px",marginBottom:8,
                background:C.card,border:`1px solid ${C.border}`,borderRadius:5,
              }}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                      <span style={{fontSize:13,color:C.gold,letterSpacing:2,fontFamily:"monospace"}}>{room.code}</span>
                      <Chip label={phaseLabel(room.phase)} color={phaseColor(room.phase)}/>
                      {room.scenario&&<Chip label={room.scenario} color={C.purple}/>}
                    </div>
                    <div style={{display:"flex",gap:12,fontSize:10,color:C.textDim}}>
                      <span>GM: {room.gmName||"—"}</span>
                      <span>PL: {plCount}人</span>
                      <span>作成: {date}</span>
                    </div>
                    {plCount>0&&(
                      <div style={{marginTop:5,display:"flex",gap:4,flexWrap:"wrap"}}>
                        {Object.values(room.players||{}).filter(p => p.role==="pl").map(p => (
                          <span key={p.uid} style={{fontSize:9,color:C.textFaint}}>
                            {p.name}{p.charName?` (${p.charName})`:""}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{display:"flex",gap:6,flexShrink:0,marginLeft:12}}>
                    <button onClick={() => {window.open(`${window.location.origin}?room=${room.code}`,"_blank");}}
                      style={btn(C.blueBg,C.blueBorder,C.blue,{padding:"4px 10px",fontSize:10})}>
                      開く
                    </button>
                    <button onClick={() => deleteRoom(room.code)}
                      style={btn(C.redBg,C.redBorder,C.red,{padding:"4px 10px",fontSize:10})}>
                      削除
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 成長キャラ ── */}
      {view==="grown"&&(
        <div style={{maxWidth:700}}>
          <div style={{fontSize:12,color:C.text,marginBottom:4}}>成長したキャラクター</div>
          <div style={{fontSize:9,color:C.textFaint,marginBottom:12}}>セッション終了時の成長で記録されたキャラクターです。参加時に「★成長済みキャラクター」から選択できます。</div>
          {Object.keys(grownChars).length===0&&(
            <div style={{fontSize:10,color:C.textFaint,padding:"16px 0"}}>成長したキャラクターはまだいません</div>
          )}
          {Object.entries(grownChars).sort((a,b)=>(b[1].updatedAt||b[1].createdAt||0)-(a[1].updatedAt||a[1].createdAt||0)).map(([iid,g])=>{
            const date = (g.updatedAt||g.createdAt) ? new Date(g.updatedAt||g.createdAt).toLocaleDateString("ja-JP") : "—";
            const enh = (g.enhancementsUsed||[]).map(e=>ENH_LABEL[e]||e);
            return(
              <div key={iid} style={{padding:"12px 14px",marginBottom:8,background:C.card,border:`1px solid ${C.goldDim}`,borderRadius:5}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,color:C.gold,letterSpacing:1,marginBottom:5}}>★ {g.charName} <span style={{fontSize:9,color:C.textFaint,marginLeft:6}}>更新: {date}</span></div>
                    <div style={{fontSize:10,color:C.textDim,marginBottom:2}}>弾幕スキル: {g.ds?.name||"—"}</div>
                    {(g.tags||[]).length>0&&<div style={{fontSize:10,color:C.textDim,marginBottom:2}}>獲得タグ: {(g.tags||[]).map(t=>`《${t}》`).join(" ")}</div>}
                    {enh.length>0&&<div style={{fontSize:10,color:C.textDim,marginBottom:2}}>強化: {enh.join(" / ")}</div>}
                    {g.specialBond&&<div style={{fontSize:10,color:C.gold}}>特別な絆: 《{g.specialBond.target}への{g.specialBond.word||"敬意"}》（親密度{g.specialBond.intimacy??1}/10）</div>}
                  </div>
                  <button onClick={()=>deleteGrown(iid,g.charName)} style={btn(C.redBg,C.redBorder,C.red,{padding:"4px 10px",fontSize:10,flexShrink:0,marginLeft:12})}>削除</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 実績 ── */}
      {view==="achievements"&&(()=>{
        const unlockedCount = ACHIEVEMENTS.filter(a=>achievements[a.id]).length;
        const sessionAch = ACHIEVEMENTS.filter(a=>a.type==="session");
        const lifeAch = ACHIEVEMENTS.filter(a=>a.type==="lifetime");
        const Row = ({a})=>{
          const got = !!achievements[a.id];
          const date = got&&achievements[a.id].at ? new Date(achievements[a.id].at).toLocaleDateString("ja-JP") : null;
          return (
            <div style={{display:"flex",alignItems:"flex-start",gap:10,padding:"9px 12px",marginBottom:6,background:got?(a.bad?"rgba(224,112,96,0.07)":"rgba(255,213,79,0.06)"):"rgba(255,255,255,0.015)",border:`1px solid ${got?(a.bad?C.redBorder:C.goldDim):C.border}`,borderRadius:5,opacity:got?1:0.55}}>
              <div style={{fontSize:18,flexShrink:0,filter:got?"none":"grayscale(1)"}}>{got?(a.bad?"💀":"🏅"):"🔒"}</div>
              <div style={{flex:1}}>
                <div style={{fontSize:12,color:got?(a.bad?C.red:C.gold):C.textDim}}>{a.name}{date&&<span style={{fontSize:8,color:C.textFaint,marginLeft:6}}>{date}</span>}</div>
                <div style={{fontSize:9,color:C.textFaint,marginTop:2}}>{a.desc}</div>
              </div>
            </div>
          );
        };
        return (
          <div style={{maxWidth:560}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}>
              <div style={{fontSize:12,color:C.text}}>実績</div>
              <div style={{fontSize:11,color:C.gold}}>{unlockedCount} / {ACHIEVEMENTS.length} 解除</div>
            </div>
            <div style={{height:6,background:"rgba(255,255,255,0.05)",borderRadius:3,marginBottom:14,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${Math.round(unlockedCount/ACHIEVEMENTS.length*100)}%`,background:`linear-gradient(90deg,${C.goldDim},${C.gold})`}}/>
            </div>
            <div style={{fontSize:10,color:C.textFaint,letterSpacing:2,borderBottom:`1px solid ${C.border}`,paddingBottom:3,marginBottom:8}}>セッション実績</div>
            {sessionAch.map(a=><Row key={a.id} a={a}/>)}
            <div style={{fontSize:10,color:C.textFaint,letterSpacing:2,borderBottom:`1px solid ${C.border}`,paddingBottom:3,margin:"14px 0 8px"}}>通算実績</div>
            {lifeAch.map(a=><Row key={a.id} a={a}/>)}
          </div>
        );
      })()}

      {/* ── 収録シナリオ（アプリ同梱・読み取り専用） ── */}
      {view==="builtin"&&(
        <div style={{maxWidth:640}}>
          <div style={{fontSize:12,color:C.text,marginBottom:4}}>収録シナリオ</div>
          <div style={{fontSize:9,color:C.textFaint,marginBottom:12}}>コードに収録されたシナリオです。クリックで中身（バックストーリー・クエスト・敵・特殊ルール）を確認できます。</div>
          {BUILTIN_SCENARIOS.length===0&&<div style={{fontSize:10,color:C.textFaint,padding:"16px 0"}}>収録シナリオはまだありません</div>}
          {BUILTIN_SCENARIOS.map(s=>(
            <div key={s.id} onClick={()=>setDetailSc(s)} style={{padding:"10px 12px",marginBottom:6,borderRadius:5,cursor:"pointer",background:C.card,border:`1px solid ${C.border}`}}>
              <div style={{fontSize:12,color:C.text,marginBottom:2}}>
                {s.official&&<span style={{fontSize:8,color:C.gold,border:`1px solid ${C.goldDim}`,borderRadius:3,padding:"0 4px",marginRight:5,verticalAlign:"middle"}}>公式</span>}
                {s.name}
              </div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                <Chip label={`${s.playerCountMin}〜${s.playerCountMax}人`} color={C.blue}/>
                <Chip label={s.difficulty} color={C.gold}/>
                <Chip label={`リミット: ${s.limit}`} color={C.textDim}/>
                {s.author&&<Chip label={`作: ${s.author}`} color={C.textFaint}/>}
              </div>
            </div>
          ))}
        </div>
      )}

      {detailSc && <ScenarioDetail scenario={detailSc} onClose={()=>setDetailSc(null)}/>}
    </div>
  );
}

// ── ScenarioSelector (PrepRoomで使用) ─────────────────
export function ScenarioSelector({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [scenarios, setScenarios] = useState([]);
  const [showDetail, setShowDetail] = useState(false);
  const user = auth.currentUser;

  useEffect(()=> {
    if(!user)return;
    const r = ref(db,`users/${user.uid}/scenarios`);
    const unsub = onValue(r, snap => {
      if(snap.exists()){
        const arr = Object.entries(snap.val()).map(([id, v]) => ({...v,id}));
        arr.sort((a, b) => (b.updatedAt||0)-(a.updatedAt||0));
        setScenarios(arr);
      } else setScenarios([]);
    });
    return() => unsub();
  },[user]);

  const selected = BUILTIN_SCENARIOS.find(s => s.id === value?.id) || scenarios.find(s => s.id === value?.id);
  const secHdr = { fontSize:9, color:C.textFaint, letterSpacing:1, margin:"2px 0 6px" };

  return(
    <div>
      <div style={{ display:"flex", gap:6, alignItems:"center" }}>
        <div style={{ flex:1, padding:"6px 10px", background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`,
          borderRadius:3, fontSize:11, color: selected ? C.text : C.textFaint, cursor:"pointer" }}
          onClick={() => setOpen(v => !v)}>
          {selected ? selected.name : "シナリオを選択してください"}
        </div>
        <button onClick={() => setOpen(v => !v)}
          style={btn(C.goldBg,C.goldDim,C.gold,{padding:"5px 12px",fontSize:10})}>
          {open?"閉じる":"選択"}
        </button>
      </div>

      {open&&(
        <div style={{ marginTop:6, padding:10, background:"#0a0c16", border:`1px solid ${C.border}`, borderRadius:4 }}>
          {BUILTIN_SCENARIOS.length > 0 && (
            <>
              <div style={secHdr}>収録シナリオ</div>
              <ScenarioList items={BUILTIN_SCENARIOS} selectedId={value?.id} onSelect={sc => {onChange(sc);setOpen(false);}}/>
              <div style={{ ...secHdr, marginTop:10 }}>エディターのシナリオ（自分の作成）</div>
            </>
          )}
          {scenarios.length === 0
            ? <div style={{fontSize:10,color:C.textFaint}}>保存済みシナリオがありません。プロフィールから作成してください。</div>
            : <ScenarioList selectedId={value?.id} onSelect={sc => {onChange(sc);setOpen(false);}}/>
          }
        </div>
      )}

      {selected&&(
        <div style={{ marginTop:8, padding:8, background:"rgba(200,160,64,0.06)", border:`1px solid ${C.goldDim}50`, borderRadius:4 }}>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:4 }}>
            {selected.official && <Chip label="公式" color={C.gold}/>}
            <Chip label={`${selected.playerCountMin}〜${selected.playerCountMax}人`} color={C.blue}/>
            <Chip label={selected.difficulty} color={C.gold}/>
            <Chip label={`リミット: ${selected.limit}`} color={C.textDim}/>
            {selected.author && <Chip label={`作: ${selected.author}`} color={C.textFaint}/>}
          </div>
          {selected.bannedChars?.length>0&&(
            <div style={{fontSize:9,color:C.textFaint}}>選択不可: {selected.bannedChars.join("・")}</div>
          )}
          <button onClick={() => setShowDetail(true)} style={{ marginTop:6, padding:"4px 12px", fontSize:10, cursor:"pointer", borderRadius:3, background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, color:C.textDim }}>🔍 詳細を見る</button>
        </div>
      )}
      {showDetail && selected && <ScenarioDetail scenario={selected} onClose={()=>setShowDetail(false)}/>}
    </div>
  );
}

// ── Main Export ───────────────────────────────────────
export default ProfilePage;