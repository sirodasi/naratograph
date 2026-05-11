import { useState, useRef, useCallback } from "react";

export function useDiceRoll() {
  const [diceResult, setDiceResult] = useState(null);
  const [diceAnim, setDiceAnim] = useState(false);
  const timerRef = useRef(null);

  const rollD6 = () => Math.floor(Math.random() * 6) + 1;

  const animateDice = useCallback((count, callback) => {
    if (timerRef.current) clearInterval(timerRef.current);
    
    setDiceAnim(true);
    setDiceResult(Array(count).fill(0).map(rollD6));

    let frame = 0;
    timerRef.current = setInterval(() => {
      frame++;
      // シャッフル中のランダムな出目
      setDiceResult(Array(count).fill(0).map(rollD6));

      if (frame >= 14) {
        clearInterval(timerRef.current);
        const finalResult = Array(count).fill(0).map(rollD6);
        setDiceResult(finalResult);
        setDiceAnim(false);
        if (callback) callback(finalResult);
      }
    }, 80);
  }, []);

  return { diceResult, diceAnim, animateDice };
}