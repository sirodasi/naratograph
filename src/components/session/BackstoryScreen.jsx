import { useState, useEffect } from "react";
import { COLORS } from "../../styles/theme";

/**
 * セッション導入のバックストーリーを表示する画面
 * @param {object} gs - ゲーム状態
 * @param {boolean} isGm - GM判定
 * @param {function} onProceed - 次へ進む（探索フェイズ移行）処理
 */
export function BackstoryScreen({ gs, isGm, onProceed }) {
  const [visible, setVisible] = useState(false);

  // マウント時にふわっと表示させるためのフラグ
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const scenarioName = gs.scenarioData?.name || "無題のシナリオ";
  const backstoryText = gs.scenarioData?.backstory || "（バックストーリーが設定されていません）";

  return (
    <div 
      style={{ 
        background: "#04060a", // 導入画面専用の深い黒
        height: "100vh", 
        display: "flex", 
        flexDirection: "column", 
        alignItems: "center", 
        justifyContent: "center", 
        fontFamily: "serif", 
        cursor: isGm ? "pointer" : "default", 
        padding: "40px 60px", 
        boxSizing: "border-box",
        transition: "opacity 1.5s ease-in-out",
        opacity: visible ? 1 : 0
      }} 
      onClick={isGm ? onProceed : undefined}
    >
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pulseText { 
          0%, 100% { opacity: 0.4; } 
          50% { opacity: 1; } 
        }
        .backstory-content {
          max-width: 760px;
          animation: fadeIn 2s ease-out;
        }
      `}</style>

      <div className="backstory-content">
        {/* シナリオタイトル */}
        <div style={{ 
          fontSize: 11, 
          color: "#4a6080", 
          letterSpacing: "4px", 
          textAlign: "center", 
          marginBottom: 24,
          textTransform: "uppercase"
        }}>
          {scenarioName}
        </div>

        {/* 本文 */}
        <div style={{ 
          fontSize: "16px", 
          color: "#b8c8d8", 
          lineHeight: 2.2, 
          whiteSpace: "pre-wrap", 
          textAlign: "justify",
          textShadow: "0 0 10px rgba(184, 200, 216, 0.2)"
        }}>
          {backstoryText}
        </div>

        {/* フッター（操作ガイド） */}
        <div style={{ textAlign: "center", marginTop: 60 }}>
          {isGm ? (
            <div style={{ 
              fontSize: 11, 
              color: COLORS.gold, 
              letterSpacing: "3px", 
              animation: "pulseText 3s ease-in-out infinite" 
            }}>
              ▼ クリックして探索フェイズを開始する
            </div>
          ) : (
            <div style={{ 
              fontSize: 10, 
              color: "#2a3545", 
              letterSpacing: "2px" 
            }}>
              GMがフェイズを進行させるまでお待ちください…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}