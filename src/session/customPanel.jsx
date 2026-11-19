// 異変再現などの独自要素の UI。ロジックは src/customRules.js（純関数）。
//   CustomRulesEditor … GM の「独自」タブ（定義の作成と運用：時間操作・ステータス・アイテム・表・コマ・状態・ルール掲示・タイミングのメモ）
//   CustomBoard       … 全員に見える掲示（ルール文・全体共有/戦闘中のステータス・マップの独自コマの凡例）
//   CustomPcSection   … PC カード内（PC個別ステータス・独自の状態・独自アイテム）
//   GmFieldEditor     … 弾幕ごっこ中の GM 盤面編集（弾幕・独自コマ・被弾無効・追加の回避ステップ・一時スキル）
//   PresetDefsEditor  … セッション外でプリセットの定義を編集する（src/session/presetManager.jsx から使う。運用の操作は出さない）
import { useState, useEffect, useRef } from "react";
import { db } from "../firebase";
import { ref as dbRef, get as dbGet, set as dbSet, remove as dbRemove } from "firebase/database";
import { stripUndefined } from "../gsSync";
import { downloadJson, readFileText } from "../fileTransfer";
import { IHEN_PRESETS } from "../data/ihenPresets";
import { C, iStyle } from "../styles/colors";
import { CYCLES } from "../data/gameData";
import {
  STAT_SCOPES, TABLE_DICE, getCustom, upsertDef, removeDef, getStatValue, setStat, adjustStat,
  giveItem, removeItem, toggleItemUsed, transferItem, parseTableRows, rowsToText, tableDiceCount,
  tableValue, lookupTable, logTableRoll, itemByName, placeTokens, removeToken, clearTokens,
  tokenCandidates, toggleState, setClock, repeatCycle, setLimit, parseLimit, postRule, pcCustom,
  DEF_KINDS, normalizePreset, presetSummary, appliedPresets, presetFromGs, applyPreset, unapplyPreset,
  REMINDER_TIMINGS, isBattleTiming, presetToFile, presetFileName, parsePresetFile,
} from "../customRules";
import {
  adjustBullets, placeBulletsByDice, clearField, moveEntity, adjustLives, cancelHit, startExtraEvade,
  getFieldTokens, placeFieldToken, takeFieldTokens, fieldTokenAlerts, grantSkill, revokeSkill, OFFICIAL_DS_NAMES,
} from "../gmBattle";

const newId = (pre) => `${pre}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const d6 = () => Math.floor(Math.random() * 6) + 1;

const box = { marginBottom: 8, padding: 8, background: "rgba(255,255,255,0.02)", border: `1px solid ${C.border}`, borderRadius: 4 };
const tiny = (color = C.textDim) => ({ padding: "2px 6px", fontSize: 9, cursor: "pointer", borderRadius: 3, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, color });
const inp = { ...iStyle, fontSize: 10, padding: "3px 6px" };
const num = { ...inp, width: 42, padding: "3px 4px" };
const sel = { ...inp, width: "auto" };
const label = { fontSize: 8, color: C.textFaint, marginBottom: 3, marginTop: 6 };
const empty = <div style={{ fontSize: 9, color: "#2a3545" }}>なし</div>;
const row = { display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap", marginBottom: 4, fontSize: 9, color: C.textDim };

function Fold({ title, count, children, open: init = false }) {
  const [open, setOpen] = useState(init);
  return (
    <div style={box}>
      <div onClick={() => setOpen(v => !v)} style={{ fontSize: 10, color: C.gold, cursor: "pointer", userSelect: "none" }}>
        {open ? "▼" : "▶"} {title}{count != null ? `（${count}）` : ""}
      </div>
      {open && <div style={{ marginTop: 6 }}>{children}</div>}
    </div>
  );
}

// 値の ± 表示（GM のみ操作可）
function StatValue({ def, value, canEdit, onAdjust, onSet }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, color: C.textDim }}>
      【{def.name}】
      {canEdit && <button onClick={() => onAdjust(-1)} style={tiny()}>−</button>}
      {editing
        ? <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => setEditing(false)}
            onKeyDown={e => { if (e.key === "Enter") { setEditing(false); onSet(parseInt(draft) || 0); } if (e.key === "Escape") setEditing(false); }}
            style={{ ...num, width: 36 }} />
        : <span onClick={() => { if (canEdit) { setDraft(String(value)); setEditing(true); } }} title={canEdit ? "クリックで直接入力" : undefined}
            style={{ color: C.gold, minWidth: 16, textAlign: "center", fontWeight: "bold", cursor: canEdit ? "text" : "default" }}>{value}</span>}
      {def.max != null && def.max !== "" && <span style={{ fontSize: 8, color: C.textFaint }}>/{def.max}</span>}
      {canEdit && <button onClick={() => onAdjust(+1)} style={tiny()}>＋</button>}
    </span>
  );
}

// ─── 全員に見える掲示 ─────────────────────────────────────────────
export function CustomBoard({ gs, upd, isGm, getSpot }) {
  const c = getCustom(gs);
  const [openRule, setOpenRule] = useState(null);
  const shared = c.stats.filter(s => s.scope === "global" || (s.scope === "battle" && gs.battle?.active));
  // マップの独自コマの凡例（地図上のコマはホバーでしか名前が出ず、スマホでは分からないため）
  const placed = c.tokens.map(k => {
    const spots = c.mapTokens.filter(t => t.kind === k.id).map(t => getSpot?.(t.spot)?.name || t.spot);
    return { k, spots };
  }).filter(x => x.spots.length > 0);
  if (!c.rules.length && !shared.length && !placed.length) return null;
  return (
    <div style={{ ...box, borderColor: `${C.sakura}55` }}>
      <div style={{ fontSize: 9, color: C.sakura, letterSpacing: 2, marginBottom: 4 }}>◆ 独自ルール</div>
      {c.rules.map(r => (
        <div key={r.id} style={{ marginBottom: 4 }}>
          <div onClick={() => setOpenRule(openRule === r.id ? null : r.id)} style={{ fontSize: 10, color: C.text, cursor: "pointer" }}>
            📜 {r.title} <span style={{ fontSize: 8, color: C.textFaint }}>{openRule === r.id ? "▲" : "▼"}</span>
          </div>
          {openRule === r.id && <div style={{ fontSize: 9, color: C.textDim, whiteSpace: "pre-wrap", lineHeight: 1.6, padding: "4px 6px", marginTop: 2, borderLeft: `2px solid ${C.sakura}55` }}>{r.text || "（本文なし）"}</div>}
        </div>
      ))}
      {shared.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
          {shared.map(s => (
            <StatValue key={s.id} def={s} value={getStatValue(gs, s)} canEdit={isGm}
              onAdjust={d => upd(p => adjustStat(p, s.id, d))} onSet={v => upd(p => setStat(p, s.id, v))} />
          ))}
        </div>
      )}
      {placed.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 8, color: C.textFaint, marginBottom: 2 }}>マップの独自コマ</div>
          {placed.map(({ k, spots }) => (
            <div key={k.id} style={{ display: "flex", gap: 5, alignItems: "baseline", fontSize: 9, color: C.textDim, lineHeight: 1.6 }}>
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: k.color || C.sakura, flexShrink: 0, transform: "translateY(1px)" }} />
              <span style={{ color: C.text, flexShrink: 0 }}>{k.name}（{spots.length}）</span>
              <span>{[...new Set(spots)].join("・")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── PC カード内 ──────────────────────────────────────────────────
export function CustomPcSection({ pc, gs, upd, isGm, myUid }) {
  const c = getCustom(gs);
  const pcc = pcCustom(pc);
  const [passing, setPassing] = useState(null); // 受け渡し中の iid
  const pcStats = c.stats.filter(s => s.scope === "pc");
  const isOwner = !!myUid && myUid === pc.uid;
  const canItem = isGm || isOwner;
  if (!pcStats.length && !pcc.states.length && !pcc.items.length && !(isGm && c.states.length)) return null;
  const head = { fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginBottom: 6 };
  // 受け渡し先：GM は全員、本人は同じスポットの PC
  const passTargets = (gs.pcs || []).filter(x => x.uid !== pc.uid && (isGm || x.currentSpot === pc.currentSpot));

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={head}>独自要素</div>
      {pcStats.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
          {pcStats.map(s => (
            <StatValue key={s.id} def={s} value={getStatValue(gs, s, pc.uid)} canEdit={isGm}
              onAdjust={d => upd(p => adjustStat(p, s.id, d, pc.uid))} onSet={v => upd(p => setStat(p, s.id, v, pc.uid))} />
          ))}
        </div>
      )}

      {(pcc.states.length > 0 || (isGm && c.states.length > 0)) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
          {c.states.filter(s => isGm || pcc.states.includes(s.id)).map(s => {
            const on = pcc.states.includes(s.id);
            const col = s.color || C.sakura;
            return (
              <span key={s.id} title={s.desc || ""} onClick={isGm ? () => upd(p => toggleState(p, pc.uid, s.id)) : undefined}
                style={{ padding: "2px 8px", fontSize: 10, borderRadius: 4, cursor: isGm ? "pointer" : "default",
                  background: on ? `${col}26` : "transparent", border: `1px ${on ? "solid" : "dashed"} ${on ? col : C.border}`, color: on ? col : C.textFaint }}>
                《{s.name}》{isGm && <span style={{ fontSize: 8, marginLeft: 3 }}>{on ? "解除" : "付与"}</span>}
              </span>
            );
          })}
        </div>
      )}

      {pcc.items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {pcc.items.map(it => {
            const def = c.items.find(d => d.id === it.def);
            const cat = c.cats.find(x => x.id === def?.cat);
            return (
              <div key={it.iid} style={{ padding: "4px 6px", background: "rgba(212,168,56,0.06)", border: `1px solid ${C.goldDim}40`, borderRadius: 3, opacity: it.used ? 0.55 : 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, color: C.gold }}>{def?.name || "？"}</span>
                  {cat && <span style={{ fontSize: 8, color: C.textFaint }}>［{cat.name}］</span>}
                  {it.used && <span style={{ fontSize: 8, color: C.red }}>使用済</span>}
                  {canItem && (
                    <span style={{ marginLeft: "auto", display: "inline-flex", gap: 3 }}>
                      <button onClick={() => upd(p => removeItem(p, pc.uid, it.iid, "use"))} style={tiny(C.blue)} title="使って失う">使う</button>
                      <button onClick={() => upd(p => toggleItemUsed(p, pc.uid, it.iid))} style={tiny(C.gold)}>{it.used ? "未使用に" : "使用済に"}</button>
                      {passTargets.length > 0 && <button onClick={() => setPassing(passing === it.iid ? null : it.iid)} style={tiny(C.blue)}>渡す</button>}
                      <button onClick={() => window.confirm(`【${def?.name}】を捨てますか？`) && upd(p => removeItem(p, pc.uid, it.iid, isGm && !isOwner ? "gm" : "discard"))} style={tiny(C.red)}>捨てる</button>
                    </span>
                  )}
                </div>
                {def?.desc && <div style={{ fontSize: 8, color: C.textDim, lineHeight: 1.4, marginTop: 2, whiteSpace: "pre-wrap" }}>{def.desc}</div>}
                {passing === it.iid && (
                  <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginTop: 4 }}>
                    {passTargets.map(t => <button key={t.uid} onClick={() => { setPassing(null); upd(p => transferItem(p, pc.uid, t.uid, it.iid, !isGm)); }} style={tiny(C.blue)}>→ {t.charName}</button>)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── GM の「独自」タブ ───────────────────────────────────────────
export function CustomRulesEditor({ gs, upd, SPOTS = [], getSpot, user }) {
  const c = getCustom(gs);
  const spotName = (id) => getSpot?.(id)?.name || id;
  return (
    <div data-touch-zoom>
      <div style={{ fontSize: 9, color: C.textDim, lineHeight: 1.6, marginBottom: 8 }}>
        異変再現やシナリオ独自のステータス・アイテム・表・コマ・状態をここで作り、セッション中に手動で運用します。
        掲示したルールと全体共有のステータスは全員の「進行」タブに表示されます。
      </div>
      <PresetSection gs={gs} upd={upd} user={user} />
      <ClockSection gs={gs} upd={upd} />
      <RuleSection c={c} upd={upd} />
      <StatSection c={c} gs={gs} upd={upd} />
      <ItemSection c={c} gs={gs} upd={upd} />
      <TableSection c={c} gs={gs} upd={upd} />
      <TokenSection c={c} gs={gs} upd={upd} SPOTS={SPOTS} spotName={spotName} />
      <StateSection c={c} gs={gs} upd={upd} />
      <ReminderSection c={c} upd={upd} />
    </div>
  );
}

// ─── プリセットの定義だけを編集する（セッション外） ─────────────────
// gs の代わりに { custom: defs, pcs: [], log: [] } のような作業用オブジェクトを渡す。
// PC への受け渡し・表を振る・コマの配置など、セッション中の運用の操作は出さない（prep）。
export function PresetDefsEditor({ gs, upd }) {
  const c = getCustom(gs);
  return (
    <div>
      <RuleSection c={c} upd={upd} />
      <StatSection c={c} gs={gs} upd={upd} prep />
      <ItemSection c={c} gs={gs} upd={upd} prep />
      <TableSection c={c} gs={gs} upd={upd} prep />
      <TokenSection c={c} gs={gs} upd={upd} SPOTS={[]} spotName={(id) => id} prep />
      <StateSection c={c} gs={gs} upd={upd} />
      <ReminderSection c={c} upd={upd} />
    </div>
  );
}

// ─── タイミングのメモ ─────────────────────────────────────────────
// 「サイクル開始時にかけらを置く」など、GM が手で行う処理を忘れないためのメモ。
// 登録したタイミングが来ると GM の画面の左下に表示される（src/session/reminders.jsx）。PL には見えない。
function ReminderSection({ c, upd }) {
  const [editId, setEditId] = useState(null);
  const [timing, setTiming] = useState("cycle_start");
  const [text, setText] = useState("");
  const [finalOnly, setFinalOnly] = useState(false);
  const reset = () => { setEditId(null); setText(""); setFinalOnly(false); };
  const save = () => {
    if (!text.trim()) return;
    const def = { id: editId || newId("rm"), timing, text: text.trim(), finalOnly: isBattleTiming(timing) && finalOnly };
    reset();
    upd(p => upsertDef(p, "reminders", def));
  };
  return (
    <Fold title="⏰ タイミングのメモ（GM用）" count={c.reminders.length}>
      <div style={{ fontSize: 8, color: C.textFaint, lineHeight: 1.6, marginBottom: 6 }}>
        登録したタイミングが来ると、GM の画面の左下にメモが出ます（PL には見えません）。処理そのものは自動では行いません。
      </div>
      {REMINDER_TIMINGS.map(t => {
        const list = c.reminders.filter(r => r.timing === t.key);
        if (!list.length) return null;
        return (
          <div key={t.key} style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 9, color: C.red, marginBottom: 2 }}>{t.label}</div>
            {list.map(r => (
              <div key={r.id} style={{ ...row, alignItems: "flex-start" }}>
                <span style={{ flex: 1, fontSize: 9, color: C.text, whiteSpace: "pre-wrap" }}>{r.finalOnly ? "［決戦のみ］" : ""}{r.text}</span>
                <button onClick={() => { setEditId(r.id); setTiming(r.timing); setText(r.text || ""); setFinalOnly(!!r.finalOnly); }} style={tiny()}>編集</button>
                <button onClick={() => window.confirm("このメモを削除しますか？") && upd(p => removeDef(p, "reminders", r.id))} style={tiny(C.red)}>✕</button>
              </div>
            ))}
          </div>
        );
      })}
      {c.reminders.length === 0 && empty}
      <div style={label}>{editId ? "編集中" : "メモを追加"}</div>
      <div style={row}>
        <select value={timing} onChange={e => setTiming(e.target.value)} style={sel}>
          {REMINDER_TIMINGS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        {isBattleTiming(timing) && (
          <label style={{ display: "flex", alignItems: "center", gap: 3, cursor: "pointer" }}>
            <input type="checkbox" checked={finalOnly} onChange={e => setFinalOnly(e.target.checked)} />決戦のときだけ
          </label>
        )}
      </div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={2} placeholder="例: 春のかけらをPC人数の半分だけランダムに置く" style={{ ...inp, resize: "vertical", marginBottom: 4 }} />
      <div style={row}>
        <button disabled={!text.trim()} onClick={save} style={tiny(C.gold)}>{editId ? "更新する" : "追加する"}</button>
        {editId && <button onClick={reset} style={tiny()}>やめる</button>}
      </div>
    </Fold>
  );
}

// ─── 異変再現プリセット ───────────────────────────────────────────
// 組み込み（公式・要約）と、GM が保存した自作（users/{uid}/ihenPresets）を適用／解除する。
// 現在の独自要素の定義をまとめて自作プリセットとして保存できる（値・配置済みのコマは含めない）。
function PresetSection({ gs, upd, user }) {
  const [saved, setSaved] = useState(null); // null=読込中 / [{ id, ...preset }]
  const [loadError, setLoadError] = useState(false);
  const [withClock, setWithClock] = useState(true);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [openDesc, setOpenDesc] = useState(null);
  const applied = appliedPresets(gs);
  const hasDefs = DEF_KINDS.some(k => getCustom(gs)[k].length > 0);

  const uid = user?.uid || null;
  const [version, setVersion] = useState(0); // 保存・削除のたびに増やして再読込
  const reload = () => setVersion(v => v + 1);
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    dbGet(dbRef(db, `users/${uid}/ihenPresets`))
      .then(snap => {
        if (!alive) return;
        const v = snap.val() || {};
        setSaved(Object.entries(v).map(([id, raw]) => ({ id, ...normalizePreset(raw) })).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
        setLoadError(false);
      })
      .catch(() => { if (alive) { setSaved([]); setLoadError(true); } });
    return () => { alive = false; };
  }, [uid, version]);

  const apply = (preset, key) => {
    const isApplied = applied.some(a => a.key === key);
    const clockNote = preset.clock && withClock ? "\n時刻とリミットも設定します（行動済み・進行中のシーンはリセット）。" : "";
    if (!window.confirm(`異変再現「${preset.name}」を${isApplied ? "再" : ""}適用しますか？${isApplied ? "\n（このプリセットの定義に置き換えます。プリセットから無くなった定義は外れ、残る定義の値は保持されます）" : ""}${clockNote}`)) return;
    // PC の人数（刻符ノルマ等の初期値）はトランザクション内の p.pcs から数える
    upd(p => applyPreset(p, preset, key, { withClock: withClock && !!preset.clock }));
  };
  const unapply = (a) => {
    if (!window.confirm(`異変再現「${a.name}」を解除しますか？\nこのプリセットで追加したステータス・アイテム（PCの所持分も）・表・コマ・状態・ルールが全て消えます。`)) return;
    upd(p => unapplyPreset(p, a.key));
  };
  const save = async () => {
    if (!user?.uid || !name.trim() || busy) return;
    setBusy(true);
    try {
      const id = newId("ip");
      const now = Date.now();
      await dbSet(dbRef(db, `users/${user.uid}/ihenPresets/${id}`), stripUndefined({ ...presetFromGs(gs, name, desc), createdAt: now, updatedAt: now }));
      setName(""); setDesc("");
      reload();
    } catch (e) {
      window.alert(`保存に失敗しました: ${e?.message || e}`);
    } finally { setBusy(false); }
  };
  // JSON ファイルを読み込んで自作プリセットとして保存（その後、一覧から適用する）
  const fileRef = useRef(null);
  const importFile = async (file) => {
    if (!file || !user?.uid) return;
    try {
      const { preset, error } = parsePresetFile(await readFileText(file));
      if (error) { window.alert(`読み込めませんでした: ${error}`); return; }
      if (!window.confirm(`プリセット「${preset.name}」（${presetSummary(preset)}）を自作プリセットとして保存しますか？`)) return;
      const now = Date.now();
      await dbSet(dbRef(db, `users/${user.uid}/ihenPresets/${newId("ip")}`), stripUndefined({ ...preset, createdAt: now, updatedAt: now }));
      reload();
    } catch (e) {
      window.alert(`読み込みに失敗しました: ${e?.message || e}`);
    }
  };
  const exportFile = (preset) => downloadJson(presetFileName(preset), presetToFile(preset));
  const del = async (sp) => {
    if (!window.confirm(`保存したプリセット「${sp.name}」を削除しますか？（このセッションに適用済みの内容は残ります）`)) return;
    try { await dbRemove(dbRef(db, `users/${user.uid}/ihenPresets/${sp.id}`)); reload(); }
    catch (e) { window.alert(`削除に失敗しました: ${e?.message || e}`); }
  };

  const presetRow = (preset, key, extra = null) => {
    const isApplied = applied.some(a => a.key === key);
    return (
      <div key={key} style={{ padding: 6, marginBottom: 4, border: `1px solid ${isApplied ? C.green : C.border}`, borderRadius: 3 }}>
        <div style={row}>
          <span onClick={() => setOpenDesc(openDesc === key ? null : key)} style={{ fontSize: 10, color: C.text, cursor: "pointer" }}>{preset.name}</span>
          {isApplied && <span style={{ fontSize: 8, color: C.green }}>適用中</span>}
          <span style={{ fontSize: 8, color: C.textFaint }}>{presetSummary(preset)}{preset.clock ? "・時刻" : ""}</span>
          <span style={{ marginLeft: "auto", display: "inline-flex", gap: 3 }}>
            <button onClick={() => apply(preset, key)} style={tiny(C.gold)}>{isApplied ? "再適用" : "適用"}</button>
            <button onClick={() => exportFile(preset)} title="JSON ファイルとして書き出す" style={tiny()}>JSON</button>
            {extra}
          </span>
        </div>
        {openDesc === key && preset.desc && <div style={{ fontSize: 9, color: C.textDim, lineHeight: 1.5 }}>{preset.desc}</div>}
      </div>
    );
  };

  return (
    <Fold title="📦 異変再現プリセット" count={applied.length || null} open>
      <div style={{ fontSize: 9, color: C.textDim, lineHeight: 1.6, marginBottom: 6 }}>
        異変再現は導入フェイズの終了時に発生します。適用すると、ステータス・アイテム・表・コマ・状態・ルール文がまとめて追加されます（処理は手動）。
      </div>

      {applied.length > 0 && (
        <>
          <div style={label}>適用中</div>
          {applied.map(a => (
            <div key={a.key} style={row}>
              <span style={{ fontSize: 10, color: C.green }}>✔ {a.name}</span>
              <button onClick={() => unapply(a)} style={{ ...tiny(C.red), marginLeft: "auto" }}>解除</button>
            </div>
          ))}
        </>
      )}

      <div style={label}>公式（ルール文は要約。細部は書籍で確認してください）</div>
      {IHEN_PRESETS.map(pr => presetRow(pr, pr.key))}
      <label style={{ fontSize: 9, color: C.textDim, display: "inline-flex", alignItems: "center", gap: 3, marginBottom: 4 }}>
        <input type="checkbox" checked={withClock} onChange={e => setWithClock(e.target.checked)} />
        時刻・リミットの指定があるプリセットは時刻も設定する（永夜異変など）
      </label>

      <div style={label}>保存した自作プリセット</div>
      {!uid && <div style={{ fontSize: 9, color: C.textFaint }}>ログイン中のみ利用できます</div>}
      {uid && saved === null && <div style={{ fontSize: 9, color: C.textFaint }}>読み込み中…</div>}
      {loadError && <div style={{ fontSize: 9, color: C.red }}>読み込みに失敗しました</div>}
      {saved && saved.length === 0 && !loadError && empty}
      {(saved || []).map(sp => presetRow(sp, `u${sp.id}`, <button onClick={() => del(sp)} style={tiny(C.red)}>削除</button>))}
      {uid && (
        <div style={row}>
          <button onClick={() => fileRef.current?.click()} style={tiny(C.blue)}>📥 JSON を読み込んで保存</button>
          <span style={{ fontSize: 8, color: C.textFaint }}>事前の作成・編集はプロフィールの「異変再現」タブで</span>
          <input ref={fileRef} type="file" accept=".json,application/json" data-testid="preset-file" style={{ display: "none" }}
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; importFile(f); }} />
        </div>
      )}

      <div style={label}>現在の独自要素をプリセットとして保存（値・配置済みのコマは含めない）</div>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="プリセット名（例: 自作異変「〇〇」）" style={{ ...inp, marginBottom: 4 }} />
      <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="説明（任意）" style={{ ...inp, marginBottom: 4 }} />
      <button disabled={!name.trim() || !hasDefs || busy || !user?.uid} onClick={save} style={tiny(C.gold)}>{busy ? "保存中…" : "保存する"}</button>
      {!hasDefs && <span style={{ fontSize: 8, color: C.textFaint, marginLeft: 6 }}>保存できる定義がありません</span>}
    </Fold>
  );
}

function ClockSection({ gs, upd }) {
  const lim = parseLimit(gs.limit);
  const [day, setDay] = useState(gs.day || 1);
  const [ci, setCi] = useState(gs.cycleIdx || 0);
  const [lDay, setLDay] = useState(lim.day);
  const [lCi, setLCi] = useState(lim.cycleIdx);
  const cycleSel = (v, set) => <select value={v} onChange={e => set(parseInt(e.target.value))} style={sel}>{CYCLES.map((n, i) => <option key={n} value={i}>{n}</option>)}</select>;
  return (
    <Fold title="⏳ 時間操作">
      <div style={label}>現在: {gs.day || 1}日目・{CYCLES[gs.cycleIdx || 0]} ／ リミット: {gs.limit || "3日目の夜"}</div>
      <div style={row}>
        <input type="number" min={1} max={9} value={day} onChange={e => setDay(e.target.value)} style={num} />日目
        {cycleSel(ci, setCi)}
        <button onClick={() => window.confirm(`時刻を ${day}日目・${CYCLES[ci]} に変更しますか？（行動済み・進行中のシーンはリセット）`) && upd(p => setClock(p, day, ci))} style={tiny(C.red)}>時刻を設定</button>
      </div>
      <div style={row}>
        <button onClick={() => window.confirm("現在のサイクルをもう一度行いますか？（時刻は進まず、帰還・やる気減少も行いません）") && upd(repeatCycle)} style={tiny(C.red)}>このサイクルをもう一度行う</button>
      </div>
      <div style={row}>
        リミット
        <input type="number" min={1} max={9} value={lDay} onChange={e => setLDay(e.target.value)} style={num} />日目の
        {cycleSel(lCi, setLCi)}
        <button onClick={() => upd(p => setLimit(p, lDay, lCi))} style={tiny(C.red)}>リミットを設定</button>
      </div>
    </Fold>
  );
}

function RuleSection({ c, upd }) {
  const [editId, setEditId] = useState(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const reset = () => { setEditId(null); setTitle(""); setText(""); };
  const save = () => {
    if (!title.trim()) return;
    const id = editId || newId("rl");
    const rule = { id, title, text };
    reset();
    upd(p => postRule(p, rule));
  };
  return (
    <Fold title="📜 ルールの掲示" count={c.rules.length}>
      {c.rules.map(r => (
        <div key={r.id} style={row}>
          <span style={{ fontSize: 10, color: C.text, flex: 1 }}>{r.title}</span>
          <button onClick={() => { setEditId(r.id); setTitle(r.title); setText(r.text || ""); }} style={tiny()}>編集</button>
          <button onClick={() => window.confirm(`「${r.title}」の掲示を外しますか？`) && upd(p => removeDef(p, "rules", r.id))} style={tiny(C.red)}>✕</button>
        </div>
      ))}
      <div style={label}>{editId ? "編集中" : "新しく掲示する"}</div>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="見出し（例: 異変再現「春雪異変」）" style={{ ...inp, marginBottom: 4 }} />
      <textarea value={text} onChange={e => setText(e.target.value)} rows={5} placeholder="ルール本文（全員が読めるように掲示されます）" style={{ ...inp, resize: "vertical", marginBottom: 4 }} />
      <div style={row}>
        <button disabled={!title.trim()} onClick={save} style={tiny(C.gold)}>{editId ? "更新する" : "掲示する"}</button>
        {editId && <button onClick={reset} style={tiny()}>やめる</button>}
      </div>
    </Fold>
  );
}

function StatSection({ c, gs, upd, prep = false }) {
  const [editId, setEditId] = useState(null);
  const [name, setName] = useState("");
  const [scope, setScope] = useState("pc");
  const [min, setMin] = useState("0");
  const [max, setMax] = useState("");
  const [init, setInit] = useState("0");
  const [byPcCount, setByPcCount] = useState(false);
  const toNum = (v) => (v === "" || Number.isNaN(parseInt(v)) ? null : parseInt(v));
  const reset = () => { setEditId(null); setName(""); setScope("pc"); setMin("0"); setMax(""); setInit("0"); setByPcCount(false); };
  const startEdit = (s) => {
    setEditId(s.id); setName(s.name); setScope(s.scope || "pc");
    setMin(s.min == null ? "" : String(s.min)); setMax(s.max == null ? "" : String(s.max)); setInit(String(s.init ?? 0));
    setByPcCount(!!s.initFromPcCount);
  };
  const add = () => {
    if (!name.trim()) return;
    const def = { id: editId || newId("st"), name: name.trim(), scope, min: toNum(min), max: toNum(max), init: parseInt(init) || 0 };
    // 初期値を PC の人数にする（全体共有のみ。プリセット適用時に使われる）
    if (prep) def.initFromPcCount = scope === "global" && byPcCount;
    const verb = editId ? "を更新" : "を追加";
    reset();
    upd(p => ({ ...upsertDef(p, "stats", def), log: [`✨ GM: 独自ステータス【${def.name}】（${STAT_SCOPES[def.scope]}）${verb}`, ...(p.log || [])] }));
  };
  return (
    <Fold title="✨ 独自ステータス" count={c.stats.length}>
      {c.stats.length === 0 && empty}
      {c.stats.map(s => (
        <div key={s.id} style={row}>
          <span style={{ fontSize: 10, color: C.text }}>【{s.name}】</span>
          <span style={{ fontSize: 8, color: C.textFaint }}>{STAT_SCOPES[s.scope]}・{s.min ?? "−∞"}〜{s.max ?? "∞"}・初期{s.initFromPcCount ? "PC人数" : (s.init ?? 0)}</span>
          {s.scope === "pc" && (gs.pcs || []).length > 0 && (
            <button onClick={() => window.confirm(`全PCの【${s.name}】を初期値 ${s.init ?? 0} に戻しますか？`) && upd(p => (p.pcs || []).reduce((acc, pc) => setStat(acc, s.id, s.init ?? 0, pc.uid), p))} style={tiny()}>全PCを初期値に</button>
          )}
          <button onClick={() => startEdit(s)} style={{ ...tiny(), marginLeft: "auto" }}>編集</button>
          <button onClick={() => window.confirm(`【${s.name}】を削除しますか？（値も消えます）`) && upd(p => removeDef(p, "stats", s.id))} style={tiny(C.red)}>✕</button>
        </div>
      ))}
      <div style={label}>{editId ? "編集中" : prep ? "追加" : "追加（PC個別の値は各PCカード、全体共有・戦闘中の値は「進行」タブ／戦闘画面の掲示で増減）"}</div>
      <div style={row}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="名前（例: 春度）" style={{ ...inp, flex: 1, minWidth: 90 }} />
        <select value={scope} onChange={e => setScope(e.target.value)} style={sel}>{Object.entries(STAT_SCOPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
      <div style={row}>
        最小<input value={min} onChange={e => setMin(e.target.value)} style={num} />
        最大<input value={max} onChange={e => setMax(e.target.value)} placeholder="なし" style={num} />
        初期<input value={init} onChange={e => setInit(e.target.value)} disabled={prep && scope === "global" && byPcCount} style={num} />
        <button disabled={!name.trim()} onClick={add} style={tiny(C.gold)}>{editId ? "更新" : "追加"}</button>
        {editId && <button onClick={reset} style={tiny()}>やめる</button>}
      </div>
      {prep && scope === "global" && (
        <label style={{ fontSize: 9, color: C.textDim, display: "inline-flex", alignItems: "center", gap: 3 }}>
          <input type="checkbox" checked={byPcCount} onChange={e => setByPcCount(e.target.checked)} />初期値をPCの人数にする（適用時に設定）
        </label>
      )}
    </Fold>
  );
}

function ItemSection({ c, gs, upd, prep = false }) {
  const pcs = gs.pcs || [];
  const [editId, setEditId] = useState(null);
  const [catName, setCatName] = useState("");
  const [catCap, setCatCap] = useState("3");
  const [name, setName] = useState("");
  const [cat, setCat] = useState("");
  const [desc, setDesc] = useState("");
  const [bulk, setBulk] = useState("");
  const [giveDef, setGiveDef] = useState("");
  const [giveTo, setGiveTo] = useState("");

  const addCat = () => {
    if (!catName.trim()) return;
    const def = { id: newId("ct"), name: catName.trim(), cap: catCap === "" ? null : parseInt(catCap) || null };
    setCatName("");
    upd(p => upsertDef(p, "cats", def));
  };
  const addItem = () => {
    if (!name.trim()) return;
    const def = { id: editId || newId("it"), name: name.trim(), cat: cat || null, desc: desc.trim() };
    setEditId(null); setName(""); setDesc("");
    upd(p => upsertDef(p, "items", def));
  };
  const startEdit = (it) => { setEditId(it.id); setName(it.name); setCat(it.cat || ""); setDesc(it.desc || ""); };
  const cancelEdit = () => { setEditId(null); setName(""); setDesc(""); };
  // 「名前：説明」を1行ずつまとめて登録（アビリティカード21種などの一括入力）
  const addBulk = () => {
    const defs = bulk.split("\n").map(l => l.trim()).filter(Boolean).map((l, i) => {
      const m = l.match(/^([^:：]+)[:：]\s*(.*)$/);
      return { id: newId(`it${i}_`), name: (m ? m[1] : l).trim(), desc: m ? m[2].trim() : "", cat: cat || null };
    });
    if (!defs.length) return;
    setBulk("");
    upd(p => defs.reduce((acc, d) => upsertDef(acc, "items", d), p));
  };
  const give = () => {
    if (!giveDef || !giveTo) return;
    const iid = newId("ii");
    upd(p => giveItem(p, giveTo, giveDef, iid));
  };

  return (
    <Fold title="💰 独自アイテム" count={c.items.length}>
      <div style={label}>分類（所持上限）</div>
      {c.cats.map(k => (
        <div key={k.id} style={row}>
          <span style={{ fontSize: 10, color: C.text }}>［{k.name}］</span>
          <span style={{ fontSize: 8, color: C.textFaint }}>上限 {k.cap || "なし"}</span>
          <button onClick={() => window.confirm(`分類「${k.name}」を削除しますか？（アイテムは分類なしになります）`) && upd(p => removeDef(p, "cats", k.id))} style={{ ...tiny(C.red), marginLeft: "auto" }}>✕</button>
        </div>
      ))}
      <div style={row}>
        <input value={catName} onChange={e => setCatName(e.target.value)} placeholder="分類名（例: ベントラー）" style={{ ...inp, flex: 1, minWidth: 90 }} />
        上限<input value={catCap} onChange={e => setCatCap(e.target.value)} placeholder="なし" style={num} />
        <button disabled={!catName.trim()} onClick={addCat} style={tiny(C.gold)}>追加</button>
      </div>

      <div style={label}>アイテム</div>
      {c.items.length === 0 && empty}
      {c.items.map(it => (
        <div key={it.id} style={row}>
          <span style={{ fontSize: 10, color: C.gold }}>{it.name}</span>
          {it.cat && <span style={{ fontSize: 8, color: C.textFaint }}>［{c.cats.find(k => k.id === it.cat)?.name}］</span>}
          {it.desc && <span style={{ fontSize: 8, color: C.textDim, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={it.desc}>{it.desc}</span>}
          <button onClick={() => startEdit(it)} style={{ ...tiny(), marginLeft: "auto" }}>編集</button>
          <button onClick={() => window.confirm(`【${it.name}】を削除しますか？（PCの所持分も消えます）`) && upd(p => removeDef(p, "items", it.id))} style={tiny(C.red)}>✕</button>
        </div>
      ))}
      <div style={row}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="アイテム名" style={{ ...inp, flex: 1, minWidth: 90 }} />
        <select value={cat} onChange={e => setCat(e.target.value)} style={sel}>
          <option value="">分類なし</option>
          {c.cats.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
      </div>
      <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} placeholder="効果の説明（任意）" style={{ ...inp, resize: "vertical", marginBottom: 4 }} />
      <div style={row}>
        <button disabled={!name.trim()} onClick={addItem} style={tiny(C.gold)}>{editId ? "アイテムを更新" : "アイテムを追加"}</button>
        {editId && <button onClick={cancelEdit} style={tiny()}>やめる</button>}
      </div>
      <div style={label}>一括追加（1行に「名前：説明」。分類は上の選択を使用）</div>
      <textarea value={bulk} onChange={e => setBulk(e.target.value)} rows={3} placeholder={"不死鳥の尾：装備…\n大天狗の麦飯：即効…"} style={{ ...inp, resize: "vertical", marginBottom: 4 }} />
      <button disabled={!bulk.trim()} onClick={addBulk} style={tiny(C.gold)}>まとめて追加</button>

      {!prep && (
        <>
          <div style={label}>PCに渡す</div>
          <div style={row}>
            <select value={giveDef} onChange={e => setGiveDef(e.target.value)} style={sel}>
              <option value="">アイテム...</option>
              {c.items.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
            </select>
            <select value={giveTo} onChange={e => setGiveTo(e.target.value)} style={sel}>
              <option value="">PC...</option>
              {pcs.map(pc => <option key={pc.uid} value={pc.uid}>{pc.charName}</option>)}
            </select>
            <button disabled={!giveDef || !giveTo} onClick={give} style={tiny(C.gold)}>渡す</button>
          </div>
        </>
      )}
    </Fold>
  );
}

function TableSection({ c, gs, upd, prep = false }) {
  const pcs = gs.pcs || [];
  const [editId, setEditId] = useState(null);
  const [name, setName] = useState("");
  const [dice, setDice] = useState("d6");
  const [rowsText, setRowsText] = useState("");
  const [rollId, setRollId] = useState("");
  const [times, setTimes] = useState(1);
  const [results, setResults] = useState(null); // { tableId, list: [{ key, rolled, value, text }] }
  const [giveTo, setGiveTo] = useState({});      // { [resultKey]: uid }
  const [given, setGiven] = useState({});        // { [resultKey]: 渡したアイテムの iid }（実際に所持品に入ったかは gs で確かめる）

  const reset = () => { setEditId(null); setName(""); setDice("d6"); setRowsText(""); };
  const parsed = parseTableRows(rowsText);
  const save = () => {
    if (!name.trim() || !parsed.length) return;
    const def = { id: editId || newId("tb"), name: name.trim(), dice, rows: parsed };
    reset();
    upd(p => upsertDef(p, "tables", def));
  };
  const roll = () => {
    const t = c.tables.find(x => x.id === rollId);
    if (!t) return;
    const n = Math.max(1, Math.min(12, parseInt(times) || 1));
    const rolls = Array.from({ length: n }, () => Array.from({ length: tableDiceCount(t.dice) }, d6));
    const stamp = Date.now().toString(36);
    const list = rolls.map((r, i) => { const value = tableValue(t.dice, r); return { key: `${stamp}_${i}`, rolled: r, value, text: lookupTable(t, value)?.text || "（該当なし）" }; });
    setResults({ tableId: t.id, list }); setGiveTo({}); setGiven({});
    upd(p => logTableRoll(p, t.id, rolls, t));
  };

  return (
    <Fold title="🎲 カスタム表" count={c.tables.length}>
      {c.tables.map(t => (
        <div key={t.id} style={row}>
          <span style={{ fontSize: 10, color: C.text }}>{t.name}</span>
          <span style={{ fontSize: 8, color: C.textFaint }}>{TABLE_DICE[t.dice]}・{t.rows.length}行</span>
          <button onClick={() => { setEditId(t.id); setName(t.name); setDice(t.dice); setRowsText(rowsToText(t.rows)); }} style={{ ...tiny(), marginLeft: "auto" }}>編集</button>
          <button onClick={() => window.confirm(`表「${t.name}」を削除しますか？`) && upd(p => removeDef(p, "tables", t.id))} style={tiny(C.red)}>✕</button>
        </div>
      ))}

      {!prep && c.tables.length > 0 && (
        <>
          <div style={label}>表を振る（結果がアイテム名と一致すれば、そのままPCに渡せます）</div>
          <div style={row}>
            <select value={rollId} onChange={e => setRollId(e.target.value)} style={sel}>
              <option value="">表を選択...</option>
              {c.tables.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            ×<input type="number" min={1} max={12} value={times} onChange={e => setTimes(e.target.value)} style={{ ...num, width: 36 }} />回
            <button disabled={!rollId} onClick={roll} style={tiny(C.blue)}>振る</button>
          </div>
          {results && (
            <div style={{ padding: 6, background: "rgba(112,144,224,0.06)", border: `1px solid ${C.blueBorder}`, borderRadius: 3, marginBottom: 4 }}>
              {results.list.map(r => {
                const item = itemByName(gs, r.text);
                return (
                  <div key={r.key} style={{ ...row, marginBottom: 2 }}>
                    <span style={{ fontSize: 9, color: C.textFaint }}>[{r.rolled.join(",")}] {r.value}</span>
                    <span style={{ fontSize: 10, color: C.text }}>{r.text}</span>
                    {item && (given[r.key] && (gs.pcs || []).some(pc => pcCustom(pc).items.some(x => x.iid === given[r.key]))
                      ? <span style={{ fontSize: 8, color: C.green, marginLeft: "auto" }}>渡した</span>
                      : <span style={{ marginLeft: "auto", display: "inline-flex", gap: 3 }}>
                          <select value={giveTo[r.key] || ""} onChange={e => setGiveTo(g => ({ ...g, [r.key]: e.target.value }))} style={{ ...sel, fontSize: 9, padding: "2px 4px" }}>
                            <option value="">PC...</option>
                            {pcs.map(pc => <option key={pc.uid} value={pc.uid}>{pc.charName}</option>)}
                          </select>
                          <button disabled={!giveTo[r.key]} onClick={() => { const to = giveTo[r.key]; const iid = newId("ii"); setGiven(g => ({ ...g, [r.key]: iid })); upd(p => giveItem(p, to, item.id, iid, `表「${c.tables.find(t => t.id === results.tableId)?.name || ""}」`)); }} style={tiny(C.gold)}>渡す</button>
                        </span>)}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <div style={label}>{editId ? "編集中" : "表を作る"}（1行に「出目 結果」。範囲は 1-2 / 11-16 のように）</div>
      <div style={row}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="表の名前（例: ベントラー決定表）" style={{ ...inp, flex: 1, minWidth: 90 }} />
        <select value={dice} onChange={e => setDice(e.target.value)} style={sel}>{Object.entries(TABLE_DICE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
      <textarea value={rowsText} onChange={e => setRowsText(e.target.value)} rows={4} placeholder={"1-2 ベントラー赤\n3-4 ベントラー青\n5-6 ベントラー緑"} style={{ ...inp, resize: "vertical", marginBottom: 4 }} />
      <div style={row}>
        <span style={{ fontSize: 8, color: parsed.length ? C.green : C.textFaint }}>{parsed.length}行を認識</span>
        <button disabled={!name.trim() || !parsed.length} onClick={save} style={tiny(C.gold)}>{editId ? "更新する" : "表を追加"}</button>
        {editId && <button onClick={reset} style={tiny()}>やめる</button>}
      </div>
    </Fold>
  );
}

const TOKEN_COLORS = ["#e8a0b8", "#7090e0", "#4caf50", "#d4a838", "#d05040", "#c090e0", "#e0e0e0"];

function TokenSection({ c, gs, upd, SPOTS, spotName, prep = false }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(TOKEN_COLORS[0]);
  const [unique, setUnique] = useState(true);
  const [spot, setSpot] = useState({});   // { [kindId]: spotId }
  const [count, setCount] = useState({}); // { [kindId]: n }

  const add = () => {
    if (!name.trim()) return;
    const def = { id: newId("tk"), name: name.trim(), color, unique };
    setName("");
    upd(p => upsertDef(p, "tokens", def));
  };
  const countOf = (k) => count[k.id] ?? Math.max(1, (gs.pcs || []).length);
  const placeRandom = (k) => {
    const n = Math.max(1, Math.min(20, parseInt(countOf(k)) || 1));
    const pool = [...tokenCandidates(gs, k.id, SPOTS)];
    const picks = [];
    for (let i = 0; i < n && pool.length; i++) {
      const j = Math.floor(Math.random() * pool.length);
      picks.push(pool[j].id);
      if (k.unique) pool.splice(j, 1);
    }
    if (!picks.length) return;
    const ids = picks.map((_, i) => newId(`mt${i}_`));
    upd(p => placeTokens(p, k.id, picks, ids, spotName));
  };

  return (
    <Fold title="📍 マップの独自コマ" count={prep ? c.tokens.length : c.mapTokens.length}>
      {c.tokens.length === 0 && empty}
      {c.tokens.map(k => {
        const placed = c.mapTokens.filter(t => t.kind === k.id);
        return (
          <div key={k.id} style={{ padding: 6, marginBottom: 6, border: `1px solid ${k.color}55`, borderRadius: 3 }}>
            <div style={row}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: k.color, display: "inline-block" }} />
              <span style={{ fontSize: 10, color: C.text }}>{k.name}</span>
              <span style={{ fontSize: 8, color: C.textFaint }}>{k.unique ? "1スポット1つまで" : "重ね置き可"}</span>
              <button onClick={() => window.confirm(`コマ「${k.name}」の種類を削除しますか？（置かれたコマも消えます）`) && upd(p => removeDef(p, "tokens", k.id))} style={{ ...tiny(C.red), marginLeft: "auto" }}>✕</button>
            </div>
            {!prep && <><div style={row}>
              <select value={spot[k.id] || ""} onChange={e => setSpot(s => ({ ...s, [k.id]: e.target.value }))} style={{ ...sel, maxWidth: 140 }}>
                <option value="">スポット...</option>
                {SPOTS.filter(s => s.id !== "dream").map(s => <option key={s.id} value={s.id}>[{s.roll ?? s.id}] {s.name}</option>)}
              </select>
              <button disabled={!spot[k.id]} onClick={() => { const sid = spot[k.id]; const id = newId("mt"); upd(p => placeTokens(p, k.id, [sid], [id], spotName)); }} style={tiny(C.gold)}>置く</button>
            </div>
            <div style={row}>
              ランダムに<input type="number" min={1} max={20} value={countOf(k)} onChange={e => setCount(s => ({ ...s, [k.id]: e.target.value }))} style={{ ...num, width: 36 }} />個
              <button onClick={() => placeRandom(k)} style={tiny(C.gold)}>ランダム配置</button>
              {placed.length > 0 && <button onClick={() => window.confirm(`「${k.name}」を全て取り除きますか？`) && upd(p => clearTokens(p, k.id))} style={{ ...tiny(C.red), marginLeft: "auto" }}>全て取り除く</button>}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              {placed.map(t => (
                <span key={t.id} onClick={() => upd(p => removeToken(p, t.id, spotName))} title="クリックで取り除く"
                  style={{ padding: "1px 6px", fontSize: 9, borderRadius: 8, cursor: "pointer", border: `1px solid ${k.color}`, color: k.color }}>{spotName(t.spot)} ✕</span>
              ))}
            </div></>}
          </div>
        );
      })}
      <div style={label}>コマの種類を作る（マップ上のスポットに色付きのコマで表示）</div>
      <div style={row}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="名前（例: 春のかけら）" style={{ ...inp, flex: 1, minWidth: 90 }} />
      </div>
      <div style={row}>
        {TOKEN_COLORS.map(col => <span key={col} onClick={() => setColor(col)} style={{ width: 14, height: 14, borderRadius: "50%", background: col, cursor: "pointer", outline: color === col ? `2px solid ${C.text}` : "none", outlineOffset: 1 }} />)}
        <label style={{ fontSize: 9, color: C.textDim, display: "inline-flex", alignItems: "center", gap: 2 }}>
          <input type="checkbox" checked={unique} onChange={e => setUnique(e.target.checked)} />1スポット1つまで
        </label>
        <button disabled={!name.trim()} onClick={add} style={tiny(C.gold)}>追加</button>
      </div>
    </Fold>
  );
}

function StateSection({ c, gs, upd }) {
  const [editId, setEditId] = useState(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [color, setColor] = useState(TOKEN_COLORS[0]);
  const reset = () => { setEditId(null); setName(""); setDesc(""); };
  const add = () => {
    if (!name.trim()) return;
    const def = { id: editId || newId("ss"), name: name.trim(), desc: desc.trim(), color };
    reset();
    upd(p => upsertDef(p, "states", def));
  };
  return (
    <Fold title="★ 独自の状態" count={c.states.length}>
      {c.states.length === 0 && empty}
      {c.states.map(s => (
        <div key={s.id} style={{ marginBottom: 6 }}>
          <div style={row}>
            <span style={{ fontSize: 10, color: s.color || C.sakura }}>《{s.name}》</span>
            {s.desc && <span style={{ fontSize: 8, color: C.textDim, flex: 1 }}>{s.desc}</span>}
            <button onClick={() => { setEditId(s.id); setName(s.name); setDesc(s.desc || ""); setColor(s.color || TOKEN_COLORS[0]); }} style={{ ...tiny(), marginLeft: "auto" }}>編集</button>
            <button onClick={() => window.confirm(`《${s.name}》を削除しますか？（PCからも外れます）`) && upd(p => removeDef(p, "states", s.id))} style={tiny(C.red)}>✕</button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {(gs.pcs || []).map(pc => {
              const on = pcCustom(pc).states.includes(s.id);
              return <span key={pc.uid} onClick={() => upd(p => toggleState(p, pc.uid, s.id))}
                style={{ padding: "1px 6px", fontSize: 9, borderRadius: 8, cursor: "pointer", border: `1px solid ${on ? (s.color || C.sakura) : C.border}`, color: on ? (s.color || C.sakura) : C.textFaint }}>{on ? "● " : ""}{pc.charName}</span>;
            })}
          </div>
        </div>
      ))}
      <div style={label}>{editId ? "編集中" : "状態を作る（PCカードに表示。PCごとに付与／解除）"}</div>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="名前（例: 森羅結界）" style={{ ...inp, marginBottom: 4 }} />
      <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="説明（任意）" style={{ ...inp, marginBottom: 4 }} />
      <div style={row}>
        {TOKEN_COLORS.map(col => <span key={col} onClick={() => setColor(col)} style={{ width: 14, height: 14, borderRadius: "50%", background: col, cursor: "pointer", outline: color === col ? `2px solid ${C.text}` : "none", outlineOffset: 1 }} />)}
        <button disabled={!name.trim()} onClick={add} style={tiny(C.gold)}>{editId ? "更新" : "追加"}</button>
        {editId && <button onClick={reset} style={tiny()}>やめる</button>}
      </div>
    </Fold>
  );
}

// ─── 弾幕ごっこ中の GM 盤面編集 ──────────────────────────────────
// 盤面に置いた独自コマの「踏んだ／弾幕が置かれた」通知は折りたたみ中も常に表示する
export function GmFieldEditor({ gs, upd }) {
  const b = gs.battle || {};
  const c = getCustom(gs);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [randN, setRandN] = useState(1);
  const [tokKind, setTokKind] = useState("");
  const [tokCell, setTokCell] = useState("rand");
  const [skill, setSkill] = useState("");
  const [evadeSide, setEvadeSide] = useState("pc");
  const [evadeN, setEvadeN] = useState(6);
  const [evadeLabel, setEvadeLabel] = useState("ラストスペル");

  const battlePcs = (gs.pcs || []).filter(pc => !b.participantPcUids || b.participantPcUids.includes(pc.uid));
  const npcs = b.participants?.npcs || [];
  const entities = [
    ...battlePcs.map(pc => ({ id: pc.uid, name: pc.charName, isPc: true, e: pc })),
    ...npcs.map(n => ({ id: n.id, name: n.name, isPc: false, e: n })),
  ];
  const tid = target && entities.some(x => x.id === target) ? target : (b.pcCombatant || entities[0]?.id || "");
  const cur = entities.find(x => x.id === tid);
  const grid = b.grids?.[tid] || [0, 0, 0, 0, 0, 0];
  const pos = b.positions?.[tid];

  const alerts = fieldTokenAlerts(b);
  const kindName = (id) => c.tokens.find(k => k.id === id)?.name || "コマ";
  const opponentOf = (id) => entities.find(x => x.id === id)?.isPc ? b.npcCombatant : b.pcCombatant;
  const nameOf = (id) => entities.find(x => x.id === id)?.name || "？";
  const isHitCheck = b.phase === "pc_hit_check" || b.phase === "npc_hit_check";
  const canEvade = !!(b.pcCombatant && b.npcCombatant);
  const grants = Object.entries(b.grantedDs || {}).flatMap(([id, list]) => (Array.isArray(list) ? list : Object.values(list || {})).map(sk => ({ id, sk })));
  const cellTokens = (cell) => getFieldTokens(b).filter(t => t.owner === tid && t.cell === cell);

  return (
    <div data-touch-zoom style={{ marginBottom: 8 }}>
      {alerts.map(a => {
        const opp = opponentOf(a.owner);
        const ids = a.tokens.map(t => t.id);
        const kinds = [...new Set(a.tokens.map(t => kindName(t.kind)))].join("・");
        return (
          <div key={`${a.owner}:${a.cell}`} style={{ ...box, borderColor: C.gold, background: "rgba(212,168,56,0.08)" }}>
            <div style={{ fontSize: 10, color: C.gold, marginBottom: 4 }}>
              ⚠ {nameOf(a.owner)} のフィールド {a.cell}番マスの【{kinds}】×{a.tokens.length}：{a.standing ? "駒がこのマスにいる" : "弾幕が置かれた"}
            </div>
            <div style={row}>
              <button onClick={() => upd(p => takeFieldTokens(p, ids, "collect", a.owner))} style={tiny(C.gold)}>{nameOf(a.owner)} が獲得</button>
              {opp && <button onClick={() => upd(p => takeFieldTokens(p, ids, "collect", opp))} style={tiny(C.gold)}>{nameOf(opp)} が獲得</button>}
              <button onClick={() => upd(p => takeFieldTokens(p, ids, "remove"))} style={tiny(C.red)}>取り除く</button>
            </div>
          </div>
        );
      })}

      <button onClick={() => setOpen(v => !v)} style={{ width: "100%", padding: 5, fontSize: 10, cursor: "pointer", borderRadius: 4, background: "rgba(255,255,255,0.02)", border: `1px solid ${C.border}`, color: C.red }}>
        🎯 盤面編集（GM） {open ? "▲" : "▼"}
      </button>
      {open && (
        <div style={{ ...box, marginTop: 6 }}>
          {isHitCheck && (
            <button onClick={() => window.confirm("この被弾を無効にして次へ進めますか？（霊撃など）") && upd(p => cancelHit(p))} style={{ ...tiny(C.blue), width: "100%", padding: 5, marginBottom: 8, fontSize: 10 }}>
              🛡 {nameOf(b.phase === "pc_hit_check" ? b.pcCombatant : b.npcCombatant)} の被弾を無効にする
            </button>
          )}

          <div style={label}>対象のフィールド</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 6 }}>
            {entities.map(x => (
              <span key={x.id} onClick={() => setTarget(x.id)} style={{ padding: "2px 7px", fontSize: 9, cursor: "pointer", borderRadius: 10, border: `1px solid ${x.id === tid ? (x.isPc ? C.blue : C.red) : C.border}`, color: x.id === tid ? (x.isPc ? C.blue : C.red) : C.textFaint }}>{x.name}</span>
            ))}
          </div>

          {cur && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 3, marginBottom: 6 }}>
                {[1, 2, 3, 4, 5, 6].map(cell => {
                  const toks = cellTokens(cell);
                  return (
                    <div key={cell} style={{ padding: 4, borderRadius: 3, border: `1px solid ${pos === cell ? (cur.isPc ? C.blue : C.red) : C.border}`, background: pos === cell ? "rgba(255,255,255,0.04)" : "transparent", fontSize: 9, color: C.textDim }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: C.textFaint }}>{cell}</span>
                        {pos === cell ? <span style={{ color: cur.isPc ? C.blue : C.red }}>駒</span>
                          : <span onClick={() => upd(p => moveEntity(p, tid, cell))} title="駒をこのマスへ移動" style={{ cursor: "pointer", color: C.textFaint }}>→駒</span>}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 3, margin: "2px 0" }}>
                        <button onClick={() => upd(p => adjustBullets(p, tid, cell, -1))} style={tiny()}>−</button>
                        <span style={{ color: grid[cell - 1] ? C.red : C.textFaint, minWidth: 10, textAlign: "center", fontWeight: "bold" }}>{grid[cell - 1] || 0}</span>
                        <button onClick={() => upd(p => adjustBullets(p, tid, cell, +1))} style={tiny()}>＋</button>
                      </div>
                      {toks.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
                          {toks.map(t => <span key={t.id} onClick={() => upd(p => takeFieldTokens(p, [t.id], "remove"))} title="クリックで取り除く" style={{ fontSize: 8, cursor: "pointer", color: c.tokens.find(k => k.id === t.kind)?.color || C.sakura }}>◆{kindName(t.kind)}</span>)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={row}>
                <button onClick={() => window.confirm(`${cur.name} のフィールドの弾幕を全て取り除きますか？`) && upd(p => clearField(p, tid))} style={tiny(C.red)}>弾幕を全消去</button>
                ランダムに<input type="number" min={1} max={12} value={randN} onChange={e => setRandN(e.target.value)} style={{ ...num, width: 34 }} />個
                <button onClick={() => { const n = Math.max(1, Math.min(12, parseInt(randN) || 1)); const dice = Array.from({ length: n }, d6); upd(p => placeBulletsByDice(p, tid, dice)); }} style={tiny(C.red)}>配置</button>
              </div>
              <div style={row}>
                残り人数 {cur.e.resources?.残り人数?.cur ?? 0}
                <button onClick={() => upd(p => adjustLives(p, tid, -1))} style={tiny()}>−</button>
                <button onClick={() => upd(p => adjustLives(p, tid, +1))} style={tiny()}>＋</button>
              </div>

              <div style={label}>独自コマを置く（種類は「独自」タブのマップの独自コマを流用）</div>
              {c.tokens.length === 0 ? <div style={{ fontSize: 9, color: C.textFaint }}>コマの種類がありません（「独自」タブで作成）</div> : (
                <div style={row}>
                  <select value={tokKind} onChange={e => setTokKind(e.target.value)} style={sel}>
                    <option value="">種類...</option>
                    {c.tokens.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                  </select>
                  <select value={tokCell} onChange={e => setTokCell(e.target.value)} style={sel}>
                    <option value="rand">ランダムなマス</option>
                    {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}番マス</option>)}
                  </select>
                  <button disabled={!tokKind} onClick={() => { const cell = tokCell === "rand" ? d6() : parseInt(tokCell); const id = newId("ft"); upd(p => placeFieldToken(p, tid, cell, tokKind, id)); }} style={tiny(C.gold)}>置く</button>
                </div>
              )}

              <div style={label}>このラウンドだけ弾幕スキルを修得させる（アビリティカードの「装備」等）</div>
              <div style={row}>
                <select value={skill} onChange={e => setSkill(e.target.value)} style={sel}>
                  <option value="">弾幕スキル...</option>
                  {OFFICIAL_DS_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <button disabled={!skill} onClick={() => upd(p => grantSkill(p, tid, skill))} style={tiny(C.gold)}>{cur.name} に付与</button>
              </div>
            </>
          )}
          {grants.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 4 }}>
              {grants.map(g => <span key={`${g.id}:${g.sk}`} onClick={() => upd(p => revokeSkill(p, g.id, g.sk))} title="クリックで外す" style={{ padding: "1px 6px", fontSize: 9, borderRadius: 8, cursor: "pointer", border: `1px solid ${C.gold}`, color: C.gold }}>{nameOf(g.id)}《{g.sk}》✕</span>)}
            </div>
          )}

          <div style={label}>追加の回避ステップ（ラストスペル等。回避側のフィールドに弾幕を置き、回避後はラウンド終了判定へ）</div>
          {!canEvade ? <div style={{ fontSize: 9, color: C.textFaint }}>対戦者が決まってから使えます</div> : (
            <>
              <div style={row}>
                回避側
                {["pc", "npc"].map(side => (
                  <span key={side} onClick={() => setEvadeSide(side)} style={{ padding: "1px 7px", fontSize: 9, cursor: "pointer", borderRadius: 10, border: `1px solid ${evadeSide === side ? C.gold : C.border}`, color: evadeSide === side ? C.gold : C.textFaint }}>
                    {nameOf(side === "pc" ? b.pcCombatant : b.npcCombatant)}
                  </span>
                ))}
              </div>
              <div style={row}>
                <input value={evadeLabel} onChange={e => setEvadeLabel(e.target.value)} placeholder="名前" style={{ ...inp, width: 90 }} />
                <input type="number" min={0} max={12} value={evadeN} onChange={e => setEvadeN(e.target.value)} style={{ ...num, width: 34 }} />D で配置
                <button onClick={() => {
                  const isPc = evadeSide === "pc";
                  const n = Math.max(0, Math.min(12, parseInt(evadeN) || 0));
                  const dice = Array.from({ length: n }, d6);
                  const lbl = evadeLabel.trim() || "追加の回避ステップ";
                  if (!window.confirm(`${lbl}：${nameOf(isPc ? b.pcCombatant : b.npcCombatant)} のフィールドに ${n}D の弾幕を置き、回避ステップを始めますか？`)) return;
                  upd(p => startExtraEvade(p, isPc, dice, lbl));
                }} style={tiny(C.red)}>開始</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
