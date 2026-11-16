// SessionView から分割: GM/PL サイドバー（RightPanel）
import { useState, useEffect, useRef } from "react";
import { sfx } from "../audio";
import { motion } from "../motion";
import { fontScale } from "../fontScale";
import { bgm } from "../bgm";
import { C, btnFull, iStyle } from "../styles/colors";
import { getActiveAbility } from "../data/abilityEffects";
import { SpellCard, getSpotByD66 } from "./shared";
import { BattleRightPanel } from "./battle";
import { ScenePanel } from "./scenePanel";
import { PCCard } from "./pcCard";
import { SceneEditor } from "./scene";
import { GmToolsPanel } from "./gmPanel";
import { CustomRulesEditor, CustomBoard, GmFieldEditor } from "./customPanel";
import { getRequests } from "../gmTools";

// ─── RightPanel ───────────────────────────────────────────────────
export function RightPanel({ gs, upd, sceneData, setSceneData, isGm, user, room, animateDice, CYCLES, CYCLE_COLORS, NEWSPAPER, getSpot, doNewspaper, doReiryoku, setPendingAction, SPOTS, presence = {}, width = 300, undo, undoCount = 0 }) {
  const [tab, setTab]             = useState("progress");
  const [expandedQuests, setExpandedQuests] = useState({});
  const [paperModal, setPaperModal] = useState(null);
  const [sceneSelect, setSceneSelect] = useState("");
  const [logSearch, setLogSearch] = useState("");
  const [freeDiceLast, setFreeDiceLast] = useState(null);   // 任意ダイスの直近結果
  const [freeDiceN, setFreeDiceN] = useState(1);            // 任意ダイスの個数
  // 任意ダイス（GM裁定・自作判定用）: nD6 / D66 を振ってログに残す
  const rollFreeDice = (count, kind) => {
    const res = Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1);
    const who = room?.players?.[user?.uid]?.name || "";
    let text;
    if (kind === "d66") { const v = Math.min(res[0], res[1]) * 10 + Math.max(res[0], res[1]); text = `D66 → ${v}（${res.join(",")}）`; }
    else { const sum = res.reduce((a, b) => a + b, 0); text = `${count}D6 → ${res.join(",")}${count > 1 ? `（合計${sum}）` : ""}`; }
    setFreeDiceLast(text);
    upd(p => ({ ...p, log: [`🎲 ${who ? who + "の" : ""}任意ダイス: ${text}`, ...p.log] }));
    sfx.diceResult(Math.max(...res));
  };
  const [logFilter, setLogFilter] = useState("all");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showDiceHistory, setShowDiceHistory] = useState(false);
  const [motionReduced, setMotionReduced] = useState(motion.reduced);
  const toggleMotion = () => { motion.toggle(); setMotionReduced(motion.reduced); };
  const [fontLevel, setFontLevel] = useState(fontScale.level); // 0標準/1大/2特大
  const cycleFont = () => setFontLevel(fontScale.cycle());
  const [showBgm, setShowBgm] = useState(false);
  const [showBattleGmTools, setShowBattleGmTools] = useState(false); // 弾幕ごっこ中の GM 操作（折りたたみ）
  const [bgmMuted, setBgmMuted] = useState(bgm.muted);
  const [bgmVol, setBgmVol] = useState(bgm.volume);

  // 探索フェーズのダイス効果音（バトル中は BattleDiceTray が担当するため除外）
  const prevExploreDiceRef = useRef(false);
  useEffect(() => {
    const wasRolling = prevExploreDiceRef.current;
    const isRolling  = gs.dice?.rolling || false;
    prevExploreDiceRef.current = isRolling;
    if (gs.battle?.active) return;
    if (!wasRolling && isRolling) {
      sfx.diceRoll();
    } else if (wasRolling && !isRolling && (gs.dice?.results?.length ?? 0) > 0) {
      sfx.diceResult(Math.max(...gs.dice.results));
    }
  }, [gs.dice?.rolling]); // eslint-disable-line

  const cycleIdx   = gs.cycleIdx || 0;
  const isIntro    = gs.sessionPhase === "intro" || gs.sessionPhase === "intro_main";
  const isMorning  = cycleIdx === 0;
  const cycleColor = CYCLE_COLORS[cycleIdx];

  const handleNewspaper = () => {
    animateDice(2, "文々。新聞表", res => {
      const val   = Math.min(res[0], res[1]) * 10 + Math.max(res[0], res[1]);
      const paper = NEWSPAPER[val] || { title: `出目${val}`, effect: "（データなし）" };
      doNewspaper({ roll: val, dice: res, ...paper });
      setTimeout(() => setPaperModal({ roll: val, dice: res, ...paper }), 300);
    });
  };

  // 風を操る程度の能力（射命丸文）: 新聞表を巻き戻して振り直す（base=やる気1消費）
  const windHolder = (gs.pcs || []).find(x => { const n = getActiveAbility(x)?.name; return n === "風を操る程度の能力" || n === "風を操る程度の能力＋"; });
  const windReroll = () => {
    if (!windHolder) return;
    const isPlus = getActiveAbility(windHolder)?.name === "風を操る程度の能力＋";
    upd(p => ({
      ...p,
      newspaper: null,
      pcs: isPlus ? p.pcs : p.pcs.map(x => x.uid === windHolder.uid ? { ...x, resources: { ...x.resources, やる気: { ...(x.resources.やる気 || { cur: 0, max: 99 }), cur: Math.max(0, (x.resources.やる気?.cur || 0) - 1) } } } : x),
      log: [`🌀 ${windHolder.charName} の《風を操る程度の能力${isPlus ? "＋" : ""}》: 新聞表を振り直す${isPlus ? "" : "（やる気-1）"}`, ...p.log],
    }));
    setPaperModal(null);
    setTimeout(handleNewspaper, 100);
  };

  const startScene = () => {
    if (!sceneSelect) return;
    const targetPc = gs.pcs.find(p => p.uid === sceneSelect);
    if (!targetPc) return;
    const selectedUid = sceneSelect;
    setSceneSelect(""); // upd()より先にクリアして二重起動を防ぐ
    // 超能力を操る（菫子）: コマを取り除いていた(offMap)場合、シーン開始時にランダムスポットへ配置
    const placeSpots = (SPOTS || []).filter(s => s.id !== "dream");
    const randomSpot = targetPc.offMap && placeSpots.length ? placeSpots[Math.floor(Math.random() * placeSpots.length)] : null;
    const startSpot = randomSpot ? randomSpot.id : targetPc.currentSpot;
    upd(p => ({
      ...p,
      pcs: randomSpot ? p.pcs.map(x => x.uid === selectedUid ? { ...x, currentSpot: randomSpot.id, offMap: null } : x) : p.pcs,
      currentScene: { pcUid: selectedUid, phase: "move_or_stay", moveDice: [], actionDice: [], actionDiceCount: 2, startSpot },
      log:[`🎬 ${targetPc.charName} のシーンが開始された`, ...(randomSpot ? [`🛸 ${targetPc.charName} の超能力：[${randomSpot.name}] にランダム配置された`] : []), ...p.log],
    }));
  };

  const unactedPcs = (gs.pcs || []).filter(pc => !(gs.actedPcs ||[]).includes(pc.uid));

  const getMainAction = () => {
    if (gs.currentScene) return null;
    if (isIntro) return { label: "🎬 探索フェイズへ移行する", fn: () => setPendingAction("toExplore"), color: "#1976d2" };

    const allScenarioQuests = gs.scenarioData?.quests || [];
    const currentSolvedCount = (gs.quests || []).filter(q => q.solved).length;
    const isAllSolved = allScenarioQuests.length > 0 && currentSolvedCount >= allScenarioQuests.length;

    if (isAllSolved && gs.sessionPhase === "explore") {
      return {
        label: "⚔️ 決戦フェイズへ移行する",
        fn: () => setPendingAction("toBattle"),
        color: C.red
      };
    }

    if (isMorning) {
      if (!gs.newspaper) return { label: "📰 文々。新聞を読む", fn: handleNewspaper, color: C.blue };
      if (!gs.cluePlaced) return {
        label: "🔍 手がかりを配置",
        color: C.green,
        fn: () => animateDice(2, "朝の手がかり配置", res => {
          const spotId = getSpotByD66(res[0], res[1], SPOTS);
          if (spotId) {
            upd(p => ({ ...p, cluePlaced: true, clues:[...new Set([...p.clues, spotId])], log: [`手がかりを [${spotId}] ${getSpot(spotId)?.name} に配置（出目: ${res[0]}, ${res[1]}）`, ...p.log] }));
          }
        }),
      };

      return { label: `☀️ 昼のサイクルへ`, fn: () => setPendingAction("advance"), color: "#f57c00" };
    }
    if (cycleIdx !== 3 && !gs.reiryokuDone) return { label: "✦ 霊力の増加", fn: doReiryoku, color: "#ab47bc" };
    if (unactedPcs.length === 0) return { label: `🌙 ${cycleIdx === 3 ? "翌日の朝" : "次のサイクル"}へ`, fn: () => setPendingAction("advance"), color: "#f57c00" };
    return null;
  };
  const ma = isGm ? getMainAction() : null;

  const TABS = isGm
    ? [["progress", "進行"],["pcs", "PC一覧"], ["scene", "描写"], ["gm", `GM${getRequests(gs).length ? `(${getRequests(gs).length})` : ""}`], ["custom", "独自"], ["log", "ログ"]]
    : [["progress", "進行"],["pcs", "PC一覧"], ["log", "ログ"]];

  // ── キーボードショートカット（GM操作の高速化） ──────────────────────
  // 最新の ma / TABS をハンドラに渡すため ref に保持（リスナーは mount 時1回登録）
  const maRef   = useRef(ma);   maRef.current = ma;
  const tabsRef = useRef(TABS); tabsRef.current = TABS;
  useEffect(() => {
    const onKey = (e) => {
      // 入力欄フォーカス中・修飾キー併用時はショートカット無効
      const tag = (e.target?.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        setShowShortcuts(v => !v);
        return;
      }
      if (e.key === "Escape") { setShowShortcuts(false); return; }
      // 数字キー: タブ切替
      if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        const t = tabsRef.current[idx];
        if (t) { e.preventDefault(); setTab(t[0]); }
        return;
      }
      // M: 効果音ミュート切替
      if (e.key === "m" || e.key === "M") { e.preventDefault(); sfx.toggle(); return; }
      // Enter: 状況に応じた主要アクションを実行（GMのみ）
      if (e.key === "Enter" && isGm && maRef.current) {
        e.preventDefault();
        maRef.current.fn();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isGm]);

  const joinQuest = () => {
    const myPc = gs.pcs.find(p => p.uid === user.uid);
    if (!myPc || !gs.currentScene?.questLocation) return;
    
    upd(p => ({
      ...p,
      pcs: p.pcs.map(x => x.uid === user.uid ? { ...x, currentSpot: gs.currentScene.questLocation } : x),
      log: [`🏃 ${myPc.charName} がクエストに合流した！`, ...p.log]
    }));
  };

  return (
    <div style={{ width, height: "100%", display: "flex", flexDirection: "column", background: "#0b0d14", borderLeft: `1px solid ${C.border}`, flexShrink: 0, overflow: "hidden", fontFamily: "'Noto Serif JP', serif" }}>
      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes rollSpin { 50% { transform: scale(1.15) } }
        @keyframes scenePanelIn {
          from { opacity: 0; transform: translateX(22px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes diceIn {
          from { opacity: 0; transform: scale(0.45) rotate(-18deg); }
          70%  { transform: scale(1.15) rotate(4deg); }
          to   { opacity: 1; transform: scale(1) rotate(0deg); }
        }
        @keyframes diceResultIn {
          from { opacity: 0; transform: scale(0.55) translateY(6px); }
          60%  { transform: scale(1.14) translateY(-2px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>

      <div style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, background: "#08090f", flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: C.gold, letterSpacing: 2 }}>
            {gs.battle?.active ? "⚖️ 弾幕ごっこ" : (gs.sessionPhase === "intro" ? "✦ 導入フェイズ" : "✦ 探索フェイズ")}
          </span>
          {gs.battle?.active ? (
            <div style={{ padding: "2px 10px", background: "rgba(224,112,96,0.18)", border: `1px solid ${C.redBorder}`, borderRadius: 10, fontSize: 10, color: C.red }}>
              ROUND {gs.battle.round}
            </div>
          ) : (
            !isIntro && <div style={{ padding: "2px 10px", background: `${cycleColor}18`, border: `1px solid ${cycleColor}40`, borderRadius: 10, fontSize: 10, color: cycleColor }}>{gs.day}日目・{CYCLES[cycleIdx]}</div>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
        {gs.battle?.active ? (
          <>
          {isGm && (
            <div style={{ marginBottom: 8 }}>
              <button onClick={() => setShowBattleGmTools(v => !v)} style={btnFull("rgba(255,255,255,0.02)", C.border, C.red, { fontSize: 10, padding: "5px" })}>
                🛠 GM操作（要求・臨時の弾幕ごっこ）{getRequests(gs).length ? `［${getRequests(gs).length}］` : ""} {showBattleGmTools ? "▲" : "▼"}
              </button>
              {showBattleGmTools && <div style={{ marginTop: 6 }}><GmToolsPanel gs={gs} upd={upd} getSpot={getSpot} /></div>}
            </div>
          )}
          {isGm && <GmFieldEditor gs={gs} upd={upd} />}
          <CustomBoard gs={gs} upd={upd} isGm={isGm} />
          <BattleRightPanel
            gs={gs}
            upd={upd}
            user={user}
            isGm={isGm}
            getSpot={getSpot}
            animateDice={animateDice}
          />
          </>
        ) : (
          <>
            {gs.currentScene?.phase === "quest_setup" && gs.currentScene?.pcUid !== user.uid && !isGm && (
              <div style={{ padding: "10px", background: "rgba(200,160,64,0.15)", borderBottom: `1px solid ${C.goldDim}`, animation: "fadeUp 0.3s ease" }}>
                <div style={{ fontSize: 10, color: C.gold, marginBottom: 6, textAlign: "center" }}>
                  🌟 クエストシーンが開始されました
                </div>
                <button 
                  onClick={joinQuest}
                  disabled={gs.pcs.find(p => p.uid === user.uid)?.currentSpot === gs.currentScene.questLocation}
                  style={btnFull(C.goldBg, C.goldDim, C.gold, { fontSize: 10 })}
                >
                  {gs.pcs.find(p => p.uid === user.uid)?.currentSpot === gs.currentScene.questLocation 
                    ? "合流済み" 
                    : "このクエストに合流する（移動）"}
                </button>
              </div>
            )}

            {gs.currentScene && (
              <div style={{ animation: "scenePanelIn 0.3s ease both" }}>
                <ScenePanel gs={gs} upd={upd} user={user} isGm={isGm} getSpot={getSpot} animateDice={animateDice} SPOTS={SPOTS} room={room} />
              </div>
            )}

            {!gs.currentScene && isGm && (
              <div style={{ padding: "8px", borderBottom: `1px solid ${C.border}`, flexShrink: 0, background: "rgba(255,255,255,0.01)" }}>
                {ma ? (
                  <button onClick={ma.fn} style={{ width: "100%", padding: "9px", borderRadius: 4, cursor: "pointer", background: `${ma.color}20`, border: `1px solid ${ma.color}50`, color: ma.color, fontSize: 12, letterSpacing: 1 }}>{ma.label}</button>
                ) : (
                  <div>
                    <div style={{ fontSize: 9, color: C.textDim, marginBottom: 4 }}>▶ シーンプレイヤーの選択</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <select value={sceneSelect} onChange={e => setSceneSelect(e.target.value)} style={{ flex: 1, padding: "6px", fontSize: 11, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.text, borderRadius: 3 }}>
                        <option value="">未行動のPCを選択...</option>
                        {unactedPcs.map(pc => <option key={pc.uid} value={pc.uid}>{pc.charName}</option>)}
                      </select>
                      <button onClick={startScene} disabled={!sceneSelect} style={{ padding: "0 12px", background: C.goldBg, border: `1px solid ${C.goldDim}`, color: C.gold, borderRadius: 3, cursor: sceneSelect ? "pointer" : "not-allowed", fontSize: 11 }}>開始</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ flexShrink: 0, borderBottom: `1px solid ${C.border}` }}>
              {/* 1段目: ナビゲーションタブ */}
              <div style={{ display: "flex" }}>
                {TABS.map(([id, label]) => (
                  <div key={id} style={{ flex: 1, padding: "7px 2px", textAlign: "center", fontSize: 11, cursor: "pointer", color: tab === id ? C.gold : C.textFaint, borderBottom: tab === id ? `2px solid ${C.gold}` : "2px solid transparent", background: tab === id ? "rgba(200,160,64,0.05)" : "transparent" }} onClick={() => setTab(id)}>{label}</div>
                ))}
              </div>
              {/* 2段目: ツールバー（左=操作 / 右=表示設定） */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: `1px solid ${C.border}55`, background: "rgba(255,255,255,0.015)", padding: "1px 5px" }}>
                <div style={{ display: "flex", gap: 2 }}>
                  {isGm && (
                    <div onClick={() => { if (undoCount > 0 && undo && window.confirm("直近の操作を1つ取り消しますか？")) undo(); }} title={undoCount > 0 ? `直近の操作を取り消す（${undoCount}件）` : "取り消せる操作はありません"} style={{ padding: "4px 10px", fontSize: 13, cursor: undoCount > 0 ? "pointer" : "default", color: undoCount > 0 ? C.gold : "#2a3545", opacity: undoCount > 0 ? 1 : 0.6 }}>↩</div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 2 }}>
                  <div onClick={() => setShowBgm(v => !v)} title="BGM設定" style={{ padding: "4px 10px", fontSize: 13, cursor: "pointer", color: bgmMuted ? C.textFaint : C.gold }}>{bgmMuted ? "🔈" : "🎵"}</div>
                  <div onClick={toggleMotion} title={motionReduced ? "演出: 抑制中（クリックで通常に戻す）" : "演出: 通常（クリックで抑制）"} style={{ padding: "4px 10px", fontSize: 13, cursor: "pointer", color: motionReduced ? C.textFaint : C.gold }}>{motionReduced ? "🚫" : "🎬"}</div>
                  <div onClick={cycleFont} title={`文字サイズ: ${fontScale.label}（クリックで変更）`} style={{ padding: "4px 10px", fontSize: 11 + fontLevel * 2, lineHeight: 1.2, cursor: "pointer", color: fontLevel > 0 ? C.gold : C.textFaint, fontWeight: fontLevel > 0 ? 700 : 400 }}>A</div>
                  <div onClick={() => setShowShortcuts(true)} title="キーボードショートカット (?)" style={{ padding: "4px 10px", fontSize: 13, cursor: "pointer", color: C.textFaint }}>⌨</div>
                </div>
              </div>
            </div>

            {showBgm && (
              <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}`, background: "rgba(255,255,255,0.015)", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <button
                    onClick={() => setBgmMuted(bgm.toggleMute())}
                    style={{ padding: "4px 10px", fontSize: 11, cursor: "pointer", borderRadius: 4, background: bgmMuted ? "rgba(255,255,255,0.03)" : "rgba(200,160,64,0.2)", border: `1px solid ${bgmMuted ? C.border : C.goldDim}`, color: bgmMuted ? C.textFaint : C.gold }}
                  >{bgmMuted ? "🔈 BGM OFF" : "🎵 BGM ON"}</button>
                  <input
                    type="range" min="0" max="1" step="0.05" value={bgmVol}
                    onChange={e => { const v = parseFloat(e.target.value); setBgmVol(v); bgm.setVolume(v); }}
                    style={{ flex: 1, accentColor: C.gold, cursor: "pointer" }}
                    title="音量"
                  />
                  <span style={{ fontSize: 9, color: C.textFaint, minWidth: 28, textAlign: "right" }}>{Math.round(bgmVol * 100)}%</span>
                </div>
                <div style={{ fontSize: 8, color: C.textFaint, lineHeight: 1.6, marginBottom: isGm ? 8 : 0 }}>
                  ※ BGMは各自のブラウザでローカル再生されます{!bgm.unlocked && "（画面をクリックすると再生開始）"}
                </div>
                {isGm && (
                  <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                    <div style={{ fontSize: 9, color: C.red, letterSpacing: 1, marginBottom: 6 }}>▶ GM: BGMの設定</div>
                    
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, padding: "4px", background: "rgba(200,160,64,0.1)", borderRadius: 4, border: `1px solid ${C.goldDim}` }}>
                      <span style={{ fontSize: 9, color: C.gold, minWidth: 52 }}>手動再生</span>
                      <input
                        value={(gs.bgm || {}).override || ""}
                        onChange={e => { const v = e.target.value; upd(p => ({ ...p, bgm: { ...(p.bgm || {}), override: v } })); }}
                        placeholder="フェーズBGMを一時的に上書き"
                        style={{ ...iStyle, flex: 1, fontSize: 9, padding: "4px 6px", borderColor: "transparent", background: "rgba(0,0,0,0.3)" }}
                      />
                      {(gs.bgm || {}).override && (
                        <button 
                          onClick={() => upd(p => ({ ...p, bgm: { ...(p.bgm || {}), override: "" } }))}
                          style={{ background: "transparent", border: "none", color: C.textDim, cursor: "pointer", fontSize: 12, padding: "2px 6px" }}
                          title="手動再生を解除して元のBGMに戻す"
                        >✕</button>
                      )}
                    </div>

                    {[["explore", "探索/導入"], ["battle", "弾幕ごっこ"], ["end", "セッション終了"]].map(([key, label]) => (
                      <div key={key} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                        <span style={{ fontSize: 9, color: C.textDim, minWidth: 56 }}>{label}</span>
                        <input
                          value={(gs.bgm || {})[key] || ""}
                          onChange={e => { const v = e.target.value; upd(p => ({ ...p, bgm: { ...(p.bgm || {}), [key]: v } })); }}
                          placeholder="https://…（mp3/ogg）"
                          style={{ ...iStyle, flex: 1, fontSize: 9, padding: "4px 6px" }}
                        />
                      </div>
                    ))}
                    <div style={{ fontSize: 8, color: C.textFaint, lineHeight: 1.6, marginTop: 4 }}>
                      ※ 手動再生に入力するとフェーズのBGMより優先されます。空欄にしたり✕を押すと、フェーズに応じたBGMに戻ります。
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
              {tab === "progress" && (
                <div>
                  <CustomBoard gs={gs} upd={upd} isGm={isGm} />
                  {/* 任意ダイス（GM裁定・自作判定用） */}
                  <div style={{ marginBottom: 8, padding: 6, background: "rgba(255,255,255,0.02)", border: `1px solid ${C.border}`, borderRadius: 4 }}>
                    <div style={{ fontSize: 9, color: C.gold, marginBottom: 4 }}>🎲 任意ダイス</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 3, alignItems: "center" }}>
                      {[1, 2, 3].map(n => <button key={n} onClick={() => rollFreeDice(n, "nd6")} style={{ padding: "3px 8px", fontSize: 9, cursor: "pointer", borderRadius: 3, background: C.blueBg, border: `1px solid ${C.blueBorder}`, color: C.blue }}>{n}D6</button>)}
                      <button onClick={() => rollFreeDice(2, "d66")} style={{ padding: "3px 8px", fontSize: 9, cursor: "pointer", borderRadius: 3, background: C.purpleBg, border: `1px solid ${C.purpleBorder}`, color: C.purple }}>D66</button>
                      <span style={{ width: 1, height: 16, background: C.border }} />
                      <input type="number" min={1} max={12} value={freeDiceN} onChange={e => setFreeDiceN(Math.max(1, Math.min(12, parseInt(e.target.value) || 1)))} style={{ width: 36, padding: "2px 4px", fontSize: 10, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, color: C.text, borderRadius: 3 }} />
                      <button onClick={() => rollFreeDice(freeDiceN, "nd6")} style={{ padding: "3px 8px", fontSize: 9, cursor: "pointer", borderRadius: 3, background: C.goldBg, border: `1px solid ${C.goldDim}`, color: C.gold }}>D6を振る</button>
                    </div>
                    {freeDiceLast && <div style={{ fontSize: 10, color: C.text, marginTop: 4 }}>結果: <span style={{ color: C.gold }}>{freeDiceLast}</span></div>}
                  </div>

                  <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginBottom: 6 }}>クエスト</div>
                  {(gs.quests ||[]).length === 0 ? (
                    <div style={{ fontSize: 10, color: "#2a3545", marginBottom: 8 }}>なし</div>
                  ) : (
                    (gs.quests ||[]).map(q => {
                      const isExpanded = expandedQuests[q.id];
                      const isReadyToSolve = !q.solved && (q.clues || 0) >= q.level;
                      
                      const toggleExpand = () => {
                        setExpandedQuests(prev => ({ ...prev, [q.id]: !prev[q.id] }));
                      };

                      return (
                        <div key={q.id || q.name} style={{ marginBottom: 4, background: q.solved ? "rgba(27,94,32,0.08)" : "rgba(255,255,255,0.02)", border: `1px solid ${q.solved ? "#1b5e20" : isReadyToSolve ? C.goldDim : C.border}`, borderRadius: 3, overflow: "hidden" }}>
                          
                          <div 
                            onClick={toggleExpand}
                            style={{ padding: "6px 8px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, transition: "background 0.2s" }}
                            onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                          >
                            <div style={{ fontSize: 8, color: C.textFaint }}>{isExpanded ? "▼" : "▶"}</div>
                            
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <span style={{ fontSize: 11, color: q.solved ? "#4caf50" : isReadyToSolve ? C.gold : C.text, textDecoration: q.solved ? "line-through" : "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  【Lv.{q.level}】{q.name}
                                </span>
                                {isReadyToSolve && <span style={{ fontSize: 8, color: C.gold, animation: "fadeUp 0.5s ease infinite alternate" }}>✨</span>}
                              </div>
                              
                              {!q.solved && (
                                <div style={{ fontSize: 8, color: isReadyToSolve ? C.gold : "#00bcd4", marginTop: 1 }}>
                                  {isReadyToSolve ? "調査完了：解決可能" : `💡 手がかり: ${q.clues || 0}/${q.level}`}
                                </div>
                              )}
                            </div>

                            {isGm && (
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  upd(p => {
                                    const isNowSolved = !q.solved;
                                    let nextQuests = p.quests.map(x => x.id === q.id ? { ...x, solved: isNowSolved } : x);
                                    // 次クエストの解放・真相の公開は GM クライアントの reconcileQuests が行う（シナリオ秘匿のため）
                                    return { ...p, quests: nextQuests };
                                  });
                                }}
                                style={{ width: 20, height: 20, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: q.solved ? C.red : "#4caf50", cursor: "pointer", borderRadius: 2, fontSize: 12, padding: 0 }}
                                >
                                {q.solved ? "↩" : "✓"}
                              </button>
                            )}
                          </div>

                          {isExpanded && (
                            <div style={{ padding: "0 8px 8px 22px", borderTop: "1px solid rgba(255,255,255,0.03)", animation: "fadeUp 0.2s ease" }}>
                              <div style={{ fontSize: 9, color: C.textDim, marginTop: 6, lineHeight: 1.4 }}>{q.summary}</div>
                              
                              {(isReadyToSolve || q.solved || isGm) && (
                                <div style={{ marginTop: 6, padding: "4px 6px", background: "rgba(200,160,64,0.05)", borderRadius: 2, borderLeft: `2px solid ${C.goldDim}` }}>
                                  <div style={{ fontSize: 8, color: C.goldDim, letterSpacing: 1, fontWeight: "bold" }}>真相 / 解決場所</div>
                                  <div style={{ fontSize: 9, color: C.text, marginTop: 2, whiteSpace: "pre-wrap" }}>{q.truth || "（真相なし）"}</div>
                                  {q.location && (
                                    <div style={{ fontSize: 9, color: "#90caf9", marginTop: 2 }}>📍 解決場所: {getSpot(q.location)?.name || `スポット[${q.location}]`}</div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}

                  {!isIntro && (gs.clues ||[]).length > 0 && (
                    <>
                      <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginBottom: 6, marginTop: 10 }}>手がかり配置済み</div>
                      {gs.clues.map(id => (
                        <div key={id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, padding: "2px 0" }}>
                          <span style={{ color: "#00bcd4" }}>💡[{getSpot(id)?.roll}] {getSpot(id)?.name}</span>
                          {isGm && <button onClick={() => upd(p => ({ ...p, clues: p.clues.filter(c => c !== id) }))} style={{ width: 16, height: 16, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.red, cursor: "pointer", borderRadius: 2, fontSize: 10, padding: 0 }}>✕</button>}
                        </div>
                      ))}
                    </>
                  )}
                  {gs.newspaper && !isIntro && (
                    <>
                      <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginBottom: 6, marginTop: 10 }}>本日の新聞</div>
                      <div style={{ padding: "6px 10px", background: C.blueBg, border: `1px solid ${C.blueBorder}`, borderRadius: 2, cursor: "pointer", borderLeft: `3px solid ${C.blue}` }} onClick={() => setPaperModal(gs.newspaper)}>
                        <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 2 }}>[{gs.newspaper.roll}]</div>
                        <div style={{ fontSize: 11, color: C.blue }}>{gs.newspaper.title}</div>
                      </div>
                    </>
                  )}
                  {gs.dice?.results && (
                    <div style={{ marginTop: 12, textAlign: "center" }}>
                      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 4 }}>
                        {gs.dice.results.map((d, i) => (
                          <div key={i} style={{ width: 44, height: 44, border: `2px solid ${gs.dice.rolling ? C.gold : C.goldDim}`, borderRadius: 3, background: "rgba(8,6,18,0.95)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: C.gold, fontWeight: "bold", animation: gs.dice.rolling ? "rollSpin 0.25s ease infinite" : "none", boxShadow: gs.dice.rolling ? `0 0 14px ${C.gold}50` : "none" }}>{d}</div>
                        ))}
                      </div>
                      {!gs.dice?.rolling && <div style={{ fontSize: 16, color: C.gold }}>{gs.dice?.results.join("")}</div>}
                    </div>
                  )}

                  {(gs.diceHistory || []).length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div onClick={() => setShowDiceHistory(v => !v)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginBottom: 6 }}>
                        <span>🎲 ダイス履歴 ({gs.diceHistory.length})</span>
                        <span style={{ fontSize: 9 }}>{showDiceHistory ? "▲" : "▼"}</span>
                      </div>
                      {showDiceHistory && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          {gs.diceHistory.slice(0, 20).map((h, i) => {
                            const mc = h.max === 6 ? C.gold : h.max === 1 ? C.red : C.textDim;
                            const tStr = h.t ? new Date(h.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
                            return (
                              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 6px", borderLeft: `2px solid ${mc}55`, borderBottom: `1px solid ${C.border}18`, fontSize: 10 }}>
                                <span style={{ color: C.textFaint, fontSize: 8, minWidth: 32 }}>{tStr}</span>
                                <span style={{ flex: 1, color: C.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.label}</span>
                                <span style={{ color: mc, fontWeight: "bold", fontFamily: "monospace" }}>{(h.results || []).join(" ")}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {tab === "pcs" && (
                <div>
                  {(gs.pcs || []).length === 0
                    ? <div style={{ fontSize: 10, color: "#2a3545" }}>PCなし</div>
                    : (gs.pcs || []).map(pc => (
                        <PCCard
                          key={pc.uid}
                          pc={pc}
                          gs={gs}
                          isGm={isGm}
                          onUpdatePc={updPc => upd(p => ({ ...p, pcs: p.pcs.map(x => x.uid === pc.uid ? updPc : x) }))}
                          upd={upd}
                          animateDice={animateDice}
                          getSpot={getSpot}
                          SPOTS={SPOTS}
                          room={room}
                          isOnline={!!presence[pc.uid]?.online}
                          myUid={user?.uid}
                        />
                      ))
                  }
                </div>
              )}

              {tab === "scene" && isGm && (
                <div>
                  <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginBottom: 8 }}>描写モード</div>
                  <SceneEditor gs={gs} upd={upd} sceneData={sceneData} setSceneData={setSceneData} user={user} />
                </div>
              )}

              {tab === "gm" && isGm && (
                <GmToolsPanel gs={gs} upd={upd} getSpot={getSpot} />
              )}

              {tab === "custom" && isGm && (
                <CustomRulesEditor gs={gs} upd={upd} SPOTS={SPOTS} getSpot={getSpot} />
              )}

              {tab === "log" && (() => {
                const logCategory = (e) =>
                  /^(⚔|✦|★|💀|⚖️)/.test(e) ? "combat"
                  : /^(🔵|🛡|💙|💠|🏃|🎬)/.test(e) ? "player"
                  : /^(✅|🎉|🌟|✨)/.test(e) ? "success"
                  : /^(💰|🏆)/.test(e) ? "reward"
                  : "other";
                const logColor = (e) =>
                  /^(🏆|🎉)/.test(e) ? C.gold
                  : /^💀/.test(e) ? C.red
                  : /^(🔮|💜)/.test(e) ? C.purple
                  : /^✨/.test(e) ? C.green
                  : /^(💡|🔍)/.test(e) ? "#00bcd4"
                  : /^(🛡|💠)/.test(e) ? C.blue
                  : /^⚖️/.test(e) ? C.gold
                  : C.textDim;
                const FILTERS = [
                  { key: "all", label: "すべて", color: C.textDim },
                  { key: "combat", label: "戦闘", color: C.red },
                  { key: "player", label: "行動", color: C.blue },
                  { key: "success", label: "成功", color: C.green },
                  { key: "reward", label: "報酬", color: C.gold },
                ];
                const allLogs = gs.log || [];
                const q = logSearch.trim();
                // 元配列の index を保持（同一文言の重複ログでも key が一意になるよう）
                const filtered = allLogs
                  .map((e, idx) => ({ e, idx }))
                  .filter(({ e }) =>
                    (logFilter === "all" || logCategory(e) === logFilter) &&
                    (q === "" || e.includes(q))
                  );
                return (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginBottom: 6 }}>
                      <span style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2 }}>セッションログ</span>
                      <span style={{ fontSize: 8, color: C.textFaint }}>{filtered.length}/{allLogs.length}</span>
                    </div>
                    <input
                      value={logSearch}
                      onChange={e => setLogSearch(e.target.value)}
                      placeholder="🔍 ログを検索..."
                      style={{ ...iStyle, width: "100%", boxSizing: "border-box", fontSize: 10, padding: "5px 8px", marginBottom: 6 }}
                    />
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 8 }}>
                      {FILTERS.map(f => {
                        const active = logFilter === f.key;
                        return (
                          <button key={f.key} onClick={() => setLogFilter(f.key)}
                            style={{ padding: "2px 9px", fontSize: 9, cursor: "pointer", borderRadius: 10,
                              background: active ? `${f.color}22` : "rgba(255,255,255,0.02)",
                              border: `1px solid ${active ? f.color : C.border}`,
                              color: active ? f.color : C.textFaint }}>
                            {f.label}
                          </button>
                        );
                      })}
                    </div>
                    {allLogs.length === 0 && <div style={{ fontSize: 10, color: C.textFaint }}>なし</div>}
                    {allLogs.length > 0 && filtered.length === 0 && <div style={{ fontSize: 10, color: C.textFaint, textAlign: "center", padding: 8 }}>該当するログがありません</div>}
                    {filtered.map(({ e, idx }) => {
                      const lc = logColor(e);
                      return <div key={idx} style={{ fontSize: 10, color: lc, padding: "3px 6px", borderBottom: `1px solid ${C.border}18`, borderLeft: `2px solid ${lc}55`, marginBottom: 1, animation: "logSlideIn 0.32s ease forwards" }}>{e}</div>;
                    })}
                  </div>
                );
              })()}
            </div>

            {paperModal && (() => { 
              const r = paperModal.roll;
              const isZoro = [11, 22, 33, 44, 55, 66].includes(r);
              const needsSpot = [14, 35, 46].includes(r);
              const is25 = r === 25;
              const is36 = r === 36;
              const is23 = r === 23;
              const is56 = r === 56;

              const saveApplied = (extra = {}) => {
                upd(p => ({ ...p, newspaper: { ...p.newspaper, applied: true, ...extra } }));
                setPaperModal(prev => ({ ...prev, applied: true, ...extra }));
              };

              const applyZoro = () => {
                const target = "66";
                saveApplied({ targetSpot: target });
                upd(p => ({ ...p, log: [`新聞[${r}]の効果が適用された（帰還先に博麗神社を指定可能）`, ...p.log] }));
              };

              const rollTargetSpot = () => {
                animateDice(2, "対象スポットの決定", res => {
                  const spotId = getSpotByD66(res[0], res[1], SPOTS);
                  saveApplied({ targetSpot: spotId });
                  upd(p => ({ ...p, log: [`新聞[${r}]の対象スポットが [${getSpot(spotId)?.name}] に決定した`, ...p.log] }));
                });
              };

              const apply25 = () => {
                animateDice(4, "手がかり2箇所配置", res => {
                  const s1 = getSpotByD66(res[0], res[1], SPOTS);
                  const s2 = getSpotByD66(res[2], res[3], SPOTS);
                  upd(p => ({
                    ...p,
                    newspaper: { ...p.newspaper, applied: true },
                    clues: [...new Set([...(p.clues || []), s1, s2].filter(Boolean))],
                    nonSearchCluePlaced: true, // 実績(鼠算式探索): 探し物以外の手がかり配置
                    log: [`新聞[25]の効果で [${getSpot(s1)?.name}] と [${getSpot(s2)?.name}] に手がかりが追加された`, ...p.log],
                  }));
                  setPaperModal(prev => ({ ...prev, applied: true }));
                });
              };

              const apply36 = () => {
                const count = (gs.clues || []).length;
                if (count > 0) {
                  animateDice(count * 2, "手がかり再配置", res => {
                    const newClues = [];
                    for (let i = 0; i < count; i++) {
                      const s = getSpotByD66(res[i * 2], res[i * 2 + 1], SPOTS);
                      if (s) newClues.push(s);
                    }
                    upd(p => ({
                      ...p,
                      newspaper: { ...p.newspaper, applied: true },
                      clues: [...new Set(newClues)],
                      nonSearchCluePlaced: true, // 実績(鼠算式探索): 探し物以外の手がかり再配置
                      log: [`新聞[36]の効果で、すべての手がかりが再配置された`, ...p.log],
                    }));
                    setPaperModal(prev => ({ ...prev, applied: true }));
                  });
                } else {
                  saveApplied();
                }
              };

              const apply23 = () => {
                upd(p => ({
                  ...p,
                  newspaper: { ...p.newspaper, applied: true },
                  pcs: p.pcs.map(pc => ({
                    ...pc,
                    resources: { ...pc.resources, やる気: { ...pc.resources.やる気, cur: Math.min(pc.resources.やる気.max, (pc.resources.やる気.cur || 0) + 1) } },
                  })),
                  log: [`新聞[23]の効果で、全員のやる気が1回復した！`, ...p.log],
                }));
                setPaperModal(prev => ({ ...prev, applied: true }));
              };

              const apply56 = () => {
                upd(p => ({
                  ...p,
                  newspaper: { ...p.newspaper, applied: true },
                  pcs: p.pcs.map(pc => ({ ...pc, flags: { ...pc.flags, canCureBadStatus: true } })),
                  log: [`新聞[56]の効果で、全員が任意の変調を1つ解除できるようになった！`, ...p.log],
                }));
                setPaperModal(prev => ({ ...prev, applied: true }));
              };

              const isActionNeeded = isZoro || needsSpot || is25 || is36 || is23 || is56;
              const canClose = !isActionNeeded || paperModal.applied;

              return (
                <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => canClose && setPaperModal(null)}>
                  <div style={{ background: "#0c1020", border: "1px solid #1e2d45", borderRadius: 6, padding: 20, maxWidth: 380, width: "90%", animation: "fadeUp 0.2s ease" }} onClick={e => e.stopPropagation()}>
                    <div style={{ fontSize: 9, letterSpacing: 3, color: "#2a3a50", textAlign: "center", marginBottom: 4 }}>— 文々。新聞 —</div>
                    {paperModal.dice && (
                      <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 8 }}>
                        {paperModal.dice.map((d, i) => (
                          <div key={i} style={{ width: 44, height: 44, border: "2px solid #1e3a5a", borderRadius: 6, background: "rgba(14,20,36,0.95)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: "#60c0f0", fontWeight: "bold" }}>{d}</div>
                        ))}
                      </div>
                    )}
                    <div style={{ fontSize: 18, color: "#1976d2", textAlign: "center", marginBottom: 6 }}>[{paperModal.roll}]</div>
                    <div style={{ fontSize: 13, color: "#60c0f0", marginBottom: 8, textAlign: "center" }}>{paperModal.title}</div>
                    <div style={{ fontSize: 11, color: "#4a6070", lineHeight: 1.8, marginBottom: 8 }}>{paperModal.effect}</div>
                    
                    {paperModal.targetSpot && (
                      <div style={{ padding: 6, background: "rgba(255,255,255,0.05)", borderRadius: 4, textAlign: "center", fontSize: 11, color: C.gold, animation: "fadeUp 0.3s ease" }}>
                        対象スポット: {getSpot(paperModal.targetSpot)?.name}
                      </div>
                    )}

                    {/* 風を操る（文）: 新聞表を振り直す（やる気消費はbaseのみ） */}
                    {!paperModal.applied && windHolder && (windHolder.uid === user?.uid || isGm) && (getActiveAbility(windHolder)?.name === "風を操る程度の能力＋" || (windHolder.resources?.やる気?.cur || 0) >= 1) && (
                      <button onClick={windReroll} style={{ ...btnFull("rgba(129,199,132,0.14)", C.greenBorder, C.green), marginTop: 8 }}>🌀 風: 新聞表を振り直す（{windHolder.charName}）</button>
                    )}
                    {isGm && !paperModal.applied && isZoro && <button onClick={applyZoro} style={{ ...btnFull(C.blueBg, C.blueBorder, C.blue), marginTop: 12 }}>適用する</button>}
                    {isGm && !paperModal.applied && needsSpot && <button onClick={rollTargetSpot} style={{ ...btnFull(C.goldBg, C.goldDim, C.gold), marginTop: 12 }}>🎲 対象スポットを決定する</button>}
                    {isGm && !paperModal.applied && is25 && <button onClick={apply25} style={{ ...btnFull(C.goldBg, C.goldDim, C.gold), marginTop: 12 }}>🎲 手がかりを配置する</button>}
                    {isGm && !paperModal.applied && is36 && <button onClick={apply36} style={{ ...btnFull(C.goldBg, C.goldDim, C.gold), marginTop: 12 }}>🎲 手がかりを再配置する</button>}
                    {isGm && !paperModal.applied && is23 && <button onClick={apply23} style={{ ...btnFull(C.blueBg, C.blueBorder, C.blue), marginTop: 12 }}>適用する</button>}
                    {isGm && !paperModal.applied && is56 && <button onClick={apply56} style={{ ...btnFull(C.blueBg, C.blueBorder, C.blue), marginTop: 12 }}>適用する</button>}

                    {(!isGm || canClose) && (
                      <button onClick={() => setPaperModal(null)} style={{ ...btnFull("transparent", C.border, C.textFaint), marginTop: 12 }}>閉じる</button>
                    )}
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </div>

      {showShortcuts && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 130, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setShowShortcuts(false)}>
          <SpellCard color={C.gold} title="✦ キーボードショートカット" style={{ maxWidth: 340, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                ["1 〜 4", "タブ切り替え（進行／PC一覧／描写／ログ）"],
                ...(isGm ? [["Enter", "状況に応じた主要アクションを実行"]] : []),
                ["M", "効果音 ON / OFF"],
                ["?", "このヘルプを開閉"],
                ["Esc", "ヘルプを閉じる"],
              ].map(([key, desc]) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <kbd style={{ minWidth: 44, textAlign: "center", padding: "3px 8px", fontSize: 11, color: C.gold, background: "rgba(200,160,64,0.12)", border: `1px solid ${C.goldDim}`, borderRadius: 4, fontFamily: "'Noto Serif JP', serif" }}>{key}</kbd>
                  <span style={{ fontSize: 10, color: C.textDim }}>{desc}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 8, color: C.textFaint, marginTop: 12, lineHeight: 1.6 }}>
              ※ 入力欄にカーソルがあるときは無効になります<br />
              ※ タブ右の 🎬 で演出（アニメーション）の抑制を切り替えられます
            </div>
            <button onClick={() => setShowShortcuts(false)} style={{ ...btnFull("rgba(255,255,255,0.05)", C.border, C.textDim), marginTop: 12 }}>閉じる</button>
          </SpellCard>
        </div>
      )}
    </div>
  );
}
