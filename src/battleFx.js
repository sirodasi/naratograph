// 弾幕ごっこの演出イベントの検出（純関数）。
// 演出は各クライアントが gs の変化を見てローカルに出す（Firebase には何も書かない。画面全体の演出と同じ方式）。
// 連続する 2 つの gs の要約を比べて「被弾・回避移動・グレイズ・スペルカード宣言」を取り出す。
// 入室・再読み込み直後（前の要約が無い）や、戦闘の開始・終了をまたぐ変化では何も出さない。

const toArray = (v) => Array.isArray(v) ? v : (v && typeof v === "object" ? Object.values(v) : []);
const EVADE_PHASE = /_evade_(intro|move|result)$/;

export function fxSnapshot(gs) {
  const b = gs?.battle;
  if (!b?.active) return { active: false };
  const uids = b.participantPcUids ? toArray(b.participantPcUids) : null;
  const ents = {};
  toArray(gs.pcs).filter(pc => pc && (!uids || uids.includes(pc.uid))).forEach(pc => {
    ents[pc.uid] = { pc: true, name: pc.charName || "", lives: pc.resources?.残り人数?.cur ?? 0, graze: pc.resources?.グレイズ?.cur ?? 0 };
  });
  toArray(b.participants?.npcs).filter(Boolean).forEach(n => {
    ents[n.id] = { pc: false, name: n.name || "", lives: n.resources?.残り人数?.cur ?? 0, graze: n.resources?.グレイズ?.cur ?? 0 };
  });
  return {
    active: true,
    round: b.round || 1,
    phase: b.phase || "",
    final: !!(b.isFinal ?? (b.type === "mass" && !b.questId)),
    pos: { ...(b.positions || {}) },
    spells: { ...(b.spellUsedBy || {}) },
    ents,
  };
}

// → [{ type: "spell"|"hit"|"dodge"|"graze", id, pc, name, ... }]
export function detectFx(prev, cur) {
  if (!prev?.active || !cur?.active) return [];
  const out = [];
  Object.entries(cur.spells).forEach(([id, name]) => {
    if (!name || prev.spells[id] === name) return;
    const e = cur.ents[id];
    out.push({ type: "spell", id, pc: !!e?.pc, name: String(name), who: e?.name || "", final: cur.final });
  });
  Object.entries(cur.ents).forEach(([id, e]) => {
    const p = prev.ents[id];
    if (!p) return;
    if (e.lives < p.lives) {
      out.push({ type: "hit", id, pc: e.pc, name: e.name, lives: e.lives, lost: p.lives - e.lives, ko: e.lives <= 0, cell: prev.pos[id] ?? cur.pos[id] ?? null });
    }
    const evading = EVADE_PHASE.test(prev.phase);
    if (evading && prev.pos[id] != null && cur.pos[id] != null && prev.pos[id] !== cur.pos[id]) {
      out.push({ type: "dodge", id, pc: e.pc, name: e.name, from: prev.pos[id], to: cur.pos[id] });
    }
    if (e.graze > p.graze) {
      // 回避中に増えたなら、弾幕を消したマス（移動前の位置）で火花を出す。それ以外（ミシガンロール・GM の操作）は数字だけ
      out.push({ type: "graze", id, pc: e.pc, name: e.name, amount: e.graze - p.graze, cell: evading ? (prev.pos[id] ?? null) : null });
    }
  });
  return out;
}
