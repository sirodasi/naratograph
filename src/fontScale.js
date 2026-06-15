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

export const fontScale = {
  _scale: read(),
  get scale() { return this._scale; },
  get level() { return Math.max(0, LEVELS.indexOf(this._scale)); }, // 0/1/2
  get label() { return LABELS[this.level]; },
  apply() {
    if (typeof document !== "undefined" && document.body) {
      // 既定は空文字＝zoom 解除（従来表示）。それ以外は数値を設定。
      document.body.style.zoom = this._scale === 1 ? "" : String(this._scale);
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
