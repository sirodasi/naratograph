// ScenarioEditor.jsx - シナリオ管理・編集
import { useState, useEffect, useCallback } from "react";
import { db, auth } from "./firebase";
import { ref, onValue, set, update, push, remove } from "firebase/database";

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
const taBase = { ...iBase, resize:"vertical", fontFamily:"serif" };
const btn = (bg,border,color,extra={}) => ({
  cursor:"pointer", borderRadius:4, fontSize:11, letterSpacing:1,
  padding:"6px 14px", transition:"opacity 0.15s", background:bg,
  border:`1px solid ${border}`, color, ...extra,
});
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
// 公式弾幕スキル一覧
const OFFICIAL_DANMAKU_SKILLS = [
  { name:"ホーミング",  desc:"ショットステップでダイスを振った直後に使用。そのショットステップで振ったダイスの出目1つを任意の出目に変更する。" },
  { name:"ワイドショット", desc:"ショットステップでダイスを振った直後に使用。回避側の弾幕フィールド上の【弾幕】が配置されていない任意マスを1つ以上選ぶ。それらのマスに、それぞれ同じ弾幕フィールド上の任意の【弾幕】を1つ置き直す。" },
  { name:"弾消し",    desc:"対戦者のラウンド中の任意のタイミングに使用。その弾幕ごっこの対戦者・または観戦者であるキャラクター1人の弾幕フィールド上に配置されている【弾幕】を1つ選び取り除く。" },
  { name:"不死身",    desc:"【残り人数】を減少させる処理を受けるときに使用。【霊力】を「10点」消費して、その処理を打ち消す。" },
  { name:"大威力",    desc:"ダイスを振るショットステップ直後に使用。そのショットステップで振ったダイスに同じ出目が2つ以上あった場合、そうした出目から1つを選んで、その出目に対応するマスに【弾幕】を1つ追加で配置する。" },
  { name:"近接攻撃",  desc:"対戦者のラウンドのショットステップでダイスを振る直前に使用。あなたがいるマスと同じ番号のマスに回避側がいる場合、そのマスに【弾幕】を1つ追加で配置する。" },
  { name:"低速弾",    desc:"対戦者のラウンド終了時に使用。そのラウンド終了時に取り除かれる【弾幕】を1つ選ぶ。その【弾幕】は取り除かれない。" },
  { name:"壁抜け",    desc:"対戦者のラウンドの回避ステップ中に使用。1番マスと3番マス、4番マスと6番マスはそれぞれ相互に隣接しているものとして扱う。" },
  { name:"高速移動",  desc:"対戦者のラウンド中、【弾幕】が配置されていないマスにいるときに使用。任意のマスに移動する。" },
  { name:"弾貨",      desc:"【グレイズ】を「4点」消費して【スペルカード】を1点獲得することができる。" },
  { name:"使い魔",    desc:"ショットステップで振るダイスの数は「1」減少する。自身が対戦者であるラウンド中、観戦者として「援護射撃」「かばう」のいずれかを行うことができる。" },
  { name:"想起",      desc:"（特定キャラ専用）決戦フェイズの任意のタイミングで1度だけ使用。そのフェイズに登場するキャラクター1人の弾幕スキルを1つ選ぶ。このシーンの間、その弾幕スキルを修得する。" },
  { name:"憑依",      desc:"（依神女苑・紫苑専用）対戦者のラウンド中、観戦者に依神女苑or紫苑がいる場合、観戦者の習得しているスペルカードを自身のスペルカードとして宣言できる。" },
];

const EMPTY_ENEMY = () => ({
  name: "",
  ninzu: 2,        // 残り人数
  spellcard: 1,    // スペルカード
  attack: 5,       // 攻撃力
  danmakuSkillType: "none",   // "none" | "official" | "custom"
  danmakuSkillName: "",       // official選択時
  danmakuSkillDesc: "",       // custom入力時
  danmakuSkillCustomName: "", // custom入力時
  sc1name: "", sc1effect: "",
  sc2name: "", sc2effect: "",
});

const EMPTY_QUEST = () => ({
  id: Date.now() + Math.random(),
  name: "",
  summary: "",
  level: 1,
  unlockCondition: "",
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
  difficulty: "標準",
  backstory: "",
  limit: "3日目の夜",
  quests: [],
  notes: "",
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

const DIFFICULTIES = ["易しい","標準","難しい","激難"];
const SOLUTION_TYPES = ["行為判定","弾幕ごっこ","自動解決"];
const SOLUTION_COLORS = { "行為判定":C.blue, "弾幕ごっこ":C.red, "自動解決":C.green };

// ── Quest Editor ─────────────────────────────────────
function QuestEditor({ quest, onChange, onDelete, index }) {
  const [open, setOpen] = useState(false);
  const upd = (key, val) => onChange({ ...quest, [key]: val });
  const updEnemy = (key, val) => onChange({ ...quest, enemy: { ...quest.enemy, [key]: val } });
  const solColor = SOLUTION_COLORS[quest.solutionType] || C.text;

  return (
    <div style={{ border:`1px solid ${open?solColor+"60":C.border}`, borderRadius:5, marginBottom:6, overflow:"hidden" }}>
      {/* Header row */}
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 10px", cursor:"pointer",
        background: open ? `${solColor}08` : "rgba(255,255,255,0.02)" }}
        onClick={()=>setOpen(v=>!v)}>
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
        <Chip label={quest.solutionType} color={solColor} />
        <button onClick={e=>{e.stopPropagation();onDelete();}}
          style={{ ...btn(C.redBg,C.redBorder,C.red,{padding:"2px 8px",fontSize:10}) }}>✕</button>
        <span style={{ color:C.textFaint, fontSize:12 }}>{open?"▲":"▼"}</span>
      </div>

      {open && (
        <div style={{ padding:"10px 12px", borderTop:`1px solid ${C.border}` }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            <div>
              <Label>クエスト名 *</Label>
              <input style={iBase} value={quest.name} onChange={e=>upd("name",e.target.value)} placeholder="クエスト名"/>
            </div>
            <div>
              <Label>レベル</Label>
              <input type="number" min="1" max="9" style={{...iBase,width:60}} value={quest.level} onChange={e=>upd("level",parseInt(e.target.value)||1)}/>
            </div>
          </div>

          <Label>概要（PL公開）</Label>
          <textarea style={{...taBase,height:52}} value={quest.summary} onChange={e=>upd("summary",e.target.value)} placeholder="PLに見せるクエストの概要"/>

          <Label>公開条件</Label>
          <input style={iBase} value={quest.unlockCondition} onChange={e=>upd("unlockCondition",e.target.value)} placeholder="例: セッション開始時 / 特定の手がかり取得後"/>

          <Label>クエストの真相（GM専用）</Label>
          <textarea style={{...taBase,height:52}} value={quest.truth} onChange={e=>upd("truth",e.target.value)} placeholder="真相・GM向けメモ"/>

          <SecTitle>解決方法</SecTitle>
          <div style={{ display:"flex", gap:6, marginBottom:10 }}>
            {SOLUTION_TYPES.map(t=>(
              <button key={t} onClick={()=>upd("solutionType",t)}
                style={{ ...btn(
                  quest.solutionType===t ? `${SOLUTION_COLORS[t]}20` : "rgba(255,255,255,0.02)",
                  quest.solutionType===t ? SOLUTION_COLORS[t] : C.border,
                  quest.solutionType===t ? SOLUTION_COLORS[t] : C.textFaint,
                  { padding:"5px 12px", fontWeight: quest.solutionType===t?"bold":"normal" }
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
                  <input style={iBase} value={quest.specifiedTag} onChange={e=>upd("specifiedTag",e.target.value)} placeholder="例: 妖怪・巫女"/>
                </div>
                <div>
                  <Label>解決場所（スポットID）</Label>
                  <input style={iBase} value={quest.location} onChange={e=>upd("location",e.target.value)} placeholder="例: 11"/>
                </div>
              </div>
            </div>
          )}

          {/* 弾幕ごっこ */}
          {quest.solutionType==="弾幕ごっこ" && (()=>{
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
                    <input style={iBase} value={en.name} onChange={e=>updEnemy("name",e.target.value)} placeholder="例: 謎の妖怪"/>
                  </div>
                  <div>
                    <Label>残り人数</Label>
                    <input type="number" min="1" max="99" style={iBase} value={en.ninzu??2} onChange={e=>updEnemy("ninzu",parseInt(e.target.value)||1)}/>
                  </div>
                  <div>
                    <Label>スペルカード</Label>
                    <input type="number" min="0" max="9" style={iBase} value={en.spellcard??1} onChange={e=>updEnemy("spellcard",parseInt(e.target.value)||0)}/>
                  </div>
                  <div>
                    <Label>攻撃力</Label>
                    <input type="number" min="0" max="99" style={iBase} value={en.attack??5} onChange={e=>updEnemy("attack",parseInt(e.target.value)||0)}/>
                  </div>
                </div>

                {/* 弾幕スキル */}
                <Label>弾幕スキル（任意）</Label>
                <div style={{ display:"flex", gap:6, marginBottom:6 }}>
                  {[["none","なし"],["official","公式から選択"],["custom","カスタム"]].map(([v,label])=>(
                    <button key={v} onClick={()=>updEnemy("danmakuSkillType",v)}
                      style={{ ...btn(
                        en.danmakuSkillType===v?"rgba(200,160,64,0.2)":"rgba(255,255,255,0.02)",
                        en.danmakuSkillType===v?C.goldDim:C.border,
                        en.danmakuSkillType===v?C.gold:C.textFaint,
                        {padding:"4px 10px",fontSize:10}
                      )}}>
                      {label}
                    </button>
                  ))}
                </div>
                {en.danmakuSkillType==="official" && (
                  <div style={{ marginBottom:8 }}>
                    <select style={iBase} value={en.danmakuSkillName}
                      onChange={e=>{
                        const sk=OFFICIAL_DANMAKU_SKILLS.find(s=>s.name===e.target.value);
                        updEnemy("danmakuSkillName",e.target.value);
                        updEnemy("danmakuSkillDesc",sk?.desc||"");
                      }}>
                      <option value="">スキルを選択…</option>
                      {OFFICIAL_DANMAKU_SKILLS.map(sk=><option key={sk.name} value={sk.name}>{sk.name}</option>)}
                    </select>
                    {en.danmakuSkillName && (
                      <div style={{ marginTop:5, padding:"5px 8px", background:"rgba(255,255,255,0.03)", borderRadius:3, fontSize:9, color:C.textDim, lineHeight:1.6 }}>
                        ※公式スキルのため弾幕ごっこ中に自動で処理されます<br/>{en.danmakuSkillDesc}
                      </div>
                    )}
                  </div>
                )}
                {en.danmakuSkillType==="custom" && (
                  <div style={{ marginBottom:8 }}>
                    <Label>スキル名</Label>
                    <input style={{...iBase,marginBottom:4}} value={en.danmakuSkillCustomName||""} onChange={e=>updEnemy("danmakuSkillCustomName",e.target.value)} placeholder="スキル名"/>
                    <Label>効果テキスト</Label>
                    <textarea style={{...iBase,height:52,resize:"vertical"}} value={en.danmakuSkillDesc||""} onChange={e=>updEnemy("danmakuSkillDesc",e.target.value)} placeholder="効果の説明"/>
                    <div style={{ fontSize:9, color:"#f9a825", marginTop:3 }}>※カスタムスキルのため弾幕ごっこ中に手動で処理してください</div>
                  </div>
                )}

                {/* スペルカード① */}
                <div style={{ marginTop:8, padding:8, background:"rgba(0,0,0,0.2)", borderRadius:4, border:`1px solid ${sc1partial?"#f9a825":C.border}` }}>
                  <div style={{ fontSize:9, color: sc1partial?"#f9a825":C.textFaint, marginBottom:4 }}>
                    スペルカード①（任意・名前と効果は両方必要）{sc1partial&&" ⚠ どちらか一方が未入力"}
                  </div>
                  <input style={{...iBase,marginBottom:4}} value={en.sc1name||""} onChange={e=>updEnemy("sc1name",e.target.value)} placeholder="スペルカード名（任意）"/>
                  <textarea style={{...iBase,height:44,resize:"vertical"}} value={en.sc1effect||""} onChange={e=>updEnemy("sc1effect",e.target.value)} placeholder="効果テキスト（任意）"/>
                </div>

                {/* スペルカード② */}
                <div style={{ marginTop:6, padding:8, background:"rgba(0,0,0,0.2)", borderRadius:4, border:`1px solid ${sc2partial?"#f9a825":C.border}` }}>
                  <div style={{ fontSize:9, color: sc2partial?"#f9a825":C.textFaint, marginBottom:4 }}>
                    スペルカード②（任意・名前と効果は両方必要）{sc2partial&&" ⚠ どちらか一方が未入力"}
                  </div>
                  <input style={{...iBase,marginBottom:4}} value={en.sc2name||""} onChange={e=>updEnemy("sc2name",e.target.value)} placeholder="スペルカード名（任意）"/>
                  <textarea style={{...iBase,height:44,resize:"vertical"}} value={en.sc2effect||""} onChange={e=>updEnemy("sc2effect",e.target.value)} placeholder="効果テキスト（任意）"/>
                </div>

                {/* 解決場所 */}
                <div style={{ marginTop:8 }}>
                  <Label>解決場所（スポットID）</Label>
                  <input style={{...iBase,width:80}} value={quest.location} onChange={e=>upd("location",e.target.value)} placeholder="例: 11"/>
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
  const upd = (k,v) => setSc(p=>({...p,[k]:v}));

  const addQuest = () => setSc(p=>({...p, quests:[...(p.quests||[]), EMPTY_QUEST()]}));
  const updateQuest = (i,q) => setSc(p=>({...p, quests:p.quests.map((x,j)=>j===i?q:x)}));
  const deleteQuest = (i) => setSc(p=>({...p, quests:p.quests.filter((_,j)=>j!==i)}));
  const moveQuest = (i,dir) => setSc(p=>{
    const qs=[...(p.quests||[])];
    const j=i+dir;
    if(j<0||j>=qs.length)return p;
    [qs[i],qs[j]]=[qs[j],qs[i]];
    return {...p,quests:qs};
  });

  const handleSave = async () => {
    if(!sc.name.trim()){alert("シナリオ名を入力してください");return;}
    // スペルカードの片方未入力チェック
    const badQuests = (sc.quests||[]).filter(q=>{
      const en = q.enemy;
      if(q.solutionType!=="弾幕ごっこ"||!en) return false;
      const sc1partial = !!(en.sc1name||en.sc1effect) && !(en.sc1name&&en.sc1effect);
      const sc2partial = !!(en.sc2name||en.sc2effect) && !(en.sc2name&&en.sc2effect);
      return sc1partial||sc2partial;
    });
    if(badQuests.length>0){
      alert(`クエスト「${badQuests.map(q=>q.name||"(名前なし)").join("・")}」のスペルカードで名前と効果のどちらか一方が未入力です。`);
      return;
    }
    setSaving(true);
    await onSave({...sc, updatedAt:Date.now()});
    setSaving(false);
  };

  return (
    <div style={{ background:BG, minHeight:"100vh", fontFamily:"serif", color:C.text, padding:16 }}>
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
            <input style={iBase} value={sc.name} onChange={e=>upd("name",e.target.value)} placeholder="シナリオタイトル"/>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              <div>
                <Label>最小人数</Label>
                <input type="number" min="1" max="8" style={iBase} value={sc.playerCountMin}
                  onChange={e=>upd("playerCountMin",parseInt(e.target.value)||1)}/>
              </div>
              <div>
                <Label>最大人数</Label>
                <input type="number" min="1" max="8" style={iBase} value={sc.playerCountMax}
                  onChange={e=>upd("playerCountMax",parseInt(e.target.value)||4)}/>
              </div>
            </div>
            <Label>難易度</Label>
            <select style={iBase} value={sc.difficulty} onChange={e=>upd("difficulty",e.target.value)}>
              {DIFFICULTIES.map(d=><option key={d} value={d}>{d}</option>)}
            </select>
            <Label>リミット</Label>
            <input style={iBase} value={sc.limit} onChange={e=>upd("limit",e.target.value)} placeholder="例: 3日目の夜"/>
          </div>

          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:6, padding:14, marginBottom:12 }}>
            <SecTitle>選択不可キャラクター</SecTitle>
            <div style={{ fontSize:9, color:C.textFaint, marginBottom:6 }}>キャラ名をカンマ区切りで入力</div>
            <textarea style={{...taBase,height:60}} value={(sc.bannedChars||[]).join(",")}
              onChange={e=>upd("bannedChars",e.target.value.split(",").map(s=>s.trim()).filter(Boolean))}
              placeholder="例: 博麗霊夢,霧雨魔理沙"/>
            {(sc.bannedChars||[]).length>0 && (
              <div style={{marginTop:6}}>{sc.bannedChars.map(c=><Chip key={c} label={c} color={C.red}/>)}</div>
            )}
          </div>

          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:6, padding:14 }}>
            <SecTitle>バックストーリー</SecTitle>
            <textarea style={{...taBase,height:160}} value={sc.backstory}
              onChange={e=>upd("backstory",e.target.value)}
              placeholder="セッション開始時に表示されるバックストーリー。クリックで探索フェイズへ進む画面に使用されます。"/>
            <SecTitle>GMメモ</SecTitle>
            <textarea style={{...taBase,height:80}} value={sc.notes||""}
              onChange={e=>upd("notes",e.target.value)}
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

            {(sc.quests||[]).length===0 && (
              <div style={{ fontSize:10, color:C.textFaint, textAlign:"center", padding:"20px 0" }}>
                クエストがありません。「＋ クエストを追加」で追加してください。
              </div>
            )}
            {(sc.quests||[]).map((q,i)=>(
              <div key={q.id||i} style={{ position:"relative" }}>
                <div style={{ position:"absolute", left:-28, top:8, display:"flex", flexDirection:"column", gap:2 }}>
                  <button onClick={()=>moveQuest(i,-1)} style={{ ...btn("rgba(255,255,255,0.03)",C.border,C.textFaint,{width:20,height:20,padding:0,fontSize:10}) }}>↑</button>
                  <button onClick={()=>moveQuest(i,1)} style={{ ...btn("rgba(255,255,255,0.03)",C.border,C.textFaint,{width:20,height:20,padding:0,fontSize:10}) }}>↓</button>
                </div>
                <QuestEditor quest={q} index={i} onChange={nq=>updateQuest(i,nq)} onDelete={()=>deleteQuest(i)}/>
              </div>
            ))}
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

  useEffect(()=>{
    if(!user)return;
    const r = ref(db, `users/${user.uid}/scenarios`);
    const unsub = onValue(r, snap=>{
      if(snap.exists()){
        const arr = Object.entries(snap.val()).map(([id,v])=>({...v,id}));
        arr.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
        setScenarios(arr);
      } else {
        setScenarios([]);
      }
      setLoading(false);
    });
    return()=>unsub();
  },[user]);

  const diffColor = { "易しい":C.green, "標準":C.blue, "難しい":C.gold, "激難":C.red };

  if(loading) return <div style={{fontSize:10,color:C.textFaint}}>読み込み中…</div>;

  return(
    <div>
      {scenarios.length===0&&<div style={{fontSize:10,color:C.textFaint}}>保存済みシナリオはありません</div>}
      {scenarios.map(sc=>(
        <div key={sc.id} onClick={()=>onSelect&&onSelect(sc)}
          style={{ padding:"10px 12px", marginBottom:6, borderRadius:5, cursor:onSelect?"pointer":"default",
            background: selectedId===sc.id ? C.goldBg : C.card,
            border:`1px solid ${selectedId===sc.id ? C.goldDim : C.border}`,
          }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:12, color: selectedId===sc.id ? C.gold : C.text, marginBottom:2 }}>{sc.name}</div>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                <Chip label={`${sc.playerCountMin}〜${sc.playerCountMax}人`} color={C.blue}/>
                <Chip label={sc.difficulty} color={diffColor[sc.difficulty]||C.text}/>
                <Chip label={`クエスト${(sc.quests||[]).length}個`} color={C.purple}/>
                <Chip label={`リミット: ${sc.limit}`} color={C.textDim}/>
              </div>
            </div>
            {onEdit && (
              <button onClick={e=>{e.stopPropagation();onEdit(sc);}}
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

  useEffect(()=>{
    setNewName(user?.displayName||"");
  },[user]);

  // 自分が建てた部屋を取得
  useEffect(()=>{
    if(!user)return;
    const r = ref(db,"rooms");
    const unsub = onValue(r,snap=>{
      if(snap.exists()){
        const arr = Object.entries(snap.val())
          .filter(([,v])=>v.gmUid===user.uid)
          .map(([code,v])=>({code,...v}));
        arr.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
        setRooms(arr);
      } else setRooms([]);
      setRoomsLoading(false);
    });
    return()=>unsub();
  },[user]);

  const saveName = async()=>{
    if(!newName.trim())return;
    setNameSaving(true);
    await updateProfile(user,{displayName:newName.trim()}).catch(()=>{});
    setNameSaving(false);
    setNameSaved(true);
    setTimeout(()=>setNameSaved(false),2500);
  };

  const saveScenario = async(sc)=>{
    const id = sc.id || push(ref(db,`users/${user.uid}/scenarios`)).key;
    await set(ref(db,`users/${user.uid}/scenarios/${id}`),{...sc,id});
    setEditTarget(null);
  };

  const deleteRoom = async(code)=>{
    if(!confirm(`部屋「${code}」を削除しますか？
（セッションデータも消去されます）`))return;
    await remove(ref(db,`rooms/${code}`));
  };

  const phaseLabel = p=>({prep:"準備中",explore:"探索中",scene:"シーン中",end:"終了"}[p]||p||"不明");
  const phaseColor = p=>({prep:C.blue,explore:C.green,scene:C.purple,end:C.textFaint}[p]||C.textFaint);

  if(editTarget) return(
    <ScenarioForm
      initial={editTarget==="new"?null:editTarget}
      onSave={saveScenario}
      onCancel={()=>setEditTarget(null)}
    />
  );

  const TABS = [["account","アカウント"],["scenarios","シナリオ"],["rooms","部屋一覧"]];

  return(
    <div style={{background:BG,minHeight:"100vh",fontFamily:"serif",color:C.text,padding:16}}>
      <style>{`::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#1a1e2a} button:hover{opacity:0.85} input{outline:none}`}</style>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div>
          <span style={{fontSize:14,color:C.gold,letterSpacing:2}}>幻想ナラトグラフ</span>
          <span style={{fontSize:10,color:C.textDim,marginLeft:10}}>プロフィール</span>
        </div>
        <button onClick={onClose} style={btn("rgba(255,255,255,0.03)",C.border,C.textFaint,{padding:"5px 14px"})}>← ロビーに戻る</button>
      </div>

      <div style={{display:"flex",gap:6,marginBottom:20}}>
        {TABS.map(([id,label])=>(
          <button key={id} onClick={()=>setView(id)} style={{
            ...btn(view===id?C.goldBg:"rgba(255,255,255,0.02)",view===id?C.goldDim:C.border,view===id?C.gold:C.textFaint),
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
              <input value={newName} onChange={e=>setNewName(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&saveName()}
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
            <button onClick={()=>setEditTarget("new")} style={btn(C.goldBg,C.goldDim,C.gold,{padding:"6px 16px"})}>
              ＋ 新規シナリオを作成
            </button>
          </div>
          <ScenarioList onEdit={sc=>setEditTarget(sc)} onSelect={null}/>
        </div>
      )}

      {/* ── 部屋一覧 ── */}
      {view==="rooms"&&(
        <div style={{maxWidth:700}}>
          <div style={{fontSize:12,color:C.text,marginBottom:12}}>自分が作成した部屋</div>
          {roomsLoading&&<div style={{fontSize:10,color:C.textFaint}}>読み込み中…</div>}
          {!roomsLoading&&rooms.length===0&&(
            <div style={{fontSize:10,color:C.textFaint,padding:"16px 0"}}>作成した部屋はありません</div>
          )}
          {rooms.map(room=>{
            const playerCount = Object.keys(room.players||{}).length;
            const plCount = Object.values(room.players||{}).filter(p=>p.role==="pl").length;
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
                        {Object.values(room.players||{}).filter(p=>p.role==="pl").map(p=>(
                          <span key={p.uid} style={{fontSize:9,color:C.textFaint}}>
                            {p.name}{p.charName?` (${p.charName})`:""}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{display:"flex",gap:6,flexShrink:0,marginLeft:12}}>
                    <button onClick={()=>{window.open(`${window.location.origin}?room=${room.code}`,"_blank");}}
                      style={btn(C.blueBg,C.blueBorder,C.blue,{padding:"4px 10px",fontSize:10})}>
                      開く
                    </button>
                    <button onClick={()=>deleteRoom(room.code)}
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

  useEffect(()=>{
    if(!user)return;
    const r = ref(db,`users/${user.uid}/scenarios`);
    const unsub = onValue(r, snap=>{
      if(snap.exists()){
        const arr = Object.entries(snap.val()).map(([id,v])=>({...v,id}));
        arr.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
        setScenarios(arr);
      } else setScenarios([]);
    });
    return()=>unsub();
  },[user]);

  const selected = scenarios.find(s=>s.id===value?.id);

  return(
    <div>
      <div style={{ display:"flex", gap:6, alignItems:"center" }}>
        <div style={{ flex:1, padding:"6px 10px", background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`,
          borderRadius:3, fontSize:11, color: selected ? C.text : C.textFaint, cursor:"pointer" }}
          onClick={()=>setOpen(v=>!v)}>
          {selected ? selected.name : "シナリオを選択してください"}
        </div>
        <button onClick={()=>setOpen(v=>!v)}
          style={btn(C.goldBg,C.goldDim,C.gold,{padding:"5px 12px",fontSize:10})}>
          {open?"閉じる":"選択"}
        </button>
      </div>

      {open&&(
        <div style={{ marginTop:6, padding:10, background:"#0a0c16", border:`1px solid ${C.border}`, borderRadius:4 }}>
          {scenarios.length===0
            ? <div style={{fontSize:10,color:C.textFaint}}>保存済みシナリオがありません。プロフィールから作成してください。</div>
            : <ScenarioList selectedId={value?.id} onSelect={sc=>{onChange(sc);setOpen(false);}}/>
          }
        </div>
      )}

      {selected&&(
        <div style={{ marginTop:8, padding:8, background:"rgba(200,160,64,0.06)", border:`1px solid ${C.goldDim}50`, borderRadius:4 }}>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:4 }}>
            <Chip label={`${selected.playerCountMin}〜${selected.playerCountMax}人`} color={C.blue}/>
            <Chip label={selected.difficulty} color={C.gold}/>
            <Chip label={`クエスト${(selected.quests||[]).length}個`} color={C.purple}/>
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
