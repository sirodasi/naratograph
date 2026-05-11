import { useState, useEffect } from "react";
import { db } from "../../firebase";
import { ref, onValue, update } from "firebase/database";
import { COLORS, COMMON_STYLES } from "../../styles/theme";
import CharacterSelector from "./CharacterSelector";
import SkillSelector from "./SkillSelector";
import CharSprite from "../common/CharSprite";
import { PERSONALITY_SKILLS } from "../../data/personalitySkills";

export default function PrepRoom({ roomCode, user, isGm }) {
  const [room, setRoom] = useState(null);
  const [step, setStep] = useState("charSelect");
  const [selectedChar, setSelectedChar] = useState(null);
  const [selectedSkillId, setSelectedSkillId] = useState(null);

  useEffect(() => {
    const unsub = onValue(ref(db, `rooms/${roomCode}`), snap => setRoom(snap.val()));
    return () => unsub();
  }, [roomCode]);

  const confirmChar = async () => {
    await update(ref(db, `rooms/${roomCode}/players/${user.uid}`), {
      charId: selectedChar.id, charName: selectedChar.name,
      spriteRow: selectedChar.spriteRow, spriteCol: selectedChar.spriteCol,
      base: selectedChar.base, customPortrait: selectedChar.customPortrait || null,
      abilitySkill: selectedChar.abilitySkill || null, danmakuSkill: selectedChar.danmakuSkill || null
    });
    setStep("skillSelect");
  };

  const confirmSkill = async () => {
    await update(ref(db, `rooms/${roomCode}/players/${user.uid}`), {
      skillId: selectedSkillId, skillName: PERSONALITY_SKILLS[selectedSkillId].name, ready: true
    });
    setStep("ready");
  };

  if (!room) return null;

  return (
    <div style={{ background: COLORS.bg, minHeight: "100vh", padding: 20, fontFamily: "serif", color: COLORS.text }}>
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        <div style={{ marginBottom: 20, borderBottom: `1px solid ${COLORS.border}`, paddingBottom: 10 }}>
          <span style={{ fontSize: 16, color: COLORS.gold }}>幻想ナラトグラフ</span>
          <span style={{ marginLeft: 10, fontSize: 12, color: COLORS.textDim }}>Room: {roomCode}</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "250px 1fr", gap: 20 }}>
          {/* 左：PL一覧 */}
          <div>
            <div style={{ fontSize: 12, color: COLORS.gold, marginBottom: 10 }}>参加者</div>
            {Object.values(room.players || {}).map(p => (
              <div key={p.uid} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: 6, background: "rgba(255,255,255,0.02)", borderRadius: 4 }}>
                <CharSprite spriteRow={p.spriteRow} spriteCol={p.spriteCol} size={32} />
                <div style={{ fontSize: 10 }}>
                  <div>{p.name} {p.role === "gm" && "(GM)"}</div>
                  <div style={{ color: COLORS.textDim }}>{p.charName}</div>
                </div>
                {p.ready && <div style={{ marginLeft: "auto", color: COLORS.green }}>✓</div>}
              </div>
            ))}
            {isGm && (
              <button 
                onClick={() => update(ref(db, `rooms/${roomCode}`), { phase: "explore" })}
                style={COMMON_STYLES.btn(COLORS.redBg, COLORS.redBorder, COLORS.red, { width: "100%", marginTop: 20 })}
              >セッション開始</button>
            )}
          </div>

          {/* 右：自分のセットアップ */}
          {!isGm && (
            <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, padding: 20, borderRadius: 6 }}>
              {step === "charSelect" && <CharacterSelector selectedChar={selectedChar} onSelect={setSelectedChar} roomPlayers={room.players} onConfirm={confirmChar} />}
              {step === "skillSelect" && <SkillSelector selectedId={selectedSkillId} onSelect={setSelectedSkillId} onConfirm={confirmSkill} />}
              {step === "ready" && (
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 16, color: COLORS.green }}>✓ 準備完了</div>
                  <div style={{ marginTop: 10, color: COLORS.textDim }}>GMが開始するまでお待ちください。</div>
                </div>
              )}
            </div>
          )}
          {isGm && <div style={{ color: COLORS.textFaint, fontSize: 11 }}>GMはPLの準備が整うのを待って、「セッション開始」を押してください。</div>}
        </div>
      </div>
    </div>
  );
}