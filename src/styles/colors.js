export const C = {
  bg:          "#07050e",
  card:        "rgba(255,255,255,0.04)",
  border:      "#1e1430",

  gold:        "#d4a838",
  goldDim:     "#9a7828",
  goldBg:      "rgba(212,168,56,0.12)",

  red:         "#d05040",
  redBg:       "rgba(155,32,32,0.20)",
  redBorder:   "#7a1818",

  blue:        "#7090e0",
  blueBg:      "rgba(45,50,170,0.16)",
  blueBorder:  "#28288a",

  green:       "#4caf50",
  greenBg:     "rgba(27,94,32,0.15)",
  greenBorder: "#1b5e20",

  purple:      "#c090e0",

  sakura:      "#e8a0b8",

  text:        "#c8b89a",
  textDim:     "#9288b0",
  textFaint:   "#584868",
};

export const btn = (bg, border, color, extra = {}) => ({
  cursor:      "pointer",
  borderRadius: 4,
  fontSize:    12,
  letterSpacing: 1,
  padding:     "8px 16px",
  transition:  "opacity 0.15s",
  background:  bg,
  border:      `1px solid ${border}`,
  color,
  ...extra,
});

export const iStyle = {
  padding:    "5px 8px",
  fontSize:   12,
  background: "rgba(255,255,255,0.04)",
  border:     `1px solid ${C.border}`,
  color:      C.text,
  borderRadius: 3,
  width:      "100%",
  boxSizing:  "border-box",
};

export const btnFull = (bg, border, color, extra = {}) => ({
  width: "100%", padding: "8px", borderRadius: 4, cursor: "pointer",
  background: bg, border: `1px solid ${border}`, color, fontSize: 12, ...extra,
});

export const btnSmall = {
  width: 24, height: 24, background: "rgba(255,255,255,0.05)",
  border: `1px solid ${C.border}`, color: C.textFaint, borderRadius: 4, cursor: "pointer",
};
