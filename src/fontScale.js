// フォントサイズ（読みやすさ）設定。インラインの px フォントが多数（283箇所）あるため、
// 個別に直すのではなく body の CSS `zoom` で UI 全体を拡大する（reflow するので横スクロールに
// なりにくい）。3段階: 1.0(標準) / 1.15(大) / 1.3(特大)。localStorage["fontScale"] に永続。
// 既定(1.0)では zoom 未指定＝従来と完全に同じ表示（オプトイン）。

const LEVELS = [1, 1.15, 1.3];
const LABELS = ["標準", "大", "特大"];
const KEY = "fontScale";

function read() {
  const v = parseFloat(localStorage.getItem(KEY));
  return LEVELS.includes(v) ? v : 1;
}

// GM 向けパネル（GM操作・独自・盤面編集・PC の GM 編集）は 8〜9px の文字と小さなボタンが密集しているので、
// スマホ（タッチ操作 or 狭い画面）では data-touch-zoom を付けた要素だけを拡大し、ボタン等の高さも確保する。
// 文字サイズ設定（body の zoom）を上げている場合は二重に大きくならないよう倍率を下げる。
const TOUCH_STYLE_ID = "touch-ui-style";
const TOUCH_CSS = `
@media (pointer: coarse), (max-width: 820px) {
  [data-touch-zoom] { zoom: 1.2; }
  html[data-font-scale="1"] [data-touch-zoom] { zoom: 1.08; }
  html[data-font-scale="2"] [data-touch-zoom] { zoom: 1; }
  [data-touch-zoom] [data-touch-zoom] { zoom: 1; }
}
@media (pointer: coarse) {
  [data-touch-zoom] button, [data-touch-zoom] select,
  [data-touch-zoom] input:not([type="checkbox"]):not([type="radio"]):not([type="file"]) { min-height: 26px; }
}`;
function ensureTouchStyle() {
  if (document.getElementById(TOUCH_STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = TOUCH_STYLE_ID;
  el.textContent = TOUCH_CSS;
  document.head.appendChild(el);
}

export const fontScale = {
  _scale: read(),
  get scale() { return this._scale; },
  get level() { return Math.max(0, LEVELS.indexOf(this._scale)); }, // 0/1/2
  get label() { return LABELS[this.level]; },
  apply() {
    if (typeof document !== "undefined" && document.body) {
      // 既定は空文字＝zoom 解除（従来表示）。それ以外は数値を設定。
      document.body.style.zoom = this._scale === 1 ? "" : String(this._scale);
      document.documentElement.dataset.fontScale = String(this.level);
      ensureTouchStyle();
    }
  },
  init() { this.apply(); },
  // 標準→大→特大→標準 と循環。新しい level を返す。
  cycle() {
    this._scale = LEVELS[(this.level + 1) % LEVELS.length];
    try { localStorage.setItem(KEY, String(this._scale)); } catch { /* noop */ }
    this.apply();
    return this.level;
  },
};
