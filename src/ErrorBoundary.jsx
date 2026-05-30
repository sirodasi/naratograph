import { Component } from "react";
import { C } from "./styles/colors";

// React の Error Boundary は仕様上クラスコンポーネントでしか実装できないため、
// 本プロジェクトの「関数コンポーネントのみ」規約の唯一の例外として class を用いる。
// 子ツリーで投げられた描画時例外を捕捉し、全画面クラッシュを防いでフォールバックUIを出す。
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // 開発時の調査用にコンソールへ。外部送信はしない。
    console.error("ErrorBoundary captured:", error, info?.componentStack);
  }

  handleReload = () => {
    try { window.location.reload(); } catch { /* noop */ }
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "#0a0810",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'Noto Serif JP', serif", padding: 20, boxSizing: "border-box",
      }}>
        <div style={{
          maxWidth: 440, width: "100%", textAlign: "center",
          background: "#14101e", border: `1px solid ${C.redBorder}`, borderRadius: 6,
          padding: "32px 28px", boxShadow: `0 0 48px ${C.red}22`,
        }}>
          <div style={{ fontSize: 13, color: C.red, letterSpacing: 4, marginBottom: 14 }}>◆ 予期しないエラー ◆</div>
          <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.9, marginBottom: 20 }}>
            画面の描画中に問題が発生しました。<br />
            セッションの状態は Firebase に保存されているため、<br />
            再読み込みすれば続きから再開できます。
          </div>
          {this.state.error?.message && (
            <div style={{ fontSize: 9, color: C.textFaint, background: "rgba(0,0,0,0.4)", border: `1px solid ${C.border}`, borderRadius: 4, padding: "8px 10px", marginBottom: 20, wordBreak: "break-word", textAlign: "left", maxHeight: 120, overflowY: "auto" }}>
              {String(this.state.error.message)}
            </div>
          )}
          <button onClick={this.handleReload} style={{
            padding: "10px 28px", cursor: "pointer", borderRadius: 4,
            background: C.redBg, border: `1px solid ${C.redBorder}`, color: C.red,
            fontSize: 13, letterSpacing: 2, fontFamily: "'Noto Serif JP', serif",
          }}>
            🔄 再読み込み
          </button>
        </div>
      </div>
    );
  }
}
