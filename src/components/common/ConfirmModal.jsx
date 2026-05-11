import React from "react";
import { COLORS } from "../../styles/theme";

export const ConfirmModal = ({ 
  title, 
  body, 
  onOk, 
  onCancel, 
  okLabel = "実行する", 
  okColor = COLORS.red 
}) => {
  return (
    <div 
      style={{ 
        position: "fixed", 
        inset: 0, 
        background: "rgba(0,0,0,0.82)", 
        zIndex: 1000, 
        display: "flex", 
        alignItems: "center", 
        justifyContent: "center",
        fontFamily: "serif"
      }} 
      onClick={onCancel}
    >
      <div 
        style={{ 
          background: "#0c1020", 
          border: `1px solid ${COLORS.border}`, 
          borderRadius: 6, 
          padding: 22, 
          maxWidth: 360, 
          width: "90%",
          boxShadow: "0 10px 40px rgba(0,0,0,0.5)"
        }} 
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize: 13, color: COLORS.gold, marginBottom: 8, letterSpacing: 1 }}>
          {title}
        </div>
        
        {body && (
          <div style={{ 
            fontSize: 11, 
            color: COLORS.textDim, 
            lineHeight: 1.8, 
            marginBottom: 20, 
            whiteSpace: "pre-wrap" 
          }}>
            {body}
          </div>
        )}
        
        <div style={{ display: "flex", gap: 10 }}>
          <button 
            onClick={onOk} 
            style={{ 
              flex: 1, 
              padding: "10px", 
              cursor: "pointer", 
              borderRadius: 4, 
              background: `${okColor}20`, 
              border: `1px solid ${okColor}80`, 
              color: okColor, 
              fontSize: 12,
              fontWeight: "bold",
              transition: "opacity 0.2s"
            }}
          >
            {okLabel}
          </button>
          
          <button 
            onClick={onCancel} 
            style={{ 
              flex: 1, 
              padding: "10px", 
              cursor: "pointer", 
              borderRadius: 4, 
              background: "rgba(255,255,255,0.03)", 
              border: `1px solid ${COLORS.border}`, 
              color: COLORS.textFaint, 
              fontSize: 12,
              transition: "opacity 0.2s"
            }}
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
};