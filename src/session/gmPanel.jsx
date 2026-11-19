// GM 介入ツールの UI（GM 操作タブ）と、PL 側の要求カード（全画面共通のオーバーレイ）。
// ロジックは src/gmTools.js（純関数）。ここは入力と表示だけを担う。
// ※ SessionApp から直接 import されるため、遅延読み込みのモジュール（battle/rightPanel 等）を import しないこと。
import { useState } from "react";
import { sfx } from "../audio";
import { C, btnFull, iStyle } from "../styles/colors";
import {
  REQUEST_KINDS, getRequests, addRequest, removeRequest, respondDice, addCheerDice, confirmDice,
  respondChoice, ackNotice, isAnswered, pendingFor, describeDice, evalJudgment, cheerOptions, isFragileResp,
  scenarioEnemies, startAdhocBattle, BAD_STATUS_NAMES, gmAddBadStatus, gmAddBond, gmRemoveBond,
  gmToggleBondUsed, gmMovePc, gmToggleActed, gmResetAbilityUse, gmAdjustMax, tableResult, giveTableItem,
} from "../gmTools";
import { getCustom, itemByName, TABLE_DICE } from "../customRules";
import { SPECIAL_BOND_CHEER, KURUWASU_BOND } from "./shared";

const rollN = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 6) + 1);
const newId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const sectionTitle = { fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginBottom: 6, marginTop: 4 };
const box = { marginBottom: 10, padding: 8, background: "rgba(255,255,255,0.02)", border: `1px solid ${C.border}`, borderRadius: 4 };
const chip = (on, color = C.gold) => ({ padding: "3px 8px", fontSize: 9, cursor: "pointer", borderRadius: 10, background: on ? `${color}26` : "rgba(255,255,255,0.03)", border: `1px solid ${on ? color : C.border}`, color: on ? color : C.textFaint });
const tiny = (color = C.textDim) => ({ padding: "2px 6px", fontSize: 9, cursor: "pointer", borderRadius: 3, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, color });
const num = { ...iStyle, width: 44, padding: "3px 4px", fontSize: 10 };

const cheerLabel = (cheerer, bondName) => bondName === KURUWASU_BOND ? "絆なし"
  : bondName === SPECIAL_BOND_CHEER
  ? `《${cheerer.specialBond?.target}への${cheerer.specialBond?.word || "敬意"}》`
  : `《${bondName}》`;
// 失敗でファンブルになる応援（魂の弱い所／人を狂わす）は紫で区別する
const cheerBtn = (o) => o.fragile
  ? btnFull("rgba(156,39,176,0.15)", "#6a1b9a", C.purple, { width: "auto", fontSize: 9, padding: "3px 8px" })
  : btnFull(C.blueBg, C.blueBorder, C.blue, { width: "auto", fontSize: 9, padding: "3px 8px" });

// 対象 PC の選択（チップ＋全員）
function TargetPicker({ pcs, value, onChange }) {
  const all = pcs.length > 0 && pcs.every(pc => value.includes(pc.uid));
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
      <span onClick={() => onChange(all ? [] : pcs.map(p => p.uid))} style={chip(all, C.red)}>全員</span>
      {pcs.map(pc => {
        const on = value.includes(pc.uid);
        return <span key={pc.uid} onClick={() => onChange(on ? value.filter(u => u !== pc.uid) : [...value, pc.uid])} style={chip(on)}>{pc.charName}</span>;
      })}
    </div>
  );
}

// ─── GM 操作タブ ──────────────────────────────────────────────────
export function GmToolsPanel({ gs, upd, getSpot }) {
  const pcs = gs.pcs || [];
  const requests = getRequests(gs);

  return (
    <div data-touch-zoom>
      <RequestComposer pcs={pcs} upd={upd} tables={getCustom(gs).tables} gs={gs} />
      <div style={sectionTitle}>進行中の要求（{requests.length}）</div>
      {requests.length === 0 && <div style={{ fontSize: 10, color: "#2a3545", marginBottom: 10 }}>なし</div>}
      {[...requests].reverse().map(r => <RequestMonitor key={r.id} req={r} gs={gs} upd={upd} />)}
      <AdhocBattleForm gs={gs} upd={upd} getSpot={getSpot} />
    </div>
  );
}

function RequestComposer({ pcs, upd, tables = [], gs }) {
  const [kind, setKind] = useState("dice");
  const [targets, setTargets] = useState([]);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [count, setCount] = useState(2);
  const [mode, setMode] = useState("nd6");
  const [target, setTarget] = useState("");
  const [options, setOptions] = useState("");
  const [tableId, setTableId] = useState("");
  const [give, setGive] = useState(true);

  const table = mode === "table" ? tables.find(t => t.id === tableId) : null;
  const tableHasItems = !!table && table.rows.some(r => itemByName(gs, r.text));
  const optList = options.split("\n").map(s => s.trim()).filter(Boolean);
  const valid = targets.length > 0 && (kind !== "choice" || optList.length >= 2) && (kind !== "notice" || title.trim() || text.trim())
    && (kind !== "dice" || mode !== "table" || !!table);

  const send = () => {
    if (!valid) return;
    const spec = { kind, title, text, targets, dice: { count, mode, target: target ? parseInt(target) : null }, options: optList,
      ...(kind === "dice" && table ? { table: { ...table, give: give && tableHasItems } } : {}) };
    const id = newId();
    const now = Date.now();
    setTitle(""); setText(""); setOptions(""); // 二重送信防止のため先にクリア
    upd(p => addRequest(p, spec, id, now));
  };

  return (
    <div style={box}>
      <div style={{ fontSize: 10, color: C.red, letterSpacing: 1, marginBottom: 6 }}>▶ GM: PL への要求</div>
      <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
        {Object.entries(REQUEST_KINDS).map(([k, label]) => (
          <span key={k} onClick={() => setKind(k)} style={{ ...chip(kind === k, C.red), flex: 1, textAlign: "center" }}>{label}</span>
        ))}
      </div>
      <TargetPicker pcs={pcs} value={targets} onChange={setTargets} />
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder={kind === "dice" ? "見出し（例: 梅雨の災い表）" : kind === "choice" ? "問い（例: 誘いに乗る？）" : "見出し"} style={{ ...iStyle, fontSize: 10, marginBottom: 4 }} />
      <textarea value={text} onChange={e => setText(e.target.value)} placeholder="説明（任意）" rows={2} style={{ ...iStyle, fontSize: 10, marginBottom: 4, resize: "vertical" }} />
      {kind === "dice" && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 6, fontSize: 9, color: C.textDim }}>
          <span onClick={() => setMode("nd6")} style={chip(mode === "nd6")}>nD6</span>
          <span onClick={() => setMode("d66")} style={chip(mode === "d66")}>D66</span>
          {tables.length > 0 && <span onClick={() => setMode("table")} style={chip(mode === "table")}>独自の表</span>}
          {mode === "table" && (
            <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 4 }}>
              <select value={tableId} onChange={e => setTableId(e.target.value)} style={{ ...iStyle, fontSize: 10, padding: "3px 4px" }}>
                <option value="">表を選択...</option>
                {tables.map(t => <option key={t.id} value={t.id}>{t.name}（{TABLE_DICE[t.dice] || t.dice}）</option>)}
              </select>
              {tableHasItems && (
                <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                  <input type="checkbox" checked={give} onChange={e => setGive(e.target.checked)} />
                  結果と同じ名前の独自アイテムを、振った PC にそのまま渡す
                </label>
              )}
              <div style={{ fontSize: 8, color: C.textFaint }}>PL が自分の画面で表を振り、結果がログに残ります。</div>
            </div>
          )}
          {mode === "nd6" && (
            <>
              <span>個数</span>
              <input type="number" min={1} max={10} value={count} onChange={e => setCount(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))} style={num} />
              <span>目標値</span>
              <input type="number" min={1} max={6} value={target} onChange={e => setTarget(e.target.value === "" ? "" : String(Math.max(1, Math.min(6, parseInt(e.target.value) || 1))))} placeholder="なし" style={num} />
            </>
          )}
          {mode === "nd6" && target && <div style={{ width: "100%", fontSize: 8, color: C.textFaint }}>目標値ありは行為判定（最大値≧目標で成功・応援で振り足し可・本人が確定）</div>}
        </div>
      )}
      {kind === "choice" && (
        <textarea value={options} onChange={e => setOptions(e.target.value)} placeholder={"選択肢を1行に1つ（2つ以上）\n乗る\n断る"} rows={3} style={{ ...iStyle, fontSize: 10, marginBottom: 6, resize: "vertical" }} />
      )}
      <button onClick={send} disabled={!valid} style={btnFull(valid ? C.redBg : "rgba(255,255,255,0.02)", valid ? C.redBorder : C.border, valid ? C.red : C.textFaint, { fontSize: 11, cursor: valid ? "pointer" : "not-allowed" })}>
        {kind === "dice" ? "🎲 ダイスを振らせる" : kind === "choice" ? "❓ 選択させる" : "📣 告知する"}
      </button>
    </div>
  );
}

function RequestMonitor({ req, gs, upd }) {
  const pcs = gs.pcs || [];
  const nameOf = uid => pcs.find(x => x.uid === uid)?.charName || "（不在）";
  const done = (req.targets || []).every(uid => isAnswered(req, uid));
  const icon = req.kind === "dice" ? "🎲" : req.kind === "choice" ? "❓" : "📣";
  const tally = req.kind === "choice" ? (req.options || []).map((o, i) => [o, (req.targets || []).filter(u => req.responses?.[u]?.choice === i).length]) : null;

  return (
    <div style={{ ...box, borderColor: done ? C.greenBorder : C.border }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{ flex: 1, fontSize: 10, color: done ? C.green : C.gold }}>
          {icon} {req.title || REQUEST_KINDS[req.kind]}
          {req.kind === "dice" && <span style={{ color: C.textFaint }}>（{req.table ? `表「${req.table.name}」${req.table.give ? "・アイテム自動" : ""}` : req.dice?.mode === "d66" ? "D66" : `${req.dice?.count}D6`}{req.dice?.target ? `・目標${req.dice.target}` : ""}）</span>}
        </span>
        <button onClick={() => upd(p => removeRequest(p, req.id))} title={done ? "閉じる" : "未回答のまま取り下げる"} style={tiny(done ? C.green : C.red)}>{done ? "閉じる" : "取り下げ"}</button>
      </div>
      {(req.targets || []).map(uid => {
        const r = req.responses?.[uid] || {};
        const rolled = (r.dice || []).length > 0;
        const tr = tableResult(req, r, gs);
        return (
          <div key={uid} style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", fontSize: 9, padding: "2px 0", borderTop: `1px solid ${C.border}44` }}>
            <span style={{ minWidth: 56, color: C.text }}>{nameOf(uid)}</span>
            {req.kind === "dice" && (
              <>
                <span style={{ flex: 1, color: r.confirmed ? C.green : rolled ? C.gold : C.textFaint }}>{rolled ? describeDice(req, r, gs.unluckyPhase) : "未"}{rolled && !r.confirmed ? "（確定待ち）" : ""}</span>
                {!rolled && <button onClick={() => { const d = rollN(req.dice.count); const iid = newId(); upd(p => respondDice(p, req.id, uid, d, true, iid)); }} style={tiny(C.red)}>代理で振る</button>}
                {tr?.item && (r.given
                  ? <span style={{ color: C.green }}>渡し済み</span>
                  : <button onClick={() => { const iid = newId(); upd(p => giveTableItem(p, req.id, uid, iid)); }} style={tiny(C.gold)}>【{tr.item.name}】を渡す</button>)}
                {rolled && !r.confirmed && <button onClick={() => upd(p => confirmDice(p, req.id, uid))} style={tiny(C.red)}>代理確定</button>}
              </>
            )}
            {req.kind === "choice" && (
              r.choice != null
                ? <span style={{ flex: 1, color: C.green }}>{req.options[r.choice]}{r.byGm ? "（代理）" : ""}</span>
                : <span style={{ flex: 1, display: "flex", gap: 3, flexWrap: "wrap" }}>
                    <span style={{ color: C.textFaint }}>未</span>
                    {req.options.map((o, i) => <button key={i} onClick={() => upd(p => respondChoice(p, req.id, uid, i, true))} style={tiny(C.red)} title="代理で選ぶ">{o}</button>)}
                  </span>
            )}
            {req.kind === "notice" && <span style={{ flex: 1, color: r.ack ? C.green : C.textFaint }}>{r.ack ? "確認済み" : "未確認"}</span>}
          </div>
        );
      })}
      {tally && <div style={{ marginTop: 4, fontSize: 9, color: C.textDim }}>集計: {tally.map(([o, n]) => `${o} ${n}`).join(" / ")}</div>}
    </div>
  );
}

// 臨時の弾幕ごっこ（シナリオの敵から選ぶ／その場で作る）
const BLANK_ENEMY = { name: "", life: 2, spellcard: 1, attack: 1, evade: 3, dsName: "", dsDesc: "", sc1name: "", sc1effect: "" };

function AdhocBattleForm({ gs, upd, getSpot }) {
  const pcs = gs.pcs || [];
  const known = scenarioEnemies(gs.scenarioData);
  const [picked, setPicked] = useState([]);       // known のインデックス
  const [custom, setCustom] = useState([]);       // その場で作った敵
  const [draft, setDraft] = useState(null);
  const sceneSpot = gs.currentScene ? (pcs.find(x => x.uid === gs.currentScene.pcUid)?.currentSpot) : null;
  // 参加 PC: GM が選ぶまでは「いま進行中のシーンの PC」に追従する（タブを開いた時点の値で固定しない）
  const scenePcUid = gs.currentScene?.pcUid || null;
  const [chosen, setChosen] = useState(null); // null = シーンに追従
  const participants = (chosen ?? (scenePcUid ? [scenePcUid] : [])).filter(u => pcs.some(x => x.uid === u));
  const sameSpot = sceneSpot ? pcs.filter(x => x.currentSpot === sceneSpot).map(x => x.uid) : [];
  const [title, setTitle] = useState("");

  const enemies = [...picked.map(i => known[i]?.enemy).filter(Boolean), ...custom];
  const canStart = enemies.length > 0 && participants.length > 0 && !gs.battle?.active;

  const start = () => {
    if (!canStart) return;
    const msg = `弾幕ごっこを開始します。\n${participants.map(u => pcs.find(x => x.uid === u)?.charName).join("・")} vs ${enemies.map(e => e.name).join("・")}${gs.currentScene ? "\n（進行中のシーンは戦闘後に再開されます）" : ""}`;
    if (!window.confirm(msg)) return;
    const spec = { enemies, participantPcUids: participants, title };
    const stamp = Date.now();
    setPicked([]); setCustom([]); setTitle(""); setChosen(null);
    upd(p => startAdhocBattle(p, spec, stamp));
  };

  const d = draft;
  const setD = (k, v) => setDraft(prev => ({ ...prev, [k]: v }));

  return (
    <div style={{ ...box, marginTop: 6 }}>
      <div style={{ fontSize: 10, color: C.red, letterSpacing: 1, marginBottom: 6 }}>⚔ 臨時の弾幕ごっこ</div>
      <div style={{ fontSize: 9, color: C.textDim, marginBottom: 3 }}>敵</div>
      {known.length === 0 && <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 4 }}>シナリオに登録された敵はありません</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 4, maxHeight: 140, overflowY: "auto" }}>
        {known.map(({ enemy, from }, i) => {
          const on = picked.includes(i);
          return (
            <div key={i} onClick={() => setPicked(on ? picked.filter(x => x !== i) : [...picked, i])} style={{ ...chip(on, C.red), borderRadius: 3, display: "flex", justifyContent: "space-between", gap: 6 }}>
              <span>{on ? "☑" : "☐"} {enemy.name}</span>
              <span style={{ color: C.textFaint, fontSize: 8 }}>残{enemy.life ?? "-"}/SC{enemy.spellcard ?? "-"}/攻{enemy.attack ?? "-"} · {from}</span>
            </div>
          );
        })}
        {custom.map((e, i) => (
          <div key={`c${i}`} style={{ ...chip(true, C.red), borderRadius: 3, display: "flex", justifyContent: "space-between" }}>
            <span>☑ {e.name}（その場で作成）</span>
            <span onClick={() => setCustom(custom.filter((_, j) => j !== i))} style={{ color: C.textFaint }}>✕</span>
          </div>
        ))}
      </div>
      {!d ? (
        <button onClick={() => setDraft({ ...BLANK_ENEMY })} style={{ ...tiny(C.gold), marginBottom: 6 }}>＋ その場で敵を作る</button>
      ) : (
        <div style={{ padding: 6, border: `1px dashed ${C.border}`, borderRadius: 3, marginBottom: 6 }}>
          <input value={d.name} onChange={e => setD("name", e.target.value)} placeholder="敵の名前" style={{ ...iStyle, fontSize: 10, marginBottom: 4 }} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", fontSize: 9, color: C.textDim, marginBottom: 4 }}>
            {[["life", "残人数", 1, 99], ["spellcard", "スペカ", 0, 9], ["attack", "攻撃", 0, 99], ["evade", "回避", 0, 3]].map(([k, label, min, max]) => (
              <label key={k} style={{ display: "flex", alignItems: "center", gap: 2 }}>{label}
                <input type="number" min={min} max={max} value={d[k]} onChange={e => setD(k, Math.max(min, Math.min(max, parseInt(e.target.value) || 0)))} style={{ ...num, width: 38 }} />
              </label>
            ))}
          </div>
          <input value={d.dsName} onChange={e => setD("dsName", e.target.value)} placeholder="弾幕スキル名（任意）" style={{ ...iStyle, fontSize: 10, marginBottom: 4 }} />
          <input value={d.dsDesc} onChange={e => setD("dsDesc", e.target.value)} placeholder="弾幕スキルの効果（任意）" style={{ ...iStyle, fontSize: 10, marginBottom: 4 }} />
          <input value={d.sc1name} onChange={e => setD("sc1name", e.target.value)} placeholder="スペルカード名（任意）" style={{ ...iStyle, fontSize: 10, marginBottom: 4 }} />
          <input value={d.sc1effect} onChange={e => setD("sc1effect", e.target.value)} placeholder="スペルカードの効果（任意）" style={{ ...iStyle, fontSize: 10, marginBottom: 4 }} />
          <div style={{ display: "flex", gap: 4 }}>
            <button disabled={!d.name.trim()} onClick={() => { setCustom([...custom, { ...d, name: d.name.trim() }]); setDraft(null); }} style={{ ...tiny(C.gold), flex: 1 }}>追加</button>
            <button onClick={() => setDraft(null)} style={{ ...tiny(), flex: 1 }}>やめる</button>
          </div>
        </div>
      )}
      <div style={{ fontSize: 9, color: C.textDim, marginBottom: 3 }}>参加PC{sceneSpot ? `（シーンのスポット: ${getSpot?.(sceneSpot)?.name || sceneSpot}）` : ""}</div>
      <TargetPicker pcs={pcs} value={participants} onChange={setChosen} />
      {(chosen !== null || sameSpot.length > 1) && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
          {sameSpot.length > 1 && <button onClick={() => setChosen(sameSpot)} style={tiny()}>シーンと同じスポットの全員</button>}
          {chosen !== null && <button onClick={() => setChosen(null)} style={tiny()}>シーンの PC に戻す</button>}
        </div>
      )}
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="戦闘の名前（任意。ログと結果画面に出ます）" style={{ ...iStyle, fontSize: 10, marginBottom: 6 }} />
      <button onClick={start} disabled={!canStart} style={btnFull(canStart ? C.redBg : "rgba(255,255,255,0.02)", canStart ? C.redBorder : C.border, canStart ? C.red : C.textFaint, { fontSize: 11, cursor: canStart ? "pointer" : "not-allowed" })}>
        {gs.battle?.active ? "弾幕ごっこ中は開始できません" : "⚔ 弾幕ごっこを開始する"}
      </button>
      <div style={{ fontSize: 8, color: C.textFaint, marginTop: 4, lineHeight: 1.5 }}>
        クエストとは無関係の戦闘として扱います（勝敗の結果はログに残るので、報酬やペナルティは GM が処理してください）。進行中のシーンは戦闘後に再開します。
      </div>
    </div>
  );
}

// ─── PL 側の要求カード（全画面共通のオーバーレイ） ─────────────────
export function GmRequestOverlay({ gs, upd, user }) {
  const [rolling, setRolling] = useState(null); // ローカルの振りアニメ { key, faces }
  const [hidden, setHidden] = useState(false);
  const [results, setResults] = useState([]); // 自分が振った結果（目標値なしは振った瞬間に確定してカードが消えるため、手元に残す）
  const me = (gs.pcs || []).find(x => x.uid === user?.uid);
  if (!me) return null;
  const requests = getRequests(gs);
  const mine = pendingFor(gs, me.uid);

  // 他 PC の判定（目標値あり・振った後・未確定）で自分が応援できるもの
  const cheerables = [];
  requests.forEach(req => {
    if (req.kind !== "dice" || !req.dice?.target) return;
    (req.targets || []).forEach(judgeUid => {
      if (judgeUid === me.uid) return;
      const r = req.responses?.[judgeUid];
      if (!(r?.dice || []).length || r.confirmed) return;
      const judge = gs.pcs.find(x => x.uid === judgeUid);
      if (!judge) return;
      const opts = cheerOptions(gs.pcs, judge).filter(o => o.cheerer.uid === me.uid);
      if (opts.length) cheerables.push({ req, judge, opts });
    });
  });

  if (!mine.length && !cheerables.length && !results.length) return null;

  const animateThen = (key, n, done) => {
    if (rolling) return;
    let f = 0;
    sfx.diceRoll();
    const tick = setInterval(() => {
      f++;
      setRolling({ key, faces: rollN(n) });
      if (f >= 8) {
        clearInterval(tick);
        const res = rollN(n);
        setRolling(null);
        sfx.diceResult(Math.max(...res));
        done(res);
      }
    }, 70);
  };

  const card = (accent) => ({ background: "rgba(10,8,22,0.97)", border: `1px solid ${accent}`, borderRadius: 6, padding: "10px 12px", boxShadow: `0 0 18px ${accent}44, 0 6px 24px rgba(0,0,0,0.6)`, animation: "modalIn 0.22s ease both" });
  const face = (d, key) => <div key={key} style={{ width: 30, height: 30, border: `2px solid ${C.goldDim}`, borderRadius: 4, background: "rgba(8,6,18,0.95)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: C.gold, fontWeight: "bold" }}>{d}</div>;

  if (hidden) {
    return (
      <div onClick={() => setHidden(false)} style={{ position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 140, padding: "6px 14px", borderRadius: 16, cursor: "pointer", background: "rgba(10,8,22,0.95)", border: `1px solid ${C.gold}`, color: C.gold, fontSize: 11, fontFamily: "'Noto Serif JP', serif", animation: "panelAlertGlow 1.6s ease infinite" }}>
        📜 GMからの要求 {mine.length + cheerables.length} 件{results.length ? `・結果 ${results.length}` : ""}（開く）
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 140, width: "min(92vw, 380px)", maxHeight: "60vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, fontFamily: "'Noto Serif JP', serif" }}>
      <div style={{ textAlign: "right" }}>
        <span onClick={() => setHidden(true)} style={{ fontSize: 9, color: C.textFaint, cursor: "pointer", padding: "2px 8px", background: "rgba(10,8,22,0.9)", borderRadius: 8, border: `1px solid ${C.border}` }}>しまう ▾</span>
      </div>
      {results.map(res => (
        <div key={res.key} style={card(C.green)}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, marginBottom: 3 }}>結果</div>
              <div style={{ fontSize: 12, color: C.gold, marginBottom: 2 }}>{res.title}</div>
              <div style={{ fontSize: 11, color: C.text }}>{res.text}</div>
              {res.item && <div style={{ fontSize: 10, color: C.green, marginTop: 3 }}>{res.given ? `【${res.item}】を獲得しました` : `【${res.item}】（受け取りは GM が判断します）`}</div>}
            </div>
            <span onClick={() => setResults(results.filter(x => x.key !== res.key))} title="閉じる" style={{ fontSize: 11, color: C.textFaint, cursor: "pointer" }}>✕</span>
          </div>
        </div>
      ))}
      {mine.map(req => {
        const r = req.responses?.[me.uid] || {};
        const key = `${req.id}:${me.uid}`;
        const head = (
          <>
            <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, marginBottom: 3 }}>GMからの{REQUEST_KINDS[req.kind]}</div>
            {req.title && <div style={{ fontSize: 13, color: C.gold, marginBottom: 3 }}>{req.title}</div>}
            {req.text && <div style={{ fontSize: 10, color: C.text, whiteSpace: "pre-wrap", lineHeight: 1.5, marginBottom: 6 }}>{req.text}</div>}
          </>
        );
        if (req.kind === "notice") {
          return (
            <div key={req.id} style={card(C.gold)}>
              {head}
              <button onClick={() => upd(p => ackNotice(p, req.id, me.uid))} style={btnFull(C.goldBg, C.goldDim, C.gold, { fontSize: 11 })}>確認した</button>
            </div>
          );
        }
        if (req.kind === "choice") {
          return (
            <div key={req.id} style={card(C.blue)}>
              {head}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {(req.options || []).map((o, i) => (
                  <button key={i} onClick={() => upd(p => respondChoice(p, req.id, me.uid, i))} style={btnFull(C.blueBg, C.blueBorder, C.blue, { fontSize: 11 })}>{o}</button>
                ))}
              </div>
            </div>
          );
        }
        // ダイス
        const dice = r.dice || [];
        const target = req.dice?.target;
        const j = target && dice.length ? evalJudgment(dice, target, gs.unluckyPhase, isFragileResp(r)) : null;
        const helpers = target && dice.length ? cheerOptions(gs.pcs, me).filter(o => o.cheerer.uid !== me.uid) : [];
        const selfCheers = target && dice.length ? cheerOptions(gs.pcs, me).filter(o => o.cheerer.uid === me.uid) : [];
        const shown = rolling?.key === key ? rolling.faces : dice;
        return (
          <div key={req.id} style={card(C.gold)}>
            {head}
            <div style={{ fontSize: 9, color: C.textDim, marginBottom: 6 }}>
              {req.table ? `表「${req.table.name}」を振る（${TABLE_DICE[req.table.dice] || req.table.dice}）` : req.dice?.mode === "d66" ? "D66" : `${req.dice?.count}D6`}{target ? ` ／ 行為判定・目標値 ${target}` : ""}
            </div>
            {shown.length > 0 && (
              <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 6 }}>{shown.map((d, i) => face(d, i))}</div>
            )}
            {!dice.length ? (
              <button disabled={!!rolling} onClick={() => animateThen(key, req.dice.count, res => {
                const iid = newId();
                if (!target) {
                  const resp = { dice: res };
                  const tr = tableResult(req, resp, gs);
                  setResults(prev => [...prev, {
                    key: `${key}:${iid}`, title: req.title || (req.table ? `表「${req.table.name}」` : "ダイス"),
                    text: describeDice(req, resp, gs.unluckyPhase), item: tr?.item?.name || null, given: !!(tr?.item && req.table?.give),
                  }].slice(-3));
                }
                upd(p => respondDice(p, req.id, me.uid, res, false, iid));
              })} style={btnFull(C.goldBg, C.goldDim, C.gold, { fontSize: 12 })}>🎲 {req.table ? "表を振る" : "ダイスを振る"}</button>
            ) : (
              <>
                {j && (
                  <div style={{ textAlign: "center", fontSize: 12, marginBottom: 6, color: j.isFumble ? C.red : j.success ? C.green : C.textDim }}>
                    {j.isFumble ? "ファンブル" : j.success ? "成功" : "失敗"}{j.isSpecial ? "（スペシャル）" : ""}
                  </div>
                )}
                {selfCheers.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                    {selfCheers.map((o, i) => (
                      <button key={i} disabled={!!rolling} onClick={() => animateThen(key, o.diceN, res => upd(p => addCheerDice(p, req.id, me.uid, me.uid, o.bondName, res, o.fragile)))} style={cheerBtn(o)}>💪 {cheerLabel(o.cheerer, o.bondName)}で応援</button>
                    ))}
                  </div>
                )}
                {helpers.length > 0 && (
                  <div style={{ fontSize: 8, color: C.textFaint, marginBottom: 6 }}>応援できる人: {[...new Set(helpers.map(o => o.cheerer.charName))].join("・")}（各自の画面から応援できます）</div>
                )}
                <button onClick={() => upd(p => confirmDice(p, req.id, me.uid))} style={btnFull(C.greenBg, C.greenBorder, C.green, { fontSize: 11 })}>この結果で確定する</button>
              </>
            )}
          </div>
        );
      })}
      {cheerables.map(({ req, judge, opts }) => {
        const r = req.responses[judge.uid];
        const key = `${req.id}:${judge.uid}`;
        const j = evalJudgment(r.dice, req.dice.target, gs.unluckyPhase, isFragileResp(r));
        return (
          <div key={key} style={card(C.blue)}>
            <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, marginBottom: 3 }}>応援できる判定</div>
            <div style={{ fontSize: 11, color: C.text, marginBottom: 4 }}>{judge.charName} の{req.title ? `「${req.title}」` : "判定"}（目標値 {req.dice.target}）: <span style={{ color: C.gold }}>{r.dice.join(",")}</span> → <span style={{ color: j.isFumble ? C.red : j.success ? C.green : C.textDim }}>{j.isFumble ? "ファンブル" : j.success ? "成功" : "失敗"}</span></div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {opts.map((o, i) => (
                <button key={i} disabled={!!rolling} onClick={() => animateThen(key, o.diceN, res => upd(p => addCheerDice(p, req.id, judge.uid, me.uid, o.bondName, res, o.fragile)))} style={cheerBtn(o)}>{o.fragile ? "🩸" : "💪"} {cheerLabel(o.cheerer, o.bondName)}で応援（+{o.diceN}D{o.fragile ? "・失敗でファンブル" : ""}）</button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── PC カードの GM 編集（追加分） ─────────────────────────────────
// 変調の付与・絆の追加/削除/応援欄・強制移動・行動済み切替・能力使用回数リセット・リソース最大値
const MAX_KEYS = ["やる気", "残り人数", "スペルカード", "グレイズ", "霊力"];

export function GmPcEditor({ pc, gs, upd, SPOTS, getSpot }) {
  const [bondInput, setBondInput] = useState("");
  const [spot, setSpot] = useState("");
  const bonds = pc.bonds || [];
  const others = (gs.pcs || []).filter(x => x.uid !== pc.uid);
  const acted = (gs.actedPcs || []).includes(pc.uid);
  const label = { fontSize: 8, color: C.textFaint, marginBottom: 3, marginTop: 6 };

  const addBond = (b) => { const v = (b || "").trim(); if (!v) return; setBondInput(""); upd(p => gmAddBond(p, pc.uid, v)); };

  return (
    <div data-touch-zoom style={{ marginBottom: 10, padding: 6, border: `1px dashed ${C.redBorder}`, borderRadius: 4 }}>
      <div style={{ fontSize: 9, color: C.red, letterSpacing: 1 }}>GM編集（状態）</div>

      <div style={label}>変調を付与</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
        {BAD_STATUS_NAMES.map(n => {
          const has = (pc.badStatus || []).includes(n);
          return <button key={n} disabled={has} onClick={() => upd(p => gmAddBadStatus(p, pc.uid, n))} style={{ ...tiny(has ? C.textFaint : C.red), opacity: has ? 0.5 : 1 }}>{n}</button>;
        })}
      </div>

      <div style={label}>絆（クリックで応援欄の未使用□／使用済み■を切替）</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 4 }}>
        {bonds.length === 0 && <span style={{ fontSize: 9, color: "#2a3545" }}>なし</span>}
        {bonds.map(b => {
          const used = !!pc.bondUsed?.[b];
          return (
            <span key={b} style={{ display: "inline-flex", alignItems: "center", gap: 3, ...chip(!used), borderRadius: 3 }}>
              <span onClick={() => upd(p => gmToggleBondUsed(p, pc.uid, b))} title="応援欄を切替">{used ? "■" : "□"} {b}</span>
              <span onClick={() => window.confirm(`《${b}》を削除しますか？`) && upd(p => gmRemoveBond(p, pc.uid, b))} style={{ color: C.red }} title="削除">✕</span>
            </span>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginBottom: 3 }}>
        {[`${pc.charName}自身への絆`, ...others.map(o => `${o.charName}への絆`)].filter(b => !bonds.includes(b)).map(b => (
          <button key={b} onClick={() => addBond(b)} style={tiny(C.blue)}>＋{b}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 3 }}>
        <input value={bondInput} onChange={e => setBondInput(e.target.value)} onKeyDown={e => e.key === "Enter" && addBond(bondInput)} placeholder="任意の絆（例: 霊夢からの絆）" style={{ ...iStyle, fontSize: 9, padding: "3px 6px" }} />
        <button onClick={() => addBond(bondInput)} style={tiny(C.blue)}>追加</button>
      </div>

      <div style={label}>強制移動（現在: {getSpot?.(pc.currentSpot)?.name || pc.currentSpot || "なし"}）</div>
      <div style={{ display: "flex", gap: 3 }}>
        <select value={spot} onChange={e => setSpot(e.target.value)} style={{ ...iStyle, fontSize: 9, padding: "3px 4px" }}>
          <option value="">スポットを選択...</option>
          {(SPOTS || []).map(s => <option key={s.id} value={s.id}>[{s.roll ?? s.id}] {s.name}</option>)}
        </select>
        <button disabled={!spot} onClick={() => { const id = spot; setSpot(""); upd(p => gmMovePc(p, pc.uid, id, getSpot?.(id)?.name)); }} style={tiny(C.red)}>移動</button>
      </div>

      <div style={label}>リソースの最大値</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {MAX_KEYS.map(k => {
          const r = pc.resources?.[k];
          if (!r) return null;
          return (
            <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 9, color: C.textDim }}>
              {k}
              <button onClick={() => upd(p => gmAdjustMax(p, pc.uid, k, -1))} style={tiny()}>−</button>
              <span style={{ color: C.gold, minWidth: 14, textAlign: "center" }}>{r.max}</span>
              <button onClick={() => upd(p => gmAdjustMax(p, pc.uid, k, +1))} style={tiny()}>＋</button>
            </span>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
        <button onClick={() => upd(p => gmToggleActed(p, pc.uid))} style={tiny(acted ? C.green : C.gold)}>{acted ? "未行動に戻す" : "行動済みにする"}</button>
        <button onClick={() => window.confirm(`${pc.charName} の能力スキルの使用回数をリセットしますか？`) && upd(p => gmResetAbilityUse(p, pc.uid))} style={tiny(C.gold)}>能力の使用回数をリセット</button>
      </div>
    </div>
  );
}
