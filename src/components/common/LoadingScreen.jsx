import React from "react";
import { COLORS } from "../../styles/theme";

export const LoadingScreen = ({ message = "接続中…", color = COLORS.textFaint }) => {
  return (
    <div style={{ 
      background: COLORS.bg, 
      height: "100vh", 
      display: "flex", 
      flexDirection: "column",
      alignItems: "center", 
      justifyContent: "center", 
      color: color, 
      fontFamily: "serif", 
      fontSize: 12,
      letterSpacing: 2
    }}>
      <div style={{ marginBottom: 16, fontSize: 20, animation: "pulse 2s infinite ease-in-out" }}>
        ⌛
      </div>
      {message}
      
      <style>{`
        @keyframes pulse {
          0% { opacity: 0.4; transform: scale(0.9); }
          50% { opacity: 1; transform: scale(1.1); }
          100% { opacity: 0.4; transform: scale(0.9); }
        }
      `}</style>
    </div>
  );
};