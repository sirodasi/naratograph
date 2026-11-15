// SessionView から分割: 導入（バックストーリー）・シーン描写（SceneStage/SceneEditor）・終幕
import { useState, useEffect, useRef, useMemo } from "react";
import { C } from "../styles/colors";
import { db, getStorageLazy } from "../firebase";
import { ref as dbRef, set as dbSet, get as dbGet, remove as dbRemove, update as dbUpdate } from "firebase/database";
import { dehydrateScene, hydrateScene, collectSceneAssetIds, hasInlineImages } from "../sceneAssets";
import { FX_PARTICLES, FX_TONE, SCENE_IMG_USE_STORAGE } from "./shared";

// ─── BackstoryScreen ──────────────────────────────────────────────
export function BackstoryScreen({ gs, isGm, onProceed }) {
  const text = gs.scenarioData?.backstory || "（バックストーリー未設定）";
  const [displayedLen, setDisplayedLen] = useState(0);
  const [done, setDone]                 = useState(false);
  const [headerVisible, setHeaderVisible] = useState(false);
  const proceeding  = useRef(false);
  const intervalRef = useRef(null);

  // ヘッダーを先にフェードイン、その後タイプライター開始
  useEffect(() => {
    const t1 = setTimeout(() => setHeaderVisible(true), 200);
    const t2 = setTimeout(() => {
      intervalRef.current = setInterval(() => {
        setDisplayedLen(prev => {
          const next = prev + 1;
          if (next >= text.length) {
            clearInterval(intervalRef.current);
            setDone(true);
            return text.length;
          }
          return next;
        });
      }, 28);
    }, 700);
    return () => { clearTimeout(t1); clearTimeout(t2); clearInterval(intervalRef.current); };
  }, [text]);

  const handleClick = () => {
    if (!done) {
      // 途中クリック → 即座に全文表示（スキップ）
      clearInterval(intervalRef.current);
      setDisplayedLen(text.length);
      setDone(true);
      return;
    }
    // 全文表示済み → GMのみ次フェーズへ
    if (!isGm || proceeding.current) return;
    proceeding.current = true;
    onProceed();
  };

  return (
    <div
      onClick={handleClick}
      style={{ background: "#04060a", height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "'Noto Serif JP', serif", cursor: "pointer", padding: "40px 60px", boxSizing: "border-box" }}
    >
      <style>{`
        @keyframes fadeIn  { from { opacity: 0 } to { opacity: 1 } }
        @keyframes pulse   { 0%,100% { opacity: 0.5 } 50% { opacity: 1 } }
        @keyframes blink   { 0%,100% { opacity: 1 } 50% { opacity: 0 } }
        @keyframes promptIn { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
      `}</style>

      <div style={{ maxWidth: 760, width: "100%" }}>
        {/* シナリオタイトル */}
        <div style={{ fontSize: 11, color: "#4a6080", letterSpacing: 4, textAlign: "center", marginBottom: 20, opacity: headerVisible ? 1 : 0, transition: "opacity 1s ease" }}>
          {gs.scenarioData?.name || "シナリオ"}
        </div>

        {/* タイプライター本文 */}
        <div style={{ fontSize: 15, color: "#b8c8d8", lineHeight: 2.3, whiteSpace: "pre-wrap", textAlign: "justify", minHeight: "4em" }}>
          {text.slice(0, displayedLen)}
          {!done && (
            <span style={{ animation: "blink 0.7s step-end infinite", color: "#4a8090", fontWeight: "bold" }}>|</span>
          )}
        </div>

        {/* 完了後プロンプト */}
        {done && (
          <div style={{ textAlign: "center", marginTop: 40, animation: "promptIn 0.8s ease forwards" }}>
            {isGm
              ? <span style={{ fontSize: 11, color: "#3a5070", letterSpacing: 3, animation: "pulse 2s ease infinite", display: "inline-block" }}>▼ クリックして探索フェイズへ ▼</span>
              : <span style={{ fontSize: 10, color: "#2a3545", letterSpacing: 2 }}>GMがフェイズを進めるまでお待ちください…</span>
            }
          </div>
        )}
      </div>
    </div>
  );
}

export function SceneParticles({ kind }) {
  const cfg = FX_PARTICLES[kind];
  const parts = useMemo(() => {
    if (!cfg) return [];
    const rnd = (a, b) => a + Math.random() * (b - a);
    return Array.from({ length: cfg.count }, (_, i) => ({
      id: i, left: rnd(0, 100), size: rnd(cfg.size[0], cfg.size[1]),
      dur: rnd(cfg.dur[0], cfg.dur[1]), delay: -rnd(0, cfg.dur[1]),
      drift: rnd(-50, 50), rot: rnd(180, 720),
    }));
  }, [cfg]);
  if (!cfg) return null;
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 5 }}>
      {/* top（コンテナ高さ基準%）で落下させる。transform% は要素自身基準で動かないため使わない */}
      <style>{`
        @keyframes fxFall { 0%{top:-8%;transform:translateX(0) rotate(0deg);opacity:0} 8%{opacity:.92} 90%{opacity:.92} 100%{top:108%;transform:translateX(var(--dx)) rotate(var(--r));opacity:0} }
        @keyframes fxRain { 0%{top:-10%;opacity:0} 12%{opacity:.55} 100%{top:108%;opacity:0} }
      `}</style>
      {parts.map(p => cfg.line ? (
        <span key={p.id} style={{ position: "absolute", left: `${p.left}%`, top: 0, width: 1.5, height: `${p.size}px`, background: cfg.color, animation: `fxRain ${p.dur}s linear ${p.delay}s infinite` }} />
      ) : (
        <span key={p.id} style={{ position: "absolute", left: `${p.left}%`, top: 0, fontSize: p.size, color: cfg.color, "--dx": `${p.drift}px`, "--r": `${p.rot}deg`, animation: `fxFall ${p.dur}s linear ${p.delay}s infinite`, textShadow: "0 0 5px rgba(0,0,0,0.35)" }}>{cfg.char}</span>
      ))}
    </div>
  );
}

// ─── SceneStage（描写の表示）: 背景＋立ち絵＋テキスト。探索の描写モードと終幕で共用 ──
// editable=true（GM）のとき、立ち絵をドラッグで自由配置、選択時にサイズ/反転/重なり順/削除ができる。
// 立ち絵データ: { img, name, x, y, h, flip }（x,y=下端中央の%、h=高さ%。未設定はレガシー下部均等配置）
export function SceneStage({ sceneData, sceneText, editable = false, onChange }) {
  const stageRef = useRef(null);
  const [sel, setSel] = useState(null);     // 選択中の立ち絵index（編集時）
  const [localP, setLocalP] = useState(null); // ドラッグ中のローカル立ち絵配列（Firebase書込はドラッグ終了時のみ）
  const dragRef = useRef(null);
  const base = sceneData?.portraits || [];
  const fx = sceneData?.fx || {};
  const portraits = localP ?? base;
  const n = portraits.length;

  // レガシー（x未設定）の既定配置: 下部に均等配置（テキスト枠の上に立つ）
  const posOf = (p, i) => ({
    x: p.x ?? (n > 1 ? 50 + (i - (n - 1) / 2) * Math.min(24, 86 / n) : 50),
    y: p.y ?? 90,
    h: p.h ?? 60,
    flip: !!p.flip,
  });

  const commit = (next) => onChange?.(next);
  const adjust = (i, patch) => commit(portraits.map((p, j) => j === i ? { ...p, ...patch } : p));
  const reorder = (i, dir) => { // 重なり順（配列の後ろ=手前）
    const j = i + dir;
    if (j < 0 || j >= n) return;
    const arr = [...portraits];[arr[i], arr[j]] = [arr[j], arr[i]];
    commit(arr); setSel(j);
  };
  const removeAt = (i) => { commit(portraits.filter((_, j) => j !== i)); setSel(null); };

  const startDrag = (i, e) => {
    if (!editable) return;
    e.preventDefault(); e.stopPropagation();
    setSel(i);
    // 掴んだ位置とアンカー(x,y)のズレを記録し、ドラッグ中に維持する
    const r = stageRef.current?.getBoundingClientRect();
    let ox = 0, oy = 0;
    if (r) {
      const cur = posOf(portraits[i], i);
      ox = ((e.clientX - r.left) / r.width) * 100 - cur.x;
      oy = ((e.clientY - r.top) / r.height) * 100 - cur.y;
    }
    dragRef.current = { i, ox, oy };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
  };
  const onMove = (e) => {
    if (!dragRef.current || !stageRef.current) return;
    const r = stageRef.current.getBoundingClientRect();
    const x = Math.max(3, Math.min(97, ((e.clientX - r.left) / r.width) * 100 - dragRef.current.ox));
    const y = Math.max(12, Math.min(100, ((e.clientY - r.top) / r.height) * 100 - dragRef.current.oy));
    const i = dragRef.current.i;
    setLocalP(cur => (cur ?? base).map((p, j) => j === i ? { ...p, x, y } : p));
  };
  const endDrag = () => {
    if (dragRef.current && localP) commit(localP);
    dragRef.current = null; setLocalP(null);
  };

  return (
    <div ref={stageRef}
      onPointerMove={editable ? onMove : undefined}
      onPointerUp={editable ? endDrag : undefined}
      onPointerLeave={editable ? endDrag : undefined}
      onPointerDown={editable ? () => setSel(null) : undefined}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: "#040608", touchAction: editable ? "none" : "auto" }}>
      {sceneData?.bg && (
        <img src={sceneData.bg} alt="" draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.85 }} />
      )}
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg,rgba(0,0,0,0.05)0%,rgba(0,0,0,0.65)100%)", pointerEvents: "none" }} />
      {portraits.map((p, i) => {
        if (!p.img || p.hidden) return null; // 非表示の立ち絵は描画しない
        const { x, y, h, flip } = posOf(p, i);
        return (
          <img key={i} src={p.img} alt={p.name || ""} draggable={false}
            onPointerDown={editable ? e => startDrag(i, e) : undefined}
            style={{
              position: "absolute", left: `${x}%`, top: `${y}%`, height: `${h}%`,
              transform: `translate(-50%,-100%) scaleX(${flip ? -1 : 1})`, objectFit: "contain",
              filter: "drop-shadow(0 4px 24px rgba(0,0,0,0.8))",
              cursor: editable ? (dragRef.current ? "grabbing" : "grab") : "default",
              outline: editable && sel === i ? "2px dashed #c8a040" : "none", outlineOffset: 2,
              transition: dragRef.current ? "none" : "left 0.12s, top 0.12s, height 0.12s",
              userSelect: "none", WebkitUserSelect: "none",
            }} />
        );
      })}
      {/* 色調オーバーレイ＋背景パーティクル（立ち絵の上・テキスト枠の下） */}
      {fx.tone && FX_TONE[fx.tone] && (
        <div style={{ position: "absolute", inset: 0, background: FX_TONE[fx.tone].bg, pointerEvents: "none", zIndex: 4 }} />
      )}
      {fx.particles && FX_PARTICLES[fx.particles] && <SceneParticles kind={fx.particles} />}
      {sceneText && (
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(6,8,16,0.93)", borderTop: "1px solid #1e2535", padding: "16px 28px", pointerEvents: "none", zIndex: 8 }}>
          <div style={{ fontSize: 14, color: "#c8b89a", lineHeight: 2.1, fontFamily: "'Noto Serif JP', serif", whiteSpace: "pre-wrap" }}>{sceneText}</div>
        </div>
      )}
      {/* 編集ツールバー（選択中の立ち絵） */}
      {editable && sel != null && portraits[sel]?.img && !portraits[sel]?.hidden && (() => {
        const cur = posOf(portraits[sel], sel);
        const Btn = ({ onClick, children, title }) => (
          <button title={title} onPointerDown={e => e.stopPropagation()} onClick={onClick}
            style={{ minWidth: 30, height: 30, padding: "0 7px", background: "rgba(20,24,40,0.95)", border: "1px solid #3a4560", borderRadius: 5, color: "#cfe2f5", fontSize: 13, cursor: "pointer", lineHeight: 1 }}>{children}</button>
        );
        return (
          <div onPointerDown={e => e.stopPropagation()} style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 5, alignItems: "center", background: "rgba(6,8,16,0.9)", border: "1px solid #2a3550", borderRadius: 8, padding: "5px 7px", zIndex: 20, flexWrap: "wrap", maxWidth: "94%" }}>
            <span style={{ fontSize: 9, color: "#8aa0c0", marginRight: 2 }}>{portraits[sel].name || `立ち絵${sel + 1}`}</span>
            <Btn title="小さく" onClick={() => adjust(sel, { h: Math.max(15, Math.round((cur.h - 6) * 10) / 10) })}>－</Btn>
            <span style={{ fontSize: 9, color: "#6a7a90", minWidth: 26, textAlign: "center" }}>{Math.round(cur.h)}%</span>
            <Btn title="大きく" onClick={() => adjust(sel, { h: Math.min(100, Math.round((cur.h + 6) * 10) / 10) })}>＋</Btn>
            <Btn title="左右反転" onClick={() => adjust(sel, { flip: !cur.flip })}>⇄</Btn>
            {(() => {
              const sp = portraits[sel];
              const fs = (sp.faces && sp.faces.length) ? sp.faces : null;
              if (!fs || fs.length < 2) return null;
              const next = ((sp.face || 0) + 1) % fs.length;
              return <Btn title={`表情を切替 (${(sp.face || 0) + 1}/${fs.length})`} onClick={() => adjust(sel, { face: next, img: fs[next] })}>😀</Btn>;
            })()}
            <Btn title="背面へ" onClick={() => reorder(sel, -1)}>▽</Btn>
            <Btn title="前面へ" onClick={() => reorder(sel, +1)}>△</Btn>
            <Btn title="隠す" onClick={() => { adjust(sel, { hidden: true }); setSel(null); }}>🙈</Btn>
            <Btn title="削除" onClick={() => removeAt(sel)}>✕</Btn>
          </div>
        );
      })()}
    </div>
  );
}

// ─── SceneEditor（描写の編集・GM用）: モード切替（任意）＋テキスト＋背景＋立ち絵。RightPanel と終幕で共用 ──
export function SceneEditor({ gs, upd, sceneData, setSceneData, showModeToggle = true, user }) {
  // transparent=true: 立ち絵など透過を保持したい画像（webp→非対応はPNG）。false（背景）: JPEG。
  // リサイズ後、Firebase Storage にアップロードしてダウンロードURLを返す（RTDB同期を軽量化）。
  // Storage が使えない場合は data URL にフォールバックして従来通り動作する。
  const loadImage = async (file, maxW, cb, transparent = false) => {
    if (!file) return;
    // リサイズして Blob 化
    const blob = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
          const scale  = Math.min(1, maxW / img.width);
          const canvas = document.createElement("canvas");
          canvas.width  = img.width  * scale;
          canvas.height = img.height * scale;
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          // transparent は webp（非対応ブラウザは toBlob が image/png で返す＝透過保持）。
          // data URL で RTDB に直接保存するため画質はやや抑えめ（同期を軽くする）。
          canvas.toBlob(b => resolve(b), transparent ? "image/webp" : "image/jpeg", transparent ? 0.80 : 0.72);
        };
        img.onerror = () => resolve(null);
        img.src = ev.target.result;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
    if (!blob) return;
    // Storage が使える環境ならアップロード → URL。未使用（Spark）／失敗時は data URL フォールバック。
    if (SCENE_IMG_USE_STORAGE) {
      try {
        const ext = (blob.type && blob.type.split("/")[1]) || (transparent ? "webp" : "jpg");
        const path = `sceneImages/${user?.uid || "anon"}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const [{ ref: storageRef, uploadBytes, getDownloadURL }, storage] = await Promise.all([import("firebase/storage"), getStorageLazy()]);
        await uploadBytes(storageRef(storage, path), blob);
        cb(await getDownloadURL(storageRef(storage, path)));
        return;
      } catch (e) {
        console.error("画像のStorageアップロードに失敗。data URLで保存します。", e);
      }
    }
    const r = new FileReader(); r.onload = () => cb(r.result); r.readAsDataURL(blob);
  };
  // 表情（faces）操作。img は常に現在の表情に同期し、表示側は変更不要。
  const updP = (i, fn) => setSceneData(d => ({ ...d, portraits: d.portraits.map((x, j) => j === i ? fn(x) : x) }));
  const facesOf = p => (p.faces && p.faces.length) ? p.faces : [p.img];
  const selectFace = (i, k) => updP(i, x => { const fs = facesOf(x); return { ...x, faces: fs, face: k, img: fs[k] }; });
  const addFace = (i, url) => updP(i, x => ({ ...x, faces: [...facesOf(x), url] }));
  const removeFace = (i, k) => updP(i, x => { let fs = facesOf(x).filter((_, m) => m !== k); if (!fs.length) fs = [x.img]; const nf = Math.min(x.face || 0, fs.length - 1); return { ...x, faces: fs, face: nf, img: fs[nf] }; });

  // シーンプリセット（背景＋立ち絵＋エフェクト＋テキストを users/{uid}/scenePresets に保存して再利用）
  // 画像はライブの描写と同じくアセット分離する: users/{uid}/presetAssets/{内容ハッシュ} に1回だけ保存し、
  // プリセット本体は id＋座標のみ（一覧の取得が軽くなり、同じ画像を複数プリセットで共有しても重複しない）。
  const [presets, setPresets] = useState({});
  const [presetBusy, setPresetBusy] = useState(false);
  const presetAssetsPath = user?.uid ? `users/${user.uid}/presetAssets` : null;
  const writePreset = async (id, preset) => {
    const { scene, newAssets } = dehydrateScene({ bg: preset.bg || null, portraits: preset.portraits || [], fx: preset.fx || null });
    if (Object.keys(newAssets).length) await dbUpdate(dbRef(db, presetAssetsPath), newAssets);
    const stored = { ...preset, bg: scene.bg ?? null, portraits: scene.portraits || [] };
    await dbSet(dbRef(db, `users/${user.uid}/scenePresets/${id}`), stored);
    return stored;
  };
  useEffect(() => {
    if (!user?.uid) return;
    let alive = true;
    dbGet(dbRef(db, `users/${user.uid}/scenePresets`)).then(async snap => {
      if (!alive || !snap.exists()) return;
      const all = snap.val();
      setPresets(all);
      // 旧形式（画像を inline で保持）のプリセットはアセット分離形式へ移行する（次回から一覧取得が軽くなる）
      for (const [id, pr] of Object.entries(all)) {
        if (!hasInlineImages(pr)) continue;
        try { const stored = await writePreset(id, pr); if (alive) setPresets(p => ({ ...p, [id]: stored })); }
        catch (e) { console.error("シーンプリセットの移行に失敗", e); }
      }
    }).catch(() => {});
    return () => { alive = false; };
    // writePreset は user.uid だけに依存（毎レンダー再生成されるが uid が同じなら同じ動作）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);
  const savePreset = async () => {
    if (!user?.uid || presetBusy) return;
    const name = window.prompt("シーン名を入力してください", `シーン${Object.keys(presets).length + 1}`);
    if (!name || !name.trim()) return;
    const id = `p_${Date.now()}`;
    const preset = { name: name.trim(), bg: sceneData.bg || null, portraits: sceneData.portraits || [], fx: sceneData.fx || null, text: gs.sceneText || "", createdAt: Date.now() };
    setPresetBusy(true);
    try { const stored = await writePreset(id, preset); setPresets(p => ({ ...p, [id]: stored })); }
    catch (e) { console.error(e); alert("保存に失敗しました（画像が大きすぎる可能性があります）"); }
    finally { setPresetBusy(false); }
  };
  const loadPreset = async (pr) => {
    if (presetBusy) return;
    setPresetBusy(true);
    try {
      // 参照している画像だけ取得して復元（旧形式の inline data URL はそのまま通る）
      const ids = collectSceneAssetIds(pr);
      const snaps = await Promise.all(ids.map(aid => dbGet(dbRef(db, `${presetAssetsPath}/${aid}`))));
      const assets = Object.fromEntries(ids.map((aid, i) => [aid, snaps[i].val()]).filter(([, v]) => v));
      const scene = hydrateScene({ bg: pr.bg || null, portraits: pr.portraits || [], fx: pr.fx || {} }, assets);
      setSceneData(() => scene);
      upd(p => ({ ...p, sceneText: pr.text || "" }));
    } catch (e) {
      console.error(e);
      alert("シーンの読み込みに失敗しました。通信状況を確認してください。");
    } finally {
      setPresetBusy(false);
    }
  };
  const deletePreset = async (id, name) => {
    if (!user?.uid || !window.confirm(`シーン「${name}」を削除しますか？`)) return;
    try {
      await dbRemove(dbRef(db, `users/${user.uid}/scenePresets/${id}`));
      // 他のプリセットから参照されなくなった画像も削除する
      const remaining = Object.entries(presets).filter(([k]) => k !== id);
      const stillUsed = new Set(remaining.flatMap(([, pr]) => collectSceneAssetIds(pr)));
      const orphan = collectSceneAssetIds(presets[id]).filter(aid => !stillUsed.has(aid));
      if (orphan.length) await dbUpdate(dbRef(db, presetAssetsPath), Object.fromEntries(orphan.map(aid => [aid, null])));
      setPresets(p => { const n = { ...p }; delete n[id]; return n; });
    } catch (e) { console.error(e); }
  };

  return (
    <div>
      {showModeToggle && (
        <button onClick={() => upd(p => ({ ...p, sceneMode: !p.sceneMode }))} style={{ width: "100%", padding: "8px", borderRadius: 4, cursor: "pointer", marginBottom: 8, background: gs.sceneMode ? "rgba(121,134,203,0.2)" : "rgba(255,255,255,0.03)", border: gs.sceneMode ? "1px solid #7986cb60" : `1px solid ${C.border}`, color: gs.sceneMode ? "#9fa8da" : C.textFaint, fontSize: 12 }}>
          {gs.sceneMode ? "🎭 描写モード ON（クリックで解除）" : "🎭 描写モードを開始"}
        </button>
      )}
      <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 3 }}>テキスト（PLに表示）</div>
      <textarea value={gs.sceneText || ""} onChange={e => upd(p => ({ ...p, sceneText: e.target.value }))} placeholder="PLに見せたいテキスト…" style={{ width: "100%", boxSizing: "border-box", padding: "5px 7px", fontSize: 11, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.text, borderRadius: 3, height: 80, resize: "vertical" }} />

      <div style={{ fontSize: 9, color: C.textFaint, marginTop: 8, marginBottom: 3 }}>背景画像</div>
      {sceneData.bg ? (
        <div style={{ position: "relative", marginBottom: 6 }}>
          <img src={sceneData.bg} alt="" style={{ width: "100%", height: 70, objectFit: "cover", borderRadius: 3, border: `1px solid ${C.border}` }} />
          <button onClick={() => setSceneData(d => ({ ...d, bg: null }))} style={{ position: "absolute", top: 4, right: 4, width: 18, height: 18, background: "rgba(8,8,12,0.9)", border: "1px solid #3a1a1a", color: C.red, cursor: "pointer", borderRadius: 2, fontSize: 11, padding: 0 }}>✕</button>
        </div>
      ) : (
        <label style={{ display: "block", padding: "8px", textAlign: "center", border: `1px dashed ${C.border}`, borderRadius: 3, cursor: "pointer", fontSize: 10, color: C.textFaint, marginBottom: 6 }}>
          ＋ 背景画像
          <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => loadImage(e.target.files[0], 960, url => setSceneData(d => ({ ...d, bg: url })))} />
        </label>
      )}

      {/* 画面エフェクト（背景パーティクル・色調） */}
      <div style={{ fontSize: 9, color: C.textFaint, marginTop: 8, marginBottom: 3 }}>演出エフェクト</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 4 }}>
        {[["", "なし"], ...Object.entries(FX_PARTICLES).map(([k, v]) => [k, v.label])].map(([k, label]) => {
          const on = (sceneData.fx?.particles || "") === k;
          return <button key={k || "none"} onClick={() => setSceneData(d => ({ ...d, fx: { ...(d.fx || {}), particles: k } }))} style={{ padding: "3px 8px", fontSize: 9, cursor: "pointer", borderRadius: 10, background: on ? "rgba(121,134,203,0.25)" : "rgba(255,255,255,0.03)", border: `1px solid ${on ? "#7986cb" : C.border}`, color: on ? "#9fa8da" : C.textFaint }}>{label}</button>;
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 8 }}>
        {[["", "色調なし"], ...Object.entries(FX_TONE).map(([k, v]) => [k, v.label])].map(([k, label]) => {
          const on = (sceneData.fx?.tone || "") === k;
          return <button key={k || "none"} onClick={() => setSceneData(d => ({ ...d, fx: { ...(d.fx || {}), tone: k } }))} style={{ padding: "3px 8px", fontSize: 9, cursor: "pointer", borderRadius: 10, background: on ? "rgba(200,160,64,0.22)" : "rgba(255,255,255,0.03)", border: `1px solid ${on ? C.goldDim : C.border}`, color: on ? C.gold : C.textFaint }}>{label}</button>;
        })}
      </div>

      <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 3 }}>立ち絵（最大8体）</div>
      <div style={{ fontSize: 8, color: "#7a8aa0", marginBottom: 4, lineHeight: 1.5 }}>💡 画面上で立ち絵をドラッグして配置、タップで選択→サイズ(−/＋)・反転(⇄)・重なり順(△▽)・隠す(🙈)・削除。一覧の👁で表示/非表示を切替できます。</div>
      {(sceneData.portraits || []).map((p, i) => {
        const faces = facesOf(p);
        const curFace = Math.min(p.face || 0, faces.length - 1);
        return (
          <div key={i} style={{ marginBottom: 6, opacity: p.hidden ? 0.5 : 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
              <img src={p.img} alt="" style={{ width: 28, height: 48, objectFit: "contain", border: `1px solid ${C.border}`, borderRadius: 2 }} />
              <input value={p.name || ""} style={{ flex: 1, padding: "3px 5px", fontSize: 10, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.text, borderRadius: 2 }} onChange={e => updP(i, x => ({ ...x, name: e.target.value }))} placeholder="キャラ名" />
              <button title={p.hidden ? "表示する" : "隠す"} onClick={() => updP(i, x => ({ ...x, hidden: !x.hidden }))} style={{ width: 22, height: 18, background: p.hidden ? "rgba(255,255,255,0.04)" : "rgba(100,181,246,0.18)", border: `1px solid ${p.hidden ? C.border : C.blueBorder}`, color: p.hidden ? C.textFaint : C.blue, cursor: "pointer", borderRadius: 2, fontSize: 10, padding: 0 }}>{p.hidden ? "🙈" : "👁"}</button>
              <button onClick={() => setSceneData(d => ({ ...d, portraits: d.portraits.filter((_, j) => j !== i) }))} style={{ width: 18, height: 18, background: "rgba(192,57,43,0.2)", border: "1px solid #5a1a1a", color: C.red, cursor: "pointer", borderRadius: 2, fontSize: 10, padding: 0 }}>✕</button>
            </div>
            {/* 表情（複数画像を持たせてワンタップ切替） */}
            <div style={{ display: "flex", alignItems: "center", gap: 3, flexWrap: "wrap", paddingLeft: 33 }}>
              <span style={{ fontSize: 8, color: C.textFaint, marginRight: 1 }}>表情</span>
              {faces.map((f, k) => (
                <div key={k} style={{ position: "relative" }}>
                  <img src={f} alt="" onClick={() => selectFace(i, k)} title="この表情にする" style={{ width: 22, height: 22, objectFit: "cover", borderRadius: 2, cursor: "pointer", border: `2px solid ${k === curFace ? C.gold : C.border}` }} />
                  {faces.length > 1 && <button title="この表情を削除" onClick={() => removeFace(i, k)} style={{ position: "absolute", top: -5, right: -5, width: 13, height: 13, fontSize: 8, lineHeight: 1, background: "rgba(8,8,12,0.92)", border: "1px solid #5a1a1a", color: C.red, borderRadius: "50%", cursor: "pointer", padding: 0 }}>×</button>}
                </div>
              ))}
              <label title="表情を追加" style={{ width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", border: `1px dashed ${C.border}`, borderRadius: 2, cursor: "pointer", fontSize: 12, color: C.textFaint }}>＋
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => loadImage(e.target.files[0], 420, url => addFace(i, url), true)} />
              </label>
            </div>
          </div>
        );
      })}
      {(sceneData.portraits || []).length < 8 && (
        <label style={{ display: "block", padding: "5px", textAlign: "center", border: `1px dashed ${C.border}`, borderRadius: 3, cursor: "pointer", fontSize: 10, color: C.textFaint }}>
          ＋ 立ち絵を追加
          <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => loadImage(e.target.files[0], 420, url => setSceneData(d => ({ ...d, portraits: [...(d.portraits || []), { img: url, name: "" }] })), true)} />
        </label>
      )}

      {/* シーンプリセット（保存して再利用・事前にシーンを組める） */}
      {user?.uid && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 9, color: C.gold, marginBottom: 4 }}>🎬 シーンプリセット</div>
          <button onClick={savePreset} style={{ width: "100%", padding: "5px", fontSize: 10, cursor: "pointer", borderRadius: 3, background: "rgba(200,160,64,0.14)", border: `1px solid ${C.goldDim}`, color: C.gold }}>💾 現在のシーンを保存</button>
          {Object.entries(presets)
            .filter(([, pr]) => pr && typeof pr === "object")
            .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0)).map(([id, pr]) => (
            <div key={id} style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 4 }}>
              <button onClick={() => loadPreset(pr)} title="このシーンを読み込む" style={{ flex: 1, padding: "4px 7px", fontSize: 10, cursor: "pointer", borderRadius: 3, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.text, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>▶ {pr.name}</button>
              <button onClick={() => deletePreset(id, pr.name)} style={{ width: 20, height: 22, flexShrink: 0, background: "rgba(192,57,43,0.2)", border: "1px solid #5a1a1a", color: C.red, cursor: "pointer", borderRadius: 2, fontSize: 10, padding: 0 }}>✕</button>
            </div>
          ))}
          <div style={{ fontSize: 7, color: C.textFaint, marginTop: 3, lineHeight: 1.5 }}>※ 背景・立ち絵の画像を含むため、保存数が増えると重くなります。読込で現在のシーンを上書きします。</div>
        </div>
      )}
    </div>
  );
}

// ─── EpilogueView（終幕）: 決戦後・終了画面の前に挟む描写フェイズ ──────────
// 探索の描写モードと同じ形（背景＋立ち絵＋テキスト）。GM がシーンを編集し全員に見せてから終了画面へ。
export function EpilogueView({ gs, upd, isGm, sceneData, setSceneData, onProceed, user }) {
  const proceeding = useRef(false);
  const proceed = () => { if (!proceeding.current) { proceeding.current = true; onProceed(); } };

  return (
    <div style={{ position: "relative", width: "100%", height: "100vh", background: "#040608", fontFamily: "'Noto Serif JP', serif" }}>
      <SceneStage sceneData={sceneData} sceneText={gs.sceneText} editable={isGm} onChange={portraits => setSceneData(d => ({ ...d, portraits }))} />
      <div style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", fontSize: 13, color: "#d8c0a0", letterSpacing: 10, textShadow: "0 2px 8px #000", zIndex: 5 }}>◆ 終 幕 ◆</div>
      {isGm ? (
        <div style={{ position: "absolute", top: 0, right: 0, height: "100%", width: 300, boxSizing: "border-box", background: "rgba(6,8,16,0.93)", borderLeft: "1px solid #1e2535", padding: 14, overflowY: "auto", zIndex: 10 }}>
          <div style={{ fontSize: 11, color: "#c0a888", letterSpacing: 2, marginBottom: 10, paddingBottom: 5, borderBottom: `1px solid ${C.border}` }}>終幕の描写（背景・立ち絵・テキスト）</div>
          <SceneEditor gs={gs} upd={upd} sceneData={sceneData} setSceneData={setSceneData} showModeToggle={false} user={user} />
          <button onClick={proceed} style={{ width: "100%", marginTop: 16, padding: "11px", background: "rgba(180,140,90,0.16)", border: "1px solid #6a5436", borderRadius: 6, color: "#e0c89a", fontSize: 12, cursor: "pointer", letterSpacing: 2, fontFamily: "'Noto Serif JP', serif", boxShadow: "0 0 12px rgba(180,140,90,0.14)" }}>終了画面へ進む ▶</button>
        </div>
      ) : (
        <div style={{ position: "absolute", top: 16, right: 18, fontSize: 9, color: "#5a4a3a", letterSpacing: 2, zIndex: 5 }}>GMが終幕を進めています…</div>
      )}
    </div>
  );
}
