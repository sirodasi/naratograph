export const C = {
  bg:          "#06080f",
  card:        "rgba(255,255,255,0.03)",
  border:      "#1a2535",
 
  gold:        "#c8a040",
  goldDim:     "#8b6914",
  goldBg:      "rgba(200,160,64,0.12)",
 
  red:         "#e07060",
  redBg:       "rgba(192,57,43,0.18)",
  redBorder:   "#8b1a1a",
 
  blue:        "#64b5f6",
  blueBg:      "rgba(25,118,210,0.15)",
  blueBorder:  "#0d47a1",
 
  green:       "#4caf50",
  greenBg:     "rgba(27,94,32,0.15)",
  greenBorder: "#1b5e20",
 
  purple:      "#ce93d8",
 
  text:        "#c8b89a",
  textDim:     "#8a9aaa",
  textFaint:   "#5a6575",
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
  border:     `1px solid #1a2535`,
  color:      "#c8b89a",
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
