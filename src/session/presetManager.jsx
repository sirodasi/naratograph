// 異変再現プリセットの管理（セッション外。プロフィールの「異変再現」タブ）。
//   ・自作プリセット（users/{uid}/ihenPresets）の新規作成・編集・複製・削除
//   ・公式プリセットを複製して自作の土台にする
//   ・JSON ファイルの書き出し／読み込み（他の GM との受け渡し）
// 定義の編集 UI はセッション中の「独自」タブと同じ部品（PresetDefsEditor）を、作業用のオブジェクトに対して使う。
import { useState, useEffect, useRef } from "react";
import { db } from "../firebase";
import { ref as dbRef, get as dbGet, set as dbSet, remove as dbRemove } from "firebase/database";
import { stripUndefined } from "../gsSync";
import { IHEN_PRESETS } from "../data/ihenPresets";
import { CYCLES } from "../data/gameData";
import { C, iStyle } from "../styles/colors";
import { downloadJson, readFileText } from "../fileTransfer";
import {
  normalizePreset, sanitizePreset, presetSummary, presetFromGs, presetToFile, presetFileName, parsePresetFile, limitLabel,
} from "../customRules";
import { PresetDefsEditor } from "./customPanel";

const newId = () => `ip${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const btn = (color = C.textDim, extra = {}) => ({ padding: "4px 10px", fontSize: 10, cursor: "pointer", borderRadius: 3, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color, fontFamily: "inherit", ...extra });
const card = { padding: "10px 12px", marginBottom: 8, background: "rgba(255,255,255,0.025)", border: `1px solid ${C.border}`, borderRadius: 5 };
const inp = { ...iStyle, fontSize: 11, padding: "5px 8px" };
const cycleSel = (v, set) => (
  <select value={v} onChange={e => set(parseInt(e.target.value))} style={{ ...inp, width: "auto" }}>
    {CYCLES.map((n, i) => <option key={n} value={i}>{n}</option>)}
  </select>
);

// 作業用の gs（定義だけ）。PresetDefsEditor が読む形にする
const sandboxOf = (preset) => ({ custom: { ...normalizePreset(preset).defs }, pcs: [], log: [] });

// ─── 1つのプリセットの編集画面 ─────────────────────────────────────
// draft: { id?（保存済みの Firebase id）, preset }。onSave(preset) は保存処理（Promise）
export function PresetEditor({ draft, onSave, onCancel }) {
  const init = normalizePreset(draft.preset) || normalizePreset({ name: "" });
  const [name, setName] = useState(draft.preset?.name || "");
  const [desc, setDesc] = useState(init.desc || "");
  const [box, setBox] = useState(() => sandboxOf(init));
  const ck = init.clock || {};
  const [useStart, setUseStart] = useState(!!ck.day);
  const [day, setDay] = useState(ck.day || 1);
  const [ci, setCi] = useState(ck.cycleIdx ?? 0);
  const [useLimit, setUseLimit] = useState(!!ck.limitDay);
  const [lDay, setLDay] = useState(ck.limitDay || 3);
  const [lCi, setLCi] = useState(ck.limitCycleIdx ?? 3);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const revRef = useRef(0);
  const touch = () => { revRef.current += 1; setDirty(true); };

  const upd = (fn) => { setBox(b => fn(b)); touch(); };
  const build = () => {
    const clock = {};
    if (useStart) Object.assign(clock, { day, cycleIdx: ci });
    if (useLimit) Object.assign(clock, { limitDay: lDay, limitCycleIdx: lCi });
    const p = presetFromGs(box, name, desc);
    return sanitizePreset(Object.keys(clock).length ? { ...p, clock } : p);
  };
  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const rev = revRef.current;
    try { await onSave(build()); if (revRef.current === rev) setDirty(false); }
    catch (e) { window.alert(`保存に失敗しました: ${e?.message || e}`); }
    finally { setBusy(false); }
  };
  const cancel = () => {
    if (dirty && !window.confirm("保存していない変更を破棄しますか？")) return;
    onCancel();
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: C.gold, flex: 1 }}>{draft.id ? "プリセットを編集" : "新しいプリセット"}</span>
        <button onClick={() => downloadJson(presetFileName(build()), presetToFile(build()))} style={btn()}>JSON 書き出し</button>
        <button onClick={cancel} style={btn()}>← 一覧に戻る</button>
      </div>
      <div style={card}>
        <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 3 }}>プリセット名</div>
        <input value={name} onChange={e => { setName(e.target.value); touch(); }} placeholder="例: 自作異変「〇〇」" style={{ ...inp, marginBottom: 8 }} />
        <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 3 }}>説明（任意。適用の一覧で表示）</div>
        <textarea value={desc} onChange={e => { setDesc(e.target.value); touch(); }} rows={2} style={{ ...inp, resize: "vertical", marginBottom: 8 }} />
        <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 3 }}>時刻（任意。適用時に「時刻も設定する」がオンなら設定）</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 10, color: C.textDim, marginBottom: 4 }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
            <input type="checkbox" checked={useStart} onChange={e => { setUseStart(e.target.checked); touch(); }} />開始時刻
          </label>
          {useStart && <><input type="number" min={1} max={9} value={day} onChange={e => { setDay(parseInt(e.target.value) || 1); touch(); }} style={{ ...inp, width: 48 }} />日目{cycleSel(ci, v => { setCi(v); touch(); })}</>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 10, color: C.textDim }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
            <input type="checkbox" checked={useLimit} onChange={e => { setUseLimit(e.target.checked); touch(); }} />リミット
          </label>
          {useLimit && <><input type="number" min={1} max={9} value={lDay} onChange={e => { setLDay(parseInt(e.target.value) || 1); touch(); }} style={{ ...inp, width: 48 }} />日目の{cycleSel(lCi, v => { setLCi(v); touch(); })}</>}
        </div>
      </div>
      <div style={{ fontSize: 9, color: C.textDim, lineHeight: 1.6, margin: "10px 0 6px" }}>
        定義（ステータス・アイテム・表・コマ・状態・ルール文・タイミングのメモ）。値や配置はセッション中に「独自」タブで操作します。
      </div>
      <PresetDefsEditor gs={box} upd={upd} />
      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
        <button disabled={!name.trim() || busy} onClick={save} style={btn(C.gold, { padding: "6px 18px", fontSize: 11, opacity: !name.trim() ? 0.5 : 1 })}>{busy ? "保存中…" : "保存する"}</button>
        {!name.trim() && <span style={{ fontSize: 9, color: C.textFaint }}>プリセット名を入力してください</span>}
        {dirty && name.trim() && <span style={{ fontSize: 9, color: C.gold }}>未保存の変更があります</span>}
      </div>
    </div>
  );
}

// ─── 一覧（プロフィールの「異変再現」タブ） ─────────────────────────
export function IhenPresetManager({ user }) {
  const uid = user?.uid || null;
  const [saved, setSaved] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [version, setVersion] = useState(0);
  const [draft, setDraft] = useState(null); // { id?, preset }
  const [openDesc, setOpenDesc] = useState(null);
  const fileRef = useRef(null);
  const reload = () => setVersion(v => v + 1);

  useEffect(() => {
    if (!uid) return;
    let alive = true;
    dbGet(dbRef(db, `users/${uid}/ihenPresets`))
      .then(snap => {
        if (!alive) return;
        const v = snap.val() || {};
        setSaved(Object.entries(v).filter(([, raw]) => raw && typeof raw === "object")
          .map(([id, raw]) => ({ id, ...normalizePreset(raw) })).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
        setLoadError(false);
      })
      .catch(() => { if (alive) { setSaved([]); setLoadError(true); } });
    return () => { alive = false; };
  }, [uid, version]);

  const store = async (id, preset, createdAt) => {
    const now = Date.now();
    await dbSet(dbRef(db, `users/${uid}/ihenPresets/${id}`), stripUndefined({ ...preset, createdAt: createdAt || now, updatedAt: now }));
  };
  const saveDraft = async (preset) => {
    const started = draft;
    const id = started.id || newId();
    const createdAt = started.createdAt || (started.id ? saved?.find(s => s.id === started.id)?.createdAt : null) || Date.now();
    await store(id, preset, createdAt);
    reload();
    // 保存中に別の下書きへ切り替えていたら、そちらは置き換えない
    setDraft(d => (d === started ? { ...started, id, preset, createdAt, saved: (started.saved || 0) + 1 } : d));
  };
  const del = async (sp) => {
    if (!window.confirm(`プリセット「${sp.name}」を削除しますか？（元に戻せません。適用済みのセッションの内容は残ります）`)) return;
    try { await dbRemove(dbRef(db, `users/${uid}/ihenPresets/${sp.id}`)); reload(); }
    catch (e) { window.alert(`削除に失敗しました: ${e?.message || e}`); }
  };
  // 新しい下書きには nonce を付け、最初の保存で id が付いても編集画面を作り直さない（保存中の入力を失わない）
  const copyOf = (preset) => ({ nonce: newId(), preset: { ...sanitizePreset(normalizePreset(preset)), name: `${preset.name}（コピー）` } });
  const exportFile = (preset) => downloadJson(presetFileName(preset), presetToFile(preset));
  // 読み込んだ内容は編集画面で確認してから保存する
  const importFile = async (file) => {
    if (!file) return;
    try {
      const { preset, error } = parsePresetFile(await readFileText(file));
      if (error) { window.alert(`読み込めませんでした: ${error}`); return; }
      setDraft(d => d || { preset, nonce: newId() });
    } catch (e) {
      window.alert(`読み込みに失敗しました: ${e?.message || e}`);
    }
  };

  if (!uid) return <div style={{ fontSize: 10, color: C.textFaint }}>ログイン中のみ利用できます</div>;
  if (draft) return <PresetEditor key={draft.nonce || draft.id || "new"} draft={draft} onSave={saveDraft} onCancel={() => setDraft(null)} />;

  const clockText = (ck) => !ck ? "" : [ck.day ? `開始 ${ck.day}日目・${CYCLES[ck.cycleIdx ?? 0]}` : "", ck.limitDay ? `リミット ${limitLabel(ck.limitDay, ck.limitCycleIdx ?? 3)}` : ""].filter(Boolean).join(" ／ ");
  const presetCard = (preset, key, actions) => (
    <div key={key} style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span onClick={() => setOpenDesc(openDesc === key ? null : key)} style={{ fontSize: 12, color: C.text, cursor: preset.desc ? "pointer" : "default" }}>{preset.name}</span>
        <span style={{ fontSize: 9, color: C.textFaint }}>{presetSummary(preset)}</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4, flexWrap: "wrap" }}>{actions}</span>
      </div>
      {preset.clock && <div style={{ fontSize: 9, color: C.textDim, marginTop: 3 }}>⏳ {clockText(preset.clock)}</div>}
      {openDesc === key && preset.desc && <div style={{ fontSize: 10, color: C.textDim, lineHeight: 1.6, marginTop: 4 }}>{preset.desc}</div>}
    </div>
  );

  return (
    <div style={{ maxWidth: 700 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: C.text, flex: 1 }}>異変再現プリセット</span>
        <button onClick={() => fileRef.current?.click()} style={btn(C.blue)}>📥 JSON を読み込む</button>
        <button onClick={() => setDraft({ nonce: newId(), preset: { name: "", defs: {} } })} style={btn(C.gold)}>＋ 新規作成</button>
        <input ref={fileRef} type="file" accept=".json,application/json" data-testid="preset-file" style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; importFile(f); }} />
      </div>
      <div style={{ fontSize: 9, color: C.textFaint, lineHeight: 1.6, marginBottom: 12 }}>
        セッション前に自作の異変再現を作っておき、セッション中に GM の「独自」タブから適用します。JSON で書き出したファイルを他の GM に渡せば、読み込んでそのまま使えます。
      </div>

      <div style={{ fontSize: 10, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginBottom: 8 }}>自作</div>
      {saved === null && <div style={{ fontSize: 10, color: C.textFaint, marginBottom: 8 }}>読み込み中…</div>}
      {loadError && <div style={{ fontSize: 10, color: C.red, marginBottom: 8 }}>読み込みに失敗しました</div>}
      {saved && saved.length === 0 && !loadError && <div style={{ fontSize: 10, color: C.textFaint, padding: "8px 0 12px" }}>まだありません（新規作成、公式の複製、JSON の読み込みで作れます）</div>}
      {(saved || []).map(sp => presetCard(sp, `u${sp.id}`, <>
        <button onClick={() => setDraft({ id: sp.id, preset: sp, createdAt: sp.createdAt })} style={btn(C.gold)}>編集</button>
        <button onClick={() => setDraft(copyOf(sp))} style={btn()}>複製</button>
        <button onClick={() => exportFile(sp)} style={btn()}>JSON</button>
        <button onClick={() => del(sp)} style={btn(C.red)}>削除</button>
      </>))}

      <div style={{ fontSize: 10, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, margin: "16px 0 8px" }}>公式（要約。複製して自作の土台にできます）</div>
      {IHEN_PRESETS.map(pr => presetCard(pr, pr.key, <>
        <button onClick={() => setDraft(copyOf(pr))} style={btn()}>複製して編集</button>
        <button onClick={() => exportFile(pr)} style={btn()}>JSON</button>
      </>))}
    </div>
  );
}
