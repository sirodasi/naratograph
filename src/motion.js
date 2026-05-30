// ─── 幻想ナラトグラフ モーション制御モジュール ─────────────────────────────
// 演出（アニメーション/シネマティック/パーティクル）の抑制を一元管理する。
// 抑制すべきか = OS の prefers-reduced-motion が有効 OR ユーザーがアプリ内でOFFにした
// 判定結果は <html data-reduce-motion="1"> 属性として反映し、グローバル CSS が拾う。

const MQ = "(prefers-reduced-motion: reduce)";

let _userPref = (() => {
  try { return localStorage.getItem("reduceMotion") === "1"; } catch { return false; }
})();

function osReduced() {
  try { return window.matchMedia(MQ).matches; } catch { return false; }
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

// 合成判定を <html> 属性へ反映
function apply() {
  const reduced = _userPref || osReduced();
  try { document.documentElement.setAttribute("data-reduce-motion", reduced ? "1" : "0"); } catch {}
  return reduced;
}

export const motion = {
  // 演出を抑制すべきか（OS or ユーザー設定）
  get reduced() { return _userPref || osReduced(); },
  // ユーザーがアプリ内トグルでOFFにしているか
  get userPref() { return _userPref; },
  // OS 設定で強制的に抑制されているか（この場合トグルは無効表示にする）
  get osForced() { return osReduced(); },

  // アプリ内トグル（OS強制中は OS 設定が優先されるが、ユーザー設定値自体は保存する）
  toggle() {
    _userPref = !_userPref;
    try { localStorage.setItem("reduceMotion", _userPref ? "1" : ""); } catch {}
    return apply();
  },

  // 起動時に1度呼ぶ。CSS注入 + 属性反映 + OS 設定変化の監視を登録。
  init() {
    injectStyle();
    apply();
    try {
      const mq = window.matchMedia(MQ);
      const handler = () => apply();
      if (mq.addEventListener) mq.addEventListener("change", handler);
      else if (mq.addListener) mq.addListener(handler);  // 旧 Safari
    } catch {}
  },
};
