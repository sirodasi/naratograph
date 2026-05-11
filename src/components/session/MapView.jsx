import { useState, useRef } from "react";
import { SPOTS, EDGES, AREA_COLORS, CYCLES, CYCLE_COLORS } from "../../data/gameData";
import { CharSprite } from "../common/CharSprite";
import { useMapBounds } from "../../hooks/useMapBounds";
import mapImg from "../../assets/map.png";

// ─── ユーティリティ ─────────────────────────────────────────────

function areaColor(area) {
  return AREA_COLORS[area] ?? { bg: "rgba(30,30,30,0.85)", border: "#555" };
}

// BFS で最短距離を計算
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

const MAP_NATURAL_W = 1200;

export default function MapView({ gs, sceneData, isGm, onSpotClick, user }) {
  const [hov, setHov] = useState(null);
  const mapRef = useRef(null);
  const mapBounds = useMapBounds(mapRef);

  const cycleIdx = gs.cycleIdx || 0;
  const isNight = cycleIdx === 3;
  const isEvening = cycleIdx === 2;

  const scale = mapBounds.width > 0 ? mapBounds.width / MAP_NATURAL_W : 0.5;
  const baseSize = Math.round(22 * Math.max(0.5, Math.min(scale * 1.8, 1.4)));
  const fontSize = Math.max(8, Math.round(10 * scale * 1.4));

  // 移動フェイズの判定
  const isMovePhase = gs.currentScene?.phase === "move_dest";
  const actingPc = isMovePhase ? (gs.pcs || []).find(p => p.uid === gs.currentScene.pcUid) : null;
  const isMyTurn = actingPc?.uid === user?.uid;
  const dists = actingPc ? getDistances(actingPc.currentSpot) : {};
  const maxDist = gs.currentScene?.selectedMoveDie || 0;
  const exactDist = gs.currentScene?.exactMoveDist ?? null;

  // シーンモード（全画面描写）
  if (gs.sceneMode) {
    return (
      <div style={{ position: "relative", width: "100%", height: "100%", background: "#040608", overflow: "hidden" }}>
        {sceneData.bg && (
          <img src={sceneData.bg} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.8 }} />
        )}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, transparent, rgba(0,0,0,0.8))" }} />
        <div style={{ position: "absolute", bottom: 120, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 20, alignItems: "flex-end" }}>
          {(sceneData.portraits || []).map((p, i) => (
            <img key={i} src={p.img} style={{ height: 350, objectFit: "contain", filter: "drop-shadow(0 0 20px black)" }} alt={p.name} />
          ))}
        </div>
        {gs.sceneText && (
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(10,12,20,0.95)", borderTop: "1px solid #1e2535", padding: "20px 40px", minHeight: 100 }}>
            <div style={{ fontSize: 14, color: "#c8b89a", lineHeight: 1.8, whiteSpace: "pre-wrap", fontFamily: "serif" }}>{gs.sceneText}</div>
          </div>
        )}
      </div>
    );
  }

  // 通常マップモード
  const mapFilter = isNight ? "brightness(0.45) saturate(0.6)" : isEvening ? "brightness(0.8) sepia(0.3) saturate(1.2)" : "none";

  return (
    <div ref={mapRef} style={{ position: "relative", width: "100%", height: "100%", background: "#060810", overflow: "hidden" }}>
      <style>{`
        @keyframes pulseReachable {
          0% { box-shadow: 0 0 0px #64b5f6; transform: translate(-50%,-50%) scale(1); }
          50% { box-shadow: 0 0 15px #64b5f6; transform: translate(-50%,-50%) scale(1.2); }
          100% { box-shadow: 0 0 0px #64b5f6; transform: translate(-50%,-50%) scale(1); }
        }
      `}</style>

      <img 
        src={mapImg} 
        style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: "top left", filter: mapFilter, transition: "filter 2s" }} 
      />

      {mapBounds.width > 0 && SPOTS.map(spot => {
        const isDream = spot.id === "dream";
        const distance = dists[spot.id] ?? 999;
        const hasClue = gs.clues?.includes(spot.id);
        const pcsHere = (gs.pcs || []).filter(p => p.currentSpot === spot.id);
        
        let isReachable = false;
        if (isMovePhase) {
          isReachable = exactDist ? distance === exactDist : (distance > 0 && distance <= maxDist);
        }

        const sx = mapBounds.left + (spot.x / 100) * mapBounds.width;
        const sy = mapBounds.top + (spot.y / 100) * mapBounds.height;
        const borderCol = isReachable ? "#64b5f6" : (hasClue ? "#00e5ff" : areaColor(spot.area).border);

        return (
          <div
            key={spot.id}
            onMouseEnter={() => setHov(spot.id)}
            onMouseLeave={() => setHov(null)}
            onClick={() => (isGm || (isMyTurn && isReachable)) && onSpotClick(spot.id)}
            style={{
              position: "absolute", left: sx, top: sy,
              width: baseSize, height: baseSize,
              background: areaColor(spot.area).bg,
              border: `2px solid ${borderCol}`,
              borderRadius: "50%", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: fontSize, color: "white", fontWeight: "bold",
              zIndex: isReachable ? 10 : 5,
              animation: isReachable ? "pulseReachable 1.5s infinite" : "none",
              transform: "translate(-50%, -50%)"
            }}
          >
            {isDream ? "◇" : spot.roll}

            {/* 手がかりアイコン */}
            {hasClue && (
              <div style={{ position: "absolute", top: -10, right: -10, fontSize: 14 }}>💡</div>
            )}

            {/* PCマーカー */}
            {pcsHere.length > 0 && (
              <div style={{ position: "absolute", bottom: "100%", display: "flex", gap: 2, marginBottom: 4 }}>
                {pcsHere.map(p => (
                  <div key={p.uid} style={{ border: `1.5px solid ${gs.currentScene?.pcUid === p.uid ? "#64b5f6" : "#c8a040"}`, borderRadius: "50%", overflow: "hidden", background: "black" }}>
                    <CharSprite spriteRow={p.spriteRow} spriteCol={p.spriteCol} size={24} customPortrait={p.customPortrait} />
                  </div>
                ))}
              </div>
            )}

            {/* ツールチップ */}
            {hov === spot.id && (
              <div style={{ position: "absolute", top: "110%", left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.9)", color: "white", padding: "4px 8px", borderRadius: 4, fontSize: 10, whiteSpace: "nowrap", zIndex: 20, pointerEvents: "none", border: "1px solid #333" }}>
                {spot.name}
              </div>
            )}
          </div>
        );
      })}

      {/* サイクルバッジ */}
      <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", padding: "4px 12px", background: "rgba(0,0,0,0.7)", borderRadius: 20, border: `1px solid ${CYCLE_COLORS[cycleIdx]}`, color: CYCLE_COLORS[cycleIdx], fontSize: 11 }}>
        {gs.sessionPhase === "intro" ? "✦ 導入フェイズ" : `${gs.day}日目・${CYCLES[cycleIdx]}`}
      </div>
    </div>
  );
}