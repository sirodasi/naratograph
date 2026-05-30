// ─── 幻想ナラトグラフ モーション制御モジュール ─────────────────────────────
// 演出（アニメーション/シネマティック/パーティクル）の抑制を一元管理する。
//
// 3状態モデル（localStorage["reduceMotion"]）:
//   未設定(null) → OS の prefers-reduced-motion に従う
//   "1"          → ユーザーが明示的に「抑制」（OS設定より優先）
//   "0"          → ユーザーが明示的に「演出する」（OS が reduce でも演出する）
//
// これにより、OS でアニメ無効のユーザーでもアプリ内トグルで演出を有効化できる。
// 実効値は <html data-reduce-motion="1"> 属性へ反映し、グローバル CSS が拾う。

const MQ = "(prefers-reduced-motion: reduce)";

// _override: true=抑制 / false=演出 / null=OS追従
let _override = (() => {
  try {
    const v = localStorage.getItem("reduceMotion");
    return v === "1" ? true : v === "0" ? false : null;
  } catch { return null; }
})();

function osReduced() {
  try { return window.matchMedia(MQ).matches; } catch { return false; }
}

// 実効的に抑制すべきか（ユーザー明示設定があればそれを優先、なければ OS 設定）
function effectiveReduced() {
  return _override === null ? osReduced() : _override;
}

// 抑制用グローバル CSS を <head> に一度だけ注入（どの画面でも効くように）
function injectStyle() {
  try {
    if (document.getElementById("reduce-motion-style")) return;
    const el = document.createElement("style");
    el.id = "reduce-motion-style";
    el.textContent = `
      html[data-reduce-motion="1"] *,
      html[data-reduce-motion="1"] *::before,
      html[data-reduce-motion="1"] *::after {
        animation-duration: 1ms !important;
        animation-delay: 0ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 1ms !important;
        transition-delay: 0ms !important;
        scroll-behavior: auto !important;
      }
    `;
    document.head.appendChild(el);
  } catch {}
}

// 実効値を <html> 属性へ反映
function apply() {
  const reduced = effectiveReduced();
  try { document.documentElement.setAttribute("data-reduce-motion", reduced ? "1" : "0"); } catch {}
  return reduced;
}

export const motion = {
  // 演出を抑制すべきか（実効値）
  get reduced() { return effectiveReduced(); },
  // ユーザーが明示的に設定済みか（未設定なら OS 追従中）
  get hasOverride() { return _override !== null; },
  // OS 側が reduce を要求しているか（参考情報）
  get osReduced() { return osReduced(); },

  // アプリ内トグル: 現在の実効値を反転して明示設定として保存（OS 設定を上書き可能）
  toggle() {
    const next = !effectiveReduced();
    _override = next;
    try { localStorage.setItem("reduceMotion", next ? "1" : "0"); } catch {}
    return apply();
  },

  // 起動時に1度呼ぶ。CSS注入 + 属性反映 + OS 設定変化の監視を登録。
  init() {
    injectStyle();
    apply();
    try {
      const mq = window.matchMedia(MQ);
      // ユーザー明示設定が無いときだけ OS 設定変化に追従する
      const handler = () => { if (_override === null) apply(); };
      if (mq.addEventListener) mq.addEventListener("change", handler);
      else if (mq.addListener) mq.addListener(handler);  // 旧 Safari
    } catch {}
  },
};
