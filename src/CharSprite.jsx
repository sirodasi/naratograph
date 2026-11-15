// キャラクターのスプライト表示（ロビー・セッション共通）。
// Lobby.jsx から分離: セッション画面がロビー全体（＋シナリオエディタ）を読み込まずに済むように。
import spriteImg from "./assets/sprite.webp";
import { C } from "./styles/colors";

export const SPRITE_SRC  = spriteImg;
export const CELL        = 120;
export const SPRITE_COLS = 10;

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

