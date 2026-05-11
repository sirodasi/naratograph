import { useState, useEffect, useRef } from "react";
import { db, auth, googleProvider } from "./firebase";
import { ref, onValue, set, update, get } from "firebase/database";
import { signInWithPopup, onAuthStateChanged, signOut, updateProfile } from "firebase/auth";
import ProfilePage, { ScenarioSelector } from "./ScenarioEditor";
import spriteImg from "./assets/sprite.png";
import { CHARACTERS, PERSONALITY_SKILLS } from "./data/characters";
import { C, btn, iStyle } from "./styles/colors";

export const SPRITE_SRC  = spriteImg;
export const CELL        = 120;
export const SPRITE_COLS = 10;

export { CHARACTERS, PERSONALITY_SKILLS };

// ─── ユーティリティ ──────────────────────────────────────────────

function rollD6()  { return Math.floor(Math.random() * 6) + 1; }
function rollD66() { const a = rollD6(), b = rollD6(); return Math.min(a, b) * 10 + Math.max(a, b); }

// ─── CharSprite ──────────────────────────────────────────────────

export function CharSprite({ spriteRow, spriteCol, size = 80, style = {} }) {
  if (spriteRow < 0 || spriteCol < 0) {
    return (
      <div style={{ width: size, height: size, borderRadius: 4, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.4, flexShrink: 0, ...style }}>
        🌸
      </div>
    );
  }
  const scale = size / CELL;
  return (
    <div style={{ width: size, height: size, overflow: "hidden", flexShrink: 0, borderRadius: 4, ...style }}>
      <div style={{
        width:              CELL * SPRITE_COLS * scale,
        height:             CELL * 6 * scale,
        backgroundImage:    `url(${SPRITE_SRC})`,
        backgroundSize:     `${CELL * SPRITE_COLS * scale}px ${CELL * 6 * scale}px`,
        backgroundPosition: `${-spriteCol * CELL * scale}px ${-spriteRow * CELL * scale}px`,
        backgroundRepeat:   "no-repeat",
      }} />
    </div>
  );
}

// ─── LoginScreen ─────────────────────────────────────────────────

function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState(null);

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
    <div style={{ background: "#040608", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "serif", color: C.text }}>
      <style>{`@keyframes fadeUp { from { opacity: 0; transform: translateY(16px) } to { opacity: 1; transform: translateY(0) } } button:hover { opacity: 0.82 }`}</style>
      <div style={{ textAlign: "center", animation: "fadeUp 0.5s ease" }}>
        <div style={{ fontSize: 9, letterSpacing: 7, color: C.textFaint, marginBottom: 6 }}>TRPG SESSION SUPPORT</div>
        <div style={{ fontSize: 24, color: C.gold, letterSpacing: 5, marginBottom: 3 }}>幻想ナラトグラフ</div>
        <div style={{ fontSize: 11, color: C.textDim, marginBottom: 36 }}>セッション支援システム</div>
        <button onClick={login} disabled={loading} style={{ ...btn("rgba(66,133,244,0.2)", "#4285f4", "#8ab4f8", { padding: "12px 28px", fontSize: 13 }) }}>
          {loading ? "接続中…" : "🔑 Googleアカウントでログイン"}
        </button>
        {err && <div style={{ marginTop: 12, fontSize: 10, color: C.red }}>{err}</div>}
      </div>
    </div>
  );
}

// ─── UsernameSetup ───────────────────────────────────────────────

function UsernameSetup({ user, onDone }) {
  const [name, setName]     = useState(user.displayName || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await updateProfile(user, { displayName: name.trim() }).catch(() => {});
    onDone(name.trim());
  };

  return (
    <div style={{ background: "#040608", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "serif", color: C.text }}>
      <div style={{ textAlign: "center", maxWidth: 320 }}>
        <div style={{ fontSize: 20, color: C.gold, letterSpacing: 3, marginBottom: 4 }}>幻想ナラトグラフ</div>
        <div style={{ fontSize: 11, color: C.textDim, marginBottom: 24 }}>セッションで使用する名前を設定してください</div>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="例: アリス"
          style={{ ...iStyle, textAlign: "center", fontSize: 16, letterSpacing: 2, marginBottom: 12 }}
          onKeyDown={e => e.key === "Enter" && save()}
          autoFocus
        />
        <button onClick={save} disabled={saving || !name.trim()} style={{ ...btn(C.goldBg, C.goldDim, C.gold, { width: "100%", padding: "9px" }) }}>
          {saving ? "保存中…" : "この名前で始める"}
        </button>
      </div>
    </div>
  );
}

// ─── Lobby ───────────────────────────────────────────────────────

function Lobby({ user, displayName, onProfile }) {
  const [view, setView]       = useState("top");
  const [joinCode, setJoinCode] = useState("");
  const [err, setErr]         = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied]   = useState(false);

  const createRoom = async () => {
    setLoading(true);
    setErr("");
    const code = Math.random().toString(36).slice(2, 7).toUpperCase();
    try {
      await set(ref(db, `rooms/${code}`), {
        gmUid: user.uid, gmName: displayName, createdAt: Date.now(),
        scenario: "", phase: "prep",
        players: { [user.uid]: { uid: user.uid, name: displayName, role: "gm", ready: false } },
        state: null, scene: null,
      });
      window.history.pushState({}, "", `?room=${code}`);
      window.location.reload();
    } catch (e) {
      setErr(e.message);
    }
    setLoading(false);
  };

  const joinRoom = async () => {
    if (!joinCode.trim()) return;
    setLoading(true);
    setErr("");
    const code = joinCode.trim().toUpperCase();
    try {
      const snap = await get(ref(db, `rooms/${code}`));
      if (!snap.exists()) { setErr("部屋が見つかりません"); setLoading(false); return; }
      await update(ref(db, `rooms/${code}/players/${user.uid}`), { uid: user.uid, name: displayName, role: "pl", ready: false });
      window.history.pushState({}, "", `?room=${code}`);
      window.location.reload();
    } catch (e) {
      setErr(e.message);
    }
    setLoading(false);
  };

  return (
    <div style={{ background: "#040608", height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "serif", color: C.text }}>
      <style>{`button:hover { opacity: 0.82 }`}</style>

      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ fontSize: 22, color: C.gold, letterSpacing: 4, marginBottom: 6 }}>幻想ナラトグラフ</div>
        <div style={{ fontSize: 12, color: C.textDim }}>ようこそ、{displayName}さん</div>
      </div>

      {view === "top" && (
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={() => setView("create")} style={{ ...btn(C.redBg, C.redBorder, C.red, { padding: "14px 28px" }) }}>🎲 GMとして部屋を作る</button>
          <button onClick={() => setView("join")}   style={{ ...btn(C.blueBg, C.blueBorder, C.blue, { padding: "14px 28px" }) }}>✦ 部屋に参加する</button>
        </div>
      )}

      {view === "create" && (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 16 }}>GMとして新しいセッションを開始します</div>
          <button onClick={createRoom} disabled={loading} style={{ ...btn(C.redBg, C.redBorder, C.red, { padding: "12px 32px" }) }}>
            {loading ? "作成中…" : "部屋を作成する"}
          </button>
          <br />
          <button onClick={() => setView("top")} style={{ ...btn("none", "none", C.textFaint, { marginTop: 10, fontSize: 11 }) }}>← 戻る</button>
        </div>
      )}

      {view === "join" && (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 12 }}>GMから共有された部屋コードを入力してください</div>
          <input
            value={joinCode}
            onChange={e => setJoinCode(e.target.value.toUpperCase())}
            placeholder="例: XK7F2"
            maxLength={5}
            style={{ ...iStyle, textAlign: "center", fontSize: 20, letterSpacing: 6, width: 160, marginBottom: 10 }}
            onKeyDown={e => e.key === "Enter" && joinRoom()}
          />
          <br />
          <button onClick={joinRoom} disabled={loading || !joinCode.trim()} style={{ ...btn(C.blueBg, C.blueBorder, C.blue, { padding: "10px 28px", opacity: joinCode.trim() ? 1 : 0.4 }) }}>
            {loading ? "確認中…" : "参加する"}
          </button>
          <br />
          <button onClick={() => setView("top")} style={{ ...btn("none", "none", C.textFaint, { marginTop: 10, fontSize: 11 }) }}>← 戻る</button>
        </div>
      )}

      {err && <div style={{ marginTop: 14, fontSize: 11, color: C.red }}>{err}</div>}

      <div style={{ position: "absolute", top: 12, right: 16, display: "flex", gap: 6 }}>
        <button onClick={onProfile} style={{ ...btn("rgba(255,255,255,0.03)", C.border, C.textDim, { padding: "3px 12px", fontSize: 10 }) }}>📋 プロフィール</button>
        <button onClick={() => signOut(auth)} style={{ ...btn("none", C.border, C.textFaint, { padding: "3px 12px", fontSize: 10 }) }}>ログアウト</button>
      </div>
    </div>
  );
}

// ─── PrepRoom ────────────────────────────────────────────────────

// カスタムキャラクターの初期フォーム状態
const CUSTOM_INIT = {
  name: "", tags: "", base: "",
  abilitySkillName: "", abilitySkillType: "アクション", abilitySkillDesc: "",
  danmakuSkillName: "", danmakuSkillDesc: "",
  sc1name: "", sc1desc: "", sc2name: "", sc2desc: "",
  portrait: null,
};

function PrepRoom({ roomCode, user, displayName, isGm }) {
  const [room, setRoom]                   = useState(null);
  const [step, setStep]                   = useState("charSelect");
  const [selectedScenario, setSelectedScenario] = useState(null);
  const [showProfile, setShowProfile]     = useState(false);
  const [selectedChar, setSelectedChar]   = useState(null);
  const [selectedSkillId, setSelectedSkillId] = useState(null);
  const [diceResult, setDiceResult]       = useState(null);
  const [diceAnim, setDiceAnim]           = useState(false);
  const [scenario, setScenario]           = useState("");
  const [customForm, setCustomForm]       = useState(false);
  const [custom, setCustom]               = useState(CUSTOM_INIT);
  const [copied, setCopied]               = useState(false);
  const timerRef = useRef(null);

  // 部屋データ購読
  useEffect(() => {
    const r     = ref(db, `rooms/${roomCode}`);
    const unsub = onValue(r, snap => {
      if (snap.exists()) {
        const v = snap.val();
        setRoom(v);
        if (v.scenario) setScenario(v.scenario);
      }
    });
    return () => unsub();
  }, [roomCode]);

  // セッション開始後はリロードして SessionApp へ遷移
  useEffect(() => {
    if (room?.phase === "explore") window.location.reload();
  }, [room?.phase]);

  // ダイスロール（アニメーション付き）
  const rollSkill = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setDiceAnim(true);
    let frame = 0;
    timerRef.current = setInterval(() => {
      frame++;
      setDiceResult([rollD6(), rollD6()]);
      if (frame >= 14) {
        clearInterval(timerRef.current);
        const a = rollD6(), b = rollD6();
        const lo = Math.min(a, b), hi = Math.max(a, b);
        setDiceResult([lo, hi]);
        setDiceAnim(false);
        setSelectedSkillId(lo * 10 + hi);
      }
    }, 80);
  };

  const confirmChar = async () => {
    if (!selectedChar) return;
    await update(ref(db, `rooms/${roomCode}/players/${user.uid}`), {
      charId:        selectedChar.id,
      charName:      selectedChar.name,
      spriteRow:     selectedChar.spriteRow ?? -1,
      spriteCol:     selectedChar.spriteCol ?? -1,
      base:          selectedChar.base || "人間の里",
      customPortrait: selectedChar.customPortrait || null,
      abilitySkill:  selectedChar.abilitySkill || null,
      danmakuSkill:  selectedChar.danmakuSkill || null,
    });
    setStep("skillSelect");
  };

  const confirmSkill = async () => {
    if (!selectedSkillId) return;
    const skill = PERSONALITY_SKILLS[selectedSkillId];
    await update(ref(db, `rooms/${roomCode}/players/${user.uid}`), {
      skillId:   selectedSkillId,
      skillName: skill?.name || "",
      ready:     true,
    });
    setStep("ready");
  };

  const addCustom = () => {
    const c = {
      id:            "custom_" + Date.now(),
      name:          custom.name || "カスタムキャラ",
      spriteRow:     -1,
      spriteCol:     -1,
      customPortrait: custom.portrait || null,
      tags:          custom.tags.split(/[、,]/).map(t => t.trim()).filter(Boolean),
      base:          custom.base,
      abilitySkill:  { name: custom.abilitySkillName, type: custom.abilitySkillType, desc: custom.abilitySkillDesc },
      danmakuSkill:  { name: custom.danmakuSkillName, desc: custom.danmakuSkillDesc },
      spellCards:    [
        custom.sc1name && `${custom.sc1name}${custom.sc1desc ? " " + custom.sc1desc : ""}`,
        custom.sc2name && `${custom.sc2name}${custom.sc2desc ? " " + custom.sc2desc : ""}`,
      ].filter(Boolean),
      growthAbility: {},
      growthSpellCard: "",
    };
    setSelectedChar(c);
    setCustomForm(false);
  };

  const uploadPortrait = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setCustom(p => ({ ...p, portrait: ev.target.result }));
    reader.readAsDataURL(file);
  };

  const copyUrl = () => {
    navigator.clipboard.writeText(window.location.origin + "?room=" + roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const startSession = async () => update(ref(db, `rooms/${roomCode}`), { phase: "explore" });
  const allReady     = room && Object.values(room.players || {}).filter(p => p.role !== "gm").every(p => p.ready);
  const skillEntry   = selectedSkillId ? PERSONALITY_SKILLS[selectedSkillId] : null;

  // ローカルスタイル定数
  const S = {
    root: { background: C.bg, minHeight: "100vh", fontFamily: "serif", color: C.text, padding: 16 },
    card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: 16, marginBottom: 12 },
    h2:   { fontSize: 13, color: C.gold, letterSpacing: 2, marginBottom: 10 },
    sec:  { fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid #111828`, paddingBottom: 3, marginBottom: 8, marginTop: 6 },
  };

  if (!room) return (
    <div style={{ ...S.root, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: C.textDim }}>
      読み込み中…
    </div>
  );

  return (
    <div style={S.root}>
      <style>{`button:hover { opacity: 0.82 } @keyframes spin { 50% { transform: scale(1.12) } } ::-webkit-scrollbar { width: 3px } ::-webkit-scrollbar-thumb { background: #1a1e2a } input, textarea, select { outline: none }`}</style>

      {/* ヘッダー */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <span style={{ fontSize: 14, color: C.gold, letterSpacing: 2 }}>幻想ナラトグラフ</span>
          <span style={{ fontSize: 10, color: C.textDim, marginLeft: 10 }}>準備フェイズ</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ padding: "3px 12px", background: C.goldBg, border: `1px solid ${C.goldDim}`, borderRadius: 12, fontSize: 11, color: C.gold, letterSpacing: 2 }}>
            部屋コード: {roomCode}
          </div>
          <button onClick={copyUrl} style={{ ...btn("rgba(255,255,255,0.04)", C.border, copied ? "#4caf50" : C.textDim, { padding: "3px 10px", fontSize: 10 }) }}>
            {copied ? "✓ コピーしました" : "URLをコピー"}
          </button>
          <button onClick={() => signOut(auth)} style={{ ...btn("none", C.border, C.textFaint, { padding: "3px 10px", fontSize: 10 }) }}>ログアウト</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {/* 左列 */}
        <div style={{ flex: "0 0 260px" }}>
          {isGm && (
            <div style={S.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={S.h2}>① シナリオ</div>
                <button onClick={() => setShowProfile(true)} style={{ ...btn("rgba(255,255,255,0.03)", C.border, C.textDim, { padding: "2px 8px", fontSize: 9 }) }}>📋 管理</button>
              </div>
              <ScenarioSelector value={selectedScenario} onChange={sc => {
                setSelectedScenario(sc);
                update(ref(db, `rooms/${roomCode}`), {
                  scenario:     sc.name,
                  scenarioId:   sc.id,
                  limit:        sc.limit || "3日目の夜",
                  scenarioData: sc,
                });
              }} />
            </div>
          )}

          <div style={S.card}>
            <div style={S.h2}>参加者</div>
            {Object.values(room.players || {}).map(p => (
              <div key={p.uid} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #0d1018" }}>
                {p.customPortrait
                  ? <img src={p.customPortrait} style={{ width: 40, height: 40, objectFit: "contain", borderRadius: 4, background: "rgba(255,255,255,0.04)" }} />
                  : <CharSprite spriteRow={p.spriteRow ?? -1} spriteCol={p.spriteCol ?? -1} size={40} />
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: p.role === "gm" ? "#e07060" : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.name}{p.role === "gm" ? " (GM)" : ""}
                  </div>
                  {p.charName && (
                    <div style={{ fontSize: 9, color: C.textDim }}>{p.charName}{p.skillName ? ` / 《${p.skillName}》` : ""}</div>
                  )}
                </div>
                <div style={{ fontSize: 9, color: p.ready ? "#4caf50" : C.textFaint, flexShrink: 0 }}>{p.ready ? "✓" : "…"}</div>
              </div>
            ))}
          </div>

          {isGm && (
            <div style={S.card}>
              <div style={{ fontSize: 10, color: allReady ? "#4caf50" : C.textDim, marginBottom: 8 }}>
                {allReady ? "全員準備完了！" : "PLの準備を待っています…"}
              </div>
              <button
                onClick={startSession}
                disabled={!allReady}
                style={{ ...btn(allReady ? C.redBg : "rgba(255,255,255,0.02)", allReady ? C.redBorder : C.border, allReady ? C.red : C.textFaint, { width: "100%", padding: "10px", cursor: allReady ? "pointer" : "not-allowed" }) }}
              >
                🎲 セッションを開始する
              </button>
            </div>
          )}
        </div>

        {/* 右列 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* PL: キャラ選択 */}
          {!isGm && step === "charSelect" && (
            <div style={S.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ ...S.h2, marginBottom: 0 }}>② キャラクターを選択</div>
                <button onClick={() => setCustomForm(true)} style={{ ...btn("rgba(255,255,255,0.04)", C.border, C.textDim, { padding: "4px 10px", fontSize: 10 }) }}>＋ カスタム</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(78px,1fr))", gap: 5, marginBottom: 16, maxHeight: 380, overflowY: "auto" }}>
                {CHARACTERS.map(c => {
                  const taken = Object.values(room.players || {}).some(p => p.charId === c.id && p.uid !== user.uid);
                  const isSel = selectedChar?.id === c.id;
                  return (
                    <div
                      key={c.id}
                      onClick={() => { if (!taken) setSelectedChar(isSel ? null : c); }}
                      style={{ border: `2px solid ${isSel ? C.gold : taken ? "#1e2535" : "rgba(255,255,255,0.05)"}`, borderRadius: 5, padding: 4, cursor: taken ? "not-allowed" : "pointer", background: isSel ? C.goldBg : taken ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.02)", opacity: taken ? 0.35 : 1, textAlign: "center" }}
                    >
                      <CharSprite spriteRow={c.spriteRow} spriteCol={c.spriteCol} size={66} style={{ margin: "0 auto" }} />
                      <div style={{ fontSize: 8, color: isSel ? C.gold : C.textDim, marginTop: 2, lineHeight: 1.3 }}>{c.name}</div>
                    </div>
                  );
                })}
              </div>

              {selectedChar && (
                <div style={{ padding: 14, background: C.goldBg, border: `1px solid ${C.goldDim}`, borderRadius: 6 }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 10 }}>
                    {selectedChar.customPortrait
                      ? <img src={selectedChar.customPortrait} style={{ width: 80, height: 80, objectFit: "contain", borderRadius: 6, background: "rgba(255,255,255,0.04)" }} />
                      : <CharSprite spriteRow={selectedChar.spriteRow} spriteCol={selectedChar.spriteCol} size={80} />
                    }
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 15, color: C.gold, marginBottom: 4 }}>{selectedChar.name}</div>
                      <div style={{ fontSize: 10, color: C.textDim, marginBottom: 2 }}>タグ: {selectedChar.tags?.map(t => `《${t}》`).join(" ")}</div>
                      <div style={{ fontSize: 10, color: C.textDim }}>拠点: {selectedChar.base}</div>
                    </div>
                  </div>
                  <div style={S.sec}>【能力スキル】{selectedChar.abilitySkill?.name} ({selectedChar.abilitySkill?.type})</div>
                  <div style={{ fontSize: 10, color: C.textDim, lineHeight: 1.7, marginBottom: 8 }}>{selectedChar.abilitySkill?.desc}</div>
                  <div style={S.sec}>【弾幕スキル】{selectedChar.danmakuSkill?.name}</div>
                  <div style={{ fontSize: 10, color: C.textDim, lineHeight: 1.7, marginBottom: 8 }}>{selectedChar.danmakuSkill?.desc}</div>
                  <div style={S.sec}>【スペルカード】</div>
                  {selectedChar.spellCards?.map((sc, i) => (
                    <div key={i} style={{ fontSize: 10, color: C.textDim, marginBottom: 2 }}>・{sc}</div>
                  ))}
                  <button onClick={confirmChar} style={{ ...btn(C.goldBg, C.goldDim, C.gold, { width: "100%", marginTop: 12 }) }}>
                    このキャラクターで決定する →
                  </button>
                </div>
              )}
            </div>
          )}

          {/* PL: スキル選択 */}
          {!isGm && step === "skillSelect" && (
            <div style={S.card}>
              <div style={S.h2}>③ 個性スキルを選択</div>
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 14 }}>D66を振って決定するか、一覧から選択してください。</div>
              <div style={{ textAlign: "center", marginBottom: 16 }}>
                <button onClick={rollSkill} style={{ ...btn(C.redBg, C.redBorder, C.red, { padding: "9px 24px" }) }}>🎲 D66を振る</button>
                {diceResult && (
                  <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 10 }}>
                    {diceResult.map((d, i) => (
                      <div key={i} style={{ width: 44, height: 44, border: "2px solid #1e3a5a", borderRadius: 6, background: "rgba(14,20,36,0.95)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: "#60c0f0", fontWeight: "bold", animation: diceAnim ? "spin 0.25s ease infinite" : "none" }}>
                        {d}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginBottom: 14 }}>
                {Object.entries(PERSONALITY_SKILLS).map(([id, sk]) => {
                  const isSel = selectedSkillId === parseInt(id);
                  return (
                    <div
                      key={id}
                      onClick={() => setSelectedSkillId(parseInt(id))}
                      style={{ padding: "7px 9px", borderRadius: 4, cursor: "pointer", background: isSel ? C.goldBg : "rgba(255,255,255,0.02)", border: `1px solid ${isSel ? C.goldDim : "#111828"}` }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                        <span style={{ fontSize: 11, color: isSel ? C.gold : C.text }}>《{sk.name}》</span>
                        <span style={{ fontSize: 9, color: C.textFaint }}>{id}</span>
                      </div>
                      <div style={{ fontSize: 9, color: C.textDim }}>{sk.type}</div>
                    </div>
                  );
                })}
              </div>

              {skillEntry && (
                <div style={{ padding: 12, background: C.goldBg, border: `1px solid ${C.goldDim}`, borderRadius: 5, marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: C.gold, marginBottom: 3 }}>《{skillEntry.name}》 [{selectedSkillId}]</div>
                  <div style={{ fontSize: 9, color: "#5a7090", marginBottom: 6, fontStyle: "italic" }}>{skillEntry.quote}</div>
                  <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 1, marginBottom: 4 }}>{skillEntry.type}</div>
                  <div style={{ fontSize: 10, color: C.textDim, lineHeight: 1.7 }}>{skillEntry.desc}</div>
                </div>
              )}

              <button
                onClick={confirmSkill}
                disabled={!selectedSkillId}
                style={{ ...btn(selectedSkillId ? C.goldBg : "rgba(255,255,255,0.02)", selectedSkillId ? C.goldDim : C.border, selectedSkillId ? C.gold : C.textFaint, { width: "100%", padding: "9px", cursor: selectedSkillId ? "pointer" : "not-allowed" }) }}
              >
                この個性スキルで確定する →
              </button>
            </div>
          )}

          {/* PL: 準備完了 */}
          {!isGm && step === "ready" && (
            <div style={{ ...S.card, textAlign: "center" }}>
              <div style={{ fontSize: 14, color: C.green, marginBottom: 10 }}>✓ 準備完了</div>
              {selectedChar?.customPortrait
                ? <img src={selectedChar.customPortrait} style={{ width: 90, height: 90, objectFit: "contain", margin: "0 auto 10px", display: "block", borderRadius: 6 }} />
                : <CharSprite spriteRow={selectedChar?.spriteRow ?? -1} spriteCol={selectedChar?.spriteCol ?? -1} size={90} style={{ margin: "0 auto 10px" }} />
              }
              <div style={{ fontSize: 14, color: C.gold }}>{selectedChar?.name}</div>
              {selectedSkillId && <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>個性：《{PERSONALITY_SKILLS[selectedSkillId]?.name}》</div>}
              <div style={{ fontSize: 10, color: C.textFaint, marginTop: 14 }}>GMがセッションを開始するまでお待ちください</div>
            </div>
          )}

          {/* GM: PL一覧 */}
          {isGm && (
            <div style={S.card}>
              <div style={S.h2}>参加PLの状況</div>
              {Object.values(room.players || {}).filter(p => p.role !== "gm").length === 0
                ? <div style={{ fontSize: 10, color: C.textFaint }}>まだ参加者がいません。URLをコピーしてPLに共有してください。</div>
                : Object.values(room.players || {}).filter(p => p.role !== "gm").map(p => (
                  <div key={p.uid} style={{ padding: "10px 0", borderBottom: "1px solid #0d1018" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <CharSprite spriteRow={p.spriteRow ?? -1} spriteCol={p.spriteCol ?? -1} size={56} />
                      <div>
                        <div style={{ fontSize: 12, color: C.text }}>{p.name}</div>
                        {p.charName && <div style={{ fontSize: 10, color: C.gold }}>{p.charName}</div>}
                        {p.skillName && <div style={{ fontSize: 10, color: C.textDim }}>個性：《{p.skillName}》</div>}
                      </div>
                      <div style={{ marginLeft: "auto", fontSize: 11, color: p.ready ? C.green : C.textFaint }}>{p.ready ? "✓ 準備完了" : "待機中…"}</div>
                    </div>
                  </div>
                ))
              }
            </div>
          )}
        </div>
      </div>

      {/* プロフィール・シナリオ管理 */}
      {showProfile && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, overflowY: "auto" }}>
          <ProfilePage onClose={() => setShowProfile(false)} />
        </div>
      )}

      {/* カスタムキャラモーダル */}
      {customForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#0c1020", border: `1px solid #1e2d45`, borderRadius: 6, padding: 20, maxWidth: 440, width: "90%", maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ fontSize: 13, color: C.gold, marginBottom: 14 }}>カスタムキャラクター作成</div>

            {/* 立ち絵 */}
            <div style={{ marginBottom: 12, textAlign: "center" }}>
              {custom.portrait
                ? <div style={{ position: "relative", display: "inline-block" }}>
                    <img src={custom.portrait} style={{ width: 100, height: 100, objectFit: "contain", borderRadius: 6, border: `1px solid ${C.border}`, background: "rgba(255,255,255,0.04)" }} />
                    <button onClick={() => setCustom(p => ({ ...p, portrait: null }))} style={{ position: "absolute", top: -6, right: -6, ...btn("rgba(8,8,12,0.9)", "#3a1a1a", C.red, { width: 20, height: 20, padding: 0, fontSize: 12 }) }}>✕</button>
                  </div>
                : <label style={{ display: "block", padding: "14px", border: `1px dashed ${C.border}`, borderRadius: 4, cursor: "pointer", fontSize: 10, color: C.textFaint }}>
                    ＋ 立ち絵をアップロード（500×500推奨）
                    <input type="file" accept="image/*" style={{ display: "none" }} onChange={uploadPortrait} />
                  </label>
              }
            </div>

            {[["name", "キャラクター名 *"], ["tags", "タグ（読点または,区切り）"], ["base", "拠点"]].map(([k, label]) => (
              <div key={k} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 2 }}>{label}</div>
                <input style={iStyle} value={custom[k] || ""} onChange={e => setCustom(p => ({ ...p, [k]: e.target.value }))} />
              </div>
            ))}

            {[
              ["abilitySkillName", "【能力スキル】名前"],
              ["abilitySkillDesc", "【能力スキル】説明（複数行可）"],
              ["danmakuSkillName", "【弾幕スキル】名前"],
              ["danmakuSkillDesc", "【弾幕スキル】説明"],
              ["sc1name", "スペルカード①名前"], ["sc1desc", "スペルカード①効果"],
              ["sc2name", "スペルカード②名前"], ["sc2desc", "スペルカード②効果"],
            ].map(([k, label]) => (
              <div key={k} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 2 }}>{label}</div>
                {k.includes("Desc") || k.includes("desc")
                  ? <textarea style={{ ...iStyle, height: 48, resize: "vertical" }} value={custom[k] || ""} onChange={e => setCustom(p => ({ ...p, [k]: e.target.value }))} />
                  : <input style={iStyle} value={custom[k] || ""} onChange={e => setCustom(p => ({ ...p, [k]: e.target.value }))} />
                }
              </div>
            ))}

            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button style={{ ...btn(C.greenBg, C.greenBorder, C.green, { flex: 1 }) }} onClick={addCustom}>作成して選択</button>
              <button style={{ ...btn(C.redBg, C.redBorder, C.red, { flex: 1 }) }} onClick={() => setCustomForm(false)}>キャンセル</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── LobbyRoot（ルート）─────────────────────────────────────────

export default function LobbyRoot() {
  const [user, setUser]               = useState(undefined);
  const [displayName, setDisplayName] = useState(null);
  const [roomFromUrl, setRoomFromUrl] = useState(null);
  const [roomPhase, setRoomPhase]     = useState(null); // "prep" | "explore" | null
  const [isGm, setIsGm]               = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const r = params.get("room");
    if (r) setRoomFromUrl(r.toUpperCase());

    const unsub = onAuthStateChanged(auth, u => {
      setUser(u || null);
      if (u) setDisplayName(u.displayName || null);
    });
    return () => unsub();
  }, []);

  // 部屋コードがあるときは部屋の状態を取得
  useEffect(() => {
    if (!roomFromUrl || !user) return;
    const r     = ref(db, `rooms/${roomFromUrl}`);
    const unsub = onValue(r, snap => {
      if (snap.exists()) {
        const v = snap.val();
        setRoomPhase(v.phase);
        const myPlayer = v.players?.[user.uid];
        setIsGm(myPlayer ? myPlayer.role === "gm" : false);
      }
    });
    return () => unsub();
  }, [roomFromUrl, user]);

  if (user === undefined) return (
    <div style={{ background: "#040608", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: C.textFaint, fontFamily: "serif", fontSize: 12 }}>接続中…</div>
  );
  if (!user) return <LoginScreen />;
  if (!displayName) return (
    <UsernameSetup
      user={user}
      onDone={name => { setDisplayName(name); updateProfile(user, { displayName: name }).catch(() => {}); }}
    />
  );

  // URLに部屋コードあり
  if (roomFromUrl) {
    if (roomPhase === null) return (
      <div style={{ background: "#040608", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: C.textFaint, fontFamily: "serif", fontSize: 12 }}>部屋情報を取得中…</div>
    );
    if (roomPhase === "prep") return <PrepRoom roomCode={roomFromUrl} user={user} displayName={displayName} isGm={isGm} />;
    // explore 以降は App.jsx の SessionApp が担当
    return null;
  }

  if (showProfile) return <ProfilePage onClose={() => setShowProfile(false)} />;
  return <Lobby user={user} displayName={displayName} onProfile={() => setShowProfile(true)} />;
}
