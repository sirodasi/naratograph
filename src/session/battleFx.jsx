// 弾幕ごっこの演出（被弾・スペルカードのカットイン・回避の残像・グレイズの火花）。
// 検出は src/battleFx.js（純関数）。ここは各クライアントでローカルに再生する見た目と効果音だけ（gs には書かない）。
// 「演出を抑える」設定（motion.reduced）では、motion.js の CSS がアニメーションを 1ms にして最終状態（透明）に飛ばしてしまう。
// そのため抑制中は、揺れ・マス内の演出は出さず、被弾とカットインは動かない静止表示（still）にする（タップを塞がない）。
import { useState, useEffect, useRef } from "react";
import { CharSprite } from "../CharSprite";
import { C } from "../styles/colors";
import { sfx } from "../audio";
import { motion } from "../motion";
import { fxSnapshot, detectFx } from "../battleFx";

const CUTIN_MS = 2400;
const HIT_MS = 1300;
const KO_MS = 2200;

export const BATTLE_FX_CSS = `
  @keyframes fxShakeA { 0%,100%{transform:translate(0,0)} 15%{transform:translate(-7px,3px)} 30%{transform:translate(6px,-4px)} 45%{transform:translate(-5px,-2px)} 60%{transform:translate(4px,3px)} 75%{transform:translate(-2px,1px)} }
  @keyframes fxShakeB { 0%,100%{transform:translate(0,0)} 15%{transform:translate(-7px,3px)} 30%{transform:translate(6px,-4px)} 45%{transform:translate(-5px,-2px)} 60%{transform:translate(4px,3px)} 75%{transform:translate(-2px,1px)} }
  @keyframes fxShakeKoA { 0%,100%{transform:translate(0,0)} 10%{transform:translate(-12px,6px)} 22%{transform:translate(11px,-7px)} 34%{transform:translate(-9px,-4px)} 46%{transform:translate(8px,6px)} 60%{transform:translate(-5px,2px)} 78%{transform:translate(3px,-2px)} }
  @keyframes fxShakeKoB { 0%,100%{transform:translate(0,0)} 10%{transform:translate(-12px,6px)} 22%{transform:translate(11px,-7px)} 34%{transform:translate(-9px,-4px)} 46%{transform:translate(8px,6px)} 60%{transform:translate(-5px,2px)} 78%{transform:translate(3px,-2px)} }
  @keyframes fxHitFlash { 0%{opacity:0} 12%{opacity:1} 100%{opacity:0} }
  @keyframes fxKoFlash { 0%{opacity:0;background:rgba(255,255,255,0.85)} 8%{opacity:1;background:rgba(255,255,255,0.85)} 30%{opacity:1;background:rgba(10,0,0,0.6)} 80%{opacity:1;background:rgba(10,0,0,0.45)} 100%{opacity:0;background:rgba(10,0,0,0)} }
  @keyframes fxHitText { 0%{opacity:0;transform:translate(-50%,-50%) scale(1.6)} 14%{opacity:1;transform:translate(-50%,-50%) scale(0.96)} 24%{transform:translate(-50%,-50%) scale(1)} 75%{opacity:1} 100%{opacity:0;transform:translate(-50%,-56%) scale(1)} }
  @keyframes fxKoText { 0%{opacity:0;transform:translate(-50%,-50%) scale(2.2);letter-spacing:40px} 20%{opacity:1;transform:translate(-50%,-50%) scale(1);letter-spacing:14px} 80%{opacity:1} 100%{opacity:0;letter-spacing:18px} }
  @keyframes fxRing { 0%{transform:scale(0.2);opacity:1} 100%{transform:scale(2.4);opacity:0} }
  @keyframes fxShard { 0%{transform:translate(0,0) rotate(45deg) scale(1);opacity:1} 100%{transform:translate(var(--dx),var(--dy)) rotate(225deg) scale(0.3);opacity:0} }
  @keyframes fxGhost { 0%{opacity:0.75;transform:scale(1)} 100%{opacity:0;transform:scale(1.25)} }
  @keyframes fxDashIn { 0%{transform:scale(0.6);filter:brightness(2.2) blur(1px)} 60%{transform:scale(1.12);filter:brightness(1.3)} 100%{transform:scale(1);filter:none} }
  @keyframes fxSpark { 0%{transform:rotate(var(--r)) translateY(0) scaleY(1);opacity:1} 100%{transform:rotate(var(--r)) translateY(-26px) scaleY(0.2);opacity:0} }
  @keyframes fxGrazeText { 0%{opacity:0;transform:translate(-50%,6px)} 18%{opacity:1;transform:translate(-50%,0)} 70%{opacity:1} 100%{opacity:0;transform:translate(-50%,-14px)} }
  @keyframes fxLifeBreak { 0%{transform:scale(1);opacity:1} 40%{transform:scale(2.4);opacity:0.9} 100%{transform:scale(3);opacity:0} }
  @keyframes fxCutinLife { 0%{opacity:1} 86%{opacity:1} 100%{opacity:0} }
  @keyframes fxWhite { 0%{opacity:0.75} 100%{opacity:0} }
  @keyframes fxDim { 0%{opacity:0} 10%{opacity:1} 100%{opacity:1} }
  @keyframes fxBarTop { 0%{transform:translateY(-100%)} 12%{transform:translateY(0)} 100%{transform:translateY(0)} }
  @keyframes fxBarBot { 0%{transform:translateY(100%)} 12%{transform:translateY(0)} 100%{transform:translateY(0)} }
  @keyframes fxBandL { 0%{transform:skewY(-6deg) translateX(-110%)} 16%{transform:skewY(-6deg) translateX(0)} 100%{transform:skewY(-6deg) translateX(4%)} }
  @keyframes fxBandR { 0%{transform:skewY(6deg) translateX(110%)} 16%{transform:skewY(6deg) translateX(0)} 100%{transform:skewY(6deg) translateX(-4%)} }
  @keyframes fxPortraitL { 0%{opacity:0;transform:translateX(-40%)} 20%{opacity:1;transform:translateX(0)} 100%{opacity:1;transform:translateX(3%)} }
  @keyframes fxPortraitR { 0%{opacity:0;transform:translateX(40%)} 20%{opacity:1;transform:translateX(0)} 100%{opacity:1;transform:translateX(-3%)} }
  @keyframes fxCharIn { 0%{opacity:0;transform:translateY(10px) scale(1.4);filter:blur(3px)} 100%{opacity:1;transform:none;filter:none} }
  @keyframes fxLabelIn { 0%{opacity:0;letter-spacing:14px} 100%{opacity:1;letter-spacing:5px} }
`;

// ─── 検出とローカル状態 ─────────────────────────────────────────────
// 戻り値: { cutin, dismissCutin, hit, shake, gridFx }
//   gridFx[entityId] = { hit?: { key, cell }, life?: { key, index, lost }, ghost?: { key, from }, graze?: { key, cell, amount } }
export function useBattleFx(gs) {
  const snapKey = JSON.stringify(fxSnapshot(gs));
  const prevRef = useRef(null);
  const seq = useRef(0);
  const [cutin, setCutin] = useState(null);
  const [hit, setHit] = useState(null);
  const [shake, setShake] = useState({ n: 0, ko: false, on: false });
  const [gridFx, setGridFx] = useState({});
  const timers = useRef([]);
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current = []; }, []);
  const later = (fn, ms) => { timers.current.push(setTimeout(fn, ms)); };

  useEffect(() => {
    const cur = JSON.parse(snapKey);
    const prev = prevRef.current;
    prevRef.current = cur;
    const events = detectFx(prev, cur);
    if (!events.length) return;
    const still = !!motion.reduced;
    const patch = {};
    // 同じ更新で複数の宣言が届いたら、表示する最後の1枚の分だけ音を鳴らす
    const spells = events.filter(e => e.type === "spell");
    if (spells.length) {
      const ev = spells[spells.length - 1];
      setCutin({ key: ++seq.current, still, ...ev });
      sfx.cutin();
      sfx.spell(!ev.pc);
    }
    events.forEach(ev => {
      const key = ++seq.current;
      const slot = (patch[ev.id] = patch[ev.id] || {});
      if (ev.type === "spell") {
        return;
      } else if (ev.type === "hit") {
        if (!still) {
          slot.hit = { key, cell: ev.cell };
          slot.life = { key, index: ev.lives, lost: ev.lost };
          setShake(s => ({ n: s.n + 1, ko: ev.ko, on: true }));
          later(() => setShake(s => ({ ...s, on: false })), ev.ko ? 900 : 600);
        }
        setHit({ key, still, ...ev });
        if (ev.ko) sfx.ko(); else sfx.hit();
      } else if (ev.type === "dodge") {
        if (!still) slot.ghost = { key, from: ev.from };
      } else if (ev.type === "graze") {
        if (!still) slot.graze = { key, cell: ev.cell, amount: ev.amount };
        sfx.graze(ev.amount);
      }
    });
    if (!Object.keys(patch).length) return;
    setGridFx(g => {
      const next = { ...g };
      Object.entries(patch).forEach(([id, s]) => { next[id] = { ...(g[id] || {}), ...s }; });
      return next;
    });
    // 再生し終えたマスの演出は消す（盤面が一度消えて出し直されたときに、古い演出が再生されないように）
    later(() => setGridFx(g => {
      let changed = false;
      const next = { ...g };
      Object.entries(patch).forEach(([id, s]) => {
        const curFx = next[id];
        if (!curFx) return;
        const kept = { ...curFx };
        Object.entries(s).forEach(([kind, v]) => { if (kept[kind]?.key === v.key) { delete kept[kind]; changed = true; } });
        next[id] = kept;
      });
      return changed ? next : g;
    }), 1600);
  }, [snapKey]);

  useEffect(() => {
    if (!hit) return;
    const t = setTimeout(() => setHit(h => (h?.key === hit.key ? null : h)), hit.ko ? KO_MS : HIT_MS);
    return () => clearTimeout(t);
  }, [hit]);
  useEffect(() => {
    if (!cutin) return;
    const t = setTimeout(() => setCutin(c => (c?.key === cutin.key ? null : c)), CUTIN_MS);
    return () => clearTimeout(t);
  }, [cutin]);

  return { cutin, dismissCutin: () => setCutin(null), hit, shake, gridFx };
}

// 揺れのアニメーション名（同じ名前のままでは再生し直されないので、回数の偶奇で 2 つを交互に使う）
export const shakeAnimation = (shake) => (!shake.n || !shake.on) ? "none"
  : `${shake.ko ? (shake.n % 2 ? "fxShakeKoA" : "fxShakeKoB") : (shake.n % 2 ? "fxShakeA" : "fxShakeB")} ${shake.ko ? 0.7 : 0.45}s ease-out`;

// ─── 被弾の全面演出（赤い閃光＋文字。撃破・脱落は白→暗転＋大きな文字） ─────────
export function HitOverlay({ hit }) {
  if (!hit) return null;
  const color = hit.pc ? C.red : C.blue;
  const anim = (a) => (hit.still ? "none" : a);
  return (
    <div key={hit.key} data-testid="fx-hit" style={{ position: "absolute", inset: 0, zIndex: 35, pointerEvents: "none" }}>
      {hit.still ? null : hit.ko
        ? <div style={{ position: "absolute", inset: 0, animation: `fxKoFlash ${KO_MS}ms ease-out forwards` }} />
        : <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at center, transparent 35%, ${hit.pc ? "rgba(220,30,30,0.55)" : "rgba(60,90,230,0.45)"} 100%)`, animation: "fxHitFlash 0.6s ease-out forwards" }} />}
      <div style={{ position: "absolute", top: "42%", left: "50%", transform: "translate(-50%,-50%)", textAlign: "center", whiteSpace: "nowrap", animation: anim(`${hit.ko ? "fxKoText" : "fxHitText"} ${hit.ko ? KO_MS : HIT_MS}ms ease-out forwards`), fontFamily: "'Noto Serif JP', serif", ...(hit.still ? { background: "rgba(4,4,12,0.85)", border: `1px solid ${color}`, padding: "8px 18px", borderRadius: 3 } : {}) }}>
        <div style={{ fontSize: hit.ko ? 44 : 30, fontWeight: 700, color: "#fff", letterSpacing: hit.ko ? 14 : 6, textShadow: `0 0 18px ${color}, 0 0 40px ${color}aa, 0 2px 0 #000` }}>
          {hit.ko ? (hit.pc ? "脱落" : "撃破") : "被弾！"}
        </div>
        <div style={{ fontSize: 12, color, letterSpacing: 3, marginTop: 6, textShadow: "0 1px 3px #000" }}>
          {hit.name}{hit.ko ? "" : ` ／ 残り人数 ${hit.lives}`}
        </div>
      </div>
    </div>
  );
}

// ─── スペルカード宣言のカットイン（タップで飛ばせる） ─────────────────────
// portrait: { img } または { spriteRow, spriteCol }（呼び出し側で立ち絵 > カスタム画像 > スプライトの順に解決）
export function SpellCutin({ cutin, portrait, onDone }) {
  if (!cutin) return null;
  const fromLeft = cutin.pc; // PC は左から、敵は右から
  const color = cutin.final ? C.gold : (cutin.pc ? C.blue : C.red);
  const chars = [...cutin.name];
  if (cutin.still) {
    // 演出を抑える設定: 動かない帯だけを出す（タップを塞がない）
    return (
      <div key={cutin.key} data-testid="fx-cutin" style={{ position: "absolute", left: 0, right: 0, top: "38%", zIndex: 40, pointerEvents: "none", textAlign: "center", padding: "12px 8px", background: "rgba(4,4,12,0.9)", borderTop: `1px solid ${color}`, borderBottom: `1px solid ${color}`, fontFamily: "'Noto Serif JP', serif" }}>
        <div style={{ fontSize: 10, color, letterSpacing: 5, marginBottom: 6 }}>◆ {cutin.final ? "決戦 · " : ""}SPELL CARD ◆</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>{cutin.name}</div>
        <div style={{ fontSize: 11, color, letterSpacing: 3, marginTop: 4 }}>{cutin.who}</div>
      </div>
    );
  }
  return (
    <div key={cutin.key} data-testid="fx-cutin" onClick={onDone} title="タップで閉じる"
      style={{ position: "absolute", inset: 0, zIndex: 40, overflow: "hidden", cursor: "pointer", animation: `fxCutinLife ${CUTIN_MS}ms ease-in forwards`, fontFamily: "'Noto Serif JP', serif" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(2,2,8,0.6)", animation: `fxDim ${CUTIN_MS}ms forwards` }} />
      <div style={{ position: "absolute", left: "-15%", right: "-15%", top: "34%", height: "34%", background: `linear-gradient(90deg, transparent 0%, ${color}33 18%, ${color}88 50%, ${color}33 82%, transparent 100%)`, borderTop: `1px solid ${color}aa`, borderBottom: `1px solid ${color}aa`, animation: `${fromLeft ? "fxBandL" : "fxBandR"} ${CUTIN_MS}ms cubic-bezier(0.2,0.8,0.2,1) forwards` }} />
      <div style={{ position: "absolute", bottom: "10%", [fromLeft ? "left" : "right"]: "3%", height: "72%", display: "flex", alignItems: "flex-end", animation: `${fromLeft ? "fxPortraitL" : "fxPortraitR"} ${CUTIN_MS}ms cubic-bezier(0.2,0.8,0.2,1) forwards`, filter: `drop-shadow(0 0 14px ${color}aa)` }}>
        {portrait?.img
          ? <img src={portrait.img} alt="" style={{ height: "100%", maxWidth: "48vw", objectFit: "contain", transform: fromLeft ? "none" : "scaleX(-1)" }} />
          : <CharSprite spriteRow={portrait?.spriteRow ?? -1} spriteCol={portrait?.spriteCol ?? -1} size={168} style={{ border: `2px solid ${color}`, borderRadius: 6, boxShadow: `0 0 30px ${color}88` }} />}
      </div>
      <div style={{ position: "absolute", top: "36%", [fromLeft ? "right" : "left"]: "5%", maxWidth: "62%", textAlign: fromLeft ? "right" : "left" }}>
        <div style={{ fontSize: 10, color, letterSpacing: 5, marginBottom: 8, animation: "fxLabelIn 0.5s ease-out both", textShadow: "0 1px 3px #000" }}>
          ◆ {cutin.final ? "決戦 · " : ""}SPELL CARD ◆
        </div>
        <div style={{ fontSize: "clamp(20px, 4.6vw, 36px)", fontWeight: 700, color: "#fff", lineHeight: 1.3, textShadow: `0 0 16px ${color}, 0 0 34px ${color}88, 0 2px 0 #000` }}>
          {chars.map((ch, i) => <span key={i} style={{ display: "inline-block", whiteSpace: "pre", animation: `fxCharIn 0.3s ease-out ${0.22 + i * 0.045}s both` }}>{ch}</span>)}
        </div>
        <div style={{ fontSize: 12, color, letterSpacing: 4, marginTop: 8, animation: `fxLabelIn 0.5s ease-out ${0.3 + chars.length * 0.045}s both`, textShadow: "0 1px 3px #000" }}>{cutin.who}</div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: "10%", background: "#000", animation: `fxBarTop ${CUTIN_MS}ms ease-out forwards` }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "10%", background: "#000", animation: `fxBarBot ${CUTIN_MS}ms ease-out forwards` }} />
      <div style={{ position: "absolute", inset: 0, background: "#fff", animation: "fxWhite 0.35s ease-out forwards", pointerEvents: "none" }} />
    </div>
  );
}

// ─── マス内の演出（BattleGrid から使う） ────────────────────────────────
const SHARD_DIRS = [[0, -1], [0.7, -0.7], [1, 0], [0.7, 0.7], [0, 1], [-0.7, 0.7], [-1, 0], [-0.7, -0.7]];

// 被弾したマス: 衝撃の輪＋破片が飛び散る
export function CellHitBurst({ color }) {
  return (
    <div data-testid="fx-cell-hit" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", width: 34, height: 34, borderRadius: "50%", border: `3px solid ${color}`, boxShadow: `0 0 14px ${color}`, animation: "fxRing 0.6s ease-out forwards" }} />
      {SHARD_DIRS.map(([x, y], i) => (
        <div key={i} style={{ position: "absolute", width: 6, height: 6, background: i % 2 ? "#fff" : color, boxShadow: `0 0 6px ${color}`, "--dx": `${x * 34}px`, "--dy": `${y * 30}px`, animation: `fxShard 0.65s ease-out ${i % 2 ? 0.04 : 0}s forwards` }} />
      ))}
    </div>
  );
}

// 回避で移動する前のマスに残る残像
export function CellGhost({ sprite, color }) {
  return (
    <div data-testid="fx-ghost" style={{ position: "absolute", inset: 2, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", zIndex: 1, filter: `drop-shadow(0 0 6px ${color}) brightness(1.5)`, animation: "fxGhost 0.6s ease-out forwards" }}>
      {sprite}
    </div>
  );
}

// グレイズ（弾幕をかすめて消した）マスの火花
export function CellSparks({ color }) {
  return (
    <div data-testid="fx-sparks" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 5, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {[0, 45, 90, 135, 180, 225, 270, 315].map((r, i) => (
        <div key={i} style={{ position: "absolute", width: 2, height: 12, background: `linear-gradient(${color}, #fff)`, boxShadow: `0 0 6px ${color}`, transformOrigin: "50% 100%", "--r": `${r + (i % 2 ? 12 : 0)}deg`, animation: `fxSpark 0.5s ease-out ${i % 3 * 0.03}s forwards` }} />
      ))}
    </div>
  );
}

export function GrazeText({ amount }) {
  return (
    <div data-testid="fx-graze" style={{ position: "absolute", top: -10, left: "50%", zIndex: 8, pointerEvents: "none", whiteSpace: "nowrap", fontSize: 12, fontWeight: 700, letterSpacing: 2, color: "#fff", textShadow: `0 0 8px ${C.gold}, 0 0 16px ${C.gold}`, animation: "fxGrazeText 1.1s ease-out forwards" }}>
      GRAZE +{amount}
    </div>
  );
}
