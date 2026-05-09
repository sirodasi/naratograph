import { useState, useEffect, useRef, useCallback } from "react";
import { db, auth } from "./firebase";
import { ref, onValue, set, get } from "firebase/database";
import { signOut, onAuthStateChanged } from "firebase/auth";
import LobbyRoot, { CharSprite, CHARACTERS } from "./Lobby";
import { BackstoryScreen, RightPanel, ConfirmModal } from "./SessionView";
import mapImg from "./assets/map.png";

const MAP_SRC = mapImg;

// ─── データ定義 ───────────────────────────────────────
const SPOTS = [
  { id:11,   name:"人間の里",            x:56.5, y:27.5, area:"人間の里",         rei:1,    reiD6:false },
  { id:12,   name:"命蓮寺",              x:37.5, y:21.5, area:"人間の里",         rei:1,    reiD6:false },
  { id:13,   name:"香霖堂",              x:40.5, y:34.5, area:"人間の里",         rei:1,    reiD6:false },
  { id:14,   name:"神霊廟/マヨヒガ",     x:45,   y:47,   area:"人間の里",         rei:1,    reiD6:false },
  { id:15,   name:"間欠泉地下センター",   x:65.5, y:63.5, area:"人間の里",         rei:1,    reiD6:false },
  { id:16,   name:"太陽の畑",            x:64.3, y:38.5, area:"人間の里",         rei:1,    reiD6:false },
  { id:22,   name:"守矢神社",            x:17.5, y:28.5, area:"妖怪の山",         rei:2,    reiD6:false },
  { id:23,   name:"玄武の沢",            x: 7,   y:55,   area:"妖怪の山",         rei:2,    reiD6:false },
  { id:24,   name:"大蝦蟇の池",          x:24.7, y:54.5, area:"妖怪の山",         rei:2,    reiD6:false },
  { id:25,   name:"妖怪の樹海",          x:29,   y:18.8, area:"妖怪の山",         rei:2,    reiD6:false },
  { id:26,   name:"九天の滝/虹龍洞",     x: 7,   y:13.5, area:"妖怪の山",         rei:2,    reiD6:false },
  { id:33,   name:"紅魔館",              x: 5.5, y:84.5, area:"霧の湖・魔法の森", rei:3,    reiD6:false },
  { id:34,   name:"霧の湖",              x:20.3, y:84.5, area:"霧の湖・魔法の森", rei:3,    reiD6:false },
  { id:35,   name:"無縁塚/霧雨魔法店",   x:31.2, y:67,   area:"霧の湖・魔法の森", rei:3,    reiD6:false },
  { id:36,   name:"魔法の森",            x:40.3, y:56.5, area:"霧の湖・魔法の森", rei:3,    reiD6:false },
  { id:44,   name:"白玉楼",              x:48.2, y:83,   area:"異世界",           rei:4,    reiD6:false },
  { id:45,   name:"旧地獄街道",          x:77,   y:78,   area:"異世界",           rei:4,    reiD6:false },
  { id:46,   name:"畜生界/地霊殿",       x:87,   y:82,   area:"異世界",           rei:4,    reiD6:false },
  { id:55,   name:"永遠亭",              x:85,   y:44.3, area:"迷いの竹林",       rei:5,    reiD6:false },
  { id:56,   name:"輝針城/迷いの竹林",   x:77.5, y:32.5, area:"迷いの竹林",       rei:5,    reiD6:false },
  { id:66,   name:"博麗神社",            x:88.5, y:19.5, area:"（単独）",         rei:6,    reiD6:true  },
  { id:null, name:"夢の世界",            x:91,   y:54.5, area:"異世界",           rei:4,    reiD6:false },
];

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

const CYCLES = ["朝","昼","夕","夜"];
const CYCLE_COLORS = ["#f9a825","#29b6f6","#ef6c00","#3949ab"];

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
  day:1, cycleIdx:0,
  clues:[], newspaper:null, newspaperDone:false, cluePlaced:false, reiryokuDone:false,
  resources:{ やる気:[1,3], 残り人数:[2,5], スペカ:[1,5], グレイズ:[0,5], 霊力:[0,30], 攻撃力:[1,1] },
  items:{ お酒:0, 小銭:0, お守り:0, Pアイテム:0, 残魔かけら:0, スペカかけら:0 },
  quests:[], limit:"3日目の夜", log:[],
  pcs:[],
  sceneMode:false, sceneText:"", banner:null,
};

const DEFAULT_SCENE = { bg:null, portraits:[] };

function rollD6(){ return Math.floor(Math.random()*6)+1; }
function rollD66(){ const a=rollD6(),b=rollD6(); return Math.min(a,b)*10+Math.max(a,b); }
function getSpot(id){ return SPOTS.find(s=>s.id===id); }

// 画像をリサイズしてbase64に変換（Firebaseの容量節約）
function resizeImage(file, maxW=800, quality=0.75) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.src = url;
  });
}

// ─── 共通スタイル ───
const iStyle = {
  padding:"4px 6px", fontSize:11,
  background:"rgba(255,255,255,0.03)",
  border:"1px solid #1a2030", color:"#c8b89a", borderRadius:3,
};
const confirmBtn = {
  width:"100%", padding:"7px 0",
  background:"rgba(192,57,43,0.15)", border:"1px solid #5a1a1a",
  color:"#e07060", cursor:"pointer", borderRadius:3, fontSize:12,
};

function SectionTitle({ children, style }) {
  return (
    <div style={{ fontSize:9, color:"#2a3545", letterSpacing:2,
      borderBottom:"1px solid #111828", paddingBottom:3, marginBottom:5, ...style }}>
      {children}
    </div>
  );
}
function Btn({ onClick, children, style }) {
  return (
    <button onClick={onClick} style={{
      width:18, height:18, border:"1px solid #1a2030",
      background:"rgba(255,255,255,0.03)", color:"#3a4a5a",
      cursor:"pointer", borderRadius:2, fontSize:11, padding:0,
      display:"inline-flex", alignItems:"center", justifyContent:"center", ...style,
    }}>{children}</button>
  );
}

// ─── PL 共有画面 ───────────────────────────────────────
// 実際の画像レンダリング領域を計算するフック
// マップ画像の自然サイズ: 1122x794 (ratio 1.413)
const MAP_NATURAL_W = 1200;
const MAP_NATURAL_H = 849;

function useMapBounds(containerRef) {
  const [bounds, setBounds] = useState({ left:0, top:0, width:0, height:0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const calc = () => {
      const cw = el.clientWidth, ch = el.clientHeight;
      // objectFit:contain + objectPosition:left top
      // → 短辺に合わせてスケール、左上原点で配置
      const scale = Math.min(cw / MAP_NATURAL_W, ch / MAP_NATURAL_H);
      const rw = MAP_NATURAL_W * scale;
      const rh = MAP_NATURAL_H * scale;
      // 横は left 基準（余白は右側）、縦は top 基準
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
function MapView({ gs, sceneData, isGm, upd, onSpotClick }) {
  const cycleIdx = gs.cycleIdx || 0;
  const isNight   = cycleIdx === 3;
  const isEvening = cycleIdx === 2;
  const [hov, setHov] = useState(null);
  const mapRef = useRef(null);
  const mapBounds = useMapBounds(mapRef);

  // スポットアイコンサイズをマップ実サイズに連動
  const scale = mapBounds.width > 0 ? mapBounds.width / MAP_NATURAL_W : 0.5;
  const baseSize = Math.round(22 * Math.max(0.5, Math.min(scale * 1.8, 1.4)));
  const bigSize  = Math.round(32 * Math.max(0.5, Math.min(scale * 1.8, 1.4)));
  const fontSize  = Math.max(8, Math.round(10 * scale * 1.4));

  if (gs.sceneMode) {
    return (
      <div style={{ position:"relative", width:"100%", height:"100%", overflow:"hidden", background:"#040608" }}>
        {sceneData.bg && (
          <img src={sceneData.bg} alt="" style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover", opacity:0.85 }} />
        )}
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
      {/* マップ画像 */}
      <img src={MAP_SRC} alt="幻想郷マップ" style={{ width:"100%", height:"100%", objectFit:"contain", objectPosition:"left top",
        filter:isNight?"brightness(0.45) saturate(0.5)":"none", transition:"filter 1.2s ease" }} />

      {/* 夕サイクル：オレンジオーバーレイ */}
      {isEvening && (
        <div style={{ position:"absolute", inset:0, pointerEvents:"none",
          background:"linear-gradient(180deg,rgba(180,80,0,0.12)0%,rgba(220,110,0,0.28)60%,rgba(160,50,0,0.18)100%)",
          mixBlendMode:"multiply", transition:"opacity 1.2s ease" }}/>
      )}

      {/* スポット */}
      {mapBounds.width > 0 && SPOTS.map(spot => {
        const isDream   = spot.id === null;
        const hasClue   = !isDream && gs.clues.includes(spot.id);
        const pcsHere   = !isDream ? (gs.pcs||[]).filter(pc => pc.currentSpot === spot.id) : [];
        const sx = mapBounds.left + (spot.x/100) * mapBounds.width;
        const sy = mapBounds.top  + (spot.y/100) * mapBounds.height;
        const isHov = hov === (spot.id ?? "dream");

        const iSize  = pcsHere.length ? bigSize : baseSize;
        // 手がかりはシアン（異世界オレンジと被らないよう変更）
        const clueColor = "#00e5ff";
        const borderCol = hasClue ? clueColor : pcsHere.length ? "#fff" : areaColor(spot.area).border;

        return (
          <div key={spot.id??""} style={{ position:"absolute", left:sx, top:sy,
            transform:"translate(-50%,-50%)", zIndex:hasClue?4:pcsHere.length?3:2,
            cursor: isGm&&!isDream ? "pointer" : "default" }}
            onMouseEnter={()=>setHov(spot.id??"dream")} onMouseLeave={()=>setHov(null)}
            onClick={()=>isGm&&!isDream&&onSpotClick&&onSpotClick(spot.id)}>
            <div style={{
              width:iSize, height:iSize, borderRadius:"50%",
              background: isDream ? "rgba(200,150,255,0.2)" : pcsHere.length ? "rgba(240,240,240,0.95)" : areaColor(spot.area).bg,
              border:`2px solid ${isDream?"#9c27b0":borderCol}`,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontWeight:"bold",
              fontSize: isDream ? fontSize-1 : fontSize,
              color: isDream ? "#ce93d8" : pcsHere.length ? areaColor(spot.area).bg : "#fff",
              boxShadow: hasClue ? `0 0 ${Math.round(10*scale*1.5)}px rgba(0,229,255,0.7)`
                       : pcsHere.length ? `0 0 ${Math.round(10*scale*1.5)}px ${areaColor(spot.area).border}`
                       : `0 0 ${Math.round(6*scale*1.5)}px ${areaColor(spot.area).border}60`,
              transition:"width 0.15s,height 0.15s",
            }}>
              {isDream ? "◇" : spot.id}
            </div>
            {/* 手がかりアイコン */}
            {hasClue && (
              <div style={{ position:"absolute", top:-Math.round(9*scale*1.4), right:-Math.round(9*scale*1.4),
                fontSize:Math.round(12*scale*1.4), filter:"drop-shadow(0 0 4px #00e5ff)" }}>💡</div>
            )}
            {/* ツールチップ */}
            {isHov && (
              <div style={{ position:"absolute", background:"rgba(6,8,14,0.97)", border:"1px solid #1e2535",
                borderRadius:4, padding:"4px 8px", fontSize:10, color:"#c8b89a", whiteSpace:"nowrap",
                pointerEvents:"none", zIndex:20,
                left:spot.x>60?"auto":"calc(100% + 6px)", right:spot.x>60?"calc(100% + 6px)":"auto",
                top:"50%", transform:"translateY(-50%)" }}>
                {isDream ? "◇ 夢の世界（ホバーで表示）" : `[${spot.id}] ${spot.name}`}
                {pcsHere.length>0 && <span style={{color:"#ef9a9a"}}><br/>{pcsHere.map(p=>p.name).join("・")}</span>}
                {hasClue && <span style={{color:clueColor}}><br/>💡 手がかりあり</span>}
              </div>
            )}
          </div>
        );
      })}

      {/* HUD：サイクル表示 */}
      <div style={{ position:"absolute", top:8, left:"50%", transform:"translateX(-50%)", display:"flex", gap:8 }}>
        {gs.sessionPhase !== "intro" && (
          <div style={{ padding:"4px 14px", background:"rgba(10,12,20,0.92)", border:`1px solid ${CYCLE_COLORS[cycleIdx]}40`, borderRadius:14, fontSize:12, color:CYCLE_COLORS[cycleIdx] }}>
            {gs.day}日目・{CYCLES[cycleIdx]}
          </div>
        )}
        {gs.sessionPhase === "intro" && (
          <div style={{ padding:"4px 14px", background:"rgba(10,12,20,0.92)", border:"1px solid #9c27b040", borderRadius:14, fontSize:12, color:"#ce93d8" }}>
            ✦ 導入フェイズ
          </div>
        )}
        {gs.limit && <div style={{ padding:"4px 10px", background:"rgba(10,12,20,0.92)", border:"1px solid #3a1a1a", borderRadius:14, fontSize:10, color:"#c0392b" }}>
          リミット: {gs.limit}
        </div>}
      </div>

      {/* クエスト一覧（左下） */}
      {(gs.quests||[]).length>0 && (
        <div style={{ position:"absolute", bottom:8, left:8, background:"rgba(6,8,14,0.92)", border:"1px solid #1e2535", borderRadius:6, padding:"8px 10px", maxWidth:200 }}>
          <div style={{ fontSize:9, color:"#2a3545", letterSpacing:2, marginBottom:4 }}>クエスト</div>
          {gs.quests.map(q => (
            <div key={q.id||q.name} style={{ fontSize:10, color:q.solved?"#4caf50":"#c8a040", marginBottom:2, textDecoration:q.solved?"line-through":"none" }}>
              【Lv.{q.level||1}】{q.name}
            </div>
          ))}
        </div>
      )}

      {/* エリア凡例（右下） */}
      <div style={{ position:"absolute", bottom:8, right:8, background:"rgba(6,8,14,0.88)", border:"1px solid #1e2535", borderRadius:6, padding:"6px 8px" }}>
        {Object.entries(AREA_COLORS).map(([area,c])=>(
          <div key={area} style={{ display:"flex", alignItems:"center", gap:5, marginBottom:2 }}>
            <div style={{ width:9, height:9, borderRadius:"50%", background:c.bg, border:`1px solid ${c.border}`, flexShrink:0 }} />
            <span style={{ fontSize:9, color:"#5a6575" }}>{area}</span>
          </div>
        ))}
      </div>

      {gs.banner && (
        <div style={{ position:"absolute", top:50, left:"50%", transform:"translateX(-50%)",
          background:"rgba(10,16,28,0.96)", border:"1px solid #1e3a5a",
          borderRadius:16, padding:"7px 20px", fontSize:12, color:"#60c0f0", whiteSpace:"nowrap" }}>
          {gs.banner}
        </div>
      )}
    </div>
  );
}

// ─── SESSION WRAPPER (部屋コードベース) ─────────────
function SessionApp({ roomCode, user }) {
  const [mode, setMode] = useState(null);
  const [gs, setGs] = useState(DEFAULT_GS);
  const [sceneData, setSceneData] = useState(DEFAULT_SCENE);
  const [synced, setSynced] = useState(false);
  const [room, setRoom] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [questBanner, setQuestBanner] = useState(null); // 新クエスト公開バナー

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
        // PCデータを初期化（まだなければ）
        if (myPlayer && myPlayer.role !== "gm" && r.phase === "explore") {
          // PCはSessionAppで管理
        }
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
          pcs: val.pcs || [], quests: val.quests || [],
          clues: val.clues || [], log: val.log || [],
        }));
      } else if (mode === "gm") {
        // 初期データを書き込む：room を Firebase から直接読んで確実に取得
        get(ref(db, `rooms/${roomCode}`)).then(roomSnap => {
          const r = roomSnap.exists() ? roomSnap.val() : null;
          const scenarioData = r?.scenarioData || null;
          const initGs = {
            ...DEFAULT_GS,
            sessionPhase: "intro",
            limit: r?.limit || r?.scenarioData?.limit || "3日目の夜",
            scenarioData,
            pcs: buildPcList(r),
          };
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

  // PCリストを準備フェイズのplayersデータから構築
  function buildPcList(r) {
    if (!r?.players) return [];
    return Object.values(r.players)
      .filter(p => p.role === "pl" && p.charId)
      .map(p => {
        // キャラクターデータからスキルを取得
        const charData = CHARACTERS.find(c => c.id === p.charId) || null;
        return {
        uid: p.uid, name: p.name,
        charId: p.charId, charName: p.charName,
        spriteRow: p.spriteRow ?? -1, spriteCol: p.spriteCol ?? -1,
        customPortrait: p.customPortrait || null,
        skillId: p.skillId || null, skillName: p.skillName || "",
        abilitySkill: charData?.abilitySkill || (p.charId?.startsWith("custom_") ? p.abilitySkill || null : null),
        danmakuSkill: charData?.danmakuSkill || null,
        resources: { ...DEFAULT_GS.resources,
          やる気:{cur:1,max:3}, 残り人数:{cur:2,max:5}, スペカ:{cur:1,max:5},
          グレイズ:{cur:0,max:5}, 霊力:{cur:0,max:30}, 攻撃力:{cur:1,max:1}
        },
        items: { お酒:0, 小銭:0, お守り:0, Pアイテム:0, 残機のかけら:0, スペカかけら:0, 妖器:0 },
        currentSpot: p.startSpot || null,
        log: [],
        }});
  }

  const upd = useCallback((fn) => {
    setGs(prev => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      set(ref(db, gsPath), next).catch(console.error);
      return next;
    });
  }, [gsPath]);

  const setSceneDataAndSync = useCallback((fn) => {
    setSceneData(prev => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      set(ref(db, scenePath), next).catch(console.error);
      return next;
    });
  }, [scenePath]);

  // pcsが空のときにroomから再構築（タイミングずれのフォールバック）
  useEffect(() => {
    if (!synced || !room || mode !== "gm") return;
    if ((gs.pcs || []).length === 0 && Object.values(room.players||{}).some(p=>p.role==="pl"&&p.charId)) {
      upd(p => ({ ...p, pcs: buildPcList(room) }));
    }
  }, [synced, room, mode]);

  // ── 探索フェイズへ移行 ────────────────────────────
  const doTransitionToExplore = () => {
    const scenario = gs.scenarioData;
    // 「探索フェイズ開始時公開」クエストを公開
    const startQuests = (scenario?.quests || []).filter(q => (q.unlockType||"start") === "start");
    // 手がかり配置：PCの人数/2 切り上げ箇所
    const pcCount = (gs.pcs||[]).length || 1;
    const clueCount = Math.ceil(pcCount / 2);
    const spots = SPOTS.filter(s => s.id !== null);
    const shuffled = [...spots].sort(() => Math.random()-0.5);
    const clueSpots = shuffled.slice(0, clueCount).map(s => s.id);

    upd(p => ({
      ...p,
      sessionPhase: "explore",
      day: 1, cycleIdx: 0,
      clues: clueSpots,
      quests: startQuests.map(q => ({ ...q, revealed: true, solved: false })),
      log: [`探索フェイズ開始。手がかりを${clueCount}箇所に配置。`, ...p.log],
    }));

    // 公開クエストバナー
    if (startQuests.length > 0) {
      setQuestBanner(startQuests);
      setTimeout(() => setQuestBanner(null), 6000);
    }
  };

  // ── 文々。新聞処理 ────────────────────────────────
  const doNewspaper = (paper) => {
    upd(p => ({ ...p, newspaper: paper, log: [`新聞[${paper.roll}]「${paper.title}」`, ...p.log] }));
  };

  // ── 手がかり配置 ─────────────────────────────────
  const doPlaceClue = () => {
    function rollD6(){return Math.floor(Math.random()*6)+1;}
    const val = Math.min(rollD6(),rollD6())*10 + Math.max(rollD6(),rollD6());
    const idx = val % SPOTS.filter(s=>s.id!==null).length;
    const spot = SPOTS.filter(s=>s.id!==null)[idx];
    if (!spot) return;
    upd(p => ({
      ...p, cluePlaced: true,
      clues: [...new Set([...p.clues, spot.id])],
      log: [`手がかりを[${spot.id}]${spot.name}に配置`, ...p.log],
    }));
  };

  // ── 霊力増加 ─────────────────────────────────────
  const doReiryoku = () => {
    const spot = SPOTS.find(s => s.id !== null);
    upd(p => ({
      ...p, reiryokuDone: true,
      log: ["霊力増加処理", ...p.log],
    }));
  };

  // ── サイクル進行 ──────────────────────────────────
  const doAdvanceCycle = () => {
    upd(p => {
      let day = p.day || 1;
      let cycleIdx = p.cycleIdx || 0;
      cycleIdx++;
      if (cycleIdx >= CYCLES.length) { cycleIdx = 0; day++; }
      // 朝になったらクエスト公開チェック（条件付き）
      let newQuests = [...(p.quests||[])];
      if (cycleIdx === 0) {
        const allQ = p.scenarioData?.quests || [];
        allQ.forEach(q => {
          if (newQuests.find(nq=>nq.id===q.id)) return;
          if (q.unlockType==="quest") {
            const ref = newQuests.find(nq=>nq.id===q.unlockQuestId&&nq.solved);
            if (ref) newQuests.push({...q,revealed:true,solved:false});
          }
        });
      }
      return {
        ...p, day, cycleIdx,
        newspaper: cycleIdx===0?null:p.newspaper,
        cluePlaced: cycleIdx===0?false:p.cluePlaced,
        reiryokuDone: cycleIdx===0?false:p.reiryokuDone,
        quests: newQuests,
        log: [`${day}日目・${CYCLES[cycleIdx]}サイクル開始`, ...p.log],
      };
    });
    setPendingAction(null);
  };

  // ── ロール選択フォールバック ───────────────────────
  if (!mode) return (
    <div style={{ background:"#040608", color:"#c8b89a", height:"100vh", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"serif" }}>
      <style>{`button:hover{opacity:0.82}`}</style>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:22, color:"#c8a040", letterSpacing:4, marginBottom:20 }}>幻想ナラトグラフ</div>
        <div style={{ display:"flex", gap:12, justifyContent:"center" }}>
          <button onClick={()=>setMode("gm")} style={{ padding:"12px 24px",cursor:"pointer",borderRadius:4,fontSize:12,background:"rgba(192,57,43,0.18)",border:"1px solid #8b1a1a",color:"#e07060" }}>🎲 GM画面</button>
          <button onClick={()=>setMode("pl")} style={{ padding:"12px 24px",cursor:"pointer",borderRadius:4,fontSize:12,background:"rgba(25,118,210,0.15)",border:"1px solid #0d47a1",color:"#64b5f6" }}>✦ PL共有画面</button>
        </div>
      </div>
    </div>
  );

  if (!synced) return (
    <div style={{ background:"#040608", height:"100vh", display:"flex", alignItems:"center", justifyContent:"center", color:"#3a4a5a", fontFamily:"serif", fontSize:12 }}>
      Firebase に接続中…
    </div>
  );

  // バックストーリー（導入フェイズ）
  if (gs.sessionPhase === "intro") {
    return <BackstoryScreen gs={gs} isGm={mode==="gm"} onProceed={doTransitionToExplore}/>;
  }

  // 探索フェイズ
  return (
    <div style={{ display:"flex", height:"100vh", overflow:"hidden", fontFamily:"serif" }}>
      <style>{`::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#1a1e2a} button:hover{opacity:0.83}`}</style>

      {/* 左：マップ */}
      <div style={{ flex:1, position:"relative", overflow:"hidden" }}>
        <MapView gs={gs} sceneData={sceneData} isGm={mode==="gm"} upd={upd}
          onSpotClick={null}/>
      </div>

      {/* 右：パネル */}
      <RightPanel
        gs={gs} upd={upd}
        sceneData={sceneData} setSceneData={setSceneDataAndSync}
        isGm={mode==="gm"} user={user} room={room}
        CYCLES={CYCLES} CYCLE_COLORS={CYCLE_COLORS} NEWSPAPER={NEWSPAPER}
        getSpot={getSpot}
        doNewspaper={doNewspaper}
        doPlaceClue={doPlaceClue}
        doAdvanceCycle={doAdvanceCycle}
        doReiryoku={doReiryoku}
        doTransitionToExplore={doTransitionToExplore}
        pendingAction={pendingAction}
        setPendingAction={setPendingAction}
      />

      {/* 新クエスト公開バナー */}
      {questBanner && (
        <div style={{ position:"fixed", top:0, left:0, right:0, zIndex:200, background:"rgba(6,8,16,0.97)",
          borderBottom:"1px solid #1e3a5a", padding:"16px 24px", animation:"fadeUp 0.3s ease" }}>
          <div style={{ fontSize:11, color:"#4a6080", letterSpacing:3, marginBottom:8 }}>✦ クエスト公開</div>
          <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
            {questBanner.map(q=>(
              <div key={q.id||q.name} style={{ padding:"8px 14px", background:"rgba(200,160,64,0.12)",
                border:"1px solid #8b6914", borderRadius:5 }}>
                <div style={{ fontSize:12, color:"#c8a040" }}>【Lv.{q.level}】{q.name}</div>
                <div style={{ fontSize:10, color:"#6a7a90", marginTop:2 }}>{q.summary}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 確認モーダル */}
      {pendingAction && (
        <ConfirmModal
          title={pendingAction==="advance" ? "サイクルを進めますか？"
               : pendingAction==="placeClue" ? "手がかりを配置しますか？"
               : "探索フェイズへ移行しますか？"}
          body={pendingAction==="advance"
               ? `${gs.day}日目・${CYCLES[gs.cycleIdx||0]} → 次のフェーズへ進みます。\nスキルや処理の確認をお忘れなく。`
               : pendingAction==="placeClue"
               ? "ランダムなスポットに手がかりを1つ配置します。"
               : "バックストーリーを経て探索フェイズへ移行します。\n開始時クエストが公開されます。"}
          okLabel="進む"
          onOk={pendingAction==="advance" ? doAdvanceCycle
              : pendingAction==="placeClue" ? ()=>{doPlaceClue();setPendingAction(null);}
              : ()=>{doTransitionToExplore();setPendingAction(null);}}
          onCancel={()=>setPendingAction(null)}
        />
      )}
    </div>
  );
}

// ─── ROOT ────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(undefined);
  const [roomCode, setRoomCode] = useState(null);
  const [roomPhase, setRoomPhase] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const r = params.get("room");
    if (r) setRoomCode(r.toUpperCase());
    const unsub = onAuthStateChanged(auth, u => setUser(u || null));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!roomCode || !user) return;
    const r = ref(db, `rooms/${roomCode}/phase`);
    const unsub = onValue(r, snap => { if (snap.exists()) setRoomPhase(snap.val()); });
    return () => unsub();
  }, [roomCode, user]);

  if (user === undefined) return (
    <div style={{ background:"#040608", height:"100vh", display:"flex", alignItems:"center", justifyContent:"center", color:"#3a4a5a", fontFamily:"serif", fontSize:12 }}>接続中…</div>
  );

  if (!user) return <LobbyRoot />;
  if (!roomCode) return <LobbyRoot />;

  if (roomPhase === null) return (
    <div style={{ background:"#040608", height:"100vh", display:"flex", alignItems:"center", justifyContent:"center", color:"#3a4a5a", fontFamily:"serif", fontSize:12 }}>部屋情報を取得中…</div>
  );

  if (roomPhase === "prep") return <LobbyRoot />;

  return <SessionApp roomCode={roomCode} user={user} />;
}
