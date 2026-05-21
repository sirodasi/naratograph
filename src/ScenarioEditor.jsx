import { useState, useEffect, useCallback } from "react";
import { db, auth } from "./firebase";
import { ref, onValue, set, update, push, remove } from "firebase/database";
import { btn } from "./styles/colors";
import { OFFICIAL_DANMAKU_SKILLS, SPOTS } from "./data/gameData";

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
function Label({children}) {
  return <div style={{fontSize:9,color:C.textDim,marginBottom:2,marginTop:6}}>{children}</div>;
}
function Chip({label,color="#c8a040"}) {
  return <span style={{display:"inline-block",padding:"1px 7px",background:`${color}18`,border:`1px solid ${color}50`,borderRadius:10,fontSize:9,color,marginRight:4,marginBottom:2}}>{label}</span>;
}

// ── デフォルト値 ─────────────────────────────────────
const EMPTY_ENEMY = () => ({
  name: "",
  life: 2,        // 残り人数
  spellcard: 1,    // スペルカード
  attack: 5,       // 攻撃力
  ds: { type: "none", name: "", desc: "", customName: "" },
  sc1name: "", sc1effect: "",
  sc2name: "", sc2effect: "",
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
});

const EMPTY_SCENARIO = () => ({
  id: "",
  name: "",
  playerCountMin: 2,
  playerCountMax: 4,
  bannedChars: [],
  difficulty: "Normal",
  backstory: "",
  limit: "3日目の夜",
  quests: [],
  notes: "",
  startSpotType: "base",  // "base" (各PCの拠点) | "fixed" (全員同じスポット)
  startSpotId: "",        // startSpotType==="fixed" のときのスポットID
  finalBattleEnemies: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

const DIFFICULTIES = ["Easy","Normal","Hard","Lunatic"];
const SOLUTION_TYPES = ["行為判定","弾幕ごっこ","自動解決"];
const SOLUTION_COLORS = { "行為判定":C.blue, "弾幕ごっこ":C.red, "自動解決":C.green };

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
            const sc1ok = !!(en.sc1name && en.sc1effect);
            const sc1partial = !!(en.sc1name || en.sc1effect) && !sc1ok;
            const sc2ok = !!(en.sc2name && en.sc2effect);
            const sc2partial = !!(en.sc2name || en.sc2effect) && !sc2ok;
            return (
              <div style={{ padding:12, background:C.redBg, border:`1px solid ${C.redBorder}60`, borderRadius:4 }}>
                {/* 基本ステータス */}
                <div style={{ display:"grid", gridTemplateColumns:"1fr 70px 70px 70px", gap:8, marginBottom:4 }}>
                  <div>
                    <Label>エネミー名 *</Label>
                    <input style={iBase} value={en.name} onChange={e => updEnemy("name",e.target.value)} placeholder="例: 謎の妖怪"/>
                  </div>
                  <div>
                    <Label>残り人数</Label>
                    <input type="number" min="1" max="99" style={iBase} value={en.life??2} onChange={e => updEnemy("life",parseInt(e.target.value)||1)}/>
                  </div>
                  <div>
                    <Label>スペルカード</Label>
                    <input type="number" min="0" max="9" style={iBase} value={en.spellcard??1} onChange={e => updEnemy("spellcard",parseInt(e.target.value)||0)}/>
                  </div>
                  <div>
                    <Label>攻撃力</Label>
                    <input type="number" min="0" max="99" style={iBase} value={en.attack??5} onChange={e => updEnemy("attack",parseInt(e.target.value)||0)}/>
                  </div>
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
                <div style={{ marginTop:8, padding:8, background:"rgba(0,0,0,0.2)", borderRadius:4, border:`1px solid ${sc1partial?"#f9a825":C.border}` }}>
                  <div style={{ fontSize:9, color: sc1partial?"#f9a825":C.textFaint, marginBottom:4 }}>
                    スペルカード①（任意・名前と効果は両方必要）{sc1partial&&" ⚠ どちらか一方が未入力"}
                  </div>
                  <input style={{...iBase,marginBottom:4}} value={en.sc1name||""} onChange={e => updEnemy("sc1name",e.target.value)} placeholder="スペルカード名（任意）"/>
                  <textarea style={{...iBase,height:44,resize:"vertical"}} value={en.sc1effect||""} onChange={e => updEnemy("sc1effect",e.target.value)} placeholder="効果テキスト（任意）"/>
                </div>

                {/* スペルカード② */}
                <div style={{ marginTop:6, padding:8, background:"rgba(0,0,0,0.2)", borderRadius:4, border:`1px solid ${sc2partial?"#f9a825":C.border}` }}>
                  <div style={{ fontSize:9, color: sc2partial?"#f9a825":C.textFaint, marginBottom:4 }}>
                    スペルカード②（任意・名前と効果は両方必要）{sc2partial&&" ⚠ どちらか一方が未入力"}
                  </div>
                  <input style={{...iBase,marginBottom:4}} value={en.sc2name||""} onChange={e => updEnemy("sc2name",e.target.value)} placeholder="スペルカード名（任意）"/>
                  <textarea style={{...iBase,height:44,resize:"vertical"}} value={en.sc2effect||""} onChange={e => updEnemy("sc2effect",e.target.value)} placeholder="効果テキスト（任意）"/>
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
      const sc1partial = !!(en.sc1name||en.sc1effect) && !(en.sc1name&&en.sc1effect);
      const sc2partial = !!(en.sc2name||en.sc2effect) && !(en.sc2name&&en.sc2effect);
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
            {(sc.finalBattleEnemies || []).map((en, i) => {
              const sc1ok = !!(en.sc1name && en.sc1effect);
              const sc2ok = !!(en.sc2name && en.sc2effect);
              
              return (
                <div key={i} style={{ padding: 12, background: "rgba(192,57,43,0.05)", borderRadius: 5, border: `1px solid ${C.redBorder}40`, position: "relative" }}>
                  {/* ヘッダー */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: 6 }}>
                    <span style={{ fontSize: 10, color: C.red, fontWeight: "bold" }}>ENEMY #{i + 1}</span>
                    <button onClick={() => deleteFinalEnemy(i)} style={{ background: "none", border: "none", color: C.textFaint, cursor: "pointer", fontSize: 11 }}>✕ 削除</button>
                  </div>

                  {/* 基本ステータス */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 70px 70px 70px", gap: 8, marginBottom: 12 }}>
                    <div>
                      <Label>エネミー名 *</Label>
                      <input style={iBase} value={en.name} onChange={e => updateFinalEnemy(i, { ...en, name: e.target.value })} placeholder="例: 堕ちた巫女" />
                    </div>
                    <div>
                      <Label>残り人数</Label>
                      <input type="number" style={iBase} value={en.life} onChange={e => updateFinalEnemy(i, { ...en, life: parseInt(e.target.value) || 1 })} />
                    </div>
                    <div>
                      <Label>スペルカード</Label>
                      <input type="number" style={iBase} value={en.spellcard} onChange={e => updateFinalEnemy(i, { ...en, spellcard: parseInt(e.target.value) || 0 })} />
                    </div>
                    <div>
                      <Label>攻撃力</Label>
                      <input type="number" style={iBase} value={en.attack} onChange={e => updateFinalEnemy(i, { ...en, attack: parseInt(e.target.value) || 1 })} />
                    </div>
                  </div>

                  {/* 弾幕スキル設定 */}
                  <div style={{ marginBottom: 12 }}>
                    <Label>弾幕スキル</Label>
                    <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                      {["none", "official", "custom"].map(v => (
                        <button key={v} onClick={() => updateFinalEnemy(i, { ...en, ds: { ...(en.ds || {}), type: v } })}
                          style={{ ...btn((en.ds?.type || "none") === v ? "rgba(255,255,255,0.1)" : "transparent", C.border, (en.ds?.type || "none") === v ? C.gold : C.textFaint, { padding: "3px 8px", fontSize: 9 }) }}>
                          {v === "none" ? "なし" : v === "official" ? "公式" : "カスタム"}
                        </button>
                      ))}
                    </div>
                    {en.ds?.type === "official" && (
                      <select style={iBase} value={en.ds?.name || ""} onChange={e => {
                        const sk = OFFICIAL_DANMAKU_SKILLS.find(s => s.name === e.target.value);
                        updateFinalEnemy(i, { ...en, ds: { ...(en.ds || {}), name: e.target.value, desc: sk?.desc || "" } });
                      }}>
                        <option value="">スキルを選択…</option>
                        {OFFICIAL_DANMAKU_SKILLS.map(sk => <option key={sk.name} value={sk.name}>{sk.name}</option>)}
                      </select>
                    )}
                    {en.ds?.type === "custom" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <input style={iBase} value={en.ds?.customName || ""} onChange={e => updateFinalEnemy(i, { ...en, ds: { ...(en.ds || {}), customName: e.target.value } })} placeholder="スキル名" />
                        <textarea style={{ ...iBase, height: 40 }} value={en.ds?.desc || ""} onChange={e => updateFinalEnemy(i, { ...en, ds: { ...(en.ds || {}), desc: e.target.value } })} placeholder="スキル効果" />
                      </div>
                    )}
                  </div>

                  {/* スペルカード設定 */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div style={{ background: "rgba(0,0,0,0.15)", padding: 6, borderRadius: 3 }}>
                      <div style={{ fontSize: 8, color: sc1ok ? C.gold : C.textFaint, marginBottom: 4 }}>スペルカード①</div>
                      <input style={{ ...iBase, marginBottom: 4, fontSize: 10 }} value={en.sc1name} onChange={e => updateFinalEnemy(i, { ...en, sc1name: e.target.value })} placeholder="名前" />
                      <textarea style={{ ...iBase, height: 40, fontSize: 9 }} value={en.sc1effect} onChange={e => updateFinalEnemy(i, { ...en, sc1effect: e.target.value })} placeholder="効果説明" />
                    </div>
                    <div style={{ background: "rgba(0,0,0,0.15)", padding: 6, borderRadius: 3 }}>
                      <div style={{ fontSize: 8, color: sc2ok ? C.gold : C.textFaint, marginBottom: 4 }}>スペルカード②</div>
                      <input style={{ ...iBase, marginBottom: 4, fontSize: 10 }} value={en.sc2name} onChange={e => updateFinalEnemy(i, { ...en, sc2name: e.target.value })} placeholder="名前" />
                      <textarea style={{ ...iBase, height: 40, fontSize: 9 }} value={en.sc2effect} onChange={e => updateFinalEnemy(i, { ...en, sc2effect: e.target.value })} placeholder="効果説明" />
                    </div>
                  </div>
                </div>
              );
            })}

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

// ── Scenario List ─────────────────────────────────────
function ScenarioList({ onSelect, onEdit, selectedId }) {
  const [scenarios, setScenarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const user = auth.currentUser;

  useEffect(()=> {
    if(!user)return;
    const r = ref(db, `users/${user.uid}/scenarios`);
    const unsub = onValue(r, snap => {
      if(snap.exists()){
        const arr = Object.entries(snap.val()).map(([id, v]) => ({...v,id}));
        arr.sort((a, b) => (b.updatedAt||0)-(a.updatedAt||0));
        setScenarios(arr);
      } else {
        setScenarios([]);
      }
      setLoading(false);
    });
    return() => unsub();
  },[user]);

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
              <div style={{ fontSize:12, color: selectedId === sc.id ? C.gold : C.text, marginBottom:2 }}>{sc.name}</div>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                <Chip label={`${sc.playerCountMin}〜${sc.playerCountMax}人`} color={C.blue}/>
                <Chip label={sc.difficulty} color={diffColor[sc.difficulty]||C.text}/>
                <Chip label={`リミット: ${sc.limit}`} color={C.textDim}/>
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

// ── Profile Page ──────────────────────────────────────
function ProfilePage({ onClose }) {
  const [view, setView] = useState("account"); // account | scenarios | rooms
  const [editTarget, setEditTarget] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const user = auth.currentUser;

  useEffect(()=> {
    setNewName(user?.displayName||"");
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

  const saveName = async()=> {
    if(!newName.trim())return;
    setNameSaving(true);
    await updateProfile(user,{displayName:newName.trim()}).catch(()=> {});
    setNameSaving(false);
    setNameSaved(true);
    setTimeout(() => setNameSaved(false),2500);
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

  const TABS = [["account","アカウント"],["scenarios","シナリオ"],["rooms","部屋一覧"]];

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
            const playerCount = Object.keys(room.players||{}).length;
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
    </div>
  );
}

// ── ScenarioSelector (PrepRoomで使用) ─────────────────
export function ScenarioSelector({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [scenarios, setScenarios] = useState([]);
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

  const selected = scenarios.find(s => s.id === value?.id);

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
          {scenarios.length === 0
            ? <div style={{fontSize:10,color:C.textFaint}}>保存済みシナリオがありません。プロフィールから作成してください。</div>
            : <ScenarioList selectedId={value?.id} onSelect={sc => {onChange(sc);setOpen(false);}}/>
          }
        </div>
      )}

      {selected&&(
        <div style={{ marginTop:8, padding:8, background:"rgba(200,160,64,0.06)", border:`1px solid ${C.goldDim}50`, borderRadius:4 }}>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:4 }}>
            <Chip label={`${selected.playerCountMin}〜${selected.playerCountMax}人`} color={C.blue}/>
            <Chip label={selected.difficulty} color={C.gold}/>
            <Chip label={`リミット: ${selected.limit}`} color={C.textDim}/>
          </div>
          {selected.bannedChars?.length>0&&(
            <div style={{fontSize:9,color:C.textFaint}}>選択不可: {selected.bannedChars.join("・")}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Export ───────────────────────────────────────
export default ProfilePage;