import { useState, useEffect } from "react";

const MAP_NATURAL_W = 1200;
const MAP_NATURAL_H = 849;

export function useMapBounds(containerRef) {
  const [bounds, setBounds] = useState({ left: 0, top: 0, width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const calc = () => {
      const scale = Math.min(el.clientWidth / MAP_NATURAL_W, el.clientHeight / MAP_NATURAL_H);
      setBounds({ 
        left: 0, 
        top: 0, 
        width: MAP_NATURAL_W * scale, 
        height: MAP_NATURAL_H * scale 
      });
    };

    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  return bounds;
}