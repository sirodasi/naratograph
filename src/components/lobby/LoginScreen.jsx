import { useState } from "react";
import { auth, googleProvider } from "../../firebase";
import { signInWithPopup } from "firebase/auth";
import { COLORS, COMMON_STYLES } from "../../styles/theme";

export default function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const login = async () => {
    setLoading(true);
    setErr(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      setErr(e.message);
      setLoading(false);
    }
  };

  return (
    <div style={{ background: COLORS.bg, height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "serif", color: COLORS.text }}>
      <style>{`@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div style={{ textAlign: "center", animation: "fadeUp 0.5s ease" }}>
        <div style={{ fontSize: 9, letterSpacing: 7, color: COLORS.textFaint, marginBottom: 6 }}>TRPG SESSION SUPPORT</div>
        <div style={{ fontSize: 24, color: COLORS.gold, letterSpacing: 5, marginBottom: 3 }}>幻想ナラトグラフ</div>
        <div style={{ fontSize: 11, color: COLORS.textDim, marginBottom: 36 }}>セッション支援システム</div>
        <button 
          onClick={login} 
          disabled={loading} 
          style={COMMON_STYLES.btn("rgba(66,133,244,0.2)", "#4285f4", "#8ab4f8", { padding: "12px 28px", fontSize: 13 })}
        >
          {loading ? "接続中…" : "🔑 Googleアカウントでログイン"}
        </button>
        {err && <div style={{ marginTop: 12, fontSize: 10, color: COLORS.red }}>{err}</div>}
      </div>
    </div>
  );
}