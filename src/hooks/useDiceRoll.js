import { useCallback } from "react";

export function useDiceRoll(upd) {
  const startRoll = useCallback((count, label, callback, isGlobal = false) => {
    const diceState = {
      isRolling: true,
      rollingCount: count,
      rollLabel: label,
      diceResult: null,
    };
    
    upd(prev => {
      if (isGlobal) return { ...prev, globalDice: diceState };
      return { ...prev, currentScene: { ...prev.currentScene, ...diceState } };
    });

    setTimeout(() => {
      const results = Array(count).fill(0).map(() => Math.floor(Math.random() * 6) + 1);
      
      upd(prev => {
        const resultState = { isRolling: false, diceResult: results };
        let next;
        
        if (isGlobal) {
          next = { ...prev, globalDice: { ...prev.globalDice, ...resultState } };
        } else {
          next = { ...prev, currentScene: { ...prev.currentScene, ...resultState } };
        }

        return callback ? callback(next, results) : next;
      });
    }, 1200);
  }, [upd]);

  return { startRoll };
}