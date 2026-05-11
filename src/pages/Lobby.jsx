import { useState, useEffect } from "react";
import { auth } from "./firebase";
import { onAuthStateChanged } from "firebase/auth";

import LoginScreen from "./components/lobby/LoginScreen";
import RoomSelection from "./components/lobby/RoomSelection";
import PrepRoom from "./components/lobby/PrepRoom";
import { LoadingScreen } from "./components/common/LoadingScreen";

export default function LobbyRoot() {
  const [user, setUser] = useState(undefined);
  const [roomCode, setRoomCode] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const r = params.get("room");
    if (r) setRoomCode(r.toUpperCase());

    return onAuthStateChanged(auth, u => setUser(u || null));
  }, []);

  if (user === undefined) return <LoadingScreen message="認証情報を確認中..." />;
  if (!user) return <LoginScreen />;

  // URLに部屋コードがある場合は準備室へ、なければ部屋選択へ
  if (roomCode) {
    return (
      <PrepRoom 
        roomCode={roomCode} 
        user={user} 
        isGm={false} /* 内部でgmUidを確認して判定するようにPrepRoom側で実装 */ 
      />
    );
  }

  return (
    <RoomSelection 
      user={user} 
      displayName={user.displayName || "名無しの人間"} 
    />
  );
}