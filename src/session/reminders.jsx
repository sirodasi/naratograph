// タイミングのメモ（GM 向けリマインダー）の表示。
// 「独自」タブで登録したメモ（gs.custom.reminders）を、そのタイミングが来たら GM の画面の左下に出す。
// 検出は gs の変化を見て GM のクライアントだけで行い、gs には何も書かない（閉じた・チェックした状態もローカル）。
// ※ SessionApp から直接 import されるため、遅延読み込みのモジュール（battle/rightPanel/customPanel 等）を import しないこと。
import { useState, useEffect, useRef } from "react";
import { C } from "../styles/colors";
import { getCustom, timingSnapshot, detectTimings, remindersFor } from "../customRules";

const MAX_GROUPS = 6;

export function GmReminderOverlay({ gs }) {
  const [groups, setGroups] = useState([]); // [{ id, key, label, items: [{ id, text }], done: { [itemId]: true } }]
  const [hidden, setHidden] = useState(false);
  const prevRef = useRef(null);
  const seqRef = useRef(0);

  // 比較は要約の JSON 文字列で行う（gs のどこかが変わるたびに走らせない）
  const snapKey = JSON.stringify(timingSnapshot(gs));
  const remKey = JSON.stringify(getCustom(gs).reminders);

  useEffect(() => {
    const cur = JSON.parse(snapKey);
    const prev = prevRef.current;
    prevRef.current = cur;
    if (!prev) return; // 入室・再読み込み直後は出さない
    const fired = remindersFor({ custom: { reminders: JSON.parse(remKey) } }, detectTimings(prev, cur));
    if (!fired.length) return;
    // id は更新関数の外で決める（更新関数は純粋に保つ）
    const added = fired.map(g => ({ id: `g${++seqRef.current}`, key: g.key, label: g.label, items: g.items.map(r => ({ id: r.id, text: r.text })), done: {} }));
    setGroups(list => {
      let next = list;
      // 同じタイミングがまだ残っていれば置き換える（チェックはやり直し）
      added.forEach(g => { next = [...next.filter(x => x.key !== g.key), g]; });
      return next.slice(-MAX_GROUPS);
    });
    setHidden(false);
  }, [snapKey, remKey]);

  if (!groups.length) return null;

  const toggle = (gid, rid) => setGroups(list => list.map(g => g.id !== gid ? g : { ...g, done: { ...g.done, [rid]: !g.done[rid] } }));
  const close = (gid) => setGroups(list => list.filter(g => g.id !== gid));
  const total = groups.reduce((n, g) => n + g.items.filter(it => !g.done[it.id]).length, 0);
  const pos = { position: "fixed", left: 12, bottom: 16, zIndex: 139, fontFamily: "'Noto Serif JP', serif" };

  if (hidden) {
    return (
      <div onClick={() => setHidden(false)} style={{ ...pos, padding: "6px 12px", borderRadius: 16, cursor: "pointer", background: "rgba(10,8,22,0.95)", border: `1px solid ${C.red}`, color: C.red, fontSize: 11 }}>
        ⏰ GMメモ {total} 件（開く）
      </div>
    );
  }

  return (
    <div style={{ ...pos, width: "min(86vw, 320px)", maxHeight: "50vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 9, color: C.red, letterSpacing: 2, padding: "2px 8px", background: "rgba(10,8,22,0.9)", borderRadius: 8, border: `1px solid ${C.redBorder}` }}>⏰ GM のメモ（GM にだけ表示）</span>
        <span onClick={() => setHidden(true)} style={{ fontSize: 9, color: C.textFaint, cursor: "pointer", padding: "2px 8px", background: "rgba(10,8,22,0.9)", borderRadius: 8, border: `1px solid ${C.border}` }}>しまう ▾</span>
      </div>
      {groups.map(g => {
        const allDone = g.items.every(it => g.done[it.id]);
        return (
          <div key={g.id} style={{ background: "rgba(10,8,22,0.97)", border: `1px solid ${allDone ? C.greenBorder : C.redBorder}`, borderRadius: 6, padding: "8px 10px", boxShadow: "0 6px 20px rgba(0,0,0,0.55)", animation: "modalIn 0.22s ease both" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{ flex: 1, fontSize: 11, color: allDone ? C.green : C.red }}>⏰ {g.label}</span>
              <span onClick={() => close(g.id)} style={{ fontSize: 9, color: allDone ? C.green : C.textFaint, cursor: "pointer", padding: "1px 6px", border: `1px solid ${C.border}`, borderRadius: 3 }}>{allDone ? "閉じる" : "✕"}</span>
            </div>
            {g.items.map(it => {
              const done = !!g.done[it.id];
              return (
                <div key={it.id} onClick={() => toggle(g.id, it.id)} style={{ display: "flex", gap: 6, alignItems: "flex-start", cursor: "pointer", fontSize: 10, lineHeight: 1.5, color: done ? C.textFaint : C.text, textDecoration: done ? "line-through" : "none", padding: "2px 0" }}>
                  <span style={{ color: done ? C.green : C.textDim }}>{done ? "☑" : "☐"}</span>
                  <span style={{ whiteSpace: "pre-wrap" }}>{it.text}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
