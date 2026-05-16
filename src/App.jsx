import { useState, useEffect, useRef, useCallback } from "react";
import { db, auth } from "./firebase";
import { ref, onValue, set, get } from "firebase/database";
import { onAuthStateChanged } from "firebase/auth";
import LobbyRoot, { CharSprite, CHARACTERS, PERSONALITY_SKILLS } from "./Lobby";
import { BackstoryScreen, BattleView, BonusPhaseView, RightPanel, ConfirmModal, INIT_RESOURCES, INIT_ITEMS, buildSpellCard } from "./SessionView";
import mapImg from "./assets/map.png";
import { C } from "./styles/colors";

import {
  SPOTS, EDGES, NEWSPAPER,
  AREA_COLORS, CYCLES, CYCLE_COLORS,
  OFFICIAL_DANMAKU_SKILLS,
} from "./data/gameData";

// ─── ユーティリティ ─────────────────────────────────────────────

function areaColor(area) {
  return AREA_COLORS[area] ?? { bg: "rgba(30,30,30,0.85)", border: "#555" };
}

// BFS でスタート地点から各スポットへの最短距離を求める
function getDistances(startSpotId) {
  if (!startSpotId) return {};
  const dists = { [startSpotId]: 0 };
  const queue = [startSpotId];
  while (queue.length > 0) {
    const cur = queue.shift();
    const curDist = dists[cur];
    EDGES.forEach(([a, b]) => {
      const next = a === cur ? b : b === cur ? a : null;
      if (next && dists[next] === undefined) {
        dists[next] = curDist + 1;
        queue.push(next);
      }
    });
  }
  return dists;
}

// スポットIDからスポットオブジェクトを取得（古いセーブデータの roll 検索も対応）
function getSpot(id) {
  return SPOTS.find(s => s.id === id) ?? SPOTS.find(s => s.roll == id) ?? null;
}

// シナリオデータの互換性チェックと正規化（旧仕様の dsType/dsName 等を nested ds に変換）
function normalizeScenario(s) {
  if (!s) return s;
  const clone = { ...s };
  clone.finalBattleEnemies = (s.finalBattleEnemies || []).map(en => {
    if (!en) return en;
    if (en.ds) return en; // 既に正規化済み
    const type = en.dsType || (en.dsName ? "official" : (en.dsCustomName || en.dsDesc ? "custom" : "none"));
    const name = en.dsName || en.dsCustomName || "";
    const desc = en.dsDesc || (type === "official" ? (OFFICIAL_DANMAKU_SKILLS.find(x => x.name === en.dsName)?.desc || "") : en.dsDesc || "");
    return { ...en, ds: { type, name, desc, customName: en.dsCustomName || "" } };
  });
  clone.quests = (s.quests || []).map(q => {
    if (!q) return q;
    const en = q.enemy;
    if (!en) return q;
    if (en.ds) return q;
    const type = en.dsType || (en.dsName ? "official" : (en.dsCustomName || en.dsDesc ? "custom" : "none"));
    const name = en.dsName || en.dsCustomName || "";
    const desc = en.dsDesc || (type === "official" ? (OFFICIAL_DANMAKU_SKILLS.find(x => x.name === en.dsName)?.desc || "") : en.dsDesc || "");
    const newEn = { ...en, ds: { type, name, desc, customName: en.dsCustomName || "" } };
    return { ...q, enemy: newEn };
  });
  return clone;
}

// ─── 定数 ────────────────────────────────────────────────────────

const MAP_NATURAL_W = 1200;
const MAP_NATURAL_H = 849;

const DEFAULT_GS = {
  sessionPhase: "intro",
  day: 1,
  cycleIdx: 0,
  clues: [],
  newspaper: null,
  newspaperDone: false,
  cluePlaced: false,
  reiryokuDone: false,
  resources: { やる気: [1, 3], 残り人数: [2, 5], スペルカード: [1, 5], グレイズ: [0, 5], 霊力: [0, 20], 攻撃力: [1, 5] },
  items: { お酒: 0, 小銭: 0, お守り: 0, Pアイテム: 0, 残機のかけら: 0, スペカのかけら: 0 },
  quests: [],
  log: [],
  pcs: [],
  sceneMode: false,
  sceneText: "",
  banner: null,
  actedPcs: [],
  dice: { rolling: false, results: [], label: "" },
  currentScene: null,
};

const DEFAULT_SCENE = { bg: null, portraits: [] };

// ─── カスタムフック ──────────────────────────────────────────────

function useMapBounds(containerRef) {
  const [bounds, setBounds] = useState({ left: 0, top: 0, width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const calc = () => {
      const scale = Math.min(el.clientWidth / MAP_NATURAL_W, el.clientHeight / MAP_NATURAL_H);
      setBounds({ left: 0, top: 0, width: MAP_NATURAL_W * scale, height: MAP_NATURAL_H * scale });
    };

    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  return bounds;
}

// ─── MapView（GM/PL共通）────────────────────────────────────────
function MapView({ gs, sceneData, isGm, upd, onSpotClick, user }) {
  const cycleIdx  = gs.cycleIdx || 0;
  const isNight   = cycleIdx === 3;
  const isEvening = cycleIdx === 2;
  const [hov, setHov] = useState(null);

  const mapRef   = useRef(null);
  const mapBounds = useMapBounds(mapRef);

  const scale    = mapBounds.width > 0 ? mapBounds.width / MAP_NATURAL_W : 0.5;
  const baseSize = Math.round(22 * Math.max(0.5, Math.min(scale * 1.8, 1.4)));
  const fontSize = Math.max(8, Math.round(10 * scale * 1.4));

  const isMovePhase = gs.currentScene?.phase === "move_dest";
  const actingPc    = isMovePhase ? (gs.pcs || []).find(p => p.uid === gs.currentScene.pcUid) : null;
  const isMyTurn    = actingPc?.uid === user?.uid;
  const dists       = actingPc ? getDistances(actingPc.currentSpot) : {};
  const maxDist     = gs.currentScene?.selectedMoveDie || 0;

  if (gs.sceneMode) {
    return (
      <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: "#040608" }}>
        {sceneData.bg && (
          <img src={sceneData.bg} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.85 }} />
        )}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg,rgba(0,0,0,0.05)0%,rgba(0,0,0,0.65)100%)" }} />
        <div style={{ position: "absolute", bottom: 110, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 16, alignItems: "flex-end" }}>
          {(sceneData.portraits ||[]).map((p, i) => (
            p.img && <img key={i} src={p.img} alt={p.name || ""} style={{ height: 320, objectFit: "contain", filter: "drop-shadow(0 4px 24px rgba(0,0,0,0.8))" }} />
          ))}
        </div>
        {gs.sceneText && (
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(6,8,16,0.93)", borderTop: "1px solid #1e2535", padding: "16px 28px" }}>
            <div style={{ fontSize: 14, color: "#c8b89a", lineHeight: 2.1, fontFamily: "serif", whiteSpace: "pre-wrap" }}>{gs.sceneText}</div>
          </div>
        )}
      </div>
    );
  }

  const mapFilter = isNight   ? "brightness(0.45) sepia(0) saturate(0.5)"
                  : isEvening ? "brightness(0.8) sepia(0.4) saturate(1.4) hue-rotate(-10deg)"
                  :             "brightness(1) sepia(0) saturate(1)";

  return (
    <div ref={mapRef} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: "#060810" }}>
      <style>{`
        @keyframes pulseReachable {
          0%   { transform: scale(1);    box-shadow: 0 0  0px #64b5f6; }
          50%  { transform: scale(1.25); box-shadow: 0 0 20px #64b5f6; }
          100% { transform: scale(1);    box-shadow: 0 0  0px #64b5f6; }
        }
      `}</style>
      <img src={mapImg} alt="幻想郷マップ" style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: "left top", filter: mapFilter, transition: "filter 2s ease" }} />

      {mapBounds.width > 0 && SPOTS.map(spot => {
        const isDream     = spot.id === "dream";
        const hasClue     = !isDream && (gs.clues ||[]).includes(spot.id);
        const pcsHere     = !isDream ? (gs.pcs || []).filter(pc => pc.currentSpot === spot.id) :[];
        const exactDist   = gs.currentScene?.exactMoveDist ?? null;
        const distance    = dists[spot.id] ?? 999;

        let newsMarker = null;
        if (gs.newspaper) {
          const r = gs.newspaper.roll;
          if (gs.newspaper.targetSpot === spot.id) {
            if ([14, 35, 46].includes(r) || r % 11 === 0) newsMarker = "📰";
          }
          if (r === 12 && spot.id === "11") newsMarker = "🍺";
          if (r === 13 && spot.id === "13") newsMarker = "🛍️";
          if (r === 15 && spot.id === "15") newsMarker = "♨️";
          if (r === 16 && spot.id === "11") newsMarker = "🚫";
          if (r === 45 && spot.id === "45") newsMarker = "🎲";
        }

        let isReachable = false;
        if (isMovePhase) {
          isReachable = exactDist ? distance === exactDist : (distance > 0 && distance <= maxDist);

          const isYoukai = (actingPc?.tags ||[]).includes("妖怪");
          if (gs.newspaper?.roll === 16 && isYoukai && spot.id === "11") {
            isReachable = false;
          }
        }

        const sx       = mapBounds.left + (spot.x / 100) * mapBounds.width;
        const sy       = mapBounds.top  + (spot.y / 100) * mapBounds.height;
        const isHov    = hov === spot.id;

        let borderCol = areaColor(spot.area).border;
        if (newsMarker)  borderCol = "#ffb74d";
        if (hasClue)     borderCol = "#00e5ff";
        if (isReachable) borderCol = "#64b5f6";

        const shadows = [];
        if (hasClue)    shadows.push("0 0 15px rgba(0,229,255,0.8), inset 0 0 10px rgba(0,229,255,0.4)");
        if (newsMarker) shadows.push("0 0 15px rgba(255,183,77,0.8), inset 0 0 10px rgba(255,183,77,0.4)");
        const boxShadow = shadows.length > 0 ? shadows.join(", ") : "none";

        const canClick  = isGm || (isMovePhase && isMyTurn && isReachable);

        return (
          <div key={spot.id}
            style={{ position: "absolute", left: sx, top: sy, transform: "translate(-50%,-50%)", zIndex: isReachable ? 15 : (hasClue || newsMarker || pcsHere.length ? 4 : 3), cursor: (canClick && !isDream) ? "pointer" : "default" }}
            onMouseEnter={() => setHov(spot.id)} onMouseLeave={() => setHov(null)} onClick={() => { if (canClick && !isDream) onSpotClick(spot.id); }}>
            
            {pcsHere.length > 0 && (
              <div style={{ position: "absolute", top: -baseSize / 2 - 4, left: "50%", transform: "translate(-50%, -100%)", display: "flex", gap: 2, pointerEvents: "none", zIndex: 10 }}>
                {pcsHere.map(p => {
                  const isAct = gs.currentScene?.pcUid === p.uid;
                  return (
                    <div key={p.uid} style={{ width: 24, height: 24, borderRadius: "50%", overflow: "hidden", border: `1.5px solid ${isAct ? "#64b5f6" : "#c8a040"}`, background: "#0b0d14", boxShadow: "0 2px 4px rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {p.customPortrait
                        ? <img src={p.customPortrait} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : <div style={{ transform: "translateY(-1px)" }}><CharSprite spriteRow={p.spriteRow ?? -1} spriteCol={p.spriteCol ?? -1} size={34} /></div>
                      }
                    </div>
                  );
                })}
              </div>
            )}

            {/* スポット本体（エフェクト付き） */}
            <div style={{ width: baseSize, height: baseSize, borderRadius: "50%", background: areaColor(spot.area).bg, border: `2px solid ${borderCol}`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold", fontSize: isDream ? fontSize - 1 : fontSize, color: "#fff", boxShadow: boxShadow, animation: isReachable ? "pulseReachable 1.5s infinite ease-in-out" : "none" }}>
              {isDream ? "◇" : (spot.roll ?? "?")}
            </div>

            {/* 手がかりマーカー（右上） */}
            {hasClue && <div style={{ position: "absolute", top: -Math.round(9 * scale * 1.4), right: -Math.round(9 * scale * 1.4), fontSize: Math.round(12 * scale * 1.4), filter: "drop-shadow(0 0 4px #00e5ff)" }}>💡</div>}

            {/* 新聞特殊効果マーカー（左下） */}
            {newsMarker && (
              <div style={{ position: "absolute", bottom: -Math.round(8 * scale * 1.4), left: -Math.round(8 * scale * 1.4), fontSize: Math.round(12 * scale * 1.4), filter: "drop-shadow(0 0 4px rgba(255,183,77,0.8))", zIndex: 20 }}>
                {newsMarker}
              </div>
            )}

            {isHov && (
              <div style={{ position: "absolute", background: "rgba(6,8,14,0.97)", border: "1px solid #1e2535", borderRadius: 4, padding: "4px 8px", fontSize: 10, color: "#c8b89a", whiteSpace: "nowrap", pointerEvents: "none", zIndex: 20, left: spot.x > 60 ? "auto" : "calc(100% + 6px)", right: spot.x > 60 ? "calc(100% + 6px)" : "auto", top: "50%", transform: "translateY(-50%)" }}>
                {isDream ? "◇ 夢の世界" : `[${spot.roll}] ${spot.name}`}
                {pcsHere.length > 0 && <span style={{ color: "#ef9a9a" }}><br />{pcsHere.map(p => p.charName || p.name).join("・")}</span>}
                {hasClue && <span style={{ color: "#00e5ff" }}><br />💡 手がかりあり</span>}
                {newsMarker && <span style={{ color: "#ffb74d" }}><br />{newsMarker} 新聞の特殊効果あり</span>}
              </div>
            )}
          </div>
        );
      })}

      <div style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 8 }}>
        {gs.sessionPhase === "explore" ? (
          <div style={{ padding: "4px 14px", background: "rgba(10,12,20,0.92)", border: `1px solid ${CYCLE_COLORS[cycleIdx]}40`, borderRadius: 14, fontSize: 12, color: CYCLE_COLORS[cycleIdx] }}>
            {gs.day}日目・{CYCLES[cycleIdx]}
          </div>
        ) : (
          <div style={{ padding: "4px 14px", background: "rgba(10,12,20,0.92)", border: "1px solid #9c27b040", borderRadius: 14, fontSize: 12, color: "#ce93d8" }}>
            ✦ 導入フェイズ
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SessionApp ──────────────────────────────────────────────────
function SessionApp({ roomCode, user }) {
  const [mode, setMode]             = useState(null);
  const [gs, setGs]                 = useState(DEFAULT_GS);
  const [sceneData, setSceneData]   = useState(DEFAULT_SCENE);
  const [synced, setSynced]         = useState(false);
  const [room, setRoom]             = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [questBanner, setQuestBanner]     = useState(null);
  const timerRef = useRef(null);

  const gsPath    = `rooms/${roomCode}/state`;
  const scenePath = `rooms/${roomCode}/scene`;

  const rollD6 = () => Math.floor(Math.random() * 6) + 1;
  const animateDice = (count, label, cb) => {
    if (timerRef.current) clearInterval(timerRef.current);
    upd(p => ({ ...p, dice: { rolling: true, results: [], label } }));
    let f = 0;
    timerRef.current = setInterval(() => {
      f++;
      const mid = Array(count).fill(0).map(rollD6);
      upd(p => ({ ...p, dice: { ...p.dice, results: mid } }));
      if (f >= 14) {
        clearInterval(timerRef.current);
        const res = Array(count).fill(0).map(rollD6);
        upd(p => ({ ...p, dice: { rolling: false, results: res, label } }));
        if (cb) cb(res);
      }
    }, 80);
  };

  useEffect(() => {
    const roomRef = ref(db, `rooms/${roomCode}`);
    const unsub   = onValue(roomRef, snap => {
      if (!snap.exists()) return;
      const r = snap.val();
      setRoom(r);
      const myPlayer = r.players?.[user.uid];
      if (myPlayer && !mode) setMode(myPlayer.role === "gm" ? "gm" : "pl");
    });
    return () => unsub();
  }, [roomCode, user.uid]);

  useEffect(() => {
    if (!mode) return;
    const gsRef    = ref(db, gsPath);
    const sceneRef = ref(db, scenePath);
    const timeout  = setTimeout(() => setSynced(true), 8000);

    const unsubGs = onValue(gsRef, snap => {
      clearTimeout(timeout);
      if (snap.exists()) {
        const val = snap.val();
        setGs(prev => ({
          ...DEFAULT_GS, ...val,
          resources: { ...DEFAULT_GS.resources, ...(val.resources || {}) },
          items:     { ...DEFAULT_GS.items,     ...(val.items     || {}) },
          pcs:    (val.pcs || []).map(normalizePc),
          scenarioData: normalizeScenario(val.scenarioData) ?? null,
          quests: val.quests || [],
          clues:  val.clues  || [],
          log:    val.log    || [],
        }));
      } else if (mode === "gm") {
        get(ref(db, `rooms/${roomCode}`)).then(roomSnap => {
          const r     = roomSnap.exists() ? roomSnap.val() : null;
          const initGs = {
            ...DEFAULT_GS,
            sessionPhase: "intro",
            limit:        r?.limit ?? r?.scenarioData?.limit ?? "3日目の夜",
            scenarioData: normalizeScenario(r?.scenarioData) ?? null,
            pcs:          buildPcList(r),
          };
          set(gsRef, initGs).catch(console.error);
        });
      }
      setSynced(true);
    }, () => { clearTimeout(timeout); setSynced(true); });

    const unsubScene = onValue(sceneRef, snap => {
      if (snap.exists()) {
        const val = snap.val();
        setSceneData({ bg: val.bg ?? null, portraits: val.portraits ?? [] });
      }
    });

    return () => { clearTimeout(timeout); unsubGs(); unsubScene(); };
  }, [mode, gsPath, scenePath]);

  function normalizePc(p) {
    const charData = CHARACTERS.find(c => c.id === p.charId) ?? null;
    const personality = p.personalitySkill ?? p.ps ?? (p.skillId ? {
      id:   p.skillId,
      name: p.skillName ?? PERSONALITY_SKILLS[p.skillId]?.name ?? "",
      type: PERSONALITY_SKILLS[p.skillId]?.type ?? null,
      desc: PERSONALITY_SKILLS[p.skillId]?.desc ?? null,
    } : null);

    return {
      ...p,
      as:  p.as  ?? charData?.as  ?? null,
      ds:  p.ds  ?? charData?.ds  ?? null,
      ps: personality,
    };
  }

  function buildPcList(r) {
    if (!r?.players) return [];
    return Object.values(r.players)
      .filter(p => p.role === "pl" && p.charId)
      .map(p => {
        const charData   = CHARACTERS.find(c => c.id === p.charId) ?? null;
        const charBase   = charData?.base ?? p.base ?? "人間の里";
        const baseSpot   = SPOTS.find(s => s.name === charBase || charBase.includes(s.name));
        const baseSpotId = baseSpot?.id ?? "11";

        let startSpotId = r?.scenarioData?.startSpotId ?? null;
        if (r?.scenarioData?.startSpotType === "base") startSpotId = baseSpotId;

        return {
          uid:    p.uid,
          name:   p.name,
          charId: p.charId,
          charName: p.charName,
          tags:   p.tags ?? charData?.tags ?? [],
          bonds: [], badStatus: [], flags: {},
          spriteRow:     p.spriteRow ?? -1,
          spriteCol:     p.spriteCol ?? -1,
          customPortrait: p.customPortrait ?? null,
          ps: p.personalitySkill ?? p.ps ?? (p.skillId ? {
            id:   p.skillId,
            name: p.skillName ?? PERSONALITY_SKILLS[p.skillId]?.name ?? "",
            type: PERSONALITY_SKILLS[p.skillId]?.type ?? null,
            desc: PERSONALITY_SKILLS[p.skillId]?.desc ?? null,
          } : null),
          as:  p.as  ?? charData?.as  ?? null,
          ds:  p.ds  ?? charData?.ds  ?? null,
          spellCards: (charData?.spellCards ?? p.spellCards ?? []).map(s =>
            typeof s === "string" ? buildSpellCard(s) : s
          ),
          growthSpellCard: (() => {
            const raw = charData?.growthSpellCard ?? p.growthSpellCard ?? null;
            return raw && typeof raw === "string" ? buildSpellCard(raw) : raw;
          })(),
          growthSpellUnlocked: p.growthSpellUnlocked ?? false,
          resources:   INIT_RESOURCES(),
          items:       INIT_ITEMS(),
          baseSpotId,
          currentSpot: startSpotId ?? "11",
          log: [],
        };
      });
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

  useEffect(() => {
    if (!synced || !room || mode !== "gm") return;
    const hasPlayers = Object.values(room.players || {}).some(p => p.role === "pl" && p.charId);
    if ((gs.pcs || []).length === 0 && hasPlayers) {
      upd(p => ({ ...p, pcs: buildPcList(room) }));
    }
  }, [synced, room, mode]);

  // ─── フェイズ遷移・進行処理 ────────────────────────────────────

  const doTransitionToExplore = () => {
    const startQuests = (gs.scenarioData?.quests ??[]).filter(q => (q.unlockType ?? "start") === "start");
    const clueCount   = Math.ceil(((gs.pcs || []).length || 1) / 2);
    const shuffled    = SPOTS.filter(s => s.roll !== null).sort(() => Math.random() - 0.5);
    const clueSpots   = shuffled.slice(0, clueCount).map(s => s.id);

    upd(p => ({
      ...p,
      sessionPhase: "explore", day: 1, cycleIdx: 0,
      clues:  clueSpots,
      quests: startQuests.map(q => ({ ...q, revealed: true, solved: false })),
      log: [`探索フェイズ開始。手がかりを${clueCount}箇所に配置。`, ...p.log],
    }));

    if (startQuests.length > 0) {
      setQuestBanner(startQuests);
      setTimeout(() => setQuestBanner(null), 6000);
    }
  };

  const startGambleBattle = (quest) => {
    const enemy = quest.enemy;
    upd(p => ({
      ...p,
      battle: {
        active: true,
        type: "normal",
        phase: "setup",
        questId: quest.id,
        participants: {
          npcs: [{
            id: "enemy_" + Date.now(),
            name: enemy.name,
            resources: {
              残り人数: { cur: enemy.life, max: 5 },
              スペルカード: { cur: enemy.spellcard, max: 5 },
              攻撃力: { cur: enemy.attack, max: 99 },
              回避力: { cur: enemy.evade || 3, max: 3 },
              グレイズ: { cur: 0, max: 5 }
            },
            ds: enemy.ds ?? { name: enemy.dsName || enemy.dsCustomName || "", desc: enemy.dsDesc || "" },
            spellCards: [
              { name: enemy.sc1name, desc: enemy.sc1effect },
              { name: enemy.sc2name, desc: enemy.sc2effect }
            ].filter(s => s.name)
          }]
        }
      }
    }));
  };

  const doNewspaper = (paper) => {
    upd(p => ({ ...p, newspaper: paper, log: [`新聞[${paper.roll}]「${paper.title}」`, ...p.log] }));
  };

  const doReiryoku = () => {
    upd(p => {
      const logParts = [];
      const newPcs = p.pcs.map(pc => {
        const spot = getSpot(pc.currentSpot);
        if (!spot) return pc;

        if ((pc.badStatus ||[]).includes("スランプ")) {
          logParts.push(`${pc.charName || pc.name} (スランプ)`);
          return pc;
        }

        let gain = spot.rei || 0;
        if (spot.reiD6) gain = Math.floor(Math.random() * 6) + 1;
        if (gain <= 0) return pc;

        const curRei  = pc.resources.霊力?.cur || 0;
        const maxRei  = pc.resources.霊力?.max || 20;
        const nextRei = Math.min(maxRei, curRei + gain);
        const nextAtk = 1 + Math.floor(nextRei / 5);
        logParts.push(`${pc.charName || pc.name}+${gain}`);
        return {
          ...pc,
          resources: {
            ...pc.resources,
            霊力:   { ...pc.resources.霊力,   cur: nextRei },
            攻撃力: { ...pc.resources.攻撃力, cur: nextAtk },
          },
        };
      });
      return {
        ...p, pcs: newPcs, reiryokuDone: true,
        log: [`【霊力増加】 ${logParts.length > 0 ? logParts.join(" / ") : "なし"}`, ...p.log],
      };
    });
  };

  const doAdvanceCycle = () => {
    upd(p => {
      let day      = p.day || 1;
      let cycleIdx = p.cycleIdx || 0;
      const logMsgs = [];
      let nextPcs = p.pcs;

      if (cycleIdx === 0) {
        nextPcs = nextPcs.map(pc => ({
          ...pc,
          flags: { ...pc.flags, canCureBadStatus: false }
        }));
      }

      cycleIdx++;
      if (cycleIdx >= CYCLES.length) {
        cycleIdx = 0;
        day++;
        nextPcs = p.pcs.map(pc => {
          let dest = pc.returnSpotId || pc.baseSpotId || "11";
          let curMotive = Math.max(0, (pc.resources.やる気?.cur || 0) - 1);

          if (p.newspaper?.targetSpot && dest === p.newspaper.targetSpot && (p.newspaper.roll === 14 || p.newspaper.roll % 11 === 0)) {
            curMotive = Math.min(pc.resources.やる気?.max || 3, curMotive + 1);
            logMsgs.push(`${pc.charName} は新聞効果のスポットに帰還し、やる気を回復した`);
          }

          return {
            ...pc,
            currentSpot: dest,
            returnSpotId: null,
            resources: {
              ...pc.resources,
              やる気: { ...pc.resources.やる気, cur: curMotive },
            },
          };
        });
        logMsgs.push("夜が明け、各キャラクターは拠点に帰還し【やる気】が1減少した");
      }

      if (cycleIdx === 2 && p.newspaper?.roll === 46) {
        nextPcs = nextPcs.map(pc => ({ ...pc, flags: { ...pc.flags, liveAvailable: true } }));
        logMsgs.push("ゲリラライブ開催！ 各PCは夕サイクル中にライブ会場へ向かうことができる");
      }

      let newQuests = [...(p.quests || [])];

      logMsgs.push(`${day}日目・${CYCLES[cycleIdx]}サイクル開始`);

      return {
        ...p, day, cycleIdx,
        newspaper:    cycleIdx === 0 ? null : p.newspaper,
        cluePlaced:   cycleIdx === 0 ? false : p.cluePlaced,
        reiryokuDone: false,
        quests:       newQuests,
        actedPcs: [],
        currentScene: null,
        pcs:          nextPcs,
        log: [...logMsgs.reverse(), ...p.log],
      };
    });
    setPendingAction(null);
  };

  const handleSpotClick = (spotId) => {
    const sc = gs.currentScene;
    if (sc?.phase !== "move_dest") return;

    const isGmMode  = mode === "gm";
    const isMyTurn  = sc.pcUid === user.uid;
    if (!isGmMode && !isMyTurn) return;

    const actingPc = (gs.pcs || []).find(p => p.uid === sc.pcUid);
    if (!actingPc) return;

    const dists     = getDistances(actingPc.currentSpot);
    const distance  = dists[spotId] ?? 999;
    const maxDist   = sc.selectedMoveDie || 0;
    const exactDist = sc.exactMoveDist ?? null;

    const isReachable = exactDist ? distance === exactDist : (distance > 0 && distance <= maxDist);

    if (isReachable || isGmMode) {
      upd(p => ({ ...p, currentScene: { ...p.currentScene, selectedDestSpot: spotId } }));
    }
  };

  const doTransitionToBattle = () => {
    const limitStr = gs.limit || "3日目の夜";
    const limitDay = parseInt(limitStr.match(/\d+/)?.[0] || 3);
    const limitCycleIdx = CYCLES.indexOf(limitStr.split("の")[1] || "夜");

    const currentDay = gs.day;
    const currentCycleIdx = gs.cycleIdx;

    const scenarioEnemies = gs.scenarioData?.finalBattleEnemies || [];
    const battleEnemies = scenarioEnemies.map((en, idx) => ({
      id: `npc_final_${idx}`,
      name: en.name || `強敵${idx + 1}`,
      resources: {
        残り人数: { cur: en.life, max: 5 },
        スペルカード: { cur: en.spellcard, max: 5 },
        攻撃力: { cur: en.attack, max: 99 },
        回避力: { cur: en.evade || 3, max: 3 }
      },
      ds: en.ds ?? { name: en.dsName || en.dsCustomName || "", desc: en.dsDesc || "" },
      spellCards: [
        { name: en.sc1name, desc: en.sc1effect },
        { name: en.sc2name, desc: en.sc2effect }
      ].filter(s => s.name)
    }));

    const initialBattle = {
      active: true,
      type: "mass",
      phase: "setup",
      round: 1,
      participants: { npcs: battleEnemies },
      actedPcs: [],
      actedNpcs: [],
      log: ["⚔️ 最終決戦の準備が整いました。"]
    };

    upd(p => {
      let nextPcs = [...p.pcs];
      let logAdd = [];

      if (room.config?.useAdditionalActions) {
        if (currentDay < limitDay) {
          const bonus = limitDay - currentDay;
          nextPcs = nextPcs.map(pc => ({
            ...pc,
            resources: { ...pc.resources, スペルカード: { ...pc.resources.スペルカード, cur: Math.min(pc.resources.スペルカード.max, (pc.resources.スペルカード.cur || 0) + bonus) } }
          }));
          logAdd.push(`早期解決ボーナス：全員がスペルカードを ${bonus} 点獲得した！`);
        } else if (currentDay === limitDay && currentCycleIdx < limitCycleIdx) {
          const bonusActions = limitCycleIdx - currentCycleIdx;
          const bonusStatus = {};
          p.pcs.forEach(pc => { bonusStatus[pc.uid] = bonusActions; });

          return {
            ...p,
            sessionPhase: "battle_bonus",
            bonusStatus,
            initialBattle: initialBattle,
            log: [`解決ボーナス：残り ${bonusActions} サイクル分の追加行動を獲得！`, ...p.log]
          };
        }
      }

      return {
        ...p,
        sessionPhase: "battle",
        pcs: nextPcs,
        battle: initialBattle,
        actedPcs: [],
        currentScene: null,
        log: [...logAdd, "⚔️ 決戦フェイズへ移行します。",...p.log],
      }
    });
    setPendingAction(null);
  };

  // ─── レンダリング ────────────────────────────────────────────

  if (!mode) return (
    <div style={{ background: "#040608", color: "#c8b89a", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "serif" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 22, color: "#c8a040", letterSpacing: 4, marginBottom: 20 }}>幻想ナラトグラフ</div>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button onClick={() => setMode("gm")} style={{ padding: "12px 24px", cursor: "pointer", borderRadius: 4, fontSize: 12, background: "rgba(192,57,43,0.18)", border: "1px solid #8b1a1a", color: "#e07060" }}>🎲 GM画面</button>
          <button onClick={() => setMode("pl")} style={{ padding: "12px 24px", cursor: "pointer", borderRadius: 4, fontSize: 12, background: "rgba(25,118,210,0.15)", border: "1px solid #0d47a1", color: "#64b5f6" }}>✦ PL共有画面</button>
        </div>
      </div>
    </div>
  );

  if (!synced) return (
    <div style={{ background: "#040608", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#3a4a5a", fontFamily: "serif", fontSize: 12 }}>Firebase に接続中…</div>
  );

  if (gs.sessionPhase === "intro") {
    return (
      <BackstoryScreen gs={gs} isGm={mode === "gm"} onProceed={() => upd(p => ({ ...p, sessionPhase: "intro_main", log: ["導入フェイズを開始した", ...p.log] }))} />
    );
  }

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", fontFamily: "serif" }}>
      <style>{`
        ::-webkit-scrollbar { width: 3px }
        ::-webkit-scrollbar-thumb { background: #1a1e2a }
        button:hover { opacity: 0.83 }
        @keyframes rollSpin {
          0% { transform: scale(1); }
          50% { transform: scale(1.1); filter: brightness(1.2); }
          100% { transform: scale(1); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {gs.sessionPhase === "battle_bonus" ? (
          <BonusPhaseView
            gs={gs} upd={upd} user={user} isGm={mode === "gm"}
            animateDice={animateDice}
            diceResult={gs.dice?.results} diceAnim={gs.dice?.rolling}
          />
        ) : gs.battle?.active ? (
          <BattleView
            gs={gs} upd={upd} user={user} isGm={mode === "gm"}
            animateDice={animateDice}
            diceResult={gs.dice?.results} diceAnim={gs.dice?.rolling} diceLabel={gs.dice?.label}
          />
        ) : (
          <MapView gs={gs} sceneData={sceneData} isGm={mode === "gm"} upd={upd} onSpotClick={handleSpotClick} user={user} />
        )}
      </div>

      <RightPanel
        gs={gs} upd={upd} sceneData={sceneData} setSceneData={setSceneDataAndSync}
        isGm={mode === "gm"} user={user} room={room} animateDice={animateDice}
        diceResult={gs.dice?.results} diceAnim={gs.dice?.rolling}
        CYCLES={CYCLES} CYCLE_COLORS={CYCLE_COLORS} NEWSPAPER={NEWSPAPER} getSpot={getSpot}
        doNewspaper={doNewspaper} doAdvanceCycle={doAdvanceCycle}
        doReiryoku={doReiryoku} doTransitionToExplore={doTransitionToExplore}
        pendingAction={pendingAction} setPendingAction={setPendingAction}
        SPOTS={SPOTS}
      />

      {questBanner && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 200, background: "rgba(6,8,16,0.97)", borderBottom: "1px solid #1e3a5a", padding: "16px 24px", animation: "fadeUp 0.3s ease" }}>
          <div style={{ fontSize: 11, color: "#4a6080", letterSpacing: 3, marginBottom: 8 }}>✦ クエスト公開</div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {questBanner.map(q => (
              <div key={q.id || q.name} style={{ padding: "8px 14px", background: "rgba(200,160,64,0.12)", border: "1px solid #8b6914", borderRadius: 5 }}>
                <div style={{ fontSize: 12, color: "#c8a040" }}>【Lv.{q.level}】{q.name}</div>
                <div style={{ fontSize: 10, color: "#6a7a90", marginTop: 2 }}>{q.summary}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {pendingAction && (
        <ConfirmModal
          title={
            pendingAction === "advance" ? "サイクルを進めますか？" : 
            pendingAction === "toBattle" ? "決戦フェイズへ移行しますか？" :
            "探索フェイズへ移行しますか？"
          }
          body={
            pendingAction === "toBattle" 
              ? "全てのクエストが解決されました。物語はクライマックスの決戦フェイズへと進みます。"
              : pendingAction === "advance"
                ? `${gs.day}日目・${CYCLES[gs.cycleIdx || 0]} → 次のフェーズへ進みます。`
                : "バックストーリーを経て探索フェイズへ移行します。"
          }
          okLabel={pendingAction === "toBattle" ? "決戦開始" : "進む"}
          okColor={pendingAction === "toBattle" ? C.red : "#e07060"}
          onOk={
            pendingAction === "toBattle" ? doTransitionToBattle :
            pendingAction === "advance" ? doAdvanceCycle : 
            () => { doTransitionToExplore(); setPendingAction(null); }
          }
          onCancel={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}

const LoadingScreen = ({ message, color = "#3a4a5a" }) => (
  <div style={{ background: "#040608", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color, fontFamily: "serif", fontSize: 12 }}>{message}</div>
);

export default function App() {
  const [user, setUser]           = useState(undefined);
  const [roomCode, setRoomCode]   = useState(null);
  const [roomPhase, setRoomPhase] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const r = params.get("room");
    if (r) setRoomCode(r.toUpperCase());

    const unsub = onAuthStateChanged(auth, u => setUser(u || null));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!roomCode) return;
    const roomRef = ref(db, `rooms/${roomCode}`);
    const unsub   = onValue(roomRef, snap => {
      setRoomPhase(snap.exists() ? (snap.val().phase || "prep") : "error");
    });
    return () => unsub();
  }, [roomCode]);

  if (user === undefined)   return <LoadingScreen message="接続中…" />;
  if (!user || !roomCode)   return <LobbyRoot />;
  if (roomPhase === null)   return <LoadingScreen message="部屋情報を取得中…" />;
  if (roomPhase === "error") return <LoadingScreen message="部屋が見つかりません。URLを確認してください。" color="#e07060" />;
  if (roomPhase === "prep") return <LobbyRoot />;

  return <SessionApp roomCode={roomCode} user={user} />;
}