import { useState, useEffect, useCallback } from "react";
import { db, auth } from "./firebase";
import { ref, onValue, set, get } from "firebase/database";
import { onAuthStateChanged } from "firebase/auth";

// データ・定数
import { SPOTS, CYCLES } from "./data/gameData";
import { CHARACTERS } from "./data/characters";

// 共通コンポーネント
import LobbyRoot from "./pages/Lobby";
import { LoadingScreen } from "./components/common/LoadingScreen";

// セッション用コンポーネント
import { SessionView } from "./pages/SessionView";
import { INIT_RESOURCES, INIT_ITEMS, getSpotByName } from "./data/gameData";

// ─── ユーティリティ ─────────────────────────────────────────────

function buildPcList(r) {
  if (!r?.players) return [];
  return Object.values(r.players)
    .filter(p => p.role === "pl" && p.charId)
    .map(p => {
      const charData = CHARACTERS.find(c => c.id === p.charId) ?? null;
      const charBase = charData?.base ?? p.base ?? "人間の里";
      const baseSpot = getSpotByName(charBase);
      const baseSpotId = baseSpot?.id ?? "11";

      let startSpotId = r?.scenarioData?.startSpotId ?? null;
      if (r?.scenarioData?.startSpotType === "base") startSpotId = baseSpotId;

      return {
        uid: p.uid,
        name: p.name,
        charId: p.charId,
        charName: p.charName,
        bonds: [], badStatus: [], flags: {},
        spriteRow: p.spriteRow ?? -1,
        spriteCol: p.spriteCol ?? -1,
        customPortrait: p.customPortrait ?? null,
        skillId: p.skillId ?? null,
        skillName: p.skillName ?? "",
        resources: INIT_RESOURCES(),
        items: INIT_ITEMS(),
        baseSpotId,
        currentSpot: startSpotId ?? "11",
        log: [],
      };
    });
}

// ─── SessionApp (進行管理) ──────────────────────────────────────

function SessionApp({ roomCode, user }) {
  const [gs, setGs] = useState(null);
  const [sceneData, setSceneData] = useState({ bg: null, portraits: [] });
  const [room, setRoom] = useState(null);
  const [mode, setMode] = useState(null);

  const gsPath = `rooms/${roomCode}/state`;
  const scenePath = `rooms/${roomCode}/scene`;

  // 購読設定
  useEffect(() => {
    const unsubRoom = onValue(ref(db, `rooms/${roomCode}`), snap => {
      const r = snap.val();
      setRoom(r);
      if (r?.players?.[user.uid] && !mode) {
        setMode(r.players[user.uid].role === "gm" ? "gm" : "pl");
      }
    });
    const unsubGs = onValue(ref(db, gsPath), snap => {
      if (snap.exists()) setGs(snap.val());
      else if (mode === "gm") {
        // 初期化
        get(ref(db, `rooms/${roomCode}`)).then(s => {
          const r = s.val();
          set(ref(db, gsPath), {
            sessionPhase: "intro",
            day: 1, cycleIdx: 0,
            pcs: buildPcList(r),
            log: ["セッションを開始しました"],
            clues: [], quests: [],
            scenarioData: r.scenarioData || null
          });
        });
      }
    });
    const unsubScene = onValue(ref(db, scenePath), snap => {
      if (snap.exists()) setSceneData(snap.val());
    });
    return () => { unsubRoom(); unsubGs(); unsubScene(); };
  }, [roomCode, user.uid, mode]);

  const upd = useCallback((fn) => {
    const next = typeof fn === "function" ? fn(gs) : fn;
    set(ref(db, gsPath), next);
  }, [gs, gsPath]);

  const setSceneSync = useCallback((fn) => {
    const next = typeof fn === "function" ? fn(sceneData) : fn;
    set(ref(db, scenePath), next);
  }, [sceneData, scenePath]);

  if (!gs || !mode) return <LoadingScreen message="セッションデータを読み込み中..." />;

  return (
    <SessionView 
      gs={gs} 
      upd={upd} 
      sceneData={sceneData} 
      setSceneData={setSceneSync} 
      isGm={mode === "gm"} 
      user={user} 
      room={room} 
    />
  );
}

// ─── App (ルート) ─────────────────────────────────────────────

export default function App() {
  const [user, setUser] = useState(undefined);
  const [roomCode, setRoomCode] = useState(null);
  const [roomPhase, setRoomPhase] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const r = params.get("room");
    if (r) setRoomCode(r.toUpperCase());
    return onAuthStateChanged(auth, u => setUser(u || null));
  }, []);

  useEffect(() => {
    if (!roomCode) return;
    return onValue(ref(db, `rooms/${roomCode}`), snap => {
      setRoomPhase(snap.exists() ? (snap.val().phase || "prep") : "error");
    });
  }, [roomCode]);

  if (user === undefined) return <LoadingScreen message="接続中..." />;
  if (!user || !roomCode) return <LobbyRoot />;
  if (roomPhase === "error") return <LoadingScreen message="部屋が見つかりません" color="#e07060" />;
  if (roomPhase === "prep") return <LobbyRoot />;

  return <SessionApp roomCode={roomCode} user={user} />;
}