import { useState } from "react";
import { db } from "../../firebase";
import { ref, set, get, update } from "firebase/database";
import { COLORS, COMMON_STYLES } from "../../styles/theme";

export default function RoomSelection({ user, displayName, onProfile }) {
  const [view, setView] = useState("top");
  const [joinCode, setJoinCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const createRoom = async () => {
    setLoading(true);
    const code = Math.random().toString(36).slice(2, 7).toUpperCase();
    try {
      await set(ref(db, `rooms/${code}`), {
        gmUid: user.uid, gmName: displayName, createdAt: Date.now(),
        phase: "prep",
        players: { [user.uid]: { uid: user.uid, name: displayName, role: "gm", ready: false } }
      });
      window.location.search = `?room=${code}`;
    } catch (e) { setErr(e.message); }
    setLoading(false);
  };

  const joinRoom = async () => {
    if (!joinCode.trim()) return;
    setLoading(true);
    const code = joinCode.trim().toUpperCase();
    try {
      const snap = await get(ref(db, `rooms/${code}`));
      if (!snap.exists()) { setErr("部屋が見つかりません"); setLoading(false); return; }
      await update(ref(db, `rooms/${code}/players/${user.uid}`), { uid: user.uid, name: displayName, role: "pl", ready: false });
      window.location.search = `?room=${code}`;
    } catch (e) { setErr(e.message); }
    setLoading(false);
  };

  return (
    <div style={{ background: COLORS.bg, height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "serif", color: COLORS.text }}>
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ fontSize: 22, color: COLORS.gold, letterSpacing: 4, marginBottom: 6 }}>幻想ナラトグラフ</div>
        <div style={{ fontSize: 12, color: COLORS.textDim }}>ようこそ、{displayName}さん</div>
      </div>

      {view === "top" && (
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={() => setView("create")} style={COMMON_STYLES.btn(COLORS.redBg, COLORS.redBorder, COLORS.red, { padding: "14px 28px" })}>🎲 GMとして部屋を作る</button>
          <button onClick={() => setView("join")} style={COMMON_STYLES.btn(COLORS.blueBg, COLORS.blueBorder, COLORS.blue, { padding: "14px 28px" })}>✦ 部屋に参加する</button>
        </div>
      )}

      {view === "create" && (
        <div style={{ textAlign: "center" }}>
          <button onClick={createRoom} disabled={loading} style={COMMON_STYLES.btn(COLORS.redBg, COLORS.redBorder, COLORS.red, { padding: "12px 32px" })}>作成する</button>
          <br/><button onClick={() => setView("top")} style={{ background: "none", border: "none", color: COLORS.textFaint, marginTop: 10, cursor: "pointer" }}>← 戻る</button>
        </div>
      )}

      {view === "join" && (
        <div style={{ textAlign: "center" }}>
          <input value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())} placeholder="CODE" maxLength={5} style={{ ...COMMON_STYLES.input, textAlign: "center", fontSize: 20, letterSpacing: 6, width: 140, marginBottom: 12 }} />
          <br/><button onClick={joinRoom} style={COMMON_STYLES.btn(COLORS.blueBg, COLORS.blueBorder, COLORS.blue, { padding: "10px 28px" })}>参加する</button>
          <br/><button onClick={() => setView("top")} style={{ background: "none", border: "none", color: COLORS.textFaint, marginTop: 10, cursor: "pointer" }}>← 戻る</button>
        </div>
      )}
      {err && <div style={{ color: COLORS.red, fontSize: 11, marginTop: 12 }}>{err}</div>}
    </div>
  );
}