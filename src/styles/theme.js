// src/styles/theme.js
export const COLORS = {
  gold: "#c8a040",
  goldDim: "#8b6914",
  goldBg: "rgba(200,160,64,0.12)",
  red: "#e07060",
  redBg: "rgba(192,57,43,0.18)",
  redBorder: "#8b1a1a",
  blue: "#64b5f6",
  blueBg: "rgba(25,118,210,0.15)",
  blueBorder: "#0d47a1",
  green: "#4caf50",
  greenBg: "rgba(27,94,32,0.15)",
  greenBorder: "#1b5e20",
  purple: "#ce93d8",
  bg: "#06080f",
  border: "#1a2535",
  card: "rgba(255,255,255,0.025)",
  text: "#c8b89a",
  textDim: "#8a9aaa",
  textFaint: "#5a6575",
};

export const COMMON_STYLES = {
  btn: (bg, border, color, extra = {}) => ({
    cursor: "pointer",
    borderRadius: "4px",
    fontSize: "12px",
    letterSpacing: "1px",
    padding: "8px 16px",
    transition: "opacity 0.15s",
    background: bg,
    border: `1px solid ${border}`,
    color,
    ...extra,
  }),
  input: {
    padding: "5px 8px",
    fontSize: "12px",
    background: "rgba(255,255,255,0.04)",
    border: `1px solid ${COLORS.border}`,
    color: COLORS.text,
    borderRadius: "3px",
    width: "100%",
    boxSizing: "border-box",
  }
};