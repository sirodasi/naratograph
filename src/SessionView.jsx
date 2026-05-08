// SessionView.jsx  統合セッション画面（GM/PL共通）
import { useState, useEffect, useRef, useCallback } from "react";
import { CharSprite, PERSONALITY_SKILLS } from "./Lobby";

// ── 定数（App.jsx から props で受け取る) ───────────────
// MAP_SRC, SPOTS, AREA_COLORS, useMapBounds は App.jsx からインポート
// アイテムデータ
export const ITEM_DATA = {
  "お酒":         { canUse: (pc) => (pc.items?.["お酒"]||0) > 0,
                    use: (pc) => { const r={...pc.resources}; r.やる気={cur:Math.min((r.やる気?.cur||0)+1,r.やる気?.max||3),max:r.やる気?.max||3}; return {...pc,items:{...pc.items,"お酒":pc.items["お酒"]-1},resources:r}; },
                    desc:"自身の【やる気】が「1点」回復します。", timing:"いつでも" },
  "小銭":         { canUse: (pc) => (pc.items?.["小銭"]||0) > 0,
                    use: (pc) => ({...pc,items:{...pc.items,"小銭":pc.items["小銭"]-1},flags:{...pc.flags,kosen:true}}),
                    desc:"次の行為判定の判定ダイス数が「1」増加します。", timing:"行為判定直前" },
  "お守り":       { canUse: (pc) => (pc.items?.["お守り"]||0) > 0,
                    use: (pc) => ({...pc,items:{...pc.items,"お守り":pc.items["お守り"]-1},flags:{...pc.flags,omamori:true}}),
                    desc:"移動で「6」が出たとき、ハプニングが発生せず6マス先まで移動できます。", timing:"移動処理中" },
  "Pアイテム":    { canUse: (pc) => (pc.items?.["Pアイテム"]||0) > 0,
                    use: (pc) => { const r={...pc.resources}; r.霊力={cur:Math.min((r.霊力?.cur||0)+3,r.霊力?.max||30),max:r.霊力?.max||30}; return {...pc,items:{...pc.items,"Pアイテム":pc.items["Pアイテム"]-1},resources:r}; },
                    desc:"【霊力】を「3点」獲得します。", timing:"いつでも" },
  "残機のかけら": { canUse: (pc) => (pc.items?.["残機のかけら"]||0) >= 3,
                    use: (pc) => { const r={...pc.resources}; r.残り人数={cur:Math.min((r.残り人数?.cur||0)+1,r.残り人数?.max||5),max:r.残り人数?.max||5}; return {...pc,items:{...pc.items,"残機のかけら":pc.items["残機のかけら"]-3},resources:r}; },
                    desc:"3つ消費して【残り人数】を「1点」獲得します。（3つ以上保持時のみ）", timing:"いつでも" },
  "スペカかけら": { canUse: (pc) => (pc.items?.["スペカかけら"]||0) >= 2,
                    use: (pc) => { const r={...pc.resources}; r.スペカ={cur:Math.min((r.スペカ?.cur||0)+1,r.スペカ?.max||5),max:r.スペカ?.max||5}; return {...pc,items:{...pc.items,"スペカかけら":pc.items["スペカかけら"]-2},resources:r}; },
                    desc:"2つ消費して【スペルカード】を「1点」獲得します。（2つ以上保持時のみ）", timing:"いつでも" },
  "妖器":         { canUse: (pc) => (pc.items?.["妖器"]||0) > 0,
                    use: (pc) => { const r={...pc.resources}; r.攻撃力={cur:Math.min((r.攻撃力?.cur||0)+1,r.攻撃力?.max||5),max:r.攻撃力?.max||5}; return {...pc,items:{...pc.items,"妖器":pc.items["妖器"]-1},flags:{...pc.flags,youki:true}}; },
                    desc:"1ラウンドの間【攻撃力】が1点増加します。（輝針城の限定アイテム）", timing:"弾幕ごっこ前" },
};

// PC初期リソース
export const INIT_RESOURCES = () => ({
  やる気:     { cur:1, max:3 },
  残り人数:   { cur:2, max:5 },
  スペカ:     { cur:1, max:5 },
  グレイズ:   { cur:0, max:5 },
  霊力:       { cur:0, max:30 },
  攻撃力:     { cur:1, max:1 },
});
export const INIT_ITEMS = () => ({
  お酒:0, 小銭:0, お守り:0, Pアイテム:0, 残機のかけら:0, スペカかけら:0, 妖器:0,
});

// スキルタイプのバッジ色
const SKILL_TYPE_COLOR = { "オート":"#81c784","アクション":"#64b5f6","サポート":"#ffb74d" };

// ── BackstoryScreen ───────────────────────────────────
export function BackstoryScreen({ gs, isGm, onProceed }) {
  const [visible, setVisible] = useState(false);
  useEffect(()=>{ setTimeout(()=>setVisible(true),100); },[]);

  return (
    <div style={{ background:"#04060a", height:"100vh", display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center", fontFamily:"serif", cursor:"pointer",
      padding:"40px 60px", boxSizing:"border-box" }}
      onClick={isGm ? onProceed : undefined}>
      <style>{`@keyframes fadeIn{from{opacity:0}to{opacity:1}} @keyframes pulse{0%,100%{opacity:0.5}50%{opacity:1}}`}</style>
      <div style={{ maxWidth:760, animation:"fadeIn 1.2s ease", opacity:visible?1:0, transition:"opacity 1s" }}>
        <div style={{ fontSize:11, color:"#4a6080", letterSpacing:4, textAlign:"center", marginBottom:16 }}>
          {gs.scenarioData?.name || "シナリオ"}
        </div>
        <div style={{ fontSize:15, color:"#b8c8d8", lineHeight:2.2, whiteSpace:"pre-wrap", textAlign:"justify" }}>
          {gs.scenarioData?.backstory || "（バックストーリー未設定）"}
        </div>
        {isGm && (
          <div style={{ textAlign:"center", marginTop:40, animation:"pulse 2s ease infinite" }}>
            <span style={{ fontSize:11, color:"#3a5070", letterSpacing:3 }}>▼ クリックして探索フェイズへ ▼</span>
          </div>
        )}
        {!isGm && (
          <div style={{ textAlign:"center", marginTop:40 }}>
            <span style={{ fontSize:10, color:"#2a3545", letterSpacing:2 }}>GMがフェイズを進めるまでお待ちください…</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ConfirmModal ──────────────────────────────────────
export function ConfirmModal({ title, body, onOk, onCancel, okLabel="実行する", okColor="#e07060" }) {
  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",zIndex:100,
      display:"flex",alignItems:"center",justifyContent:"center" }} onClick={onCancel}>
      <div style={{ background:"#0c1020",border:"1px solid #1e2d45",borderRadius:6,
        padding:22,maxWidth:360,width:"90%" }} onClick={e=>e.stopPropagation()}>
        <div style={{ fontSize:13,color:"#c8a040",marginBottom:8 }}>{title}</div>
        {body && <div style={{ fontSize:11,color:"#8a9aaa",lineHeight:1.8,marginBottom:16 }}>{body}</div>}
        <div style={{ display:"flex",gap:8 }}>
          <button onClick={onOk} style={{ flex:1,padding:"8px",cursor:"pointer",borderRadius:3,
            background:`${okColor}20`,border:`1px solid ${okColor}80`,color:okColor,fontSize:12 }}>
            {okLabel}
          </button>
          <button onClick={onCancel} style={{ flex:1,padding:"8px",cursor:"pointer",borderRadius:3,
            background:"rgba(255,255,255,0.03)",border:"1px solid #1e2535",color:"#5a6575",fontSize:12 }}>
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ItemUseModal ──────────────────────────────────────
function ItemUseModal({ itemName, pc, onConfirm, onCancel }) {
  const data = ITEM_DATA[itemName];
  if (!data) return null;
  const canUse = data.canUse(pc);
  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",zIndex:100,
      display:"flex",alignItems:"center",justifyContent:"center" }} onClick={onCancel}>
      <div style={{ background:"#0c1020",border:"1px solid #1e2d45",borderRadius:6,
        padding:20,maxWidth:340,width:"90%" }} onClick={e=>e.stopPropagation()}>
        <div style={{ fontSize:13,color:"#c8a040",marginBottom:4 }}>【{itemName}】を使用する</div>
        <div style={{ fontSize:10,color:"#5a7090",marginBottom:4 }}>タイミング: {data.timing}</div>
        <div style={{ fontSize:11,color:"#8a9aaa",lineHeight:1.8,marginBottom:14 }}>{data.desc}</div>
        {!canUse && <div style={{ fontSize:10,color:"#e07060",marginBottom:8 }}>使用条件を満たしていません</div>}
        <div style={{ display:"flex",gap:8 }}>
          <button onClick={()=>canUse&&onConfirm()} disabled={!canUse}
            style={{ flex:1,padding:"8px",cursor:canUse?"pointer":"not-allowed",borderRadius:3,
              background:canUse?"rgba(200,160,64,0.2)":"rgba(255,255,255,0.02)",
              border:canUse?"1px solid #8b6914":"1px solid #1e2535",
              color:canUse?"#c8a040":"#2a3545",fontSize:12 }}>
            使用する
          </button>
          <button onClick={onCancel} style={{ flex:1,padding:"8px",cursor:"pointer",borderRadius:3,
            background:"rgba(255,255,255,0.03)",border:"1px solid #1e2535",color:"#5a6575",fontSize:12 }}>
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SkillActivateModal ────────────────────────────────
function SkillActivateModal({ skillName, skillType, desc, onConfirm, onCancel }) {
  const typeColor = SKILL_TYPE_COLOR[skillType] || "#c8b89a";
  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",zIndex:100,
      display:"flex",alignItems:"center",justifyContent:"center" }} onClick={onCancel}>
      <div style={{ background:"#0c1020",border:"1px solid #1e2d45",borderRadius:6,
        padding:20,maxWidth:360,width:"90%" }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:8 }}>
          <span style={{ padding:"2px 7px",background:`${typeColor}18`,border:`1px solid ${typeColor}50`,
            borderRadius:10,fontSize:9,color:typeColor }}>{skillType}</span>
          <span style={{ fontSize:13,color:"#c8a040" }}>《{skillName}》を発動する</span>
        </div>
        <div style={{ fontSize:11,color:"#8a9aaa",lineHeight:1.8,marginBottom:14 }}>{desc}</div>
        <div style={{ display:"flex",gap:8 }}>
          <button onClick={onConfirm} style={{ flex:1,padding:"8px",cursor:"pointer",borderRadius:3,
            background:"rgba(200,160,64,0.2)",border:"1px solid #8b6914",color:"#c8a040",fontSize:12 }}>
            発動する
          </button>
          <button onClick={onCancel} style={{ flex:1,padding:"8px",cursor:"pointer",borderRadius:3,
            background:"rgba(255,255,255,0.03)",border:"1px solid #1e2535",color:"#5a6575",fontSize:12 }}>
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PCCard ────────────────────────────────────────────
function PCCard({ pc, isGm, onUpdatePc, getSpot, cycleIdx }) {
  const [itemModal, setItemModal] = useState(null);
  const [skillModal, setSkillModal] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [gmEdit, setGmEdit] = useState(false);

  const resources = pc.resources || INIT_RESOURCES();
  const items = pc.items || INIT_ITEMS();
  const skill = pc.skillId ? PERSONALITY_SKILLS[pc.skillId] : null;
  const isCustomChar = pc.charId?.startsWith("custom_");

  const useItem = (itemName) => {
    const data = ITEM_DATA[itemName];
    if (!data) return;
    const updated = data.use(pc);
    onUpdatePc(updated);
    setItemModal(null);
  };

  const activateSkill = () => {
    onUpdatePc({ ...pc, skillActivatedThisSession: (pc.skillActivatedThisSession||0)+1,
      log: [...(pc.log||[]), `《${skill?.name}》を発動`] });
    setSkillModal(null);
  };

  const resKeys = ["やる気","残り人数","スペカ","グレイズ","霊力","攻撃力"];
  const itemKeys = Object.keys(INIT_ITEMS());

  // スキル発動可能判定
  const skillCanActivate = skill && skill.type !== "オート";
  const currentSpotName = getSpot(pc.currentSpot)?.name || "-";

  const C = { gold:"#c8a040", goldBg:"rgba(200,160,64,0.12)", goldDim:"#8b6914",
    border:"#1a2535", text:"#c8b89a", textDim:"#8a9aaa", textFaint:"#5a6575",
    red:"#e07060", green:"#4caf50" };

  return (
    <div style={{ border:`1px solid ${expanded?"#2a3545":C.border}`,borderRadius:5,marginBottom:6,overflow:"hidden" }}>
      {/* ヘッダー */}
      <div style={{ display:"flex",alignItems:"center",gap:8,padding:"7px 10px",cursor:"pointer",
        background:expanded?"rgba(255,255,255,0.025)":"rgba(255,255,255,0.01)" }}
        onClick={()=>setExpanded(v=>!v)}>
        <CharSprite spriteRow={pc.spriteRow??-1} spriteCol={pc.spriteCol??-1} size={36}/>
        <div style={{ flex:1,minWidth:0 }}>
          <div style={{ fontSize:11,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
            {pc.name}
          </div>
          <div style={{ fontSize:9,color:C.textFaint }}>{pc.charName} / {currentSpotName}</div>
        </div>
        <div style={{ display:"flex",gap:4 }}>
          <span style={{ fontSize:9,color:"#f9a825" }}>
            やる気{resources.やる気?.cur||0}/{resources.やる気?.max||3}
          </span>
          <span style={{ fontSize:9,color:"#ab47bc" }}>
            霊力{resources.霊力?.cur||0}
          </span>
        </div>
        <span style={{ color:C.textFaint,fontSize:12 }}>{expanded?"▲":"▼"}</span>
      </div>

      {expanded && (
        <div style={{ padding:"10px 12px",borderTop:`1px solid ${C.border}` }}>
          {/* リソース */}
          <div style={{ fontSize:9,color:C.textFaint,letterSpacing:2,borderBottom:`1px solid #111828`,
            paddingBottom:3,marginBottom:8 }}>リソース</div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4,marginBottom:10 }}>
            {resKeys.map(k=>{
              const r = resources[k] || {cur:0,max:1};
              return (
                <div key={k} style={{ padding:"4px 6px",background:"rgba(255,255,255,0.02)",
                  border:`1px solid ${C.border}`,borderRadius:3,textAlign:"center" }}>
                  <div style={{ fontSize:8,color:C.textFaint,marginBottom:1 }}>【{k}】</div>
                  <div style={{ fontSize:12,color:C.gold }}>
                    {r.cur}
                    {r.max>1&&<span style={{ fontSize:8,color:C.textFaint }}>/{r.max}</span>}
                  </div>
                  {isGm && gmEdit && (
                    <div style={{ display:"flex",gap:2,justifyContent:"center",marginTop:2 }}>
                      <button onClick={()=>{
                        const nr={...resources,[k]:{...r,cur:Math.max(0,r.cur-1)}};
                        onUpdatePc({...pc,resources:nr});
                      }} style={{ width:14,height:14,fontSize:9,background:"rgba(255,255,255,0.03)",
                        border:`1px solid ${C.border}`,color:C.textFaint,cursor:"pointer",borderRadius:2,padding:0 }}>−</button>
                      <button onClick={()=>{
                        const nr={...resources,[k]:{...r,cur:Math.min(r.cur+1,r.max)}};
                        onUpdatePc({...pc,resources:nr});
                      }} style={{ width:14,height:14,fontSize:9,background:"rgba(255,255,255,0.03)",
                        border:`1px solid ${C.border}`,color:C.textFaint,cursor:"pointer",borderRadius:2,padding:0 }}>＋</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* アイテム */}
          <div style={{ fontSize:9,color:C.textFaint,letterSpacing:2,borderBottom:`1px solid #111828`,
            paddingBottom:3,marginBottom:8 }}>アイテム</div>
          <div style={{ display:"flex",flexWrap:"wrap",gap:4,marginBottom:10 }}>
            {itemKeys.map(k=>{
              const count = items[k]||0;
              const data = ITEM_DATA[k];
              const canUse = data?.canUse(pc);
              if(count===0&&!isGm) return null;
              return (
                <div key={k} style={{ display:"flex",alignItems:"center",gap:3,
                  padding:"3px 7px",borderRadius:12,cursor:count>0?"pointer":"default",
                  background: canUse?"rgba(200,160,64,0.15)":"rgba(255,255,255,0.03)",
                  border:`1px solid ${canUse?C.goldDim:C.border}` }}
                  onClick={()=>count>0&&setItemModal(k)}>
                  <span style={{ fontSize:10,color:canUse?C.gold:C.textFaint }}>{k}</span>
                  <span style={{ fontSize:9,color:canUse?C.gold:C.textFaint,
                    padding:"0 4px",background:"rgba(0,0,0,0.3)",borderRadius:8 }}>{count}</span>
                </div>
              );
            })}
            {isGm && (
              <button onClick={()=>setGmEdit(v=>!v)}
                style={{ padding:"2px 8px",fontSize:9,cursor:"pointer",borderRadius:10,
                  background:gmEdit?"rgba(192,57,43,0.2)":"rgba(255,255,255,0.03)",
                  border:`1px solid ${gmEdit?"#8b1a1a":C.border}`,
                  color:gmEdit?C.red:C.textFaint }}>
                {gmEdit?"編集終了":"GM編集"}
              </button>
            )}
            {isGm && gmEdit && (
              <div style={{ width:"100%",marginTop:4 }}>
                <div style={{ fontSize:8,color:C.textFaint,marginBottom:4 }}>アイテム直接編集:</div>
                <div style={{ display:"flex",flexWrap:"wrap",gap:4 }}>
                  {itemKeys.map(k=>(
                    <div key={k} style={{ display:"flex",alignItems:"center",gap:3 }}>
                      <span style={{ fontSize:9,color:C.textFaint }}>{k}:</span>
                      <button onClick={()=>onUpdatePc({...pc,items:{...items,[k]:Math.max(0,(items[k]||0)-1)}})}
                        style={{ width:14,height:14,fontSize:9,background:"rgba(255,255,255,0.03)",border:`1px solid ${C.border}`,color:C.textFaint,cursor:"pointer",borderRadius:2,padding:0 }}>−</button>
                      <span style={{ fontSize:9,color:C.gold,minWidth:12,textAlign:"center" }}>{items[k]||0}</span>
                      <button onClick={()=>onUpdatePc({...pc,items:{...items,[k]:(items[k]||0)+1}})}
                        style={{ width:14,height:14,fontSize:9,background:"rgba(255,255,255,0.03)",border:`1px solid ${C.border}`,color:C.textFaint,cursor:"pointer",borderRadius:2,padding:0 }}>＋</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* スキル */}
          <div style={{ fontSize:9,color:C.textFaint,letterSpacing:2,borderBottom:`1px solid #111828`,
            paddingBottom:3,marginBottom:8 }}>スキル</div>
          {skill && (
            <div style={{ marginBottom:6 }}>
              <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:4 }}>
                <span style={{ padding:"1px 6px",background:`${SKILL_TYPE_COLOR[skill.type]||"#c8b89a"}18`,
                  border:`1px solid ${SKILL_TYPE_COLOR[skill.type]||"#c8b89a"}50`,
                  borderRadius:8,fontSize:8,color:SKILL_TYPE_COLOR[skill.type]||"#c8b89a" }}>
                  {skill.type}
                </span>
                <span style={{ fontSize:11,color:skillCanActivate?"#c8a040":"#81c784" }}>
                  《{skill.name}》
                </span>
                {skill.type==="オート" && (
                  <span style={{ fontSize:8,color:"#81c784" }}>常時発動中</span>
                )}
              </div>
              <div style={{ fontSize:9,color:C.textFaint,lineHeight:1.7,marginBottom:6 }}>{skill.desc}</div>
              {skillCanActivate && !isCustomChar && (
                <button onClick={()=>setSkillModal(true)}
                  style={{ padding:"4px 12px",cursor:"pointer",borderRadius:3,fontSize:10,
                    background:"rgba(200,160,64,0.2)",border:"1px solid #8b6914",color:"#c8a040" }}>
                  発動する
                </button>
              )}
              {isCustomChar && skillCanActivate && (
                <div style={{ fontSize:8,color:"#f9a825" }}>※カスタムキャラ：手動で処理してください</div>
              )}
            </div>
          )}
          {/* 能力スキル（キャラデータから取得は準備フェイズで保存が必要 → 現状は名前のみ表示）*/}
          {pc.charData?.abilitySkill && (
            <div>
              <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:4 }}>
                <span style={{ padding:"1px 6px",background:`${SKILL_TYPE_COLOR[pc.charData.abilitySkill.type]||"#c8b89a"}18`,
                  border:`1px solid ${SKILL_TYPE_COLOR[pc.charData.abilitySkill.type]||"#c8b89a"}50`,
                  borderRadius:8,fontSize:8,color:SKILL_TYPE_COLOR[pc.charData.abilitySkill.type]||"#c8b89a" }}>
                  {pc.charData.abilitySkill.type}
                </span>
                <span style={{ fontSize:11,color:"#90caf9" }}>
                  【{pc.charData.abilitySkill.name}】
                </span>
              </div>
              <div style={{ fontSize:9,color:C.textFaint,lineHeight:1.7 }}>{pc.charData.abilitySkill.desc}</div>
            </div>
          )}
        </div>
      )}

      {itemModal && (
        <ItemUseModal itemName={itemModal} pc={pc}
          onConfirm={()=>useItem(itemModal)} onCancel={()=>setItemModal(null)}/>
      )}
      {skillModal && skill && (
        <SkillActivateModal skillName={skill.name} skillType={skill.type} desc={skill.desc}
          onConfirm={activateSkill} onCancel={()=>setSkillModal(null)}/>
      )}
    </div>
  );
}

// ── RightPanel ────────────────────────────────────────
export function RightPanel({
  gs, upd, sceneData, setSceneData,
  isGm, user, room,
  CYCLES, CYCLE_COLORS, NEWSPAPER, getSpot,
  doNewspaper, doPlaceClue, doAdvanceCycle, doReiryoku, doTransitionToExplore,
  pendingAction, setPendingAction,
}) {
  const [tab, setTab] = useState("progress");
  const [diceResult, setDiceResult] = useState(null);
  const [diceAnim, setDiceAnim] = useState(false);
  const [paperModal, setPaperModal] = useState(null);
  const timerRef = useRef(null);

  const cycleIdx = gs.cycleIdx || 0;
  const isIntro = gs.sessionPhase === "intro";
  const isMorning = cycleIdx === 0;

  const C = {
    gold:"#c8a040", goldDim:"#8b6914", goldBg:"rgba(200,160,64,0.12)",
    red:"#e07060", redBg:"rgba(192,57,43,0.18)", redBorder:"#8b1a1a",
    blue:"#64b5f6", blueBg:"rgba(25,118,210,0.15)", blueBorder:"#0d47a1",
    green:"#4caf50", greenBg:"rgba(27,94,32,0.15)", greenBorder:"#1b5e20",
    purple:"#ce93d8", border:"#1a2535",
    text:"#c8b89a", textDim:"#8a9aaa", textFaint:"#5a6575",
  };

  const cycleColor = CYCLE_COLORS[cycleIdx];

  const rollD6 = ()=>Math.floor(Math.random()*6)+1;

  const animateDice = (count, label, cb) => {
    if(timerRef.current) clearInterval(timerRef.current);
    setDiceAnim(true);
    let f=0;
    timerRef.current=setInterval(()=>{
      f++;
      setDiceResult(Array(count).fill(0).map(rollD6));
      if(f>=14){
        clearInterval(timerRef.current);
        const res=Array(count).fill(0).map(rollD6);
        setDiceResult(res);
        setDiceAnim(false);
        if(cb)cb(res);
      }
    },80);
  };

  const handleNewspaper = () => {
    animateDice(2,"文々。新聞表",(res)=>{
      const val=Math.min(res[0],res[1])*10+Math.max(res[0],res[1]);
      const paper=NEWSPAPER[val]||{title:`出目${val}`,effect:"（データなし）"};
      doNewspaper({roll:val,dice:res,...paper});
      setTimeout(()=>setPaperModal({roll:val,dice:res,...paper}),300);
    });
  };

  const handlePlaceClue = () => {
    animateDice(2,"手がかり配置",(res)=>{
      const val=Math.min(res[0],res[1])*10+Math.max(res[0],res[1]);
      doPlaceClue(val);
    });
  };

  // GMのメインアクション
  const getMainAction = () => {
    if(isIntro) return { label:"🎬 探索フェイズへ移行する", fn:()=>setPendingAction("toExplore"), color:"#1976d2" };
    if(isMorning){
      if(!gs.newspaper) return { label:"📰 文々。新聞を読む", fn:handleNewspaper, color:C.blue };
      if(!gs.cluePlaced) return { label:"🔍 手がかりを配置", fn:()=>setPendingAction("placeClue"), color:C.green };
      return { label:"☀ 昼サイクルへ", fn:()=>setPendingAction("advance"), color:"#f57c00" };
    }
    if(cycleIdx===1||cycleIdx===2){
      if(!gs.reiryokuDone) return { label:"✦ 霊力の増加", fn:doReiryoku, color:"#ab47bc" };
      return { label:`${cycleIdx===1?"夕":"夜"}サイクルへ`, fn:()=>setPendingAction("advance"), color:"#546e7a" };
    }
    if(!gs.reiryokuDone) return { label:"✦ 霊力の増加", fn:doReiryoku, color:"#ab47bc" };
    return { label:"🌙 翌日の朝へ", fn:()=>setPendingAction("advance"), color:"#1565c0" };
  };
  const ma = isGm ? getMainAction() : null;

  const myPc = gs.pcs?.find(p=>p.uid===user?.uid);
  const hasUsableSomething = myPc && (
    Object.entries(myPc.items||{}).some(([k,v])=>v>0&&ITEM_DATA[k]?.canUse(myPc)) ||
    (myPc.skillId && PERSONALITY_SKILLS[myPc.skillId]?.type !== "オート")
  );

  const TABS = isGm
    ? [["progress","進行"],["pcs","PC一覧"],["scene","描写"],["log","ログ"]]
    : [["progress","進行"],["pcs","PC一覧"],["log","ログ"]];

  return (
    <div style={{ width:300,display:"flex",flexDirection:"column",background:"#0b0d14",
      borderLeft:`1px solid ${C.border}`,flexShrink:0,overflow:"hidden",fontFamily:"serif" }}>
      <style>{`@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes rollSpin{50%{transform:scale(1.15)}}
        button:hover{opacity:0.83} input,textarea,select{outline:none}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#1a1e2a}`}</style>

      {/* ヘッダー */}
      <div style={{ padding:"8px 12px",borderBottom:`1px solid ${C.border}`,background:"#08090f",flexShrink:0 }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4 }}>
          <span style={{ fontSize:11,color:C.gold,letterSpacing:2 }}>
            {isIntro?"✦ 導入フェイズ":"✦ 探索フェイズ"}
          </span>
          {!isIntro&&(
            <div style={{ padding:"2px 10px",background:`${cycleColor}18`,border:`1px solid ${cycleColor}40`,
              borderRadius:10,fontSize:10,color:cycleColor }}>
              {gs.day}日目・{CYCLES[cycleIdx]}
            </div>
          )}
        </div>
        {!isIntro&&(
          <div style={{ display:"flex",gap:3 }}>
            {[1,2,3,4,5].map(d=>(
              <div key={d} style={{ width:22,height:22,borderRadius:"50%",display:"flex",alignItems:"center",
                justifyContent:"center",fontSize:10,fontWeight:"bold",
                background:d===gs.day?"rgba(25,118,210,0.35)":"rgba(255,255,255,0.02)",
                border:d===gs.day?"2px solid #1976d2":`1px solid ${C.border}`,
                color:d===gs.day?"#64b5f6":"#1e2535" }}>{d}</div>
            ))}
            <div style={{ flex:1,display:"flex",gap:2,marginLeft:4 }}>
              {CYCLES.map((c,i)=>(
                <div key={i} style={{ flex:1,textAlign:"center",padding:"2px 0",fontSize:9,borderRadius:2,
                  background:i===cycleIdx?`${CYCLE_COLORS[i]}20`:"rgba(255,255,255,0.02)",
                  border:i===cycleIdx?`1px solid ${CYCLE_COLORS[i]}60`:`1px solid ${C.border}`,
                  color:i===cycleIdx?CYCLE_COLORS[i]:"#1e2535" }}>{c}</div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* GMメインアクション */}
      {ma&&(
        <div style={{ padding:"6px 8px",borderBottom:`1px solid ${C.border}`,flexShrink:0 }}>
          <button onClick={ma.fn} style={{ width:"100%",padding:"9px",borderRadius:4,cursor:"pointer",
            background:`${ma.color}20`,border:`1px solid ${ma.color}50`,color:ma.color,
            fontSize:12,letterSpacing:1 }}>
            {ma.label}
          </button>
        </div>
      )}

      {/* タブ */}
      <div style={{ display:"flex",borderBottom:`1px solid ${C.border}`,flexShrink:0 }}>
        {TABS.map(([id,label])=>(
          <div key={id} style={{ flex:1,padding:"6px 2px",textAlign:"center",fontSize:10,cursor:"pointer",
            color:tab===id?C.gold:"#1e2535",
            borderBottom:tab===id?`2px solid ${C.gold}`:"2px solid transparent",
            background:tab===id?"rgba(200,160,64,0.05)":"transparent",
            position:"relative" }}
            onClick={()=>setTab(id)}>
            {label}
            {id==="pcs"&&hasUsableSomething&&(
              <span style={{ position:"absolute",top:3,right:3,width:6,height:6,borderRadius:"50%",
                background:"#f9a825" }}/>
            )}
          </div>
        ))}
      </div>

      {/* タブコンテンツ */}
      <div style={{ flex:1,overflowY:"auto",padding:"8px" }}>

        {/* ── 進行タブ ── */}
        {tab==="progress"&&(
          <div>
            {/* クエスト */}
            <div style={{ fontSize:9,color:C.textFaint,letterSpacing:2,borderBottom:`1px solid #111828`,paddingBottom:3,marginBottom:6 }}>クエスト</div>
            {(gs.quests||[]).length===0
              ? <div style={{ fontSize:10,color:"#2a3545",marginBottom:8 }}>なし</div>
              : (gs.quests||[]).map(q=>(
                  <div key={q.id||q.name} style={{ padding:"6px 8px",marginBottom:4,
                    background:q.solved?"rgba(27,94,32,0.08)":"rgba(255,255,255,0.02)",
                    border:`1px solid ${q.solved?"#1b5e20":C.border}`,borderRadius:3 }}>
                    <div style={{ display:"flex",justifyContent:"space-between" }}>
                      <span style={{ fontSize:11,color:q.solved?"#4caf50":C.gold,
                        textDecoration:q.solved?"line-through":"none" }}>
                        【Lv.{q.level}】{q.name}
                      </span>
                      {isGm&&(
                        <button onClick={()=>upd(p=>({...p,quests:p.quests.map(x=>x.id===q.id?{...x,solved:!x.solved}:x)}))}
                          style={{ width:18,height:18,background:"rgba(255,255,255,0.03)",
                            border:`1px solid ${C.border}`,color:C.textFaint,
                            cursor:"pointer",borderRadius:2,fontSize:10,padding:0 }}>
                          {q.solved?"↩":"✓"}
                        </button>
                      )}
                    </div>
                    <div style={{ fontSize:9,color:C.textFaint,marginTop:2 }}>{q.summary}</div>
                    {isGm&&!q.solved&&q.truth&&(
                      <div style={{ fontSize:8,color:"#3a6040",marginTop:2 }}>🔒 {q.truth}</div>
                    )}
                  </div>
                ))
            }

            {/* 手がかり */}
            {!isIntro&&(gs.clues||[]).length>0&&(
              <>
                <div style={{ fontSize:9,color:C.textFaint,letterSpacing:2,borderBottom:`1px solid #111828`,paddingBottom:3,marginBottom:6,marginTop:10 }}>手がかり配置済み</div>
                {gs.clues.map(id=>{
                  const s=getSpot(id);
                  return(
                    <div key={id} style={{ display:"flex",justifyContent:"space-between",
                      alignItems:"center",fontSize:10,padding:"2px 0" }}>
                      <span style={{ color:"#00bcd4" }}>💡 [{id}] {s?.name}</span>
                      {isGm&&(
                        <button onClick={()=>upd(p=>({...p,clues:p.clues.filter(c=>c!==id)}))}
                          style={{ width:16,height:16,background:"rgba(255,255,255,0.03)",
                            border:`1px solid ${C.border}`,color:C.red,
                            cursor:"pointer",borderRadius:2,fontSize:10,padding:0 }}>✕</button>
                      )}
                    </div>
                  );
                })}
              </>
            )}

            {/* 本日の新聞 */}
            {gs.newspaper&&!isIntro&&(
              <>
                <div style={{ fontSize:9,color:C.textFaint,letterSpacing:2,borderBottom:`1px solid #111828`,paddingBottom:3,marginBottom:6,marginTop:10 }}>本日の新聞</div>
                <div style={{ padding:"6px 8px",background:"rgba(25,50,90,0.15)",border:"1px solid #1e3a5a",
                  borderRadius:4,cursor:"pointer" }} onClick={()=>setPaperModal(gs.newspaper)}>
                  <div style={{ fontSize:9,color:"#3a5070" }}>[{gs.newspaper.roll}]</div>
                  <div style={{ fontSize:11,color:"#60c0f0" }}>{gs.newspaper.title}</div>
                </div>
              </>
            )}

            {/* リミット */}
            {!isIntro&&(
              <div style={{ marginTop:10 }}>
                <div style={{ fontSize:9,color:C.textFaint,letterSpacing:2,borderBottom:`1px solid #111828`,paddingBottom:3,marginBottom:4 }}>リミット</div>
                <div style={{ fontSize:11,color:"#c0392b" }}>{gs.limit}</div>
              </div>
            )}

            {/* ダイスアニメ表示 */}
            {diceResult&&(
              <div style={{ marginTop:12,textAlign:"center" }}>
                <div style={{ display:"flex",gap:8,justifyContent:"center",marginBottom:4 }}>
                  {diceResult.map((d,i)=>(
                    <div key={i} style={{ width:40,height:40,border:"2px solid #1e3a5a",borderRadius:5,
                      background:"rgba(14,20,36,0.95)",display:"flex",alignItems:"center",
                      justifyContent:"center",fontSize:20,color:"#60c0f0",fontWeight:"bold",
                      animation:diceAnim?"rollSpin 0.25s ease infinite":"none" }}>{d}</div>
                  ))}
                </div>
                {!diceAnim&&<div style={{ fontSize:16,color:C.gold }}>{diceResult.join("")}</div>}
              </div>
            )}
          </div>
        )}

        {/* ── PC一覧タブ ── */}
        {tab==="pcs"&&(
          <div>
            {(gs.pcs||[]).length===0
              ? <div style={{ fontSize:10,color:"#2a3545" }}>PCなし</div>
              : (gs.pcs||[]).map(pc=>(
                  <PCCard key={pc.uid} pc={pc} isGm={isGm}
                    onUpdatePc={updPc=>{
                      upd(p=>({...p,pcs:p.pcs.map(x=>x.uid===pc.uid?updPc:x),
                        log:[`${pc.name}のステータスが更新された`,...p.log.slice(0,49)]}));
                    }}
                    getSpot={getSpot} cycleIdx={cycleIdx}/>
                ))
            }
          </div>
        )}

        {/* ── 描写タブ（GMのみ）── */}
        {tab==="scene"&&isGm&&(
          <div>
            <div style={{ fontSize:9,color:C.textFaint,letterSpacing:2,borderBottom:`1px solid #111828`,paddingBottom:3,marginBottom:8 }}>描写モード</div>
            <button onClick={()=>upd(p=>({...p,sceneMode:!p.sceneMode}))}
              style={{ width:"100%",padding:"8px",borderRadius:4,cursor:"pointer",marginBottom:8,
                background:gs.sceneMode?"rgba(121,134,203,0.2)":"rgba(255,255,255,0.03)",
                border:gs.sceneMode?"1px solid #7986cb60":`1px solid ${C.border}`,
                color:gs.sceneMode?"#9fa8da":C.textFaint,fontSize:12 }}>
              {gs.sceneMode?"🎭 描写モード ON（クリックで解除）":"🎭 描写モードを開始"}
            </button>
            <div style={{ fontSize:9,color:C.textFaint,marginBottom:3 }}>テキスト（PLに表示）</div>
            <textarea value={gs.sceneText||""} onChange={e=>upd(p=>({...p,sceneText:e.target.value}))}
              placeholder="PLに見せたいテキスト…"
              style={{ width:"100%",boxSizing:"border-box",padding:"5px 7px",fontSize:11,
                background:"rgba(255,255,255,0.03)",border:`1px solid ${C.border}`,
                color:C.text,borderRadius:3,height:80,resize:"vertical" }}/>
            <div style={{ fontSize:9,color:C.textFaint,marginTop:8,marginBottom:3 }}>背景画像</div>
            {sceneData.bg
              ? <div style={{ position:"relative",marginBottom:6 }}>
                  <img src={sceneData.bg} alt="" style={{ width:"100%",height:70,objectFit:"cover",
                    borderRadius:3,border:`1px solid ${C.border}` }}/>
                  <button onClick={()=>setSceneData(d=>({...d,bg:null}))}
                    style={{ position:"absolute",top:4,right:4,width:18,height:18,background:"rgba(8,8,12,0.9)",
                      border:"1px solid #3a1a1a",color:"#e07060",cursor:"pointer",borderRadius:2,fontSize:11,padding:0 }}>✕</button>
                </div>
              : <label style={{ display:"block",padding:"8px",textAlign:"center",
                  border:`1px dashed ${C.border}`,borderRadius:3,cursor:"pointer",
                  fontSize:10,color:C.textFaint,marginBottom:6 }}>
                  ＋ 背景画像
                  <input type="file" accept="image/*" style={{ display:"none" }}
                    onChange={e=>{
                      const f=e.target.files[0];if(!f)return;
                      const r=new FileReader();
                      r.onload=ev=>{
                        const img=new Image();
                        img.onload=()=>{
                          const scale=Math.min(1,1280/img.width);
                          const canvas=document.createElement("canvas");
                          canvas.width=img.width*scale;canvas.height=img.height*scale;
                          canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);
                          setSceneData(d=>({...d,bg:canvas.toDataURL("image/jpeg",0.8)}));
                        };
                        img.src=ev.target.result;
                      };
                      r.readAsDataURL(f);
                    }}/>
                </label>
            }
            <div style={{ fontSize:9,color:C.textFaint,marginBottom:3 }}>立ち絵（最大4体）</div>
            {(sceneData.portraits||[]).map((p,i)=>(
              <div key={i} style={{ display:"flex",alignItems:"center",gap:5,marginBottom:4 }}>
                <img src={p.img} alt="" style={{ width:28,height:48,objectFit:"contain",
                  border:`1px solid ${C.border}`,borderRadius:2 }}/>
                <input value={p.name||""} style={{ flex:1,padding:"3px 5px",fontSize:10,
                  background:"rgba(255,255,255,0.03)",border:`1px solid ${C.border}`,color:C.text,borderRadius:2 }}
                  onChange={e=>setSceneData(d=>({...d,portraits:d.portraits.map((x,j)=>j===i?{...x,name:e.target.value}:x)}))}
                  placeholder="キャラ名"/>
                <button onClick={()=>setSceneData(d=>({...d,portraits:d.portraits.filter((_,j)=>j!==i)}))}
                  style={{ width:18,height:18,background:"rgba(192,57,43,0.2)",border:"1px solid #5a1a1a",
                    color:"#e07060",cursor:"pointer",borderRadius:2,fontSize:10,padding:0 }}>✕</button>
              </div>
            ))}
            {(sceneData.portraits||[]).length<4&&(
              <label style={{ display:"block",padding:"5px",textAlign:"center",
                border:`1px dashed ${C.border}`,borderRadius:3,cursor:"pointer",
                fontSize:10,color:C.textFaint }}>
                ＋ 立ち絵を追加
                <input type="file" accept="image/*" style={{ display:"none" }}
                  onChange={e=>{
                    const f=e.target.files[0];if(!f)return;
                    const r=new FileReader();
                    r.onload=ev=>{
                      const img=new Image();
                      img.onload=()=>{
                        const scale=Math.min(1,600/img.width);
                        const canvas=document.createElement("canvas");
                        canvas.width=img.width*scale;canvas.height=img.height*scale;
                        canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);
                        setSceneData(d=>({...d,portraits:[...(d.portraits||[]),{img:canvas.toDataURL("image/jpeg",0.85),name:""}]}));
                      };
                      img.src=ev.target.result;
                    };
                    r.readAsDataURL(f);
                  }}/>
              </label>
            )}
          </div>
        )}

        {/* ── ログタブ ── */}
        {tab==="log"&&(
          <div>
            <div style={{ fontSize:9,color:C.textFaint,letterSpacing:2,borderBottom:`1px solid #111828`,paddingBottom:3,marginBottom:6 }}>セッションログ</div>
            {(gs.log||[]).length===0&&<div style={{ fontSize:10,color:"#2a3545" }}>なし</div>}
            {(gs.log||[]).map((e,i)=>(
              <div key={i} style={{ fontSize:10,color:"#2a3a4a",padding:"2px 0",borderBottom:"1px solid #0c0f18" }}>{e}</div>
            ))}
          </div>
        )}
      </div>

      {/* 新聞モーダル */}
      {paperModal&&(
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",zIndex:50,
          display:"flex",alignItems:"center",justifyContent:"center" }}
          onClick={()=>setPaperModal(null)}>
          <div style={{ background:"#0c1020",border:"1px solid #1e2d45",borderRadius:6,
            padding:20,maxWidth:380,width:"90%",animation:"fadeUp 0.2s ease" }}
            onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:9,letterSpacing:3,color:"#2a3a50",textAlign:"center",marginBottom:4 }}>— 文々。新聞 —</div>
            {paperModal.dice&&(
              <div style={{ display:"flex",gap:10,justifyContent:"center",marginBottom:8 }}>
                {paperModal.dice.map((d,i)=>(
                  <div key={i} style={{ width:44,height:44,border:"2px solid #1e3a5a",borderRadius:6,
                    background:"rgba(14,20,36,0.95)",display:"flex",alignItems:"center",
                    justifyContent:"center",fontSize:22,color:"#60c0f0",fontWeight:"bold" }}>{d}</div>
                ))}
              </div>
            )}
            <div style={{ fontSize:18,color:"#1976d2",textAlign:"center",marginBottom:6 }}>[{paperModal.roll}]</div>
            <div style={{ fontSize:13,color:"#60c0f0",marginBottom:8,textAlign:"center" }}>{paperModal.title}</div>
            <div style={{ fontSize:11,color:"#4a6070",lineHeight:1.8 }}>{paperModal.effect}</div>
            <button onClick={()=>setPaperModal(null)}
              style={{ marginTop:12,width:"100%",padding:"7px",background:"rgba(192,57,43,0.15)",
                border:"1px solid #5a1a1a",color:"#e07060",cursor:"pointer",borderRadius:3,fontSize:12 }}>
              確認した
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default RightPanel;
