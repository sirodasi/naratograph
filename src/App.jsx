import { useState, useEffect, useRef, useCallback } from "react";
import { db, auth } from "./firebase";
import { ref, onValue, set, get, onDisconnect, remove, serverTimestamp } from "firebase/database";
import { onAuthStateChanged } from "firebase/auth";
import LobbyRoot, { CharSprite, CHARACTERS, PERSONALITY_SKILLS } from "./Lobby";
import { BackstoryScreen, EpilogueView, SceneStage, BattleView, BonusPhaseView, SessionEndView, RightPanel, ConfirmModal, INIT_RESOURCES, INIT_ITEMS, buildBattleNpc } from "./SessionView";
import { useIsMobile } from "./useIsMobile";
import mapImg from "./assets/map.png";
import { C } from "./styles/colors";
import { sfx } from "./audio";
import { motion } from "./motion";
import { bgm } from "./bgm";

import {
  SPOTS, EDGES, NEWSPAPER,
  AREA_COLORS, CYCLES, CYCLE_COLORS,
  OFFICIAL_DANMAKU_SKILLS,
} from "./data/gameData";
import { SPOT_DETAILS } from "./data/spots";
import { applyAbilityPassiveStats, getActiveAbility, getBaseSpots } from "./data/abilityEffects";
import { getBlockedSpots, resolveBaseSpot } from "./scenarios";

// ─── ユーティリティ ─────────────────────────────────────────────

function areaColor(area) {
  return AREA_COLORS[area] ?? { bg: "rgba(30,30,30,0.85)", border: "#555" };
}

// BFS でスタート地点から各スポットへの最短距離を求める。
// extraEdges: 能力による追加ルート（getAbilityMoveEdges）を渡すと EDGES に加えて探索する。
export function getDistances(startSpotId, extraEdges = []) {
  if (!startSpotId) return {};
  const allEdges = extraEdges.length ? [...EDGES, ...extraEdges] : EDGES;
  const dists = { [startSpotId]: 0 };
  const queue = [startSpotId];
  while (queue.length > 0) {
    const cur = queue.shift();
    const curDist = dists[cur];
    allEdges.forEach(([a, b]) => {
      const next = a === cur ? b : b === cur ? a : null;
      if (next && dists[next] === undefined) {
        dists[next] = curDist + 1;
        queue.push(next);
      }
    });
  }
  return dists;
}

// 移動BFS拡張系の能力が追加する仮想ルート（[a,b] の配列）を返す。
// 壁をすり抜け＝同エリア内を全結合（＋は現在地と10の位±1のスポットも）／
// 乾＋＝拠点同士を結合／坤＋＝人間の里(11)↔守矢神社(22)。
export function getAbilityMoveEdges(pc) {
  if (!pc) return [];
  const name = getActiveAbility(pc)?.name;
  if (!name) return [];
  const edges = [];
  const realSpots = SPOTS.filter(s => s.id !== "dream");
  if (name === "壁をすり抜けられる程度の能力" || name === "壁をすり抜けられる程度の能力＋") {
    const byArea = {};
    realSpots.forEach(s => { (byArea[s.area] = byArea[s.area] || []).push(s.id); });
    Object.values(byArea).forEach(ids => {
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) edges.push([ids[i], ids[j]]);
    });
    if (name === "壁をすり抜けられる程度の能力＋") {
      const cur = realSpots.find(s => s.id === pc.currentSpot);
      if (cur) {
        const t = Math.floor(cur.roll / 10);
        realSpots.forEach(s => { if (s.id !== pc.currentSpot && Math.abs(Math.floor(s.roll / 10) - t) === 1) edges.push([pc.currentSpot, s.id]); });
      }
    }
  }
  if (name === "乾を創造する程度の能力＋") {
    const bases = getBaseSpots(pc);
    for (let i = 0; i < bases.length; i++) for (let j = i + 1; j < bases.length; j++) edges.push([bases[i], bases[j]]);
  }
  if (name === "坤を創造する程度の能力＋") {
    edges.push(["11", "22"]); // 人間の里 ↔ 守矢神社（"選んだキャラ"への付与はGM運用、保持者本人に適用）
  }
  return edges;
}

// スポットIDからスポットオブジェクトを取得（古いセーブデータの roll 検索も対応）
function getSpot(id) {
  return SPOTS.find(s => s.id === id) ?? SPOTS.find(s => s.roll == id) ?? null;
}

// シナリオデータの互換性チェックと正規化（旧仕様の dsType/dsName 等を nested ds に変換）
export function normalizeScenario(s) {
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
  diceHistory: [],
  bgm: { explore: "", battle: "", end: "" },
  currentScene: null,
};

const DEFAULT_SCENE = { bg: null, portraits: [] };

// Firebase は値に undefined を含むと set が例外を投げる（"contains undefined in property ..."）。
// 空オブジェクト/配列を書くと除去される影響で、次回の読み戻しが undefined になり、それを再書込すると失敗する。
// 書込直前にオブジェクトのキーから undefined を再帰的に除去して防御する（ローカル state は元のまま）。
function stripUndefined(v) {
  if (Array.isArray(v)) return v.map(stripUndefined);
  if (v && typeof v === "object") {
    const out = {};
    for (const k in v) if (v[k] !== undefined) out[k] = stripUndefined(v[k]);
    return out;
  }
  return v;
}

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
  // 手下シーンの移動は手下のスポットから（手下は能力ルート拡張なし）
  const actingMinion = isMovePhase && gs.currentScene?.minionId ? (gs.minions || []).find(m => m.id === gs.currentScene.minionId) : null;
  const moveStart   = actingMinion ? actingMinion.currentSpot : actingPc?.currentSpot;
  const dists       = moveStart ? getDistances(moveStart, actingMinion ? [] : getAbilityMoveEdges(actingPc)) : {};
  const maxDist     = gs.currentScene?.selectedMoveDie || 0;
  const myPc        = (gs.pcs || []).find(p => p.uid === user?.uid);
  const mySpot      = myPc?.currentSpot;
  // このシナリオで探索不可のスポット（例: 紅魔館封鎖）。移動先候補から除外する。
  const blockedSpots = getBlockedSpots(gs.scenarioData, gs);

  if (gs.sceneMode) {
    return <SceneStage sceneData={sceneData} sceneText={gs.sceneText} />;
  }

  const mapFilter = isNight   ? "brightness(0.45) sepia(0) saturate(0.5)"
                  : isEvening ? "brightness(0.8) sepia(0.4) saturate(1.4) hue-rotate(-10deg)"
                  :             "brightness(1) sepia(0) saturate(1)";

  return (
    <div ref={mapRef} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: "#060810" }}>
      <style>{`
        @keyframes pulseRing {
          0%   { transform: translate(-50%,-50%) scale(1);   opacity: 0.75; }
          100% { transform: translate(-50%,-50%) scale(2.3); opacity: 0; }
        }
        @keyframes mySpotGlow {
          0%,100% { box-shadow: 0 0 10px rgba(200,160,64,0.75), inset 0 0 6px rgba(200,160,64,0.25); }
          50%     { box-shadow: 0 0 26px rgba(200,160,64,0.95), 0 0 48px rgba(200,160,64,0.18), inset 0 0 14px rgba(200,160,64,0.4); }
        }
        @keyframes myPortraitGlow {
          0%,100% { box-shadow: 0 2px 4px rgba(0,0,0,0.8); }
          50%     { box-shadow: 0 2px 4px rgba(0,0,0,0.8), 0 0 14px rgba(200,160,64,0.85); }
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

        const isBlocked = !isDream && blockedSpots.includes(spot.id);

        let isReachable = false;
        if (isMovePhase) {
          isReachable = exactDist ? distance === exactDist : (distance > 0 && distance <= maxDist);

          const isYoukai = (actingPc?.tags ||[]).includes("妖怪");
          if (gs.newspaper?.roll === 16 && isYoukai && spot.id === "11") {
            isReachable = false;
          }
          if (isBlocked) isReachable = false;
        }

        const sx       = mapBounds.left + (spot.x / 100) * mapBounds.width;
        const sy       = mapBounds.top  + (spot.y / 100) * mapBounds.height;
        const isHov    = hov === spot.id;

        const isMySpot = !isDream && mySpot === spot.id;

        let borderCol = areaColor(spot.area).border;
        if (isBlocked && !hasClue && !newsMarker && !isMySpot) borderCol = "#6b3a35";
        if (isMySpot && !hasClue && !isReachable) borderCol = "#c8a040";
        if (newsMarker)  borderCol = "#ffb74d";
        if (hasClue)     borderCol = "#00e5ff";
        if (isReachable) borderCol = "#64b5f6";

        const shadows = [];
        if (isMySpot)   shadows.push("0 0 14px rgba(200,160,64,0.8), inset 0 0 8px rgba(200,160,64,0.3)");
        if (hasClue)    shadows.push("0 0 15px rgba(0,229,255,0.8), inset 0 0 10px rgba(0,229,255,0.4)");
        if (newsMarker) shadows.push("0 0 15px rgba(255,183,77,0.8), inset 0 0 10px rgba(255,183,77,0.4)");
        const boxShadow = shadows.length > 0 ? shadows.join(", ") : "none";

        const canClick  = isGm || (isMovePhase && isMyTurn && isReachable);

        return (
          <div key={spot.id}
            style={{ position: "absolute", left: sx, top: sy, transform: "translate(-50%,-50%)", zIndex: isReachable ? 15 : (hasClue || newsMarker ? 4 : 3), cursor: (canClick && !isDream) ? "pointer" : "default" }}
            onMouseEnter={() => setHov(spot.id)} onMouseLeave={() => setHov(null)} onClick={() => { if (canClick && !isDream) onSpotClick(spot.id); }}>

            {/* 移動可能リング */}
            {isReachable && (
              <div style={{ position: "absolute", left: "50%", top: "50%", width: baseSize, height: baseSize, borderRadius: "50%", border: "2px solid rgba(100,181,246,0.8)", pointerEvents: "none", animation: "pulseRing 1.4s ease-out infinite" }} />
            )}

            {/* スポット本体 */}
            <div style={{ width: baseSize, height: baseSize, borderRadius: "50%", background: areaColor(spot.area).bg, border: `2px solid ${borderCol}`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold", fontSize: isDream ? fontSize - 1 : fontSize, color: "#fff", boxShadow: boxShadow, animation: isMySpot ? "mySpotGlow 2.5s ease-in-out infinite" : "none" }}>
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

            {/* 立入禁止マーカー（シナリオで封鎖されたスポット） */}
            {isBlocked && (
              <div style={{ position: "absolute", top: -Math.round(9 * scale * 1.4), right: -Math.round(9 * scale * 1.4), fontSize: Math.round(12 * scale * 1.4), filter: "drop-shadow(0 0 4px rgba(224,112,96,0.85))", zIndex: 20 }}>
                🚫
              </div>
            )}

            {isHov && (() => {
              const detail = !isDream ? SPOT_DETAILS[spot.id] : null;
              const tags   = detail?.tags || [];
              const fullDesc = detail?.desc || "";
              const shortDesc = fullDesc.split(/\n|アドバイス/)[0].trim().slice(0, 90);
              const eventCount = detail?.events?.length || 0;
              return (
                <div style={{
                  position: "absolute",
                  background: "rgba(6,8,14,0.97)",
                  border: "1px solid #2a3550",
                  borderRadius: 4,
                  padding: "8px 10px",
                  fontSize: 10,
                  color: "#c8b89a",
                  pointerEvents: "none",
                  zIndex: 25,
                  left:  spot.x > 60 ? "auto" : "calc(100% + 6px)",
                  right: spot.x > 60 ? "calc(100% + 6px)" : "auto",
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 240,
                  whiteSpace: "normal",
                  lineHeight: 1.55,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
                  animation: "spotTipIn 0.18s ease both",
                }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4, borderBottom: "1px solid #1e2535", paddingBottom: 4 }}>
                    <span style={{ fontSize: 9, color: "#5a6a82", letterSpacing: 1 }}>[{isDream ? "◇" : spot.roll}]</span>
                    <span style={{ fontSize: 12, color: "#e8d8b8", fontWeight: "bold" }}>{isDream ? "夢の世界" : spot.name}</span>
                  </div>

                  {!isDream && tags.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 5 }}>
                      {tags.map(t => (
                        <span key={t} style={{ padding: "1px 6px", background: "rgba(200,160,64,0.12)", border: "1px solid rgba(200,160,64,0.35)", borderRadius: 8, fontSize: 9, color: "#c8a040" }}>{t}</span>
                      ))}
                    </div>
                  )}

                  {!isDream && shortDesc && (
                    <div style={{ fontSize: 9, color: "rgba(200,184,154,0.65)", marginBottom: 5 }}>
                      {shortDesc}{fullDesc.length > shortDesc.length ? "…" : ""}
                    </div>
                  )}

                  {!isDream && eventCount > 0 && (
                    <div style={{ fontSize: 9, color: "#8aa0c0", marginBottom: 3 }}>📜 イベント {eventCount} 種</div>
                  )}

                  {pcsHere.length > 0 && <div style={{ fontSize: 10, color: "#ef9a9a", marginTop: 4 }}>● {pcsHere.map(p => p.charName || p.name).join("・")}</div>}
                  {hasClue && <div style={{ fontSize: 10, color: "#00e5ff", marginTop: 2 }}>💡 手がかりあり</div>}
                  {newsMarker && <div style={{ fontSize: 10, color: "#ffb74d", marginTop: 2 }}>{newsMarker} 新聞の特殊効果あり</div>}
                  {isBlocked && <div style={{ fontSize: 10, color: "#e07060", marginTop: 2 }}>🚫 立入禁止（このシナリオでは訪問できません）</div>}
                </div>
              );
            })()}
          </div>
        );
      })}

      {/* ── PC移動アニメーションレイヤー ── */}
      {mapBounds.width > 0 && (() => {
        // 同スポットにいるPC数を事前集計（横オフセット用）
        const pcsBySpot = {};
        (gs.pcs || []).forEach(pc => {
          const id = pc.currentSpot || "__none__";
          if (!pcsBySpot[id]) pcsBySpot[id] = [];
          pcsBySpot[id].push(pc);
        });

        return (gs.pcs || []).map(pc => {
          if (!pc.currentSpot || pc.offMap) return null; // 超能力でコマを取り除いている間は非表示
          const spot = SPOTS.find(s => s.id === pc.currentSpot);
          if (!spot) return null;

          const px      = (spot.x / 100) * mapBounds.width;
          const py      = (spot.y / 100) * mapBounds.height;
          const mates   = pcsBySpot[pc.currentSpot] || [];
          const idx     = mates.findIndex(p => p.uid === pc.uid);
          const offsetX = (idx - (mates.length - 1) / 2) * 26;
          const isAct   = gs.currentScene?.pcUid === pc.uid;
          const isMyPc  = pc.uid === user?.uid;

          return (
            <div key={pc.uid} style={{
              position: "absolute",
              left: px + offsetX,
              top: py - baseSize / 2 - 4,
              transform: "translate(-50%, -100%)",
              zIndex: 22,
              pointerEvents: "none",
              transition: "left 0.52s cubic-bezier(0.4,0,0.2,1), top 0.52s cubic-bezier(0.4,0,0.2,1)",
            }}>
              <div style={{
                width: 24, height: 24, borderRadius: "50%", overflow: "hidden",
                border: `1.5px solid ${isAct ? "#64b5f6" : "#c8a040"}`,
                background: "#0b0d14",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: isAct ? "0 0 8px rgba(100,181,246,0.6)" : "0 2px 4px rgba(0,0,0,0.8)",
                animation: isMyPc ? "myPortraitGlow 2.5s ease-in-out infinite" : "none",
              }}>
                {pc.customPortrait
                  ? <img src={pc.customPortrait} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <div style={{ transform: "translateY(-1px)" }}><CharSprite spriteRow={pc.spriteRow ?? -1} spriteCol={pc.spriteCol ?? -1} size={34} /></div>
                }
              </div>
            </div>
          );
        });
      })()}

      {/* 手下（minion）レイヤー: 所有者の手下をスポット近くに小トークンで表示 */}
      {(() => {
        const minions = gs.minions || [];
        const bySpot = {};
        minions.forEach(m => { (bySpot[m.currentSpot] = bySpot[m.currentSpot] || []).push(m); });
        return minions.map(m => {
          const spot = SPOTS.find(s => s.id === m.currentSpot);
          if (!spot) return null;
          const px = (spot.x / 100) * mapBounds.width;
          const py = (spot.y / 100) * mapBounds.height;
          const mates = bySpot[m.currentSpot] || [];
          const idx = mates.findIndex(x => x.id === m.id);
          const offsetX = (idx - (mates.length - 1) / 2) * 18;
          return (
            <div key={m.id} title={`${m.ownerName} の手下`} style={{
              position: "absolute", left: px + offsetX, top: py + baseSize / 2 + 2,
              transform: "translate(-50%, 0)", zIndex: 21, pointerEvents: "none",
              transition: "left 0.52s cubic-bezier(0.4,0,0.2,1), top 0.52s cubic-bezier(0.4,0,0.2,1)",
            }}>
              <div style={{
                width: 16, height: 16, borderRadius: "50%", background: "#1a0f1f",
                border: "1.5px solid #ce93d8", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 9, color: "#ce93d8", boxShadow: "0 1px 3px rgba(0,0,0,0.8)",
              }}>手</div>
            </div>
          );
        });
      })()}

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
  const [questBanner, setQuestBanner]         = useState(null);
  const [cycleOverlay, setCycleOverlay]       = useState(null);
  const [questSolveFlash, setQuestSolveFlash] = useState(null);
  const [clueFlash, setClueFlash]             = useState(false);
  const [sceneStartFlash, setSceneStartFlash] = useState(null);
  const [phaseFlash, setPhaseFlash]           = useState(null);
  const [connected, setConnected]   = useState(true);
  const [presence, setPresence]     = useState({});
  const isMobile = useIsMobile();           // スマホ等の狭い画面か
  const [panelOpen, setPanelOpen] = useState(false); // モバイル: 右パネル（ドロワー）の開閉
  const [pendingReroll, setPendingReroll] = useState(null); // 空を飛ぶ: 表ロール後の振り直しプロンプト { results, count, label, holderUid, rerolled }
  const pendingRerollCb = useRef(null); // 振り直し確定時に呼ぶ cb
  const timerRef      = useRef(null);
  const prevCycleRef  = useRef({ day: null, cycleIdx: null });
  const prevQuestsRef = useRef(null);
  const prevCluesRef  = useRef(null);
  const prevScenePcRef    = useRef(undefined);
  const prevSessionPhase  = useRef(null);
  const prevBattleActive  = useRef(null);

  const CYCLE_ICONS = ["☀", "🌤", "🌅", "🌙"];

  // サイクル進行（day/cycleIdx の変化）を検出してオーバーレイと効果音を発火
  useEffect(() => {
    if (gs.sessionPhase !== "explore") {
      prevCycleRef.current = { day: gs.day, cycleIdx: gs.cycleIdx };
      return;
    }
    const prev = prevCycleRef.current;
    if (prev.day !== null && (gs.day !== prev.day || gs.cycleIdx !== prev.cycleIdx)) {
      setCycleOverlay({ day: gs.day, cycleIdx: gs.cycleIdx || 0 });
      sfx.cycle(gs.cycleIdx || 0);
    }
    prevCycleRef.current = { day: gs.day, cycleIdx: gs.cycleIdx };
  }, [gs.day, gs.cycleIdx, gs.sessionPhase]);

  useEffect(() => {
    if (!cycleOverlay) return;
    const t = setTimeout(() => setCycleOverlay(null), 3200);
    return () => clearTimeout(t);
  }, [cycleOverlay]);

  // クエスト解決を検出してフラッシュ
  useEffect(() => {
    const solvedIds = (gs.quests || []).filter(q => q.solved).map(q => String(q.id));
    if (prevQuestsRef.current === null) { prevQuestsRef.current = solvedIds; return; }
    const newlySolved = (gs.quests || []).filter(q => q.solved && !prevQuestsRef.current.includes(String(q.id)));
    prevQuestsRef.current = solvedIds;
    if (newlySolved.length > 0 && gs.sessionPhase !== "end" && !gs.battle?.active) {
      setQuestSolveFlash(newlySolved[0]);
      sfx.questSolve();
      const t = setTimeout(() => setQuestSolveFlash(null), 3600);
      return () => clearTimeout(t);
    }
  }, [gs.quests]);

  // 手がかり配置を検出してバナー
  useEffect(() => {
    const len = (gs.clues || []).length;
    if (prevCluesRef.current === null) { prevCluesRef.current = len; return; }
    if (len > prevCluesRef.current) {
      setClueFlash(true);
      sfx.cluePlaced();
      const t = setTimeout(() => setClueFlash(false), 2400);
      prevCluesRef.current = len;
      return () => clearTimeout(t);
    }
    prevCluesRef.current = len;
  }, [gs.clues]);

  // シーン開始を検出してタイトルカード（バトル中は抑止）
  useEffect(() => {
    const curUid = gs.currentScene?.pcUid || null;
    const prev   = prevScenePcRef.current;
    if (prev === undefined) { prevScenePcRef.current = curUid; return; }
    prevScenePcRef.current = curUid;
    if (gs.battle?.active) return;
    if (curUid && curUid !== prev) {
      // シーン開始
      const pc = (gs.pcs || []).find(p => p.uid === curUid);
      if (pc) {
        setSceneStartFlash({ charName: pc.charName || pc.name || "?", uid: curUid });
        sfx.sceneStart();
        const t = setTimeout(() => setSceneStartFlash(null), 2400);
        return () => clearTimeout(t);
      }
    } else if (!curUid && prev) {
      // シーン終了（currentScene が null になった）
      sfx.sceneEnd();
    }
  }, [gs.currentScene?.pcUid, gs.battle?.active]);

  // フェーズ遷移（sessionPhase / battle.active）を検出
  useEffect(() => {
    const curPhase  = gs.sessionPhase;
    const curBattle = !!gs.battle?.active;
    const prevPhase = prevSessionPhase.current;
    const prevBatt  = prevBattleActive.current;
    if (prevPhase === null) {
      prevSessionPhase.current = curPhase;
      prevBattleActive.current = curBattle;
      return;
    }

    let flash = null;
    if (prevBatt === false && curBattle === true) {
      flash = { title: "弾幕ごっこ", subtitle: "DANMAKU BATTLE", icon: "⚔", color: "#e07060" };
    } else if (prevPhase !== curPhase) {
      if (curPhase === "explore" && prevPhase === "intro") {
        flash = { title: "探索フェイズ", subtitle: "EXPLORE", icon: "✦", color: "#64b5f6" };
      } else if (curPhase === "battle_bonus") {
        flash = { title: "ボーナスフェイズ", subtitle: "BONUS", icon: "✨", color: "#c8a040" };
      }
    }

    prevSessionPhase.current = curPhase;
    prevBattleActive.current = curBattle;

    if (flash) {
      setPhaseFlash(flash);
      const t = setTimeout(() => setPhaseFlash(null), 2600);
      return () => clearTimeout(t);
    }
  }, [gs.sessionPhase, gs.battle?.active]);

  // ── 接続状態の監視 + 自分のプレゼンス登録 ──────────────────────────────
  useEffect(() => {
    if (!user?.uid) return;
    const connRef = ref(db, ".info/connected");
    const presRef = ref(db, `rooms/${roomCode}/presence/${user.uid}`);
    const unsub = onValue(connRef, snap => {
      const isConnected = snap.val() === true;
      setConnected(isConnected);
      if (isConnected) {
        // 切断時に自動削除されるよう予約してからオンライン登録
        onDisconnect(presRef).remove().catch(() => {});
        set(presRef, { online: true, name: user.displayName || "?", ts: serverTimestamp() }).catch(() => {});
      }
    });
    return () => {
      unsub();
      remove(presRef).catch(() => {});
    };
  }, [roomCode, user?.uid]);

  // ── 全参加者のプレゼンスを購読 ─────────────────────────────────────────
  useEffect(() => {
    const presRef = ref(db, `rooms/${roomCode}/presence`);
    const unsub = onValue(presRef, snap => setPresence(snap.val() || {}));
    return () => unsub();
  }, [roomCode]);

  // ── BGM: 自動再生のアンロック（初回ポインタ操作） ──────────────────────
  useEffect(() => {
    const unlock = () => { bgm.unlock(); window.removeEventListener("pointerdown", unlock); };
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  // ── BGM: フェーズに応じてトラックを切り替え ────────────────────────────
  useEffect(() => {
    const b = gs.bgm || {};
    const url = gs.battle?.active ? (b.battle || "")
      : gs.sessionPhase === "end" ? (b.end || "")
      : (b.explore || "");  // intro / explore など通常時
    bgm.setTrack(url);
  }, [gs.bgm, gs.battle?.active, gs.sessionPhase]);

  // ルーム離脱時に BGM を停止
  useEffect(() => () => { bgm.setTrack(""); }, []);

  // モバイル: 自分のシーンが始まったら右パネル（ドロワー）を自動で開く
  useEffect(() => {
    if (isMobile && gs.currentScene?.pcUid === user?.uid) setPanelOpen(true);
  }, [gs.currentScene?.pcUid, isMobile, user?.uid]);

  const gsPath    = `rooms/${roomCode}/state`;
  const scenePath = `rooms/${roomCode}/scene`;

  const rollD6 = () => Math.floor(Math.random() * 6) + 1;

  // 空を飛ぶ（博麗霊夢）: 振り直せる「表」ロールかどうか（アイテム/変調/ペナルティ/ハプニング/手がかりイベント表）
  const isRerollableTable = (label) => {
    if (!label) return false;
    return label.includes("アイテム獲得") || label.includes("アイテム交換") || label.includes("ボーナスアイテム")
      || label === "変調決定" || label === "ペナルティ表" || label === "ハプニング表" || label === "手がかりイベント表";
  };
  // 振り直しを使える（自分の操作PCが空を飛ぶ保持者・本日未使用）か
  const soraRerollHolder = () => {
    const myPc = (gs.pcs || []).find(p => p.uid === user.uid);
    if (!myPc) return null;
    const ab = getActiveAbility(myPc)?.name;
    if (ab !== "空を飛ぶ程度の能力" && ab !== "空を飛ぶ程度の能力＋") return null;
    if (myPc.soraFlewDay === gs.day) return null; // 本日使用済み
    return myPc;
  };

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
        // ダイス確定 → 結果反映と履歴追記を1回の upd でまとめる（二重書き込み防止）
        const entry = { label: label || "ダイス", results: res, max: Math.max(...res), t: Date.now() };
        upd(p => ({
          ...p,
          dice: { rolling: false, results: res, label },
          diceHistory: [entry, ...(p.diceHistory || [])].slice(0, 50),
        }));
        // 空を飛ぶ: 表ロール直後なら cb を保留し、振り直しプロンプトを出す
        const holder = isRerollableTable(label) ? soraRerollHolder() : null;
        if (holder) {
          pendingRerollCb.current = cb || null;
          setPendingReroll({ results: res, count, label, holderUid: holder.uid, rerolled: false });
        } else if (cb) {
          cb(res);
        }
      }
    }, 80);
  };

  // 空を飛ぶ: 振り直しを実行（保持者を本日使用済みにし、同数のダイスをアニメ付きで振り直す）
  const doSoraReroll = () => {
    const pr = pendingReroll;
    if (!pr || pr.rerolled) return;
    if (timerRef.current) clearInterval(timerRef.current);
    upd(p => ({
      ...p,
      pcs: p.pcs.map(x => x.uid === pr.holderUid ? { ...x, soraFlewDay: p.day } : x),
      dice: { rolling: true, results: [], label: pr.label },
      log: [`🕊 ${p.pcs.find(x => x.uid === pr.holderUid)?.charName} の《空を飛ぶ程度の能力》で「${pr.label}」を振り直した`, ...p.log],
    }));
    let f = 0;
    timerRef.current = setInterval(() => {
      f++;
      const mid = Array(pr.count).fill(0).map(rollD6);
      upd(p => ({ ...p, dice: { ...p.dice, results: mid } }));
      if (f >= 14) {
        clearInterval(timerRef.current);
        const res = Array(pr.count).fill(0).map(rollD6);
        const entry = { label: pr.label, results: res, max: Math.max(...res), t: Date.now() };
        upd(p => ({ ...p, dice: { rolling: false, results: res, label: pr.label }, diceHistory: [entry, ...(p.diceHistory || [])].slice(0, 50) }));
        setPendingReroll(prev => prev ? { ...prev, results: res, rerolled: true } : null);
      }
    }, 80);
  };

  // 空を飛ぶ: 現在の結果で確定（保留していた cb を呼ぶ）
  const confirmReroll = () => {
    const pr = pendingReroll;
    const cb = pendingRerollCb.current;
    setPendingReroll(null);
    pendingRerollCb.current = null;
    if (cb && pr) cb(pr.results);
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
    const personality = p.ps ?? (p.skillId ? {
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
      // currentSpot が空文字/未設定の既存データを救済（探索フェーズで "" だと移動・表示が壊れる）
      currentSpot: p.currentSpot || "11",
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
        // 拠点が封鎖されているシナリオでは spotRebind で代替スポットへリダイレクト（例: 紅魔館→霧の湖）。
        // baseSpotId 自体を付け替えることで、開始時だけでなく夜の拠点帰還にも反映される。
        const baseSpotId = resolveBaseSpot(r?.scenarioData, baseSpot?.id ?? "11");

        // startSpotId は空文字も無効として扱う（?? は "" を通してしまうため || を使う）
        let startSpotId = r?.scenarioData?.startSpotId || null;
        if (r?.scenarioData?.startSpotType === "base") startSpotId = baseSpotId;

        return applyAbilityPassiveStats({
          uid:    p.uid,
          name:   p.name,
          charId: p.charId,
          charName: p.charName,
          tags:   p.tags ?? charData?.tags ?? [],
          bonds: [], badStatus: [], flags: {},
          spriteRow:     p.spriteRow ?? -1,
          spriteCol:     p.spriteCol ?? -1,
          customPortrait: p.customPortrait ?? null,
          ps: p.ps ?? (p.skillId ? {
            id:   p.skillId,
            name: p.skillName ?? PERSONALITY_SKILLS[p.skillId]?.name ?? "",
            type: PERSONALITY_SKILLS[p.skillId]?.type ?? null,
            desc: PERSONALITY_SKILLS[p.skillId]?.desc ?? null,
          } : null),
          as:  p.as  ?? charData?.as  ?? null,
          ds:  p.ds  ?? charData?.ds  ?? null,
          // スペカは派生フィールド（effects/condition/textBody/structured等）を Firebase に
          // 永続化しないよう、生のテキストのまま保持する（表示時に buildSpellCard で再構築）。
          spellCards: charData?.spellCards ?? p.spellCards ?? [],
          growthSpellCard: charData?.growthSpellCard ?? p.growthSpellCard ?? null,
          growthAbility: p.growthAbility ?? charData?.growthAbility ?? null,
          growthSpellUnlocked: p.growthSpellUnlocked ?? false,
          growthAbilityUnlocked: p.growthAbilityUnlocked ?? false,
          specialBond: p.specialBond ?? null, // 成長で獲得した特別な絆 { target, targetUid, intimacy }
          grownInstanceId: p.grownInstanceId ?? null, // 成長キャラのインスタンスID（未成長は null）
          resources:   INIT_RESOURCES(),
          items:       INIT_ITEMS(),
          baseSpotId,
          currentSpot: startSpotId || "11",
          log: [],
        });
      });
  }

  const upd = useCallback((fn) => {
    let fired = false;
    setGs(prev => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      if (!fired) {
        fired = true;
        set(ref(db, gsPath), stripUndefined(next)).catch(console.error);
      }
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
    upd(p => ({
      ...p,
      battle: {
        active: true,
        type: "normal",
        phase: "setup",
        questId: quest.id,
        participants: { npcs: [buildBattleNpc(quest.enemy, "enemy_" + Date.now())].filter(Boolean) }
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
        // あらゆるものの背中に扉を作る程度の能力（隠岐奈）: 選ばれたキャラは霊力増加+1/+2
        if ((p.reiBoostTargets?.uids || []).includes(pc.uid)) gain += (p.reiBoostTargets.amount || 1);
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

  // リミット（"N日目の{サイクル}"）を1サイクル分早める
  const shortenLimit = (lim) => {
    if (!lim) return lim;
    const m = lim.match(/^(\d+)日目の(.+)$/);
    if (!m) return lim;
    let d = parseInt(m[1]); let ci = CYCLES.indexOf(m[2]);
    if (ci < 0) return lim;
    ci -= 1;
    if (ci < 0) { ci = CYCLES.length - 1; d -= 1; }
    if (d < 1) return lim;
    return `${d}日目の${CYCLES[ci]}`;
  };

  const doAdvanceCycle = () => {
    upd(p => {
      let day      = p.day || 1;
      let cycleIdx = p.cycleIdx || 0;
      const logMsgs = [];
      let nextPcs = p.pcs;

      // 永遠と須臾を操る程度の能力（蓬莱山輝夜）: 夜サイクルの終了で帰還/やる気減少を行わず夜をもう一度（base=リミット-1）
      if (cycleIdx === CYCLES.length - 1 && p.eternityNight) {
        const newLimit = p.eternityShorten ? shortenLimit(p.limit) : p.limit;
        return {
          ...p,
          eternityNight: null, eternityShorten: null,
          actedPcs: [], currentScene: null, reiryokuDone: false,
          ...(newLimit !== p.limit ? { limit: newLimit } : {}),
          log: [`🌙 永遠と須臾：帰還とやる気減少を行わず、夜サイクルをもう一度行う${newLimit !== p.limit ? `（リミット→${newLimit}）` : ""}`, ...p.log],
        };
      }

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
          // 比類なき脚力を持つ程度の能力＋（オート）/ 密と疎を操る程度の能力＋（returnYarukiSkip）: 夜のやる気減少を受けない
          const nightImmune = getActiveAbility(pc)?.name === "比類なき脚力を持つ程度の能力＋" || pc.returnYarukiSkip;
          let curMotive = nightImmune ? (pc.resources.やる気?.cur || 0) : Math.max(0, (pc.resources.やる気?.cur || 0) - 1);

          if (p.newspaper?.targetSpot && dest === p.newspaper.targetSpot && (p.newspaper.roll === 14 || p.newspaper.roll % 11 === 0)) {
            curMotive = Math.min(pc.resources.やる気?.max || 3, curMotive + 1);
            logMsgs.push(`${pc.charName} は新聞効果のスポットに帰還し、やる気を回復した`);
          }

          return {
            ...pc,
            currentSpot: dest,
            returnSpotId: null,
            returnYarukiSkip: null,
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

    // 手下シーンなら手下のスポットを起点に判定（移動するのは手下）
    const sMinion = sc.minionId ? (gs.minions || []).find(m => m.id === sc.minionId) : null;
    const startSpot = sMinion ? sMinion.currentSpot : actingPc.currentSpot;
    const dists     = getDistances(startSpot, sMinion ? [] : getAbilityMoveEdges(actingPc));
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
    const battleEnemies = scenarioEnemies.map((en, idx) =>
      buildBattleNpc({ ...en, name: en.name || `強敵${idx + 1}` }, `npc_final_${idx}`)
    );

    const initialBattle = {
      active: true,
      type: "mass",
      isFinal: true,
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
        minions: [], // 手下は探索フェイズ専用。決戦移行で退場
        unluckyPhase: null, // 自分も含めて不運（フェイズ限定）も解除
        log: [...logAdd, "⚔️ 決戦フェイズへ移行します。",...p.log],
      }
    });
    setPendingAction(null);
  };

  // ─── レンダリング ────────────────────────────────────────────

  if (!mode) return (
    <div style={{ background: "#040608", color: "#c8b89a", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Noto Serif JP', serif" }}>
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
    <div style={{ background: "#040608", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#3a4a5a", fontFamily: "'Noto Serif JP', serif", fontSize: 12 }}>Firebase に接続中…</div>
  );

  if (gs.sessionPhase === "intro") {
    return (
      <BackstoryScreen gs={gs} isGm={mode === "gm"} onProceed={() => upd(p => ({ ...p, sessionPhase: "intro_main", log: ["導入フェイズを開始した", ...p.log] }))} />
    );
  }

  if (gs.sessionPhase === "epilogue") {
    return (
      <EpilogueView gs={gs} upd={upd} isGm={mode === "gm"} sceneData={sceneData} setSceneData={setSceneDataAndSync} onProceed={() => upd(p => ({ ...p, sessionPhase: "end", log: ["✦ 終幕。セッションの幕が下りる。", ...p.log] }))} />
    );
  }

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", fontFamily: "'Noto Serif JP', serif" }}>
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
        @keyframes logSlideIn {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes modalIn {
          from { opacity: 0; transform: scale(0.86) translateY(10px); }
          to   { opacity: 1; transform: scale(1)    translateY(0); }
        }
        @keyframes backdropIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes resFlashUp {
          0%   { color: #66bb6a; transform: scale(1.35); }
          55%  { transform: scale(1); }
          100% { color: inherit; }
        }
        @keyframes resFlashDown {
          0%   { color: #ef5350; transform: scale(1.35); }
          55%  { transform: scale(1); }
          100% { color: inherit; }
        }
        @keyframes questSolveAnim {
          0%   { opacity: 0; transform: translate(-50%,-50%) scale(0.72); }
          18%  { opacity: 1; transform: translate(-50%,-50%) scale(1.05); }
          28%  { transform: translate(-50%,-50%) scale(1); }
          74%  { opacity: 1; transform: translate(-50%,-50%) scale(1); }
          100% { opacity: 0; transform: translate(-50%,-50%) scale(0.96); }
        }
        @keyframes clueBannerAnim {
          0%   { opacity: 0; transform: translateX(-50%) translateY(-10px); }
          18%  { opacity: 1; transform: translateX(-50%) translateY(0); }
          75%  { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes cycleOverlayAnim {
          0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.88); }
          12%  { opacity: 1; transform: translate(-50%, -50%) scale(1.03); }
          22%  { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          76%  { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(0.96); }
        }
        @keyframes badStatusIn {
          0%   { opacity: 0; transform: scale(0.55) rotate(-6deg); }
          55%  { transform: scale(1.14) rotate(3deg); }
          75%  { transform: scale(0.95) rotate(-1deg); }
          100% { opacity: 1; transform: scale(1) rotate(0deg); }
        }
        @keyframes battleFadeIn {
          0%   { opacity: 0; transform: scale(0.97) translateY(6px); }
          60%  { opacity: 1; transform: scale(1.005) translateY(-1px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes spotTipIn {
          from { opacity: 0; transform: translateY(-50%) translateX(-4px); }
          to   { opacity: 1; transform: translateY(-50%) translateX(0); }
        }
        @keyframes sceneStartAnim {
          0%   { opacity: 0; transform: translate(-50%,-50%) scale(0.6); }
          14%  { opacity: 1; transform: translate(-50%,-50%) scale(1.05); }
          24%  { transform: translate(-50%,-50%) scale(1); }
          72%  { opacity: 1; transform: translate(-50%,-50%) scale(1); }
          100% { opacity: 0; transform: translate(-50%,-50%) scale(0.96); }
        }
        @keyframes phaseFlashAnim {
          0%   { opacity: 0; transform: translate(-50%,-50%) scale(0.85) rotateX(35deg); }
          14%  { opacity: 1; transform: translate(-50%,-50%) scale(1.04) rotateX(0); }
          24%  { transform: translate(-50%,-50%) scale(1) rotateX(0); }
          72%  { opacity: 1; transform: translate(-50%,-50%) scale(1); }
          100% { opacity: 0; transform: translate(-50%,-50%) scale(0.97); }
        }
        @keyframes phaseStripe {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
        @keyframes connPulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.3; }
        }
        @keyframes panelAlertGlow {
          0%, 100% { box-shadow: 0 4px 16px rgba(0,0,0,0.55), 0 0 0 0 rgba(200,160,64,0.5); }
          50%      { box-shadow: 0 4px 16px rgba(0,0,0,0.55), 0 0 0 7px rgba(200,160,64,0); }
        }
      `}</style>

      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {gs.sessionPhase === "end" ? (
          <SessionEndView gs={gs} upd={upd} isGm={mode === "gm"} user={user} roomCode={roomCode} />
        ) : gs.sessionPhase === "battle_bonus" ? (
          <BonusPhaseView
            gs={gs} upd={upd} user={user} isGm={mode === "gm"}
            animateDice={animateDice}
            diceResult={gs.dice?.results} diceAnim={gs.dice?.rolling}
          />
        ) : gs.battle?.active ? (
          <div style={{ width: "100%", height: "100%", animation: "battleFadeIn 0.48s ease both" }}>
            <BattleView
              gs={gs} upd={upd} user={user} isGm={mode === "gm"} sceneData={sceneData}
              animateDice={animateDice}
              diceResult={gs.dice?.results} diceAnim={gs.dice?.rolling} diceLabel={gs.dice?.label}
            />
          </div>
        ) : (
          <MapView gs={gs} sceneData={sceneData} isGm={mode === "gm"} upd={upd} onSpotClick={handleSpotClick} user={user} />
        )}
      </div>

      {(() => {
        const panelEl = (
          <RightPanel
            gs={gs} upd={upd} sceneData={sceneData} setSceneData={setSceneDataAndSync}
            isGm={mode === "gm"} user={user} room={room} animateDice={animateDice}
            diceResult={gs.dice?.results} diceAnim={gs.dice?.rolling}
            CYCLES={CYCLES} CYCLE_COLORS={CYCLE_COLORS} NEWSPAPER={NEWSPAPER} getSpot={getSpot}
            doNewspaper={doNewspaper} doAdvanceCycle={doAdvanceCycle}
            doReiryoku={doReiryoku} doTransitionToExplore={doTransitionToExplore}
            pendingAction={pendingAction} setPendingAction={setPendingAction}
            SPOTS={SPOTS} presence={presence}
            width={isMobile ? "100%" : 300}
          />
        );
        if (!isMobile) return panelEl;
        // モバイル: 右パネルを右からのドロワーにする（フローティングボタンで開閉）
        const myTurn = gs.currentScene?.pcUid === user?.uid; // 自分のシーン中は手番アラート
        const alert = myTurn && !panelOpen;
        return (
          <>
            {panelOpen && <div onClick={() => setPanelOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 90, animation: "backdropIn 0.15s ease" }} />}
            <div style={{ position: "fixed", top: 0, right: 0, height: "100%", width: "min(90vw, 360px)", zIndex: 95, transform: panelOpen ? "translateX(0)" : "translateX(100%)", transition: "transform 0.28s cubic-bezier(0.4,0,0.2,1)", boxShadow: panelOpen ? "-8px 0 30px rgba(0,0,0,0.6)" : "none" }}>
              {panelEl}
            </div>
            <button onClick={() => setPanelOpen(o => !o)} aria-label="パネル開閉" style={{ position: "fixed", bottom: 16, right: 16, zIndex: 96, width: 54, height: 54, borderRadius: "50%", background: "rgba(20,24,40,0.96)", border: `1px solid ${alert ? "#c8a040" : "#3a4560"}`, color: alert ? "#e8d8b0" : "#c8b89a", fontSize: 21, cursor: "pointer", boxShadow: "0 4px 16px rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", animation: alert ? "panelAlertGlow 1.6s ease-in-out infinite" : "none" }}>
              {panelOpen ? "✕" : "☰"}
            </button>
          </>
        );
      })()}

      {/* 接続状態インジケータ（切断時のみ表示） */}
      {!connected && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 200, pointerEvents: "none", display: "flex", justifyContent: "center" }}>
          <div style={{ marginTop: 8, background: "rgba(20,8,8,0.97)", border: "1px solid #e07060", borderRadius: 20, padding: "6px 20px", fontSize: 11, color: "#ef9a9a", letterSpacing: 1, boxShadow: "0 0 24px rgba(224,112,96,0.4)", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#e07060", animation: "connPulse 1.1s ease-in-out infinite" }} />
            接続が切れました — 再接続を試みています…
          </div>
        </div>
      )}

      {/* 手がかり配置バナー */}
      {clueFlash && (
        <div style={{ position: "fixed", top: 14, left: "50%", zIndex: 155, pointerEvents: "none", animation: "clueBannerAnim 2.4s forwards" }}>
          <div style={{ background: "rgba(4,8,16,0.96)", border: "1px solid rgba(0,229,255,0.65)", borderRadius: 20, padding: "7px 22px", fontSize: 11, color: "#00e5ff", letterSpacing: 2, boxShadow: "0 0 24px rgba(0,229,255,0.3)", whiteSpace: "nowrap" }}>
            💡 手がかりが配置された
          </div>
        </div>
      )}

      {/* シーン開始タイトルカード */}
      {sceneStartFlash && (
        <div style={{ position: "fixed", top: "50%", left: "50%", zIndex: 158, pointerEvents: "none", animation: "sceneStartAnim 2.4s forwards" }}>
          <div style={{
            position: "relative",
            background: "linear-gradient(135deg, rgba(8,4,20,0.96), rgba(20,10,38,0.96))",
            border: "1px solid #6e4ea8",
            borderRadius: 2,
            padding: "26px 64px",
            textAlign: "center",
            boxShadow: "0 0 56px rgba(110,78,168,0.45), 0 0 120px rgba(110,78,168,0.2), inset 0 0 40px rgba(0,0,0,0.7)",
            minWidth: 320,
          }}>
            {[{ top: -6, left: 14 }, { top: -6, right: 14 }, { bottom: -6, left: 14 }, { bottom: -6, right: 14 }].map((pos, i) => (
              <div key={i} style={{ position: "absolute", width: 10, height: 10, background: "#c8a040", transform: "rotate(45deg)", ...pos }} />
            ))}
            <div style={{ fontSize: 9, color: "rgba(200,160,64,0.6)", letterSpacing: 6, marginBottom: 10 }}>◆ SCENE ◆</div>
            <div style={{ fontSize: 26, color: "#e8d8b8", fontWeight: "bold", letterSpacing: 4, textShadow: "0 0 22px rgba(200,160,64,0.7)" }}>🎬 {sceneStartFlash.charName}</div>
            <div style={{ height: 1, background: "linear-gradient(90deg, transparent, rgba(200,160,64,0.6), transparent)", margin: "12px 0 8px" }} />
            <div style={{ fontSize: 10, color: "rgba(200,184,154,0.65)", letterSpacing: 4 }}>のシーン</div>
          </div>
        </div>
      )}

      {/* フェーズ遷移カード */}
      {phaseFlash && (
        <div style={{ position: "fixed", top: "50%", left: "50%", zIndex: 159, pointerEvents: "none", animation: "phaseFlashAnim 2.6s forwards" }}>
          <div style={{
            position: "relative",
            background: "rgba(4,4,12,0.96)",
            border: `2px solid ${phaseFlash.color}`,
            borderRadius: 2,
            padding: "26px 72px",
            textAlign: "center",
            boxShadow: `0 0 56px ${phaseFlash.color}55, 0 0 120px ${phaseFlash.color}22, inset 0 0 40px rgba(0,0,0,0.7)`,
            overflow: "hidden",
            minWidth: 340,
          }}>
            <div style={{ position: "absolute", inset: 0, opacity: 0.18, pointerEvents: "none" }}>
              <div style={{ position: "absolute", top: 0, bottom: 0, width: "40%", background: `linear-gradient(90deg, transparent, ${phaseFlash.color}, transparent)`, animation: "phaseStripe 1.4s ease-out" }} />
            </div>
            {[{ top: -7, left: 16 }, { top: -7, right: 16 }, { bottom: -7, left: 16 }, { bottom: -7, right: 16 }].map((pos, i) => (
              <div key={i} style={{ position: "absolute", width: 12, height: 12, background: phaseFlash.color, transform: "rotate(45deg)", ...pos }} />
            ))}
            <div style={{ fontSize: 36, marginBottom: 6, lineHeight: 1 }}>{phaseFlash.icon}</div>
            <div style={{ fontSize: 26, fontWeight: "bold", color: phaseFlash.color, letterSpacing: 6, textShadow: `0 0 22px ${phaseFlash.color}aa` }}>{phaseFlash.title}</div>
            <div style={{ height: 1, background: `linear-gradient(90deg, transparent, ${phaseFlash.color}88, transparent)`, margin: "10px 0 6px" }} />
            <div style={{ fontSize: 9, color: "rgba(200,184,154,0.55)", letterSpacing: 6 }}>{phaseFlash.subtitle}</div>
          </div>
        </div>
      )}

      {/* 空を飛ぶ: 表ロール後の振り直しプロンプト（操作中の保持者にのみ表示） */}
      {pendingReroll && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 170, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }}>
          <div style={{ background: "#0c1020", border: "2px solid #7fb0e0", borderRadius: 8, padding: "20px 24px", maxWidth: 360, width: "90%", textAlign: "center", boxShadow: "0 0 40px rgba(127,176,224,0.35)", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: "#7fb0e0", marginBottom: 6 }}>🕊 空を飛ぶ程度の能力</div>
            <div style={{ fontSize: 12, color: "#cfe2f5", marginBottom: 10 }}>「{pendingReroll.label}」の結果</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 14 }}>
              {pendingReroll.results.map((d, i) => (
                <div key={i} style={{ width: 44, height: 44, border: "2px solid #1e3a5a", borderRadius: 6, background: "rgba(14,20,36,0.95)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: "#60c0f0", fontWeight: "bold" }}>{d}</div>
              ))}
            </div>
            {!pendingReroll.rerolled ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button onClick={doSoraReroll} style={{ padding: "9px", cursor: "pointer", borderRadius: 4, background: "rgba(127,176,224,0.18)", border: "1px solid #7fb0e0", color: "#cfe2f5", fontSize: 12, fontFamily: "'Noto Serif JP', serif" }}>🕊 振り直す（1日1回・全ダイス）</button>
                <button onClick={confirmReroll} style={{ padding: "9px", cursor: "pointer", borderRadius: 4, background: "rgba(255,255,255,0.04)", border: "1px solid #2a3a50", color: "#9fb0c0", fontSize: 12, fontFamily: "'Noto Serif JP', serif" }}>この結果で確定する</button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 9, color: "#7fb0e0", marginBottom: 2 }}>振り直し済み</div>
                <button onClick={confirmReroll} style={{ padding: "9px", cursor: "pointer", borderRadius: 4, background: "rgba(127,176,224,0.18)", border: "1px solid #7fb0e0", color: "#cfe2f5", fontSize: 12, fontFamily: "'Noto Serif JP', serif" }}>この結果で確定する</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* クエスト解決オーバーレイ */}
      {questSolveFlash && (
        <div style={{ position: "fixed", top: "50%", left: "50%", zIndex: 160, pointerEvents: "none", animation: "questSolveAnim 3.6s forwards" }}>
          <div style={{ position: "relative", background: "rgba(4,4,12,0.96)", border: "2px solid #c8a040", borderRadius: 2, padding: "22px 52px", textAlign: "center", boxShadow: "0 0 48px rgba(200,160,64,0.4), inset 0 0 32px rgba(0,0,0,0.7)" }}>
            {[{ top: -6, left: 12 }, { top: -6, right: 12 }, { bottom: -6, left: 12 }, { bottom: -6, right: 12 }].map((pos, i) => (
              <div key={i} style={{ position: "absolute", width: 10, height: 10, background: "#c8a040", transform: "rotate(45deg)", ...pos }} />
            ))}
            <div style={{ fontSize: 9, color: "rgba(200,160,64,0.55)", letterSpacing: 4, marginBottom: 10 }}>◆ クエスト解決 ◆</div>
            <div style={{ fontSize: 20, color: "#c8a040", fontWeight: "bold", letterSpacing: 2, marginBottom: 6 }}>✅ {questSolveFlash.name}</div>
            <div style={{ fontSize: 10, color: "rgba(200,184,154,0.55)", letterSpacing: 2 }}>が解決されました</div>
          </div>
        </div>
      )}

      {/* サイクル進行オーバーレイ */}
      {cycleOverlay && (() => {
        const ci    = cycleOverlay.cycleIdx;
        const color = CYCLE_COLORS[ci];
        return (
          <div style={{ position: "fixed", top: "50%", left: "50%", zIndex: 150, pointerEvents: "none", animation: "cycleOverlayAnim 3.2s forwards" }}>
            <div style={{ background: "rgba(4,4,12,0.94)", border: `2px solid ${color}`, borderRadius: 2, padding: "28px 56px", textAlign: "center", boxShadow: `0 0 56px ${color}44, 0 0 120px ${color}18, inset 0 0 40px rgba(0,0,0,0.7)` }}>
              {[{ top: -7, left: 14 }, { top: -7, right: 14 }, { bottom: -7, left: 14 }, { bottom: -7, right: 14 }].map((pos, i) => (
                <div key={i} style={{ position: "absolute", width: 12, height: 12, background: color, transform: "rotate(45deg)", ...pos }} />
              ))}
              <div style={{ fontSize: 42, marginBottom: 10, lineHeight: 1 }}>{CYCLE_ICONS[ci]}</div>
              <div style={{ fontSize: 28, fontWeight: "bold", color, letterSpacing: 6, textShadow: `0 0 20px ${color}99` }}>{CYCLES[ci]}</div>
              <div style={{ height: 1, background: `linear-gradient(90deg, transparent, ${color}88, transparent)`, margin: "12px 0" }} />
              <div style={{ fontSize: 12, color: "rgba(200,184,154,0.7)", letterSpacing: 4 }}>{cycleOverlay.day} 日目</div>
            </div>
          </div>
        );
      })()}

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
  <div style={{ background: "#040608", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color, fontFamily: "'Noto Serif JP', serif", fontSize: 12 }}>{message}</div>
);

export default function App() {
  const [user, setUser]           = useState(undefined);
  const [roomCode, setRoomCode]   = useState(null);
  const [roomPhase, setRoomPhase] = useState(null);

  useEffect(() => {
    motion.init();  // 演出抑制の <html> 属性反映 + OS設定変化の監視

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
      if (!snap.exists()) {
        // ルームが存在しない（セッション終了で削除 or 不正URL）→ ロビーへ戻る
        try {
          const url = new URL(window.location.href);
          url.searchParams.delete("room");
          window.history.replaceState({}, "", url);
        } catch { /* noop */ }
        setRoomCode(null);
        setRoomPhase(null);
        return;
      }
      setRoomPhase(snap.val().phase || "prep");
    });
    return () => unsub();
  }, [roomCode]);

  if (user === undefined)   return <LoadingScreen message="接続中…" />;
  if (!user || !roomCode)   return <LobbyRoot />;
  if (roomPhase === null)   return <LoadingScreen message="部屋情報を取得中…" />;
  if (roomPhase === "error") return <LoadingScreen message="ルームが見つかりません。セッション終了済みか、URLをご確認ください。" color="#e07060" />;
  if (roomPhase === "prep") return <LobbyRoot />;

  return <SessionApp roomCode={roomCode} user={user} />;
}