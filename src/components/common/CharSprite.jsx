import React from "react";
import spriteImg from "../../assets/sprite.png";
import { COLORS } from "../../styles/theme";

const CELL = 120;
const SPRITE_COLS = 10;

/**
 * @param {number} spriteRow - スプライトシートの行
 * @param {number} spriteCol - スプライトシートの列
 * @param {number} size - 表示サイズ(px)
 * @param {string} customPortrait - カスタム画像のURL (あれば優先表示)
 * @param {object} style - 追加のスタイル
 */
export const CharSprite = ({ spriteRow = -1, spriteCol = -1, size = 80, customPortrait = null, style = {} }) => {
  if (customPortrait) {
    return (
      <img
        src={customPortrait}
        alt="Portrait"
        style={{
          width: size,
          height: size,
          objectFit: "cover",
          borderRadius: 4,
          background: "rgba(255,255,255,0.04)",
          border: `1px solid ${COLORS.border}`,
          flexShrink: 0,
          ...style
        }}
      />
    );
  }

  if (spriteRow < 0 || spriteCol < 0) {
    return (
      <div style={{
        width: size,
        height: size,
        borderRadius: 4,
        background: "rgba(255,255,255,0.04)",
        border: `1px solid ${COLORS.border}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.4,
        flexShrink: 0,
        ...style
      }}>
        🌸
      </div>
    );
  }

  const scale = size / CELL;

  return (
    <div style={{
      width: size,
      height: size,
      overflow: "hidden",
      flexShrink: 0,
      borderRadius: 4,
      ...style
    }}>
      <div style={{
        width: CELL * SPRITE_COLS * scale,
        height: CELL * 6 * scale,
        backgroundImage: `url(${spriteImg})`,
        backgroundSize: `${CELL * SPRITE_COLS * scale}px ${CELL * 6 * scale}px`,
        backgroundPosition: `${-spriteCol * CELL * scale}px ${-spriteRow * CELL * scale}px`,
        backgroundRepeat: "no-repeat",
      }} />
    </div>
  );
};

export default CharSprite;