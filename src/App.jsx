import { useState, useEffect, lazy, Suspense } from "react";
import { db, auth } from "./firebase";
import { ref, onValue } from "firebase/database";
import { onAuthStateChanged } from "firebase/auth";
import { useUrlParams } from "./useUrlParams";
import { motion } from "./motion";
import { fontScale } from "./fontScale";

// ルートは「認証・部屋の phase の監視・ロビー／セッションの振り分け」だけにして、
// ロビー（Lobby.jsx）とセッション（SessionApp.jsx）は必要になってから読み込む（初回表示を軽くする）。
const LobbyRoot  = lazy(() => import("./Lobby"));
const SessionApp = lazy(() => import("./SessionApp"));

const LoadingScreen = ({ message, color = "#3a4a5a" }) => (
  <div style={{ background: "#040608", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color, fontFamily: "'Noto Serif JP', serif", fontSize: 12 }}>{message}</div>
);

export default function App() {
  const [user, setUser]           = useState(undefined);
  const [roomPhase, setRoomPhase] = useState(null);

  const [urlParams] = useUrlParams();
  const roomCode = urlParams.get("room")?.toUpperCase() || null;

  useEffect(() => {
    motion.init();  // 演出抑制の <html> 属性反映 + OS設定変化の監視
    fontScale.init();  // 文字サイズ（body zoom）の反映

    const unsub = onAuthStateChanged(auth, u => setUser(u || null));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!roomCode) return;
    // phase だけを購読（部屋全体を購読すると state・画像まで受け取るため）。phase が無い＝部屋削除済み。
    const roomRef = ref(db, `rooms/${roomCode}/phase`);
    const unsub   = onValue(roomRef, snap => {
      if (!snap.exists()) {
        try {
          const p = new URLSearchParams(window.location.search);
          p.delete("room");
          const qs = p.toString() ? "?" + p.toString() : "";
          window.history.replaceState(null, "", window.location.pathname + qs);
          window.dispatchEvent(new Event("popstate"));
        } catch { /* noop */ }
        setRoomPhase(null);
        return;
      }
      setRoomPhase(snap.val() || "prep");
    });
    return () => unsub();
  }, [roomCode]);

  if (user === undefined)   return <LoadingScreen message="接続中…" />;
  if (roomPhase === "error") return <LoadingScreen message="ルームが見つかりません。セッション終了済みか、URLをご確認ください。" color="#e07060" />;
  if (user && roomCode && roomPhase === null) return <LoadingScreen message="部屋情報を取得中…" />;

  // 遅延読み込み中の画面（Lobby / セッションの各画面）はここで受ける
  return (
    <Suspense fallback={<LoadingScreen message="読み込み中…" />}>
      {(!user || !roomCode || roomPhase === "prep")
        ? <LobbyRoot />
        : <SessionApp roomCode={roomCode} user={user} />}
    </Suspense>
  );
}