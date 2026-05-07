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
const EMPTY_QUEST = () => ({
  id: Date.now() + Math.random(),
  name: "",
  summary: "",
  level: 1,
  unlockCondition: "",
  solutionType: "行為判定",  // 行為判定 | 弾幕ごっこ | 自動解決
  specifiedTag: "",
  location: "",
  truth: "",
  // 弾幕ごっこ用
  enemy: { name:"", hp:2, spell:1, attack:5, specials:["",""] },
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
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

const DIFFICULTIES = ["Easy","Normal","Hard","Lunatic"];
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
          <input style={iBase} value={quest.unlockCondition} onChange={e=>upd("unlockCondition",e.target.value)} placeholder="例: 探索フェイズ開始時 / クエスト「〇〇」を解決"/>

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
          {quest.solutionType==="弾幕ごっこ" && (
            <div style={{ padding:10, background:C.redBg, border:`1px solid ${C.redBorder}60`, borderRadius:4 }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 60px 60px", gap:8, marginBottom:8 }}>
                <div>
                  <Label>名前</Label>
                  <input style={iBase} value={quest.enemy?.name||""} onChange={e=>updEnemy("name",e.target.value)} placeholder="例: ルーミア"/>
                </div>
                <div>
                  <Label>残り人数</Label>
                  <input type="number" min="1" style={iBase} value={quest.enemy?.hp||2} onChange={e=>updEnemy("hp",parseInt(e.target.value)||1)}/>
                </div>
                <div>
                  <Label>スペルカード</Label>
                  <input type="number" min="0" style={iBase} value={quest.enemy?.spell||1} onChange={e=>updEnemy("spell",parseInt(e.target.value)||0)}/>
                </div>
                <div>
                  <Label>攻撃力</Label>
                  <input type="number" min="1" style={iBase} value={quest.enemy?.attack||5} onChange={e=>updEnemy("attack",parseInt(e.target.value)||1)}/>
                </div>
              </div>
              <Label>スペルカード①</Label>
              <input style={{...iBase,marginBottom:6}} value={quest.enemy?.specials?.[0]||""} onChange={e=>updEnemy("specials",[e.target.value,quest.enemy?.specials?.[1]||""])} placeholder="スペルカードの効果"/>
              <Label>スペルカード②</Label>
              <input style={iBase} value={quest.enemy?.specials?.[1]||""} onChange={e=>updEnemy("specials",[quest.enemy?.specials?.[0]||"",e.target.value])} placeholder="スペルカードの効果（任意）"/>
              <div style={{ marginTop:8 }}>
                <Label>解決場所（スポットID）</Label>
                <input style={{...iBase,width:80}} value={quest.location} onChange={e=>upd("location",e.target.value)} placeholder="例: 11"/>
              </div>
            </div>
          )}

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

  const diffColor = { "Easy":C.green, "Normal":C.blue, "Hard":C.gold, "Lunatic":C.purple };

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
  const [view, setView] = useState("scenarios"); // scenarios | chars
  const [editTarget, setEditTarget] = useState(null); // null | "new" | scenario object
  const user = auth.currentUser;

  const saveScenario = async (sc) => {
    const isNew = !sc.id;
    const id = sc.id || push(ref(db,`users/${user.uid}/scenarios`)).key;
    await set(ref(db,`users/${user.uid}/scenarios/${id}`), {...sc, id});
    setEditTarget(null);
  };

  const deleteScenario = async (sc) => {
    if(!confirm(`「${sc.name}」を削除しますか？`))return;
    await remove(ref(db,`users/${user.uid}/scenarios/${sc.id}`));
  };

  if(editTarget) return (
    <ScenarioForm
      initial={editTarget==="new" ? null : editTarget}
      onSave={saveScenario}
      onCancel={()=>setEditTarget(null)}
    />
  );

  return(
    <div style={{ background:BG, minHeight:"100vh", fontFamily:"serif", color:C.text, padding:16 }}>
      <style>{`::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#1a1e2a} button:hover{opacity:0.85}`}</style>

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
        <div>
          <span style={{ fontSize:14, color:C.gold, letterSpacing:2 }}>幻想ナラトグラフ</span>
          <span style={{ fontSize:10, color:C.textDim, marginLeft:10 }}>プロフィール</span>
        </div>
        <button onClick={onClose} style={btn("rgba(255,255,255,0.03)",C.border,C.textFaint,{padding:"5px 14px"})}>← ロビーに戻る</button>
      </div>

      <div style={{ display:"flex", gap:6, marginBottom:16 }}>
        {[["scenarios","シナリオ管理"],["chars","キャラクター成長"]].map(([id,label])=>(
          <button key={id} onClick={()=>setView(id)} style={{
            ...btn(view===id?C.goldBg:"rgba(255,255,255,0.02)",view===id?C.goldDim:C.border,view===id?C.gold:C.textFaint),
          }}>{label}</button>
        ))}
      </div>

      {view==="scenarios"&&(
        <div style={{ maxWidth:700 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <div style={{ fontSize:12, color:C.text }}>保存済みシナリオ</div>
            <button onClick={()=>setEditTarget("new")} style={btn(C.goldBg,C.goldDim,C.gold,{padding:"6px 16px"})}>
              ＋ 新規シナリオを作成
            </button>
          </div>
          <ScenarioList
            onEdit={sc=>setEditTarget(sc)}
            onSelect={null}
          />
        </div>
      )}

      {view==="chars"&&(
        <div style={{ maxWidth:700 }}>
          <div style={{ fontSize:10, color:C.textFaint, padding:"20px 0" }}>
            （成長キャラクター管理は今後実装予定）
          </div>
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
