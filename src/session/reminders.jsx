// タイミングのメモ（GM 向けリマインダー）の表示。
// 「独自」タブで登録したメモ（gs.custom.reminders）を、そのタイミングが来たら GM の画面の左下に出す。
// 検出は gs の変化を見て GM のクライアントだけで行い、gs には何も書かない（閉じた・チェックした状態もローカル）。
// ※ SessionApp から直接 import されるため、遅延読み込みのモジュール（battle/rightPanel/customPanel 等）を import しないこと。
import { useState, useEffect, useRef } from "react";
import { C } from "../styles/colors";
import { getCustom, timingSnapshot, detectTimings, remindersFor } from "../customRules";

const MAX_GROUPS = 6;
const linkBtn = { fontSize: 9, cursor: "pointer", background: "none", border: "none", padding: "2px 0", fontFamily: "inherit", textDecoration: "underline" };

// ─── クエストの公開記録の確認（旧形式の部屋・GM のみ） ─────────────────────
// 公開記録（rooms/{code}/questGate）が無い部屋では、どのクエストが登場済みか・真相を公開済みかを GM に確かめてもらう。
// candidates: [{ id, name, solved, start }]（秘匿シナリオにあるクエストだけ）。onSave(revealedIds, approvedIds)
export function GmQuestGateInit({ candidates = [], onSave }) {
  const [revealed, setRevealed] = useState(() => Object.fromEntries(candidates.map(q => [q.id, q.start])));
  const [approved, setApproved] = useState({});
  return (
    <div data-testid="gate-init" style={{ position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 142, width: "min(92vw, 380px)", background: "rgba(10,8,22,0.97)", border: `1px solid ${C.gold}`, borderRadius: 6, padding: "8px 10px", boxShadow: "0 6px 20px rgba(0,0,0,0.55)", fontFamily: "'Noto Serif JP', serif" }}>
      <div style={{ fontSize: 10, color: C.gold, letterSpacing: 1, marginBottom: 4 }}>📋 クエストの公開記録を作ってください（GM にだけ表示）</div>
      <div style={{ fontSize: 9, color: C.textDim, lineHeight: 1.5, marginBottom: 6 }}>この部屋には公開記録がありません（以前の版で作った部屋）。登場済みのクエストと、真相を公開済みのクエストを確かめて記録してください。記録するまで、クエストの弾幕ごっこは敵の準備を待ちます。</div>
      {candidates.length === 0 && <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 6 }}>登場しているクエストはありません</div>}
      {candidates.map(q => (
        <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, color: C.text, marginBottom: 3 }}>
          <span style={{ flex: 1 }}>「{q.name}」{q.solved ? "（解決済み）" : ""}</span>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
            <input type="checkbox" checked={!!revealed[q.id]} onChange={e => setRevealed(r => ({ ...r, [q.id]: e.target.checked }))} />登場済み
          </label>
          {q.solved && (
            <label style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
              <input type="checkbox" checked={!!approved[q.id]} onChange={e => setApproved(a => ({ ...a, [q.id]: e.target.checked }))} />真相公開済み
            </label>
          )}
        </div>
      ))}
      <button type="button" onClick={() => {
        const rev = candidates.filter(q => revealed[q.id] || approved[q.id]).map(q => q.id);
        const app = candidates.filter(q => q.solved && approved[q.id]).map(q => q.id);
        onSave(rev, app);
      }} style={{ marginTop: 4, width: "100%", padding: "4px", fontSize: 10, cursor: "pointer", borderRadius: 3, background: C.goldBg, border: `1px solid ${C.goldDim}`, color: C.gold, fontFamily: "inherit" }}>この内容で記録する</button>
    </div>
  );
}

// ─── クエストの真相の公開待ち（GM のみ） ─────────────────────────────
// PL も「解決済み」を書けるため、真相は自動では公開せず、GM の承認で公開する（設定で自動公開にもできる）。
// pending: 公開待ちのクエスト（GM の公開記録で登場済み・未承認・解決済み。SessionApp が求める）
export function GmTruthApproval({ pending = [], onReveal, onAuto }) {
  if (!pending.length) return null;
  return (
    <div data-testid="truth-approval" style={{ position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 141, width: "min(92vw, 360px)", background: "rgba(10,8,22,0.97)", border: `1px solid ${C.gold}`, borderRadius: 6, padding: "8px 10px", boxShadow: "0 6px 20px rgba(0,0,0,0.55)", fontFamily: "'Noto Serif JP', serif", animation: "modalIn 0.22s ease both" }}>
      <div style={{ fontSize: 10, color: C.gold, letterSpacing: 1, marginBottom: 4 }}>🔓 真相の公開待ち（GM にだけ表示）</div>
      <div style={{ fontSize: 9, color: C.textDim, lineHeight: 1.5, marginBottom: 6 }}>解決されたクエストです。正しく解決されていれば公開してください（次のクエストもこのとき解放されます）。</div>
      {pending.map(q => (
        <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span style={{ flex: 1, fontSize: 11, color: C.text }}>「{q.name}」</span>
          <button onClick={() => onReveal([q.id])} style={{ padding: "3px 10px", fontSize: 10, cursor: "pointer", borderRadius: 3, background: C.goldBg, border: `1px solid ${C.goldDim}`, color: C.gold, fontFamily: "inherit" }}>公開する</button>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        {pending.length > 1 ? <button type="button" onClick={() => onReveal(pending.map(q => q.id))} style={{ ...linkBtn, color: C.gold }}>すべて公開する</button> : <span />}
        <button type="button" onClick={() => window.confirm("以後、クエストが解決されたら真相を自動で公開しますか？（この部屋の設定。登場していないクエストは公開されません）") && onAuto()} style={{ ...linkBtn, color: C.textFaint }}>以後は自動で公開する</button>
      </div>
    </div>
  );
}

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
