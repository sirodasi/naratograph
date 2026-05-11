import { useState, useEffect, useRef, useCallback } from "react";
import { db, auth } from "./firebase";
import { ref, onValue, set, get } from "firebase/database";
import { signOut, onAuthStateChanged } from "firebase/auth";
import LobbyRoot, { CharSprite, CHARACTERS } from "./Lobby";
import { BackstoryScreen, RightPanel, ConfirmModal } from "./SessionView";
import mapImg from "./assets/map.png";

const MAP_SRC = mapImg;

// ─── データ定義（複合スポットを分離して再定義） ─────────────
const SPOTS =[
  { id:"11", roll:11, name:"人間の里", x:56.5, y:27.5, area:"人間の里", rei:1 },
  { id:"12", roll:12, name:"命蓮寺", x:37.5, y:21.5, area:"人間の里", rei:1 },
  { id:"13", roll:13, name:"香霖堂", x:40.5, y:34.5, area:"人間の里", rei:1 },
  { id:"14A", roll:14, name:"神霊廟", x:43.5, y:47, area:"人間の里", rei:1 },
  { id:"14B", roll:14, name:"マヨヒガ", x:46.5, y:47, area:"人間の里", rei:1 },
  { id:"15", roll:15, name:"間欠泉地下センター", x:65.5, y:63.5, area:"人間の里", rei:1 },
  { id:"16", roll:16, name:"太陽の畑", x:64.3, y:38.5, area:"人間の里", rei:1 },
  { id:"22", roll:22, name:"守矢神社", x:17.5, y:28.5, area:"妖怪の山", rei:2 },
  { id:"23", roll:23, name:"玄武の沢", x: 7,   y:55,   area:"妖怪の山", rei:2 },
  { id:"24", roll:24, name:"大蝦蟇の池", x:24.7, y:54.5, area:"妖怪の山", rei:2 },
  { id:"25", roll:25, name:"妖怪の樹海", x:29,   y:18.8, area:"妖怪の山", rei:2 },
  { id:"26A", roll:26, name:"九天の滝", x: 5.5,   y:13.5, area:"妖怪の山", rei:2 },
  { id:"26B", roll:26, name:"虹龍洞",   x: 8.5,   y:13.5, area:"妖怪の山", rei:2 },
  { id:"33", roll:33, name:"紅魔館", x: 5.5, y:84.5, area:"霧の湖・魔法の森", rei:3 },
  { id:"34", roll:34, name:"霧の湖", x:20.3, y:84.5, area:"霧の湖・魔法の森", rei:3 },
  { id:"35A", roll:35, name:"無縁塚", x:29.5, y:67, area:"霧の湖・魔法の森", rei:3 },
  { id:"35B", roll:35, name:"霧雨魔法店", x:32.9, y:67, area:"霧の湖・魔法の森", rei:3 },
  { id:"36", roll:36, name:"魔法の森", x:40.3, y:56.5, area:"霧の湖・魔法の森", rei:3 },
  { id:"44", roll:44, name:"白玉楼", x:48.2, y:83, area:"異世界", rei:4 },
  { id:"45", roll:45, name:"旧地獄街道", x:77, y:78, area:"異世界", rei:4 },
  { id:"46A", roll:46, name:"畜生界", x:85.5, y:82, area:"異世界", rei:4 },
  { id:"46B", roll:46, name:"地霊殿", x:88.5, y:82, area:"異世界", rei:4 },
  { id:"55", roll:55, name:"永遠亭", x:85, y:44.3, area:"迷いの竹林", rei:5 },
  { id:"56A", roll:56, name:"輝針城", x:76, y:32.5, area:"迷いの竹林", rei:5 },
  { id:"56B", roll:56, name:"迷いの竹林", x:79, y:32.5, area:"迷いの竹林", rei:5 },
  { id:"66", roll:66, name:"博麗神社", x:88.5, y:19.5, area:"（単独）", rei:6, reiD6: true },
  { id:"dream", roll:null, name:"夢の世界", x:91, y:54.5, area:"異世界", rei:4 },
];

const EDGES = [
  ["11", "12"], ["11", "13"], ["11", "14A"], ["11", "14B"], ["11", "15"], ["11", "16"], ["11", "66"],
  ["12", "25"], ["13", "35A"], ["13", "35B"], ["13", "36"], ["14A", "14B"], ["14A", "44"], ["14B", "44"],
  ["15", "45"], ["16", "56A"], ["16", "56B"], ["16", "66"], ["22", "23"], ["22", "26A"], ["22", "26B"],
  ["23", "24"], ["24", "25"], ["25", "26A"], ["25", "26B"], ["26A", "26B"], ["33", "34"], ["34", "35A"],
  ["34", "35B"], ["35A", "35B"], ["35A", "36"], ["35B", "36"], ["36", "44"], ["45", "46A"], ["45", "46B"],
  ["45", "56A"], ["45", "56B"], ["46A", "46B"], ["55", "56A"], ["55", "56B"], ["56A", "56B"], ["56A", "66"],
  ["56B", "66"],
];

function getDistances(startSpotId) {
  if (!startSpotId) return {};
  const dists = { [startSpotId]: 0 };
  const queue = [startSpotId];
  while (queue.length > 0) {
    const cur = queue.shift();
    const curDist = dists[cur];
    EDGES.forEach(([a, b]) => {
      let next = null;
      if (a === cur) next = b;
      if (b === cur) next = a;
      if (next && dists[next] === undefined) {
        dists[next] = curDist + 1;
        queue.push(next);
      }
    });
  }
  return dists;
}

const NEWSPAPER = {
  11:{title:"博麗神社の宴会は今夜",effect:"PCは「帰還」の際、「博麗神社」を自身の【拠点】として扱える。そこに移動したキャラクターは【やる気】+1点。"},
  22:{title:"博麗神社の宴会は今夜",effect:"PCは「帰還」の際、「博麗神社」を自身の【拠点】として扱える。そこに移動したキャラクターは【やる気】+1点。"},
  33:{title:"博麗神社の宴会は今夜",effect:"PCは「帰還」の際、「博麗神社」を自身の【拠点】として扱える。そこに移動したキャラクターは【やる気】+1点。"},
  44:{title:"博麗神社の宴会は今夜",effect:"PCは「帰還」の際、「博麗神社」を自身の【拠点】として扱える。そこに移動したキャラクターは【やる気】+1点。"},
  55:{title:"博麗神社の宴会は今夜",effect:"PCは「帰還」の際、「博麗神社」を自身の【拠点】として扱える。そこに移動したキャラクターは【やる気】+1点。"},
  66:{title:"博麗神社の宴会は今夜",effect:"PCは「帰還」の際、「博麗神社」を自身の【拠点】として扱える。そこに移動したキャラクターは【やる気】+1点。"},
  12:{title:"プレミアムな金曜日は鯢呑亭へ",effect:"「人間の里」のスポットにいるキャラクターが【お酒】を使用する際、獲得する【やる気】は+1点増加する。"},
  13:{title:"香霖堂にまたも新商品",effect:"「香霖堂」でアクションを消費すると、NPC1人が登場しセッション中に「応援」を行ってくれる。"},
  14:{title:"旅情溢れる、昔懐かしの夜雀屋台",effect:"D66を振りランダムなスポット1つを求める。PCは「帰還」の際そのスポットを自身の【拠点】として扱える。"},
  15:{title:"日帰り温泉に足湯が試験オープン",effect:"「間欠泉地下センター」でアクションを行うとき、開始時に自身の【やる気】が上限まで増加する。"},
  16:{title:"社説：人里の監視強化は妖怪差別か？",effect:"《妖怪》タグを持つキャラクターは「人間の里」に移動することができない。"},
  23:{title:"鬼才！アガサクリスQの新連載始まる",effect:"PC全員の【やる気】が「1点」増加する。"},
  24:{title:"予報士曰く本日は終日雨模様",effect:"スポットの移動の処理で振ったダイスの出目は「1」小さいものとして扱われる。"},
  25:{title:"怪しい情報にご用心",effect:"D66を2回振り、出た値と同じ番号のスポットそれぞれに【手がかり】を配置する。"},
  26:{title:"白狼天狗24時！山の守護者に密着取材",effect:"《人間》タグを持つキャラクターは「守矢神社」以外の妖怪の山エリアのスポットに移動した際、【霊力】をD6点消費する。"},
  34:{title:"話題の推理小説、人気のワケは？",effect:"「交流」の処理が行われたとき、絆を獲得されたキャラクターはシーンプレイヤーのPCへの絆を獲得する。"},
  35:{title:"社説：凶暴化する妖精たち",effect:"D66を振りランダムなスポット1つを求める。そのスポットに移動したキャラクターの【霊力】はD6点減少する。"},
  36:{title:"正体不明の噂話の裏側に迫る",effect:"すべての【手がかり】を取り除く。取り除いた数だけランダムなスポットに【手がかり】を配置し直す。"},
  45:{title:"旧地獄に潜む闇、鬼の賭博の現場に密着",effect:"「旧地獄街道」でPCは任意アイテム1つを消費できる。2D:6の行為判定を行い、成功なら任意アイテム3つを取得する。"},
  46:{title:"プリズムリバー楽団2.0ゲリラ公演開催！",effect:"D66を振りランダムなスポット1つを求める。昼サイクル終了後、全PCはそのスポットへ移動でき【やる気】+1点。"},
  56:{title:"月の頭脳監修、効果覿面の健康ストレッチ",effect:"PC全員は取得している任意の【変調】1つを取り除くことができる。"},
};

const CYCLES =["朝","昼","夕","夜"];
const CYCLE_COLORS =["#f9a825","#29b6f6","#ef6c00","#3949ab"];

const AREA_COLORS = {
  "人間の里":         { bg:"rgba(192,57,43,0.85)",  border:"#e57373" },
  "妖怪の山":         { bg:"rgba(48,63,159,0.88)",   border:"#7986cb" },
  "霧の湖・魔法の森": { bg:"rgba(21,101,192,0.85)",  border:"#64b5f6" },
  "異世界":           { bg:"rgba(230,81,0,0.88)",    border:"#ffb74d" },
  "迷いの竹林":       { bg:"rgba(46,125,50,0.88)",   border:"#81c784" },
  "（単独）":         { bg:"rgba(97,97,97,0.88)",    border:"#bdbdbd" },
};
function areaColor(area){ return AREA_COLORS[area] || { bg:"rgba(30,30,30,0.85)", border:"#555" }; }

const DEFAULT_GS = {
  sessionPhase: "intro",
  day:1, cycleIdx:0,
  clues:[], newspaper:null, newspaperDone:false, cluePlaced:false, reiryokuDone:false,
  resources:{ やる気:[1,3], 残り人数:[2,5], スペカ:[1,5], グレイズ:[0,5], 霊力:[0,20], 攻撃力:[1,5] },
  items:{ お酒:0, 小銭:0, お守り:0, Pアイテム:0, 残魔かけら:0, スペカかけら:0 },
  quests:[], log:[], pcs:[],
  sceneMode:false, sceneText:"", banner:null,
  actedPcs:[],
  currentScene: null,
};

const DEFAULT_SCENE = { bg:null, portraits:[] };

function getSpot(id){
  let s = SPOTS.find(spot => spot.id === id);
  if (!s) s = SPOTS.find(spot => spot.roll == id); // 古いセーブデータ対応
  return s;
}

const MAP_NATURAL_W = 1200;
const MAP_NATURAL_H = 849;

function useMapBounds(containerRef) {
  const [bounds, setBounds] = useState({ left:0, top:0, width:0, height:0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const calc = () => {
      const cw = el.clientWidth, ch = el.clientHeight;
      const scale = Math.min(cw / MAP_NATURAL_W, ch / MAP_NATURAL_H);
      const rw = MAP_NATURAL_W * scale;
      const rh = MAP_NATURAL_H * scale;
      setBounds({ left: 0, top: 0, width: rw, height: rh });
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);
  return bounds;
}

// ─── MapView（GM/PL共通）────────────────────────────────
function MapView({ gs, sceneData, isGm, upd, onSpotClick, user }) {
  const cycleIdx = gs.cycleIdx || 0;
  const[hov, setHov] = useState(null);

  const filters = [
    "brightness(1.05) saturate(1.1) sepia(0.2)",
    "brightness(1) saturate(1) sepia(0)",
    "brightness(0.7) sepia(0.5) saturate(1.6) hue-rotate(-15deg)",
    "brightness(0.3) saturate(0.4) contrast(1.1)",
  ];
  
  const mapRef = useRef(null);
  const mapBounds = useMapBounds(mapRef);

  const scale = mapBounds.width > 0 ? mapBounds.width / MAP_NATURAL_W : 0.5;
  const baseSize = Math.round(22 * Math.max(0.5, Math.min(scale * 1.8, 1.4)));
  const fontSize  = Math.max(8, Math.round(10 * scale * 1.4));

  const isMovePhase = gs.currentScene?.phase === "move_dest";
  const actingPc = isMovePhase ? (gs.pcs||[]).find(p => p.uid === gs.currentScene.pcUid) : null;
  const isMyTurn = actingPc?.uid === user?.uid;
  const dists = actingPc ? getDistances(actingPc.currentSpot) : {};
  const maxDist = gs.currentScene?.selectedMoveDie || 0;

  if (gs.sceneMode) {
    return (
      <div style={{ position:"relative", width:"100%", height:"100%", overflow:"hidden", background:"#040608" }}>
        {sceneData.bg && <img src={sceneData.bg} alt="" style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover", opacity:0.85 }} />}
        <div style={{ position:"absolute", inset:0, background:"linear-gradient(180deg,rgba(0,0,0,0.05)0%,rgba(0,0,0,0.65)100%)" }} />
        <div style={{ position:"absolute", bottom:110, left:0, right:0, display:"flex", justifyContent:"center", gap:16, alignItems:"flex-end" }}>
          {(sceneData.portraits||[]).map((p,i) => (
            p.img && <img key={i} src={p.img} alt={p.name||""} style={{ height:320, objectFit:"contain", filter:"drop-shadow(0 4px 24px rgba(0,0,0,0.8))" }} />
          ))}
        </div>
        {gs.sceneText && (
          <div style={{ position:"absolute", bottom:0, left:0, right:0, background:"rgba(6,8,16,0.93)", borderTop:"1px solid #1e2535", padding:"16px 28px" }}>
            <div style={{ fontSize:14, color:"#c8b89a", lineHeight:2.1, fontFamily:"serif", whiteSpace:"pre-wrap" }}>{gs.sceneText}</div>
          </div>
        )}
      </div>
    );
  }
  
  return (
    <div ref={mapRef} style={{ position:"relative", width:"100%", height:"100%", overflow:"hidden", background:"#060810" }}>
      <style>{`
        @keyframes pulseReachable {
          0% { transform: scale(1); box-shadow: 0 0 0px #64b5f6; }
          50% { transform: scale(1.25); box-shadow: 0 0 20px #64b5f6; }
          100% { transform: scale(1); box-shadow: 0 0 0px #64b5f6; }
        }
      `}</style>

      <img src={MAP_SRC} alt="幻想郷マップ" style={{ width:"100%", height:"100%", objectFit:"contain", objectPosition:"left top",
        filter: filters[cycleIdx] || "none", transition: "filter 4.0s ease-in-out", pointerEvents: "none" }} />

      {mapBounds.width > 0 && SPOTS.map(spot => {
        const isDream   = spot.id === "dream";
        const hasClue   = !isDream && gs.clues.includes(spot.id);
        const pcsHere   = !isDream ? (gs.pcs||[]).filter(pc => pc.currentSpot === spot.id) :[];
        const exactDist = gs.currentScene?.exactMoveDist || null;
        
        const distance = dists[spot.id] ?? 999;
        let isReachable = false;
        if (isMovePhase) {
          if (exactDist) {
            isReachable = (distance === exactDist);
          } else {
            isReachable = (distance > 0 && distance <= maxDist);
          }
        }
        
        const sx = mapBounds.left + (spot.x/100) * mapBounds.width;
        const sy = mapBounds.top  + (spot.y/100) * mapBounds.height;
        const isHov = hov === spot.id;
        const iSize  = baseSize;
        const borderCol = isReachable ? "#64b5f6" : (hasClue ? "#00e5ff" : areaColor(spot.area).border);

        const canClick = isGm || (isMovePhase && isMyTurn && isReachable);

        return (
          <div key={spot.id} style={{ 
            position:"absolute", left:sx, top:sy,
            transform:"translate(-50%,-50%)", 
            zIndex: isReachable ? 15 : (hasClue?4:pcsHere.length?4:3),
            cursor: (canClick && !isDream) ? "pointer" : "default",
          }}
            onMouseEnter={()=>setHov(spot.id)} onMouseLeave={()=>setHov(null)}
            onClick={()=> {
              if (canClick && spot.id !== "dream") {
                onSpotClick(spot.id);
              }
            }}>
            
            {/* PCマーカー（スポットの上部に表示） */}
            {pcsHere.length > 0 && (
              <div style={{ position:"absolute", top: -iSize/2 - 4, left: "50%", transform:"translate(-50%, -100%)", display:"flex", gap:2, pointerEvents:"none", zIndex:10 }}>
                {pcsHere.map(p => {
                  const isAct = gs.currentScene?.pcUid === p.uid;
                  return (
                    <div key={p.uid} style={{ width:24, height:24, borderRadius:"50%", overflow:"hidden", border:`1.5px solid ${isAct ? "#64b5f6" : "#c8a040"}`, background:"#0b0d14", boxShadow:"0 2px 4px rgba(0,0,0,0.8)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                      {p.customPortrait ? (
                        <img src={p.customPortrait} style={{width:"100%", height:"100%", objectFit:"cover"}} />
                      ) : (
                        <div style={{ transform:"scale(0.65)", transformOrigin:"center 6px" }}>
                          <CharSprite spriteRow={p.spriteRow??-1} spriteCol={p.spriteCol??-1} size={48} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{
              width:iSize, height:iSize, borderRadius:"50%",
              background: areaColor(spot.area).bg,
              border:`2px solid ${borderCol}`, display:"flex", alignItems:"center", justifyContent:"center",
              fontWeight:"bold", fontSize: isDream ? fontSize-1 : fontSize,
              color: "#fff",
              boxShadow: hasClue 
                ? `0 0 15px rgba(0, 229, 255, 0.8), inset 0 0 10px rgba(0, 229, 255, 0.4)`
                : "none",
              animation: isReachable ? "pulseReachable 1.5s infinite ease-in-out" : "none",
            }}>
              {isDream ? "◇" : (spot.roll || "?")}
            </div>
            
            {hasClue && (
              <div style={{ position:"absolute", top:-Math.round(9*scale*1.4), right:-Math.round(9*scale*1.4),
                fontSize:Math.round(12*scale*1.4), filter:"drop-shadow(0 0 4px #00e5ff)" }}>💡</div>
            )}
            {isHov && (
              <div style={{ position:"absolute", background:"rgba(6,8,14,0.97)", border:"1px solid #1e2535",
                borderRadius:4, padding:"4px 8px", fontSize:10, color:"#c8b89a", whiteSpace:"nowrap",
                pointerEvents:"none", zIndex:20,
                left:spot.x>60?"auto":"calc(100% + 6px)", right:spot.x>60?"calc(100% + 6px)":"auto",
                top:"50%", transform:"translateY(-50%)" }}>
                {isDream ? "◇ 夢の世界" : `[${spot.roll}] ${spot.name}`}
                {pcsHere.length>0 && <span style={{color:"#ef9a9a"}}><br/>{pcsHere.map(p=>p.charName || p.name).join("・")}</span>}
                {hasClue && <span style={{color:"#00e5ff"}}><br/>💡 手がかりあり</span>}
              </div>
            )}
          </div>
        );
      })}

      <div style={{ position:"absolute", top:8, left:"50%", transform:"translateX(-50%)", display:"flex", gap:8 }}>
        {gs.sessionPhase !== "intro" ? (
          <div style={{ padding:"4px 14px", background:"rgba(10,12,20,0.92)", border:`1px solid ${CYCLE_COLORS[cycleIdx]}40`, borderRadius:14, fontSize:12, color:CYCLE_COLORS[cycleIdx] }}>
            {gs.day}日目・{CYCLES[cycleIdx]}
          </div>
        ) : (
          <div style={{ padding:"4px 14px", background:"rgba(10,12,20,0.92)", border:"1px solid #9c27b040", borderRadius:14, fontSize:12, color:"#ce93d8" }}>
            ✦ 導入フェイズ
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SESSION WRAPPER ─────────────
function SessionApp({ roomCode, user }) {
  const [mode, setMode] = useState(null);
  const [gs, setGs] = useState(DEFAULT_GS);
  const[sceneData, setSceneData] = useState(DEFAULT_SCENE);
  const [synced, setSynced] = useState(false);
  const [room, setRoom] = useState(null);
  const[pendingAction, setPendingAction] = useState(null);
  const [questBanner, setQuestBanner] = useState(null);

  const gsPath   = `rooms/${roomCode}/state`;
  const scenePath = `rooms/${roomCode}/scene`;

  useEffect(() => {
    const roomRef = ref(db, `rooms/${roomCode}`);
    const unsubRoom = onValue(roomRef, snap => {
      if (snap.exists()) {
        const r = snap.val();
        setRoom(r);
        const myPlayer = r.players?.[user.uid];
        if (myPlayer && !mode) setMode(myPlayer.role === "gm" ? "gm" : "pl");
      }
    });
    return () => unsubRoom();
  }, [roomCode, user.uid]);

  useEffect(() => {
    if (!mode) return;
    const gsRef   = ref(db, gsPath);
    const sceneRef = ref(db, scenePath);
    const timeout = setTimeout(() => setSynced(true), 8000);

    const unsubGs = onValue(gsRef, snap => {
      clearTimeout(timeout);
      if (snap.exists()) {
        const val = snap.val();
        setGs(prev => ({
          ...DEFAULT_GS, ...val,
          resources: { ...DEFAULT_GS.resources, ...(val.resources||{}) },
          items: { ...DEFAULT_GS.items, ...(val.items||{}) },
          pcs: val.pcs || [], quests: val.quests ||[],
          clues: val.clues || [], log: val.log ||[],
        }));
      } else if (mode === "gm") {
        get(ref(db, `rooms/${roomCode}`)).then(roomSnap => {
          const r = roomSnap.exists() ? roomSnap.val() : null;
          const initGs = { ...DEFAULT_GS, sessionPhase: "intro", limit: r?.limit || r?.scenarioData?.limit || "3日目の夜", scenarioData: r?.scenarioData || null, pcs: buildPcList(r) };
          set(gsRef, initGs).catch(console.error);
        });
      }
      setSynced(true);
    }, () => { clearTimeout(timeout); setSynced(true); });

    const unsubScene = onValue(sceneRef, snap => {
      if (snap.exists()) {
        const val = snap.val();
        setSceneData({ bg: val.bg||null, portraits: val.portraits||[] });
      }
    });

    return () => { clearTimeout(timeout); unsubGs(); unsubScene(); };
  }, [mode, gsPath, scenePath]);

  function buildPcList(r) {
    if (!r?.players) return[];
    return Object.values(r.players)
      .filter(p => p.role === "pl" && p.charId)
      .map(p => {
        const charData = CHARACTERS.find(c => c.id === p.charId) || null;
        let startSpotId = r?.scenarioData?.startSpotId || null;
        
        let baseSpotId = null;
        const charBase = charData?.base || p.base || "人間の里"; 
        const s = SPOTS.find(spot => spot.name === charBase || charBase.includes(spot.name));
        if (s) {
          baseSpotId = s.id;
        }

        if (r?.scenarioData?.startSpotType === "base") {
          startSpotId = baseSpotId || "11";
        }
        
        return {
          uid: p.uid, name: p.name,
          charId: p.charId, charName: p.charName,
          spriteRow: p.spriteRow ?? -1, spriteCol: p.spriteCol ?? -1,
          customPortrait: p.customPortrait || null,
          skillId: p.skillId || null, skillName: p.skillName || "",
          abilitySkill: charData?.abilitySkill || (p.charId?.startsWith("custom_") ? (p.abilitySkill || null) : null),
          danmakuSkill: charData?.danmakuSkill || null,
          resources: { ...DEFAULT_GS.resources, やる気:{cur:1,max:3}, 残り人数:{cur:2,max:5}, スペカ:{cur:1,max:5}, グレイズ:{cur:0,max:5}, 霊力:{cur:0,max:20}, 攻撃力:{cur:1,max:5} },
          items: { お酒:0, 小銭:0, お守り:0, Pアイテム:0, 残機のかけら:0, スペカかけら:0, 妖器:0 },
          baseSpotId: baseSpotId || "11",
          currentSpot: startSpotId || "11",
          log:[]
        };
    });
  }

  const upd = useCallback((fn) => {
    setGs(prev => { const next = typeof fn === "function" ? fn(prev) : fn; set(ref(db, gsPath), next).catch(console.error); return next; });
  }, [gsPath]);

  const setSceneDataAndSync = useCallback((fn) => {
    setSceneData(prev => { const next = typeof fn === "function" ? fn(prev) : fn; set(ref(db, scenePath), next).catch(console.error); return next; });
  },[scenePath]);

  useEffect(() => {
    if (!synced || !room || mode !== "gm") return;
    if ((gs.pcs ||[]).length === 0 && Object.values(room.players||{}).some(p=>p.role==="pl"&&p.charId)) {
      upd(p => ({ ...p, pcs: buildPcList(room) }));
    }
  },[synced, room, mode]);

  const doTransitionToExplore = () => {
    const scenario = gs.scenarioData;
    const startQuests = (scenario?.quests ||[]).filter(q => (q.unlockType||"start") === "start");
    const pcCount = (gs.pcs||[]).length || 1;
    const clueCount = Math.ceil(pcCount / 2);
    const spots = SPOTS.filter(s => s.roll !== null);
    const shuffled = [...spots].sort(() => Math.random()-0.5);
    const clueSpots = shuffled.slice(0, clueCount).map(s => s.id);

    upd(p => ({
      ...p, sessionPhase: "explore", day: 1, cycleIdx: 0,
      clues: clueSpots,
      quests: startQuests.map(q => ({ ...q, revealed: true, solved: false })),
      log:[`探索フェイズ開始。手がかりを${clueCount}箇所に配置。`, ...p.log],
    }));

    if (startQuests.length > 0) {
      setQuestBanner(startQuests);
      setTimeout(() => setQuestBanner(null), 6000);
    }
  };

  const doNewspaper = (paper) => { upd(p => ({ ...p, newspaper: paper, log: [`新聞[${paper.roll}]「${paper.title}」`, ...p.log] })); };

  const doPlaceClue = () => {
    function rollD6(){return Math.floor(Math.random()*6)+1;}
    const a = rollD6(), b = rollD6();
    const val = Math.min(a,b)*10 + Math.max(a,b);
    const candidates = SPOTS.filter(s => s.roll === val);
    if (candidates.length === 0) return;
    const spot = candidates[Math.floor(Math.random() * candidates.length)];
    upd(p => ({
      ...p, cluePlaced: true, clues: [...new Set([...p.clues, spot.id])],
      log: [`手がかりを[${val}]${spot.name}に配置`, ...p.log],
    }));
  };

  const doReiryoku = () => {
    upd(p => {
      let logMsg =[];
      const newPcs = p.pcs.map(pc => {
        const spot = getSpot(pc.currentSpot);
        if (!spot) return pc;
        let gain = spot.rei || 0;
        if (spot.reiD6) gain = Math.floor(Math.random() * 6) + 1;
        
        const curRei = pc.resources.霊力?.cur || 0;
        const maxRei = pc.resources.霊力?.max || 20;
        if (gain > 0) {
          const nextRei = Math.min(maxRei, curRei + gain);
          const nextAtk = 1 + Math.floor(nextRei / 5);
          logMsg.push(`${pc.charName || pc.name}+${gain}`);
          return { ...pc, resources: { ...pc.resources, 霊力: { ...pc.resources.霊力, cur: nextRei }, 攻撃力: { ...pc.resources.攻撃力, cur: nextAtk } } };
        }
        return pc;
      });
      return { ...p, pcs: newPcs, reiryokuDone: true, log:[`【霊力増加】 ${logMsg.length > 0 ? logMsg.join(" / ") : "なし"}`, ...p.log] };
    });
  };
  
  const doAdvanceCycle = () => {
    upd(p => {
      let day = p.day || 1; let cycleIdx = p.cycleIdx || 0;
      let logMsgs =[];
      let nextPcs = p.pcs;

      cycleIdx++; 
      if (cycleIdx >= CYCLES.length) { 
        cycleIdx = 0; day++; 
        nextPcs = p.pcs.map(pc => {
          const curYaruki = pc.resources.やる気?.cur || 0;
          const nextYaruki = Math.max(0, curYaruki - 1);
          return { ...pc, currentSpot: pc.baseSpotId || "11", resources: { ...pc.resources, やる気: { ...pc.resources.やる気, cur: nextYaruki } } };
        });
        logMsgs.push("夜が明け、各キャラクターは拠点に帰還し【やる気】が1減少した");
      }

      let newQuests =[...(p.quests||[])];
      if (cycleIdx === 0) {
        const allQ = p.scenarioData?.quests ||[];
        allQ.forEach(q => {
          if (newQuests.find(nq=>nq.id===q.id)) return;
          if (q.unlockType==="quest") {
            const ref = newQuests.find(nq=>nq.id===q.unlockQuestId&&nq.solved);
            if (ref) newQuests.push({...q,revealed:true,solved:false});
          }
        });
      }

      logMsgs.push(`${day}日目・${CYCLES[cycleIdx]}サイクル開始`);

      return {
        ...p, day, cycleIdx,
        newspaper: cycleIdx===0?null:p.newspaper, cluePlaced: cycleIdx===0?false:p.cluePlaced,
        reiryokuDone: false, quests: newQuests, actedPcs:[], currentScene: null, pcs: nextPcs,
        log:[...logMsgs.reverse(), ...p.log],
      };
    });
    setPendingAction(null);
  };

  const handleSpotClick = (spotId) => {
    const sc = gs.currentScene;
    if (sc?.phase === "move_dest") {
      const isGm = mode === "gm";
      const isMyTurn = sc.pcUid === user.uid;
      if (!isGm && !isMyTurn) return;

      const actingPc = (gs.pcs || []).find(p => p.uid === sc.pcUid);
      if (!actingPc) return;

      const dists = getDistances(actingPc.currentSpot);
      const distance = dists[spotId] ?? 999;
      const maxDist = sc.selectedMoveDie || 0;
      const exactDist = sc.exactMoveDist || null;

      const isValid = exactDist 
        ? (distance === exactDist) 
        : (distance > 0 && distance <= maxDist);

      if ((distance > 0 && distance <= maxDist) || isGm) {
        upd(p => ({ 
          ...p, 
          currentScene: { ...p.currentScene, selectedDestSpot: spotId } 
        }));
      } else {
        console.log("距離が足りません:", distance, "/", maxDist);
      }
    }
  };

  if (!mode) return <div style={{ background:"#040608", color:"#c8b89a", height:"100vh", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"serif" }}>
    <div style={{ textAlign:"center" }}>
      <div style={{ fontSize:22, color:"#c8a040", letterSpacing:4, marginBottom:20 }}>幻想ナラトグラフ</div>
      <div style={{ display:"flex", gap:12, justifyContent:"center" }}>
        <button onClick={()=>setMode("gm")} style={{ padding:"12px 24px",cursor:"pointer",borderRadius:4,fontSize:12,background:"rgba(192,57,43,0.18)",border:"1px solid #8b1a1a",color:"#e07060" }}>🎲 GM画面</button>
        <button onClick={()=>setMode("pl")} style={{ padding:"12px 24px",cursor:"pointer",borderRadius:4,fontSize:12,background:"rgba(25,118,210,0.15)",border:"1px solid #0d47a1",color:"#64b5f6" }}>✦ PL共有画面</button>
      </div>
    </div>
  </div>;

  if (!synced) return <div style={{ background:"#040608", height:"100vh", display:"flex", alignItems:"center", justifyContent:"center", color:"#3a4a5a", fontFamily:"serif", fontSize:12 }}>Firebase に接続中…</div>;

  if (gs.sessionPhase === "intro") return <BackstoryScreen gs={gs} isGm={mode==="gm"} onProceed={doTransitionToExplore}/>;

  return (
    <div style={{ display:"flex", height:"100vh", overflow:"hidden", fontFamily:"serif" }}>
      <style>{`
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-thumb{background:#1a1e2a}
        button:hover{opacity:0.83}
        @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulseSpot {
          0% { transform: scale(1) translateZ(0); filter: brightness(1); }
          50% { transform: scale(1.15) translateZ(0); filter: brightness(1.2); }
          100% { transform: scale(1) translateZ(0); filter: brightness(1); }
        }
      `}</style>

      <div style={{ flex:1, position:"relative", overflow:"hidden" }}>
        <MapView gs={gs} sceneData={sceneData} isGm={mode==="gm"} upd={upd} onSpotClick={handleSpotClick} user={user}/>
      </div>

      <RightPanel
        gs={gs} upd={upd} sceneData={sceneData} setSceneData={setSceneDataAndSync}
        isGm={mode==="gm"} user={user} room={room}
        CYCLES={CYCLES} CYCLE_COLORS={CYCLE_COLORS} NEWSPAPER={NEWSPAPER} getSpot={getSpot}
        doNewspaper={doNewspaper} doPlaceClue={doPlaceClue} doAdvanceCycle={doAdvanceCycle}
        doReiryoku={doReiryoku} doTransitionToExplore={doTransitionToExplore}
        pendingAction={pendingAction} setPendingAction={setPendingAction}
        SPOTS={SPOTS}
      />

      {questBanner && (
        <div style={{ position:"fixed", top:0, left:0, right:0, zIndex:200, background:"rgba(6,8,16,0.97)", borderBottom:"1px solid #1e3a5a", padding:"16px 24px", animation:"fadeUp 0.3s ease" }}>
          <div style={{ fontSize:11, color:"#4a6080", letterSpacing:3, marginBottom:8 }}>✦ クエスト公開</div>
          <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
            {questBanner.map(q=>(
              <div key={q.id||q.name} style={{ padding:"8px 14px", background:"rgba(200,160,64,0.12)", border:"1px solid #8b6914", borderRadius:5 }}>
                <div style={{ fontSize:12, color:"#c8a040" }}>【Lv.{q.level}】{q.name}</div>
                <div style={{ fontSize:10, color:"#6a7a90", marginTop:2 }}>{q.summary}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {pendingAction && (
        <ConfirmModal
          title={pendingAction==="advance" ? "サイクルを進めますか？" : pendingAction==="placeClue" ? "手がかりを配置しますか？" : "探索フェイズへ移行しますか？"}
          body={pendingAction==="advance" 
             ? `${gs.day}日目・${CYCLES[gs.cycleIdx||0]} → 次のフェーズへ進みます。` + (gs.cycleIdx === 3 ? "\n※夜が明けるため、全員が拠点に帰還し【やる気】が1減少します。" : "\nスキルや処理の確認をお忘れなく。") 
             : pendingAction==="placeClue" ? "ランダムなスポットに手がかりを1つ配置します。" 
             : "バックストーリーを経て探索フェイズへ移行します。\n開始時クエストが公開されます。"}
          okLabel="進む"
          onOk={pendingAction==="advance" ? doAdvanceCycle : pendingAction==="placeClue" ? ()=>{doPlaceClue();setPendingAction(null);} : ()=>{doTransitionToExplore();setPendingAction(null);}}
          onCancel={()=>setPendingAction(null)}
        />
      )}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const[roomCode, setRoomCode] = useState(null);
  const[roomPhase, setRoomPhase] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const r = params.get("room");
    if (r) setRoomCode(r.toUpperCase());
    
    const unsub = onAuthStateChanged(auth, u => setUser(u || null));
    return () => unsub();
  },[]);

  useEffect(() => {
    if (!roomCode) return;
    const roomRef = ref(db, `rooms/${roomCode}`);
    const unsub = onValue(roomRef, snap => {
      if (snap.exists()) {
        setRoomPhase(snap.val().phase || "prep");
      } else {
        setRoomPhase("error");
      }
    });
    return () => unsub();
  }, [roomCode]);

  if (user === undefined) {
    return <div style={{ background:"#040608", height:"100vh", display:"flex", alignItems:"center", justifyContent:"center", color:"#3a4a5a", fontFamily:"serif", fontSize:12 }}>接続中…</div>;
  }
  if (!user || !roomCode) {
    return <LobbyRoot />;
  }
  if (roomPhase === null) {
    return <div style={{ background:"#040608", height:"100vh", display:"flex", alignItems:"center", justifyContent:"center", color:"#3a4a5a", fontFamily:"serif", fontSize:12 }}>部屋情報を取得中…</div>;
  }
  if (roomPhase === "error") {
    return <div style={{ background:"#040608", height:"100vh", display:"flex", alignItems:"center", justifyContent:"center", color:"#e07060", fontFamily:"serif", fontSize:12 }}>部屋が見つかりません。URLを確認してください。</div>;
  }
  if (roomPhase === "prep") {
    return <LobbyRoot />;
  }

  return <SessionApp roomCode={roomCode} user={user} />;
}
