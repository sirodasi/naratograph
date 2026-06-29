import { useState, useEffect, useRef, useMemo } from "react";
import { CharSprite, CHARACTERS } from "./Lobby";
import { sfx } from "./audio";
import { motion } from "./motion";
import { fontScale } from "./fontScale";
import { bgm } from "./bgm";
import { SPOT_DETAILS } from "./data/spots";
import { EDGES, ADJACENT_MAP, OFFICIAL_DANMAKU_SKILLS } from "./data/gameData";
import { C, btnFull, btnSmall, iStyle } from "./styles/colors";
import { getSpellCardEffect } from "./data/spellCardEffects";
import { getAbilityEffect, applyAbilityPassiveStats, getActiveAbility, isAtBase } from "./data/abilityEffects";
import { applyStep, applyRandomResult, resolveCount, shiftNon25Horizontal } from "./data/effectHandlers";
import { getPreBattleFlavorRoll } from "./scenarios";
import { ACHIEVEMENTS, buildAchContext, aggregateLifetime, getAchievement, bumpAch, achAddTo } from "./data/achievements";
import { db, storage } from "./firebase";
import { ref as dbRef, set as dbSet, get as dbGet, remove as dbRemove } from "firebase/database";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

// ─── SpellCard フレームコンポーネント ────────────────────────────────
// 東方のスペルカード風の二重枠＋四隅ダイヤ装飾フレーム
export function SpellCard({ color = C.gold, title, headerRight, children, style = {}, contentStyle = {}, onClick }) {
  const dim = color + "44";
  const glow = color + "1a";
  return (
    <div onClick={onClick} style={{
      position: "relative",
      border: `1px solid ${color}`,
      borderRadius: 2,
      background: "rgba(4,4,12,0.93)",
      boxShadow: `0 0 20px ${glow}, inset 0 0 24px rgba(0,0,0,0.55)`,
      ...style,
    }}>
      {/* 内側の細枠 */}
      <div style={{
        position: "absolute", inset: 5,
        border: `1px solid ${dim}`,
        borderRadius: 1,
        pointerEvents: "none",
      }} />
      {/* 四隅のダイヤ装飾 */}
      {[{ top: -5, left: 12 }, { top: -5, right: 12 }, { bottom: -5, left: 12 }, { bottom: -5, right: 12 }].map((pos, i) => (
        <div key={i} style={{ position: "absolute", width: 10, height: 10, background: color, transform: "rotate(45deg)", ...pos }} />
      ))}
      {/* コンテンツ（内側枠より手前） */}
      <div style={{ position: "relative", zIndex: 1 }}>
        {title && (
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "8px 16px 7px",
            borderBottom: `1px solid ${dim}`,
            background: `linear-gradient(90deg, ${color}18 0%, transparent 70%)`,
          }}>
            <span style={{ fontSize: 11, color, letterSpacing: 3, fontFamily: "'Noto Serif JP', serif" }}>{title}</span>
            {headerRight}
          </div>
        )}
        <div style={{ padding: "10px 12px", ...contentStyle }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── ユーティリティ ───────────────────────────────────────────────
export function getSpotByD66(d1, d2, SPOTS) {
  const val = Math.min(d1, d2) * 10 + Math.max(d1, d2);
  const candidates = SPOTS.filter(s => s.roll === val);
  if (candidates.length === 2) {
    return (d1 < d2 ? candidates.find(s => s.id.endsWith("A")) : candidates.find(s => s.id.endsWith("B")))?.id;
  } else if (candidates.length === 1) {
    return candidates[0].id;
  }
  return null;
}

// ─── アイテムデータ ───────────────────────────────────────────────

export const ITEM_DATA = {
  "お酒": {
    timing: "いつでも",
    desc:    "自身の【やる気】が「1点」回復します。",
    canUse:  pc => (pc.items?.["お酒"] || 0) > 0 && !(pc.badStatus || []).includes("二日酔い"),
    use: (pc, gs) => {
      const resources = { ...pc.resources };
      if (!(pc.badStatus || []).includes("だるい")) {
        const r = resources.やる気 || { cur: 0, max: 3 };
        const isPremiumFriday = gs?.newspaper?.roll === 12 && pc.currentSpot === "11";
        const healAmount = isPremiumFriday ? 2 : 1;

        resources.やる気 = { cur: Math.min(r.cur + healAmount, r.max), max: r.max };
      }
      return { ...pc, items: { ...pc.items, "お酒": Math.max(0, (pc.items["お酒"] || 0) - 1) }, resources };
    },
  },
  "小銭": {
    timing: "行為判定直前",
    desc:    "次の行為判定の判定ダイス数が「1」増加します。",
    canUse:  () => false,
    use: (pc, _gs) => ({ ...pc, items: { ...pc.items, "小銭": Math.max(0, (pc.items["小銭"] || 0) - 1) }, flags: { ...pc.flags, money: true } }),
  },
  "お守り": {
    timing: "移動処理中",
    desc:    "移動で「6」が出たとき、ハプニングが発生せず6マス先まで移動できます。",
    canUse:  () => false,
    use: (pc, _gs) => ({ ...pc, items: { ...pc.items, "お守り": Math.max(0, (pc.items["お守り"] || 0) - 1) }, flags: { ...pc.flags, amulet: true } }),
  },
  "Pアイテム": {
    timing: "いつでも",
    desc:    "【霊力】を「3点」獲得します。",
    canUse:  pc => (pc.items?.["Pアイテム"] || 0) > 0 && !(pc.badStatus || []).includes("二日酔い"),
    use: (pc, _gs) => {
      const resources = { ...pc.resources };
      if (!(pc.badStatus || []).includes("スランプ")) {
        const r = resources.霊力 || { cur: 0, max: 30 };
        resources.霊力 = { cur: Math.min(r.cur + 3, r.max), max: r.max };
      }
      return { ...pc, items: { ...pc.items, "Pアイテム": Math.max(0, (pc.items["Pアイテム"] || 0) - 1) }, resources };
    },
  },
  "残機のかけら": {
    timing: "いつでも",
    desc:    "3つ消費して【残り人数】を「1点」獲得します。（3つ以上保持時のみ）",
    canUse:  pc => (pc.items?.["残機のかけら"] || 0) >= 3 && !(pc.badStatus || []).includes("二日酔い"),
    use: (pc, _gs) => {
      const resources = { ...pc.resources };
      const r = resources.残り人数 || { cur: 0, max: 5 };
      resources.残り人数 = { cur: Math.min(r.cur + 1, r.max), max: r.max };
      return { ...pc, items: { ...pc.items, "残機のかけら": Math.max(0, (pc.items["残機のかけら"] || 0) - 3) }, resources };
    },
  },
  "スペカのかけら": {
    timing: "いつでも",
    desc:    "2つ消費して【スペルカード】を「1点」獲得します。（2つ以上保持時のみ）",
    canUse:  pc => (pc.items?.["スペカのかけら"] || 0) >= 2 && !(pc.badStatus || []).includes("二日酔い"),
    use: (pc, _gs) => {
      const resources = { ...pc.resources };
      const r = resources.スペルカード || { cur: 0, max: 5 };
      resources.スペルカード = { cur: Math.min(r.cur + 1, r.max), max: r.max };
      return { ...pc, items: { ...pc.items, "スペカのかけら": Math.max(0, (pc.items["スペカのかけら"] || 0) - 2) }, resources };
    },
  },
  "妖器": {
    timing: "弾幕ごっこ前",
    desc:    "1ラウンドの間【攻撃力】が1点増加します。（輝針城の限定アイテム）",
    canUse:  pc => (pc.items?.["妖器"] || 0) > 0 && !(pc.badStatus || []).includes("二日酔い"),
    use: (pc, _gs) => {
      return { ...pc, items: { ...pc.items, "妖器": Math.max(0, (pc.items["妖器"] || 0) - 1) }, flags: { ...pc.flags, youki: true } };
    },
  },
};

export const INIT_RESOURCES = () => ({
  やる気:     { cur: 1, max: 3  },
  残り人数:   { cur: 2, max: 5  },
  スペルカード:     { cur: 1, max: 5  },
  グレイズ:   { cur: 0, max: 999 },
  霊力:       { cur: 0, max: 20 },
  攻撃力:     { cur: 1, max: 5  },
});

export const ITEM_NAMES = ["お酒", "小銭", "お守り", "Pアイテム", "残機のかけら", "スペカのかけら"];

export const INIT_ITEMS = () => ({
  お酒: 0, 小銭: 0, お守り: 0, Pアイテム: 0, 残機のかけら: 0, スペカのかけら: 0, 妖器: 0,
});

export const BAD_STATUS_TABLE = {
  1: { name: "だるい",   desc: "あなたの【やる気】は「1点」となり、いかなる処理によっても回復しません。" },
  2: { name: "スランプ", desc: "いかなる処理によってもあなたの【霊力】は増加しなくなります。" },
  3: { name: "二日酔い", desc: "あなたはアイテムを使用することができません。" },
  4: { name: "怪我",     desc: "行為判定の際にダイスを2つまでしか振ることができなくなります。" },
  5: { name: "不機嫌",   desc: "あなたは絆を獲得できなくなり、他のキャラクターもあなたへの絆を獲得できません。" },
  6: { name: "疲れた",   desc: "「移動」の処理で移動できる距離が1スポット分少なくなります。" },
};

const SKILL_TYPE_COLOR = { "オート": "#81c784", "アクション": "#64b5f6", "サポート": "#ffb74d" };
// 発動可能スキルの強調：ブロック枠（左アクセント＋淡い地＋内側グロー）と発動ボタン
const skillReadyBox = (color) => ({ borderLeft: `3px solid ${color}`, background: `${color}12`, borderRadius: 4, padding: "6px 8px", boxShadow: `inset 0 0 0 1px ${color}26` });
const skillActivateBtn = (color) => ({ padding: "5px 14px", cursor: "pointer", borderRadius: 4, fontSize: 11, fontWeight: 700, background: `${color}30`, border: `1px solid ${color}`, color, boxShadow: `0 0 7px ${color}45` });
// 人を狂わす程度の能力の「絆なし応援」を表す擬似絆ラベル（bondUsed ではなく kuruwasuUsed[対象] を消費）
const KURUWASU_BOND = "（絆なし応援）";
// 特別な絆の応援を表す擬似絆ラベル（成長で獲得した specialBond を使う応援）
const SPECIAL_BOND_CHEER = "（特別な絆応援）";

// 特別な絆の親密度: targetUid を対象に持つ特別な絆の保持者全員の親密度を amount 増やす（初期1・最大10）。
// 増加（対象のスペシャル/交流）のたびに応援欄(used)をリフレッシュする。
// 戻り値 { pcs, logs }（変化があった保持者のログ）。
function gainIntimacy(pcs, targetUid, amount, reason) {
  if (!targetUid || amount <= 0) return { pcs, logs: [] };
  const logs = [];
  const next = (pcs || []).map(pc => {
    if (pc.specialBond && pc.specialBond.targetUid === targetUid && pc.uid !== targetUid) {
      const cur = pc.specialBond.intimacy ?? 1;
      const ni = Math.min(10, cur + amount);
      if (ni !== cur || pc.specialBond.used) {
        logs.push(`💞 ${pc.charName} の《${pc.specialBond.target}への${pc.specialBond.word || "敬意"}》親密度 ${cur}→${ni}${reason ? `（${reason}）` : ""}`);
      }
      return { ...pc, specialBond: { ...pc.specialBond, intimacy: ni, used: false } };
    }
    return pc;
  });
  return { pcs: next, logs };
}

// 変調免疫チェック（馬鹿スキル用）
export function isBadStatusImmune(pc, bsName) {
  return pc?.ps?.name === "馬鹿" && pc.badStatusImmune === bsName;
}

// 個性スキルの一回限り使用済みフラグキー
export const PS_ONCE_FLAG = "psUsedThisSession";

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

// ─── 描写エフェクト（背景パーティクル・色調） ──────────────────────────────
const FX_PARTICLES = {
  sakura: { char: "❀", color: "#f7b8d0", size: [10, 22], dur: [6, 12], count: 26, line: false, label: "桜" },
  snow:   { char: "•", color: "#eaf4ff", size: [5, 12], dur: [7, 15], count: 38, line: false, label: "雪" },
  petal:  { char: "✦", color: "#fff3c0", size: [8, 16], dur: [8, 16], count: 22, line: false, label: "光粒" },
  rain:   { char: "",  color: "rgba(170,200,255,0.5)", size: [10, 22], dur: [0.5, 1.1], count: 64, line: true, label: "雨" },
};
const FX_TONE = {
  sunset: { bg: "rgba(255,120,45,0.26)", label: "夕焼け" },
  night:  { bg: "rgba(26,40,86,0.46)",   label: "夜" },
  sepia:  { bg: "rgba(120,92,52,0.40)",  label: "セピア" },
  dark:   { bg: "rgba(0,0,0,0.6)",       label: "暗転" },
  warm:   { bg: "rgba(255,180,90,0.16)", label: "暖色" },
};

function SceneParticles({ kind }) {
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

// 描写画像を Firebase Storage 経由で保存するか。Spark プランは Storage が Blaze 必須で使えないため
// false（data URL で RTDB に直接保存）。Blaze にアップグレードしバケット＋CORS を設定したら true に。
const SCENE_IMG_USE_STORAGE = false;

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
  const [presets, setPresets] = useState({});
  useEffect(() => {
    if (!user?.uid) return;
    dbGet(dbRef(db, `users/${user.uid}/scenePresets`)).then(snap => { if (snap.exists()) setPresets(snap.val()); }).catch(() => {});
  }, [user?.uid]);
  const savePreset = async () => {
    if (!user?.uid) return;
    const name = window.prompt("シーン名を入力してください", `シーン${Object.keys(presets).length + 1}`);
    if (!name || !name.trim()) return;
    const id = `p_${Date.now()}`;
    const preset = { name: name.trim(), bg: sceneData.bg || null, portraits: sceneData.portraits || [], fx: sceneData.fx || null, text: gs.sceneText || "", createdAt: Date.now() };
    try { await dbSet(dbRef(db, `users/${user.uid}/scenePresets/${id}`), preset); setPresets(p => ({ ...p, [id]: preset })); } catch (e) { console.error(e); alert("保存に失敗しました（画像が大きすぎる可能性があります）"); }
  };
  const loadPreset = (pr) => {
    setSceneData(() => ({ bg: pr.bg || null, portraits: pr.portraits || [], fx: pr.fx || {} }));
    upd(p => ({ ...p, sceneText: pr.text || "" }));
  };
  const deletePreset = async (id, name) => {
    if (!user?.uid || !window.confirm(`シーン「${name}」を削除しますか？`)) return;
    try { await dbRemove(dbRef(db, `users/${user.uid}/scenePresets/${id}`)); setPresets(p => { const n = { ...p }; delete n[id]; return n; }); } catch (e) { console.error(e); }
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

function BattleGrid({ name, grid, pos, isCombatant, isNpc, sprite, isDead, highlightCells = [], onCellClick, lives, maxLives, sc }) {
  const cells = [1, 2, 3, 4, 5, 6];
  const campColor = isNpc ? C.red : C.blue;
  const borderColor = isCombatant ? campColor : C.border;

  // 弾幕増加を検出して効果音を鳴らす
  const prevGridRef = useRef(null);
  useEffect(() => {
    const curr = grid || [0,0,0,0,0,0];
    if (prevGridRef.current !== null) {
      const prev = prevGridRef.current;
      if (curr.some((v, i) => v > (prev[i] || 0))) sfx.bullet(isNpc);
    }
    prevGridRef.current = [...curr];
  }, [grid, isNpc]);

  return (
    <div style={{
      position: "relative",
      width: 210,
      opacity: isDead ? 0.35 : 1,
      border: `2px solid ${borderColor}`,
      borderRadius: 6,
      background: "rgba(8,10,18,0.9)",
      padding: 6,
      boxShadow: isCombatant
        ? `0 0 22px ${campColor}44, inset 0 0 18px rgba(0,0,0,0.55)`
        : "inset 0 0 12px rgba(0,0,0,0.4)",
      transition: "box-shadow 0.3s, border-color 0.3s",
    }}>
      <style>{`
        @keyframes pulseHighlight {
          0% { box-shadow: inset 0 0 2px ${C.blue}; background: rgba(100, 181, 246, 0.1); }
          50% { box-shadow: inset 0 0 15px ${C.blue}; background: rgba(100, 181, 246, 0.3); }
          100% { box-shadow: inset 0 0 2px ${C.blue}; background: rgba(100, 181, 246, 0.1); }
        }
        @keyframes bulletIn {
          0%   { transform: scale(0); opacity: 0; }
          60%  { transform: scale(1.4); opacity: 1; }
          100% { transform: scale(1);  opacity: 1; }
        }
      `}</style>

      {/* アクティブ時の内側装飾枠 */}
      {isCombatant && (
        <div style={{ position: "absolute", inset: 4, border: `1px solid ${campColor}44`, borderRadius: 3, pointerEvents: "none" }} />
      )}

      <div style={{ fontSize: 10, color: isCombatant ? campColor : C.textDim, textAlign: "center", marginBottom: 5, fontWeight: "bold", letterSpacing: 1 }}>
        {name}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gridTemplateRows: "repeat(2, 56px)", gap: 4 }}>
        {cells.map(num => {
          const danmakuCount = grid ? grid[num - 1] : 0;
          const hasChar = pos === num;
          const isHighlighted = highlightCells.includes(num);

          return (
            <div
              key={num}
              onClick={() => isHighlighted && onCellClick && onCellClick(num)}
              style={{
                position: "relative",
                background: hasChar ? `${campColor}10` : "rgba(255,255,255,0.02)",
                border: `1px solid ${hasChar ? campColor : isHighlighted ? C.blue : "rgba(255,255,255,0.08)"}`,
                borderRadius: 4,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: isHighlighted ? "pointer" : "default",
                animation: isHighlighted ? "pulseHighlight 1.5s infinite" : "none",
                transition: "all 0.2s",
              }}
            >
              <div style={{ position: "absolute", top: 2, left: 3, fontSize: 8, color: "rgba(255,255,255,0.18)" }}>{num}</div>

              {/* 駒のいないマス: 弾幕をドット雲で表示 */}
              {danmakuCount > 0 && !hasChar && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 2, justifyContent: "center", padding: 3 }}>
                  {[...Array(Math.min(danmakuCount, 9))].map((_, i) => (
                    <div key={i} style={{ width: 9, height: 9, borderRadius: "50%", background: isNpc ? C.blue : C.red, boxShadow: `0 0 4px ${isNpc ? C.blue : C.red}88`, animation: `bulletIn 0.28s ease-out ${i * 0.04}s both` }} />
                  ))}
                  {danmakuCount > 9 && <span style={{ fontSize: 8, color: isNpc ? C.blue : C.red }}>{danmakuCount}</span>}
                </div>
              )}

              {hasChar && (
                <div style={{ position: "absolute", inset: 2, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}>
                  {sprite}
                </div>
              )}

              {/* 駒のいるマス: 弾幕は数バッジ化して駒の上に重ねず常に視認できるようにする */}
              {hasChar && danmakuCount > 0 && (
                <div style={{
                  position: "absolute", top: 1, right: 1, zIndex: 3,
                  minWidth: 15, height: 15, padding: "0 3px", boxSizing: "border-box",
                  borderRadius: 8, background: isNpc ? C.blue : C.red, color: "#fff",
                  fontSize: 9, fontWeight: "bold", lineHeight: "15px", textAlign: "center",
                  border: "1px solid rgba(0,0,0,0.5)",
                  boxShadow: `0 0 6px ${isNpc ? C.blue : C.red}`,
                  animation: "bulletIn 0.28s ease-out both",
                }}>
                  {danmakuCount}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ステータスバー */}
      {(lives !== undefined || sc !== undefined) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 5, padding: "3px 2px", borderTop: `1px solid rgba(255,255,255,0.06)` }}>
          {lives !== undefined && (
            <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
              {[...Array(maxLives || 3)].map((_, i) => (
                <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: i < lives ? campColor : "rgba(255,255,255,0.1)", boxShadow: i < lives ? `0 0 5px ${campColor}99` : "none" }} />
              ))}
            </div>
          )}
          {sc !== undefined && (
            <div style={{ fontSize: 9, color: C.gold, letterSpacing: 1 }}>◇×{sc}</div>
          )}
        </div>
      )}
    </div>
  );
}

// 弾幕ごっこのフェーズ表示用ラベル
const PHASE_LABELS = {
  setup:             "対戦準備",
  round_start:       "対戦者選出",
  pc_shot_intro:     "PCショット宣言",
  pc_shot_roll:      "PCショット",
  pc_shot_after:     "PCショット後",
  npc_shot_intro:    "NPCショット宣言",
  npc_shot_roll:     "NPCショット",
  npc_shot_after:    "NPCショット後",
  pc_evade_intro:    "PC回避判定",
  pc_evade_result:   "PC回避結果",
  pc_evade_move:     "PC回避移動",
  npc_evade_intro:   "NPC回避判定",
  npc_evade_move:    "NPC回避移動",
  pc_hit_check:      "PC当たり判定",
  npc_hit_check:     "NPC当たり判定",
  pc_hit_recovery:   "PC復帰",
  npc_hit_recovery:  "NPC復帰",
  pc_dropout:        "PC脱落",
  npc_dropout:       "NPC脱落",
  round_end_check:   "ラウンド終了確認",
  cleanup:           "ラウンド終了処理",
  result:            "結果",
};

const TIMING_RULES = [
  { key: "round_start", re: /ラウンドの?開始時/       },
  { key: "evade",       re: /回避ステップ/            },
  { key: "hit",         re: /被弾|【残り人数】を減少/ },
];

const EFFECT_PATTERNS = [
  { type: "SELF",     re: /【自機マス×(\d+)】/g                },
  { type: "ENEMY",    re: /【敵機マス×(\d+)】/g               },
  { type: "ADJACENT", re: /【隣接マス×(\d+)】/g               },
  { type: "CHOOSE",   re: /【指定マス×(\d+)】/g               },
  { type: "RANDOM",   re: /【ランダム×(\d+|X)】/g             },
  { type: "FIXED",    re: /【(\d+)番マス×(\d+)】/g           },
];

// スペカ条件文を抽出する
// 条件文は通常「このスペルカード」で始まり、キーワード(できない等)を含む。
// 名前や効果記号【...×N】と同じ文（句点なし）に連結されているケースに対応するため、
// まず「このスペルカード」位置で前段を切り捨ててから、「。」で文区切りして該当文を返す。
const CONDITION_KEYWORD_RE = /(?:できない|限り使用できない|場合にしか使用できない)/;
function extractCondition(text) {
  if (!text) return null;
  const startIdx = text.indexOf("このスペルカード");
  const searchText = startIdx >= 0 ? text.slice(startIdx) : text;
  const sentences = searchText.split("。").map(s => s.trim()).filter(Boolean);
  const condSentence = sentences.find(s => CONDITION_KEYWORD_RE.test(s));
  return condSentence ? condSentence + "。" : null;
}

// ─── 弾幕スキルユーティリティ（BattleView / BattleRightPanel 共用） ─────
export function hasOfficialSkill(entity, skillName) {
  if (!entity) return false;
  const dsName = (entity.ds && entity.ds.name) || entity.dsName
    || entity.skillName || (entity.ps && entity.ps.name) || null;
  if (!dsName) return false;
  const isOfficial = OFFICIAL_DANMAKU_SKILLS.some(s => s.name === dsName);
  return isOfficial && dsName === skillName;
}

// 弾幕スキル使用済み判定（純粋関数版・BattleView 内クロージャと同仕様）
// usedds の形式: { [attackerId]: string[] }
export function isSkillUsed(usedds, attackerId, skillName) {
  return !!(usedds && usedds[attackerId] && usedds[attackerId].includes(skillName));
}

// 弾幕スキルを使用済みに追加（純粋関数版・元のオブジェクトは変更しない）
export function markSkillUsed(usedds, attackerId, skillName) {
  if (!attackerId) return usedds || {};
  const base = usedds || {};
  return {
    ...base,
    [attackerId]: [...(base[attackerId] || []), skillName],
  };
}

// ─── 戦闘NPC生成 / 勝敗判定（純粋関数・クエスト戦/決戦で共用） ─────────
// シナリオの enemy データ（クエスト enemy / extraEnemies / finalBattleEnemies 等）を
// 戦闘中の NPC オブジェクトに変換する。回避力・グレイズも含め全戦闘で統一する。
// opts.primary または enemy.primary が真なら primary フラグを付与（決戦の主敵）。
export function buildBattleNpc(enemy, id, opts = {}) {
  if (!enemy) return null;
  const npc = {
    id,
    name: enemy.name || "敵",
    resources: {
      残り人数: { cur: enemy.life, max: 5 },
      スペルカード: { cur: enemy.spellcard, max: 5 },
      攻撃力: { cur: enemy.attack, max: 99 },
      回避力: { cur: enemy.evade || 3, max: 3 },
      グレイズ: { cur: 0, max: 5 },
    },
    ds: enemy.ds ?? { name: enemy.dsName || enemy.dsCustomName || "", desc: enemy.dsDesc || "" },
    spellCards: [
      { name: enemy.sc1name, desc: enemy.sc1effect, ...(enemy.sc1ref ? { ref: enemy.sc1ref } : {}) },
      { name: enemy.sc2name, desc: enemy.sc2effect, ...(enemy.sc2ref ? { ref: enemy.sc2ref } : {}) },
    ].filter(s => s.name),
  };
  if (opts.primary || enemy.primary) npc.primary = true;
  if (enemy.customPortrait) npc.customPortrait = enemy.customPortrait;
  return npc;
}

// 戦闘中のNPC立ち絵を解決する。カスタム画像 > 名前一致のキャラスプライト > 絵文字 の優先順。
export function renderEnemySprite(npc, size = 40) {
  if (npc?.customPortrait) {
    return <img src={npc.customPortrait} alt="" style={{ width: "92%", height: "92%", objectFit: "cover", borderRadius: 3 }} />;
  }
  const match = npc?.name ? CHARACTERS.find(c => c.name === npc.name) : null;
  if (match) return <CharSprite spriteRow={match.spriteRow} spriteCol={match.spriteCol} size={size} />;
  return <div style={{ fontSize: Math.round(size * 0.6) }}>👿</div>;
}

// NPC陣営が敗北（＝PC勝利条件を満たす）かを判定する。
// primary（主敵）が1体でも指定されていれば「全ての主敵が脱落」で敗北＝決戦は主敵撃破で終了。
// primary が無ければ従来通り「全NPC脱落」。
export function isNpcSideDefeated(npcs) {
  const list = npcs || [];
  const isDead = n => (n.resources?.残り人数?.cur || 0) <= 0;
  const primaries = list.filter(n => n.primary);
  return primaries.length > 0 ? primaries.every(isDead) : list.every(isDead);
}

// ショット時の総ダイス数を計算（使い魔習得者は -1、最低 1）
export function calcShotDiceCount(attackPower, supportDice, hasFamiliar) {
  return Math.max(1, (attackPower || 0) + (supportDice || 0) - (hasFamiliar ? 1 : 0));
}

// 剣術を扱う程度の能力（オート）: 弾幕ごっこ参加時の実効攻撃力を返す。
// base = 決戦フェイズ以外で霊力に関わらず4固定。＋ = 常に「4以下なら4」（4未満を4に底上げ）。
// PC以外（NPC）や非該当能力は通常の攻撃力をそのまま返す。
export function effectiveAttackPower(entity, sessionPhase) {
  const base = entity?.resources?.攻撃力?.cur ?? 1;
  const ab = (entity?.growthAbilityUnlocked && entity?.growthAbility?.name) ? entity.growthAbility : entity?.as;
  const name = ab?.name;
  if (name === "剣術を扱う程度の能力" && sessionPhase !== "battle") return 4;
  if (name === "剣術を扱う程度の能力＋") return Math.max(base, 4);
  return base;
}

// かばう/使い魔自動かばう処理: 指定マスに弾幕があれば1つ除去
// 元の grid 配列は変更せず、新しい配列と成否を返す
export function resolveCover(grid, die) {
  const base = grid || [0, 0, 0, 0, 0, 0];
  const next = [...base];
  const success = next[die - 1] > 0;
  if (success) next[die - 1] -= 1;
  return { grid: next, success };
}

export function parseSpell(text) {
  // タイミング
  let timing = "standard";
  for (const { key, re } of TIMING_RULES) {
    if (re.test(text)) { timing = key; break; }
  }

  // 効果タイミング（宣言はstandard・効果発揮がラウンド終了時）
  const effectTiming = /ラウンドの?終了時/.test(text) ? "round_end" : "immediate";

  // 効果リスト
  const effects = [];
  for (const { type, re } of EFFECT_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (type === "FIXED") {
        effects.push({ type, cell: parseInt(m[1]), count: parseInt(m[2]) });
      } else {
        effects.push({ type, count: m[1] === "X" ? -1 : parseInt(m[1]) });
      }
    }
  }

  // 宣言条件（テキスト抽出のみ、自動チェックはしない）
  const condition = extractCondition(text);

  // 本文から条件文を取り除いたもの（重複表示の防止に使う）
  const textBody = condition ? text.replace(condition, "").trim() : text;

  return {
    timing,
    effectTiming,
    effects,
    manual: effects.length === 0,  // キーワードなし → 手動
    condition,
    textBody,
  };
}

// declareSpell（および周辺）が宣言時に自動処理する structured.effects の type 一覧。
// ここに無い effect type は「GM が手動で処理する」案内を宣言UIに出す（黙殺防止）。
// 効果を自動化したら、ここへ type を追加すると案内が自動的に消える。
export const AUTO_HANDLED_EFFECTS = new Set([
  "extra_support_cover",
  "extra_support_cover_with_die_choice",
  "double_support_cover",                 // 上海人形: 援護/かばう2回
  "extra_familiar_per_round_this_phase",  // ホークビーコン: フェイズ中・毎ラウンド1回
  "enemy_forced_to_attacker_number_cell",
  "enemy_move_adjacent_if_same_number",
  "enemy_move_adjacent",
  "self_move_any",
  "self_move_empty",
  "pre_self_move_adjacent",       // 死歌/怒面/貧符: 配置前に自機を隣接マスへ移動
  "shift_non_25_horizontal",
  // ─ 回避ステップのフラグ系 ─
  "enemy_may_stay_on_dodge",     // 正直者の死/吉弔大結界: 回避側がその場にとどまれる
  "next_dodge_no_evasion_loss",  // オプティカルカモフラージュ: 次の回避で回避力を消費しない
  // ─ 任意実行 ─
  "optional_redo_random",        // ブラックペガサス流星弾: 任意で再配置
  "optional_clear_then_random",  // ドリームキャッチャー: 任意数除去→ランダム
  // ─ ラウンド終了時の自己ペナルティ ─
  "self_hp_loss_if_no_damage",   // 太陽を盗んだ鴉: 被弾なしならラウンド終了時に残り人数-1
  // ─ 回避中のグレイズ同調 ─
  "mirror_graze_gain",           // ミシガンロール: 相手のグレイズ獲得時に同量獲得
  // ─ 被弾時の追加ダメージ ─
  "extra_hp_loss_if_same_cell_fail",  // 余命幾許: 同番号マスで回避失敗→追加で残り人数-1
  // ─ 回避成功直後の追加配置 ─
  "place_at_enemy_after_first_dodge", // 全霊鬼渡り: 回避側の移動先マスに配置
  "random_3d_after_first_dodge",      // マッスル/狐符: 回避成功直後に3D振り追加配置
  // ─ 配置直後の grid 操作（declareSpell のランダム配置後に自動処理） ─
  "remove_from_enemy_cell",
  "remove_if_hit_enemy_cell",
  // ─ 回避力変動（resources.回避力.cur を一時変更、ラウンド終了で復元） ─
  "reduce_enemy_evasion",
  "increase_enemy_evasion",
  "reduce_own_evasion",
  "costs_own_evasion",
  // ─ 宣言時の即時リソース操作 ─
  "reset_graze",   // バレットドミニオン/マーケット: グレイズを0に
  "costs_rei",     // 五穀豊穣ライスシャワー: 霊力消費
  "no_sc_cost",    // 幻想春花: SC消費なし
]);

// スペカテキスト/スペルオブジェクトからフルオブジェクトを組み立てる
export function buildSpellCard(card) {
  if (!card) return null;

  const text = typeof card === "string"
    ? card
    : card.text ?? card.desc ?? "";

  const nameMatch = text.match(/^(.+?[」])/);
  const name = typeof card === "string"
    ? (nameMatch ? nameMatch[1] : text.slice(0, 20))
    : card.name ?? (nameMatch ? nameMatch[1] : text.slice(0, 20));

  const parsed = parseSpell(text);
  const structured = getSpellCardEffect((typeof card === "object" ? card.ref : null) || name) || null;

  // 構造化データの timing が round_end なら effectTiming に反映
  if (structured?.timing === "round_end") parsed.effectTiming = "round_end";
  // 構造化データの timing は宣言タイミング判定の正本（テキスト解析より優先）
  if (structured?.timing) parsed.timing = structured.timing;
  // 構造化データが full/partial なら手動フラグを解除
  if (structured && structured.auto !== "manual") parsed.manual = false;

  const displayText = text || (structured
    ? (structured.note || `【${name}】の効果は自動処理されます（${structured.auto === "full" ? "完全自動" : structured.auto === "partial" ? "一部自動" : "GM手動"}）`)
    : "");

  // 自動処理できない structured.effects（要GM手動）を抽出。宣言UIで警告表示に使う。
  const manualEffects = (structured?.effects || [])
    .filter(e => !AUTO_HANDLED_EFFECTS.has(e.type))
    .map(e => e.type);

  return {
    ...card,
    name,
    text: displayText,
    ...parsed,
    structured,
    manualEffects,
    structuredNote: structured?.note || null,
  };
}

// Firebase に書き込むpendingSpell/manualSpell用のスリム形。
// 派生フィールド (effects, condition, textBody, timing, effectTiming, structured) は
// 持たず、表示・適用時は expandStoredSpell で再構築する。
function slimSpellForStorage(spellCard) {
  if (!spellCard) return null;
  return {
    name:   spellCard.name,
    text:   spellCard.text,
    manual: spellCard.manual ?? false,
    ...(spellCard.ref ? { ref: spellCard.ref } : {}),
  };
}

// Firebase から読み出した pendingSpell/manualSpell を、派生フィールド付きで再構築する。
// 旧データ（フル展開済み）も互換的に扱える。
export function expandStoredSpell(stored) {
  if (!stored) return null;
  // text があれば buildSpellCard で派生を補完。位置情報などの追加フィールドは保持する。
  if (stored.text) {
    return { ...buildSpellCard({ name: stored.name, text: stored.text, ref: stored.ref }), ...stored };
  }
  return stored;
}

function BattleParticleCanvas() {
  const ref = useRef(null);
  useEffect(() => {
    if (motion.reduced) return;  // 演出抑制時はパーティクルを描画しない（JS canvas は CSS で止まらない）
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    let raf;
    const resize = () => {
      cv.width  = cv.offsetWidth  || cv.parentElement?.offsetWidth  || 800;
      cv.height = cv.offsetHeight || cv.parentElement?.offsetHeight || 600;
    };
    resize();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    if (ro && cv.parentElement) ro.observe(cv.parentElement);

    const mk = (initY) => ({
      x: Math.random() * (cv.width  || 800),
      y: initY ?? -8,
      r: 1.2 + Math.random() * 2.2,
      vx: (Math.random() - 0.5) * 0.7,
      vy: 0.55 + Math.random() * 1.3,
      isNpc: Math.random() < 0.55,
      a: 0.05 + Math.random() * 0.09,
    });
    const pts = Array.from({ length: 48 }, (_, _i) =>
      mk(Math.random() * ((cv.height || 600) + 20))
    );

    const draw = () => {
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.isNpc ? "#3b7ccc" : "#cc3b3b";
        ctx.globalAlpha = p.a;
        ctx.fill();
        p.x += p.vx;
        p.y += p.vy;
        if (p.y > cv.height + 12) pts[i] = mk();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); };
  }, []);
  return (
    <canvas
      ref={ref}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 0 }}
    />
  );
}

function SpellDeclareItem({ spell, cardColor, declareSpell, isPcAttacker }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        marginBottom: 6, border: `1px solid ${hov ? cardColor + "88" : C.border}`, borderRadius: 4, overflow: "hidden",
        transform: hov ? "scale(1.025) translateY(-1px)" : "scale(1)",
        boxShadow: hov ? `0 4px 14px ${cardColor}44` : "none",
        transition: "transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease",
      }}
    >
      <div style={{ padding: "6px 8px", background: hov ? `${cardColor}0d` : "rgba(255,255,255,0.03)", transition: "background 0.16s ease" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: spell.manual ? C.textDim : C.gold, marginBottom: 2 }}>{spell.name}</div>
            <div style={{ fontSize: 9, color: C.textFaint, lineHeight: 1.5 }}>{spell.textBody || spell.text}</div>
            {spell.condition && (
              <div style={{ fontSize: 9, color: C.red, marginTop: 3 }}>⚠ {spell.condition}</div>
            )}
            {spell.manual && (
              <div style={{ fontSize: 9, color: "#5a6070", marginTop: 3 }}>★ 効果はGMが手動処理</div>
            )}
            {!spell.manual && spell.manualEffects?.length > 0 && (
              <div style={{ fontSize: 9, color: "#ffb74d", marginTop: 3 }}>
                ⚠ 配置以外の効果はGMが手動で処理してください{spell.structuredNote ? `（${spell.structuredNote}）` : ""}
              </div>
            )}
            {spell.effectTiming === "round_end" && (
              <div style={{ fontSize: 9, color: "#ef9a9a", marginTop: 3 }}>⏰ ラウンド終了時に効果発動</div>
            )}
            {spell.effects.some(e => e.count === -1) && (!spell.structured || spell.structured.auto === "manual") && (
              <div style={{ fontSize: 9, color: C.blue, marginTop: 3 }}>※ 枚数は宣言時に確認</div>
            )}
          </div>
          <button
            onClick={() => {
              const needCount = spell.effects.some(e => e.count === -1) && (!spell.structured || spell.structured.auto === "manual");
              if (needCount) {
                const n = parseInt(window.prompt("配置する弾幕の数を入力してください", "1"));
                if (!isNaN(n) && n > 0) declareSpell(spell, isPcAttacker, n);
              } else {
                declareSpell(spell, isPcAttacker, null);
              }
            }}
            style={{ flexShrink: 0, padding: "4px 10px", fontSize: 10, cursor: "pointer",
              background: hov ? "rgba(200,160,64,0.35)" : "rgba(200,160,64,0.2)",
              border: `1px solid ${C.goldDim}`,
              color: C.gold, borderRadius: 3, transition: "background 0.16s ease" }}
          >宣言</button>
        </div>
      </div>
    </div>
  );
}

export function BattleView({ gs, upd, user, isGm, animateDice, sceneData }) {
  // b は実際には常に存在する（battle.active 時のみ描画）。フックを無条件に呼ぶため || {} で安全化し、
  // 実際の null 判定はフック群の後で行う（rules-of-hooks 準拠）。
  const b = gs.battle || {};

  const allPcs = gs.pcs || [];
  const pcs = b.participantPcUids
    ? allPcs.filter(pc => b.participantPcUids.includes(pc.uid))
    : allPcs;
  const npcs = useMemo(() => b.participants?.npcs || [], [b.participants?.npcs]);

  const alivePcs = pcs.filter(p => (p.resources?.残り人数?.cur || 0) > 0);
  const aliveNpcs = npcs.filter(n => (n.resources?.残り人数?.cur || 0) > 0);
  // NPC陣営の敗北（=PC勝利条件）。主敵指定があれば「全主敵脱落」、無ければ「全NPC脱落」。
  const npcsDefeated = isNpcSideDefeated(npcs);

  let unactedPcs = alivePcs.filter(p => !(b.actedPcs || []).includes(p.uid));
  let unactedNpcs = aliveNpcs.filter(n => !(b.actedNpcs || []).includes(n.id));

  useEffect(() => {
    if (b.phase !== "round_start") return;
    const shouldResetPcs = unactedPcs.length === 0 && alivePcs.length > 0 && (b.actedPcs || []).length > 0;
    const shouldResetNpcs = unactedNpcs.length === 0 && aliveNpcs.length > 0 && (b.actedNpcs || []).length > 0;
    if (!shouldResetPcs && !shouldResetNpcs) return;

    const nextActedPcs = shouldResetPcs ? [] : (b.actedPcs || []);
    const nextActedNpcs = shouldResetNpcs ? [] : (b.actedNpcs || []);
    const resetLogs = [];
    if (shouldResetPcs) resetLogs.push("🔄 PC陣営が全員行動したため、全員未行動に戻ります。");
    if (shouldResetNpcs) resetLogs.push("🔄 NPC陣営が全員行動したため、全員未行動に戻ります。");

    upd(p => ({
      ...p,
      battle: {
        ...p.battle,
        actedPcs: nextActedPcs,
        actedNpcs: nextActedNpcs
      },
      log: [...resetLogs.reverse(), ...p.log]
    }));
  }, [b.phase, alivePcs.length, aliveNpcs.length, unactedPcs.length, unactedNpcs.length, b.actedPcs, b.actedNpcs, upd]);

  // 使い魔: スキップ → ショットイントロで自動援護射撃（PC/NPC両対応・状態は独立管理）
  useEffect(() => {
    if (b.phase === "pc_shot_intro" && b.pcFamiliarAction === "skip_to_support") {
      upd(p => {
        const pc = p.pcs.find(x => x.uid === p.battle.pcCombatant);
        if (!pc || !hasOfficialSkill(pc, "使い魔")) return p;
        return {
          ...p,
          battle: { ...p.battle, supportDice: (p.battle.supportDice || 0) + 1, pcFamiliarAction: "done" },
          log: [`💠 ${pc.charName} の使い魔が自動援護射撃！攻撃ダイス+1`, ...p.log],
        };
      });
    } else if (b.phase === "npc_shot_intro" && b.npcFamiliarAction === "skip_to_support") {
      upd(p => {
        const npc = p.battle.participants.npcs.find(n => n.id === p.battle.npcCombatant);
        if (!npc || !hasOfficialSkill(npc, "使い魔")) return p;
        return {
          ...p,
          battle: { ...p.battle, supportDice: (p.battle.supportDice || 0) + 1, npcFamiliarAction: "done" },
          log: [`💠 ${npc.name} の使い魔が自動援護射撃！攻撃ダイス+1`, ...p.log],
        };
      });
    }
  }, [b.phase, b.pcFamiliarAction, b.npcFamiliarAction, upd]);

  // ── サウンドON/OFF ────────────────────────────────────────────────
  const [sfxMuted, setSfxMuted] = useState(!sfx.enabled);
  const toggleSfx = () => { sfx.toggle(); setSfxMuted(!sfx.enabled); };

  // ── スペルカード宣言フラッシュ ──────────────────────────────────────
  const [spellFlash, setSpellFlash] = useState(null);
  const flashKey = useRef({ round: -1, known: new Set() });
  useEffect(() => {
    const curr = b.spellUsedBy || {};
    const fk = flashKey.current;
    if (b.round !== fk.round) { fk.round = b.round; fk.known = new Set(); }
    for (const [id, spellName] of Object.entries(curr)) {
      if (!fk.known.has(id)) {
        fk.known.add(id);
        const attacker = pcs.find(p => p.uid === id) || npcs.find(n => n.id === id);
        const isNpcAtk  = !pcs.find(p => p.uid === id);
        const charMatch = isNpcAtk ? CHARACTERS.find(c => c.name === attacker?.name) : null;
        setSpellFlash({ name: spellName, attackerName: attacker?.charName || attacker?.name || "???", color: isNpcAtk ? C.red : C.blue, spriteRow: attacker?.spriteRow ?? charMatch?.spriteRow ?? -1, spriteCol: attacker?.spriteCol ?? charMatch?.spriteCol ?? -1, customPortrait: attacker?.customPortrait || null });
        sfx.spell(isNpcAtk);
        break;
      }
    }
  }, [b.spellUsedBy, b.round, pcs, npcs]);
  useEffect(() => {
    if (!spellFlash) return;
    const t = setTimeout(() => setSpellFlash(null), 2800);
    return () => clearTimeout(t);
  }, [spellFlash]);

  // ── フェーズチェンジバナー ────────────────────────────────────────
  const [phaseBanner, setPhaseBanner] = useState(null);
  // 動物を導く（弾幕回避）の振り直し対象ダイス添字（null=非選択モード）
  const [evadeDoubutsuSel, setEvadeDoubutsuSel] = useState(null);
  useEffect(() => { if (b.phase !== "pc_evade_result") setEvadeDoubutsuSel(null); }, [b.phase]);
  const prevBannerPhase = useRef(null);
  useEffect(() => {
    if (b.phase === prevBannerPhase.current) return;
    prevBannerPhase.current = b.phase;
    const BANNER_PHASES = { pc_shot_intro: "PC ショット", npc_shot_intro: "NPC ショット", pc_evade_intro: "PC 回避", npc_evade_intro: "NPC 回避", pc_dropout: "PC 脱落", npc_dropout: "NPC 脱落" };
    const label = BANNER_PHASES[b.phase];
    if (label) {
      setPhaseBanner(label);
      sfx.phase(b.phase);
      const t = setTimeout(() => setPhaseBanner(null), 1600);
      return () => clearTimeout(t);
    }
    if (b.phase === "pc_hit_recovery" || b.phase === "npc_hit_recovery") sfx.phase(b.phase);
  }, [b.phase]);

  // ── 勝利/敗北 ────────────────────────────────────────────────────
  const prevCleanupRef = useRef(null);
  useEffect(() => {
    if (b.phase !== "cleanup") { prevCleanupRef.current = null; return; }
    const result = npcsDefeated ? "victory" : alivePcs.length === 0 ? "defeat" : null;
    if (result && result !== prevCleanupRef.current) {
      prevCleanupRef.current = result;
      result === "victory" ? sfx.victory() : sfx.defeat();
    }
  }, [b.phase, npcsDefeated, alivePcs.length]);

  if (!gs.battle) return null; // フック群の後で実際の有無を判定（上の || {} と対）

  const handleSupportFire = (userUid) => {
    upd(p => ({
      ...p,
      battle: {
        ...p.battle,
        supportDice: (p.battle.supportDice || 0) + 1,
        usedIntervention: { ...p.battle.usedIntervention, [userUid]: "support" }
      },
      log: [`💥 ${pcs.find(x => x.uid === userUid)?.charName} の援護射撃！攻撃ダイスが増加します。`, ...p.log]
    }));
  };

  const _handleCover = (userUid, targetUid) => {
    animateDice(1, "かばう", (res) => {
      const die = res[0];
      upd(p => {
        const currentGrid = [...(p.battle.grids[targetUid] || [0,0,0,0,0,0])];
        let success = false;
        if (currentGrid[die - 1] > 0) {
          currentGrid[die - 1] -= 1;
          success = true;
        }
        return {
          ...p,
          battle: {
            ...p.battle,
            grids: { ...p.battle.grids, [targetUid]: currentGrid },
            usedIntervention: { ...p.battle.usedIntervention, [userUid]: "cover" }
          },
          log: [`🛡️ ${pcs.find(x => x.uid === userUid)?.charName} が ${die}番マスをかばった！ ${success ? "弾幕を除去しました。" : "しかしそこには弾幕がなかった！"}`, ...p.log]
        };
      });
    });
  };

  const handleAutoFamiliarCover = (targetId) => {
    animateDice(1, "使い魔かばう（自動）", (res) => {
      const die = res[0];
      upd(p => {
        const { grid, success } = resolveCover(p.battle.grids[targetId], die);
        const pc = p.pcs.find(x => x.uid === targetId);
        const npc = p.battle.participants.npcs.find(n => n.id === targetId);
        const name = pc?.charName || npc?.name || targetId;
        const isPcSide = targetId === p.battle.pcCombatant;
        return {
          ...p,
          battle: {
            ...p.battle,
            grids: { ...p.battle.grids, [targetId]: grid },
            ...(isPcSide ? { pcFamiliarAction: "done" } : { npcFamiliarAction: "done" }),
          },
          log: [`🛡 使い魔が自動でかばった！${die}番マス ${success ? "弾幕除去" : "弾幕なし"}（${name}のマス）`, ...p.log],
        };
      });
    });
  };

  const executeShot = (isPc) => {
    const attacker = isPc ? pcs.find(p => p.uid === b.pcCombatant) : npcs.find(n => n.id === b.npcCombatant);
    const bonus = b.supportDice || 0;
    // ★ 使い魔スキル: ショットダイス数 -1
    const hasFamiliar = hasOfficialSkill(attacker, "使い魔");
    // 剣術を扱う程度の能力（オート）: 弾幕ごっこ参加時の攻撃力を実効値に置換
    const baseAtk = effectiveAttackPower(attacker, gs.sessionPhase);
    const youkiBonus = attacker?.flags?.youki ? 1 : 0;
    const totalDice = calcShotDiceCount(baseAtk + youkiBonus, bonus, hasFamiliar);

    const attackerId = isPc ? b.pcCombatant : b.npcCombatant;
    const defenderId = isPc ? b.npcCombatant : b.pcCombatant;

    animateDice(totalDice, `${isPc ? "PC" : "NPC"}ショット`, (results) => {
      upd(p => {
        const currentGrid = [...(p.battle.grids[defenderId] || [0,0,0,0,0,0])];
        results.forEach(d => { if (d >= 1 && d <= 6) currentGrid[d - 1] += 1; });
        return {
          ...p,
          battle: {
            ...p.battle,
            supportDice: 0,
            lastShotDice: results,
            lastShotIsPc: isPc,
            lastShotAttackerId: attackerId,
            lastShotDefenderId: defenderId,
            grids: { ...p.battle.grids, [defenderId]: currentGrid },
            phase: isPc ? "pc_shot_after" : "npc_shot_after",
          }
        };
      });
    });
  };

  const _executePcShot = () => executeShot(true);
  const _executeNpcShot = () => executeShot(false);

  // ─── スペルカード関連 ─────────────────────────────────────────────

  // グリッドに弾幕を配置するヘルパー（攻撃側フィールド）
  const placeSpellBullets = (attackerGrid, effects, attackerPos, defenderPos, customCount = null) => {
    const grid = [...attackerGrid];
    const ADJACENT_MAP = { 1:[2,4], 2:[1,3,5], 3:[2,6], 4:[1,5], 5:[4,6,2], 6:[3,5] };

    for (const ef of effects) {
      const count = ef.count === -1 ? (customCount ?? 1) : ef.count;
      if (ef.type === "SELF") {
        grid[attackerPos - 1] = (grid[attackerPos - 1] || 0) + count;
      } else if (ef.type === "ENEMY") {
        grid[defenderPos - 1] = (grid[defenderPos - 1] || 0) + count;
      } else if (ef.type === "ADJACENT") {
        const adj = ADJACENT_MAP[defenderPos] || [];
        adj.forEach(cell => { grid[cell - 1] = (grid[cell - 1] || 0) + count; });
      } else if (ef.type === "FIXED") {
        grid[ef.cell - 1] = (grid[ef.cell - 1] || 0) + ef.count;
      }
      // RANDOM は別途ダイスで処理、CHOOSE は手動選択で処理
    }
    return grid;
  };

  // RANDOM エフェクトをダイスで処理
  const resolveRandomEffects = (effects, defenderGridId, customCount, cb) => {
    const randoms = effects.filter(e => e.type === "RANDOM");
    if (randoms.length === 0) { cb({}); return; }

    const totalDice = randoms.reduce((sum, e) => sum + (e.count === -1 ? (customCount ?? 1) : e.count), 0);
    animateDice(totalDice, "スペルカード（ランダム配置）", res => {
      const grid = [...(b.grids?.[defenderGridId] || [0,0,0,0,0,0])];
      res.forEach(d => { grid[d - 1] = (grid[d - 1] || 0) + 1; });
      cb({ [defenderGridId]: grid });
    });
  };

  // スペルカード宣言のメイン処理
  const declareSpell = (spellCard, isPcAttacker, customCount = null) => {
    const attackerId = isPcAttacker ? b.pcCombatant : b.npcCombatant;
    const defenderId = isPcAttacker ? b.npcCombatant : b.pcCombatant;
    // 実績: 決戦でのPCスペルカード宣言を計測（ログを伴わない単発更新＝アンドゥ対象外）。六根清浄斬は #6 用に記録
    if (isPcAttacker && (b.isFinal ?? (b.type === "mass" && !b.questId))) {
      const isRokkon = (spellCard?.name || "").includes("六根清浄斬");
      upd(p => ({ ...p, pcs: bumpAch(p.pcs, attackerId, a => ({ ...a, spells: (a.spells || 0) + 1, ...(isRokkon ? { usedRokkon: true } : {}) })) }));
    }
    const attPos = b.positions?.[attackerId] || 1;
    const defPos = b.positions?.[defenderId] || 1;
    const _attackerGrid = b.grids?.[attackerId] || [0,0,0,0,0,0];

    // スペカ点数を消費（no_sc_cost 効果（幻想春花）があれば消費しない）
    const consumeSpell = (p) => {
      if ((spellCard.structured?.effects || []).some(e => e.type === "no_sc_cost")) return p;
      return isPcAttacker
        ? { ...p, pcs: p.pcs.map(x => x.uid !== attackerId ? x : {
            ...x, resources: { ...x.resources, スペルカード: { ...x.resources.スペルカード, cur: Math.max(0, (x.resources.スペルカード?.cur || 0) - 1) } }
          })}
        : { ...p, battle: { ...p.battle, participants: { ...p.battle.participants, npcs: p.battle.participants.npcs.map(n => n.id !== attackerId ? n : {
            ...n, resources: { ...n.resources, スペルカード: { ...n.resources.スペルカード, cur: Math.max(0, (n.resources.スペルカード?.cur || 0) - 1) } }
          })}}};
    };

    // NPC の場合 consumeSpell は battle.participants を更新するため、
    // その後に battle: { ...p.battle, ... } で上書きすると SC 消費が消えてしまう。
    // このヘルパーを使うと consumed.battle をベースに追加フィールドをマージできる。
    const mergeConsumeWithBattle = (p, battleExtra) => {
      const c = consumeSpell(p);
      return { ...c, battle: { ...c.battle, ...battleExtra } };
    };

    const attackerName = isPcAttacker ? combatantPc?.charName : combatantNpc?.name;

    const structured = spellCard.structured;

    // ── 宣言時の即時リソース変動 effects ─────────────────────────────────
    // ・回避力変動（reduce/increase_*evasion, costs_own_evasion）: 回避力.cur を ±1。
    //   回避力はラウンド終了時に上限回復する仕様のため、evasionRestore に元値を記録し
    //   handleCleanup で復元する（このラウンド限り。杞人地も最大値でなく現在値の一時減少）。
    // ・reset_graze（バレットドミニオン/マーケット）: 攻撃側のグレイズを0に（配置のX計算後）。
    // ・costs_rei（五穀豊穣ライスシャワー）: 攻撃側の霊力を消費（攻撃力も再計算）。
    //   reset_graze / costs_rei は恒久（復元しない）。
    const RESOURCE_EFFECT_TYPES = ["reduce_enemy_evasion", "increase_enemy_evasion", "reduce_own_evasion", "costs_own_evasion", "reset_graze", "costs_rei"];
    const resourceEffects = (structured?.effects || []).filter(e => RESOURCE_EFFECT_TYPES.includes(e.type));
    const computeResourceEffects = (p) => {
      let pcs = p.pcs;
      let npcs = p.battle.participants.npcs;
      const evRestore = { ...(p.battle.evasionRestore || {}) };
      // 対象 entity の resources を fn で更新（PC/NPC 両対応）
      const modEntity = (id, fn) => {
        if (pcs.some(x => x.uid === id)) { pcs = pcs.map(x => x.uid === id ? fn(x) : x); }
        else { npcs = npcs.map(n => n.id === id ? fn(n) : n); }
      };
      for (const ef of resourceEffects) {
        if (["reduce_enemy_evasion", "increase_enemy_evasion", "reduce_own_evasion", "costs_own_evasion"].includes(ef.type)) {
          const isEnemy = ef.type === "reduce_enemy_evasion" || ef.type === "increase_enemy_evasion";
          const targetId = isEnemy ? defenderId : attackerId;
          const delta = ef.type === "increase_enemy_evasion" ? 1 : -1;
          const ent = pcs.find(x => x.uid === targetId) || npcs.find(n => n.id === targetId);
          const cur = ent?.resources?.回避力?.cur ?? 3;
          if (!(targetId in evRestore)) evRestore[targetId] = cur;
          modEntity(targetId, e => ({ ...e, resources: { ...e.resources, 回避力: { ...e.resources.回避力, cur: Math.max(0, cur + delta) } } }));
        } else if (ef.type === "reset_graze") {
          modEntity(attackerId, e => ({ ...e, resources: { ...e.resources, グレイズ: { ...e.resources.グレイズ, cur: 0 } } }));
        } else if (ef.type === "costs_rei") {
          modEntity(attackerId, e => {
            const nextRei = Math.max(0, (e.resources?.霊力?.cur || 0) - (ef.amount || 1));
            return { ...e, resources: { ...e.resources, 霊力: { ...e.resources.霊力, cur: nextRei }, 攻撃力: { ...e.resources.攻撃力, cur: 1 + Math.floor(nextRei / 5) } } };
          });
        }
      }
      return { pcs, npcs, evRestore };
    };

    // ── roll_check_then_place: auto レベルに関わらず優先処理 ─────────────
    const rollCheckStep = structured?.steps?.find(s => s.type === "roll_check_then_place");
    if (rollCheckStep) {
      let defGrid = [...(b.grids?.[defenderId] || [0,0,0,0,0,0])];
      let atkGrid = [...(b.grids?.[attackerId] || [0,0,0,0,0,0])];
      upd(p => ({
        ...mergeConsumeWithBattle(p, {
          spellRollCheck: {
            attackerId, defenderId, attPos, defPos,
            snapDef: defGrid, snapAtk: atkGrid,
            check: rollCheckStep.check,
            success: rollCheckStep.success || [],
            fail: rollCheckStep.fail || [],
            spellName: spellCard.name,
          },
          spellUsedBy: { ...(p.battle.spellUsedBy || {}), [attackerId]: spellCard.name },
        }),
        log: [`🔮 ${attackerName}：${spellCard.name}！ (ダイスを振って効果を決定)`, ...p.log],
      }));
      return;
    }

    // ── pre_self_move_adjacent（死歌/怒面/貧符）: 配置前に自機を隣接マスへ移動 ──
    // 「移動先選択 → 移動後の自機マスに配置」の順。配置はここでは行わず preSpellMove を立てる。
    if (structured?.effects?.some(e => e.type === "pre_self_move_adjacent")) {
      const selfStep = structured.steps?.find(s => s.type === "self");
      const candidates = ADJACENT_MAP[attPos] || [];
      upd(p => ({
        ...mergeConsumeWithBattle(p, {
          spellUsedBy: { ...(p.battle.spellUsedBy || {}), [attackerId]: spellCard.name },
          preSpellMove: { attackerId, defenderId, candidates, selfCount: selfStep?.count ?? 2, spellName: spellCard.name, isPcAttacker },
        }),
        log: [`🔮 ${attackerName}：${spellCard.name}！ (まず自機の移動先を選択してください)`, ...p.log],
      }));
      return;
    }

    // ── 構造化データによる自動処理（auto: "full" / "partial"） ──────────
    if (structured?.steps?.length > 0 && (structured.auto === "full" || structured.auto === "partial")) {
      // round_end: pcPendingSpell/npcPendingSpell として保存し、ラウンド終了時に applyPendingSpells で処理
      if (structured.timing === "round_end") {
        upd(p => ({
          ...mergeConsumeWithBattle(p, { [isPcAttacker ? "pcPendingSpell" : "npcPendingSpell"]: { ...slimSpellForStorage(spellCard), attackerId, defenderId, attPos, defPos } }),
          log: [`🔮 ${attackerName}：${spellCard.name}！ (ラウンド終了時に効果)`, ...p.log],
        }));
        return;
      }

      // 全ステップを処理（stat-based count を解決してから applyStep へ渡す）
      let defGrid = [...(b.grids?.[defenderId] || [0,0,0,0,0,0])];
      let atkGrid = [...(b.grids?.[attackerId] || [0,0,0,0,0,0])];
      const randomHints = [];
      let totalDice = 0;
      let hasChoiceStep = false;
      let firstChoiceStep = null;
      const attackerEntity = isPcAttacker ? combatantPc : combatantNpc;

      for (const step of structured.steps) {
        // stat-based count（{ type: "stat", stat: "グレイズ", multiplier: N }）を解決
        const resolvedStep = (step.count && typeof step.count === "object")
          ? { ...step, count: resolveCount(step.count, attackerEntity) }
          : step;
        const result = applyStep(resolvedStep, defGrid, atkGrid, attPos, defPos);
        defGrid = result.defGrid;
        atkGrid = result.atkGrid;
        if (result.needsChoice) {
          hasChoiceStep = true;
          firstChoiceStep = resolvedStep;
          break;
        }
        if (result.needsDice) {
          randomHints.push(result);
          totalDice += result.diceCount;
        }
      }

      // designated / choice_fixed / clear_chosen_then_random → CHOOSE UIへ直接ディスパッチ
      if (hasChoiceStep && ["designated", "choice_fixed", "clear_chosen_then_random"].includes(firstChoiceStep?.type)) {
        const count = firstChoiceStep.count ?? 1;
        upd(p => {
          const { pcs, npcs, evRestore } = computeResourceEffects(p);
          const pe = { ...p, pcs, battle: { ...p.battle, participants: { ...p.battle.participants, npcs } } };
          return {
            ...mergeConsumeWithBattle(pe, {
              grids: { ...pe.battle.grids, [defenderId]: defGrid, [attackerId]: atkGrid },
              spellChoose: { attackerId, defenderId, remaining: count, selected: [], excludeEnemyCell: spellCard.structured?.condition_on_placement?.exclude_enemy_cell === true },
              spellUsedBy: { ...(pe.battle.spellUsedBy || {}), [attackerId]: spellCard.name },
              ...(resourceEffects.length > 0 ? { evasionRestore: evRestore } : {}),
            }),
            log: [`🔮 ${attackerName}：${spellCard.name}！ (マスを選択してください)${resourceEffects.length > 0 ? "（効果適用）" : ""}`, ...p.log],
          };
        });
        return;
      }

      // auto: "full" のみ: 完全決定論的 / ランダムを自動処理
      if (structured.auto === "full") {
        if (!hasChoiceStep && randomHints.length === 0) {
          // 配置確定 + 移動効果（古明地こいし等）の処理
          // enemy_forced_to_attacker_number_cell（スーパーエゴ）: 回避側を attPos へ強制移動（一意・自動）
          // enemy_move_adjacent_if_same_number（イドの開放）: 回避側マス番号==自機マス番号 のとき隣接マスへ移動（選択）
          const moveEffects = structured.effects || [];
          const posPatch = {};
          let moveSelect = null;
          const mkMove = (targetId, candidates) => ({ targetId, candidates, spellName: spellCard.name, isPcAttacker });
          for (const ef of moveEffects) {
            if (ef.type === "enemy_forced_to_attacker_number_cell") {
              posPatch[defenderId] = attPos;
            } else if (ef.type === "enemy_move_adjacent_if_same_number") {
              if (defPos === attPos) {
                const cand = ADJACENT_MAP[defPos] || [];
                if (cand.length > 0) moveSelect = mkMove(defenderId, cand);
              }
            } else if (ef.type === "enemy_move_adjacent") {
              // 無条件で回避側を上下左右隣接マスへ移動（四重結界・剛欲）
              const cand = ADJACENT_MAP[defPos] || [];
              if (cand.length > 0) moveSelect = mkMove(defenderId, cand);
            } else if (ef.type === "self_move_to_enemy_number") {
              posPatch[attackerId] = defPos;  // 自機を敵と同番号マスへ（一意）
            } else if (ef.type === "self_move_any") {
              moveSelect = mkMove(attackerId, [1, 2, 3, 4, 5, 6]);  // 自機を任意マスへ
            } else if (ef.type === "self_move_empty") {
              const empty = [1, 2, 3, 4, 5, 6].filter(c => (atkGrid[c - 1] || 0) === 0);  // 自機フィールドの空きマス
              if (empty.length > 0) moveSelect = mkMove(attackerId, empty);
            }
          }
          const movedSelf = posPatch[attackerId] !== undefined;
          const hasMayStay = moveEffects.some(e => e.type === "enemy_may_stay_on_dodge");  // 正直者の死/吉弔大結界
          const hasZanmei = moveEffects.some(e => e.type === "extra_hp_loss_if_same_cell_fail");  // 余命幾許
          const hasOptClear = moveEffects.some(e => e.type === "optional_clear_then_random");  // ドリームキャッチャー
          // ドリームキャッチャー: 配置したマス（敵機隣接）を除去候補とする
          const optClearCandidates = hasOptClear ? (ADJACENT_MAP[defPos] || []).filter(c => (defGrid[c - 1] || 0) > 0) : [];
          const placeAfterDodge = moveEffects.find(e => e.type === "place_at_enemy_after_first_dodge");  // 全霊鬼渡り
          const moveLog = moveSelect ? "（移動先を選択してください）"
            : posPatch[defenderId] !== undefined ? `（回避側を ${attPos}番マスへ移動させた）`
            : movedSelf ? `（自機を ${defPos}番マスへ移動させた）` : "";
          upd(p => {
            const { pcs, npcs, evRestore } = computeResourceEffects(p);
            const pe = { ...p, pcs, battle: { ...p.battle, participants: { ...p.battle.participants, npcs } } };
            return {
              ...mergeConsumeWithBattle(pe, {
                grids: { ...pe.battle.grids, [defenderId]: defGrid, [attackerId]: atkGrid },
                spellUsedBy: { ...(pe.battle.spellUsedBy || {}), [attackerId]: spellCard.name },
                ...(Object.keys(posPatch).length > 0 ? { positions: { ...pe.battle.positions, ...posPatch } } : {}),
                ...(moveSelect ? { spellMoveSelect: moveSelect } : {}),
                ...(resourceEffects.length > 0 ? { evasionRestore: evRestore } : {}),
                ...(hasMayStay ? { mayStayOnDodge: true } : {}),
                ...(hasZanmei ? { zanmeiPenalty: { ...pe.battle.zanmeiPenalty, [attackerId]: true } } : {}),
                ...(hasOptClear && optClearCandidates.length > 0 ? { optionalClear: { attackerId, defenderId, candidates: optClearCandidates, selected: [] } } : {}),
                ...(placeAfterDodge ? { afterDodgeShot: { ...pe.battle.afterDodgeShot, [attackerId]: { type: "place_at_enemy_after_first_dodge", count: placeAfterDodge.count ?? 1 } } } : {}),
              }),
              log: [`🔮 ${attackerName}：${spellCard.name}！${moveLog}${hasMayStay ? "（相手は回避時その場にとどまれる）" : ""}${hasZanmei ? "（自機と同番号のマスで回避失敗→追加ダメージ）" : ""}${hasOptClear && optClearCandidates.length > 0 ? "（任意で除去→ランダム）" : ""}${placeAfterDodge ? "（最初の回避成功時に移動先へ配置）" : ""}${resourceEffects.length > 0 ? "（効果適用）" : ""}`, ...p.log],
            };
          });
          return;
        }

        if (!hasChoiceStep && totalDice > 0) {
          // ランダムステップあり: deterministic 部分は適用済み、残りはダイス
          const snapDef = defGrid;
          const snapAtk = atkGrid;
          upd(p => consumeSpell(p));
          const effList = structured.effects || [];
          const optRedo = effList.find(e => e.type === "optional_redo_random");  // ブラックペガサス: 任意で再配置
          const hasShift = effList.some(e => e.type === "shift_non_25_horizontal");
          const hasRemoveFromEnemy = effList.some(e => e.type === "remove_from_enemy_cell");  // パパラッチ: 回避側マスを1除去
          const hasRemoveIfHit = effList.some(e => e.type === "remove_if_hit_enemy_cell");     // ペガサスクロス: 配置で置かれた分を除去
          const hasSelfMoveEmpty = effList.some(e => e.type === "self_move_empty");            // シンガーゴースト: 自機を空きマスへ
          const hasExtraFamiliar = effList.some(e => e.type === "extra_familiar_per_round_this_phase"); // ホークビーコン: フェイズ中・毎ラウンド追加介入
          const hasNoEvasionLoss = effList.some(e => e.type === "next_dodge_no_evasion_loss");  // オプティカルカモフラージュ: 次の回避で回避力減らさず
          const hasSuntan = effList.some(e => e.type === "self_hp_loss_if_no_damage");          // 太陽を盗んだ鴉: 被弾なしならラウンド終了時に自分-1
          const hasMirrorGraze = effList.some(e => e.type === "mirror_graze_gain");             // ミシガンロール: 相手のグレイズ獲得に同調
          animateDice(totalDice, `${spellCard.name}（ランダム配置）`, res => {
            let finalDef = [...snapDef];
            let finalAtk = [...snapAtk];
            let offset = 0;
            for (const hint of randomHints) {
              const batch = res.slice(offset, offset + hint.diceCount);
              offset += hint.diceCount;
              const { defGrid: nextDef, atkGrid: nextAtk } = applyRandomResult(finalDef, finalAtk, batch, hint, attPos, defPos);
              finalDef = nextDef;
              finalAtk = nextAtk;
            }
            // 配置後の移動効果（摩多羅隠岐奈「太古に失われた背中」）
            if (hasShift) finalDef = shiftNon25Horizontal(finalDef);
            // 配置直後の回避側マスの弾幕除去
            const dIdx = defPos - 1;
            let removeLog = "";
            if (hasRemoveFromEnemy && finalDef[dIdx] > 0) {
              finalDef[dIdx] -= 1;
              removeLog = "（回避側マスの弾幕を1つ除去）";
            } else if (hasRemoveIfHit && finalDef[dIdx] > snapDef[dIdx]) {
              // 配置で置かれた分（snapDef からの増加）を取り除く
              finalDef[dIdx] = snapDef[dIdx];
              removeLog = "（回避側マスに置かれた弾幕を除去）";
            }
            // 自機を空きマスへ移動（選択）: 自機フィールド snapAtk の弾幕0マスが候補
            let moveSelect = null;
            if (hasSelfMoveEmpty) {
              const empty = [1, 2, 3, 4, 5, 6].filter(c => (snapAtk[c - 1] || 0) === 0);
              if (empty.length > 0) moveSelect = { targetId: attackerId, candidates: empty, spellName: spellCard.name, isPcAttacker };
            }
            upd(p => {
              const { pcs, npcs, evRestore } = computeResourceEffects(p);
              return {
                ...p,
                pcs,
                battle: {
                  ...p.battle,
                  participants: { ...p.battle.participants, npcs },
                  grids: { ...p.battle.grids, [defenderId]: finalDef, [attackerId]: finalAtk },
                  spellUsedBy: { ...(p.battle.spellUsedBy || {}), [attackerId]: spellCard.name },
                  ...(moveSelect ? { spellMoveSelect: moveSelect } : {}),
                  ...(resourceEffects.length > 0 ? { evasionRestore: evRestore } : {}),
                  ...(hasExtraFamiliar ? { extraFamiliarPhase: [...new Set([...(p.battle.extraFamiliarPhase || []), attackerId])] } : {}),
                  ...(hasNoEvasionLoss ? { noEvasionLoss: { ...p.battle.noEvasionLoss, [attackerId]: true } } : {}),
                  ...(optRedo ? { optionalRedo: { attackerId, defenderId, count: optRedo.count ?? 3, snapDef } } : {}),
                  ...(hasSuntan ? { suntanPenalty: { ...p.battle.suntanPenalty, [attackerId]: true } } : {}),
                  ...(hasMirrorGraze ? { mirrorGraze: { ...p.battle.mirrorGraze, [attackerId]: true } } : {}),
                },
                log: [`🔮 ${attackerName}：${spellCard.name}！${hasShift ? "（2/5番以外の弾幕を左右へ移動）" : ""}${removeLog}${moveSelect ? "（自機の移動先を選択）" : ""}${hasExtraFamiliar ? "（フェイズ中・毎ラウンド追加介入）" : ""}${hasNoEvasionLoss ? "（次の回避で回避力を消費しない）" : ""}${optRedo ? "（任意で再配置できます）" : ""}${hasSuntan ? "（被弾しなければラウンド終了時に残り人数-1）" : ""}${hasMirrorGraze ? "（相手のグレイズ獲得に同調）" : ""}${resourceEffects.length > 0 ? "（効果適用）" : ""}`, ...p.log],
              };
            });
          });
          return;
        }
      }
      // その他の choice step (directional_move_shoot 等) / auto=partial のランダム → テキスト解析ベース処理へ
    }

    // ── 構造化 effects: extra_support_cover 系 / double_support_cover ──
    // ステップの有無に関わらず、これらの効果は宣言時に即座に援護/かばう権を付与する
    // （double_support_cover（上海人形）は count 未指定 → 2回）
    if (structured?.effects?.length > 0) {
      const extraEffect = structured.effects.find(e =>
        e.type === "extra_support_cover" || e.type === "extra_support_cover_with_die_choice" || e.type === "double_support_cover"
      );
      if (extraEffect) {
        const withDieChoice = extraEffect.type === "extra_support_cover_with_die_choice";
        const count = extraEffect.count ?? 2;
        upd(p => ({
          ...mergeConsumeWithBattle(p, {
            spellUsedBy: { ...(p.battle.spellUsedBy || {}), [attackerId]: spellCard.name },
            // declarerUid: 宣言者（対戦者）自身が追加援護/かばうを行う
            extraInterventionPool: { remaining: count, usedDice: [], withDieChoice, declarerUid: attackerId },
          }),
          log: [`🔮 ${attackerName}：${spellCard.name}！ (援護/かばう+${count}回${withDieChoice ? "・ダイス任意" : ""})`, ...p.log],
        }));
        return;
      }

      // random_3d_after_first_dodge（マッスル・狐符。steps なしの effects のみ）: 回避成功直後の追加配置を予約
      const r3 = structured.effects.find(e => e.type === "random_3d_after_first_dodge");
      if (r3) {
        upd(p => ({
          ...mergeConsumeWithBattle(p, {
            spellUsedBy: { ...(p.battle.spellUsedBy || {}), [attackerId]: spellCard.name },
            afterDodgeShot: { ...p.battle.afterDodgeShot, [attackerId]: { type: "random_3d_after_first_dodge", count: r3.count ?? 3 } },
          }),
          log: [`🔮 ${attackerName}：${spellCard.name}！ (最初の回避成功直後に${r3.count ?? 3}D追加配置)`, ...p.log],
        }));
        return;
      }
    }

    // ── 既存のテキスト解析ベース処理 ─────────────────────────────────────
    const nonRandomEffects = spellCard.effects.filter(e => e.type !== "RANDOM" && e.type !== "CHOOSE");
    const hasRandom = spellCard.effects.some(e => e.type === "RANDOM");
    const hasChoose = spellCard.effects.some(e => e.type === "CHOOSE");

    // effectTiming が round_end のものは grids に反映せず pendingSpell に保存
    if (spellCard.effectTiming === "round_end") {
      upd(p => ({
        ...mergeConsumeWithBattle(p, { [isPcAttacker ? "pcPendingSpell" : "npcPendingSpell"]: { ...slimSpellForStorage(spellCard), attackerId, defenderId, attPos, defPos, defenderPos: defPos } }),
        log: [`🔮 ${attackerName}：${spellCard.name}！ (ラウンド終了時に効果)`, ...p.log],
      }));
      return;
    }

    // manual または CHOOSE → 宣言のみ記録して CHOOSE フェーズへ
    if (spellCard.manual) {
      upd(p => ({
        ...mergeConsumeWithBattle(p, {
          spellUsedBy: { ...(p.battle.spellUsedBy || {}), [attackerId]: spellCard.name },
          [isPcAttacker ? "pcManualSpell" : "npcManualSpell"]: { ...slimSpellForStorage(spellCard), attackerId, defenderId, defenderPos: defPos },
        }),
        log: [`🔮 ${attackerName}：${spellCard.name}！ (効果はGMが手動処理)`, ...p.log],
      }));
      return;
    }

    // 非ランダム効果を即座に適用
    const defenderGrid = b.grids?.[defenderId] || [0,0,0,0,0,0];
    const updatedGrid = placeSpellBullets(defenderGrid, nonRandomEffects, attPos, defPos, customCount);

    if (hasChoose) {
      // CHOOSE → 選択フェーズへ
      const chooseCount = spellCard.effects.find(e => e.type === "CHOOSE")?.count ?? 1;
      upd(p => ({
        ...mergeConsumeWithBattle(p, {
          grids: { ...p.battle.grids, [defenderId]: updatedGrid },
          spellChoose: { attackerId, defenderId, remaining: chooseCount === -1 ? (customCount ?? 1) : chooseCount, selected: [], excludeEnemyCell: spellCard.structured?.condition_on_placement?.exclude_enemy_cell === true },
          spellUsedBy: { ...(p.battle.spellUsedBy || {}), [attackerId]: spellCard.name },
        }),
        log: [`🔮 ${attackerName}：${spellCard.name}！ (マスを選択してください)`, ...p.log],
      }));
      return;
    }

    if (hasRandom) {
      // ランダム配置のダイスロール
      upd(p => consumeSpell(p));
      resolveRandomEffects(spellCard.effects, defenderId, customCount, gridPatch => {
        upd(p => ({
          ...p,
          battle: {
            ...p.battle,
            grids: { ...p.battle.grids, [defenderId]: updatedGrid.map((v, i) => v + (gridPatch[defenderId]?.[i] || 0)), },
            spellUsedBy: { ...(p.battle.spellUsedBy || {}), [attackerId]: spellCard.name },
          },
          log: [`🔮 ${attackerName}：${spellCard.name}！`, ...p.log],
        }));
      });
      return;
    }

    // 完全自動（テキスト解析）
    upd(p => ({
      ...mergeConsumeWithBattle(p, {
        grids: { ...p.battle.grids, [defenderId]: updatedGrid },
        spellUsedBy: { ...(p.battle.spellUsedBy || {}), [attackerId]: spellCard.name },
      }),
      log: [`🔮 ${attackerName}：${spellCard.name}！`, ...p.log],
    }));
  };

  // 回避側の移動先マスを確定（こいし「イドの開放」等）
  const handleSpellMoveCell = (cell) => {
    const ms = b.spellMoveSelect;
    if (!ms) return;
    const isSelf = ms.targetId === (ms.isPcAttacker ? b.pcCombatant : b.npcCombatant);
    upd(p => ({
      ...p,
      battle: {
        ...p.battle,
        positions: { ...p.battle.positions, [ms.targetId]: cell },
        spellMoveSelect: null,
      },
      log: [`↪ ${isSelf ? "自機" : "回避側"}を ${cell}番マスへ移動させた`, ...p.log],
    }));
  };

  // pre_self_move_adjacent（死歌/怒面/貧符）: 移動先を確定 → 自機をそのマスへ移動し、自機マスに配置
  const handlePreSpellMove = (cell) => {
    const pm = b.preSpellMove;
    if (!pm) return;
    upd(p => {
      const grid = [...(p.battle.grids[pm.defenderId] || [0,0,0,0,0,0])];
      grid[cell - 1] = (grid[cell - 1] || 0) + pm.selfCount;  // 移動後の自機マス（=cell）に self×count を配置
      return {
        ...p,
        battle: {
          ...p.battle,
          positions: { ...p.battle.positions, [pm.attackerId]: cell },
          grids: { ...p.battle.grids, [pm.defenderId]: grid },
          preSpellMove: null,
        },
        log: [`↪ 自機を ${cell}番マスへ移動し、弾幕×${pm.selfCount}を配置！`, ...p.log],
      };
    });
  };

  // CHOOSE: グリッドのマスをクリックして弾幕を配置
  const handleSpellChooseCell = (cell) => {
    const sc = b.spellChoose;
    if (!sc) return;
    if ((sc.selected || []).includes(cell)) return;  // 同じマスは選べない
    const newSelected = [...(sc.selected || []), cell];
    const targetId = sc.defenderId || sc.attackerId;
    const grid = [...(b.grids?.[targetId] || [0,0,0,0,0,0])];
    grid[cell - 1] = (grid[cell - 1] || 0) + 1;

    if (newSelected.length >= sc.remaining) {
      // 選択完了
      upd(p => ({
        ...p,
        battle: {
          ...p.battle,
          grids: { ...p.battle.grids, [targetId]: grid },
          spellChoose: null,
        },
      }));
    } else {
      upd(p => ({
        ...p,
        battle: {
          ...p.battle,
          grids: { ...p.battle.grids, [targetId]: grid },
          spellChoose: { ...sc, selected: newSelected },
        },
      }));
    }
  };

  // optional_redo_random（ブラックペガサス流星弾）: 任意で配置をやり直す（除去→再ランダム）
  const handleOptionalRedo = () => {
    const or = b.optionalRedo;
    if (!or) return;
    animateDice(or.count, "再ランダム配置", res => {
      const finalDef = [...(or.snapDef || [0,0,0,0,0,0])];  // 配置前に戻して
      res.forEach(d => { if (d >= 1 && d <= 6) finalDef[d - 1] += 1; });  // 再ランダム配置
      upd(p => ({
        ...p,
        battle: { ...p.battle, grids: { ...p.battle.grids, [or.defenderId]: finalDef }, optionalRedo: null },
        log: [`🔮 ブラックペガサス流星弾：弾幕を取り除いて再配置！`, ...p.log],
      }));
    });
  };
  const handleOptionalRedoSkip = () => {
    upd(p => ({ ...p, battle: { ...p.battle, optionalRedo: null }, log: [`そのまま確定した。`, ...p.log] }));
  };

  // optional_clear_then_random（ドリームキャッチャー）: 配置マスから除去するマスをトグル選択
  const handleOptionalClearToggle = (cell) => {
    upd(p => {
      const oc = p.battle.optionalClear;
      if (!oc) return p;
      const selected = oc.selected.includes(cell) ? oc.selected.filter(c => c !== cell) : [...oc.selected, cell];
      return { ...p, battle: { ...p.battle, optionalClear: { ...oc, selected } } };
    });
  };
  // 選択を確定 → 選択マスの弾幕を1つずつ除去 → 除去数 X として【ランダム×X】
  const handleOptionalClearConfirm = () => {
    const oc = b.optionalClear;
    if (!oc) return;
    const x = oc.selected.length;
    if (x === 0) {
      upd(p => ({ ...p, battle: { ...p.battle, optionalClear: null }, log: [`ドリームキャッチャー：何も取り除かなかった。`, ...p.log] }));
      return;
    }
    // まず選択マスを除去
    upd(p => {
      const grid = [...(p.battle.grids[oc.defenderId] || [0,0,0,0,0,0])];
      oc.selected.forEach(c => { if (grid[c - 1] > 0) grid[c - 1] -= 1; });
      return { ...p, battle: { ...p.battle, grids: { ...p.battle.grids, [oc.defenderId]: grid } } };
    });
    // 除去数分のランダム配置
    animateDice(x, "ドリームキャッチャー（ランダム）", res => {
      upd(p => {
        const grid = [...(p.battle.grids[oc.defenderId] || [0,0,0,0,0,0])];
        res.forEach(d => { if (d >= 1 && d <= 6) grid[d - 1] += 1; });
        return { ...p, battle: { ...p.battle, grids: { ...p.battle.grids, [oc.defenderId]: grid }, optionalClear: null }, log: [`🔮 ドリームキャッチャー：${x}個取り除き、ランダム×${x}を配置！`, ...p.log] };
      });
    });
  };

  // roll_check_then_place: ダイス結果を受けてステップを適用する
  const resolveSpellRollCheck = () => {
    const src = b.spellRollCheck;
    if (!src) return;
    animateDice(src.check.dice, `${src.spellName}（判定）`, res => {
      const maxDie = Math.max(...res);
      const isCheckSuccess = maxDie >= src.check.target;
      const steps = isCheckSuccess ? (src.success || []) : (src.fail || []);
      const { attackerId, defenderId, attPos, defPos } = src;
      let defGrid = [...(src.snapDef || [0,0,0,0,0,0])];
      let atkGrid = [...(src.snapAtk || [0,0,0,0,0,0])];
      const randomHints = [];
      let hasDesignated = false;
      let designatedCount = 0;

      for (const step of steps) {
        if (step.type === "random") {
          randomHints.push({ diceCount: step.count ?? 1, afterList: step.after || [] });
        } else if (step.type === "designated") {
          hasDesignated = true;
          designatedCount = step.count ?? 1;
        } else {
          const result = applyStep(step, defGrid, atkGrid, attPos, defPos);
          defGrid = result.defGrid;
          atkGrid = result.atkGrid;
        }
      }

      const label = isCheckSuccess ? "成功" : "失敗";
      if (hasDesignated) {
        upd(p => ({
          ...p,
          battle: {
            ...p.battle,
            grids: { ...p.battle.grids, [defenderId]: defGrid, [attackerId]: atkGrid },
            spellRollCheck: null,
            spellChoose: { attackerId, defenderId, remaining: designatedCount, selected: [], excludeEnemyCell: false },
          },
          log: [`🎲 ${src.spellName}：判定${label}（${res.join(",")}）→ マスを選択してください`, ...p.log],
        }));
      } else if (randomHints.length > 0) {
        const totalDice = randomHints.reduce((s, h) => s + h.diceCount, 0);
        const snapDef2 = defGrid;
        const snapAtk2 = atkGrid;
        upd(p => ({ ...p, battle: { ...p.battle, spellRollCheck: null } }));
        animateDice(totalDice, `${src.spellName}（配置）`, res2 => {
          let finalDef = [...snapDef2];
          let finalAtk = [...snapAtk2];
          let offset = 0;
          for (const hint of randomHints) {
            const batch = res2.slice(offset, offset + hint.diceCount);
            offset += hint.diceCount;
            const { defGrid: nextDef, atkGrid: nextAtk } = applyRandomResult(finalDef, finalAtk, batch, hint, attPos, defPos);
            finalDef = nextDef;
            finalAtk = nextAtk;
          }
          upd(p => ({
            ...p,
            battle: {
              ...p.battle,
              grids: { ...p.battle.grids, [defenderId]: finalDef, [attackerId]: finalAtk },
            },
            log: [`🎲 ${src.spellName}：判定${label}（${res.join(",")}）→ ランダム配置完了`, ...p.log],
          }));
        });
      } else {
        // 失敗かつ fail:[] → 何も配置しない
        upd(p => ({
          ...p,
          battle: {
            ...p.battle,
            grids: { ...p.battle.grids, [defenderId]: defGrid, [attackerId]: atkGrid },
            spellRollCheck: null,
          },
          log: [`🎲 ${src.spellName}：判定${label}（${res.join(",")}）→ 効果なし`, ...p.log],
        }));
      }
    });
  };

  // ラウンド終了時の pendingSpell 適用（PC/NPC 両方）
  const applyPendingSpells = () => {
    const pcPs  = expandStoredSpell(b.pcPendingSpell);
    const npcPs = expandStoredSpell(b.npcPendingSpell);
    const spells = [pcPs, npcPs].filter(Boolean);
    if (spells.length === 0) return;

    upd(p => {
      let nextGrids = { ...p.battle.grids };
      const logs = [];
      for (const ps of spells) {
        if (ps.structured?.auto === "full" && ps.structured.steps?.length > 0) {
          let defGrid = [...(nextGrids[ps.defenderId] || [0,0,0,0,0,0])];
          let atkGrid = [...(nextGrids[ps.attackerId] || [0,0,0,0,0,0])];
          for (const step of ps.structured.steps) {
            const result = applyStep(step, defGrid, atkGrid, ps.attPos || 1, ps.defPos || 1);
            defGrid = result.defGrid;
            atkGrid = result.atkGrid;
          }
          nextGrids[ps.defenderId] = defGrid;
          nextGrids[ps.attackerId] = atkGrid;
        }
        // テキスト解析ベース/手動はグリッド変更なし（GM手動処理）
        logs.push(`⏰ ${ps.name} の効果が発動した`);
      }
      return {
        ...p,
        battle: {
          ...p.battle,
          grids: nextGrids,
          pcPendingSpell: null,
          npcPendingSpell: null,
        },
        log: [...logs.reverse(), ...p.log],
      };
    });
  };

  const updateCombatantPosition = (combatantId, targetCellNum) => {
    if (!combatantId) return;
    upd(p => ({
      ...p,
      battle: {
        ...p.battle,
        positions: { ...p.battle.positions, [combatantId]: targetCellNum }
      }
    }));
  };

  const changeBulletCount = (combatantId, cell, delta) => {
    if (!combatantId) return;
    upd(p => {
      const oldGrid = [...(p.battle.grids[combatantId] || [0,0,0,0,0,0])];
      const updated = Math.max(0, (oldGrid[cell - 1] || 0) + delta);
      oldGrid[cell - 1] = updated;
      return {
        ...p,
        battle: {
          ...p.battle,
          grids: { ...p.battle.grids, [combatantId]: oldGrid }
        }
      };
    });
  };

  const clearManualSpell = (isPcAttacker) => {
    const key = isPcAttacker ? "pcManualSpell" : "npcManualSpell";
    upd(p => ({
      ...p,
      battle: { ...p.battle, [key]: null }
    }));
  };

  const isDanmakuUsed = (attackerId, skillName) => {
    return !!(b.usedds && b.usedds[attackerId] && b.usedds[attackerId].includes(skillName));
  };

  const markDanmakuUsed = (attackerId, skillName) => {
    if (!attackerId) return;
    upd(p => ({
      ...p,
      battle: {
        ...p.battle,
        usedds: {
          ...(p.battle.usedds || {}),
          [attackerId]: [...((p.battle.usedds || {})[attackerId] || []), skillName]
        }
      }
    }));
  };

  // 近接攻撃: ショット直前に同じマスなら相手のそのマスに弾幕+1
  const tryApplyProximity = (attackerId, defenderId) => {
    const attackerPos = b.positions?.[attackerId];
    const defenderPos = b.positions?.[defenderId];
    if (!attackerPos || !defenderPos) return false;
    const attacker = pcs.find(p => p.uid === attackerId) || npcs.find(n => n.id === attackerId);
    if (!hasOfficialSkill(attacker, "近接攻撃")) return false;
    if (isDanmakuUsed(attackerId, "近接攻撃")) return false;
    if (attackerPos !== defenderPos) return false;

    // そのマスに弾幕を1追加
    upd(p => {
      const grid = [...(p.battle.grids?.[defenderId] || [0,0,0,0,0,0])];
      grid[defenderPos - 1] = (grid[defenderPos - 1] || 0) + 1;
      return {
        ...p,
        battle: { ...p.battle, grids: { ...p.battle.grids, [defenderId]: grid } },
        log: [`💥 ${attacker.charName || attacker.name} の『近接攻撃』が発動：${defenderPos}番マスに弾幕が追加されました。`, ...p.log]
      };
    });
    markDanmakuUsed(attackerId, "近接攻撃");
    return true;
  };

  // ホーミング: ロール直後に1つの出目を任意の出目に変更して重複を作る等に利用
  // ホーミング: PLが「変更するダイスのインデックス」と「変更後の値」を選択する
  // → battle.homingSelect に選択状態を保存し、renderShotAfter でUIを出す
  const tryApplyHoming = (attackerId, defenderId, diceResults) => {
    const attacker = pcs.find(p => p.uid === attackerId) || npcs.find(n => n.id === attackerId);
    if (!hasOfficialSkill(attacker, "ホーミング")) return false;
    if (isDanmakuUsed(attackerId, "ホーミング")) return false;
    if (!diceResults || diceResults.length === 0) return false;
    // 選択UIを起動（step1: どのダイスを変えるか）
    upd(p => ({ ...p, battle: { ...p.battle, homingSelect: { attackerId, defenderId, dice: diceResults, step: "pick_die", selectedDieIdx: null } } }));
    return true;
  };

  // ホーミング確定: グリッドの弾幕を直接移動（旧マス-1 → 新マス+1）し lastShotDice も更新
  const confirmHoming = (newValue) => {
    const hs = b.homingSelect;
    if (!hs || hs.selectedDieIdx === null) return;
    const newDice = [...hs.dice];
    const old     = newDice[hs.selectedDieIdx];
    newDice[hs.selectedDieIdx] = newValue;
    const att = pcs.find(p => p.uid === hs.attackerId) || npcs.find(n => n.id === hs.attackerId);
    markDanmakuUsed(hs.attackerId, "ホーミング");
    upd(p => {
      const grid = [...(p.battle.grids[hs.defenderId] || [0,0,0,0,0,0])];
      if (grid[old - 1] > 0) grid[old - 1] -= 1;
      grid[newValue - 1] += 1;
      return {
        ...p,
        battle: {
          ...p.battle,
          lastShotDice: newDice,
          grids: { ...p.battle.grids, [hs.defenderId]: grid },
          homingSelect: null,
        },
        log: [`🔭 ${att?.charName || att?.name} の「ホーミング」発動：${old}番マス → ${newValue}番マスに弾幕を移動`, ...p.log]
      };
    });
  };

  // ワイドショット: PLが「移動先の空きマス」と「移動元（弾幕があるマス）」を
  //   ペアで1つ以上選択する → battle.wideShotSelect に状態を保存
  const tryApplyWideShot = (attackerId, defenderId) => {
    const attacker = pcs.find(p => p.uid === attackerId) || npcs.find(n => n.id === attackerId);
    if (!hasOfficialSkill(attacker, "ワイドショット")) return false;
    if (isDanmakuUsed(attackerId, "ワイドショット")) return false;
    const grid = b.grids?.[defenderId] ? [...b.grids[defenderId]] : [0,0,0,0,0,0];
    const hasEmpty  = grid.some(v => v === 0);
    const hasBullet = grid.some(v => v > 0);
    if (!hasEmpty || !hasBullet) return false;
    // 選択UIを起動
    upd(p => ({ ...p, battle: { ...p.battle,
      wideShotSelect: { attackerId, defenderId, pendingGrid: [...grid], pairs: [], step: "pick_empty" }
    }}));
    return true;
  };

  // ワイドショット: 空きマスを選択（step pick_empty → pick_source）
  const wideShotPickEmpty = (emptyCell) => {
    const ws = b.wideShotSelect;
    if (!ws || ws.step !== "pick_empty") return;
    upd(p => ({ ...p, battle: { ...p.battle,
      wideShotSelect: { ...ws, step: "pick_source", selectedEmpty: emptyCell }
    }}));
  };

  // ワイドショット: 移動元マスを選択してペアを確定
  const wideShotPickSource = (sourceCell) => {
    const ws = b.wideShotSelect;
    if (!ws || ws.step !== "pick_source") return;
    const newGrid = [...ws.pendingGrid];
    newGrid[ws.selectedEmpty - 1] = (newGrid[ws.selectedEmpty - 1] || 0) + 1;
    newGrid[sourceCell - 1]       = Math.max(0, (newGrid[sourceCell - 1] || 0) - 1);
    const newPairs = [...(ws.pairs || []), { from: sourceCell, to: ws.selectedEmpty }];
    // 移動元として使ったマスは目的地として選べないため除外して判定
    const usedSources = newPairs.map(p => p.from);
    const stillEmpty  = newGrid.some((v, i) => v === 0 && !usedSources.includes(i + 1));
    const stillBullet = newGrid.some(v => v > 0);
    upd(p => ({ ...p, battle: { ...p.battle,
      wideShotSelect: { ...ws, pendingGrid: newGrid, pairs: newPairs,
        step: stillEmpty && stillBullet ? "pick_empty" : "done",
        selectedEmpty: null }
    }}));
  };

  // ワイドショット確定
  const confirmWideShot = () => {
    const ws = b.wideShotSelect;
    if (!ws || !(ws.pairs || []).length) return;
    const att = pcs.find(p => p.uid === ws.attackerId) || npcs.find(n => n.id === ws.attackerId);
    markDanmakuUsed(ws.attackerId, "ワイドショット");
    upd(p => ({ ...p,
      battle: { ...p.battle, grids: { ...p.battle.grids, [ws.defenderId]: ws.pendingGrid }, wideShotSelect: null },
      log: [`🔀 ${att?.charName || att?.name} の「ワイドショット」発動：${(ws.pairs || []).map(pr => `${pr.from}→${pr.to}`).join(", ")}番マス`, ...p.log]
    }));
  };

  // 高速移動: 自身のいるマスに弾幕がない場合、任意のマスへ移動できる
  const openHighSpeedSelect = (attackerId) => {
    upd(p => ({ ...p, battle: { ...p.battle, highSpeedSelect: { attackerId } } }));
  };

  const confirmHighSpeed = (cellNum) => {
    const hs = b.highSpeedSelect;
    if (!hs) return;
    upd(p => {
      const attacker = p.pcs.find(x => x.uid === hs.attackerId) || p.battle.participants.npcs.find(n => n.id === hs.attackerId);
      return {
        ...p,
        battle: { ...p.battle, positions: { ...p.battle.positions, [hs.attackerId]: cellNum }, highSpeedSelect: null },
        log: [`⚡ ${attacker?.charName || attacker?.name} の『高速移動』：${cellNum}番マスへ移動しました。`, ...p.log]
      };
    });
    markDanmakuUsed(hs.attackerId, "高速移動");
  };

  // 大威力: 重複出目があれば選択してそのマスに+1（複数種類の重複は選択UI）
  const openBigPowerSelect = (attackerId, defenderId, diceResults) => {
    const counts = {};
    diceResults.forEach(d => { counts[d] = (counts[d] || 0) + 1; });
    const dupValues = Object.entries(counts).filter(([, c]) => c >= 2).map(([v]) => Number(v));
    if (dupValues.length === 0) return;
    if (dupValues.length === 1) {
      const value = dupValues[0];
      upd(p => {
        const grid = [...(p.battle.grids?.[defenderId] || [0,0,0,0,0,0])];
        grid[value - 1] = (grid[value - 1] || 0) + 1;
        const att = p.pcs.find(x => x.uid === attackerId) || p.battle.participants.npcs.find(n => n.id === attackerId);
        return {
          ...p,
          battle: { ...p.battle, grids: { ...p.battle.grids, [defenderId]: grid } },
          log: [`💥 ${att?.charName || att?.name} の『大威力』：出目 ${value} のマスに弾幕が1つ追加されました。`, ...p.log]
        };
      });
      markDanmakuUsed(attackerId, "大威力");
    } else {
      upd(p => ({ ...p, battle: { ...p.battle, bigPowerSelect: { attackerId, defenderId, dupValues } } }));
    }
  };

  const confirmBigPower = (value) => {
    const bp = b.bigPowerSelect;
    if (!bp) return;
    upd(p => {
      const grid = [...(p.battle.grids?.[bp.defenderId] || [0,0,0,0,0,0])];
      grid[value - 1] = (grid[value - 1] || 0) + 1;
      const att = p.pcs.find(x => x.uid === bp.attackerId) || p.battle.participants.npcs.find(n => n.id === bp.attackerId);
      return {
        ...p,
        battle: { ...p.battle, grids: { ...p.battle.grids, [bp.defenderId]: grid }, bigPowerSelect: null },
        log: [`💥 ${att?.charName || att?.name} の『大威力』：出目 ${value} のマスに弾幕が1つ追加されました。`, ...p.log]
      };
    });
    markDanmakuUsed(bp.attackerId, "大威力");
  };

  // 弾消し: マス選択UIを開く
  const openEraseSelect = (attackerId, defenderId) => {
    upd(p => ({ ...p, battle: { ...p.battle, eraseSelect: { attackerId, targetFieldId: defenderId } } }));
  };

  const confirmErase = (cellNum) => {
    const es = b.eraseSelect;
    if (!es) return;
    upd(p => {
      const grid = [...(p.battle.grids[es.targetFieldId] || [0,0,0,0,0,0])];
      if ((grid[cellNum - 1] || 0) <= 0) return p;
      grid[cellNum - 1] -= 1;
      const attacker = p.pcs.find(x => x.uid === es.attackerId) || p.battle.participants.npcs.find(n => n.id === es.attackerId);
      return {
        ...p,
        battle: { ...p.battle, grids: { ...p.battle.grids, [es.targetFieldId]: grid }, eraseSelect: null },
        log: [`🧹 ${attacker?.charName || attacker?.name} の『弾消し』：${cellNum}番マスの弾幕を1つ取り除きました。`, ...p.log]
      };
    });
    markDanmakuUsed(es.attackerId, "弾消し");
  };

  // ショットロールへ進む（スキルはIntroのボタンで事前使用）
  const handleProceedToShotRoll = (isPc, nextPhase) => {
    upd(p => ({ ...p, battle: { ...p.battle, phase: nextPhase } }));
  };

  const combatantPc = pcs.find(p => p.uid === b.pcCombatant);
  const combatantNpc = npcs.find(n => n.id === b.npcCombatant);
  const currentPos = b.positions?.[b.pcCombatant];
  const danmakuAtPos = b.grids?.[b.pcCombatant]?.[currentPos - 1] || 0;
  const evadeTarget = danmakuAtPos + 3;
  const npcPos = b.positions?.[b.npcCombatant];
  const npcDanmakuAtPos = b.grids?.[b.npcCombatant]?.[npcPos - 1] || 0;

  const getDefaultEvadeDice = (entity) => entity?.resources?.回避力?.cur || 3;

  const getEvadeNeighbors = (pos, wallPass) => {
    const base = ADJACENT_MAP[pos] || [];
    if (!wallPass) return base;
    const extras = { 1: [3], 3: [1], 4: [6], 6: [4] };
    return [...new Set([...base, ...(extras[pos] || [])])];
  };

  const afterDefensePhase = (isAttackerPc) => {
    const attackerIsFirst = b.startOrder === "npc" ? !isAttackerPc : isAttackerPc;
    if (attackerIsFirst) {
      return isAttackerPc ? "npc_shot_intro" : "pc_shot_intro";
    } else {
      return "round_end_check";
    }
  };

  const getEvadeDiceCount = (isPc) => {
    const combatant = isPc ? combatantPc : combatantNpc;
    return b.currentEvadeDice ?? getDefaultEvadeDice(combatant);
  };

  const handleEvadeRoll = (isPc) => {
    const combatant = isPc ? pcs.find(p => p.uid === b.pcCombatant) : npcs.find(n => n.id === b.npcCombatant);
    const pos = b.positions[isPc ? b.pcCombatant : b.npcCombatant];
    const bulletCount = b.grids[isPc ? b.pcCombatant : b.npcCombatant][pos - 1];
    const targetValue = bulletCount + 3;
    const diceCount = getEvadeDiceCount(isPc);

    animateDice(diceCount, `${isPc ? "PC" : "NPC"}回避判定`, (res) => {
      if (isPc) {
        // PC回避は応援（判定後の振り足し）を挟むため結果フェイズへ。確定は resolveEvade で。
        upd(p => ({
          ...p,
          battle: { ...p.battle, phase: "pc_evade_result", evadeRoll: { dice: res, targetValue } },
          log: [`🎲 ${combatant.charName || combatant.name} の回避判定: ${res.join(",")}（目標${targetValue}）`, ...p.log],
        }));
      } else {
        resolveEvadeApply(false, res, targetValue, combatant);
      }
    });
  };

  // 回避判定の確定処理（成功→移動 / 失敗→被弾判定）。PCは結果フェイズの「確定」から、NPCは即時に呼ぶ。
  // fragile=魂の弱い所/人を狂わすの応援（失敗→ファンブル）
  const resolveEvadeApply = (isPc, res, targetValue, combatant, fragile = false) => {
    const maxDie = Math.max(...res);
    const isSuccess = maxDie >= targetValue && !res.every(d => d === 1);
    const isFumble = res.every(d => d === 1) || (fragile && !isSuccess);
    const isSpecial = res.includes(6) && !isFumble;
    const successPhase = isPc ? "pc_evade_move" : "npc_evade_move";
    const failPhase    = isPc ? "pc_hit_check"  : "npc_hit_check";
    const baseSuccessLog = `✨ ${combatant.charName || combatant.name} は回避判定に成功！(出目:${res.join(",")})`;
    const baseFailLog    = `💀 ${combatant.charName || combatant.name} は回避に失敗... (出目:${res.join(",")})`;

    if (isSuccess) {
      // PC回避のスペシャル → 探索同様に animateDice で霊力回復（+特別な絆の親密度+1）
      const reiFull = (combatant.resources?.霊力?.cur || 0) >= (combatant.resources?.霊力?.max || 20);
      if (isPc && isSpecial && !reiFull) {
        animateDice(1, "霊力回復", r => {
          const gain = r[0];
          upd(p => {
            const pcs0 = p.pcs.map(x => x.uid !== b.pcCombatant ? x : { ...x, resources: { ...x.resources, 霊力: { ...x.resources.霊力, cur: Math.min((x.resources.霊力?.cur || 0) + gain, x.resources.霊力?.max || 20) }, 攻撃力: { ...x.resources.攻撃力, cur: 1 + Math.floor(Math.min((x.resources.霊力?.cur || 0) + gain, x.resources.霊力?.max || 20) / 5) } } });
            const { pcs: pcs1, logs } = gainIntimacy(pcs0, b.pcCombatant, 1, `${combatant.charName}のスペシャル`);
            const pcs2 = bumpAch(pcs1, b.pcCombatant, a => ({ ...a, specials: (a.specials || 0) + 1 }));
            return { ...p, pcs: pcs2, battle: { ...p.battle, phase: successPhase, evadeRoll: null }, log: [...logs, `${baseSuccessLog} スペシャル！霊力+${gain} 移動先を選択してください。`, ...p.log] };
          });
        });
      } else if (isPc && isSpecial) {
        // 霊力が最大 → 回復ロールをスキップ（親密度+1・実績は付与）
        upd(p => {
          const { pcs: pcs1, logs } = gainIntimacy(p.pcs, b.pcCombatant, 1, `${combatant.charName}のスペシャル`);
          const pcs2 = bumpAch(pcs1, b.pcCombatant, a => ({ ...a, specials: (a.specials || 0) + 1 }));
          return { ...p, pcs: pcs2, battle: { ...p.battle, phase: successPhase, evadeRoll: null }, log: [...logs, `${baseSuccessLog} スペシャル！（霊力は最大のため回復なし）移動先を選択してください。`, ...p.log] };
        });
      } else {
        upd(p => ({ ...p, battle: { ...p.battle, phase: successPhase, evadeRoll: null }, log: [`${baseSuccessLog}${isPc ? " 移動先を選択してください。" : ""}`, ...p.log] }));
      }
    } else {
      // PC回避のファンブル → 探索同様に animateDice で変調表（馬鹿は免疫）
      if (isPc && isFumble) {
        animateDice(1, "変調決定", r => {
          const bsName = BAD_STATUS_TABLE[r[0]]?.name;
          upd(p => {
            const immune = isBadStatusImmune(combatant, bsName);
            let newPcs = (!bsName || immune) ? p.pcs : p.pcs.map(x => x.uid !== b.pcCombatant ? x : { ...x, badStatus: [...(x.badStatus || []), bsName] });
            newPcs = bumpAch(newPcs, b.pcCombatant, a => ({ ...a, fumbles: (a.fumbles || 0) + 1 }));
            const fumbleLog = !bsName ? "" : immune ? ` 🛡《馬鹿》で変調《${bsName}》を無効化` : ` ファンブル！変調《${bsName}》を獲得`;
            return { ...p, pcs: newPcs, battle: { ...p.battle, phase: failPhase, evadeRoll: null }, log: [`${baseFailLog}${fumbleLog}`, ...p.log] };
          });
        });
      } else {
        upd(p => ({ ...p, battle: { ...p.battle, phase: failPhase, evadeRoll: null }, log: [baseFailLog, ...p.log] }));
      }
    }
  };

  // PC回避の結果フェイズで「確定」したときに呼ぶ（応援の振り足し反映後の最終出目で解決）
  const resolveEvade = () => {
    const er = b.evadeRoll;
    if (!er) return;
    const combatant = pcs.find(p => p.uid === b.pcCombatant);
    resolveEvadeApply(true, er.dice, er.targetValue, combatant, er.fragile);
  };

  // mirror_graze_gain（ミシガンロール）: gs.battle.mirrorGraze の各保有者（回避側自身を除く）に
  // 回避側が得たグレイズ量(gain)を同量加算する。{pcs, npcs, logs} を返す。
  const applyMirrorGraze = (p, pcsArr, npcsArr, dodgerId, gain) => {
    const mirror = p.battle.mirrorGraze || {};
    const ids = Object.keys(mirror).filter(id => id !== dodgerId);
    if (gain <= 0 || ids.length === 0) return [pcsArr, npcsArr, []];
    let pa = pcsArr, na = npcsArr;
    const logs = [];
    const addG = (e) => ({ ...e, resources: { ...e.resources, グレイズ: { ...e.resources.グレイズ, cur: (e.resources.グレイズ?.cur || 0) + gain } } });
    for (const mid of ids) {
      const pc = pa.find(x => x.uid === mid);
      if (pc) { pa = pa.map(x => x.uid === mid ? addG(x) : x); logs.push(`🪞 ${pc.charName}：ミシガンロールでグレイズ+${gain}`); }
      else { const np = na.find(n => n.id === mid); if (np) { na = na.map(n => n.id === mid ? addG(n) : n); logs.push(`🪞 ${np.name}：ミシガンロールでグレイズ+${gain}`); } }
    }
    return [pa, na, logs];
  };

  // 回避成功直後の追加配置（全霊鬼渡り / マッスル・狐符）。
  // afterDodgeShot[宣言者] の各保有者（回避側自身は除く・未使用のみ）を処理し、
  // place は dodgerGrid を直接書き換え、random_3d は pendingDodgeRandom を返す。
  // 返り値: [次の afterDodgeShot, pendingDodgeRandom|null, logs]。dodgerGrid はミューテートする。
  const applyAfterDodgeShot = (p, dodgerId, movedCell, dodgerGrid) => {
    const ads = p.battle.afterDodgeShot || {};
    let adsNext = ads;
    let pending = null;
    const logs = [];
    for (const aid of Object.keys(ads)) {
      const a = ads[aid];
      if (aid === dodgerId || a.used) continue;
      if (a.type === "place_at_enemy_after_first_dodge") {
        dodgerGrid[movedCell - 1] = (dodgerGrid[movedCell - 1] || 0) + (a.count || 1);
        adsNext = { ...adsNext, [aid]: { ...a, used: true } };
        logs.push(`🗡 全霊鬼渡り: 回避側の移動先 ${movedCell}番マスに弾幕×${a.count || 1}`);
      } else if (a.type === "random_3d_after_first_dodge") {
        pending = { attackerId: aid, defenderId: dodgerId, count: a.count || 3 };
        adsNext = { ...adsNext, [aid]: { ...a, used: true } };
        logs.push(`💪 回避直後の追加弾幕（${a.count || 3}D）を振ってください`);
      }
    }
    return [adsNext, pending, logs];
  };

  // random_3d_after_first_dodge: 攻撃側が pendingDodgeRandom の N D を振り、回避側フィールドへランダム配置
  const handleDodgeRandomRoll = () => {
    const pd = b.pendingDodgeRandom;
    if (!pd) return;
    animateDice(pd.count, "回避直後の追加弾幕", res => {
      upd(p => {
        const grid = [...(p.battle.grids[pd.defenderId] || [0,0,0,0,0,0])];
        res.forEach(d => { if (d >= 1 && d <= 6) grid[d - 1] += 1; });
        return { ...p, battle: { ...p.battle, grids: { ...p.battle.grids, [pd.defenderId]: grid }, pendingDodgeRandom: null }, log: [`💪 回避直後の追加弾幕×${pd.count}を配置！`, ...p.log] };
      });
    });
  };

  const handleEvadeMove = (isPc, targetCellNum) => {
    const combatantId = isPc ? b.pcCombatant : b.npcCombatant;
    const oldPos = b.positions[combatantId];
    if (!getEvadeNeighbors(oldPos, b.wallPassBy === combatantId).includes(targetCellNum)) return;
    const bulletsCleared = b.grids[combatantId][oldPos - 1] || 0;

    upd(p => {
      const newGrid = [...p.battle.grids[combatantId]];
      newGrid[oldPos - 1] = 0;

      const currentEntity = isPc ? p.pcs.find(x => x.uid === combatantId) : p.battle.participants.npcs.find(n => n.id === combatantId);
      const currentGraze = currentEntity.resources.グレイズ?.cur || 0;
      const nextGraze = currentGraze + bulletsCleared;
      const currentDice = p.battle.currentEvadeDice ?? getDefaultEvadeDice(currentEntity);
      // next_dodge_no_evasion_loss（オプティカルカモフラージュ）: 1回だけ回避力を減らさない
      const noLoss = p.battle.noEvasionLoss?.[combatantId];
      const nextDice = noLoss ? currentDice : Math.max(0, currentDice - 1);
      const nextNoEvasionLoss = noLoss
        ? { ...p.battle.noEvasionLoss, [combatantId]: false }  // 1回使ったら消費
        : (p.battle.noEvasionLoss || {}); // 空オブジェクトはFirebaseが除去→undefined書込防止

      const updatedEntity = {
        ...currentEntity,
        resources: {
          ...currentEntity.resources,
          グレイズ: { ...currentEntity.resources.グレイズ, cur: nextGraze }
        }
      };

      const updatedPcs = isPc
        ? p.pcs.map(pc => pc.uid === combatantId ? updatedEntity : pc)
        : p.pcs;

      const updatedNpcs = isPc
        ? p.battle.participants.npcs
        : p.battle.participants.npcs.map(npc => npc.id === combatantId ? updatedEntity : npc);

      // mirror_graze_gain（ミシガンロール）: 宣言者は相手のグレイズ獲得時に同量を得る
      const [finalPcs, finalNpcs, mirrorLogs] = applyMirrorGraze(p, updatedPcs, updatedNpcs, combatantId, bulletsCleared);

      // 回避成功直後の追加配置（全霊鬼渡り=place / マッスル・狐符=random_3d）。「最初の回避成功」のみ。
      const [adsNext, pendingDodge, adsLogs] = applyAfterDodgeShot(p, combatantId, targetCellNum, newGrid);

      return {
        ...p,
        pcs: isPc ? bumpAch(finalPcs, combatantId, a => ({ ...a, grazeTotal: (a.grazeTotal || 0) + bulletsCleared, ...((b.isFinal ?? (b.type === "mass" && !b.questId)) ? { graze: (a.graze || 0) + bulletsCleared } : {}) })) : finalPcs,
        battle: {
          ...p.battle,
          participants: {
            ...p.battle.participants,
            npcs: finalNpcs
          },
          positions: { ...p.battle.positions, [combatantId]: targetCellNum },
          grids: { ...p.battle.grids, [combatantId]: newGrid },
          currentEvadeDice: nextDice,
          noEvasionLoss: nextNoEvasionLoss,
          afterDodgeShot: adsNext,
          ...(pendingDodge ? { pendingDodgeRandom: pendingDodge } : {}),
          phase: isPc
            ? (nextDice > 0 ? "pc_evade_intro" : afterDefensePhase(false))
            : (nextDice > 0 ? "npc_evade_intro" : afterDefensePhase(true))
        },
        log: [
          `🏃 ${currentEntity.charName || currentEntity.name} は ${targetCellNum}番マスへ移動。`,
          `✨ ${bulletsCleared}点のグレイズを獲得！(現在:${nextGraze}点)`,
          ...mirrorLogs,
          ...adsLogs,
          ...(noLoss ? [`👁 オプティカルカモフラージュ: 回避力を消費せず回避！`] : []),
          ...p.log
        ]
      };
    });
  };

  // enemy_may_stay_on_dodge（正直者の死/吉弔大結界）用: 移動せずその場で回避
  // （現在マスの弾幕除去・グレイズ獲得・回避力消費は通常の回避移動と同じ、コマだけ動かさない）
  const handleEvadeStay = (isPc) => {
    const combatantId = isPc ? b.pcCombatant : b.npcCombatant;
    const pos = b.positions[combatantId];
    const bulletsCleared = b.grids[combatantId][pos - 1] || 0;
    upd(p => {
      const newGrid = [...p.battle.grids[combatantId]];
      newGrid[pos - 1] = 0;
      const entity = isPc ? p.pcs.find(x => x.uid === combatantId) : p.battle.participants.npcs.find(n => n.id === combatantId);
      const nextGraze = (entity.resources.グレイズ?.cur || 0) + bulletsCleared;
      const currentDice = p.battle.currentEvadeDice ?? getDefaultEvadeDice(entity);
      const noLoss = p.battle.noEvasionLoss?.[combatantId];
      const nextDice = noLoss ? currentDice : Math.max(0, currentDice - 1);
      const nextNoEvasionLoss = noLoss ? { ...p.battle.noEvasionLoss, [combatantId]: false } : (p.battle.noEvasionLoss || {});
      const updated = { ...entity, resources: { ...entity.resources, グレイズ: { ...entity.resources.グレイズ, cur: nextGraze } } };
      const basePcs = isPc ? p.pcs.map(x => x.uid === combatantId ? updated : x) : p.pcs;
      const baseNpcs = isPc ? p.battle.participants.npcs : p.battle.participants.npcs.map(n => n.id === combatantId ? updated : n);
      const [finalPcs, finalNpcs, mirrorLogs] = applyMirrorGraze(p, basePcs, baseNpcs, combatantId, bulletsCleared);
      return {
        ...p,
        pcs: isPc ? bumpAch(finalPcs, combatantId, a => ({ ...a, grazeTotal: (a.grazeTotal || 0) + bulletsCleared, ...((p.battle.isFinal ?? (p.battle.type === "mass" && !p.battle.questId)) ? { graze: (a.graze || 0) + bulletsCleared } : {}) })) : finalPcs,
        battle: {
          ...p.battle,
          participants: { ...p.battle.participants, npcs: finalNpcs },
          grids: { ...p.battle.grids, [combatantId]: newGrid },
          currentEvadeDice: nextDice,
          noEvasionLoss: nextNoEvasionLoss,
          phase: isPc ? (nextDice > 0 ? "pc_evade_intro" : afterDefensePhase(false)) : (nextDice > 0 ? "npc_evade_intro" : afterDefensePhase(true)),
        },
        log: [`🛡 ${entity.charName || entity.name} はその場にとどまって回避（グレイズ+${bulletsCleared}）。`, ...mirrorLogs, ...p.log],
      };
    });
  };

  const handleRecovery = (isPc, targetCellNum) => {
    const combatantId = isPc ? b.pcCombatant : b.npcCombatant;
    const nextPhase = afterDefensePhase(!isPc);

    upd(p => ({
      ...p,
      battle: {
        ...p.battle,
        positions: { ...p.battle.positions, [combatantId]: targetCellNum },
        phase: nextPhase,
        currentEvadeDice: isPc ? getDefaultEvadeDice(p.pcs.find(x => x.uid === combatantId)) : p.battle.currentEvadeDice
      },
      log: [`✨ ${isPc ? pcs.find(x => x.uid === combatantId)?.charName : npcs.find(n => n.id === combatantId)?.name} は ${targetCellNum}番マスに復帰した。`, ...p.log]
    }));
  };

  const applyHit = (isPc, targetId) => {
    upd(p => {
      const target = isPc ? p.pcs.find(x => x.uid === targetId) : p.battle.participants.npcs.find(n => n.id === targetId);
      // extra_hp_loss_if_same_cell_fail（余命幾許）: 余命保有者と被弾側が同じマス番号なら追加で残り人数-1
      const zanmei = p.battle.zanmeiPenalty || {};
      const targetPos = p.battle.positions?.[targetId];
      const extraLoss = Object.keys(zanmei).some(zid => zid !== targetId && p.battle.positions?.[zid] === targetPos) ? 1 : 0;
      const newLives = Math.max(0, (target.resources.残り人数?.cur || 0) - 1 - extraLoss);

      let nextRei = target.resources.霊力?.cur || 0;
      let nextSpe = target.resources.スペルカード?.cur || 0;
      let nextAtk = target.resources.攻撃力?.cur || 1;

      if (isPc && newLives === 1) {
        nextRei = target.resources.霊力?.max || 20;
        nextAtk = 1 + Math.floor(nextRei / 5);
      }
      if (newLives === 1) {
        nextSpe = Math.min(target.resources.スペルカード?.max || 9, nextSpe + 1);
      }

      const updatedTarget = {
        ...target,
        resources: {
          ...target.resources,
          残り人数: { ...target.resources.残り人数, cur: newLives },
          ...(isPc ? {
            霊力: { ...target.resources.霊力, cur: nextRei },
            攻撃力: { ...target.resources.攻撃力, cur: nextAtk }
          } : {}),
          スペルカード: { ...target.resources.スペルカード, cur: nextSpe }
        }
      };

      let nextEntities = isPc
        ? p.pcs.map(pc => pc.uid === targetId ? updatedTarget : pc)
        : p.battle.participants.npcs.map(n => n.id === targetId ? updatedTarget : n);

      // 実績: 決戦で残り人数が減った/0になったPCを記録
      const isFinalB = p.battle.isFinal ?? (p.battle.type === "mass" && !p.battle.questId);
      if (isPc && isFinalB) {
        nextEntities = bumpAch(nextEntities, targetId, a => ({ ...a, livesDropped: true, ...(newLives === 1 ? { livesOne: true } : {}), ...(newLives === 0 ? { livesZero: true } : {}) }));
      }

      const clearedGrid = [0, 0, 0, 0, 0, 0];

      const nextBattle = {
        ...p.battle,
        grids: { ...p.battle.grids, [targetId]: clearedGrid },
        phase: isPc ? (newLives > 0 ? "pc_hit_recovery" : "pc_dropout") : (newLives > 0 ? "npc_hit_recovery" : "npc_dropout"),
        // 太陽を盗んだ鴉の判定用: このラウンドで残り人数が減ったエンティティを記録
        hpReducedThisRound: { ...p.battle.hpReducedThisRound, [targetId]: true },
        ...(isPc ? {} : { participants: { ...p.battle.participants, npcs: nextEntities } }),
      };

      return {
        ...p,
        ...(isPc ? { pcs: nextEntities } : {}),
        battle: nextBattle,
        log: [
          `💥 ${target.charName || target.name} は被弾した！ 残り人数: ${newLives}`,
          extraLoss > 0 ? `☠ 薄命「余命幾許も無し」: 同番号マスのため追加で残り人数-1` : null,
          isPc && newLives === 1 ? `🔥 霊力が最大まで回復した！` : null,
          newLives === 1 ? `🔮 ${target.charName || target.name} はスペルカードを1点獲得した！` : null,
          ...p.log
        ].filter(Boolean)
      };
    });
  };

  const applyPcHit = (pcUid) => applyHit(true, pcUid);
  const applyNpcHit = (npcId) => applyHit(false, npcId);

  // 低速弾: マス選択UIを開く（count>=2 のマスのみ保護可能）
  const openSlowBulletSelect = (ownerId, targetId) => {
    upd(p => ({ ...p, battle: { ...p.battle, slowBulletSelect: { ownerId, targetId } } }));
  };

  const confirmSlowBullet = (cellNum) => {
    const sb = b.slowBulletSelect;
    if (!sb) return;
    upd(p => {
      // grid は変更せず「保護マス」を記録。ラウンド終了時の減衰(handleCleanup)で
      // 取り除かれる弾幕を1つ残す処理を適用する。
      const protect = { ...(p.battle.slowBulletProtect || {}) };
      protect[sb.targetId] = [...(protect[sb.targetId] || []), cellNum];
      const owner = p.pcs.find(x => x.uid === sb.ownerId) || p.battle.participants.npcs.find(n => n.id === sb.ownerId);
      return {
        ...p,
        battle: { ...p.battle, slowBulletProtect: protect, slowBulletSelect: null },
        log: [`🐌 ${owner?.charName || owner?.name} の『低速弾』：${cellNum}番マスの弾幕を1つ残します（ラウンド終了時に適用）。`, ...p.log]
      };
    });
    markDanmakuUsed(sb.ownerId, "低速弾");
  };

  const handleCleanup = () => {
    upd(p => {
      const currentB = p.battle;
      const nextGrids = {};

      // ラウンド終了時の減衰。低速弾で保護されたマスは「取り除かれる弾幕を1つ残す」
      // ＝ 減衰後の値+1（ただし元の値が上限）。例: 3個→通常2個→保護で3個 / 4個→通常2個→保護で3個。
      Object.keys(currentB.grids).forEach(id => {
        const protectedCells = currentB.slowBulletProtect?.[id] || [];
        nextGrids[id] = currentB.grids[id].map((val, idx) => {
          const decayed = val >= 3 ? 2 : val === 2 ? 1 : val;
          return protectedCells.includes(idx + 1) ? Math.min(val, decayed + 1) : decayed;
        });
      });

      const nextActedPcs = [...new Set([...(currentB.actedPcs || []), currentB.pcCombatant])];
      const nextActedNpcs = [...new Set([...(currentB.actedNpcs || []), currentB.npcCombatant])];

      // 回避力変動（このラウンド限定）を元に戻す。costs_own_evasion は記録されないので復元されない。
      const evRestore = currentB.evasionRestore || {};
      let restoredPcs = p.pcs;
      let restoredNpcs = currentB.participants.npcs;
      for (const [id, origCur] of Object.entries(evRestore)) {
        if (restoredPcs.some(x => x.uid === id)) {
          restoredPcs = restoredPcs.map(x => x.uid === id ? { ...x, resources: { ...x.resources, 回避力: { ...x.resources.回避力, cur: origCur } } } : x);
        } else {
          restoredNpcs = restoredNpcs.map(n => n.id === id ? { ...n, resources: { ...n.resources, 回避力: { ...n.resources.回避力, cur: origCur } } } : n);
        }
      }

      restoredPcs = restoredPcs.map(pc => pc.flags?.youki ? { ...pc, flags: { ...pc.flags, youki: false } } : pc);

      // 太陽を盗んだ鴉: このラウンドで残り人数が減らなかった保有者は残り人数-1
      const suntan = currentB.suntanPenalty || {};
      const reduced = currentB.hpReducedThisRound || {};
      const suntanLogs = [];
      for (const id of Object.keys(suntan)) {
        if (reduced[id]) continue;  // 被弾していれば発動しない
        const dec1 = (e) => {
          const cur = Math.max(0, (e.resources?.残り人数?.cur || 0) - 1);
          return { ...e, resources: { ...e.resources, 残り人数: { ...e.resources.残り人数, cur } } };
        };
        const pcHit = restoredPcs.find(x => x.uid === id);
        if (pcHit) { restoredPcs = restoredPcs.map(x => x.uid === id ? dec1(x) : x); suntanLogs.push(`☀ ${pcHit.charName}：太陽を盗んだ鴉のデメリットで残り人数-1`); }
        else { const np = restoredNpcs.find(n => n.id === id); if (np) { restoredNpcs = restoredNpcs.map(n => n.id === id ? dec1(n) : n); suntanLogs.push(`☀ ${np.name}：太陽を盗んだ鴉のデメリットで残り人数-1`); } }
      }

      return {
        ...p,
        pcs: restoredPcs,
        battle: {
          ...currentB,
          participants: { ...currentB.participants, npcs: restoredNpcs },
          phase: "round_start",
          round: currentB.round + 1,
          grids: nextGrids,
          actedPcs: nextActedPcs,
          actedNpcs: nextActedNpcs,
          pcCombatant: null,
          npcCombatant: null,
          spellUsedBy: {},
          wallPassBy: null,
          homingSelect: null,
          wideShotSelect: null,
          slowBulletSelect: null,
          slowBulletProtect: null,
          spellMoveSelect: null,
          evasionRestore: null,
          usedds: {},
          currentEvadeDice: getDefaultEvadeDice(restoredPcs.find(pc => pc.uid === currentB.pcCombatant)),
          supportDice: 0,
          usedIntervention: {},
          usedExtraFamiliar: {},  // ホークビーコンは毎ラウンド1回（extraFamiliarPhase 自体は ...currentB で維持）
          mayStayOnDodge: false,
          noEvasionLoss: {},
          optionalRedo: null,
          optionalClear: null,
          preSpellMove: null,
          afterDodgeShot: {},
          pendingDodgeRandom: null,
          suntanPenalty: {},
          hpReducedThisRound: {},
          mirrorGraze: {},
          zanmeiPenalty: {},
          extraInterventionPool: null,
          pcFamiliarAction: null,
          npcFamiliarAction: null,
          pcPendingSpell: null,
          npcPendingSpell: null,
          pcManualSpell: null,
          npcManualSpell: null,
          tempSelectedPc: null,
          tempSelectedNpc: null
        },
        log: [`📋 ラウンド ${currentB.round} 終了。弾幕が減衰しました。`, ...suntanLogs, ...p.log]
      };
    });
  };

  const renderShotIntro = (isPc) => {
    const combatant = isPc ? combatantPc : npcs.find(n => n.id === b.npcCombatant);
    const title = isPc ? "PLAYER ATTACK TURN" : "NPC ATTACK TURN";
    const titleColor = isPc ? C.blue : C.red;
    const nextPhase = isPc ? "pc_shot_roll" : "npc_shot_roll";
    const buttonLabel = isPc ? "準備完了 🎲" : "ショット開始 🎲";
    const buttonStyle = isPc ? btnFull(C.blueBg, C.blueBorder, C.blue) : btnFull(C.redBg, C.redBorder, C.red);
    const canProceed = isPc ? (user.uid === b.pcCombatant || isGm) : isGm;

    return (
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div style={{ textAlign: "center", animation: "fadeUp 0.6s ease", width: "100%", maxWidth: 460 }}>
          <SpellCard color={titleColor} style={{ marginBottom: 14, minWidth: 260 }}>
            <div style={{ textAlign: "center", padding: "10px 24px" }}>
              <div style={{ fontSize: 9, color: titleColor, letterSpacing: 6, marginBottom: 8 }}>{title}</div>
              <div style={{ fontSize: 26, color: "#fff", fontWeight: 700, textShadow: `0 0 24px ${titleColor}66` }}>{combatant?.charName || combatant?.name}</div>
              <div style={{ fontSize: 11, color: C.textDim, marginTop: 6, letterSpacing: 2 }}>のショットステップ</div>
            </div>
          </SpellCard>
          {/* 使い魔: PC先攻のショット直前に援護射撃 or スキップ（→後でかばう自動発動）を確認 */}
          {isPc && canProceed && b.startOrder === "pc" && hasOfficialSkill(combatantPc, "使い魔") && b.pcFamiliarAction == null && (
            <div style={{ marginTop: 12, marginBottom: 4, padding: 10, background: "rgba(100,181,246,0.08)", border: `1px solid ${C.blueBorder}`, borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: C.blue, marginBottom: 4 }}>🐾 使い魔 — 援護射撃する？</div>
              <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 8 }}>スキップすると後でかばうが自動発動します</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => { handleSupportFire(b.pcCombatant); upd(p => ({ ...p, battle: { ...p.battle, pcFamiliarAction: "support" } })); }}
                  style={btnFull("rgba(100,181,246,0.18)", C.blueBorder, C.blue, { flex: 1, fontSize: 10 })}>
                  💠 援護射撃する
                </button>
                <button
                  onClick={() => upd(p => ({ ...p, battle: { ...p.battle, pcFamiliarAction: "skip_to_cover" } }))}
                  style={btnFull("rgba(255,255,255,0.04)", C.border, C.textDim, { flex: 1, fontSize: 10 })}>
                  ⏭ スキップ
                </button>
              </div>
            </div>
          )}
          {isPc && canProceed && b.startOrder === "pc" && hasOfficialSkill(combatantPc, "使い魔") && b.pcFamiliarAction === "skip_to_cover" && (
            <div style={{ fontSize: 9, color: C.gold, marginTop: 8 }}>✅ かばうを後で自動発動します</div>
          )}

          {/* 使い魔: NPC先攻のショット直前に援護射撃 or スキップ（→後でかばう自動発動）を確認 */}
          {!isPc && canProceed && b.startOrder === "npc" && hasOfficialSkill(combatantNpc, "使い魔") && b.npcFamiliarAction == null && (
            <div style={{ marginTop: 12, marginBottom: 4, padding: 10, background: "rgba(192,57,43,0.08)", border: `1px solid ${C.redBorder}`, borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: C.red, marginBottom: 4 }}>🐾 使い魔 — 援護射撃する？</div>
              <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 8 }}>スキップすると後でかばうが自動発動します</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => upd(p => ({
                    ...p,
                    battle: { ...p.battle, supportDice: (p.battle.supportDice || 0) + 1, npcFamiliarAction: "support" },
                    log: [`💠 ${combatantNpc?.name} の使い魔が援護射撃！攻撃ダイス+1`, ...p.log],
                  }))}
                  style={btnFull("rgba(192,57,43,0.18)", C.redBorder, C.red, { flex: 1, fontSize: 10 })}>
                  💠 援護射撃する
                </button>
                <button
                  onClick={() => upd(p => ({ ...p, battle: { ...p.battle, npcFamiliarAction: "skip_to_cover" } }))}
                  style={btnFull("rgba(255,255,255,0.04)", C.border, C.textDim, { flex: 1, fontSize: 10 })}>
                  ⏭ スキップ
                </button>
              </div>
            </div>
          )}
          {!isPc && canProceed && b.startOrder === "npc" && hasOfficialSkill(combatantNpc, "使い魔") && b.npcFamiliarAction === "skip_to_cover" && (
            <div style={{ fontSize: 9, color: C.gold, marginTop: 8 }}>✅ かばうを後で自動発動します</div>
          )}

          {/* ⚡ ショット直前スキル（近接攻撃） */}
          {canProceed && (() => {
            const attackerId = isPc ? b.pcCombatant : b.npcCombatant;
            const defenderId = isPc ? b.npcCombatant : b.pcCombatant;
            const attacker   = isPc ? combatantPc : combatantNpc;
            const canProximity = hasOfficialSkill(attacker, "近接攻撃") && !isDanmakuUsed(attackerId, "近接攻撃");
            const samePos      = b.positions?.[attackerId] === b.positions?.[defenderId];
            return canProximity ? (
              <div style={{ margin: "16px auto 0", display: "flex", flexDirection: "column", gap: 6, width: 240 }}>
                <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 1, textAlign: "left" }}>⚡ 弾幕スキル（ダイス直前）</div>
                <button onClick={() => tryApplyProximity(attackerId, defenderId)}
                  disabled={!samePos}
                  style={btnFull("rgba(255,100,100,0.18)", C.redBorder, C.red, { opacity: samePos ? 1 : 0.35 })}>
                  💥 近接攻撃{samePos ? "" : "（同マスでない）"}
                </button>
              </div>
            ) : null;
          })()}

          {canProceed &&
            !(isPc && b.startOrder === "pc" && hasOfficialSkill(combatantPc, "使い魔") && b.pcFamiliarAction == null) &&
            !(!isPc && b.startOrder === "npc" && hasOfficialSkill(combatantNpc, "使い魔") && b.npcFamiliarAction == null) && (
            <button
              onClick={() => handleProceedToShotRoll(isPc, nextPhase)}
              style={{ ...buttonStyle, marginTop: 30, width: 200 }}
            >
              {buttonLabel}
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderShotRoll = (isPc) => {
    const attacker = isPc ? combatantPc : npcs.find(n => n.id === b.npcCombatant);
    const hasFamiliarAttacker = hasOfficialSkill(attacker, "使い魔");
    const diceCount = Math.max(1, (attacker?.resources?.攻撃力?.cur || 0) + (b.supportDice || 0) - (hasFamiliarAttacker ? 1 : 0));
    const title = isPc ? "PC攻撃ステップ" : "NPC攻撃ステップ";
    const name = attacker?.charName || attacker?.name;
    const cardColor = isPc ? C.blue : C.red;
    const buttonStyle = isPc ? btnFull(C.blueBg, C.blueBorder, C.blue) : btnFull(C.redBg, C.redBorder, C.red);
    const canRoll = isPc ? (user.uid === b.pcCombatant || isGm) : isGm;

    return (
      <SpellCard
        color={cardColor}
        title={`◆ ${title}`}
        style={{ minWidth: 280, animation: "fadeUp 0.3s ease" }}
        contentStyle={{ textAlign: "center", padding: "14px 18px" }}
      >
        <div style={{ color: "#fff", fontSize: 14, marginBottom: 12, fontWeight: 700, letterSpacing: 2 }}>{name}</div>
        {b.supportDice > 0 && (
          <div style={{
            fontSize: 10, color: C.sakura, marginBottom: 10,
            padding: "3px 8px", display: "inline-block",
            background: `${C.sakura}1a`, border: `1px solid ${C.sakura}55`, borderRadius: 2,
          }}>
            ✦ 援護射撃 +{b.supportDice}D
          </div>
        )}
        {canRoll && (
          <button onClick={() => executeShot(isPc)} style={{ ...buttonStyle, fontSize: 12, letterSpacing: 2, padding: "10px" }}>
            🎲 ショットを放つ ({diceCount}D)
          </button>
        )}
      </SpellCard>
    );
  };

  const renderSpellStep = (isPcAttacker, timing = "standard") => {
    const attacker    = isPcAttacker ? combatantPc : combatantNpc;
    const attackerId  = isPcAttacker ? b.pcCombatant : b.npcCombatant;
    const spellsRaw   = isPcAttacker
      ? [...(attacker?.spellCards || []), ...(attacker?.growthSpellUnlocked ? [attacker?.growthSpellCard] : [])]
      : [...(attacker?.spellCards || [])];
    const spells      = spellsRaw.filter(Boolean).map(t => buildSpellCard(t));
    const available   = spells.filter(s => s.timing === timing);
    const spellPts    = attacker?.resources?.スペルカード?.cur || 0;
    const canDeclare  = isPcAttacker ? (isGm || user.uid === b.pcCombatant) : isGm;
    const cardColor   = isPcAttacker ? C.blue : C.red;
    const _borderColor = isPcAttacker ? C.blueBorder : C.redBorder;

    // roll_check_then_place: 判定ダイスを振る
    if (b.spellRollCheck && b.spellRollCheck.attackerId === (isPcAttacker ? b.pcCombatant : b.npcCombatant)) {
      const src = b.spellRollCheck;
      return (
        <SpellCard color={C.gold} title={`✦ ${src.spellName} ─ 効果判定`} style={{ marginTop: 14 }}>
          <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>
            {src.check.dice}D6 を振り、最大値が {src.check.target} 以上なら成功効果、失敗なら失敗効果が発動します。
          </div>
          {canDeclare && (
            <button onClick={resolveSpellRollCheck} style={btnFull(C.goldBg, C.goldDim, C.gold)}>
              🎲 {src.check.dice}D を振る
            </button>
          )}
        </SpellCard>
      );
    }

    // 任意で再配置（ブラックペガサス流星弾）。攻撃側が操作する。
    if (b.optionalRedo && b.optionalRedo.attackerId === (isPcAttacker ? b.pcCombatant : b.npcCombatant)) {
      return (
        <SpellCard color={C.gold} title="✦ ブラックペガサス流星弾 ─ 再配置" style={{ marginTop: 14 }}>
          <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>
            配置した弾幕を取り除き、もう一度ランダム×{b.optionalRedo.count}を行えます（任意）。
          </div>
          {canDeclare ? (
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={handleOptionalRedo} style={{ ...btnFull(C.goldBg, C.goldDim, C.gold), flex: 1, fontSize: 10 }}>🎲 もう一度配置する</button>
              <button onClick={handleOptionalRedoSkip} style={{ ...btnFull("rgba(255,255,255,0.05)", C.border, C.textDim), flex: 1, fontSize: 10 }}>このまま確定</button>
            </div>
          ) : (
            <div style={{ fontSize: 9, color: C.textFaint }}>相手が選択中…</div>
          )}
        </SpellCard>
      );
    }

    // 配置前の自機移動（死歌/怒面/貧符）。攻撃側が操作する。
    if (b.preSpellMove && b.preSpellMove.attackerId === (isPcAttacker ? b.pcCombatant : b.npcCombatant)) {
      const pm = b.preSpellMove;
      return (
        <SpellCard color={C.gold} title={`✦ ${pm.spellName} ─ 配置前に自機を移動`} style={{ marginTop: 14 }}>
          <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>
            自機を移動させる隣接マスを選んでください（移動後、そのマスに弾幕×{pm.selfCount}を配置します）。
          </div>
          {canDeclare ? (
            <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
              {pm.candidates.map(cell => (
                <button key={cell} onClick={() => handlePreSpellMove(cell)}
                  style={{ width: 36, height: 36, borderRadius: 4, cursor: "pointer", background: "rgba(212,168,56,0.18)", border: `1px solid ${C.goldDim}`, color: C.gold, fontSize: 14 }}>
                  {cell}
                </button>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 9, color: C.textFaint }}>相手が選択中…</div>
          )}
        </SpellCard>
      );
    }

    // 任意で除去→ランダム（ドリームキャッチャー）。攻撃側が操作する。
    if (b.optionalClear && b.optionalClear.attackerId === (isPcAttacker ? b.pcCombatant : b.npcCombatant)) {
      const oc = b.optionalClear;
      return (
        <SpellCard color={C.gold} title="✦ ドリームキャッチャー ─ 任意で除去" style={{ marginTop: 14 }}>
          <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>
            配置した弾幕から取り除くマスを選び、確定すると取り除いた数だけランダム配置します（除去しない場合はそのまま確定）。
          </div>
          {canDeclare ? (
            <>
              <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 8 }}>
                {oc.candidates.map(cell => {
                  const sel = oc.selected.includes(cell);
                  return (
                    <button key={cell} onClick={() => handleOptionalClearToggle(cell)}
                      style={{ width: 36, height: 36, borderRadius: 4, cursor: "pointer", background: sel ? "rgba(212,168,56,0.3)" : "rgba(255,255,255,0.05)", border: `1px solid ${sel ? C.gold : C.border}`, color: sel ? C.gold : C.text, fontSize: 14 }}>
                      {cell}
                    </button>
                  );
                })}
              </div>
              <button onClick={handleOptionalClearConfirm} style={{ ...btnFull(C.goldBg, C.goldDim, C.gold), fontSize: 10 }}>
                {oc.selected.length > 0 ? `🎲 ${oc.selected.length}個除去してランダム×${oc.selected.length}` : "除去せず確定"}
              </button>
            </>
          ) : (
            <div style={{ fontSize: 9, color: C.textFaint }}>相手が選択中…</div>
          )}
        </SpellCard>
      );
    }

    // 移動先選択（こいし「イドの開放」/ 四重結界 / 自機移動スペカ等）。攻撃側が操作する。
    if (b.spellMoveSelect && b.spellMoveSelect.isPcAttacker === isPcAttacker) {
      const ms = b.spellMoveSelect;
      const isSelfMove = ms.targetId === (isPcAttacker ? b.pcCombatant : b.npcCombatant);
      return (
        <SpellCard color={C.gold} title={`✦ ${ms.spellName} ─ ${isSelfMove ? "自機" : "回避側"}の移動先`} style={{ marginTop: 14 }}>
          <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>
            {isSelfMove ? "自機" : "回避側"}を移動させるマスを選んでください。
          </div>
          {canDeclare ? (
            <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
              {ms.candidates.map(cell => (
                <button key={cell} onClick={() => handleSpellMoveCell(cell)}
                  style={{ width: 36, height: 36, borderRadius: 4, cursor: "pointer", background: "rgba(212,168,56,0.18)", border: `1px solid ${C.goldDim}`, color: C.gold, fontSize: 14 }}>
                  {cell}
                </button>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 9, color: C.textFaint }}>相手が移動先を選択中…</div>
          )}
        </SpellCard>
      );
    }

    // CHOOSE 選択中
    if (b.spellChoose && b.spellChoose.attackerId === (isPcAttacker ? b.pcCombatant : b.npcCombatant)) {
      const remaining = b.spellChoose.remaining - (b.spellChoose.selected || []).length;
      const enemyExcludeCell = b.spellChoose.excludeEnemyCell ? b.positions?.[b.spellChoose.defenderId] : null;
      return (
        <SpellCard color={C.gold} title={`✦ マスを ${remaining} 箇所選択`} style={{ marginTop: 14 }}>
          <div style={{ fontSize: 9, color: C.textDim, marginBottom: 10 }}>（グリッド上のマス番号をクリック）</div>
          {enemyExcludeCell && (
            <div style={{ fontSize: 9, color: C.red, marginBottom: 6 }}>※ {enemyExcludeCell}番マス（敵現在地）は選択不可</div>
          )}
          <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
            {[1,2,3,4,5,6].map(cell => {
              const alreadySelected = (b.spellChoose.selected || []).includes(cell);
              const isExcluded = cell === enemyExcludeCell;
              return (
                <button key={cell} onClick={() => handleSpellChooseCell(cell)}
                  disabled={alreadySelected || isExcluded || !canDeclare}
                  style={{ width: 32, height: 32, borderRadius: 4, cursor: (alreadySelected || isExcluded) ? "default" : "pointer",
                    background: alreadySelected ? "rgba(212,168,56,0.3)" : isExcluded ? "rgba(180,40,40,0.15)" : "rgba(255,255,255,0.05)",
                    border: `1px solid ${alreadySelected ? C.gold : isExcluded ? C.redBorder : C.border}`,
                    color: alreadySelected ? C.gold : isExcluded ? C.red : C.text, fontSize: 13 }}>
                  {cell}
                </button>
              );
            })}
          </div>
        </SpellCard>
      );
    }

    // 使用可能なスペカも点数もなく宣言済みでもなければパネル不要
    if (available.length === 0 || b.spellUsedBy?.[attackerId] || spellPts <= 0 || !canDeclare) return null;

    return (
      <SpellCard
        color={cardColor}
        title={`✦ スペルカード宣言 ─ ${attacker?.charName || attacker?.name}`}
        headerRight={<span style={{ fontSize: 10, color: C.gold }}>残り {spellPts} 点</span>}
        style={{ marginTop: 14 }}
        contentStyle={{ padding: "8px 10px" }}
      >
        {available.map((spell, i) => (
          <SpellDeclareItem
            key={i}
            spell={spell}
            cardColor={cardColor}
            declareSpell={declareSpell}
            isPcAttacker={isPcAttacker}
          />
        ))}
      </SpellCard>
    );
  };

  const renderManualSpellControls = () => {
    if (!isGm) return null;
    // PC/NPC それぞれの手動スペルカード（pendingSpell が manual の場合も含む）
    const pcSpell  = expandStoredSpell(b.pcManualSpell  || (b.pcPendingSpell  && b.pcPendingSpell.manual  ? b.pcPendingSpell  : null));
    const npcSpell = expandStoredSpell(b.npcManualSpell || (b.npcPendingSpell && b.npcPendingSpell.manual ? b.npcPendingSpell : null));
    if (!pcSpell && !npcSpell) return null;

    const pcId = b.pcCombatant;
    const npcId = b.npcCombatant;
    const pcGrid = b.grids?.[pcId] || [0,0,0,0,0,0];
    const npcGrid = b.grids?.[npcId] || [0,0,0,0,0,0];
    const pcPos = b.positions?.[pcId] || 0;
    const npcPos = b.positions?.[npcId] || 0;

    const renderEntityEditor = (entityId, label, grid, pos) => (
      <div style={{ flex: 1, minWidth: 220, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, borderRadius: 8, padding: 10 }}>
        <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>{label}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0,1fr))", gap: 6, marginBottom: 8 }}>
          {grid.map((count, index) => (
            <div key={index} style={{ padding: 8, background: "rgba(255,255,255,0.04)", borderRadius: 6, textAlign: "center" }}>
              <div style={{ fontSize: 10, color: C.textDim }}>#{index + 1}</div>
              <div style={{ fontSize: 14, color: C.text, marginTop: 4 }}>{count}</div>
              <div style={{ display: "flex", gap: 4, justifyContent: "center", marginTop: 6 }}>
                <button onClick={() => changeBulletCount(entityId, index + 1, -1)} style={{ width: 22, height: 22, fontSize: 12, borderRadius: 4, border: `1px solid ${C.border}`, background: "rgba(255,255,255,0.05)", color: C.text }}>-</button>
                <button onClick={() => changeBulletCount(entityId, index + 1, 1)} style={{ width: 22, height: 22, fontSize: 12, borderRadius: 4, border: `1px solid ${C.border}`, background: "rgba(255,255,255,0.05)", color: C.text }}>+</button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 10, color: C.textDim, marginBottom: 6 }}>現在の位置: {pos || "-"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0,1fr))", gap: 4 }}>
          {[1,2,3,4,5,6].map(num => (
            <button key={num} onClick={() => updateCombatantPosition(entityId, num)}
              style={{ padding: 6, borderRadius: 4, border: `1px solid ${num === pos ? C.gold : C.border}`, background: num === pos ? "rgba(255,215,0,0.12)" : "rgba(255,255,255,0.04)", color: C.text, fontSize: 11 }}>
              {num}
            </button>
          ))}
        </div>
      </div>
    );

    const renderSpellInfo = (spell, isPcSide) => (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 11, color: isPcSide ? C.blue : C.red, marginBottom: 4 }}>🛠️ 手動スペル処理（{isPcSide ? "PC" : "NPC"}）</div>
          <div style={{ fontSize: 10, color: C.textDim, marginBottom: 6 }}>{spell.name}</div>
          <div style={{ fontSize: 9, color: C.textFaint, lineHeight: 1.5 }}>{spell.textBody || spell.text}</div>
          {spell.condition && (
            <div style={{ fontSize: 9, color: C.red, marginTop: 3 }}>⚠ {spell.condition}</div>
          )}
        </div>
        <button onClick={() => clearManualSpell(isPcSide)} style={{ ...btnFull("rgba(255,255,255,0.08)", C.border, C.text), height: 32, alignSelf: "flex-start" }}>
          完了
        </button>
      </div>
    );

    return (
      <div style={{ background: "rgba(0,0,0,0.82)", padding: 12, borderRadius: 10, border: `1px solid ${C.goldDim}`, marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {pcSpell  && renderSpellInfo(pcSpell, true)}
        {npcSpell && renderSpellInfo(npcSpell, false)}
        <div style={{ fontSize: 9, color: C.textDim }}>PC/NPC の移動と弾幕数を調整できます。</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {renderEntityEditor(pcId, "PC", pcGrid, pcPos)}
          {renderEntityEditor(npcId, "NPC", npcGrid, npcPos)}
        </div>
      </div>
    );
  };

  const renderShotAfter = (isPc) => {
    const nextPhase = isPc ? "npc_evade_intro" : "pc_evade_intro";
    const attacker = isPc ? combatantPc : combatantNpc;
    const defenderId = isPc ? b.npcCombatant : b.pcCombatant;
    const attackerId = isPc ? b.pcCombatant : b.npcCombatant;
    const canProceed = isPc ? (isGm || user.uid === b.pcCombatant) : isGm;
    const buttonStyle = btnFull(C.blueBg, C.blueBorder, C.blue);
    const canUseWideShot = hasOfficialSkill(attacker, "ワイドショット") && !isDanmakuUsed(attackerId, "ワイドショット");
    const attackerPos = b.positions?.[attackerId];
    const attackerCellEmpty = attackerPos ? (b.grids?.[attackerId]?.[attackerPos - 1] || 0) === 0 : true;
    const canUseHighSpeed = canProceed && hasOfficialSkill(attacker, "高速移動") && !isDanmakuUsed(attackerId, "高速移動") && attackerCellEmpty && !b.highSpeedSelect;

    const dice = b.lastShotDice || [];
    const counts = {};
    dice.forEach(d => { counts[d] = (counts[d] || 0) + 1; });
    const hasDupe    = Object.values(counts).some(c => c >= 2);
    const defGrid    = b.grids?.[defenderId] || [0,0,0,0,0,0];
    const hasEmpty   = defGrid.some(v => v === 0);
    const hasBullet  = defGrid.some(v => v > 0);
    const defenderEntity = isPc ? combatantNpc : combatantPc;
    const canProceedDefender = isPc ? isGm : (isGm || user.uid === b.pcCombatant);
    const canUseErase = canProceedDefender && hasOfficialSkill(defenderEntity, "弾消し") && !isDanmakuUsed(defenderId, "弾消し") && !b.eraseSelect;

    // ホーミング・大威力はダイス直後のみ（dice が残っている間）
    // 選択UI表示中は対応ボタンを隠す（二重起動防止）
    const canHoming   = canProceed && dice.length > 0 && hasOfficialSkill(attacker, "ホーミング")   && !isDanmakuUsed(attackerId, "ホーミング") && !b.homingSelect;
    const canBigPower = canProceed && dice.length > 0 && hasOfficialSkill(attacker, "大威力")     && !isDanmakuUsed(attackerId, "大威力") && !b.bigPowerSelect;

    return (
      <SpellCard
        color={C.green}
        title="◆ ショット完了"
        style={{ minWidth: 280, animation: "fadeUp 0.3s ease" }}
        contentStyle={{ textAlign: "center", padding: 14 }}
      >
        {/* ダイス結果表示 */}
        {dice.length > 0 && (
          <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 12 }}>
            {dice.map((d, i) => {
              const c = isPc ? C.blue : C.red;
              return (
                <div key={i} style={{
                  width: 36, height: 36,
                  background: "rgba(8,6,18,0.95)",
                  border: `2px solid ${c}`,
                  borderRadius: 3,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 18, color: c, fontWeight: "bold",
                  boxShadow: `0 0 10px ${c}55`,
                }}>{d}</div>
              );
            })}
          </div>
        )}

        {/* ⚡ 弾幕スキル（ダイス直後タイミング） */}
        {/* ホーミング選択UI */}
        {b.homingSelect && (() => {
          const hs   = b.homingSelect;
          const isOwner = isGm || user.uid === hs.attackerId;
          if (!isOwner) return <div style={{ fontSize: 10, color: C.textDim }}>🔭 相手がホーミングを選択中…</div>;
          if (hs.step === "pick_die") return (
            <div style={{ marginBottom: 10, padding: 10, background: "rgba(100,181,246,0.1)", border: `1px solid ${C.blueBorder}`, borderRadius: 5 }}>
              <div style={{ fontSize: 10, color: C.blue, marginBottom: 6 }}>🔭 ホーミング — 変更するダイスを選んでください</div>
              <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                {hs.dice.map((d, i) => (
                  <button key={i} onClick={() => upd(p => ({ ...p, battle: { ...p.battle, homingSelect: { ...hs, step: "pick_value", selectedDieIdx: i } } }))}
                    style={{ width: 34, height: 34, background: "rgba(14,20,36,0.95)", border: `2px solid ${C.blue}`, borderRadius: 5, fontSize: 16, color: C.blue, cursor: "pointer", fontWeight: "bold" }}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          );
          if (hs.step === "pick_value") return (
            <div style={{ marginBottom: 10, padding: 10, background: "rgba(100,181,246,0.1)", border: `1px solid ${C.blueBorder}`, borderRadius: 5 }}>
              <div style={{ fontSize: 10, color: C.blue, marginBottom: 6 }}>🔭 ホーミング — {hs.dice[hs.selectedDieIdx]} を何に変えますか？</div>
              <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 6 }}>
                {[1,2,3,4,5,6].map(v => (
                  <button key={v} onClick={() => confirmHoming(v)}
                    disabled={v === hs.dice[hs.selectedDieIdx]}
                    style={{ width: 32, height: 32, background: v === hs.dice[hs.selectedDieIdx] ? "rgba(255,255,255,0.02)" : "rgba(100,181,246,0.15)", border: `1px solid ${C.blueBorder}`, borderRadius: 4, fontSize: 14, color: v === hs.dice[hs.selectedDieIdx] ? C.textFaint : C.blue, cursor: v === hs.dice[hs.selectedDieIdx] ? "default" : "pointer", fontWeight: "bold" }}>
                    {v}
                  </button>
                ))}
              </div>
              <button onClick={() => upd(p => ({ ...p, battle: { ...p.battle, homingSelect: { ...hs, step: "pick_die", selectedDieIdx: null } } }))}
                style={{ fontSize: 9, color: C.textFaint, background: "none", border: "none", cursor: "pointer" }}>← 選び直す</button>
            </div>
          );
          return null;
        })()}

        {/* 大威力選択UI */}
        {b.bigPowerSelect && b.bigPowerSelect.attackerId === attackerId && (() => {
          const bp = b.bigPowerSelect;
          const isOwner = isGm || user.uid === bp.attackerId;
          if (!isOwner) return <div style={{ fontSize: 10, color: C.textDim }}>💥 相手が大威力を選択中…</div>;
          return (
            <div style={{ marginBottom: 10, padding: 10, background: "rgba(255,183,77,0.1)", border: `1px solid ${C.goldDim}`, borderRadius: 5 }}>
              <div style={{ fontSize: 10, color: C.gold, marginBottom: 6 }}>💥 大威力 — 追加するマスを選んでください</div>
              <div style={{ display: "flex", gap: 5, justifyContent: "center", marginBottom: 5 }}>
                {bp.dupValues.map(v => (
                  <button key={v} onClick={() => confirmBigPower(v)}
                    style={{ width: 34, height: 34, background: "rgba(255,183,77,0.2)", border: `1px solid ${C.gold}`, borderRadius: 4, fontSize: 14, color: C.gold, cursor: "pointer", fontWeight: "bold" }}>
                    {v}
                  </button>
                ))}
              </div>
              <button onClick={() => upd(p => ({ ...p, battle: { ...p.battle, bigPowerSelect: null } }))}
                style={{ fontSize: 9, color: C.textFaint, background: "none", border: "none", cursor: "pointer" }}>キャンセル</button>
            </div>
          );
        })()}

        {/* ワイドショット選択UI */}
        {b.wideShotSelect && (() => {
          const ws  = b.wideShotSelect;
          const isOwner = isGm || user.uid === ws.attackerId;
          if (!isOwner) return <div style={{ fontSize: 10, color: C.textDim }}>🔀 相手がワイドショットを選択中…</div>;
          const grid = ws.pendingGrid;
          if (ws.step === "done") return (
            <div style={{ marginBottom: 10, padding: 10, background: "rgba(206,147,216,0.1)", border: "1px solid #7b1fa2", borderRadius: 5 }}>
              <div style={{ fontSize: 10, color: C.purple, marginBottom: 6 }}>🔀 選択完了: {(ws.pairs || []).map(pr => `${pr.from}→${pr.to}`).join(", ")}</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={confirmWideShot} style={btnFull("rgba(206,147,216,0.2)", "#7b1fa2", C.purple, { flex: 1 })}>確定する</button>
                <button onClick={() => upd(p => ({ ...p, battle: { ...p.battle, wideShotSelect: null } }))} style={btnFull("none", C.border, C.textFaint, { flex: 1 })}>キャンセル</button>
              </div>
            </div>
          );
          if (ws.step === "pick_empty") return (
            <div style={{ marginBottom: 10, padding: 10, background: "rgba(206,147,216,0.1)", border: "1px solid #7b1fa2", borderRadius: 5 }}>
              <div style={{ fontSize: 10, color: C.purple, marginBottom: 6 }}>🔀 ワイドショット — 移動先の空きマスを選んでください</div>
              {(ws.pairs || []).length > 0 && <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 4 }}>確定済み: {(ws.pairs || []).map(pr => `${pr.from}→${pr.to}`).join(", ")}</div>}
              <div style={{ display: "flex", gap: 5, justifyContent: "center", marginBottom: 6 }}>
                {(() => {
                  const usedSources = (ws.pairs || []).map(p => p.from);
                  return grid.map((v, i) => {
                    const isSelectable = v === 0 && !usedSources.includes(i + 1);
                    return (
                      <button key={i} onClick={() => isSelectable && wideShotPickEmpty(i + 1)}
                        disabled={!isSelectable}
                        style={{ width: 34, height: 34, background: isSelectable ? "rgba(206,147,216,0.2)" : "rgba(255,255,255,0.03)", border: `2px solid ${isSelectable ? C.purple : C.border}`, borderRadius: 5, fontSize: 13, color: isSelectable ? C.purple : C.textFaint, cursor: isSelectable ? "pointer" : "default", fontWeight: "bold" }}>
                        {i + 1}
                      </button>
                    );
                  });
                })()}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {(ws.pairs || []).length > 0 && <button onClick={confirmWideShot} style={btnFull("rgba(206,147,216,0.15)", "#7b1fa2", C.purple, { flex: 1, fontSize: 10 })}>この内容で確定</button>}
                <button onClick={() => upd(p => ({ ...p, battle: { ...p.battle, wideShotSelect: null } }))} style={btnFull("none", C.border, C.textFaint, { flex: 1, fontSize: 10 })}>キャンセル</button>
              </div>
            </div>
          );
          if (ws.step === "pick_source") return (
            <div style={{ marginBottom: 10, padding: 10, background: "rgba(206,147,216,0.1)", border: "1px solid #7b1fa2", borderRadius: 5 }}>
              <div style={{ fontSize: 10, color: C.purple, marginBottom: 6 }}>🔀 ワイドショット — {ws.selectedEmpty}番マスに移す弾幕のマスを選んでください</div>
              <div style={{ display: "flex", gap: 5, justifyContent: "center", marginBottom: 6 }}>
                {grid.map((v, i) => (
                  <button key={i} onClick={() => v > 0 && wideShotPickSource(i + 1)}
                    disabled={v === 0}
                    style={{ width: 34, height: 34, background: v > 0 ? "rgba(206,147,216,0.2)" : "rgba(255,255,255,0.03)", border: `2px solid ${v > 0 ? "#e040fb" : C.border}`, borderRadius: 5, fontSize: 13, color: v > 0 ? "#e040fb" : C.textFaint, cursor: v > 0 ? "pointer" : "default", fontWeight: "bold" }}>
                    {i + 1}{v > 0 ? `(${v})` : ""}
                  </button>
                ))}
              </div>
              <button onClick={() => upd(p => ({ ...p, battle: { ...p.battle, wideShotSelect: { ...ws, step: "pick_empty", selectedEmpty: null } } }))}
                style={{ fontSize: 9, color: C.textFaint, background: "none", border: "none", cursor: "pointer" }}>← 空きマス選択に戻る</button>
            </div>
          );
          return null;
        })()}

        {/* 高速移動選択UI */}
        {b.highSpeedSelect && b.highSpeedSelect.attackerId === attackerId && (() => {
          const hs = b.highSpeedSelect;
          const isOwner = isGm || user.uid === hs.attackerId;
          if (!isOwner) return <div style={{ fontSize: 10, color: C.textDim }}>⚡ 相手が高速移動を選択中…</div>;
          const curPos = b.positions?.[hs.attackerId];
          return (
            <div style={{ marginBottom: 10, padding: 10, background: "rgba(100,181,246,0.1)", border: `1px solid ${C.blueBorder}`, borderRadius: 5 }}>
              <div style={{ fontSize: 10, color: C.blue, marginBottom: 6 }}>⚡ 高速移動 — 移動先を選んでください</div>
              <div style={{ display: "flex", gap: 5, justifyContent: "center", marginBottom: 5 }}>
                {[1,2,3,4,5,6].map(num => (
                  <button key={num} onClick={() => confirmHighSpeed(num)}
                    disabled={num === curPos}
                    style={{ width: 34, height: 34, background: num === curPos ? "rgba(255,255,255,0.02)" : "rgba(100,181,246,0.15)", border: `1px solid ${num === curPos ? C.border : C.blueBorder}`, borderRadius: 4, fontSize: 14, color: num === curPos ? C.textFaint : C.blue, cursor: num === curPos ? "default" : "pointer", fontWeight: "bold" }}>
                    {num}
                  </button>
                ))}
              </div>
              <button onClick={() => upd(p => ({ ...p, battle: { ...p.battle, highSpeedSelect: null } }))}
                style={{ fontSize: 9, color: C.textFaint, background: "none", border: "none", cursor: "pointer" }}>キャンセル</button>
            </div>
          );
        })()}

        {/* 弾消し選択UI（守備側） */}
        {b.eraseSelect && b.eraseSelect.attackerId === defenderId && (() => {
          const es = b.eraseSelect;
          const isOwner = isGm || user.uid === es.attackerId;
          if (!isOwner) return <div style={{ fontSize: 10, color: C.textDim }}>🧹 相手が弾消しを選択中…</div>;
          const grid = b.grids?.[es.targetFieldId] || [0,0,0,0,0,0];
          return (
            <div style={{ marginBottom: 10, padding: 10, background: "rgba(200,160,64,0.1)", border: `1px solid ${C.goldDim}`, borderRadius: 5 }}>
              <div style={{ fontSize: 10, color: C.gold, marginBottom: 6 }}>🧹 弾消し — 取り除くマスを選んでください</div>
              <div style={{ display: "flex", gap: 5, justifyContent: "center", marginBottom: 5 }}>
                {grid.map((v, i) => (
                  <button key={i} onClick={() => v > 0 && confirmErase(i + 1)}
                    disabled={v === 0}
                    style={{ width: 34, height: 34, background: v > 0 ? "rgba(200,160,64,0.2)" : "rgba(255,255,255,0.02)", border: `1px solid ${v > 0 ? C.gold : C.border}`, borderRadius: 4, fontSize: 13, color: v > 0 ? C.gold : C.textFaint, cursor: v > 0 ? "pointer" : "default" }}>
                    {i + 1}{v > 0 ? `(${v})` : ""}
                  </button>
                ))}
              </div>
              <button onClick={() => upd(p => ({ ...p, battle: { ...p.battle, eraseSelect: null } }))}
                style={{ fontSize: 9, color: C.textFaint, background: "none", border: "none", cursor: "pointer" }}>キャンセル</button>
            </div>
          );
        })()}

        {(canHoming || canBigPower || canUseWideShot || canUseHighSpeed || canUseErase) && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 1, marginBottom: 5 }}>⚡ 弾幕スキル</div>

            {canHoming && (
              <button onClick={() => { tryApplyHoming(attackerId, defenderId, dice); }}
                style={{ ...btnFull("rgba(100,181,246,0.18)", C.blueBorder, C.blue), marginBottom: 4 }}>
                🔭 ホーミング（出目を1つ変更）
              </button>
            )}
            {canBigPower && (
              <button onClick={() => openBigPowerSelect(attackerId, defenderId, dice)}
                disabled={!hasDupe}
                style={{ ...btnFull("rgba(255,183,77,0.18)", C.goldDim, C.gold, { opacity: hasDupe ? 1 : 0.35 }), marginBottom: 4 }}>
                💥 大威力{hasDupe ? "" : "（重複出目なし）"}
              </button>
            )}
            {canUseWideShot && !b.wideShotSelect && (
              <button onClick={() => tryApplyWideShot(attackerId, defenderId)}
                disabled={!hasEmpty || !hasBullet}
                style={{ ...btnFull("rgba(206,147,216,0.18)", "#7b1fa2", C.purple, { opacity: hasEmpty && hasBullet ? 1 : 0.35 }), marginBottom: 4 }}>
                🔀 ワイドショット{hasEmpty && hasBullet ? "" : "（条件未達）"}
              </button>
            )}
            {canUseHighSpeed && (
              <button onClick={() => openHighSpeedSelect(attackerId)}
                disabled={!attackerCellEmpty}
                style={{ ...btnFull("rgba(100,181,246,0.18)", C.blueBorder, C.blue, { opacity: attackerCellEmpty ? 1 : 0.35 }), marginBottom: 4 }}>
                ⚡ 高速移動{attackerCellEmpty ? "" : "（現在地に弾幕あり）"}
              </button>
            )}
            {canUseErase && (
              <button onClick={() => openEraseSelect(defenderId, defenderId)}
                disabled={!hasBullet}
                style={{ ...btnFull("rgba(200,160,64,0.18)", C.goldDim, C.gold, { opacity: hasBullet ? 1 : 0.35 }), marginBottom: 4 }}>
                🧹 弾消し{hasBullet ? "" : "（弾幕なし）"}
              </button>
            )}
          </div>
        )}

        <div style={{ color: C.textDim, fontSize: 10, marginBottom: 8 }}>観戦者は「かばう」を使用できます</div>

        {/* 使い魔: かばう or スキップ確認（PC/NPC両対応） */}
        {(() => {
          const hasPcFamiliar = hasOfficialSkill(combatantPc, "使い魔");
          const hasNpcFamiliar = hasOfficialSkill(combatantNpc, "使い魔");
          const canPcFamiliarDecide = isGm || user.uid === b.pcCombatant;

          // Case A: PC has 使い魔, NPC先攻 → after NPC shot, offer かばう to PC
          const isCoverDecision = !isPc && b.startOrder === "npc" && hasPcFamiliar && b.pcFamiliarAction == null;
          const isAutoFamiliarCover = !isPc && hasPcFamiliar && b.pcFamiliarAction === "skip_to_cover";

          // Case D: NPC has 使い魔, PC先攻 → after PC shot, offer かばう to GM (protects NPC)
          const isNpcCoverDecision = isPc && b.startOrder === "pc" && hasNpcFamiliar && b.npcFamiliarAction == null;
          const isNpcAutoFamiliarCover = isPc && hasNpcFamiliar && b.npcFamiliarAction === "skip_to_cover";

          if (isCoverDecision && canPcFamiliarDecide) return (
            <div style={{ marginBottom: 8, padding: 10, background: "rgba(200,160,64,0.08)", border: `1px solid ${C.goldDim}`, borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: C.gold, marginBottom: 4 }}>🐾 使い魔 — かばう？</div>
              <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 8 }}>スキップすると後で援護射撃が自動発動します</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => {
                    animateDice(1, "かばう", (res) => {
                      const die = res[0];
                      upd(p => {
                        const grid = [...(p.battle.grids[b.pcCombatant] || [0,0,0,0,0,0])];
                        const success = grid[die - 1] > 0;
                        if (success) grid[die - 1] -= 1;
                        return {
                          ...p,
                          battle: { ...p.battle, grids: { ...p.battle.grids, [b.pcCombatant]: grid }, pcFamiliarAction: "cover" },
                          log: [`🛡 ${combatantPc?.charName} がかばった！${die}番マス ${success ? "弾幕除去" : "弾幕なし"}`, ...p.log],
                        };
                      });
                    });
                  }}
                  style={btnFull("rgba(200,160,64,0.18)", C.goldDim, C.gold, { flex: 1, fontSize: 10 })}>
                  🛡 かばう
                </button>
                <button
                  onClick={() => upd(p => ({ ...p, battle: { ...p.battle, pcFamiliarAction: "skip_to_support" } }))}
                  style={btnFull("rgba(255,255,255,0.04)", C.border, C.textDim, { flex: 1, fontSize: 10 })}>
                  ⏭ スキップ
                </button>
              </div>
            </div>
          );
          if (isAutoFamiliarCover && canPcFamiliarDecide) return (
            <div style={{ marginBottom: 8, padding: 10, background: "rgba(100,181,246,0.08)", border: `1px solid ${C.blueBorder}`, borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: C.blue, marginBottom: 6 }}>🛡 使い魔が自動でかばいます</div>
              <button onClick={() => handleAutoFamiliarCover(b.pcCombatant)}
                style={btnFull("rgba(100,181,246,0.18)", C.blueBorder, C.blue)}>
                🎲 ダイスを振って自動かばう実行
              </button>
            </div>
          );
          if (isNpcCoverDecision && isGm) return (
            <div style={{ marginBottom: 8, padding: 10, background: "rgba(192,57,43,0.08)", border: `1px solid ${C.redBorder}`, borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: C.red, marginBottom: 4 }}>🐾 使い魔 — かばう？（NPC）</div>
              <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 8 }}>スキップすると後で援護射撃が自動発動します</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => {
                    animateDice(1, "かばう", (res) => {
                      const die = res[0];
                      upd(p => {
                        const grid = [...(p.battle.grids[b.npcCombatant] || [0,0,0,0,0,0])];
                        const success = grid[die - 1] > 0;
                        if (success) grid[die - 1] -= 1;
                        return {
                          ...p,
                          battle: { ...p.battle, grids: { ...p.battle.grids, [b.npcCombatant]: grid }, npcFamiliarAction: "cover" },
                          log: [`🛡 ${combatantNpc?.name} の使い魔がかばった！${die}番マス ${success ? "弾幕除去" : "弾幕なし"}`, ...p.log],
                        };
                      });
                    });
                  }}
                  style={btnFull("rgba(192,57,43,0.18)", C.redBorder, C.red, { flex: 1, fontSize: 10 })}>
                  🛡 かばう
                </button>
                <button
                  onClick={() => upd(p => ({ ...p, battle: { ...p.battle, npcFamiliarAction: "skip_to_support" } }))}
                  style={btnFull("rgba(255,255,255,0.04)", C.border, C.textDim, { flex: 1, fontSize: 10 })}>
                  ⏭ スキップ
                </button>
              </div>
            </div>
          );
          if (isNpcAutoFamiliarCover && isGm) return (
            <div style={{ marginBottom: 8, padding: 10, background: "rgba(192,57,43,0.08)", border: `1px solid ${C.redBorder}`, borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: C.red, marginBottom: 6 }}>🛡 使い魔が自動でかばいます（NPC）</div>
              <button onClick={() => handleAutoFamiliarCover(b.npcCombatant)}
                style={btnFull("rgba(192,57,43,0.18)", C.redBorder, C.red)}>
                🎲 ダイスを振って自動かばう実行
              </button>
            </div>
          );
          return null;
        })()}

        {renderSpellStep(isPc, "standard")}

        {b.pcPendingSpell && (
          <div style={{ marginTop: 8, padding: "5px 8px", background: "rgba(239,154,154,0.1)", border: "1px solid #c62828", borderRadius: 4 }}>
            <div style={{ fontSize: 9, color: "#ef9a9a" }}>⏰ 宣言済 (PC): {b.pcPendingSpell.name}（ラウンド終了時に効果）</div>
          </div>
        )}
        {b.npcPendingSpell && (
          <div style={{ marginTop: 8, padding: "5px 8px", background: "rgba(239,154,154,0.1)", border: "1px solid #c62828", borderRadius: 4 }}>
            <div style={{ fontSize: 9, color: "#ef9a9a" }}>⏰ 宣言済 (NPC): {b.npcPendingSpell.name}（ラウンド終了時に効果）</div>
          </div>
        )}

        {(() => {
          const hasPcFamiliar = hasOfficialSkill(combatantPc, "使い魔");
          const hasNpcFamiliar = hasOfficialSkill(combatantNpc, "使い魔");
          const isCoverDecision = !isPc && b.startOrder === "npc" && hasPcFamiliar && b.pcFamiliarAction == null;
          const isAutoFamiliarCover = !isPc && hasPcFamiliar && b.pcFamiliarAction === "skip_to_cover";
          const isNpcCoverDecision = isPc && b.startOrder === "pc" && hasNpcFamiliar && b.npcFamiliarAction == null;
          const isNpcAutoFamiliarCover = isPc && hasNpcFamiliar && b.npcFamiliarAction === "skip_to_cover";
          const blocked = isCoverDecision || isAutoFamiliarCover || isNpcCoverDecision || isNpcAutoFamiliarCover;
          return canProceed && !b.spellChoose && !b.homingSelect && !b.wideShotSelect && !b.highSpeedSelect && !b.bigPowerSelect && !b.eraseSelect && !blocked && (
            <button
              onClick={() => {
                upd(p => ({
                  ...p,
                  battle: {
                    ...p.battle,
                    phase: nextPhase,
                    lastShotDice: null,
                    currentEvadeDice: nextPhase === "pc_evade_intro"
                      ? getDefaultEvadeDice(combatantPc)
                      : getDefaultEvadeDice(combatantNpc)
                  }
                }));
              }}
              style={{ ...buttonStyle, marginTop: 8 }}
            >
              回避ステップへ進む
            </button>
          );
        })()}
      </SpellCard>
    );
  };

  // 弾幕回避への応援: 戦闘者(PC)への絆を持つ参加PCが回避ダイスを+1できる（絆は消費される）
  const getEvadeCheerBonds = (cheererPc) => {
    if (!cheererPc || !combatantPc) return [];
    // 戦闘参加者に限定（同スポット相当）
    if (b.participantPcUids && !b.participantPcUids.includes(cheererPc.uid)) return [];
    const usedOf = (bd) => cheererPc.bondUsed?.[bd];
    if (cheererPc.uid === combatantPc.uid) {
      if (cheererPc.ps?.name === "我儘") return (cheererPc.bonds || []).filter(bd => !usedOf(bd));
      const selfBonds = [`${combatantPc.charName}自身への絆`, `${combatantPc.charName}への絆`];
      return selfBonds.filter(sb => (cheererPc.bonds || []).includes(sb) && !usedOf(sb));
    }
    const bondName = `${combatantPc.charName}への絆`;
    return (cheererPc.bonds || []).includes(bondName) && !usedOf(bondName) ? [bondName] : [];
  };
  // 回避応援の fragile（魂の弱い所=使用済み絆 / 人を狂わす=絆なし）。失敗時ファンブル。
  const getEvadeFragileCheer = (cheererPc) => {
    if (!cheererPc || !combatantPc || cheererPc.uid === combatantPc.uid) return [];
    if (b.participantPcUids && !b.participantPcUids.includes(cheererPc.uid)) return [];
    const name = getActiveAbility(cheererPc)?.name;
    const bd = `${combatantPc.charName}への絆`;
    if ((name === "魂の弱い所に入り込む程度の能力" || name === "魂の弱い所に入り込む程度の能力＋")
      && (cheererPc.bonds || []).includes(bd) && cheererPc.bondUsed?.[bd]) return [bd];
    if ((name === "人を狂わす程度の能力" || name === "人を狂わす程度の能力＋")
      && !(cheererPc.bonds || []).includes(bd) && !cheererPc.kuruwasuUsed?.[combatantPc.uid]) return [KURUWASU_BOND];
    return [];
  };
  // 回避応援（判定後の振り足し）: 結果フェイズで evadeRoll.dice にダイスを追加する（特別な絆は親密度10で2ダイス）
  const renderEvadeCheer = () => {
    const cheererPc = pcs.find(p => p.uid === user.uid);
    if (!b.evadeRoll || !cheererPc) return null;
    const normal = getEvadeCheerBonds(cheererPc).map(bn => ({ bn, fragile: false }));
    const fragiles = getEvadeFragileCheer(cheererPc).map(bn => ({ bn, fragile: true }));
    // 特別な絆: 戦闘者を対象に持ち、応援欄が空で、戦闘参加者であれば応援可
    const sb = cheererPc.specialBond;
    const special = (sb && combatantPc && sb.targetUid === combatantPc.uid && cheererPc.uid !== combatantPc.uid && !sb.used
      && (!b.participantPcUids || b.participantPcUids.includes(cheererPc.uid)))
      ? [{ bn: SPECIAL_BOND_CHEER, fragile: false }] : [];
    const usable = [...normal, ...special, ...fragiles];
    if (usable.length === 0) return null;
    return (
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 9, color: C.gold, marginBottom: 6, letterSpacing: 1 }}>💪 応援（ダイスを振り足す）</div>
        {usable.map(({ bn, fragile }) => {
          const isSpecial = bn === SPECIAL_BOND_CHEER;
          const diceN = (isSpecial && (cheererPc.specialBond?.intimacy ?? 1) >= 10) ? 2 : 1;
          const label = bn === KURUWASU_BOND ? "絆なしで応援"
            : isSpecial ? `《${cheererPc.specialBond.target}への${cheererPc.specialBond.word || "敬意"}》で応援${diceN === 2 ? "(+2)" : ""}`
            : `《${bn}》で応援`;
          return (
            <button key={bn} onClick={() => animateDice(diceN, "応援（回避振り足し）", res => upd(p => ({
              ...p,
              pcs: p.pcs.map(x => x.uid !== cheererPc.uid ? x : (bn === KURUWASU_BOND
                ? { ...x, kuruwasuUsed: { ...(x.kuruwasuUsed || {}), [combatantPc.uid]: true } }
                : isSpecial
                ? { ...x, specialBond: { ...x.specialBond, used: true } }
                : { ...x, bondUsed: { ...x.bondUsed, [bn]: true } })),
              battle: { ...p.battle, evadeRoll: { ...p.battle.evadeRoll, dice: [...(p.battle.evadeRoll?.dice || []), ...res], wasCheered: true, ...(fragile ? { fragile: true } : {}) } },
              log: [`💪 ${cheererPc.charName} が${label}！回避にダイスを${diceN}個振り足した（出目${res.join(",")}）${fragile ? "（失敗でファンブル）" : ""}`, ...p.log],
            })))} style={{ ...btnFull(isSpecial ? "rgba(255,213,79,0.18)" : fragile ? "rgba(156,39,176,0.16)" : "rgba(200,160,64,0.16)", isSpecial ? C.goldDim : fragile ? C.purpleBorder : C.goldDim, isSpecial ? C.gold : fragile ? C.purple : C.gold, { fontSize: 10, padding: "6px 10px" }), marginBottom: 4, width: "100%" }}>
              {fragile ? "🩸" : isSpecial ? "💞" : ""}{label}{fragile ? "(失敗=ファンブル)" : ""}
            </button>
          );
        })}
      </div>
    );
  };

  // 弾幕回避の結果に対する応援強化（奇跡=出目+1 / 動物=振り直し / 気質=被応援で出目+1）。evadeRoll.dice を操作。
  const renderEvadeCheerEffects = () => {
    const er = b.evadeRoll;
    if (!er) return null;
    const dice = er.dice || [];
    const obs = pcs.find(p => p.uid === user.uid);
    const oName = getActiveAbility(obs)?.name;
    const obsBonds = obs && obs.uid !== b.pcCombatant ? getEvadeCheerBonds(obs) : [];   // 観戦保持者の未使用絆
    const obsBond = obsBonds[0];
    const writeDice = (newDice, consumeUid, consumeBond, extra, logMsg) => upd(p => ({
      ...p,
      pcs: consumeUid ? p.pcs.map(x => x.uid === consumeUid ? { ...x, ...(consumeBond ? { bondUsed: { ...x.bondUsed, [consumeBond]: true } } : {}), ...(extra ? extra(x) : {}) } : x) : p.pcs,
      battle: { ...p.battle, evadeRoll: { ...p.battle.evadeRoll, dice: newDice } },
      log: [logMsg, ...p.log],
    }));
    const plus1Targets = dice.map((d, i) => ({ d, i })).filter(({ d }) => d < 6);

    return (
      <>
        {/* 奇跡を起こす（観戦保持者）: 応援で出目を1つ+1 */}
        {obsBond && (oName === "奇跡を起こす程度の能力" || oName === "奇跡を起こす程度の能力＋") && plus1Targets.length > 0 && (
          <div style={{ marginTop: 8, padding: 6, background: "rgba(255,213,79,0.08)", border: `1px solid ${C.goldDim}`, borderRadius: 4 }}>
            <div style={{ fontSize: 9, color: C.gold, marginBottom: 4 }}>✨ 奇跡: 応援で出目を1つ+1（{obs.charName}）</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center" }}>
              {plus1Targets.map(({ d, i }) => (
                <button key={i} onClick={() => { const nd = [...dice]; nd[i] = Math.min(6, d + 1); writeDice(nd, obs.uid, obsBond, null, `✨ ${obs.charName} の《奇跡を起こす程度の能力》: 回避の出目を ${d}→${d + 1} に変更`); }}
                  style={btnFull("rgba(255,213,79,0.16)", C.goldDim, C.gold, { width: "auto", fontSize: 10, padding: "3px 8px" })}>{d}→{d + 1}</button>
              ))}
            </div>
          </div>
        )}
        {/* 動物を導く（観戦保持者）: 応援で選んだ出目を振り直す（base=1日1回） */}
        {obsBond && (oName === "動物を導く程度の能力" || oName === "動物を導く程度の能力＋") && dice.length > 0 && (() => {
          const isPlus = oName === "動物を導く程度の能力＋";
          if (!isPlus && obs.abilityUse?.["動物を導く程度の能力"]?.day === gs.day) return null;
          return evadeDoubutsuSel === null ? (
            <button onClick={() => setEvadeDoubutsuSel([])} style={{ ...btnFull("rgba(129,199,132,0.14)", C.greenBorder, C.green, { fontSize: 10 }), marginTop: 8, width: "100%" }}>🐾 動物: 応援でダイスを振り直す（{obs.charName}）</button>
          ) : (
            <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 8 }}>
              <button disabled={evadeDoubutsuSel.length === 0} onClick={() => {
                const sel = evadeDoubutsuSel; setEvadeDoubutsuSel(null);
                animateDice(sel.length, "動物（回避振り直し）", res => { const nd = [...dice]; sel.forEach((idx, k) => { nd[idx] = res[k]; }); writeDice(nd, obs.uid, obsBond, isPlus ? null : (x => ({ abilityUse: { ...(x.abilityUse || {}), "動物を導く程度の能力": { ...(x.abilityUse?.["動物を導く程度の能力"] || {}), day: gs.day } } })), `🐾 ${obs.charName} の《動物を導く程度の能力》: 回避の ${sel.length}個を振り直した`); });
              }} style={btnFull(evadeDoubutsuSel.length ? "rgba(129,199,132,0.2)" : "rgba(255,255,255,0.04)", evadeDoubutsuSel.length ? C.greenBorder : C.border, evadeDoubutsuSel.length ? C.green : C.textFaint, { fontSize: 10 })}>振り直す（{evadeDoubutsuSel.length}個）</button>
              <button onClick={() => setEvadeDoubutsuSel(null)} style={btnFull("rgba(255,255,255,0.04)", C.border, C.textFaint, { fontSize: 10 })}>やめる</button>
            </div>
          );
        })()}
        {/* 気質を見極める（戦闘者=被応援者）: 応援を受けた回避で出目を1つ+1 */}
        {(user.uid === b.pcCombatant || isGm) && er.wasCheered && !er.kishitsuUsed
          && (getActiveAbility(combatantPc)?.name === "気質を見極める程度の能力" || getActiveAbility(combatantPc)?.name === "気質を見極める程度の能力＋") && plus1Targets.length > 0 && (
          <div style={{ marginTop: 8, padding: 6, background: "rgba(255,213,79,0.08)", border: `1px solid ${C.goldDim}`, borderRadius: 4 }}>
            <div style={{ fontSize: 9, color: C.gold, marginBottom: 4 }}>✨ 気質: 応援を受け出目を1つ+1</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center" }}>
              {plus1Targets.map(({ d, i }) => (
                <button key={i} onClick={() => upd(p => { const nd = [...dice]; nd[i] = Math.min(6, d + 1); return { ...p, battle: { ...p.battle, evadeRoll: { ...p.battle.evadeRoll, dice: nd, kishitsuUsed: true } }, log: [`✨ ${combatantPc?.charName} の《気質を見極める程度の能力》: 回避の出目を ${d}→${d + 1} に変更`, ...p.log] }; })}
                  style={btnFull("rgba(255,213,79,0.16)", C.goldDim, C.gold, { width: "auto", fontSize: 10, padding: "3px 8px" })}>{d}→{d + 1}</button>
              ))}
            </div>
          </div>
        )}
      </>
    );
  };

  // PC回避の結果フェイズ：出目を表示し、応援（振り足し）を受け付けてから確定する
  const renderEvadeResult = () => {
    const er = b.evadeRoll;
    if (!er) return null;
    const dice = er.dice || [];
    const maxDie = Math.max(...dice, 0);
    const isFumble = dice.length > 0 && dice.every(d => d === 1);
    const isSuccess = maxDie >= er.targetValue && !isFumble;
    const canResolve = user.uid === b.pcCombatant || isGm;
    return (
      <SpellCard color={C.blue} title="◆ 回避判定の結果" style={{ minWidth: 280 }} contentStyle={{ textAlign: "center", padding: 14 }}>
        <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 10, flexWrap: "wrap" }}>
          {dice.map((d, i) => {
            const selecting = evadeDoubutsuSel !== null;
            const picked = selecting && evadeDoubutsuSel.includes(i);
            return (
              <div key={i} onClick={selecting ? () => setEvadeDoubutsuSel(s => s.includes(i) ? s.filter(k => k !== i) : [...s, i]) : undefined}
                style={{ width: 30, height: 30, background: picked ? "rgba(129,199,132,0.25)" : "rgba(14,20,36,0.95)", border: `${picked ? 2 : 1}px solid ${picked ? C.greenBorder : d === 6 ? C.gold : d === 1 ? C.red : C.blueBorder}`, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: d === 6 ? C.gold : d === 1 ? C.red : C.blue, cursor: selecting ? "pointer" : "default" }}>{d}</div>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8 }}>最大{maxDie} / 目標{er.targetValue}</div>
        <div style={{ fontSize: 15, color: isSuccess ? C.green : C.red, fontWeight: 700, marginBottom: 10 }}>
          {isFumble ? "ファンブル…" : isSuccess ? "回避成功！" : "回避失敗…"}
        </div>
        {/* 応援（振り足し）: 戦闘者への絆を持つ参加PCがダイスを足せる（観戦者にも表示） */}
        {renderEvadeCheer()}
        {/* 応援強化（奇跡/動物/気質）: 回避の出目を操作 */}
        {renderEvadeCheerEffects()}
        {canResolve && (
          <button onClick={resolveEvade} style={{ ...btnFull(isSuccess ? C.greenBg : C.redBg, isSuccess ? C.greenBorder : C.redBorder, isSuccess ? C.green : C.red, { fontSize: 12, padding: "9px 14px" }), marginTop: 10 }}>
            判定を確定する{isSuccess ? "（成功→移動）" : "（失敗→被弾）"}
          </button>
        )}
      </SpellCard>
    );
  };

  const renderEvadeIntro = (isPc) => {
    const combatant = isPc ? combatantPc : combatantNpc;
    const targetValue = isPc ? evadeTarget : npcDanmakuAtPos + 3;
    const bulletCount = isPc ? danmakuAtPos : npcDanmakuAtPos;
    const titleColor = isPc ? C.blue : C.red;
    const _borderColor = isPc ? C.blueBorder : C.redBorder;
    const isPlayable = isPc ? (user.uid === b.pcCombatant || isGm) : isGm;
    const canAutoSuccess = bulletCount === 0;
    const remainingDice = getEvadeDiceCount(isPc);
    const canProceed = isPc ? (user.uid === b.pcCombatant || isGm) : isGm;

    return (
      <SpellCard
        color={titleColor}
        title={isPc ? "◆ 回避ステップ" : "◆ 回避ステップ（NPC）"}
        headerRight={
          !canAutoSuccess && (
            <span style={{ fontSize: 10, color: C.gold, letterSpacing: 1 }}>目標 {targetValue}</span>
          )
        }
        style={{ minWidth: 280 }}
        contentStyle={{ textAlign: "center", padding: 14 }}
      >
        <div style={{ color: "#fff", fontSize: 14, marginBottom: 12, fontWeight: 700, letterSpacing: 2 }}>{combatant?.charName || combatant?.name}</div>
        {canAutoSuccess ? (
          <div>
            <div style={{ color: C.green, fontSize: 11, marginBottom: 12, padding: "5px 10px", display: "inline-block", background: `${C.green}1a`, border: `1px solid ${C.greenBorder}`, borderRadius: 2 }}>
              ✦ 弾幕 0 — 自動成功
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              {canProceed && (
                <>
                  <button onClick={() => upd(p => ({ ...p, battle: { ...p.battle, phase: isPc ? "pc_evade_move" : "npc_evade_move" } }))} style={btnFull(C.greenBg, C.greenBorder, C.green)}>移動先を選択</button>
                  <button onClick={() => upd(p => ({ ...p, battle: { ...p.battle, phase: isPc ? "pc_hit_check" : "npc_hit_check", currentEvadeDice: isPc ? getDefaultEvadeDice(combatantPc) : p.battle.currentEvadeDice } }))} style={btnFull("rgba(255,255,255,0.06)", C.border, C.text)}>その場にとどまる</button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div>
            <div style={{ color: C.textDim, fontSize: 10, marginBottom: 10, letterSpacing: 1 }}>弾幕 {bulletCount} + 3 = {targetValue}</div>
            {isPlayable && (
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                {canProceed && (
                  <>
                    {remainingDice > 0 ? (
                      <>
                        <button onClick={() => handleEvadeRoll(isPc)} style={btnFull(isPc ? C.blueBg : C.redBg, isPc ? C.blueBorder : C.redBorder, isPc ? C.blue : C.red, { fontSize: 12, padding: "10px 14px", letterSpacing: 2 })}>
                          🎲 回避判定 ({remainingDice}D)
                        </button>
                        {isPc && (
                          <button onClick={() => upd(p => ({ ...p, battle: { ...p.battle, phase: "pc_hit_check", currentEvadeDice: getDefaultEvadeDice(combatantPc) } }))} style={btnFull("rgba(255,255,255,0.06)", C.border, C.text)}>
                            その場にとどまる
                          </button>
                        )}
                      </>
                    ) : (
                      <button onClick={() => upd(p => ({ ...p, battle: { ...p.battle, phase: isPc ? "pc_hit_check" : "npc_hit_check", currentEvadeDice: isPc ? getDefaultEvadeDice(combatantPc) : p.battle.currentEvadeDice } }))} style={btnFull("rgba(255,255,255,0.06)", C.border, C.text)}>
                        回避ダイスがなくなりました。判定へ
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
            {/* 応援は判定後（pc_evade_result）にダイスを振り足す方式へ変更 */}
          </div>
        )}
        {renderSpellStep(!isPc, "evade")}

        {/* ⚡ 壁抜け（防御側が回避ステップ中に使用） */}
        {isPlayable && (() => {
          const defenderId = isPc ? b.pcCombatant : b.npcCombatant;
          const defender   = isPc ? combatantPc : combatantNpc;
          const canWallPass = hasOfficialSkill(defender, "壁抜け") && !isDanmakuUsed(defenderId, "壁抜け") && !b.wallPassBy;
          return canWallPass ? (
            <button
              onClick={() => {
                markDanmakuUsed(defenderId, "壁抜け");
                upd(p => ({ ...p,
                  battle: { ...p.battle, wallPassBy: defenderId },
                  log: [`🧱 ${defender?.charName || defender?.name} の「壁抜け」が発動：1↔3番・4↔6番が隣接扱いになります。`, ...p.log]
                }));
              }}
              style={{ ...btnFull("rgba(200,160,64,0.18)", C.goldDim, C.gold), marginTop: 8 }}>
              🧱 壁抜け（1↔3・4↔6番を隣接扱い）
            </button>
          ) : b.wallPassBy === defenderId ? (
            <div style={{ fontSize: 9, color: C.gold, marginTop: 6 }}>🧱 壁抜け発動中</div>
          ) : null;
        })()}
      </SpellCard>
    );
  };

  const renderEvadeMove = (isPc) => {
    const borderColor = isPc ? C.blue : C.red;

    return (
      <SpellCard
        color={borderColor}
        title="◆ 移動先を選択"
        style={{ minWidth: 260, animation: "fadeUp 0.3s ease" }}
        contentStyle={{ textAlign: "center", padding: "12px 16px" }}
      >
        <div style={{ color: C.text, fontSize: 11, letterSpacing: 1 }}>ハイライトされた隣接マスをクリックしてください</div>
        {/* enemy_may_stay_on_dodge（正直者の死/吉弔大結界）: 移動せずその場で回避を選べる */}
        {b.mayStayOnDodge && (isPc ? (user.uid === b.pcCombatant || isGm) : isGm) && (
          <button onClick={() => handleEvadeStay(isPc)} style={{ ...btnFull("rgba(255,255,255,0.06)", C.border, C.text), marginTop: 10, fontSize: 10 }}>
            🛡 その場にとどまって回避する
          </button>
        )}
        {isGm && (
          <div style={{ marginTop: 8, fontSize: 9, color: C.textFaint }}>※GMはPLの代わりに操作可能です</div>
        )}
      </SpellCard>
    );
  };

  const renderHitCheck = (isPc) => {
    const targetId = isPc ? b.pcCombatant : b.npcCombatant;
    const target = isPc ? combatantPc : combatantNpc;
    const count = b.grids?.[targetId]?.[b.positions?.[targetId] - 1] || 0;
    const isSafe = count === 0;
    const canApply = isPc ? (user.uid === b.pcCombatant || isGm) : isGm;
    const applyHandler = () => isPc ? applyPcHit(targetId) : applyNpcHit(targetId);
    const cardBorder = isSafe ? C.green : C.red;

    return (
      <SpellCard color={cardBorder} title={isPc ? "◆ 当たり判定" : "◆ 当たり判定（NPC）"} contentStyle={{ textAlign: "center", padding: 14 }}>
        {renderSpellStep(isPc, "hit")}

        {/* ⚡ 不死身スキル */}
        {!isSafe && (() => {
          const defenderId = isPc ? b.pcCombatant : b.npcCombatant;
          const defender   = isPc ? combatantPc : combatantNpc;
          // 不死身は霊力が続く限り何度でも使用可能（once-per-battle ゲートを撤廃。制限は霊力消費のみ）
          const canImmortal = hasOfficialSkill(defender, "不死身");
          const reiryoku = (defender?.resources?.霊力?.cur || 0);
          // 老いることも死ぬこともない程度の能力（藤原妹紅・オート）: 決戦以外で不死身の霊力消費を3点(＋2点)に軽減
          const immortalCost = (() => {
            const ab = getActiveAbility(defender)?.name;
            if (gs.sessionPhase !== "battle") {
              if (ab === "老いることも死ぬこともない程度の能力")   return 3;
              if (ab === "老いることも死ぬこともない程度の能力＋") return 2;
            }
            return 10;
          })();
          const canAfford = reiryoku >= immortalCost;
          return canImmortal ? (
            <div style={{ marginBottom: 10, padding: "8px 10px", background: "rgba(255,100,100,0.1)", border: `1px solid ${C.redBorder}`, borderRadius: 5 }}>
              <div style={{ fontSize: 10, color: C.red, marginBottom: 4 }}>💀 不死身 — 霊力{immortalCost}点消費で被弾を打ち消す</div>
              <div style={{ fontSize: 9, color: C.textDim, marginBottom: 6 }}>現在霊力: {reiryoku}点{!canAfford ? "（不足）" : ""}</div>
              <button
                disabled={!canAfford}
                onClick={() => {
                  const next = afterDefensePhase(!isPc);
                  const isFinalB = b.isFinal ?? (b.type === "mass" && !b.questId);
                  if (isPc) {
                    upd(p => {
                      let pcs = p.pcs.map(x => x.uid !== defenderId ? x : {
                        ...x, resources: {
                          ...x.resources,
                          霊力: { ...x.resources.霊力, cur: x.resources.霊力.cur - immortalCost },
                          攻撃力: { ...x.resources.攻撃力, cur: 1 + Math.floor((x.resources.霊力.cur - immortalCost) / 5) }
                        }
                      });
                      // 実績(不死鳥の証明): 決戦での不死身使用回数
                      if (isFinalB) pcs = bumpAch(pcs, defenderId, a => ({ ...a, immortalUses: (a.immortalUses || 0) + 1 }));
                      return { ...p, pcs, battle: { ...p.battle, phase: next }, log: [`🛡 ${combatantPc?.charName} の『不死身』が発動（霊力-${immortalCost}・攻撃力更新）`, ...p.log] };
                    });
                  } else {
                    upd(p => ({ ...p,
                      battle: { ...p.battle, phase: next,
                        participants: { ...p.battle.participants, npcs: p.battle.participants.npcs.map(n => n.id !== defenderId ? n : { ...n, resources: { ...n.resources, 霊力: { ...n.resources.霊力, cur: n.resources.霊力.cur - immortalCost } } }) }
                      },
                      log: [`🛡 ${combatantNpc?.name} の『不死身』が発動（霊力-${immortalCost}）`, ...p.log]
                    }));
                  }
                }}
                style={btnFull("rgba(192,57,43,0.25)", C.redBorder, C.red, { opacity: canAfford ? 1 : 0.35 })}>
                🛡 不死身を発動する
              </button>
            </div>
          ) : null;
        })()}

        {/* ⚡ 喰らいボム（追加ルール） */}
        {!isSafe && gs.config?.useLastResort && !(isPc ? b.pcLastResort : b.npcLastResort) && canApply && (
          <div style={{ marginBottom: 10, padding: 10, background: "rgba(171,71,188,0.1)", border: "1px solid #7b1fa2", borderRadius: 5 }}>
            <div style={{ fontSize: 10, color: C.purple, marginBottom: 4 }}>💜 喰らいボム</div>
            <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 6 }}>SCを1点消費してダイスを2つ振り足す。{count + 3}以上なら回避成功。</div>
            <button
              disabled={(target?.resources?.スペルカード?.cur || 0) < 1}
              onClick={() => {
                const targetValue = count + 3;
                const defenderId = targetId;
                animateDice(2, "喰らいボム", (res) => {
                  upd(p => {
                    // SCを1消費
                    let pcs = p.pcs.map(x => x.uid !== defenderId ? x : {
                      ...x,
                      resources: { ...x.resources, スペルカード: { ...x.resources.スペルカード, cur: Math.max(0, x.resources.スペルカード.cur - 1) } }
                    });
                    // 実績記録
                    const isFinalB = b.isFinal ?? (b.type === "mass" && !b.questId);
                    if (isFinalB && Math.max(...res) >= targetValue) {
                      pcs = bumpAch(pcs, defenderId, a => ({ ...a, kuraibomuSuccess: true }));
                    }
                    
                    // 現在の回避ダイスプールに追加
                    const newDice = [...(p.battle.evadeRoll?.dice || []), ...res];
                    
                    return {
                      ...p,
                      pcs,
                      battle: { 
                        ...p.battle, 
                        pcLastResort: true,
                        evadeRoll: { ...p.battle.evadeRoll, dice: newDice }
                      },
                      log: [`💜 ${target?.charName || target?.name} 喰らいボム！SC-1 (追加:${res.join(",")})`, ...p.log]
                    };
                  });
                  // 状態更新後、少し待ってから再判定を確定させる（アニメーションの完了を待つため）
                  setTimeout(() => {
                    const combatant = isPc ? combatantPc : combatantNpc;
                    const currentDice = [...(gs.battle?.evadeRoll?.dice || []), ...res];
                    resolveEvadeApply(isPc, currentDice, targetValue, combatant);
                  }, 100);
                });
              }}
              style={btnFull("rgba(171,71,188,0.2)", "#7b1fa2", C.purple, { opacity: (target?.resources?.スペルカード?.cur || 0) >= 1 ? 1 : 0.35 })}>
              💜 喰らいボム（SC {target?.resources?.スペルカード?.cur || 0}点）{(target?.resources?.スペルカード?.cur || 0) < 1 ? "（SCなし）" : ""}
            </button>
          </div>
        )}

        {isSafe ? (
          <div>
            <div style={{ color: C.green, fontSize: 14, fontWeight: "bold", marginBottom: 10 }}>回避成功（SAFE）</div>
            <button onClick={() => {
              const isAttackerPc = b.phase === "npc_hit_check";
              const next = afterDefensePhase(isAttackerPc);
              upd(p => ({ ...p, battle: { ...p.battle, phase: next,
                currentEvadeDice: next === "pc_evade_intro" ? getDefaultEvadeDice(combatantPc) : p.battle.currentEvadeDice
              } }));
            }} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>
              {afterDefensePhase(b.phase === "npc_hit_check") === "round_end_check" ? "ラウンド終了へ" : "後攻ショットへ"}
            </button>
          </div>
        ) : (
          <div>
            <div style={{ color: C.red, fontSize: 14, fontWeight: "bold", marginBottom: 10 }}>被弾（HIT!!）</div>
            {canApply && (
              <button onClick={applyHandler} style={btnFull(C.redBg, C.redBorder, C.red)}>ダメージを適用</button>
            )}
          </div>
        )}
      </SpellCard>
    );
  };

  const renderDropout = (isPc) => {
    const combatant = isPc ? combatantPc : combatantNpc;
    return (
      <SpellCard color={C.red} title="◆ 脱落" contentStyle={{ textAlign: "center", padding: 16 }}>
        <div style={{ color: C.red, fontSize: 16, fontWeight: "bold", marginBottom: 10 }}>脱落</div>
        <div style={{ color: "#fff", fontSize: 11, marginBottom: 15 }}>{combatant?.charName || combatant?.name} は戦線から離脱しました...</div>
        {isGm && (
          <button onClick={() => upd(p => ({ ...p, battle: { ...p.battle, phase: "cleanup" } }))} style={btnFull(C.border, C.border, C.textFaint)}>ラウンド終了処理へ</button>
        )}
      </SpellCard>
    );
  };

  if (b.phase === "setup" && isGm) {
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#040608" }}>
        <div style={{ background: "#0c1020", border: `1px solid ${C.border}`, padding: 30, borderRadius: 8, maxWidth: 500, width: "90%" }}>
          <div style={{ fontSize: 18, color: C.gold, marginBottom: 20, textAlign: "center", letterSpacing: 4 }}>弾幕ごっこ準備</div>
          
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>対戦形式: {b.type === "mass" ? "集団戦" : "通常戦"}</div>
            <div style={{ fontSize: 11, color: C.textDim }}>相手: {npcs.map(n => n.name).join(", ")}</div>
          </div>

          {/* 決戦のみ: GMが任意で追加エネミーを投入できる */}
          {(() => {
            const isFinal = b.isFinal ?? (b.type === "mass" && !b.questId);
            const optionals = gs.scenarioData?.finalBattleOptionalEnemies || [];
            if (!isFinal || optionals.length === 0) return null;
            const currentNpcs = b.participants?.npcs || [];
            return (
              <div style={{ marginBottom: 16, padding: 10, background: "rgba(192,57,43,0.06)", border: `1px solid ${C.redBorder}40`, borderRadius: 6 }}>
                <div style={{ fontSize: 10, color: C.red, letterSpacing: 1, marginBottom: 8 }}>⚔️ 追加エネミー（任意投入）</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {optionals.map((opt, i) => {
                    const optId = `npc_opt_${i}`;
                    const added = currentNpcs.some(n => n.id === optId);
                    return (
                      <button key={i}
                        onClick={() => upd(p => {
                          const cur = p.battle.participants?.npcs || [];
                          const next = added ? cur.filter(n => n.id !== optId) : [...cur, buildBattleNpc(opt, optId)];
                          return { ...p, battle: { ...p.battle, participants: { ...p.battle.participants, npcs: next } } };
                        })}
                        style={btnFull(
                          added ? C.redBg : "rgba(255,255,255,0.05)",
                          added ? C.redBorder : C.border,
                          added ? C.red : C.textDim,
                          { fontSize: 10, padding: "5px 10px" }
                        )}>
                        {added ? "✓ " : "＋ "}{opt.name || `敵${i + 1}`}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8 }}>参加するPCを選択</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {allPcs.map(pc => {
                const currentUids = b.participantPcUids || allPcs.map(p => p.uid);
                const isSelected = currentUids.includes(pc.uid);
                return (
                  <button key={pc.uid}
                    onClick={() => {
                      const cur = b.participantPcUids || allPcs.map(p => p.uid);
                      const next = isSelected ? cur.filter(u => u !== pc.uid) : [...cur, pc.uid];
                      upd(p => ({ ...p, battle: { ...p.battle, participantPcUids: next } }));
                    }}
                    style={btnFull(
                      isSelected ? C.blueBg : "rgba(255,255,255,0.05)",
                      isSelected ? C.blueBorder : C.border,
                      isSelected ? C.blue : C.textDim,
                      { fontSize: 10, padding: "5px 10px" }
                    )}
                  >
                    {isSelected ? "✓ " : ""}{pc.charName}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8 }}>先攻を選択</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[{ key: "pc", label: "PC先攻" }, { key: "npc", label: "NPC先攻" }].map(opt => (
                <button
                  key={opt.key}
                  onClick={() => upd(p => ({ ...p, battle: { ...p.battle, startOrder: opt.key } }))}
                  style={btnFull(
                    b.startOrder === opt.key ? C.goldBg : "rgba(255,255,255,0.05)",
                    b.startOrder === opt.key ? C.goldDim : C.border,
                    b.startOrder === opt.key ? C.gold : C.text,
                    { flex: 1 }
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <button
            disabled={!b.startOrder || (b.participantPcUids || allPcs.map(p => p.uid)).length === 0}
            onClick={() => {
              const useRandom = gs.config?.useRandomPlacement;
              const usePlot = gs.config?.usePlotPlacement;
              const participantUids = b.participantPcUids || allPcs.map(p => p.uid);

              if (usePlot) {
                const grids = {};
                allPcs.filter(p => participantUids.includes(p.uid)).forEach(p => { grids[p.uid] = [0,0,0,0,0,0]; });
                npcs.forEach(n => { grids[n.id] = [0,0,0,0,0,0]; });
                upd(p => ({
                  ...p,
                  battle: {
                    ...p.battle,
                    phase: "plot_initial",
                    grids,
                    plotChoices: {},
                    round: 1,
                    actedPcs: [],
                    actedNpcs: []
                  },
                  log: ["⚖️ プロット配置が開始されました。配置マスを秘匿決定してください。", ...(p.log || [])]
                }));
              } else {
                const positions = {};
                const grids = {};
                allPcs.filter(p => participantUids.includes(p.uid)).forEach(p => {
                  positions[p.uid] = useRandom ? Math.floor(Math.random() * 6) + 1 : 5;
                  grids[p.uid] = [0,0,0,0,0,0];
                });
                npcs.forEach(n => {
                  positions[n.id] = useRandom ? Math.floor(Math.random() * 6) + 1 : 5;
                  grids[n.id] = [0,0,0,0,0,0];
                });

                upd(p => ({
                  ...p,
                  battle: {
                    ...p.battle,
                    phase: "round_start",
                    positions,
                    grids,
                    round: 1,
                    actedPcs: [],
                    actedNpcs: [],
                  },
                  log: ["⚖️ 弾幕ごっこ開始！規約に従い、正々堂々と戦いましょう。", ...(p.log || [])]
                }));
              }
            }}
            style={btnFull(C.redBg, C.redBorder, C.red, { padding: "12px", opacity: b.startOrder ? 1 : 0.3, marginTop: 4 })}
          >
            対戦を開始する
          </button>
        </div>
      </div>
    );
  }

  if (b.phase === "plot_initial") {
    const participantUids = b.participantPcUids || allPcs.map(p => p.uid);
    const myPcs = pcs.filter(p => p.uid === user.uid && participantUids.includes(p.uid));
    const isAllPcsPlotted = participantUids.every(uid => b.plotChoices?.[uid]);
    const isAllNpcsPlotted = npcs.every(n => b.plotChoices?.[n.id]);
    const isAllPlotted = isAllPcsPlotted && isAllNpcsPlotted;

    return (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#040608" }}>
        <div style={{ background: "#0c1020", border: `1px solid ${C.goldDim}`, padding: 30, borderRadius: 8, maxWidth: 500, width: "90%" }}>
          <div style={{ fontSize: 16, color: C.gold, marginBottom: 20, textAlign: "center" }}>プロット配置：初期位置の秘匿決定</div>

          {myPcs.map(p => (
            <div key={p.uid} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: C.blue, marginBottom: 8 }}>{p.charName} の配置マスを選択</div>
              <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                {[1,2,3,4,5,6].map(num => {
                  const selected = b.plotChoices?.[p.uid] === num;
                  return (
                    <button key={num} onClick={() => upd(st => ({ ...st, battle: { ...st.battle, plotChoices: { ...(st.battle.plotChoices || {}), [p.uid]: num } } }))}
                      style={btnFull(selected ? C.blueBg : "rgba(255,255,255,0.05)", selected ? C.blueBorder : C.border, selected ? C.blue : C.text, { width: 40, height: 40, fontSize: 14 })}>
                      {num}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {isGm && npcs.map(n => (
            <div key={n.id} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: C.red, marginBottom: 8 }}>{n.name} の配置マスを選択</div>
              <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                {[1,2,3,4,5,6].map(num => {
                  const selected = b.plotChoices?.[n.id] === num;
                  return (
                    <button key={num} onClick={() => upd(st => ({ ...st, battle: { ...st.battle, plotChoices: { ...(st.battle.plotChoices || {}), [n.id]: num } } }))}
                      style={btnFull(selected ? C.redBg : "rgba(255,255,255,0.05)", selected ? C.redBorder : C.border, selected ? C.red : C.text, { width: 40, height: 40, fontSize: 14 })}>
                      {num}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8 }}>現在の準備状況</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {participantUids.map(uid => {
                const name = allPcs.find(p => p.uid === uid)?.charName || "PC";
                const done = !!b.plotChoices?.[uid];
                return <span key={uid} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: done ? C.greenBg : "rgba(255,255,255,0.05)", color: done ? C.green : C.textFaint, border: `1px solid ${done ? C.greenBorder : C.border}` }}>{name} {done ? "✓" : "…"}</span>;
              })}
              {npcs.map(n => {
                const done = !!b.plotChoices?.[n.id];
                return <span key={n.id} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: done ? C.greenBg : "rgba(255,255,255,0.05)", color: done ? C.green : C.textFaint, border: `1px solid ${done ? C.greenBorder : C.border}` }}>{n.name} {done ? "✓" : "…"}</span>;
              })}
            </div>
          </div>

          {isGm ? (
            <button
              disabled={!isAllPlotted}
              onClick={() => {
                const positions = { ...b.plotChoices };
                upd(p => ({
                  ...p,
                  battle: { ...p.battle, phase: "round_start", positions, plotChoices: null },
                  log: ["⚖️ 全員の配置マスが一斉に公開されました！ 弾幕ごっこを開始します。", ...(p.log || [])]
                }));
              }}
              style={{ ...btnFull(C.goldBg, C.goldDim, C.gold, { marginTop: 20, padding: "12px" }), opacity: isAllPlotted ? 1 : 0.4 }}
            >
              一斉公開して弾幕ごっこを開始
            </button>
          ) : (
            <div style={{ textAlign: "center", fontSize: 11, color: C.textDim, marginTop: 20 }}>
              {isAllPlotted ? "全員の準備が完了しました。GMの開始を待っています…" : "他の参加者のプロットを待っています…"}
            </div>
          )}

        </div>
      </div>
    );
  }

  if (b.phase === "result") {
    const isVictory  = b.result === "pc_win";
    // 「最終決戦（final）」か否か。type:"mass" は集団戦の演出/機構を表すだけで、
    // セッション終了などの最終決戦セマンティクスは isFinal で判定する（集団戦クエストと区別）。
    // 後方互換: 旧セーブの最終決戦は isFinal 未設定だが mass かつ questId 無し。
    const isFinal    = b.isFinal ?? (b.type === "mass" && !b.questId);
    const questId    = b.questId;
    const relatedQ   = questId ? (gs.quests || []).find(q => String(q.id) === String(questId)) : null;

    const finishBattle = () => {
      upd(p => {
        let nextQuests = p.quests || [];

        if (isVictory && questId) {
          nextQuests = nextQuests.map(q => String(q.id) === String(questId) ? { ...q, solved: true } : q);
          const allScenarioQuests = p.scenarioData?.quests || [];
          allScenarioQuests.forEach(scQ => {
            if (scQ.unlockType === "quest" && String(scQ.unlockQuestId) === String(questId)) {
              if (!nextQuests.find(nq => String(nq.id) === String(scQ.id))) {
                nextQuests.push({ ...scQ, revealed: true, solved: false, clues: 0 });
              }
            }
          });
        }

        // 決戦（最終決戦）後は勝敗にかかわらず終幕フェイズへ。通常クエスト戦は探索へ戻る。
        const nextSessionPhase = isFinal ? "epilogue" : "explore";
        const logLine = isVictory
          ? (isFinal ? "🏆 最終決戦制覇！セッション終了！" : `🏆 弾幕ごっこ勝利！クエスト「${relatedQ?.name || ""}」が解決されました。`)
          : (isFinal ? "💀 最終決戦敗北...セッション終了。" : "💀 弾幕ごっこ敗北...探索フェイズへ戻ります。");

        // クエスト戦（集団戦含む）終了時、参加PC全員を行動済みにする（単体戦は scenePcUid のみ）。
        const scenePcUid = p.battle?.scenePcUid;
        const finishedUids = questId
          ? (p.battle?.participantPcUids || (scenePcUid ? [scenePcUid] : []))
          : [];
        const nextActedPcs = finishedUids.length
          ? [...new Set([...(p.actedPcs || []), ...finishedUids])]
          : (p.actedPcs || []);

        const recoveredPcs = nextSessionPhase === "explore"
          ? p.pcs.map(x => {
              const lives = x.resources?.残り人数?.cur ?? 0;
              return lives === 0
                ? { ...x, resources: { ...x.resources, 残り人数: { ...x.resources.残り人数, cur: 1 } } }
                : x;
            })
          : p.pcs;
        const recoveredNames = nextSessionPhase === "explore"
          ? p.pcs.filter(x => (x.resources?.残り人数?.cur ?? 0) === 0).map(x => x.charName)
          : [];
        const recoveryLogs = recoveredNames.map(n => `🔵 ${n} の残り人数が0のため1に回復した`);

        // 怪力乱神を持つ程度の能力（オート）: 探索フェイズ中の弾幕ごっこ勝利でやる気+1（＋は霊力D6も）
        const kairikiUids = (isVictory && !isFinal)
          ? (p.battle?.participantPcUids || (p.battle?.pcCombatant ? [p.battle.pcCombatant] : []))
          : [];
        const kairikiLogs = [];
        const finalPcs = recoveredPcs.map(x => {
          if (!kairikiUids.includes(x.uid)) return x;
          const ab = (x.growthAbilityUnlocked && x.growthAbility?.name) ? x.growthAbility : x.as;
          const name = ab?.name;
          if (name !== "怪力乱神を持つ程度の能力" && name !== "怪力乱神を持つ程度の能力＋") return x;
          const yr = x.resources.やる気 || { cur: 0, max: 99 };
          let res = { ...x.resources, やる気: { ...yr, cur: Math.min(yr.max, yr.cur + 1) } };
          let extra = "";
          if (name === "怪力乱神を持つ程度の能力＋") {
            const gain = Math.ceil(Math.random() * 6);
            const rei = x.resources.霊力 || { cur: 0, max: 20 };
            const nextRei = Math.min(rei.max, rei.cur + gain);
            res = { ...res, 霊力: { ...rei, cur: nextRei }, 攻撃力: { ...x.resources.攻撃力, cur: 1 + Math.floor(nextRei / 5) } };
            extra = `・霊力+${gain}`;
          }
          kairikiLogs.push(`🔵 ${x.charName} の《怪力乱神》: 弾幕ごっこ勝利でやる気+1${extra}`);
          return { ...x, resources: res };
        });

        return {
          ...p,
          pcs: finalPcs,
          quests: nextQuests,
          sessionPhase: nextSessionPhase,
          actedPcs: nextActedPcs,
          battle: { ...p.battle, active: false },
          log: [logLine, ...kairikiLogs, ...recoveryLogs, ...p.log]
        };
      });
    };

    const _borderColor = isVictory ? C.gold : C.red;
    const _titleColor  = isVictory ? C.gold : C.red;
    const title       = isVictory
      ? (isFinal ? "🏆 最終決戦制覇！" : "🎉 勝利！")
      : (isFinal ? "💀 最終決戦敗北..." : "💀 敗北...");

    const acColor = isVictory ? C.gold : C.red;
    const acColorDim = isVictory ? C.goldDim : C.redBorder;
    return (
      <div style={{ width: "100%", height: "100%", position: "relative", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
        background: isVictory
          ? "radial-gradient(ellipse at 50% 60%, #1c1500 0%, #04060a 65%)"
          : "radial-gradient(ellipse at 50% 40%, #180508 0%, #04060a 65%)",
      }}>
        {/* 拡張リング */}
        {[0, 0.85, 1.7].map((delay, i) => (
          <div key={i} style={{
            position: "absolute", borderRadius: "50%", pointerEvents: "none",
            width: 520, height: 520, left: "calc(50% - 260px)", top: "calc(50% - 260px)",
            border: `1px solid ${acColor}44`,
            animation: `brRing 2.8s ${delay}s ease-out infinite`,
          }} />
        ))}
        {/* 中心グロー */}
        <div style={{
          position: "absolute", borderRadius: "50%", pointerEvents: "none",
          width: 300, height: 300, left: "calc(50% - 150px)", top: "calc(50% - 150px)",
          background: `radial-gradient(circle, ${acColor}1a 0%, transparent 70%)`,
          animation: "brGlow 2.2s ease-in-out infinite",
        }} />

        {/* メインコンテンツ */}
        <div style={{ position: "relative", zIndex: 5, textAlign: "center", maxWidth: 480, width: "90%",
          animation: "brCardIn 0.58s cubic-bezier(0.34,1.56,0.64,1) 0.05s both" }}>

          <div style={{ fontSize: 16, color: acColor, letterSpacing: 10, marginBottom: 10,
            animation: "brFadeUp 0.4s ease 0.3s both" }}>◆ ◆ ◆</div>

          <div style={{ fontSize: 30, color: acColor, fontWeight: "bold", letterSpacing: 4, marginBottom: 6,
            textShadow: `0 0 36px ${acColor}cc, 0 0 80px ${acColor}44`,
            animation: "brTitleIn 0.52s cubic-bezier(0.34,1.56,0.64,1) 0.2s both" }}>
            {title}
          </div>

          <div style={{ fontSize: 16, color: acColor, letterSpacing: 10, marginBottom: 22,
            animation: "brFadeUp 0.4s ease 0.5s both" }}>◆ ◆ ◆</div>

          <div style={{ padding: "16px 20px", background: "rgba(0,0,0,0.55)",
            border: `1px solid ${acColorDim}`, borderRadius: 6, marginBottom: 20,
            animation: "brFadeUp 0.45s ease 0.65s both" }}>
            {isVictory && !isFinal && relatedQ && (
              <>
                <div style={{ fontSize: 10, color: C.textFaint, letterSpacing: 3, marginBottom: 6 }}>クエスト解決</div>
                <div style={{ fontSize: 14, color: "#fff", letterSpacing: 1 }}>「{relatedQ.name}」</div>
              </>
            )}
            {isVictory && isFinal && (
              <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.8 }}>
                全ての強敵を撃破しました。<br />終幕へ進みます。
              </div>
            )}
            {!isVictory && (
              <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.8 }}>
                {isFinal ? "最終決戦に敗れました。終幕へ進みます。" : "残念でした。探索フェイズへ戻ります。"}
              </div>
            )}
          </div>

          <div style={{ animation: "brFadeUp 0.4s ease 0.9s both" }}>
            {isGm ? (
              <button onClick={finishBattle}
                style={{ ...btnFull(isVictory ? C.goldBg : C.redBg, acColorDim, acColor), padding: "10px", letterSpacing: 2, fontSize: 12 }}>
                {isFinal ? "終幕へ進む" : "探索フェイズへ戻る"}
              </button>
            ) : (
              <div style={{ fontSize: 10, color: C.textDim }}>GMが戦闘を終了するのを待っています...</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (b.phase === "round_start") {
    const checkReset = () => {
      let nextActedPcs = b.actedPcs || [];
      let nextActedNpcs = b.actedNpcs || [];
      let logs = [];

      if (unactedPcs.length === 0 && alivePcs.length > 0) {
        nextActedPcs = [];
        logs.push("🔄 PC陣営が全員行動したため、全員未行動に戻ります。");
      }
      if (unactedNpcs.length === 0 && aliveNpcs.length > 0) {
        nextActedNpcs = [];
        logs.push("🔄 NPC陣営が全員行動したため、全員未行動に戻ります。");
      }
      
      if (logs.length > 0) {
        upd(p => ({
          ...p,
          battle: { ...p.battle, actedPcs: nextActedPcs, actedNpcs: nextActedNpcs },
          log: [...logs.reverse(), ...p.log]
        }));
      }
    };

    const startRound = (pcUid, npcId) => {
      const pcChar = pcs.find(p => p.uid === pcUid);
      const npcChar = npcs.find(n => n.id === npcId);
      const order = b.startOrder || "pc";
      const firstPhase = order === "npc" ? "npc_shot_intro" : "pc_shot_intro";

      upd(p => ({
        ...p,
        battle: {
          ...p.battle,
          phase: firstPhase,
          pcCombatant: pcUid,
          npcCombatant: npcId,
          usedIntervention: {},
          usedExtraFamiliar: {},
          mayStayOnDodge: false,
          noEvasionLoss: {},
          optionalRedo: null,
          optionalClear: null,
          preSpellMove: null,
          afterDodgeShot: {},
          pendingDodgeRandom: null,
          suntanPenalty: {},
          hpReducedThisRound: {},
          mirrorGraze: {},
          zanmeiPenalty: {},
          pcFamiliarAction: null,
          npcFamiliarAction: null,
          usedds: {},
          homingSelect: null,
          wideShotSelect: null,
          eraseSelect: null,
          highSpeedSelect: null,
          bigPowerSelect: null,
          slowBulletSelect: null,
          slowBulletProtect: null,
          spellMoveSelect: null,
          evasionRestore: null,
          spellChoose: null,
          evadeRoll: null,
          pcLastResort: false,
          npcLastResort: false,
          spellUsedBy: {},
          wallPassBy: null,
          pcPendingSpell: null,
          npcPendingSpell: null,
          pcManualSpell: null,
          npcManualSpell: null,
          lastShotDice: null,
          supportDice: 0,
        },
        log: [`⚔️ ラウンド開始：${npcChar.name} vs ${pcChar.charName} （先攻: ${order === "pc" ? "PC" : "NPC"}）`, ...p.log]
      }));
    };

    return (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#040608" }}>
        <div style={{ background: "#0c1020", border: `1px solid ${C.goldDim}`, padding: 30, borderRadius: 8, maxWidth: 500, width: "90%" }}>
          <div style={{ fontSize: 16, color: C.gold, marginBottom: 20, textAlign: "center" }}>ラウンド {b.round}：対戦者選出</div>
          
          {!isGm ? (
            b.pcCombatant === user.uid ? (
              <div>
                <div style={{ textAlign: "center", fontSize: 12, color: C.blue, marginBottom: 6 }}>
                  ▶ あなたが対戦者に選出されました
                </div>
                {b.npcCombatant && combatantNpc && (
                  <div style={{ textAlign: "center", fontSize: 10, color: C.textDim, marginBottom: 14 }}>
                    VS {combatantNpc.name}
                  </div>
                )}
                {renderSpellStep(true, "round_start")}
                <div style={{ textAlign: "center", fontSize: 10, color: C.textFaint, marginTop: 16 }}>
                  GMがラウンドを開始するのを待っています...
                </div>
              </div>
            ) : (
              <div style={{ textAlign: "center", color: C.textDim }}>GMが対戦者を選出しています...</div>
            )
          ) : (
            <div>
              <div style={{ fontSize: 11, color: C.textDim, marginBottom: 10 }}>1. 出撃するPCを選択</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
                {alivePcs.map(p => {
                  const isActed = (b.actedPcs || []).includes(p.uid);
                  const isSelected = b.tempSelectedPc === p.uid;
                  return (
                    <button
                      key={p.uid}
                      onClick={() => upd(pState => ({ ...pState, battle: { ...pState.battle, tempSelectedPc: p.uid, pcCombatant: p.uid } }))}
                      style={btnFull(isSelected ? C.blueBg : "rgba(255,255,255,0.05)", isSelected ? C.blue : C.border, isSelected ? C.blue : (isActed ? C.textFaint : C.text))}
                    >
                      {p.charName} {isActed ? "(行動済)" : ""}
                    </button>
                  );
                })}
              </div>

              <div style={{ fontSize: 11, color: C.textDim, marginBottom: 10 }}>2. 迎え撃つNPCを選択</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                {aliveNpcs.map(n => {
                  const isActed = (b.actedNpcs || []).includes(n.id);
                  const isSelected = b.tempSelectedNpc === n.id;
                  return (
                    <button
                      key={n.id}
                      onClick={() => upd(pState => ({ ...pState, battle: { ...pState.battle, tempSelectedNpc: n.id, npcCombatant: n.id } }))}
                      style={btnFull(isSelected ? C.redBg : "rgba(255,255,255,0.05)", isSelected ? C.red : C.border, isSelected ? C.red : (isActed ? C.textFaint : C.text))}
                    >
                      {n.name} {isActed ? "(行動済)" : ""}
                    </button>
                  );
                })}
              </div>

              {b.pcCombatant && b.npcCombatant && (<>
                {renderSpellStep(true,  "round_start")}
                {renderSpellStep(false, "round_start")}
              </>)}

              <button 
                disabled={!b.tempSelectedPc || !b.tempSelectedNpc}
                onClick={() => startRound(b.tempSelectedPc, b.tempSelectedNpc)}
                style={btnFull(C.goldBg, C.goldDim, C.gold, { opacity: (b.tempSelectedPc && b.tempSelectedNpc) ? 1 : 0.3 })}
              >
                この対戦で開始する
              </button>
              
              {unactedPcs.length === 0 && (
                <button onClick={checkReset} style={{...btnFull("none", "none", C.textFaint), marginTop: 10}}>全員の未行動状態をリセットする</button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#040608", overflow: "hidden" }}>
      {/* シーン背景を暗めに流用（GMがシーン背景を設定していれば戦闘背景になる） */}
      {sceneData?.bg && (
        <img src={sceneData.bg} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.26, filter: "brightness(0.6) saturate(0.9) blur(1px)", pointerEvents: "none" }} />
      )}
      {/* アトモスフィア層: 上部の妖光グラデーション＋下部ビネット（背景画像が無くても奥行きを出す） */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse 75% 55% at 50% 30%, rgba(60,40,90,0.35) 0%, transparent 62%), radial-gradient(ellipse 90% 60% at 50% 108%, rgba(0,0,0,0.65) 0%, transparent 55%)" }} />
      <BattleParticleCanvas />
    <div style={{ position: "relative", zIndex: 1, width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "16px 20px 24px", boxSizing: "border-box", gap: 14, overflowY: "auto" }}>
      <style>{`
        @keyframes spellFlashIn {
          0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.85); }
          12%  { opacity: 1; transform: translate(-50%, -50%) scale(1.03); }
          22%  { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          75%  { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(1.04); }
        }
        @keyframes phaseBannerAnim {
          0%   { opacity: 0; transform: translateX(-50%) translateY(-8px) scaleX(0.92); }
          18%  { opacity: 1; transform: translateX(-50%) translateY(0)    scaleX(1); }
          72%  { opacity: 1; transform: translateX(-50%) translateY(0)    scaleX(1); }
          100% { opacity: 0; transform: translateX(-50%) translateY(4px)  scaleX(0.96); }
        }
        @keyframes brRing {
          0%   { transform: scale(0.08); opacity: 0.75; }
          100% { transform: scale(1.7);  opacity: 0; }
        }
        @keyframes brGlow {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50%       { opacity: 1;   transform: scale(1.22); }
        }
        @keyframes brCardIn {
          from { opacity: 0; transform: scale(0.78) translateY(18px); }
          to   { opacity: 1; transform: scale(1)    translateY(0); }
        }
        @keyframes brTitleIn {
          from { opacity: 0; transform: scale(0.65) translateY(-10px); }
          to   { opacity: 1; transform: scale(1)    translateY(0); }
        }
        @keyframes brFadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* スペルカード宣言フラッシュ */}
      {spellFlash && (
        <div style={{ position: "absolute", top: "50%", left: "50%", zIndex: 30, pointerEvents: "none", animation: "spellFlashIn 2.8s forwards", textAlign: "center" }}>
          <div style={{ background: "rgba(4,4,12,0.92)", border: `2px solid ${spellFlash.color}`, borderRadius: 2, padding: "20px 40px", boxShadow: `0 0 48px ${spellFlash.color}55, 0 0 100px ${spellFlash.color}22, inset 0 0 32px rgba(0,0,0,0.7)` }}>
            {[{ top: -6, left: 12 }, { top: -6, right: 12 }, { bottom: -6, left: 12 }, { bottom: -6, right: 12 }].map((pos, i) => (
              <div key={i} style={{ position: "absolute", width: 10, height: 10, background: spellFlash.color, transform: "rotate(45deg)", ...pos }} />
            ))}
            <div style={{ fontSize: 9, color: spellFlash.color, letterSpacing: 5, marginBottom: 10, opacity: 0.9 }}>◆ SPELL CARD ◆</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginBottom: 10 }}>
              {spellFlash.customPortrait
                ? <img src={spellFlash.customPortrait} alt="" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 2, border: `1px solid ${spellFlash.color}66` }} />
                : <CharSprite spriteRow={spellFlash.spriteRow} spriteCol={spellFlash.spriteCol} size={48} style={{ borderRadius: 2, border: `1px solid ${spellFlash.color}66` }} />}
              <div>
                <div style={{ fontSize: 18, color: "#fff", fontWeight: "bold", letterSpacing: 2, whiteSpace: "nowrap", textShadow: `0 0 16px ${spellFlash.color}88` }}>{spellFlash.name}</div>
                <div style={{ fontSize: 10, color: spellFlash.color, letterSpacing: 3, marginTop: 4, opacity: 0.85 }}>{spellFlash.attackerName}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* フェーズチェンジバナー */}
      {phaseBanner && (
        <div style={{ position: "absolute", top: "18%", left: "50%", zIndex: 20, pointerEvents: "none", animation: "phaseBannerAnim 1.6s forwards" }}>
          <div style={{ fontSize: 22, fontWeight: "bold", color: C.gold, letterSpacing: 8, whiteSpace: "nowrap", textShadow: `0 0 24px ${C.gold}, 0 0 48px ${C.gold}66` }}>
            {phaseBanner}
          </div>
          <div style={{ height: 2, background: `linear-gradient(90deg, transparent, ${C.gold}, transparent)`, marginTop: 6, opacity: 0.6 }} />
        </div>
      )}

      <BattleDiceTray diceResult={gs.dice?.results} diceAnim={gs.dice?.rolling} label={gs.dice?.label} />

      {/* ミュートボタン */}
      <button onClick={toggleSfx} title={sfxMuted ? "効果音オン" : "効果音オフ"} style={{ position: "absolute", top: 12, right: 16, background: "rgba(8,6,18,0.85)", border: `1px solid ${C.border}`, borderRadius: 4, color: sfxMuted ? C.textFaint : C.textDim, fontSize: 14, padding: "2px 7px", cursor: "pointer", zIndex: 10, lineHeight: 1.6 }}>
        {sfxMuted ? "🔇" : "🔊"}
      </button>

      {/* フェーズバッジ（最上部・グリッドと重ならない） */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          background: "rgba(8,6,18,0.95)",
          border: `1px solid ${C.goldDim}`,
          color: C.gold,
          padding: "5px 22px",
          borderRadius: 2,
          fontSize: 11,
          fontWeight: "bold",
          letterSpacing: 3,
          boxShadow: `0 0 18px ${C.gold}22`,
        }}>
          <span style={{ color: C.textDim, fontSize: 9, letterSpacing: 2 }}>Rd.{b.round || 1}</span>
          <span style={{ color: C.goldDim }}>◆</span>
          <span>{PHASE_LABELS[b.phase] || b.phase}</span>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 15, flexWrap: "wrap" }}>
        {npcs.map(n => {
          const isCombatant = b.npcCombatant === n.id;
          
          const isRecovery = b.phase === "npc_hit_recovery" && isCombatant;
          const isEvadeMove = b.phase === "npc_evade_move" && isCombatant;

          let highlights = [];
          if (isGm) {
            if (isRecovery) highlights = [1, 2, 3, 4, 5, 6];
            else if (isEvadeMove) highlights = getEvadeNeighbors(b.positions[n.id], b.wallPassBy === n.id);
          }

          return (
            <BattleGrid
              key={n.id}
              name={n.name}
              isNpc={true}
              isCombatant={isCombatant}
              grid={b.grids?.[n.id]}
              pos={b.positions?.[n.id]}
              isDead={n.resources.残り人数?.cur <= 0}
              highlightCells={highlights}
              lives={n.resources.残り人数?.cur}
              maxLives={n.resources.残り人数?.max}
              sc={n.resources.スペルカード?.cur}
              onCellClick={(num) => {
                if (isRecovery) {
                  handleRecovery(false, num);
                } else if (isEvadeMove) {
                  handleEvadeMove(false, num);
                }
              }}
              sprite={renderEnemySprite(n, 40)}
            />
          );
        })}
      </div>

      {/* 装飾セパレータ（NPC ↔ パネル間） */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 8px" }}>
        <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, transparent, ${C.goldDim}66, transparent)` }} />
        <span style={{ color: C.goldDim, fontSize: 10 }}>◆</span>
        <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, transparent, ${C.goldDim}66, transparent)` }} />
      </div>

      {/* 中央フェーズパネル */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: 520, display: "flex", flexDirection: "column", alignItems: "stretch", gap: 10 }}>
        {/* 回避成功直後の追加弾幕（マッスル・狐符）。攻撃側が振る。 */}
        {b.pendingDodgeRandom && (
          <SpellCard color={C.gold} title="✦ 回避直後の追加弾幕" contentStyle={{ textAlign: "center", padding: 14 }}>
            {(isGm || user.uid === b.pendingDodgeRandom.attackerId) ? (
              <button onClick={handleDodgeRandomRoll} style={btnFull(C.goldBg, C.goldDim, C.gold)}>
                🎲 {b.pendingDodgeRandom.count}D を振って弾幕を配置
              </button>
            ) : (
              <div style={{ fontSize: 10, color: C.textFaint }}>相手が追加配置中…</div>
            )}
          </SpellCard>
        )}

        {(b.phase === "pc_shot_intro" || b.phase === "npc_shot_intro") && renderShotIntro(b.phase === "pc_shot_intro")}

        {(b.phase === "pc_shot_roll" || b.phase === "npc_shot_roll") && renderShotRoll(b.phase === "pc_shot_roll")}

        {(b.phase === "pc_shot_after" || b.phase === "npc_shot_after") && renderShotAfter(b.phase === "pc_shot_after")}

        {renderManualSpellControls()}

        {(b.phase === "pc_evade_intro" || b.phase === "npc_evade_intro") && renderEvadeIntro(b.phase === "pc_evade_intro")}

        {b.phase === "pc_evade_result" && renderEvadeResult()}

        {(b.phase === "pc_evade_move" || b.phase === "npc_evade_move") && renderEvadeMove(b.phase === "pc_evade_move")}

        {(b.phase === "pc_hit_check" || b.phase === "npc_hit_check") && renderHitCheck(b.phase === "pc_hit_check")}

        {(b.phase === "pc_hit_recovery" || b.phase === "npc_hit_recovery") && (
          <SpellCard color={C.gold} title="◆ 復帰位置を選択" style={{ minWidth: 260 }} contentStyle={{ textAlign: "center", padding: "12px 16px" }}>
            <div style={{ color: C.text, fontSize: 11, letterSpacing: 1 }}>好きなマスをクリックして復帰してください</div>
          </SpellCard>
        )}

        {(b.phase === "pc_dropout" || b.phase === "npc_dropout") && renderDropout(b.phase === "pc_dropout")}

        {b.phase === "cleanup" && (() => {
          const allNpcsDead = npcsDefeated;
          const allPcsDead  = alivePcs.length === 0;

          if (allNpcsDead) return (
            <SpellCard color={C.gold} title="🎉 PC陣営の勝利！" style={{ minWidth: 300 }} contentStyle={{ textAlign: "center", padding: 18 }}>
              <div style={{ color: "#fff", fontSize: 12, marginBottom: 16, letterSpacing: 1 }}>全ての敵を撃破しました</div>
              {isGm && (
                <button
                  onClick={() => upd(p => ({ ...p, battle: { ...p.battle, phase: "result", result: "pc_win" } }))}
                  style={btnFull(C.goldBg, C.goldDim, C.gold, { fontSize: 12, letterSpacing: 2, padding: "10px" })}
                >
                  結果画面へ
                </button>
              )}
              {!isGm && <div style={{ fontSize: 10, color: C.textDim }}>GMが戦闘を終了するのを待っています...</div>}
            </SpellCard>
          );

          if (allPcsDead) return (
            <SpellCard color={C.red} title="💀 NPC陣営の勝利..." style={{ minWidth: 300 }} contentStyle={{ textAlign: "center", padding: 18 }}>
              <div style={{ color: "#fff", fontSize: 12, marginBottom: 16, letterSpacing: 1 }}>全てのPCが脱落しました</div>
              {isGm && (
                <button
                  onClick={() => upd(p => ({ ...p, battle: { ...p.battle, phase: "result", result: "npc_win" } }))}
                  style={btnFull(C.redBg, C.redBorder, C.red, { fontSize: 12, letterSpacing: 2, padding: "10px" })}
                >
                  結果画面へ
                </button>
              )}
              {!isGm && <div style={{ fontSize: 10, color: C.textDim }}>GMが戦闘を終了するのを待っています...</div>}
            </SpellCard>
          );

          return (
            <SpellCard color={C.gold} title="◆ ラウンド終了処理" style={{ minWidth: 280 }} contentStyle={{ textAlign: "center", padding: 14 }}>
              <div style={{ color: C.text, fontSize: 11, marginBottom: 6, letterSpacing: 1 }}>
                脱落者が出ましたが、戦闘は続きます
              </div>
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 14, padding: "4px 10px", display: "inline-block", border: `1px solid ${C.border}`, borderRadius: 2 }}>
                残存PC {alivePcs.length} ／ 残存NPC {aliveNpcs.length}
              </div>
              {isGm && (
                <button onClick={handleCleanup} style={btnFull(C.goldBg, C.goldDim, C.gold)}>
                  次ラウンドへ ⏭️
                </button>
              )}
              {!isGm && <div style={{ fontSize: 10, color: C.textDim }}>GMが次ラウンドを開始するのを待っています...</div>}
            </SpellCard>
          );
        })()}

        {b.phase === "round_end_check" && (
          <SpellCard color={C.gold} title="◆ ラウンド終了確認" style={{ minWidth: 300 }} contentStyle={{ textAlign: "center", padding: 14 }}>
            <div style={{ color: C.text, fontSize: 11, marginBottom: 12, letterSpacing: 1 }}>敵の回避に成功しました。このラウンドを終了して次に進みます。</div>
            {/* ⚡ 低速弾（ラウンド終了時：弾幕を1マス分保護） */}
            {(() => {
              const pcId  = b.pcCombatant;
              const npcId = b.npcCombatant;
              const noSelect = !b.slowBulletSelect;
              const showPcSlow  = noSelect && (isGm || user.uid === pcId)  && hasOfficialSkill(combatantPc,  "低速弾") && !isDanmakuUsed(pcId,  "低速弾");
              const showNpcSlow = noSelect && isGm && hasOfficialSkill(combatantNpc, "低速弾") && !isDanmakuUsed(npcId, "低速弾");

              // 選択UI
              if (b.slowBulletSelect) {
                const sb = b.slowBulletSelect;
                const isOwner = isGm || user.uid === sb.ownerId;
                const targetGrid = b.grids?.[sb.targetId] || [0,0,0,0,0,0];
                if (!isOwner) return <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>🐌 相手が低速弾を選択中…</div>;
                return (
                  <div style={{ marginBottom: 10, padding: 10, background: "rgba(100,200,100,0.08)", border: `1px solid ${C.greenBorder}`, borderRadius: 5 }}>
                    <div style={{ fontSize: 10, color: C.green, marginBottom: 6 }}>🐌 低速弾 — 保護するマスを選んでください（count≥2 のマスのみ有効）</div>
                    <div style={{ display: "flex", gap: 5, justifyContent: "center", marginBottom: 5 }}>
                      {targetGrid.map((v, i) => {
                        const canProtect = (v || 0) >= 2;
                        return (
                          <button key={i} onClick={() => canProtect && confirmSlowBullet(i + 1)}
                            disabled={!canProtect}
                            style={{ width: 34, height: 34, background: canProtect ? "rgba(100,200,100,0.2)" : "rgba(255,255,255,0.02)", border: `1px solid ${canProtect ? C.greenBorder : C.border}`, borderRadius: 4, fontSize: 13, color: canProtect ? C.green : C.textFaint, cursor: canProtect ? "pointer" : "default" }}>
                            {i + 1}{v > 0 ? `(${v})` : ""}
                          </button>
                        );
                      })}
                    </div>
                    <button onClick={() => upd(p => ({ ...p, battle: { ...p.battle, slowBulletSelect: null } }))}
                      style={{ fontSize: 9, color: C.textFaint, background: "none", border: "none", cursor: "pointer" }}>キャンセル</button>
                  </div>
                );
              }

              return (showPcSlow || showNpcSlow) ? (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 4 }}>⚡ 弾幕スキル（ラウンド終了時）</div>
                  {showPcSlow && (
                    <button onClick={() => openSlowBulletSelect(pcId, npcId)}
                      style={{ ...btnFull("rgba(100,181,246,0.18)", C.blueBorder, C.blue), marginBottom: 4 }}>
                      🐌 低速弾（{combatantPc?.charName || ""}）
                    </button>
                  )}
                  {showNpcSlow && (
                    <button onClick={() => openSlowBulletSelect(npcId, pcId)}
                      style={{ ...btnFull("rgba(255,100,100,0.18)", C.redBorder, C.red), marginBottom: 4 }}>
                      🐌 低速弾（{combatantNpc?.name || ""}）
                    </button>
                  )}
                </div>
              ) : null;
            })()}

            {(b.pcPendingSpell || b.npcPendingSpell) && (() => {
              const renderPending = (storedSpell, sideLabel, sideColor) => {
                if (!storedSpell) return null;
                const ps = expandStoredSpell(storedSpell);
                return (
                  <div style={{ padding: "8px 10px", background: "rgba(239,154,154,0.1)", border: `1px solid ${sideColor}`, borderRadius: 5 }}>
                    <div style={{ fontSize: 11, color: sideColor, marginBottom: 4 }}>⏰ {ps.name}（{sideLabel}）— ラウンド終了時の効果が発動します</div>
                    <div style={{ fontSize: 9, color: C.textFaint, lineHeight: 1.5, marginBottom: 8 }}>{ps.textBody || ps.text}</div>
                    {ps.condition && (
                      <div style={{ fontSize: 9, color: C.red, marginBottom: 6 }}>⚠ {ps.condition}</div>
                    )}
                    {ps.manual && (
                      <div style={{ fontSize: 9, color: "#5a6070", marginBottom: 6 }}>★ GMが手動で効果を処理してください</div>
                    )}
                  </div>
                );
              };
              return (
                <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                  {renderPending(b.pcPendingSpell,  "PC",  C.blueBorder)}
                  {renderPending(b.npcPendingSpell, "NPC", "#c62828")}
                  {isGm && (
                    <button onClick={applyPendingSpells} style={{ ...btnFull("rgba(239,154,154,0.2)", "#c62828", "#ef9a9a") }}>
                      効果を適用して次へ
                    </button>
                  )}
                </div>
              );
            })()}
            {(isGm || user.uid === b.pcCombatant) && !b.pcPendingSpell && !b.npcPendingSpell && !b.slowBulletSelect && (
              <button onClick={handleCleanup} style={btnFull(C.goldBg, C.goldDim, C.gold)}>次ラウンドへ ⏭️</button>
            )}
          </SpellCard>
        )}
        </div>
      </div>

      {/* 装飾セパレータ（パネル ↔ PC 間） */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 8px" }}>
        <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, transparent, ${C.goldDim}66, transparent)` }} />
        <span style={{ color: C.goldDim, fontSize: 10 }}>◆</span>
        <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, transparent, ${C.goldDim}66, transparent)` }} />
      </div>

      <div style={{ display: "flex", justifyContent: "center", gap: 20, flexWrap: "wrap" }}>
        {pcs.map(p => {
          const isCombatant = b.pcCombatant === p.uid;
          const isMyTurn = p.uid === user.uid || isGm;

          const isRecovery = b.phase === "pc_hit_recovery" && isCombatant;
          const isEvadeMove = b.phase === "pc_evade_move" && isCombatant;
          
          const currentPos = b.positions?.[p.uid];

          let highlights = [];
          if (isRecovery) highlights = [1, 2, 3, 4, 5, 6];
          else if (isEvadeMove) highlights = getEvadeNeighbors(b.positions[p.uid], b.wallPassBy === p.uid);

          return (
            <BattleGrid
              key={p.uid}
              name={p.charName}
              isCombatant={isCombatant}
              grid={b.grids?.[p.uid]}
              pos={currentPos}
              highlightCells={isMyTurn ? highlights : []}
              isDead={(p.resources?.残り人数?.cur || 0) <= 0}
              lives={p.resources?.残り人数?.cur}
              maxLives={p.resources?.残り人数?.max}
              sc={p.resources?.スペルカード?.cur}
              onCellClick={(num) => {
                if (isRecovery) handleRecovery(p.uid, num);
                else if (isEvadeMove) handleEvadeMove(true, num);
              }}
              sprite={
                p.customPortrait
                  ? <img src={p.customPortrait} style={{ width: "90%", height: "90%", objectFit: "cover", borderRadius: "50%" }} />
                  : <CharSprite spriteRow={p.spriteRow} spriteCol={p.spriteCol} size={40} />
              }
            />
          );
        })}
      </div>
    </div>
    </div>
  );
}

export function BonusPhaseView({ gs, upd, user, isGm, animateDice }) {
  const bonusStatus = gs.bonusStatus || {};
  const myRemaining = bonusStatus[user?.uid] || 0;
  const myPc = gs.pcs.find(p => p.uid === user?.uid);

  const [mode, setMode] = useState("select");
  
  const finishAction = (logMsg, pcUpdate = {}) => {
    upd(p => {
      const nextPcs = p.pcs.map(x => x.uid === user.uid ? { ...x, ...pcUpdate } : x);
      return {
        ...p,
        pcs: nextPcs,
        bonusStatus: { ...p.bonusStatus, [user.uid]: Math.max(0, p.bonusStatus[user.uid] - 1) },
        log: [logMsg, ...p.log]
      };
    });
    setMode("select");
  };

  const handleSpirit = () => {
    animateDice(1, "ボーナス霊力", res => {
      const gain = res[0];
      let nextRei = myPc.resources.霊力.cur;
      if (!(myPc.badStatus || []).includes("スランプ")) {
        nextRei = Math.min(myPc.resources.霊力.max, nextRei + gain);
      }
      const nextAtk = 1 + Math.floor(nextRei / 5);
      finishAction(`✨ ${myPc.charName} はボーナスで霊力を ${gain} 点獲得した`, {
        resources: { 
          ...myPc.resources, 
          霊力: { ...myPc.resources.霊力, cur: nextRei },
          攻撃力: { ...myPc.resources.攻撃力, cur: nextAtk }
        }
      });
    });
  };

  const handleItem = () => {
    animateDice(1, "ボーナスアイテム", res => {
      const items = ["お酒", "小銭", "お守り", "Pアイテム", "残機のかけら", "スペカのかけら"];
      const itemName = items[res[0] - 1];
      finishAction(`✨ ${myPc.charName} はボーナスで【${itemName}】を獲得した`, {
        items: { ...myPc.items, [itemName]: (myPc.items[itemName] || 0) + 1 }
      });
    });
  };

  const handleBond = (targetName) => {
    // 獲得と回復を一本化: 絆を所持に加え、応援欄（bondUsed）を未使用に戻す
    const bondName = `${targetName}への絆`;
    const nextBonds = [...(myPc.bonds || [])];
    const isNew = !nextBonds.includes(bondName);
    if (isNew) nextBonds.push(bondName);
    const logMsg = `✨ ${myPc.charName} はボーナスで《${bondName}》を${isNew ? "獲得" : "回復"}した`;
    finishAction(logMsg, { bonds: nextBonds, bondUsed: { ...(myPc.bondUsed || {}), [bondName]: false } });
  };

  const startFinalBattle = () => {
    upd(p => ({
      ...p,
      sessionPhase: "battle",
      battle: p.initialBattle || p.battle,
      bonusStatus: null,
      initialBattle: null,
      minions: [], // 手下は探索フェイズ専用。決戦移行で退場
      log: ["⚔️ 全員の準備が整いました。最終決戦を開始します！", ...p.log]
    }));
  };

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#040608", padding: 20 }}>
      <div style={{ background: "#0c1020", border: `1px solid ${C.goldDim}`, padding: 30, borderRadius: 8, maxWidth: 500, width: "90%", textAlign: "center" }}>
        <div style={{ fontSize: 18, color: C.gold, marginBottom: 10, letterSpacing: 4 }}>解決ボーナス</div>
        <div style={{ fontSize: 11, color: C.textDim, marginBottom: 20 }}>リミットまで余裕があったため、追加行動が可能です。</div>

        {/* 全員の進捗 */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginBottom: 24 }}>
          {gs.pcs.map(p => (
            <div key={p.uid} style={{ padding: "4px 10px", background: "rgba(255,255,255,0.03)", border: `1px solid ${bonusStatus[p.uid] > 0 ? C.gold : C.border}`, borderRadius: 4 }}>
              <div style={{ fontSize: 10, color: bonusStatus[p.uid] > 0 ? C.gold : C.textFaint }}>{p.charName}</div>
              <div style={{ fontSize: 9, color: C.textDim }}>残り: {bonusStatus[p.uid] || 0}回</div>
            </div>
          ))}
        </div>

        {myRemaining > 0 ? (
          <div style={{ animation: "fadeUp 0.3s ease" }}>
            <div style={{ fontSize: 12, color: C.text, marginBottom: 16 }}>行動を選択してください（残り {myRemaining} 回）</div>
            
            {mode === "select" && (
              <div style={{ display: "grid", gap: 10 }}>
                <button onClick={handleSpirit} style={btnFull(C.purpleBg, C.purpleBorder, C.purple)}>① 霊力を獲得（1D6）</button>
                <button onClick={handleItem} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>② アイテム表を振る（1D6）</button>
                <button onClick={() => setMode("bond_target")} style={btnFull(C.goldBg, C.goldDim, C.gold)}>③ 絆の獲得 / 回復</button>
              </div>
            )}

            {mode === "bond_target" && (
              <div style={{ animation: "fadeUp 0.2s ease" }}>
                <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>対象となるPCを選択してください</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {gs.pcs.filter(p => p.uid !== user.uid).map(p => (
                    <button key={p.uid} onClick={() => handleBond(p.charName)} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text)}>
                      {p.charName} への絆
                    </button>
                  ))}
                  <button onClick={() => setMode("select")} style={{ ...btnFull("none", "none", C.textFaint), marginTop: 10 }}>戻る</button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ padding: "20px 0" }}>
            <div style={{ fontSize: 13, color: C.green }}>✓ あなたのボーナス処理は完了しました</div>
            <div style={{ fontSize: 10, color: C.textFaint, marginTop: 4 }}>他のプレイヤーを待っています...</div>
          </div>
        )}

        {isGm && (
          <div style={{ marginTop: 40, borderTop: `1px solid ${C.border}`, paddingTop: 20 }}>
            <button onClick={startFinalBattle} style={btnFull(C.redBg, C.redBorder, C.red)}>
              全員の処理を終了して決戦へ移行する
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 成長セレモニー（PCの成長／強化） ──────────────────────────────
// ルール: セッション終了時、各PCは「成長」(弾幕スキル再修得＋タグ獲得・両方可)と
// 「強化」(追加スペカ／能力スキル＋／特別な絆・いずれか1つ、各強化は生涯1回)を受けられる。
// 永続化は Firebase grownChars/{uid}/{instanceId}（成長キャラはインスタンス単位で分離）。親密度のライブ機構は別途。
const ENHANCE_LABELS = { spell: "追加スペルカードの取得", ability: "能力スキルの強化（＋）", bond: "特別な絆の獲得" };

function GrowthCeremony({ gs, upd, user, isGm, onClose }) {
  // 操作対象PC（GMは全員、PLは自分のPCのみ）
  const myPcs = (gs.pcs || []).filter(pc => isGm || pc.uid === user?.uid);
  // セッションに登場したキャラの弾幕スキルプール（PC＋シナリオNPC）
  const danmakuPool = (() => {
    const map = new Map();
    (gs.pcs || []).forEach(pc => { if (pc.ds?.name) map.set(pc.ds.name, pc.ds); });
    const sd = gs.scenarioData || {};
    const collect = e => { if (e?.ds?.name) map.set(e.ds.name, e.ds); };
    (sd.quests || []).forEach(q => collect(q.enemy));
    (sd.finalBattleEnemies || []).forEach(collect);
    (gs.quests || []).forEach(q => collect(q.enemy));
    return [...map.values()];
  })();

  const [records, setRecords] = useState({}); // uid -> Firebase既存成長レコード
  const [forms, setForms] = useState({});     // uid -> { newDs, newTag, enhance, bondTarget }
  const [done, setDone] = useState({});        // uid -> true（適用済み）
  const [loading, setLoading] = useState(true);

  // 既存の成長インスタンスを読み込み（成長キャラで参加した場合のみ。生涯1回の強化判定に使用）
  useEffect(() => {
    let alive = true;
    (async () => {
      const acc = {};
      for (const pc of myPcs) {
        if (!pc.grownInstanceId) continue; // 未成長キャラは既存レコードなし
        try {
          const snap = await dbGet(dbRef(db, `grownChars/${pc.uid}/${pc.grownInstanceId}`));
          if (snap.exists()) acc[pc.uid] = snap.val();
        } catch (e) { /* 読めなくても続行 */ }
      }
      if (alive) { setRecords(acc); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [myPcs]);

  const setForm = (uid, patch) => setForms(f => ({ ...f, [uid]: { ...(f[uid] || {}), ...patch } }));

  const applyGrowth = async (pc) => {
    const form = forms[pc.uid] || {};
    const existing = records[pc.uid] || {};
    const usedSet = new Set(existing.enhancementsUsed || []);
    // 弾幕再修得
    const chosenDs = form.newDs ? danmakuPool.find(d => d.name === form.newDs) : null;
    // タグ
    const newTag = (form.newTag || "").trim();
    // 強化（未使用のもののみ）
    let specialBond = existing.specialBond || null;
    let enhanceApplied = null;
    if (form.enhance && !usedSet.has(form.enhance)) {
      usedSet.add(form.enhance);
      enhanceApplied = form.enhance;
      if (form.enhance === "bond") {
        const target = gs.pcs.find(x => x.uid === form.bondTarget);
        const word = (form.bondWord || "").trim() || "敬意"; // PLが自由に決める言葉（既定: 敬意）
        specialBond = { target: target?.charName || "?", targetUid: form.bondTarget || null, intimacy: 1, word }; // 新規取得で旧絆は上書き（消失）
      }
    }
    // インスタンスID: 成長キャラで参加していれば更新、未成長なら新規（＝別の成長キャラとして分離）
    const instanceId = pc.grownInstanceId || `g_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const record = {
      charId: pc.charId || null,
      charName: pc.charName || "?",
      ds: chosenDs || existing.ds || pc.ds || null,
      tags: newTag ? [...(existing.tags || []), newTag] : (existing.tags || []), // 成長で獲得したタグのみ（基本タグは選択時に合成）
      enhancementsUsed: [...usedSet],
      specialBond: specialBond || null,
      createdAt: existing.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    // Firebase 永続化（charId が無い独自キャラはスキップ）
    if (pc.charId) {
      try { await dbSet(dbRef(db, `grownChars/${pc.uid}/${instanceId}`), record); } catch (e) { console.error(e); }
    }
    // gs にも反映（表示・エクスポート用）
    const logs = [];
    if (chosenDs) logs.push(`弾幕スキルを《${chosenDs.name}》に再修得`);
    if (newTag) logs.push(`タグ《${newTag}》を獲得`);
    if (enhanceApplied) logs.push(ENHANCE_LABELS[enhanceApplied]);
    upd(p => ({
      ...p,
      pcs: p.pcs.map(x => x.uid !== pc.uid ? x : {
        ...x,
        grownInstanceId: instanceId,
        ds: chosenDs || x.ds,
        tags: newTag ? Array.from(new Set([...(x.tags || []), newTag])) : x.tags,
        growthAbilityUnlocked: x.growthAbilityUnlocked || usedSet.has("ability"),
        growthSpellUnlocked: x.growthSpellUnlocked || usedSet.has("spell"),
        specialBond: record.specialBond || x.specialBond || null,
        // 実績: 縁結び（特別な絆獲得）/ 大器晩成（成長と強化を両方）
        ach: { ...(x.ach || {}),
          specialBondGained: (x.ach?.specialBondGained) || enhanceApplied === "bond",
          growthBoth: (x.ach?.growthBoth) || (!!(chosenDs || newTag) && !!enhanceApplied),
        },
      }),
      log: [`🌟 ${pc.charName} が成長した：${logs.join(" / ") || "（変更なし）"}`, ...p.log],
    }));
    setRecords(r => ({ ...r, [pc.uid]: record }));
    setDone(d => ({ ...d, [pc.uid]: true }));
    sfx.skillActivate();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease", padding: 16 }} onClick={onClose}>
      <div style={{ background: "linear-gradient(180deg,#0d1122,#07090f)", border: `2px solid ${C.goldDim}`, borderRadius: 10, padding: "22px 22px 18px", maxWidth: 560, width: "100%", maxHeight: "88vh", overflowY: "auto", boxShadow: `0 0 40px ${C.gold}22`, animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
        <div style={{ textAlign: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 9, letterSpacing: 4, color: C.gold, marginBottom: 3 }}>◆ 成長 ◆</div>
          <div style={{ fontSize: 15, color: C.gold, letterSpacing: 2 }}>PCの成長と強化</div>
          <div style={{ fontSize: 9, color: C.textFaint, marginTop: 4, lineHeight: 1.7 }}>成長させる出来事があったと感じたなら、弾幕スキル再修得＋タグ獲得（両方可）と、強化1つ（各強化は生涯1回）を受けられます</div>
        </div>
        {loading ? (
          <div style={{ textAlign: "center", color: C.textFaint, fontSize: 11, padding: "20px 0" }}>成長記録を読み込み中…</div>
        ) : myPcs.length === 0 ? (
          <div style={{ textAlign: "center", color: C.textFaint, fontSize: 11, padding: "20px 0" }}>成長させられるPCがいません</div>
        ) : myPcs.map(pc => {
          const form = forms[pc.uid] || {};
          const rec = records[pc.uid] || {};
          const used = new Set(rec.enhancementsUsed || []);
          const isDone = done[pc.uid];
          return (
            <div key={pc.uid} style={{ marginTop: 12, padding: 12, background: "rgba(255,255,255,0.03)", border: `1px solid ${isDone ? C.greenBorder : C.border}`, borderRadius: 6, opacity: isDone ? 0.7 : 1 }}>
              <div style={{ fontSize: 13, color: C.gold, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{pc.charName}</span>
                {isDone && <span style={{ fontSize: 10, color: C.green }}>✅ 適用済み</span>}
              </div>
              {isDone ? (
                <div style={{ fontSize: 10, color: C.textDim, lineHeight: 1.8 }}>
                  弾幕: {pc.ds?.name || "-"} ／ タグ: {(pc.tags || []).join("・")}
                  {pc.specialBond && <div>特別な絆: 《{pc.specialBond.target}への{pc.specialBond.word || "敬意"}》（親密度{pc.specialBond.intimacy}）</div>}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {/* 弾幕スキル再修得 */}
                  <div>
                    <div style={{ fontSize: 10, color: C.blue, marginBottom: 3 }}>弾幕スキルの再修得（現在: {pc.ds?.name || "なし"}）</div>
                    <select value={form.newDs || ""} onChange={e => setForm(pc.uid, { newDs: e.target.value })} style={{ ...iStyle, width: "100%", fontSize: 11, padding: "5px 6px" }}>
                      <option value="">（再修得しない）</option>
                      {danmakuPool.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
                    </select>
                    {form.newDs && <div style={{ fontSize: 9, color: C.textFaint, marginTop: 3, lineHeight: 1.6 }}>{danmakuPool.find(d => d.name === form.newDs)?.desc}</div>}
                  </div>
                  {/* タグ獲得 */}
                  <div>
                    <div style={{ fontSize: 10, color: C.blue, marginBottom: 3 }}>タグの獲得（自由記述・絆/スペカ不可）</div>
                    <input value={form.newTag || ""} onChange={e => setForm(pc.uid, { newTag: e.target.value })} placeholder="例: 勇敢、料理上手 …" style={{ ...iStyle, width: "100%", fontSize: 11, padding: "5px 6px" }} />
                    {(rec.tags || []).length > 0 && <div style={{ fontSize: 9, color: C.textFaint, marginTop: 3 }}>取得済み: {rec.tags.join("・")}</div>}
                  </div>
                  {/* 強化 */}
                  <div>
                    <div style={{ fontSize: 10, color: C.gold, marginBottom: 3 }}>強化（いずれか1つ・各強化は生涯1回）</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {[["", "（強化しない）", false], ["spell", ENHANCE_LABELS.spell, used.has("spell")], ["ability", ENHANCE_LABELS.ability, used.has("ability")], ["bond", ENHANCE_LABELS.bond, used.has("bond")]].map(([val, label, isUsed]) => (
                        <label key={val} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: isUsed ? C.textFaint : C.text, cursor: isUsed ? "not-allowed" : "pointer" }}>
                          <input type="radio" name={`enh_${pc.uid}`} disabled={isUsed} checked={(form.enhance || "") === val} onChange={() => setForm(pc.uid, { enhance: val })} />
                          {label}{isUsed && "（取得済み）"}
                          {val === "spell" && pc.growthSpellCard && <span style={{ fontSize: 9, color: C.textFaint }}>：{typeof pc.growthSpellCard === "string" ? pc.growthSpellCard : pc.growthSpellCard?.name}</span>}
                          {val === "ability" && pc.growthAbility?.name && <span style={{ fontSize: 9, color: C.textFaint }}>：{pc.growthAbility.name}</span>}
                        </label>
                      ))}
                    </div>
                    {form.enhance === "bond" && (() => {
                      const tgt = (gs.pcs || []).find(x => x.uid === form.bondTarget);
                      const word = (form.bondWord || "").trim() || "敬意";
                      return (
                        <div style={{ marginTop: 5, display: "flex", flexDirection: "column", gap: 5 }}>
                          <div style={{ fontSize: 9, color: C.textFaint }}>特別な絆の対象（既存の特別な絆は上書きされます）</div>
                          <select value={form.bondTarget || ""} onChange={e => setForm(pc.uid, { bondTarget: e.target.value })} style={{ ...iStyle, width: "100%", fontSize: 11, padding: "5px 6px" }}>
                            <option value="">（対象を選択）</option>
                            {(gs.pcs || []).filter(x => x.uid !== pc.uid).map(x => <option key={x.uid} value={x.uid}>{x.charName}</option>)}
                          </select>
                          <div style={{ fontSize: 9, color: C.textFaint }}>絆の言葉（自由記述・既定: 敬意）</div>
                          <input value={form.bondWord || ""} onChange={e => setForm(pc.uid, { bondWord: e.target.value })} placeholder="例: 敬意、憧れ、対抗心 …" style={{ ...iStyle, width: "100%", fontSize: 11, padding: "5px 6px" }} />
                          <div style={{ fontSize: 10, color: C.gold, textAlign: "center" }}>《{tgt?.charName || "○○"}への{word}》</div>
                        </div>
                      );
                    })()}
                  </div>
                  <button
                    disabled={form.enhance === "bond" && !form.bondTarget}
                    onClick={() => applyGrowth(pc)}
                    style={{ ...btnFull(C.goldBg, C.goldDim, C.gold, { fontSize: 12 }), opacity: (form.enhance === "bond" && !form.bondTarget) ? 0.4 : 1 }}>
                    🌟 成長を適用する
                  </button>
                </div>
              )}
            </div>
          );
        })}
        <button onClick={onClose} style={{ width: "100%", marginTop: 14, padding: "9px", cursor: "pointer", borderRadius: 4, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, color: C.textDim, fontSize: 12, fontFamily: "'Noto Serif JP', serif" }}>閉じる</button>
      </div>
    </div>
  );
}

// ─── SessionEndView ───────────────────────────────────────────────
export function SessionEndView({ gs, upd, isGm, user, roomCode }) {
  const isVictory = gs.battle?.result === "pc_win";
  const pcs = gs.pcs || [];
  const [showGrowth, setShowGrowth] = useState(false);
  const [ending, setEnding] = useState(false);
  const [achResult, setAchResult] = useState(null); // 実績記録の結果 { newly:[id], unlocked:[id] }
  const [achProcessing, setAchProcessing] = useState(false);

  // 実績を確定・記録する（自分のPC分。成長を済ませてから押す想定）
  const myPc = pcs.find(p => p.uid === user?.uid);
  const processAchievements = async () => {
    if (!myPc || achProcessing) return;
    setAchProcessing(true);
    try {
      const uid = user.uid;
      const [statsSnap, achSnap, procSnap, grownSnap] = await Promise.all([
        dbGet(dbRef(db, `users/${uid}/stats`)),
        dbGet(dbRef(db, `users/${uid}/achievements`)),
        dbGet(dbRef(db, `users/${uid}/achProcessed/${roomCode}`)),
        dbGet(dbRef(db, `grownChars/${uid}`)),
      ]);
      const unlocked = achSnap.exists() ? achSnap.val() : {};
      
      // 成長キャラデータの型チェックを追加
      let grown = grownSnap.exists() ? grownSnap.val() : {};
      if (typeof grown !== "object" || grown === null) grown = {};
      const validGrown = Object.values(grown).filter(g => g && typeof g === "object");
      
      // 成長キャラから派生する通算値（強化達成数の最大・親密度10）
      const maxEnh = Math.max(0, ...validGrown.map(g => (g.enhancementsUsed || []).length));
      const intimacy10 = validGrown.some(g => (g.specialBond?.intimacy || 0) >= 10);
      // 通算集計（このルームは1回だけ）
      let life = statsSnap.exists() ? statsSnap.val() : {};
      const already = procSnap.exists();
      if (!already) life = aggregateLifetime(life, myPc, gs);
      life.maxEnh = Math.max(life.maxEnh || 0, maxEnh);
      if (intimacy10) life.intimacy10 = true;
      // 判定
      const ctx = buildAchContext(myPc, gs, life);
      const satisfied = ACHIEVEMENTS.filter(a => { try { return a.check(ctx); } catch { return false; } }).map(a => a.id);
      const newly = satisfied.filter(id => !unlocked[id]);
      // 永続化
      const nextUnlocked = { ...unlocked };
      newly.forEach(id => { nextUnlocked[id] = { at: Date.now() }; });
      await dbSet(dbRef(db, `users/${uid}/stats`), life);
      await dbSet(dbRef(db, `users/${uid}/achievements`), nextUnlocked);
      if (!already) await dbSet(dbRef(db, `users/${uid}/achProcessed/${roomCode}`), Date.now());
      if (newly.length) { sfx.victory?.(); }
      setAchResult({ newly, unlocked: satisfied });
    } catch (e) {
      console.error("実績の記録に失敗", e);
      alert("実績の記録に失敗しました。通信状況を確認してください。");
    } finally {
      setAchProcessing(false);
    }
  };

  const ac  = isVictory ? C.gold    : C.red;
  const ab  = isVictory ? C.goldDim : C.redBorder;
  const abg = isVictory ? C.goldBg  : C.redBg;

  useEffect(() => {
    const t = setTimeout(() => { isVictory ? sfx.victory() : sfx.defeat(); }, 300);
    return () => clearTimeout(t);
  }, [isVictory]);

  const PARTICLES = isVictory
    ? [{ x: 8, d: 0, s: 6.2 }, { x: 22, d: 1.3, s: 8 }, { x: 38, d: 0.6, s: 7.1 },
        { x: 52, d: 2.1, s: 5.8 }, { x: 67, d: 0.9, s: 9 }, { x: 80, d: 1.7, s: 6.6 },
        { x: 91, d: 3.2, s: 7.4 }, { x: 14, d: 2.7, s: 8.3 }, { x: 45, d: 0.3, s: 5.5 },
        { x: 74, d: 1.1, s: 7.8 }]
    : [];

  // セッションログを txt でダウンロード（ふりかえり用）
  const exportLog = () => {
    const now = new Date();
    const pad = n => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const L = [];
    L.push("幻想ナラトグラフ セッション記録");
    L.push(`出力日時: ${now.toLocaleString()}`);
    L.push(`結果: ${isVictory ? "最終決戦制覇（CLEAR）" : "最終決戦敗北（GAME OVER）"}`);
    L.push("");
    L.push("■ 参加キャラクター");
    pcs.forEach(pc => {
      L.push(`  ${pc.charName}  残り人数:${pc.resources?.残り人数?.cur ?? 0} / スペカ:${pc.resources?.スペルカード?.cur ?? 0} / グレイズ:${pc.resources?.グレイズ?.cur ?? 0}`);
    });
    L.push("");
    L.push("■ セッションログ（時系列・古い順）");
    [...(gs.log || [])].reverse().forEach(l => L.push(`  ${l}`));
    const hist = gs.diceHistory || [];
    if (hist.length > 0) {
      L.push("");
      L.push("■ ダイス履歴（新しい順）");
      hist.forEach(h => {
        const tStr = h.t ? new Date(h.t).toLocaleTimeString() : "";
        L.push(`  [${tStr}] ${h.label}: ${(h.results || []).join(" ")}（最大${h.max}）`);
      });
    }
    const blob = new Blob([L.join("\r\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `naratograph-${stamp}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#040608", position: "relative", overflow: "hidden" }}>
      <style>{`
        @keyframes endTitleIn {
          0%   { opacity: 0; transform: scale(0.68) translateY(12px); }
          65%  { opacity: 1; transform: scale(1.06) translateY(-3px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes endGlowV {
          0%,100% { text-shadow: 0 0 18px ${C.gold}88, 0 0 36px ${C.gold}44; }
          50%     { text-shadow: 0 0 28px ${C.gold}cc, 0 0 56px ${C.gold}66, 0 0 80px ${C.gold}22; }
        }
        @keyframes endGlowD {
          0%,100% { text-shadow: 0 0 18px ${C.red}88, 0 0 36px ${C.red}44; }
          50%     { text-shadow: 0 0 28px ${C.red}cc, 0 0 56px ${C.red}66, 0 0 80px ${C.red}22; }
        }
        @keyframes endFadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes endCardIn {
          from { opacity: 0; transform: translateY(22px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes endBgPulse {
          0%,100% { opacity: 1; }
          50%     { opacity: 0.6; }
        }
        @keyframes endParticle {
          0%   { transform: translateY(-30px) rotate(0deg);   opacity: 0; }
          8%   { opacity: 0.85; }
          90%  { opacity: 0.4; }
          100% { transform: translateY(110vh) rotate(540deg); opacity: 0; }
        }
      `}</style>

      {/* 背景グロー */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: `radial-gradient(ellipse 65% 45% at 50% 28%, ${ac}18 0%, transparent 70%)`,
        animation: "endBgPulse 3s ease-in-out infinite",
      }} />

      {/* 勝利パーティクル */}
      {PARTICLES.map((p, i) => (
        <div key={i} style={{
          position: "absolute", top: -30, left: `${p.x}%`,
          color: C.gold, fontSize: 13, pointerEvents: "none",
          animation: `endParticle ${p.s}s ${p.d}s ease-in infinite`,
        }}>◆</div>
      ))}

      {/* メインカード */}
      <div style={{ position: "relative", zIndex: 1, maxWidth: 540, width: "90%", textAlign: "center" }}>
        <div style={{
          position: "relative",
          background: "linear-gradient(180deg, #0d1122 0%, #07090f 100%)",
          border: `2px solid ${ab}`,
          boxShadow: `0 0 36px ${ac}28, inset 0 0 24px ${ac}08`,
          borderRadius: 10,
          padding: "38px 32px 30px",
        }}>
          {/* コーナー装飾 */}
          {[{ t: 7, l: 10 }, { t: 7, r: 10 }, { b: 7, l: 10 }, { b: 7, r: 10 }].map((pos, i) => (
            <div key={i} style={{ position: "absolute", ...pos, color: ac, fontSize: 11, opacity: 0.75 }}>◆</div>
          ))}

          {/* タイトル */}
          <div style={{
            fontSize: 40, fontWeight: "bold", letterSpacing: 10,
            color: ac,
            animation: `endTitleIn 0.75s cubic-bezier(0.22,0.61,0.36,1) forwards, ${isVictory ? "endGlowV" : "endGlowD"} 2.8s 0.8s ease-in-out infinite`,
            marginBottom: 6,
          }}>
            {isVictory ? "CLEAR" : "GAME OVER"}
          </div>

          {/* サブタイトル */}
          <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 4, marginBottom: 4, animation: "endFadeUp 0.5s 0.55s both" }}>
            {isVictory ? "◆ 最終決戦制覇 ◆" : "◆ 最終決戦敗北 ◆"}
          </div>

          {/* 区切り線 */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0 18px", animation: "endFadeUp 0.5s 0.65s both" }}>
            <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, transparent, ${ab}99, transparent)` }} />
            <span style={{ color: ac, fontSize: 10 }}>◆</span>
            <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, transparent, ${ab}99, transparent)` }} />
          </div>

          {/* フレーバーテキスト */}
          <div style={{ fontSize: 12, color: C.textDim, marginBottom: 22, lineHeight: 1.85, animation: "endFadeUp 0.5s 0.72s both" }}>
            {isVictory ? "最終決戦を制覇しました。セッション終了です。" : "最終決戦に敗れました。セッション終了です。"}
          </div>

          {/* PCサマリーカード */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", marginBottom: 26 }}>
            {pcs.map((pc, i) => {
              const lives  = pc.resources?.残り人数?.cur   ?? 0;
              const spells = pc.resources?.スペルカード?.cur ?? 0;
              const graze  = pc.resources?.グレイズ?.cur    ?? 0;
              const isDead = lives <= 0;
              return (
                <div key={pc.uid} style={{
                  background: isDead ? "rgba(160,30,30,0.1)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${isDead ? C.redBorder : ab}55`,
                  borderRadius: 6, padding: "10px 14px", minWidth: 108,
                  animation: `endCardIn 0.5s ${0.9 + i * 0.13}s both`,
                  position: "relative",
                }}>
                  {isDead && <div style={{ position: "absolute", top: 4, right: 7, fontSize: 11, color: C.red, opacity: 0.6 }}>✝</div>}
                  <div style={{ fontSize: 12, color: isDead ? C.red : C.text, fontWeight: "bold", marginBottom: 7 }}>{pc.charName}</div>
                  <div style={{ fontSize: 10, color: C.textDim, lineHeight: 2 }}>
                    <div>残り人数{"　"}<span style={{ color: lives > 0 ? C.green : C.red, fontWeight: "bold" }}>{lives}</span></div>
                    <div>スペカ{"　　"}<span style={{ color: C.blue }}>{spells}</span></div>
                    <div>グレイズ{"　"}<span style={{ color: C.gold }}>{graze}</span></div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 成長セレモニー */}
          <div style={{ marginBottom: 10, animation: `endFadeUp 0.5s ${0.92 + pcs.length * 0.13}s both` }}>
            <button
              onClick={() => setShowGrowth(true)}
              style={{
                padding: "9px 24px", background: C.goldBg,
                border: `1px solid ${C.goldDim}`, borderRadius: 6,
                color: C.gold, fontSize: 12, cursor: "pointer", letterSpacing: 2,
                boxShadow: `0 0 12px ${C.gold}18`,
              }}
            >
              🌟 PCの成長・強化
            </button>
          </div>

          {/* 実績の記録（PLのみ・成長を済ませてから） */}
          {myPc && (
            <div style={{ marginBottom: 10 }}>
              <button onClick={processAchievements} disabled={achProcessing} style={{ padding: "9px 24px", background: "rgba(121,134,203,0.16)", border: "1px solid #7986cb", borderRadius: 6, color: "#9fa8da", fontSize: 12, cursor: achProcessing ? "default" : "pointer", letterSpacing: 2 }}>
                {achProcessing ? "記録中…" : "🏆 実績を記録する"}
              </button>
              <div style={{ fontSize: 8, color: C.textFaint, marginTop: 4 }}>成長を済ませてから押してください</div>
            </div>
          )}

          {/* ログ書き出し（全員） */}
          <div style={{ marginBottom: 14, animation: `endFadeUp 0.5s ${0.95 + pcs.length * 0.13}s both` }}>
            <button
              onClick={exportLog}
              style={{
                padding: "7px 20px", background: "rgba(255,255,255,0.04)",
                border: `1px solid ${C.border}`, borderRadius: 6,
                color: C.textDim, fontSize: 11, cursor: "pointer", letterSpacing: 1,
              }}
            >
              📥 セッションログを保存（.txt）
            </button>
          </div>

          {/* 終了ボタン / 待機テキスト */}
          {isGm ? (
            <button
              disabled={ending}
              onClick={() => {
                if (ending) return;
                if (window.confirm("セッションを終了しますか？\nセッションログ(.txt)を保存し、ルームデータを削除します。この操作は元に戻せません。")) {
                  setEnding(true);
                  exportLog(); // ログだけ出力
                  if (roomCode) dbRemove(dbRef(db, `rooms/${roomCode}`)).catch(console.error); // ルームデータ削除
                }
              }}
              style={{
                padding: "11px 30px", background: abg,
                border: `1px solid ${ab}`, borderRadius: 6,
                color: ac, fontSize: 13, cursor: ending ? "default" : "pointer", letterSpacing: 2,
                boxShadow: `0 0 14px ${ac}22`, opacity: ending ? 0.6 : 1,
                animation: `endFadeUp 0.5s ${1.0 + pcs.length * 0.13}s both`,
              }}
            >
              {ending ? "終了処理中…" : "ログを保存してセッション終了"}
            </button>
          ) : (
            <div style={{ fontSize: 10, color: C.textDim, animation: `endFadeUp 0.5s ${1.0 + pcs.length * 0.13}s both` }}>
              GMがセッションを終了するのを待っています...
            </div>
          )}
        </div>
      </div>

      {showGrowth && <GrowthCeremony gs={gs} upd={upd} user={user} isGm={isGm} onClose={() => setShowGrowth(false)} />}

      {/* 実績の記録結果 */}
      {achResult && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", zIndex: 210, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease", padding: 16 }} onClick={() => setAchResult(null)}>
          <div style={{ background: "linear-gradient(180deg,#0d1122,#07090f)", border: `2px solid ${C.goldDim}`, borderRadius: 10, padding: "22px", maxWidth: 420, width: "100%", maxHeight: "82vh", overflowY: "auto", boxShadow: `0 0 40px ${C.gold}33`, animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
            <div style={{ textAlign: "center", fontSize: 15, color: C.gold, letterSpacing: 2, marginBottom: 4 }}>🏆 実績</div>
            {achResult.newly.length > 0 ? (
              <>
                <div style={{ textAlign: "center", fontSize: 10, color: C.green, marginBottom: 10 }}>新たに {achResult.newly.length} 件 解除！</div>
                {achResult.newly.map(id => { const a = getAchievement(id); if (!a) return null; return (
                  <div key={id} style={{ marginBottom: 8, padding: 10, background: a.bad ? "rgba(224,112,96,0.08)" : "rgba(255,213,79,0.08)", border: `1px solid ${a.bad ? C.redBorder : C.goldDim}`, borderRadius: 6, animation: "endFadeUp 0.4s both" }}>
                    <div style={{ fontSize: 12, color: a.bad ? C.red : C.gold }}>{a.bad ? "💀" : "🏅"} {a.name}</div>
                    <div style={{ fontSize: 9, color: C.textDim, marginTop: 2 }}>{a.desc}</div>
                  </div>
                ); })}
              </>
            ) : (
              <div style={{ textAlign: "center", fontSize: 10, color: C.textDim, padding: "12px 0" }}>新たに解除された実績はありませんでした。</div>
            )}
            <div style={{ textAlign: "center", fontSize: 9, color: C.textFaint, marginTop: 6 }}>解除済み合計 {achResult.unlocked.length} / {ACHIEVEMENTS.length} 件（プロフィールで確認できます）</div>
            <button onClick={() => setAchResult(null)} style={{ width: "100%", marginTop: 12, padding: "9px", cursor: "pointer", borderRadius: 4, background: C.goldBg, border: `1px solid ${C.goldDim}`, color: C.gold, fontSize: 12, fontFamily: "'Noto Serif JP', serif" }}>閉じる</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ConfirmModal ─────────────────────────────────────────────────
export function ConfirmModal({ title, body, onOk, onCancel, okLabel = "実行する", okColor = C.red }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={onCancel}>
      <SpellCard color={okColor} title={`◆ ${title}`} style={{ maxWidth: 360, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
        {body && <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.8, marginBottom: 16, whiteSpace: "pre-wrap" }}>{body}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onOk}     style={{ flex: 1, padding: "8px", cursor: "pointer", borderRadius: 2, background: `${okColor}20`, border: `1px solid ${okColor}80`, color: okColor, fontSize: 12 }}>{okLabel}</button>
          <button onClick={onCancel} style={{ flex: 1, padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
        </div>
      </SpellCard>
    </div>
  );
}

// ─── ItemUseModal ─────────────────────────────────────────────────
function ItemUseModal({ itemName, pc, onConfirm, onCancel }) {
  const data = ITEM_DATA[itemName];
  if (!data) return null;
  const canUse = data.canUse(pc);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={onCancel}>
      <SpellCard color={C.gold} title={`✦ 【${itemName}】を使用する`} style={{ maxWidth: 340, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 4, letterSpacing: 2 }}>タイミング: {data.timing}</div>
        <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.8, marginBottom: 14 }}>{data.desc}</div>
        {!canUse && <div style={{ fontSize: 10, color: C.red, marginBottom: 8 }}>使用条件を満たしていません</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => canUse && onConfirm()} disabled={!canUse} style={{ flex: 1, padding: "8px", cursor: canUse ? "pointer" : "not-allowed", borderRadius: 2, background: canUse ? C.goldBg : "rgba(255,255,255,0.02)", border: canUse ? `1px solid ${C.goldDim}` : `1px solid ${C.border}`, color: canUse ? C.gold : C.textFaint, fontSize: 12 }}>使用する</button>
          <button onClick={onCancel} style={{ flex: 1, padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
        </div>
      </SpellCard>
    </div>
  );
}

// ─── SkillActivateModal ───────────────────────────────────────────
function SkillActivateModal({ skillName, skillType, desc, onConfirm, onCancel }) {
  const typeColor = SKILL_TYPE_COLOR[skillType] || C.text;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={onCancel}>
      <SpellCard color={typeColor} title={`✦ 《${skillName}》を発動する`} headerRight={<span style={{ padding: "2px 8px", background: `${typeColor}18`, border: `1px solid ${typeColor}50`, borderRadius: 10, fontSize: 9, color: typeColor }}>{skillType}</span>} style={{ maxWidth: 360, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.8, marginBottom: 14 }}>{desc}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onConfirm} style={{ flex: 1, padding: "8px", cursor: "pointer", borderRadius: 2, background: C.goldBg, border: `1px solid ${C.goldDim}`, color: C.gold, fontSize: 12 }}>発動する</button>
          <button onClick={onCancel}  style={{ flex: 1, padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
        </div>
      </SpellCard>
    </div>
  );
}

// CharDetailModal 内のセクション見出し（render 内で定義しないようモジュールレベルに）
function Section({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  );
}

// ─── CharDetailModal（キャラクター詳細・読み取り専用） ────────────────
function CharDetailModal({ pc, onClose }) {
  const skill   = pc.ps || null;
  const isGrownAbility = !!(pc.growthAbilityUnlocked && pc.growthAbility?.name);
  const ability = isGrownAbility ? pc.growthAbility : (pc.as || null);
  const danmaku = pc.ds || null;
  const spellTexts = [
    ...(pc.spellCards || []),
    ...(pc.growthSpellUnlocked && pc.growthSpellCard ? [pc.growthSpellCard] : []),
  ].filter(Boolean);
  const spells  = spellTexts.map(t => buildSpellCard(t)).filter(Boolean);
  const bonds   = pc.bonds || [];
  const badStatus = pc.badStatus || [];
  const resKeys = ["やる気", "残り人数", "スペルカード", "グレイズ", "霊力", "攻撃力"];
  const resources = pc.resources || {};

  const renderSkill = (s, accentColor) => (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
        {s.type && <span style={{ padding: "1px 6px", background: `${SKILL_TYPE_COLOR[s.type] || accentColor}18`, border: `1px solid ${SKILL_TYPE_COLOR[s.type] || accentColor}50`, borderRadius: 8, fontSize: 8, color: SKILL_TYPE_COLOR[s.type] || accentColor }}>{s.type}</span>}
        <span style={{ fontSize: 11, color: accentColor }}>《{s.name}》</span>
      </div>
      <div style={{ fontSize: 9, color: C.textDim, lineHeight: 1.7 }}>{s.desc}</div>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 120, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={onClose}>
      <SpellCard
        color={C.gold}
        title={`✦ ${pc.charName}`}
        headerRight={(pc.tags || []).length > 0 ? <span style={{ fontSize: 9, color: C.gold }}>《{pc.tags.join("》《")}》</span> : null}
        style={{ maxWidth: 460, width: "92%", maxHeight: "86vh", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }}
        contentStyle={{ padding: 0 }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: "12px 16px", maxHeight: "calc(86vh - 70px)", overflowY: "auto" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
            {pc.customPortrait
              ? <img src={pc.customPortrait} style={{ width: 56, height: 56, borderRadius: 6, objectFit: "cover", border: `1px solid ${C.goldDim}` }} />
              : <CharSprite spriteRow={pc.spriteRow ?? -1} spriteCol={pc.spriteCol ?? -1} size={56} />}
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {resKeys.map(k => {
                const r = resources[k] || { cur: 0, max: 1 };
                return (
                  <div key={k} style={{ padding: "3px 7px", background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, borderRadius: 3, textAlign: "center", minWidth: 44 }}>
                    <div style={{ fontSize: 7, color: C.textFaint }}>{k}</div>
                    <div style={{ fontSize: 12, color: C.gold }}>{r.cur}{r.max > 1 && <span style={{ fontSize: 7, color: C.textFaint }}>/{r.max}</span>}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {skill && <Section label="個性スキル">{renderSkill(skill, skill.type !== "オート" ? C.gold : "#81c784")}</Section>}
          {ability && <Section label={isGrownAbility ? "能力スキル＋（成長）" : "能力スキル"}>{renderSkill(ability, "#90caf9")}</Section>}
          {danmaku && <Section label="弾幕スキル">{renderSkill({ ...danmaku, type: danmaku.type || null }, C.red)}</Section>}

          {spells.length > 0 && (
            <Section label="スペルカード">
              {spells.map((sp, i) => (
                <div key={i} style={{ marginBottom: 8, padding: "7px 10px", background: "rgba(200,160,64,0.06)", border: `1px solid ${C.goldDim}55`, borderRadius: 4 }}>
                  <div style={{ fontSize: 11, color: C.gold, marginBottom: 3 }}>{sp.name}</div>
                  <div style={{ fontSize: 9, color: C.textDim, lineHeight: 1.6 }}>{sp.textBody || sp.text}</div>
                  {sp.condition && <div style={{ fontSize: 9, color: C.red, marginTop: 3 }}>⚠ {sp.condition}</div>}
                </div>
              ))}
            </Section>
          )}

          {pc.specialBond && (
            <Section label="特別な絆">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ padding: "3px 10px", background: "rgba(255,213,79,0.14)", border: `1px solid ${C.goldDim}`, borderRadius: 10, fontSize: 11, color: C.gold }}>《{pc.specialBond.target}への{pc.specialBond.word || "敬意"}》</span>
                <span style={{ fontSize: 10, color: C.textDim }}>親密度 <span style={{ color: C.gold, fontWeight: "bold" }}>{pc.specialBond.intimacy ?? 1}</span> / 10</span>
              </div>
            </Section>
          )}

          {bonds.length > 0 && (
            <Section label="絆">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {bonds.map(b => {
                  const isFrom = b.endsWith("からの絆");
                  return (
                    <span key={b} style={{ padding: "2px 8px", background: isFrom ? "rgba(156,39,176,0.1)" : "rgba(200,160,64,0.1)", border: `1px solid ${isFrom ? C.purpleBorder : C.goldDim}50`, borderRadius: 10, fontSize: 10, color: isFrom ? C.purple : C.gold }}>《{b}》</span>
                  );
                })}
              </div>
            </Section>
          )}

          {badStatus.length > 0 && (
            <Section label="変調">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {badStatus.map(bs => {
                  const bData = Object.values(BAD_STATUS_TABLE).find(x => x.name === bs);
                  return (
                    <div key={bs} style={{ padding: "4px 8px", background: "rgba(224,112,96,0.15)", border: `1px solid ${C.redBorder}`, borderRadius: 4 }}>
                      <div style={{ fontSize: 10, color: C.red, fontWeight: "bold" }}>《{bs}》</div>
                      <div style={{ fontSize: 8, color: C.textDim, lineHeight: 1.4 }}>{bData?.desc}</div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}
        </div>
      </SpellCard>
    </div>
  );
}

// ─── PCCard ───────────────────────────────────────────────────────
export function PCCard({ pc, gs, isGm, onUpdatePc, upd, animateDice, getSpot, SPOTS, isOnline = false }) {
  const [itemModal, setItemModal]   = useState(null);
  const [skillModal, setSkillModal] = useState(null);
  const [abilityModal, setAbilityModal] = useState(null);
  const [abilityItemPick, setAbilityItemPick] = useState(null);
  const [abilityCure, setAbilityCure] = useState(null); // 変調除去ピッカー { name, freq, params, targetUid }
  const [abilityRefresh, setAbilityRefresh] = useState(null); // 応援欄リフレッシュ { name, freq, targetUid }
  const [abilityMove, setAbilityMove] = useState(null); // パーティ移動 { name, freq, params, selected[], moveSelf }
  const [abilitySurprise, setAbilitySurprise] = useState(null); // 絆獲得判定 { name, freq, params, targetUid, x }
  const [abilitySpend, setAbilitySpend] = useState(null); // アイテム消費獲得 { name, freq, params, spendItem, mode }
  const [abilityDestroy, setAbilityDestroy] = useState(null); // 破壊 { name, freq, targetUid, category }
  const [abilityReturn, setAbilityReturn] = useState(null); // 密と疎：帰還先変更 { name, freq, params, selected[], destSpot }
  const [abilityScenePick, setAbilityScenePick] = useState(null); // 吉弔：追加シーン対象選択 { name, freq }
  const [abilityBoost, setAbilityBoost] = useState(null); // 核融合：同スポット他PCのやる気+ { name, freq, amount }
  const [minionMove, setMinionMove] = useState(null); // 手下移動：移動する手下のid（null=非選択）
  const [abilitySearchClue, setAbilitySearchClue] = useState(null); // 探し物：手がかり配置スポット選択 { name, freq }
  const [abilityReadMind, setAbilityReadMind] = useState(null); // 心を読む：絆取得対象選択 { name, freq }
  const [abilityReiBoost, setAbilityReiBoost] = useState(null); // あらゆるものの背中：霊力増加対象選択 { name, freq, amount, selected[] }
  const [abilityBoundary, setAbilityBoundary] = useState(null); // 境界：移動先選択 { name, freq, consume, mustBase }
  const [abilityFortune, setAbilityFortune] = useState(null); // 財産を消費させる：対象/アイテム選択 { name, freq, targetUid }
  const [expanded, setExpanded]     = useState(false);
  const [gmEdit, setGmEdit]         = useState(false);
  const [detailModal, setDetailModal] = useState(false);
  const [resFlash, setResFlash]     = useState({});
  const prevResRef                  = useRef(null);
  const prevOnceFlagRef             = useRef(null);

  const resources     = pc.resources || INIT_RESOURCES();
  const items         = pc.items     || INIT_ITEMS();
  const badStatus     = pc.badStatus || [];
  const skill         = pc.ps || null;
  const isAbilityGrown = !!pc.growthAbilityUnlocked;
  // 能力スキルの強化後は能力スキル＋（growthAbility）が基本能力（as）を置き換える
  const activeAbility  = (isAbilityGrown && pc.growthAbility?.name) ? pc.growthAbility : pc.as;
  const isCustomChar  = pc.charId?.startsWith("custom_");
  const hasActed      = (gs.actedPcs ||[]).includes(pc.uid);
  const isActing      = gs.currentScene?.pcUid === pc.uid;
  // 強調表示用：個性スキルが今すぐ発動可能か＋その色（型色）
  const psColor = SKILL_TYPE_COLOR[skill?.type] || C.gold;
  const abColor = SKILL_TYPE_COLOR[activeAbility?.type] || "#90caf9";
  const _currentSpotName  = getSpot(pc.currentSpot)?.name || "-";

  const consumeItem = itemName => {
    const data = ITEM_DATA[itemName];
    if (!data) return;
    sfx.itemUse();
    onUpdatePc(data.use(pc, gs));
    setItemModal(null);
  };

  const activateSkill = () => {
    setSkillModal(null);
    const skillName = skill?.name;

    if (skillName === "真面目") {
      // D6点 霊力獲得
      animateDice(1, "真面目（霊力回復）", res => {
        const gain = res[0];
        const r = pc.resources.霊力 || { cur: 0, max: 20 };
        if ((pc.badStatus || []).includes("スランプ")) {
          onUpdatePc({ ...pc, skillActivatedThisSession: (pc.skillActivatedThisSession || 0) + 1 });
          return;
        }
        const nextCur = Math.min(r.max, r.cur + gain);
        onUpdatePc({ ...pc,
          skillActivatedThisSession: (pc.skillActivatedThisSession || 0) + 1,
          resources: { ...pc.resources,
            霊力: { ...r, cur: nextCur },
            攻撃力: { ...pc.resources.攻撃力, cur: 1 + Math.floor(nextCur / 5) }
          }
        });
      });
      return;
    }

    if (skillName === "怠け者") {
      // 自身への絆を獲得
      const selfBond = `${pc.charName}自身への絆`;
      const bonds = [...(pc.bonds || [])];
      if (!bonds.includes(selfBond)) bonds.push(selfBond);
      onUpdatePc({ ...pc, skillActivatedThisSession: (pc.skillActivatedThisSession || 0) + 1, bonds, bondUsed: { ...(pc.bondUsed || {}), [selfBond]: false } });
      return;
    }

    if (skillName === "信仰") {
      // 好きなタグを1つ獲得
      const tag = window.prompt("獲得するタグ名を入力してください");
      if (!tag || !tag.trim()) return;
      const tags = [...(pc.tags || [])];
      if (!tags.includes(tag.trim())) tags.push(tag.trim());
      onUpdatePc({ ...pc, skillActivatedThisSession: (pc.skillActivatedThisSession || 0) + 1, tags });
      return;
    }

    if (skillName === "胡乱" && upd) {
      // 全手がかり除去→ランダム再配置
      upd(p => {
        const count = (p.clues || []).length;
        if (count === 0) return { ...p, pcs: p.pcs.map(x => x.uid !== pc.uid ? x : { ...x, skillActivatedThisSession: (x.skillActivatedThisSession || 0) + 1 }), log: [`${pc.charName}《胡乱》: 手がかりがありませんでした`, ...p.log] };
        const spotIds = (SPOTS || []).map(s => s.id);
        const newClues = [];
        for (let i = 0; i < count; i++) {
          newClues.push(spotIds[Math.floor(Math.random() * spotIds.length)]);
        }
        return { ...p,
          clues: newClues,
          nonSearchCluePlaced: true, // 実績(鼠算式探索): 探し物以外の手がかり配置
          pcs: p.pcs.map(x => x.uid !== pc.uid ? x : { ...x, skillActivatedThisSession: (x.skillActivatedThisSession || 0) + 1 }),
          log: [`${pc.charName}《胡乱》: 手がかり${count}つをランダムに再配置した`, ...p.log]
        };
      });
      return;
    }

    if (skillName === "カリスマ") {
      // 1セッション1回 手下登場（GM手動）
      if (pc[PS_ONCE_FLAG]) return;
      onUpdatePc({ ...pc, skillActivatedThisSession: (pc.skillActivatedThisSession || 0) + 1, [PS_ONCE_FLAG]: true });
      return;
    }

    // その他：カウント+ログのみ
    onUpdatePc({ ...pc, skillActivatedThisSession: (pc.skillActivatedThisSession || 0) + 1 });
  };

  // ─── 能力スキル（as / growthAbility）の発動 ───────────────────────────
  // 使用回数フラグ。pc.abilityUse = { [能力名]: { day, session, sceneId } }
  const abilitySceneId = () => gs.currentScene?.pcUid ?? null;
  const abilityUsedUp = (ability) => {
    const meta = getAbilityEffect(ability);
    const freq = meta?.freq;
    if (!freq) return false;
    const u = pc.abilityUse?.[ability.name];
    if (!u) return false;
    if (freq === "day")     return u.day === gs.day;
    if (freq === "session") return !!u.session;
    if (freq === "scene")   return u.sceneId === abilitySceneId();
    return false;
  };
  // base(pc派生) に使用回数フラグを記録して返す
  const withAbilityUse = (base, name, freq) => {
    if (!freq) return base;
    const use = { ...(pc.abilityUse || {}) };
    const cur = { ...(use[name] || {}) };
    if (freq === "day")     cur.day = gs.day;
    if (freq === "session") cur.session = true;
    if (freq === "scene")   cur.sceneId = abilitySceneId();
    use[name] = cur;
    return { ...base, abilityUse: use };
  };

  const activateAbility = (ability) => {
    setAbilityModal(null);
    if (!ability?.name) return;
    const meta = getAbilityEffect(ability);
    const name = ability.name;
    const freq = meta?.freq || null;
    // pc派生 base にログを添えて単一 upd で書き込む（二重書き込み回避）
    const commit = (base, logMsg) => upd(p => ({
      ...p,
      pcs: p.pcs.map(x => x.uid === pc.uid ? base : x),
      log: [logMsg, ...p.log],
    }));

    if (meta?.auto && meta.kind === "gain_yaruki") {
      const amt = meta.params?.amount || 1;
      const r = pc.resources.やる気 || { cur: 0, max: 99 };
      sfx.skillActivate();
      commit(withAbilityUse({ ...pc, resources: { ...pc.resources, やる気: { ...r, cur: Math.min(r.max, r.cur + amt) } } }, name, freq),
        `🔵 ${pc.charName} が能力《${name}》を発動：やる気+${amt}`);
      return;
    }
    if (meta?.auto && meta.kind === "gain_rei") {
      const amt = meta.params?.amount || 1;
      const r = pc.resources.霊力 || { cur: 0, max: 20 };
      const nextCur = Math.min(r.max, r.cur + amt);
      sfx.skillActivate();
      commit(withAbilityUse({ ...pc, resources: { ...pc.resources, 霊力: { ...r, cur: nextCur }, 攻撃力: { ...pc.resources.攻撃力, cur: 1 + Math.floor(nextCur / 5) } } }, name, freq),
        `🔵 ${pc.charName} が能力《${name}》を発動：霊力+${amt}`);
      return;
    }
    if (meta?.auto && meta.kind === "set_rei") {
      // 霊力を指定値にする（既に上回っていれば据え置き＝不利益を出さない）
      const v = meta.params?.value || 10;
      const r = pc.resources.霊力 || { cur: 0, max: 20 };
      const nextCur = Math.max(r.cur, Math.min(r.max, v));
      sfx.skillActivate();
      commit(withAbilityUse({ ...pc, resources: { ...pc.resources, 霊力: { ...r, cur: nextCur }, 攻撃力: { ...pc.resources.攻撃力, cur: 1 + Math.floor(nextCur / 5) } } }, name, freq),
        `🔵 ${pc.charName} が能力《${name}》を発動：霊力を${nextCur}にした`);
      return;
    }
    if (meta?.auto && meta.kind === "gain_random_item") {
      const count = meta.params?.count || 1;
      animateDice(count, `${name}（アイテム獲得）`, res => {
        const names = res.map(d => ITEM_NAMES[d - 1]);
        const nextItems = { ...pc.items };
        names.forEach(n => { nextItems[n] = (nextItems[n] || 0) + 1; });
        commit(withAbilityUse({ ...pc, items: nextItems }, name, freq),
          `🔵 ${pc.charName} が能力《${name}》を発動：【${names.join("】【")}】を獲得`);
      });
      return;
    }
    if (meta?.auto && meta.kind === "gain_yaruki_selfbond") {
      const amt = meta.params?.amount || 1;
      const r = pc.resources.やる気 || { cur: 0, max: 99 };
      const selfBond = `${pc.charName}自身への絆`;
      const bonds = (pc.bonds || []).includes(selfBond) ? pc.bonds : [...(pc.bonds || []), selfBond];
      sfx.skillActivate();
      commit(withAbilityUse({ ...pc,
        resources: { ...pc.resources, やる気: { ...r, cur: Math.min(r.max, r.cur + amt) } },
        bonds,
        bondUsed: { ...(pc.bondUsed || {}), [selfBond]: false },
      }, name, freq),
        `🔵 ${pc.charName} が能力《${name}》を発動：やる気+${amt}・《${selfBond}》を獲得`);
      return;
    }
    if (meta?.auto && meta.kind === "gain_choice_item") {
      // 好きなアイテムを1つ選んで獲得（ピッカーを開く）
      setAbilityItemPick({ name, freq });
      return;
    }
    if (meta?.auto && meta.kind === "cure_bad_status") {
      // 同スポットのキャラの変調1つを除去（対象→変調の2段ピッカー）
      setAbilityCure({ name, freq, params: meta.params || {}, targetUid: null });
      return;
    }
    if (meta?.auto && meta.kind === "refresh_other_cheer_slot") {
      // 他キャラの使用済み応援欄（bondUsed===true）を1つ解除（対象→絆の2段ピッカー）
      setAbilityRefresh({ name, freq, targetUid: null });
      return;
    }
    if (meta?.auto && meta.kind === "party_move") {
      // 同スポットのキャラを連れて好きなスポットへ移動（連れる対象→移動先）
      setAbilityMove({ name, freq, params: meta.params || {}, selected: [], moveSelf: true });
      return;
    }
    if (meta?.auto && meta.kind === "surprise_bond") {
      // 同スポット1人に行為判定→成功で絆＋やる気／失敗で相手が自分への絆
      setAbilitySurprise({ name, freq, params: meta.params || {}, targetUid: null, x: 4 });
      return;
    }
    if (meta?.auto && meta.kind === "spend_item_gain_random") {
      // 所持アイテム1つを失ってランダム（or 好きな）アイテムを獲得
      setAbilitySpend({ name, freq, params: meta.params || {}, spendItem: null, mode: null });
      return;
    }
    if (meta?.auto && meta.kind === "destroy_one") {
      // キャラ1人のタグ/変調/アイテムのうち1つを失わせる
      setAbilityDestroy({ name, freq, targetUid: null, category: null });
      return;
    }
    if (meta?.auto && meta.kind === "set_return_spot") {
      // 帰還先を変更（自分＋選んだPCを任意スポットへ）
      setAbilityReturn({ name, freq, params: meta.params || {}, selected: [], destSpot: null });
      return;
    }
    if (meta?.auto && meta.kind === "redo_own_scene") {
      // 自分のシーンをもう一度（行動済みを解除し、再度シーンプレイヤーに選べるように）
      sfx.skillActivate();
      upd(p => ({
        ...p,
        pcs: p.pcs.map(x => x.uid !== pc.uid ? x : withAbilityUse({ ...x }, name, freq)),
        actedPcs: (p.actedPcs || []).filter(u => u !== pc.uid),
        log: [`🔵 ${pc.charName} が能力《${name}》を発動：もう一度シーンを行える（行動済みを解除）`, ...p.log],
      }));
      return;
    }
    if (meta?.auto && meta.kind === "grant_extra_scene") {
      // 選んだPCがもう一度シーンを行えるようにする（対象選択ピッカー）
      setAbilityScenePick({ name, freq });
      return;
    }
    if (meta?.auto && meta.kind === "reactive_gain") {
      // 発火時に押す手動トリガー：やる気/霊力を獲得（reiDice なら D6 を振る）
      const pr = meta.params || {};
      const applyGains = (reiGain) => {
        const yr = pc.resources.やる気 || { cur: 0, max: 99 };
        const rr = pc.resources.霊力 || { cur: 0, max: 20 };
        const newYaruki = Math.min(yr.max, yr.cur + (pr.yaruki || 0));
        const newRei = Math.min(rr.max, rr.cur + reiGain);
        const parts = [];
        if (pr.yaruki) parts.push(`やる気+${pr.yaruki}`);
        if (reiGain) parts.push(`霊力+${reiGain}`);
        commit(withAbilityUse({ ...pc, resources: { ...pc.resources, やる気: { ...yr, cur: newYaruki }, 霊力: { ...rr, cur: newRei }, 攻撃力: { ...pc.resources.攻撃力, cur: 1 + Math.floor(newRei / 5) } } }, name, freq),
          `🔵 ${pc.charName} が能力《${name}》を発動：${parts.join("・") || "獲得"}`);
      };
      if (pr.reiDice) {
        animateDice(1, `${name}（霊力獲得）`, res => applyGains(res[0]));
      } else {
        sfx.skillActivate();
        applyGains(pr.rei || 0);
      }
      return;
    }
    if (meta?.auto && meta.kind === "boost_other_yaruki") {
      // 同スポットの他PCのやる気獲得に+α（対象選択ピッカー）
      setAbilityBoost({ name, freq, amount: meta.params?.amount || 1 });
      return;
    }
    if (meta?.auto && meta.kind === "set_unlucky_phase") {
      // このフェイズ中、全員が出目すべて2以下でファンブル（gs.unluckyPhase）
      sfx.skillActivate();
      upd(p => ({
        ...p,
        pcs: p.pcs.map(x => x.uid === pc.uid ? withAbilityUse({ ...x }, name, freq) : x),
        unluckyPhase: true,
        log: [`🔵 ${pc.charName} が能力《${name}》を発動：このフェイズ中、全員の判定が出目2以下でファンブルになる`, ...p.log],
      }));
      return;
    }
    if (meta?.auto && meta.kind === "read_mind") {
      // 誰かがあなたへの絆を取得した時：その相手への絆を取得（対象ピッカー）
      setAbilityReadMind({ name, freq });
      return;
    }
    if (meta?.auto && meta.kind === "select_rei_boost") {
      // 霊力増加+α の対象キャラを選ぶ（複数選択）
      const cur = (gs.reiBoostTargets?.uids) || [];
      setAbilityReiBoost({ name, freq, amount: meta.params?.amount || 1, selected: cur, target: "rei" });
      return;
    }
    if (meta?.auto && meta.kind === "select_item_swap") {
      // アイテム交換できる対象キャラを選ぶ（複数選択）
      const cur = gs.itemSwapTargets || [];
      setAbilityReiBoost({ name, freq, amount: 0, selected: cur, target: "itemSwap" });
      return;
    }
    if (meta?.auto && meta.kind === "toggle_untargetable") {
      // 正体を判らなくする：自分を特殊効果の対象に選べなくする（トグル）
      sfx.skillActivate();
      commit({ ...pc, untargetable: !pc.untargetable }, `🔵 ${pc.charName} が能力《${name}》を発動：対象に${pc.untargetable ? "選べるように戻した" : "選べなくした"}`);
      return;
    }
    if (meta?.auto && meta.kind === "set_eternity_night") {
      // 永遠と須臾：この夜サイクルの終了で帰還/やる気減少を行わず夜をもう一度（base=リミット-1）
      sfx.skillActivate();
      upd(p => ({
        ...p,
        pcs: p.pcs.map(x => x.uid === pc.uid ? withAbilityUse({ ...x }, name, freq) : x),
        eternityNight: true,
        eternityShorten: !!meta.params?.shorten,
        log: [`🔵 ${pc.charName} が能力《${name}》を発動：この夜サイクルの終了で夜をもう一度行う（帰還・やる気減少なし${meta.params?.shorten ? "・リミット-1" : ""}）`, ...p.log],
      }));
      return;
    }
    if (meta?.auto && meta.kind === "consume_others_item") {
      // 財産を消費させる：他者のアイテム1つを消費し、その効果を自分に適用（対象→アイテムの2段ピッカー）
      setAbilityFortune({ name, freq, targetUid: null });
      return;
    }
    if (meta?.auto && meta.kind === "boundary_move") {
      // 境界: ダイス1つ→（base:偶数でやる気-1）→任意/拠点移動＋アクション
      const isPlus = meta.params?.plus;
      animateDice(1, `${name}（境界）`, res => {
        const even = res[0] % 2 === 0;
        const curYaruki = pc.resources.やる気?.cur || 0;
        const consume = (!isPlus && even) ? 1 : 0;
        const afterYaruki = curYaruki - consume;
        const mustBase = isPlus ? (even && curYaruki === 1) : (afterYaruki === 1);
        setAbilityBoundary({ name, freq, consume, mustBase });
      });
      return;
    }
    if (meta?.auto && meta.kind === "search_place_clue") {
      // 2D:4 判定 → 成功なら任意スポットに手がかり配置（ピッカー）／失敗ならランダムスポットに配置
      animateDice(2, `${name}（2D:4）`, res => {
        const success = Math.max(...res) >= 4;
        if (success) {
          // 使用フラグだけ先に記録し、配置先をピッカーで選ぶ
          commit(withAbilityUse({ ...pc }, name, freq), `🔵 ${pc.charName} が能力《${name}》発動：成功(出目${res.join(",")})→手がかりを配置するスポットを選択`);
          setAbilitySearchClue({ name, freq });
        } else {
          const spots = (SPOTS || []).filter(s => s.id !== "dream");
          const dest = spots[Math.floor(Math.random() * spots.length)];
          upd(p => ({
            ...p,
            pcs: p.pcs.map(x => x.uid === pc.uid ? withAbilityUse({ ...x }, name, freq) : x),
            clues: Array.from(new Set([...(p.clues || []), dest.id])),
            searchCluePlaced: true, // 実績(鼠算式探索): 探し物由来の手がかり
            log: [`🔵 ${pc.charName} が能力《${name}》発動：失敗(出目${res.join(",")})→ランダムに [${dest.name}] へ手がかりを配置`, ...p.log],
          }));
        }
      });
      return;
    }
    if (meta?.auto && meta.kind === "gain_bonds_same_spot") {
      // 同スポットの自分以外のキャラ全員への絆を取得（交流）
      const others = (gs.pcs || []).filter(x => x.uid !== pc.uid && x.currentSpot === pc.currentSpot && !(x.badStatus || []).includes("不機嫌"));
      if (others.length === 0) { commit(withAbilityUse({ ...pc }, name, freq), `🔵 ${pc.charName} が能力《${name}》発動：同スポットに対象がいません`); return; }
      const newBonds = [...(pc.bonds || [])];
      const newBondUsed = { ...(pc.bondUsed || {}) };
      others.forEach(o => { const b = `${o.charName}への絆`; if (!newBonds.includes(b)) newBonds.push(b); newBondUsed[b] = false; });
      sfx.skillActivate();
      commit(withAbilityUse({ ...pc, bonds: newBonds, bondUsed: newBondUsed }, name, freq),
        `🔵 ${pc.charName} が能力《${name}》発動：${others.map(o => o.charName).join("・")} への絆を取得`);
      return;
    }
    if (meta?.auto && meta.kind === "disguise") {
      // なりすまし：化ける（解除トグル）。化ける相手はプロンプトで指定。
      if (pc.disguisedAs) {
        sfx.skillActivate();
        commit({ ...pc, disguisedAs: null }, `🔵 ${pc.charName} が《${name}》の変身を解除した`);
        return;
      }
      const target = window.prompt("化けるキャラクター名を入力してください");
      if (!target || !target.trim()) return;
      sfx.skillActivate();
      commit(withAbilityUse({ ...pc, disguisedAs: target.trim() }, name, freq),
        `🔵 ${pc.charName} が能力《${name}》を発動：${target.trim()} に化けた（絆取得時の選択はGM）`);
      return;
    }
    if (meta?.auto && meta.kind === "consume_rei_newspaper") {
      // 念写：霊力を消費して文々。新聞表を振る（表ロールはGM）
      const pr = meta.params || {};
      const doConsume = (amt) => {
        const r = pc.resources.霊力 || { cur: 0, max: 20 };
        const nextCur = Math.max(0, r.cur - amt);
        commit(withAbilityUse({ ...pc, resources: { ...pc.resources, 霊力: { ...r, cur: nextCur }, 攻撃力: { ...pc.resources.攻撃力, cur: 1 + Math.floor(nextCur / 5) } } }, name, freq),
          `🔵 ${pc.charName} が能力《${name}》を発動：霊力-${amt} → GMが文々。新聞表を振ってください`);
      };
      if (pr.reiDice) animateDice(1, `${name}（霊力消費）`, res => doConsume(res[0]));
      else { sfx.skillActivate(); doConsume(pr.rei || 1); }
      return;
    }
    if (meta?.auto && meta.kind === "spawn_minion") {
      // 手下をマップに登場させる（あなたのスポット or 拠点）。式神はSC消費＋手下シーン再処理。
      const pr = meta.params || {};
      const spot = pr.at === "base" ? (pc.baseSpotId || pc.currentSpot) : pc.currentSpot;
      const scCost = pr.costSC || (pr.costSCorRei ? 1 : 0);
      const sc = pc.resources.スペルカード || { cur: 0, max: 99 };
      const costPatch = scCost ? { resources: { ...pc.resources, スペルカード: { ...sc, cur: Math.max(0, sc.cur - scCost) } } } : {};
      // 式神: 既に手下がいればそれを使う（いなければ拠点に登場）
      const existing = pr.redoScene ? (gs.minions || []).find(m => m.ownerUid === pc.uid) : null;
      const minionId = existing ? existing.id : `m_${pc.uid}_${Date.now()}`;
      const minionSpot = existing ? existing.currentSpot : spot;
      sfx.skillActivate();
      upd(p => ({
        ...p,
        pcs: p.pcs.map(x => x.uid !== pc.uid ? x : withAbilityUse({ ...x, ...costPatch }, name, freq)),
        minions: existing ? (p.minions || []) : [...(p.minions || []), { id: minionId, ownerUid: pc.uid, ownerName: pc.charName, currentSpot: spot }],
        ...(pr.redoScene ? { actedPcs: (p.actedPcs || []).filter(u => u !== pc.uid), currentScene: { pcUid: pc.uid, minionId, phase: "move_or_stay", startSpot: minionSpot, moveDice: [], actionDice: [], actionDiceCount: 2 } } : {}),
        log: [`🔵 ${pc.charName} が能力《${name}》を発動：${existing ? "手下" : `手下を[${getSpot(spot)?.name}]に登場し`}でシーンを再処理${scCost ? `（SC-${scCost}）` : ""}`, ...p.log],
      }));
      return;
    }

    // 手動フォールバック：発動ログのみ（効果はGMが処理）
    sfx.skillActivate();
    commit(withAbilityUse({ ...pc }, name, freq),
      `🔵 ${pc.charName} が能力《${name}》を発動（効果はGMが処理）`);
  };

  // gain_choice_item：ピッカーで選んだアイテムを獲得して確定する
  const confirmAbilityItem = (itemName) => {
    const pick = abilityItemPick;
    setAbilityItemPick(null);
    if (!pick) return;
    const nextItems = { ...pc.items, [itemName]: (pc.items?.[itemName] || 0) + 1 };
    const base = withAbilityUse({ ...pc, items: nextItems }, pick.name, pick.freq);
    upd(p => ({
      ...p,
      pcs: p.pcs.map(x => x.uid === pc.uid ? base : x),
      log: [`🔵 ${pc.charName} が能力《${pick.name}》を発動：【${itemName}】を獲得`, ...p.log],
    }));
  };

  // cure_bad_status：対象キャラの変調 bsName を除去（＋params.grantTag があればタグ付与）
  const confirmCure = (targetUid, bsName) => {
    const cure = abilityCure;
    setAbilityCure(null);
    if (!cure) return;
    const grantTag = cure.params?.grantTag;
    upd(p => {
      const selfBase = withAbilityUse({ ...pc }, cure.name, cure.freq);
      const target = p.pcs.find(x => x.uid === targetUid);
      const targetName = target?.charName || "対象";
      return {
        ...p,
        pcs: p.pcs.map(x => {
          // 発動者の使用回数フラグ
          let nx = x.uid === pc.uid ? { ...x, abilityUse: selfBase.abilityUse } : x;
          if (x.uid === targetUid) {
            const nextBs = (x.badStatus || []).filter(b => b !== bsName);
            const nextTags = grantTag && !(x.tags || []).includes(grantTag) ? [...(x.tags || []), grantTag] : x.tags;
            nx = { ...nx, badStatus: nextBs, tags: nextTags };
          }
          return nx;
        }),
        log: [`🔵 ${pc.charName} が能力《${cure.name}》を発動：${targetName} の変調《${bsName}》を除去${grantTag ? `し《${grantTag}》タグを付与` : ""}`, ...p.log],
      };
    });
  };

  // refresh_other_cheer_slot：対象キャラの使用済み応援欄（bondUsed[bond]）を1つ解除
  const confirmRefresh = (targetUid, bond) => {
    const rf = abilityRefresh;
    setAbilityRefresh(null);
    if (!rf) return;
    upd(p => {
      const selfBase = withAbilityUse({ ...pc }, rf.name, rf.freq);
      const targetName = p.pcs.find(x => x.uid === targetUid)?.charName || "対象";
      return {
        ...p,
        pcs: p.pcs.map(x => {
          let nx = x.uid === pc.uid ? { ...x, abilityUse: selfBase.abilityUse } : x;
          if (x.uid === targetUid) nx = { ...nx, bondUsed: { ...(x.bondUsed || {}), [bond]: false } };
          return nx;
        }),
        log: [`🔵 ${pc.charName} が能力《${rf.name}》を発動：${targetName} の《${bond}》の応援欄を1つ解除`, ...p.log],
      };
    });
  };

  // party_move：自分（任意）＋選んだ同スポットキャラを destSpot へ移動
  const confirmPartyMove = (destSpot) => {
    const mv = abilityMove;
    setAbilityMove(null);
    if (!mv) return;
    const moveSet = new Set(mv.selected);
    if (mv.moveSelf) moveSet.add(pc.uid);
    const destName = getSpot(destSpot)?.name || destSpot;
    upd(p => {
      const selfBase = withAbilityUse({ ...pc }, mv.name, mv.freq);
      return {
        ...p,
        pcs: p.pcs.map(x => {
          let nx = x;
          if (x.uid === pc.uid) nx = { ...nx, abilityUse: selfBase.abilityUse };
          if (moveSet.has(x.uid)) nx = { ...nx, currentSpot: destSpot };
          return nx;
        }),
        log: [`🔵 ${pc.charName} が能力《${mv.name}》を発動：${[...moveSet].map(u => p.pcs.find(x => x.uid === u)?.charName).filter(Boolean).join("・")} を【${destName}】へ移動`, ...p.log],
      };
    });
  };

  // surprise_bond：同スポット1人に 2D:X 判定。成功→自分が相手への絆＋やる気1／失敗→相手が自分への絆
  const runSurprise = () => {
    const sp = abilitySurprise;
    if (!sp || !sp.targetUid) return;
    setAbilitySurprise(null);
    const target = gs.pcs.find(x => x.uid === sp.targetUid);
    const targetName = target?.charName || "対象";
    const x = sp.params?.declareX ? sp.x : 4;
    animateDice(2, `${sp.name}（2D:${x}）`, res => {
      const success = Math.max(...res) >= x;
      const selfUse = withAbilityUse({ ...pc }, sp.name, sp.freq).abilityUse;
      upd(p => {
        if (success) {
          const bond = `${targetName}への絆`;
          return {
            ...p,
            pcs: p.pcs.map(z => z.uid !== pc.uid ? z : {
              ...z, abilityUse: selfUse,
              bonds: (z.bonds || []).includes(bond) ? z.bonds : [...(z.bonds || []), bond],
              bondUsed: { ...(z.bondUsed || {}), [bond]: false },
              resources: { ...z.resources, やる気: { ...(z.resources.やる気 || { cur: 0, max: 99 }), cur: Math.min((z.resources.やる気?.max || 99), (z.resources.やる気?.cur || 0) + 1) } },
            }),
            log: [`🔵 ${pc.charName} が能力《${sp.name}》発動：成功(出目${res.join(",")})→《${bond}》とやる気+1を獲得`, ...p.log],
          };
        }
        const bond = `${pc.charName}への絆`;
        return {
          ...p,
          pcs: p.pcs.map(z => {
            if (z.uid === pc.uid) return { ...z, abilityUse: selfUse };
            if (z.uid === sp.targetUid) return { ...z,
              bonds: (z.bonds || []).includes(bond) ? z.bonds : [...(z.bonds || []), bond],
              bondUsed: { ...(z.bondUsed || {}), [bond]: false } };
            return z;
          }),
          log: [`🔵 ${pc.charName} が能力《${sp.name}》発動：失敗(出目${res.join(",")})→${targetName} が《${bond}》を獲得`, ...p.log],
        };
      });
    });
  };

  // spend_item_gain_random：spendItem を1つ失い、ランダム n 個 or 好きな1つを獲得
  const runSpendRandom = () => {
    const sd = abilitySpend;
    if (!sd?.spendItem) return;
    setAbilitySpend(null);
    const n = sd.params?.randomCount || 2;
    const spent = sd.spendItem;
    animateDice(n, `${sd.name}（アイテム獲得）`, res => {
      const got = res.map(d => ITEM_NAMES[d - 1]);
      upd(p => {
        const base = withAbilityUse({ ...pc }, sd.name, sd.freq);
        const items = { ...pc.items };
        items[spent] = Math.max(0, (items[spent] || 0) - 1);
        got.forEach(nm => { items[nm] = (items[nm] || 0) + 1; });
        return {
          ...p,
          pcs: p.pcs.map(z => z.uid === pc.uid ? { ...base, items } : z),
          log: [`🔵 ${pc.charName} が能力《${sd.name}》を発動：【${spent}】を失い【${got.join("】【")}】を獲得`, ...p.log],
        };
      });
    });
  };
  const runSpendChoice = (gainItem) => {
    const sd = abilitySpend;
    if (!sd?.spendItem) return;
    setAbilitySpend(null);
    const spent = sd.spendItem;
    upd(p => {
      const base = withAbilityUse({ ...pc }, sd.name, sd.freq);
      const items = { ...pc.items };
      items[spent] = Math.max(0, (items[spent] || 0) - 1);
      items[gainItem] = (items[gainItem] || 0) + 1;
      return {
        ...p,
        pcs: p.pcs.map(z => z.uid === pc.uid ? { ...base, items } : z),
        log: [`🔵 ${pc.charName} が能力《${sd.name}》を発動：【${spent}】を失い【${gainItem}】を獲得`, ...p.log],
      };
    });
  };

  // destroy_one：対象キャラの category(タグ/変調/アイテム) の value を1つ失わせる
  const confirmDestroy = (targetUid, category, value) => {
    const dz = abilityDestroy;
    setAbilityDestroy(null);
    if (!dz) return;
    upd(p => {
      const selfUse = withAbilityUse({ ...pc }, dz.name, dz.freq).abilityUse;
      const targetName = p.pcs.find(x => x.uid === targetUid)?.charName || "対象";
      return {
        ...p,
        pcs: p.pcs.map(x => {
          let nx = x.uid === pc.uid ? { ...x, abilityUse: selfUse } : x;
          if (x.uid === targetUid) {
            if (category === "タグ")   nx = { ...nx, tags: (x.tags || []).filter(t => t !== value) };
            if (category === "変調")   nx = { ...nx, badStatus: (x.badStatus || []).filter(b => b !== value) };
            if (category === "アイテム") nx = { ...nx, items: { ...(x.items || {}), [value]: Math.max(0, (x.items?.[value] || 0) - 1) } };
          }
          return nx;
        }),
        log: [`🔵 ${pc.charName} が能力《${dz.name}》を発動：${targetName} の${category}《${value}》を破壊`, ...p.log],
      };
    });
  };

  // set_return_spot：自分＋選んだPCの帰還先(returnSpotId)を destSpot にする（＋は夜のやる気減少もスキップ）
  const confirmReturn = (destSpot) => {
    const rt = abilityReturn;
    setAbilityReturn(null);
    if (!rt) return;
    const targetSet = new Set([pc.uid, ...rt.selected]);
    const yarukiSkip = !!rt.params?.yarukiSkip;
    const destName = getSpot(destSpot)?.name || destSpot;
    upd(p => {
      const selfBase = withAbilityUse({ ...pc }, rt.name, rt.freq).abilityUse;
      return {
        ...p,
        pcs: p.pcs.map(x => {
          let nx = x.uid === pc.uid ? { ...x, abilityUse: selfBase } : x;
          if (targetSet.has(x.uid)) nx = { ...nx, returnSpotId: destSpot, ...(yarukiSkip ? { returnYarukiSkip: true } : {}) };
          return nx;
        }),
        log: [`🔵 ${pc.charName} が能力《${rt.name}》を発動：${[...targetSet].map(u => p.pcs.find(x => x.uid === u)?.charName).filter(Boolean).join("・")} の帰還先を【${destName}】に${yarukiSkip ? "（夜のやる気減少なし）" : ""}`, ...p.log],
      };
    });
  };

  // grant_extra_scene：選んだPCを行動済みから外し、もう一度シーンを行えるようにする
  const confirmScenePick = (targetUid) => {
    const sp = abilityScenePick;
    setAbilityScenePick(null);
    if (!sp) return;
    upd(p => {
      const selfBase = withAbilityUse({ ...pc }, sp.name, sp.freq).abilityUse;
      const targetName = p.pcs.find(x => x.uid === targetUid)?.charName || "対象";
      return {
        ...p,
        pcs: p.pcs.map(x => x.uid === pc.uid ? { ...x, abilityUse: selfBase } : x),
        actedPcs: (p.actedPcs || []).filter(u => u !== targetUid),
        log: [`🔵 ${pc.charName} が能力《${sp.name}》を発動：${targetName} がもう一度シーンを行える`, ...p.log],
      };
    });
  };

  // search_place_clue（探し物）成功時：選んだスポットに手がかりを配置
  const confirmSearchClue = (spotId) => {
    setAbilitySearchClue(null);
    upd(p => ({
      ...p,
      clues: Array.from(new Set([...(p.clues || []), spotId])),
      searchCluePlaced: true, // 実績(鼠算式探索): 探し物由来の手がかり
      log: [`🔵 ${pc.charName} の《探し物を探し当てる程度の能力》：[${getSpot(spotId)?.name}] へ手がかりを配置`, ...p.log],
    }));
  };

  // read_mind（心を読む）：対象への絆を取得し、対象が持つ「pcへの絆」をチェック済みにする
  const confirmReadMind = (targetUid) => {
    const rm = abilityReadMind;
    setAbilityReadMind(null);
    if (!rm) return;
    upd(p => {
      const selfBase = withAbilityUse({ ...pc }, rm.name, rm.freq).abilityUse;
      const target = p.pcs.find(x => x.uid === targetUid);
      const targetName = target?.charName || "対象";
      const bond = `${targetName}への絆`;
      const myBond = `${pc.charName}への絆`;
      return {
        ...p,
        pcs: p.pcs.map(x => {
          if (x.uid === pc.uid) {
            const bonds = (x.bonds || []).includes(bond) ? x.bonds : [...(x.bonds || []), bond];
            return { ...x, abilityUse: selfBase, bonds, bondUsed: { ...(x.bondUsed || {}), [bond]: false } };
          }
          if (x.uid === targetUid) return { ...x, bondUsed: { ...(x.bondUsed || {}), [myBond]: true } }; // さとりへの絆をチェック
          return x;
        }),
        log: [`🔵 ${pc.charName} が能力《${rm.name}》を発動：《${bond}》を取得（${targetName} の応援欄をチェック）`, ...p.log],
      };
    });
  };

  // consume_others_item（財産を消費させる）：対象のアイテムを1つ消費し、その効果を自分(pc)に適用
  const confirmFortune = (targetUid, item) => {
    const ft = abilityFortune;
    setAbilityFortune(null);
    if (!ft || !ITEM_DATA[item]) return;
    upd(p => {
      // 十分な数を持たせたクローンに use を適用し、結果の resources/flags のみ自分に適用（自分の所持アイテムは不変）
      const clone = { ...pc, items: { ...pc.items, [item]: 3 }, flags: { ...pc.flags } };
      const after = ITEM_DATA[item].use(clone, p);
      const targetName = p.pcs.find(x => x.uid === targetUid)?.charName || "対象";
      return {
        ...p,
        pcs: p.pcs.map(x => {
          if (x.uid === pc.uid) return withAbilityUse({ ...x, resources: after.resources, flags: after.flags }, ft.name, ft.freq);
          if (x.uid === targetUid) return { ...x, items: { ...(x.items || {}), [item]: Math.max(0, (x.items?.[item] || 0) - 1) } };
          return x;
        }),
        log: [`🔵 ${pc.charName} が能力《${ft.name}》発動：${targetName} の【${item}】を消費し、その効果を自分に適用`, ...p.log],
      };
    });
  };

  // boundary_move（境界）：選んだスポットへ移動し、シーン中ならアクションフェイズへ（やる気消費）
  const confirmBoundary = (spotId) => {
    const bd = abilityBoundary;
    setAbilityBoundary(null);
    if (!bd) return;
    upd(p => ({
      ...p,
      pcs: p.pcs.map(x => {
        if (x.uid !== pc.uid) return x;
        let nx = withAbilityUse({ ...x, currentSpot: spotId }, bd.name, bd.freq);
        if (bd.consume) { const yr = nx.resources.やる気 || { cur: 0, max: 99 }; nx = { ...nx, resources: { ...nx.resources, やる気: { ...yr, cur: Math.max(0, yr.cur - bd.consume) } } }; }
        // 実績(境界跳躍): 境界移動はエリア踏破に数えるが normalMoves には数えない
        const ca = nx.ach || {};
        nx = { ...nx, ach: { ...ca, moved: true, spots: achAddTo(ca, "spots", spotId) } };
        return nx;
      }),
      currentScene: p.currentScene?.pcUid === pc.uid ? { ...p.currentScene, phase: "action" } : p.currentScene,
      log: [`🔵 ${pc.charName} が能力《${bd.name}》発動：[${getSpot(spotId)?.name}] へ移動${bd.consume ? `（やる気-${bd.consume}）` : ""}＋アクション`, ...p.log],
    }));
  };

  // select_rei_boost / select_item_swap：選んだキャラを対象に設定（霊力増加 or アイテム交換）
  const confirmReiBoost = () => {
    const rb = abilityReiBoost;
    setAbilityReiBoost(null);
    if (!rb) return;
    const names = rb.selected.map(u => gs.pcs.find(x => x.uid === u)?.charName).filter(Boolean).join("・") || "（なし）";
    upd(p => ({
      ...p,
      pcs: p.pcs.map(x => x.uid === pc.uid ? withAbilityUse({ ...x }, rb.name, rb.freq) : x),
      ...(rb.target === "itemSwap" ? { itemSwapTargets: rb.selected } : { reiBoostTargets: { uids: rb.selected, amount: rb.amount } }),
      log: [`🔵 ${pc.charName} が能力《${rb.name}》を発動：${names} を${rb.target === "itemSwap" ? "アイテム交換可能に" : `霊力増加+${rb.amount}に`}設定`, ...p.log],
    }));
  };

  // boost_other_yaruki（核融合）：同スポットの他PCのやる気を amount だけ増やす
  const confirmBoost = (targetUid) => {
    const bs = abilityBoost;
    setAbilityBoost(null);
    if (!bs) return;
    upd(p => {
      const selfBase = withAbilityUse({ ...pc }, bs.name, bs.freq).abilityUse;
      const targetName = p.pcs.find(x => x.uid === targetUid)?.charName || "対象";
      return {
        ...p,
        pcs: p.pcs.map(x => {
          let nx = x.uid === pc.uid ? { ...x, abilityUse: selfBase } : x;
          if (x.uid === targetUid) {
            const yr = x.resources.やる気 || { cur: 0, max: 99 };
            nx = { ...nx, resources: { ...nx.resources, やる気: { ...yr, cur: Math.min(yr.max, yr.cur + bs.amount) } } };
          }
          return nx;
        }),
        log: [`🔵 ${pc.charName} が能力《${bs.name}》を発動：${targetName} のやる気+${bs.amount}`, ...p.log],
      };
    });
  };

  const adjustResource = (key, delta) => {
    const r = resources[key] || { cur: 0, max: 1 };
    const newCur = Math.max(0, Math.min(r.cur + delta, r.max));
    const updated = { ...resources,[key]: { ...r, cur: newCur } };
    if (key === "霊力") updated.攻撃力 = { ...updated.攻撃力, cur: 1 + Math.floor(newCur / 5) };
    onUpdatePc({ ...pc, resources: updated });
  };

  const resKeys  = ["やる気", "残り人数", "スペルカード", "グレイズ", "霊力", "攻撃力"];
  const itemKeys = Object.keys(INIT_ITEMS());

  useEffect(() => {
    const snapshot = Object.fromEntries(resKeys.map(k => [k, resources[k]?.cur ?? 0]));
    if (prevResRef.current === null) { prevResRef.current = snapshot; return; }
    const changed = {};
    for (const k of resKeys) {
      const cur = snapshot[k], prev = prevResRef.current[k];
      if (cur !== prev) changed[k] = cur > prev ? "up" : "down";
    }
    prevResRef.current = snapshot;
    if (Object.keys(changed).length > 0) {
      setResFlash(f => {
        const next = { ...f };
        for (const k of Object.keys(changed)) next[k] = { tick: ((f[k]?.tick ?? 0) + 1), dir: changed[k] };
        return next;
      });
    }
  }, [pc.resources]); // eslint-disable-line

  // 一発限り（1セッション1回）スキルの発動を検出して効果音を鳴らす
  const onceFlag = !!pc[PS_ONCE_FLAG];
  useEffect(() => {
    if (prevOnceFlagRef.current === null) { prevOnceFlagRef.current = onceFlag; return; }
    if (!prevOnceFlagRef.current && onceFlag) sfx.skillActivate();
    prevOnceFlagRef.current = onceFlag;
  }, [onceFlag]);

  return (
    <div style={{ border: `1px solid ${isActing ? C.blue : C.border}`, borderRadius: 2, marginBottom: 6, overflow: "hidden", transition: "border 0.2s, box-shadow 0.2s", boxShadow: isActing ? `0 0 16px ${C.blue}28` : "none", background: isActing ? `${C.blue}06` : "transparent" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", cursor: "pointer", background: isActing ? C.blueBg : expanded ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.01)" }} onClick={() => setExpanded(v => !v)}>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <CharSprite spriteRow={pc.spriteRow ?? -1} spriteCol={pc.spriteCol ?? -1} size={36} />
          <span
            title={isOnline ? "オンライン" : "オフライン"}
            style={{ position: "absolute", right: -1, bottom: -1, width: 9, height: 9, borderRadius: "50%", background: isOnline ? "#4caf50" : "#5a6070", border: "1.5px solid #0b0d14", boxShadow: isOnline ? "0 0 5px rgba(76,175,80,0.8)" : "none" }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pc.charName}</span>
            {isActing ? <span style={{ fontSize: 9, color: C.blue }}>▶ シーン進行中</span> : hasActed ? <span style={{ fontSize: 9, color: C.textFaint }}>✓ 行動済み</span> : <span style={{ fontSize: 9, color: C.gold }}>未行動</span>}
          </div>
          <div style={{ fontSize: 9, color: C.textFaint }}>
            {(pc.tags || []).length > 0 && `《${pc.tags.join("》《")}》`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ fontSize: 9, color: "#f9a825" }}>やる気{resources.やる気?.cur || 0}/{resources.やる気?.max || 3}</span>
          <span style={{ fontSize: 9, color: "#ab47bc" }}>霊力{resources.霊力?.cur || 0}</span>
          <button
            onClick={e => { e.stopPropagation(); setDetailModal(true); }}
            title="詳細を表示"
            style={{ width: 20, height: 20, fontSize: 11, lineHeight: 1, cursor: "pointer", borderRadius: 3, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, color: C.textDim, padding: 0 }}
          >🔍</button>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: "10px 12px", borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginBottom: 8 }}>リソース</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginBottom: 10 }}>
            {resKeys.map(k => {
              const r = resources[k] || { cur: 0, max: 1 };
              return (
                <div key={k} style={{ padding: "4px 6px", background: "rgba(255,255,255,0.02)", border: `1px solid ${C.border}`, borderRadius: 3, textAlign: "center" }}>
                  <div style={{ fontSize: 8, color: C.textFaint, marginBottom: 1 }}>【{k}】</div>
                  <div key={`${k}-${resFlash[k]?.tick ?? 0}`} style={{ fontSize: 12, color: C.gold, animation: resFlash[k] ? `${resFlash[k].dir === "up" ? "resFlashUp" : "resFlashDown"} 0.55s ease forwards` : "none" }}>{r.cur}{r.max > 1 && <span style={{ fontSize: 8, color: C.textFaint }}>/{r.max}</span>}</div>
                  {isGm && gmEdit && (
                    <div style={{ display: "flex", gap: 2, justifyContent: "center", marginTop: 2 }}>
                      <button onClick={() => adjustResource(k, -1)} style={{ width: 14, height: 14, fontSize: 9, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, cursor: "pointer", borderRadius: 2, padding: 0 }}>−</button>
                      <button onClick={() => adjustResource(k, +1)} style={{ width: 14, height: 14, fontSize: 9, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, cursor: "pointer", borderRadius: 2, padding: 0 }}>＋</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginBottom: 8 }}>アイテム</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
            {itemKeys.map(k => {
              const count  = items[k] || 0;
              const canUse = ITEM_DATA[k]?.canUse(pc);
              if (count === 0 && !isGm) return null;
              return (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 3, padding: "3px 7px", borderRadius: 12, cursor: count > 0 ? "pointer" : "default", background: canUse ? "rgba(200,160,64,0.15)" : "rgba(255,255,255,0.03)", border: `1px solid ${canUse ? C.goldDim : C.border}` }} onClick={() => count > 0 && setItemModal(k)}>
                  <span style={{ fontSize: 10, color: canUse ? C.gold : C.textFaint }}>{k}</span>
                  <span style={{ fontSize: 9, color: canUse ? C.gold : C.textFaint, padding: "0 4px", background: "rgba(0,0,0,0.3)", borderRadius: 8 }}>{count}</span>
                </div>
              );
            })}
            <button onClick={() => setGmEdit(v => !v)} style={{ padding: "2px 8px", fontSize: 9, cursor: "pointer", borderRadius: 10, background: gmEdit ? "rgba(192,57,43,0.2)" : "rgba(255,255,255,0.03)", border: `1px solid ${gmEdit ? "#8b1a1a" : C.border}`, color: gmEdit ? C.red : C.textFaint }}>{gmEdit ? "編集終了" : "GM編集"}</button>
            {isGm && gmEdit && (
              <div style={{ width: "100%", marginTop: 4 }}>
                <div style={{ fontSize: 8, color: C.textFaint, marginBottom: 4 }}>アイテム直接編集:</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {itemKeys.map(k => (
                    <div key={k} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                      <span style={{ fontSize: 9, color: C.textFaint }}>{k}:</span>
                      <button onClick={() => onUpdatePc({ ...pc, items: { ...items, [k]: Math.max(0, (items[k] || 0) - 1) } })} style={{ width: 14, height: 14, fontSize: 9, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, cursor: "pointer", borderRadius: 2, padding: 0 }}>−</button>
                      <span style={{ fontSize: 9, color: C.gold, minWidth: 12, textAlign: "center" }}>{items[k] || 0}</span>
                      <button onClick={() => onUpdatePc({ ...pc, items: { ...items, [k]: (items[k] || 0) + 1 } })} style={{ width: 14, height: 14, fontSize: 9, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, cursor: "pointer", borderRadius: 2, padding: 0 }}>＋</button>
                    </div>
                  ))}
                </div>
                {/* 強化解禁トグル（能力スキル＋／成長スペルカードは別々の強化選択肢） */}
                {(pc.growthAbility?.name || pc.growthSpellCard) && (
                  <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 8, color: C.textFaint }}>強化解禁:</span>
                    {pc.growthAbility?.name && (
                      <button onClick={() => upd(p => ({
                        ...p,
                        pcs: p.pcs.map(x => x.uid === pc.uid ? applyAbilityPassiveStats({ ...x, growthAbilityUnlocked: !x.growthAbilityUnlocked }) : x),
                        log: [`🌟 ${pc.charName} は${pc.growthAbilityUnlocked ? "能力スキル＋を解除した" : "能力スキルを強化した（能力スキル＋）"}`, ...p.log],
                      }))} style={{ padding: "2px 8px", fontSize: 9, cursor: "pointer", borderRadius: 10, background: isAbilityGrown ? "rgba(255,213,79,0.18)" : "rgba(255,255,255,0.03)", border: `1px solid ${isAbilityGrown ? C.goldDim : C.border}`, color: isAbilityGrown ? C.gold : C.textFaint }}>
                        {isAbilityGrown ? "能力＋（解除）" : "能力＋に強化"}
                      </button>
                    )}
                    {pc.growthSpellCard && (
                      <button onClick={() => upd(p => ({
                        ...p,
                        pcs: p.pcs.map(x => x.uid === pc.uid ? { ...x, growthSpellUnlocked: !x.growthSpellUnlocked } : x),
                        log: [`🌟 ${pc.charName} は${pc.growthSpellUnlocked ? "成長スペカを解除した" : "追加スペルカードを取得した"}`, ...p.log],
                      }))} style={{ padding: "2px 8px", fontSize: 9, cursor: "pointer", borderRadius: 10, background: pc.growthSpellUnlocked ? "rgba(255,213,79,0.18)" : "rgba(255,255,255,0.03)", border: `1px solid ${pc.growthSpellUnlocked ? C.goldDim : C.border}`, color: pc.growthSpellUnlocked ? C.gold : C.textFaint }}>
                        {pc.growthSpellUnlocked ? "追加スペカ（解除）" : "追加スペカ取得"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {badStatus.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginBottom: 6 }}>変調</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {badStatus.map(bs => {
                  const bData = Object.values(BAD_STATUS_TABLE).find(x => x.name === bs);
                  return (
                    <div key={bs} style={{ padding: "4px 8px", background: "rgba(224,112,96,0.15)", border: `1px solid ${C.redBorder}`, borderRadius: 4, animation: "badStatusIn 0.45s cubic-bezier(0.34,1.56,0.64,1) both" }}>
                      <div style={{ fontSize: 10, color: C.red, marginBottom: 2, fontWeight: "bold" }}>《{bs}》</div>
                      <div style={{ fontSize: 8, color: C.textDim, lineHeight: 1.4 }}>{bData?.desc}</div>
                      {isGm && gmEdit && <button onClick={() => onUpdatePc({ ...pc, badStatus: badStatus.filter(x => x !== bs) })} style={{ marginTop: 4, padding: "2px 6px", fontSize: 8, background: "rgba(255,255,255,0.05)", border: `1px solid ${C.border}`, color: C.textFaint, cursor: "pointer", borderRadius: 2 }}>解除</button>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginBottom: 6 }}>絆</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {(pc.bonds || []).map(b => {
                const isFrom = b.endsWith("からの絆");
                return (
                  <span key={b} style={{ 
                    padding: "2px 8px", 
                    background: isFrom ? "rgba(156,39,176,0.1)" : "rgba(200,160,64,0.1)", 
                    border: `1px solid ${isFrom ? C.purpleBorder : C.goldDim}50`, 
                    borderRadius: 10, fontSize: 10, 
                    color: isFrom ? C.purple : C.gold 
                  }}>
                    《{b}》
                  </span>
                );
              })}
            </div>
          </div>

          <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginBottom: 8 }}>スキル</div>
          
          {/* 個性スキルの表示 */}
          {skill && (() => {
            const isPassive = skill.passive;
            const hasCustomUI = skill.hasCustomUI;
            const isCustomChar = pc.charId?.startsWith("custom_");
            // 発動ボタンを出す条件（専用UIがなく、パッシブでもないこと）
            const canActivate = !isCustomChar && !hasCustomUI && !isPassive;
            const isUsedUp = skill.name === "カリスマ" && pc[PS_ONCE_FLAG];
            const isReady = canActivate && !isUsedUp;

            return (
            <div style={{ marginBottom: 6, ...(isReady ? skillReadyBox(psColor) : {}) }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ padding: "1px 6px", background: `${SKILL_TYPE_COLOR[skill.type] || C.text}18`, border: `1px solid ${SKILL_TYPE_COLOR[skill.type] || C.text}50`, borderRadius: 8, fontSize: 8, color: SKILL_TYPE_COLOR[skill.type] || C.text, flexShrink: 0, whiteSpace: "nowrap" }}>{skill.type}</span>
                <span style={{ fontSize: 11, fontWeight: isReady ? 700 : 400, color: isReady ? psColor : "#81c784", flex: 1, minWidth: 0, wordBreak: "keep-all" }}>《{skill.name}》</span>
                
                {isPassive && <span style={{ fontSize: 8, color: "#81c784", flexShrink: 0, whiteSpace: "nowrap" }}>常時発動中</span>}
                {hasCustomUI && <span style={{ fontSize: 8, color: "#ffb74d", flexShrink: 0, whiteSpace: "nowrap" }}>タイミング発動</span>}
                
                {isReady && <span style={{ fontSize: 8, color: psColor, marginLeft: "auto", flexShrink: 0, whiteSpace: "nowrap" }}>● 発動可能</span>}
              </div>
              <div style={{ fontSize: 9, color: C.textFaint, lineHeight: 1.7, marginBottom: 6 }}>{skill.desc}</div>

              {/* 馬鹿: 免疫変調の選択 */}
              {skill.name === "馬鹿" && !isCustomChar && (
                <div style={{ marginBottom: 6 }}>
                  {pc.badStatusImmune
                    ? <div style={{ fontSize: 9, color: "#81c784" }}>🛡 免疫中: 《{pc.badStatusImmune}》</div>
                    : (
                      <div>
                        <div style={{ fontSize: 9, color: C.textDim, marginBottom: 4 }}>免疫にする変調を選んでください:</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {Object.values(BAD_STATUS_TABLE).map(bs => (
                            <button key={bs.name} onClick={() => onUpdatePc({ ...pc, badStatusImmune: bs.name })}
                              style={{ padding: "3px 8px", fontSize: 9, cursor: "pointer", borderRadius: 3, background: "rgba(255,255,255,0.05)", border: `1px solid ${C.border}`, color: C.textDim, flexShrink: 0, whiteSpace: "nowrap" }}>
                              {bs.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  }
                </div>
              )}

              {/* カリスマ: 1セッション1回表示 */}
              {skill.name === "カリスマ" && pc[PS_ONCE_FLAG] && (
                <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 4 }}>（このセッションは使用済み）</div>
              )}

              {isCustomChar ? null : (
                canActivate ? (
                  isUsedUp
                    ? <div style={{ fontSize: 9, color: C.textFaint }}>（使用済み）</div>
                    : <button onClick={() => setSkillModal(true)} style={skillActivateBtn(psColor)}>発動する</button>
                ) : hasCustomUI ? (
                  <div style={{ fontSize: 9, color: "#ffb74d", padding: "4px 8px", background: "rgba(255,183,77,0.1)", borderRadius: 4, border: "1px solid rgba(255,183,77,0.3)" }}>
                    💡 条件を満たした際、専用のボタンが表示されます
                  </div>
                ) : isPassive && skill.name !== "馬鹿" ? (
                  <div style={{ fontSize: 9, color: "#81c784", padding: "4px 8px", background: "rgba(129,199,132,0.1)", borderRadius: 4, border: "1px solid rgba(129,199,132,0.3)" }}>
                    ⚙️ 常に効果が適用されています
                  </div>
                ) : null
              )}
            </div>
            );
          })()}

          {/* 能力スキルの表示 */}
          {activeAbility?.name && (() => {
            const meta = getAbilityEffect(activeAbility);
            const hasCustomUI = meta?.hasCustomUI;
            const isPassive = meta?.passive;
            const isReactive = meta?.reactive;
            // 発動ボタンを出す条件（専用UIがなく、パッシブでもないか、あるいは手動リアクティブ指定がある場合）
            const canActivate = !isCustomChar && (isReactive || (!hasCustomUI && !isPassive));
            const isReady = !!activeAbility?.name && canActivate && !abilityUsedUp(activeAbility);

            return (
              <div style={{ marginTop: 6, ...(isReady ? skillReadyBox(abColor) : {}) }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <span style={{ padding: "1px 6px", background: `${abColor}18`, border: `1px solid ${abColor}50`, borderRadius: 8, fontSize: 8, color: abColor, flexShrink: 0, whiteSpace: "nowrap" }}>{activeAbility.type}</span>
                  <span style={{ fontSize: 11, fontWeight: isReady ? 700 : 400, color: isReady ? abColor : "#90caf9", flex: 1, minWidth: 0, wordBreak: "keep-all" }}>《{activeAbility.name}》</span>
                  {isAbilityGrown && pc.growthAbility?.name && <span style={{ padding: "1px 5px", background: "rgba(255,213,79,0.16)", border: `1px solid ${C.goldDim}`, borderRadius: 8, fontSize: 8, color: C.gold, flexShrink: 0, whiteSpace: "nowrap" }}>成長</span>}
                  
                  {isPassive && !isReactive && <span style={{ fontSize: 8, color: "#81c784", flexShrink: 0, whiteSpace: "nowrap" }}>常時発動中</span>}
                  {hasCustomUI && <span style={{ fontSize: 8, color: "#ffb74d", flexShrink: 0, whiteSpace: "nowrap" }}>タイミング発動</span>}
                  
                  {isReady && <span style={{ fontSize: 8, color: abColor, marginLeft: "auto", flexShrink: 0, whiteSpace: "nowrap" }}>● 発動可能</span>}
                </div>
                <div style={{ fontSize: 9, color: C.textFaint, lineHeight: 1.7, marginBottom: 6 }}>{activeAbility.desc}</div>
                {pc.disguisedAs && <div style={{ fontSize: 9, color: "#ce93d8", marginBottom: 4 }}>🦝 変身中：{pc.disguisedAs} として扱う</div>}
                {pc.untargetable && <div style={{ fontSize: 9, color: "#90caf9", marginBottom: 4 }}>👁 対象外：特殊効果の対象に選ばれない</div>}
                
                {/* 正邪: ひっくり返すの無効化トグル */}
                {activeAbility?.name === "何でもひっくり返す程度の能力＋" && !isCustomChar && (
                  <div style={{ marginBottom: 6 }}>
                    <button onClick={() => onUpdatePc({ ...pc, abilityToggleOff: !pc.abilityToggleOff })}
                      style={{ padding: "3px 8px", fontSize: 9, cursor: "pointer", borderRadius: 3, background: pc.abilityToggleOff ? "rgba(224,112,96,0.15)" : "rgba(255,255,255,0.05)", border: `1px solid ${pc.abilityToggleOff ? C.redBorder : C.border}`, color: pc.abilityToggleOff ? C.red : C.textDim }}>
                      {pc.abilityToggleOff ? "🛡 現在: 特殊効果 無効化中（クリックで有効化）" : "現在: 特殊効果 有効（クリックで無効化）"}
                    </button>
                  </div>
                )}

                {isCustomChar ? null : (
                  canActivate ? (
                    abilityUsedUp(activeAbility)
                      ? <div style={{ fontSize: 9, color: C.textFaint }}>（使用済み）</div>
                      : <button onClick={() => setAbilityModal(activeAbility)} style={skillActivateBtn(abColor)}>発動する</button>
                  ) : hasCustomUI ? (
                    <div style={{ fontSize: 9, color: "#ffb74d", padding: "4px 8px", background: "rgba(255,183,77,0.1)", borderRadius: 4, border: "1px solid rgba(255,183,77,0.3)" }}>
                      💡 条件を満たした際、専用のボタンが表示されます
                    </div>
                  ) : isPassive ? (
                    <div style={{ fontSize: 9, color: "#81c784", padding: "4px 8px", background: "rgba(129,199,132,0.1)", borderRadius: 4, border: "1px solid rgba(129,199,132,0.3)" }}>
                      ⚙️ 常に効果が適用されています
                    </div>
                  ) : null
                )}
              </div>
            );
          })()}

          {/* 所有権を失わせる（千亦）: 対象に選ばれたキャラはアイテム交換（1つ失い1つ獲得）できる */}
          {(gs.itemSwapTargets || []).includes(pc.uid) && !isCustomChar && ITEM_NAMES.some(n => (pc.items?.[n] || 0) > 0) && (
            <button onClick={() => setAbilitySpend({ name: "所有権を失わせる（交換）", freq: null, params: { swapOnly: true }, spendItem: null, mode: null })} style={{ ...btnFull("rgba(129,199,132,0.12)", C.greenBorder, C.green, { fontSize: 10 }), marginTop: 6 }}>🔄 アイテム交換（所有権）</button>
          )}

          {/* 手下（minion）操作パネル: 自分の手下を移動/アクション/除去 */}
          {(gs.minions || []).some(m => m.ownerUid === pc.uid) && (
            <div style={{ marginTop: 6, padding: 6, background: "rgba(206,147,216,0.08)", border: "1px solid #ce93d850", borderRadius: 4 }}>
              <div style={{ fontSize: 9, color: "#ce93d8", marginBottom: 4 }}>手 手下（{(gs.minions || []).filter(m => m.ownerUid === pc.uid).length}）</div>
              {(gs.minions || []).filter(m => m.ownerUid === pc.uid).map((m, i) => (
                <div key={m.id} style={{ marginBottom: 4 }}>
                  <div style={{ fontSize: 9, color: C.textDim, marginBottom: 2 }}>手下{i + 1} @ {getSpot(m.currentSpot)?.name || "-"}</div>
                  {minionMove === m.id ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
                      {(SPOTS || []).map(s => (
                        <button key={s.id} onClick={() => { setMinionMove(null); upd(p => ({ ...p, minions: (p.minions || []).map(x => x.id === m.id ? { ...x, currentSpot: s.id } : x), log: [`手 ${pc.charName} の手下が[${s.name}]へ移動`, ...p.log] })); }} style={btnFull("rgba(206,147,216,0.12)", "#ce93d850", "#ce93d8", { fontSize: 8, padding: "3px 4px" })}>{s.name}</button>
                      ))}
                      <button onClick={() => setMinionMove(null)} style={btnFull("rgba(255,255,255,0.04)", C.border, C.textFaint, { fontSize: 8, padding: "3px 4px" })}>やめる</button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                      <button onClick={() => setMinionMove(m.id)} style={btnFull("rgba(206,147,216,0.12)", "#ce93d850", "#ce93d8", { width: "auto", fontSize: 8, padding: "3px 6px" })}>移動</button>
                      {/* 手下でシーンを行う（袿姫/藍）: 手下のスポットでアクション、効果は所有者が受ける */}
                      {!gs.currentScene && (
                        <button onClick={() => upd(p => ({ ...p, currentScene: { pcUid: pc.uid, minionId: m.id, phase: "move_or_stay", startSpot: m.currentSpot, moveDice: [], actionDice: [], actionDiceCount: 2 }, log: [`🎬 ${pc.charName} の手下がシーン（移動とアクション）を行う @ ${getSpot(m.currentSpot)?.name}`, ...p.log] }))} style={btnFull("rgba(206,147,216,0.12)", "#ce93d850", "#ce93d8", { width: "auto", fontSize: 8, padding: "3px 6px" })}>手下でシーン</button>
                      )}
                      <button onClick={() => upd(p => ({ ...p, minions: (p.minions || []).filter(x => x.id !== m.id), log: [`手 ${pc.charName} の手下が退場した`, ...p.log] }))} style={btnFull("rgba(255,255,255,0.04)", C.border, C.textFaint, { width: "auto", fontSize: 8, padding: "3px 6px" })}>除去</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {pc.flags?.liveAvailable && gs.cycleIdx === 2 && (
            <div style={{ marginTop: 8 }}>
              <button onClick={() => {
                onUpdatePc({
                  ...pc,
                  currentSpot: gs.newspaper?.targetSpot || pc.currentSpot,
                  resources: { ...pc.resources, やる気: { ...pc.resources.やる気, cur: Math.min(pc.resources.やる気.max, (pc.resources.やる気?.cur || 0) + 1) } },
                  flags: { ...pc.flags, liveAvailable: false },
                  log: [...(pc.log||[]), `${pc.charName} はゲリラライブ会場に移動し、やる気を1回復した！`]
                });
              }} style={btnFull(C.blueBg, C.blueBorder, C.blue, { fontSize: 10 })}>🎵 ゲリラライブ会場へ移動（やる気+1）</button>
            </div>
          )}

          {pc.flags?.canCureBadStatus && (pc.badStatus || []).length > 0 && (
            <div style={{ marginTop: 8, padding: 6, background: "rgba(255,255,255,0.03)", borderRadius: 4 }}>
              <div style={{ fontSize: 9, color: C.textDim, marginBottom: 4 }}>📰 ストレッチ効果で変調を1つ解除できます</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {pc.badStatus.map(bs => (
                  <button key={bs} onClick={() => {
                    onUpdatePc({
                      ...pc,
                      badStatus: pc.badStatus.filter(x => x !== bs),
                      flags: { ...pc.flags, canCureBadStatus: false },
                      log: [...(pc.log||[]), `${pc.charName} は新聞効果で変調《${bs}》を解除した`]
                    });
                  }} style={btnFull(C.blueBg, C.blueBorder, C.blue, { padding: "4px", fontSize: 10, width: "auto" })}>
                    {bs} を解除
                  </button>
                ))}
              </div>
            </div>
          )}

          {gs.cycleIdx === 3 && skill?.name !== "アウトドア派" && (
            <div style={{ marginTop: 8, padding: 6, background: "rgba(255,255,255,0.03)", borderRadius: 4 }}>
              <div style={{ fontSize: 9, color: C.textDim, marginBottom: 4 }}>今夜の帰還先</div>
              <div style={{ display: "flex", gap: 4 }}>
                <button onClick={() => onUpdatePc({...pc, returnSpotId: pc.baseSpotId})} style={btnFull(pc.returnSpotId === pc.baseSpotId || !pc.returnSpotId ? C.goldBg : "rgba(255,255,255,0.02)", pc.returnSpotId === pc.baseSpotId || !pc.returnSpotId ? C.goldDim : C.border, pc.returnSpotId === pc.baseSpotId || !pc.returnSpotId ? C.gold : C.textDim, { padding: "4px", fontSize: 10 })}>
                  拠点 ({getSpot(pc.baseSpotId)?.name})
                </button>
                {gs.newspaper?.targetSpot && (gs.newspaper.roll === 14 || gs.newspaper.roll % 11 === 0) && (
                  <button onClick={() => onUpdatePc({...pc, returnSpotId: gs.newspaper.targetSpot})} style={btnFull(pc.returnSpotId === gs.newspaper.targetSpot ? C.goldBg : "rgba(255,255,255,0.02)", pc.returnSpotId === gs.newspaper.targetSpot ? C.goldDim : C.border, pc.returnSpotId === gs.newspaper.targetSpot ? C.gold : C.textDim, { padding: "4px", fontSize: 10 })}>
                    📰 {getSpot(gs.newspaper.targetSpot)?.name}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* アウトドア派: 夜帰還不要の表示 */}
          {gs.cycleIdx === 3 && skill?.name === "アウトドア派" && (
            <div style={{ marginTop: 8, padding: 6, background: "rgba(129,199,132,0.1)", border: `1px solid #81c78440`, borderRadius: 4 }}>
              <div style={{ fontSize: 9, color: "#81c784" }}>🌙《アウトドア派》帰還不要 — 現在地で夜を過ごします</div>
            </div>
          )}

          {/* 不夜城: 夜サイクル終了時に深夜サイクル追加（1回限り） */}
          {gs.cycleIdx === 3 && skill?.name === "不夜城" && !pc[PS_ONCE_FLAG] && upd && (
            <div style={{ marginTop: 8 }}>
              <button onClick={() => {
                const motive = pc.resources.やる気?.cur || 0;
                if (motive < 1) return;
                upd(p => ({
                  ...p,
                  pcs: p.pcs.map(x => x.uid !== pc.uid ? x : {
                    ...x, resources: { ...x.resources, やる気: { ...x.resources.やる気, cur: motive - 1 } },
                    [PS_ONCE_FLAG]: true
                  }),
                  log: [`${pc.charName}《不夜城》: やる気1消費して深夜サイクルを追加！`, ...p.log]
                }));
              }} style={btnFull("rgba(129,199,132,0.15)", "#81c78440", "#81c784", { fontSize: 10 })}>
                🌃《不夜城》深夜サイクルを追加（やる気-1）
              </button>
            </div>
          )}

          {/* ご執心: 導入フェイズ中に絆を獲得 */}
          {gs.sessionPhase === "intro" && skill?.name === "ご執心" && !pc[PS_ONCE_FLAG] && (
            <div style={{ marginTop: 8 }}>
              <button onClick={() => {
                const target = window.prompt("絆を獲得するキャラクター名を入力してください");
                if (!target || !target.trim()) return;
                const bondName = `${target.trim()}への絆`;
                const bonds = [...(pc.bonds || [])];
                if (!bonds.includes(bondName)) bonds.push(bondName);
                onUpdatePc({ ...pc, bonds, bondUsed: { ...(pc.bondUsed || {}), [bondName]: false }, [PS_ONCE_FLAG]: true });
              }} style={btnFull("rgba(255,183,77,0.15)", "#ffb74d40", "#ffb74d", { fontSize: 10 })}>
                💛《ご執心》絆を獲得する
              </button>
            </div>
          )}

          {/* 用意周到: 探索フェイズ開始時に任意アイテム1つ獲得（1回限り） */}
          {gs.sessionPhase === "explore" && skill?.name === "用意周到" && !pc[PS_ONCE_FLAG] && (
            <div style={{ marginTop: 8, padding: 6, background: "rgba(255,183,77,0.08)", border: `1px solid #ffb74d30`, borderRadius: 4 }}>
              <div style={{ fontSize: 9, color: "#ffb74d", marginBottom: 6 }}>🎒《用意周到》アイテム1つを獲得</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                {ITEM_NAMES.filter(n => n !== "妖器").map(itemName => (
                  <button key={itemName} onClick={() => {
                    onUpdatePc({ ...pc,
                      items: { ...pc.items, [itemName]: (pc.items?.[itemName] || 0) + 1 },
                      [PS_ONCE_FLAG]: true
                    });
                  }} style={{ padding: "4px 6px", fontSize: 9, cursor: "pointer", borderRadius: 3, background: "rgba(255,255,255,0.05)", border: `1px solid ${C.border}`, color: C.text }}>
                    {itemName}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {itemModal && <ItemUseModal itemName={itemModal} pc={pc} onConfirm={() => consumeItem(itemModal)} onCancel={() => setItemModal(null)} />}
      {skillModal && skill && <SkillActivateModal skillName={skill.name} skillType={skill.type} desc={skill.desc} onConfirm={activateSkill} onCancel={() => setSkillModal(null)} />}
      {abilityModal && <SkillActivateModal skillName={abilityModal.name} skillType={abilityModal.type} desc={abilityModal.desc} onConfirm={() => activateAbility(abilityModal)} onCancel={() => setAbilityModal(null)} />}
      {abilityItemPick && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilityItemPick(null)}>
          <SpellCard color="#90caf9" title="✦ 好きなアイテムを1つ獲得" style={{ maxWidth: 340, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
              {ITEM_NAMES.map(n => (
                <button key={n} onClick={() => confirmAbilityItem(n)} style={btnFull("rgba(144,202,249,0.12)", "#1565c080", "#90caf9", { fontSize: 11 })}>{n}</button>
              ))}
            </div>
            <button onClick={() => setAbilityItemPick(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
          </SpellCard>
        </div>
      )}
      {abilityCure && (() => {
        // 同スポットのキャラ（変調を持つ者）を対象に取り、変調を1つ除去
        const sameSpot = (gs.pcs || []).filter(x => x.currentSpot === pc.currentSpot && (x.badStatus || []).length > 0);
        const target = abilityCure.targetUid ? gs.pcs.find(x => x.uid === abilityCure.targetUid) : null;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilityCure(null)}>
            <SpellCard color="#90caf9" title={`✦ ${abilityCure.name}`} style={{ maxWidth: 340, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
              {!target ? (
                <div>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>変調を除去する対象（同スポット）を選択</div>
                  {sameSpot.length === 0 ? (
                    <div style={{ fontSize: 10, color: C.textFaint, textAlign: "center", padding: "6px 0" }}>同スポットに変調を持つキャラがいません</div>
                  ) : (
                    <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                      {sameSpot.map(x => (
                        <button key={x.uid} onClick={() => setAbilityCure({ ...abilityCure, targetUid: x.uid })} style={btnFull("rgba(144,202,249,0.1)", "#1565c080", "#90caf9", { fontSize: 11 })}>
                          {x.charName}（{(x.badStatus || []).join("・")}）
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>{target.charName} の除去する変調を選択</div>
                  <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                    {(target.badStatus || []).map(bs => (
                      <button key={bs} onClick={() => confirmCure(target.uid, bs)} style={btnFull("rgba(224,112,96,0.12)", C.redBorder, C.red, { fontSize: 11 })}>《{bs}》を除去</button>
                    ))}
                  </div>
                </div>
              )}
              <button onClick={() => setAbilityCure(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
            </SpellCard>
          </div>
        );
      })()}
      {abilityRefresh && (() => {
        // 使用済み応援欄（bondUsed===true）を持つキャラ → その絆を選んで解除
        const usedOf = (x) => (x.bonds || []).filter(b => x.bondUsed?.[b]);
        const candidates = (gs.pcs || []).filter(x => usedOf(x).length > 0);
        const target = abilityRefresh.targetUid ? gs.pcs.find(x => x.uid === abilityRefresh.targetUid) : null;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilityRefresh(null)}>
            <SpellCard color="#90caf9" title={`✦ ${abilityRefresh.name}`} style={{ maxWidth: 340, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
              {!target ? (
                <div>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>応援欄を解除する対象（使用済み絆を持つキャラ）を選択</div>
                  {candidates.length === 0 ? (
                    <div style={{ fontSize: 10, color: C.textFaint, textAlign: "center", padding: "6px 0" }}>使用済み応援欄を持つキャラがいません</div>
                  ) : (
                    <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                      {candidates.map(x => (
                        <button key={x.uid} onClick={() => setAbilityRefresh({ ...abilityRefresh, targetUid: x.uid })} style={btnFull("rgba(144,202,249,0.1)", "#1565c080", "#90caf9", { fontSize: 11 })}>{x.charName}</button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>{target.charName} の解除する応援欄を選択</div>
                  <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                    {usedOf(target).map(b => (
                      <button key={b} onClick={() => confirmRefresh(target.uid, b)} style={btnFull("rgba(200,160,64,0.12)", C.goldDim, C.gold, { fontSize: 11 })}>《{b}》（■→□）</button>
                    ))}
                  </div>
                </div>
              )}
              <button onClick={() => setAbilityRefresh(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
            </SpellCard>
          </div>
        );
      })()}
      {abilityMove && (() => {
        // 同スポットの他キャラを連れる対象として選び、移動先を決める
        const sameSpot = (gs.pcs || []).filter(x => x.uid !== pc.uid && x.currentSpot === pc.currentSpot);
        const toggle = (uid) => setAbilityMove(m => ({ ...m, selected: m.selected.includes(uid) ? m.selected.filter(u => u !== uid) : [...m.selected, uid] }));
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilityMove(null)}>
            <SpellCard color="#90caf9" title={`✦ ${abilityMove.name}`} style={{ maxWidth: 360, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 6 }}>連れて移動するキャラ（同スポット）を選択</div>
              {sameSpot.length === 0
                ? <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 8 }}>同スポットに他のキャラがいません</div>
                : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                    {sameSpot.map(x => {
                      const on = abilityMove.selected.includes(x.uid);
                      return <button key={x.uid} onClick={() => toggle(x.uid)} style={btnFull(on ? "rgba(144,202,249,0.25)" : "rgba(255,255,255,0.04)", on ? "#1565c0" : C.border, on ? "#90caf9" : C.textDim, { fontSize: 10, padding: "4px 8px" })}>{on ? "✓ " : ""}{x.charName}</button>;
                    })}
                  </div>
                )}
              {abilityMove.params?.selfOptional && (
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: C.textDim, marginBottom: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={abilityMove.moveSelf} onChange={e => setAbilityMove(m => ({ ...m, moveSelf: e.target.checked }))} />
                  自分も移動する
                </label>
              )}
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 6 }}>移動先のスポットを選択</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 10, maxHeight: 200, overflowY: "auto" }}>
                {(SPOTS || []).map(s => (
                  <button key={s.id} onClick={() => confirmPartyMove(s.id)} style={btnFull(s.id === pc.currentSpot ? "rgba(255,255,255,0.02)" : "rgba(144,202,249,0.1)", s.id === pc.currentSpot ? C.border : "#1565c080", s.id === pc.currentSpot ? C.textFaint : "#90caf9", { fontSize: 10, padding: "5px 6px" })}>{s.name}</button>
                ))}
              </div>
              <button onClick={() => setAbilityMove(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
            </SpellCard>
          </div>
        );
      })()}
      {abilitySurprise && (() => {
        const sameSpot = (gs.pcs || []).filter(x => x.uid !== pc.uid && x.currentSpot === pc.currentSpot);
        const target = abilitySurprise.targetUid ? gs.pcs.find(x => x.uid === abilitySurprise.targetUid) : null;
        const declareX = abilitySurprise.params?.declareX;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilitySurprise(null)}>
            <SpellCard color="#90caf9" title={`✦ ${abilitySurprise.name}`} style={{ maxWidth: 340, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>対象（同スポットの他キャラ）を選択</div>
              {sameSpot.length === 0 ? (
                <div style={{ fontSize: 10, color: C.textFaint, textAlign: "center", padding: "6px 0" }}>同スポットに他のキャラがいません</div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
                  {sameSpot.map(x => {
                    const on = abilitySurprise.targetUid === x.uid;
                    return <button key={x.uid} onClick={() => setAbilitySurprise(s => ({ ...s, targetUid: x.uid }))} style={btnFull(on ? "rgba(144,202,249,0.25)" : "rgba(255,255,255,0.04)", on ? "#1565c0" : C.border, on ? "#90caf9" : C.textDim, { fontSize: 10, padding: "4px 8px" })}>{on ? "✓ " : ""}{x.charName}</button>;
                  })}
                </div>
              )}
              {declareX && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4 }}>目標値 X（3〜6）を宣言</div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {[3, 4, 5, 6].map(n => (
                      <button key={n} onClick={() => setAbilitySurprise(s => ({ ...s, x: n }))} style={btnFull(abilitySurprise.x === n ? "rgba(255,213,79,0.2)" : "rgba(255,255,255,0.04)", abilitySurprise.x === n ? C.goldDim : C.border, abilitySurprise.x === n ? C.gold : C.textDim, { fontSize: 11, padding: "5px 0" })}>{n}</button>
                    ))}
                  </div>
                </div>
              )}
              <button disabled={!target} onClick={runSurprise} style={{ width: "100%", padding: "8px", marginBottom: 6, cursor: target ? "pointer" : "default", borderRadius: 2, background: target ? C.blueBg : "rgba(255,255,255,0.03)", border: `1px solid ${target ? C.blueBorder : C.border}`, color: target ? C.blue : C.textFaint, fontSize: 12 }}>
                🎲 2D:{declareX ? abilitySurprise.x : 4} で判定する
              </button>
              <button onClick={() => setAbilitySurprise(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
            </SpellCard>
          </div>
        );
      })()}
      {abilitySpend && (() => {
        const owned = ITEM_NAMES.filter(n => (pc.items?.[n] || 0) > 0);
        const allowChoice = abilitySpend.params?.allowChoice;
        const n = abilitySpend.params?.randomCount || 2;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilitySpend(null)}>
            <SpellCard color="#90caf9" title={`✦ ${abilitySpend.name}`} style={{ maxWidth: 340, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
              {!abilitySpend.spendItem ? (
                <div>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>失うアイテムを1つ選択</div>
                  {owned.length === 0 ? (
                    <div style={{ fontSize: 10, color: C.textFaint, textAlign: "center", padding: "6px 0" }}>失えるアイテムがありません</div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
                      {owned.map(it => (
                        <button key={it} onClick={() => setAbilitySpend(s => ({ ...s, spendItem: it, ...(s.params?.swapOnly ? { mode: "choice" } : {}) }))} style={btnFull("rgba(224,112,96,0.1)", C.redBorder, C.red, { fontSize: 11 })}>{it}（{pc.items[it]}）</button>
                      ))}
                    </div>
                  )}
                </div>
              ) : abilitySpend.mode === "choice" ? (
                <div>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>【{abilitySpend.spendItem}】を失い、好きなアイテムを1つ獲得</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
                    {ITEM_NAMES.map(it => (
                      <button key={it} onClick={() => runSpendChoice(it)} style={btnFull("rgba(144,202,249,0.12)", "#1565c080", "#90caf9", { fontSize: 11 })}>{it}</button>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 10 }}>【{abilitySpend.spendItem}】を失って獲得方法を選択</div>
                  <button onClick={runSpendRandom} style={{ ...btnFull(C.goldBg, C.goldDim, C.gold, { fontSize: 11 }), marginBottom: 6 }}>🎲 ランダムに{n}つ獲得</button>
                  {allowChoice && (
                    <button onClick={() => setAbilitySpend(s => ({ ...s, mode: "choice" }))} style={{ ...btnFull("rgba(144,202,249,0.12)", "#1565c080", "#90caf9", { fontSize: 11 }), marginBottom: 6 }}>好きなアイテムを1つ獲得</button>
                  )}
                </div>
              )}
              <button onClick={() => setAbilitySpend(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
            </SpellCard>
          </div>
        );
      })()}
      {abilityDestroy && (() => {
        const target = abilityDestroy.targetUid ? gs.pcs.find(x => x.uid === abilityDestroy.targetUid) : null;
        const ownedItems = target ? ITEM_NAMES.filter(it => (target.items?.[it] || 0) > 0) : [];
        const cats = target ? [
          ["タグ", target.tags || []],
          ["変調", target.badStatus || []],
          ["アイテム", ownedItems],
        ].filter(([, arr]) => arr.length > 0) : [];
        const curList = abilityDestroy.category === "タグ" ? (target?.tags || [])
          : abilityDestroy.category === "変調" ? (target?.badStatus || [])
          : abilityDestroy.category === "アイテム" ? ownedItems : [];
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilityDestroy(null)}>
            <SpellCard color={C.red} title={`✦ ${abilityDestroy.name}`} style={{ maxWidth: 340, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
              {!target ? (
                <div>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>破壊する対象キャラを選択</div>
                  <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                    {(gs.pcs || []).filter(x => !x.untargetable).map(x => (
                      <button key={x.uid} onClick={() => setAbilityDestroy(d => ({ ...d, targetUid: x.uid }))} style={btnFull("rgba(224,112,96,0.1)", C.redBorder, C.red, { fontSize: 11 })}>{x.charName}</button>
                    ))}
                  </div>
                </div>
              ) : !abilityDestroy.category ? (
                <div>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>{target.charName} の破壊するカテゴリを選択</div>
                  {cats.length === 0 ? (
                    <div style={{ fontSize: 10, color: C.textFaint, textAlign: "center", padding: "6px 0" }}>破壊できる対象がありません</div>
                  ) : (
                    <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                      {cats.map(([cat, arr]) => (
                        <button key={cat} onClick={() => setAbilityDestroy(d => ({ ...d, category: cat }))} style={btnFull("rgba(224,112,96,0.1)", C.redBorder, C.red, { fontSize: 11 })}>{cat}（{arr.length}）</button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>{target.charName} の{abilityDestroy.category}から破壊するものを選択</div>
                  <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                    {curList.map(v => (
                      <button key={v} onClick={() => confirmDestroy(target.uid, abilityDestroy.category, v)} style={btnFull("rgba(224,112,96,0.12)", C.redBorder, C.red, { fontSize: 11 })}>《{v}》を破壊</button>
                    ))}
                  </div>
                </div>
              )}
              <button onClick={() => setAbilityDestroy(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
            </SpellCard>
          </div>
        );
      })()}
      {abilityReturn && (() => {
        const others = (gs.pcs || []).filter(x => x.uid !== pc.uid);
        const toggle = (uid) => setAbilityReturn(m => ({ ...m, selected: m.selected.includes(uid) ? m.selected.filter(u => u !== uid) : [...m.selected, uid] }));
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilityReturn(null)}>
            <SpellCard color="#90caf9" title={`✦ ${abilityReturn.name}`} style={{ maxWidth: 360, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 6 }}>一緒に帰還先を変えるPC（自分は常に対象）を選択</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                {others.map(x => {
                  const on = abilityReturn.selected.includes(x.uid);
                  return <button key={x.uid} onClick={() => toggle(x.uid)} style={btnFull(on ? "rgba(144,202,249,0.25)" : "rgba(255,255,255,0.04)", on ? "#1565c0" : C.border, on ? "#90caf9" : C.textDim, { fontSize: 10, padding: "4px 8px" })}>{on ? "✓ " : ""}{x.charName}</button>;
                })}
              </div>
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 6 }}>帰還先のスポットを選択{abilityReturn.params?.yarukiSkip ? "（夜のやる気減少なし）" : ""}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 10, maxHeight: 200, overflowY: "auto" }}>
                {(SPOTS || []).map(s => (
                  <button key={s.id} onClick={() => confirmReturn(s.id)} style={btnFull("rgba(144,202,249,0.1)", "#1565c080", "#90caf9", { fontSize: 10, padding: "5px 6px" })}>{s.name}</button>
                ))}
              </div>
              <button onClick={() => setAbilityReturn(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
            </SpellCard>
          </div>
        );
      })()}
      {abilityScenePick && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilityScenePick(null)}>
          <SpellCard color="#90caf9" title={`✦ ${abilityScenePick.name}`} style={{ maxWidth: 340, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>もう一度シーンを行えるようにするPCを選択</div>
            <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
              {(gs.pcs || []).map(x => (
                <button key={x.uid} onClick={() => confirmScenePick(x.uid)} style={btnFull("rgba(144,202,249,0.1)", "#1565c080", "#90caf9", { fontSize: 11 })}>{x.charName}{(gs.actedPcs || []).includes(x.uid) ? "（行動済み）" : ""}</button>
              ))}
            </div>
            <button onClick={() => setAbilityScenePick(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
          </SpellCard>
        </div>
      )}
      {abilityBoost && (() => {
        const sameSpot = (gs.pcs || []).filter(x => x.uid !== pc.uid && x.currentSpot === pc.currentSpot && !x.untargetable);
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilityBoost(null)}>
            <SpellCard color="#90caf9" title={`✦ ${abilityBoost.name}`} style={{ maxWidth: 340, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>やる気を+{abilityBoost.amount}する同スポットのPCを選択</div>
              {sameSpot.length === 0 ? (
                <div style={{ fontSize: 10, color: C.textFaint, textAlign: "center", padding: "6px 0" }}>同スポットに他のPCがいません</div>
              ) : (
                <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                  {sameSpot.map(x => (
                    <button key={x.uid} onClick={() => confirmBoost(x.uid)} style={btnFull("rgba(144,202,249,0.1)", "#1565c080", "#90caf9", { fontSize: 11 })}>{x.charName}</button>
                  ))}
                </div>
              )}
              <button onClick={() => setAbilityBoost(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
            </SpellCard>
          </div>
        );
      })()}
      {abilitySearchClue && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilitySearchClue(null)}>
          <SpellCard color={C.gold} title={`✦ ${abilitySearchClue.name}`} style={{ maxWidth: 360, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>手がかりを配置するスポットを選択</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 10, maxHeight: 220, overflowY: "auto" }}>
              {(SPOTS || []).filter(s => s.id !== "dream").map(s => (
                <button key={s.id} onClick={() => confirmSearchClue(s.id)} style={btnFull(gs.clues?.includes(s.id) ? "rgba(255,255,255,0.02)" : "rgba(200,160,64,0.12)", gs.clues?.includes(s.id) ? C.border : C.goldDim, gs.clues?.includes(s.id) ? C.textFaint : C.gold, { fontSize: 10, padding: "5px 6px" })}>{s.name}{gs.clues?.includes(s.id) ? "（有）" : ""}</button>
              ))}
            </div>
            <button onClick={() => setAbilitySearchClue(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
          </SpellCard>
        </div>
      )}
      {abilityReiBoost && (() => {
        const toggle = (uid) => setAbilityReiBoost(m => ({ ...m, selected: m.selected.includes(uid) ? m.selected.filter(u => u !== uid) : [...m.selected, uid] }));
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilityReiBoost(null)}>
            <SpellCard color="#90caf9" title={`✦ ${abilityReiBoost.name}`} style={{ maxWidth: 340, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>{abilityReiBoost.target === "itemSwap" ? "アイテム交換できる対象キャラを選択（複数可）" : `霊力増加を+${abilityReiBoost.amount}する対象キャラを選択（複数可）`}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
                {(gs.pcs || []).map(x => {
                  const on = abilityReiBoost.selected.includes(x.uid);
                  return <button key={x.uid} onClick={() => toggle(x.uid)} style={btnFull(on ? "rgba(144,202,249,0.25)" : "rgba(255,255,255,0.04)", on ? "#1565c0" : C.border, on ? "#90caf9" : C.textDim, { fontSize: 10, padding: "4px 8px" })}>{on ? "✓ " : ""}{x.charName}</button>;
                })}
              </div>
              <button onClick={confirmReiBoost} style={{ ...btnFull(C.blueBg, C.blueBorder, C.blue, { fontSize: 12 }), marginBottom: 6, width: "100%" }}>決定</button>
              <button onClick={() => setAbilityReiBoost(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
            </SpellCard>
          </div>
        );
      })()}
      {abilityFortune && (() => {
        const target = abilityFortune.targetUid ? gs.pcs.find(x => x.uid === abilityFortune.targetUid) : null;
        const candidates = (gs.pcs || []).filter(x => x.uid !== pc.uid && ITEM_NAMES.some(n => (x.items?.[n] || 0) > 0) && !x.untargetable);
        const targetItems = target ? ITEM_NAMES.filter(n => (target.items?.[n] || 0) > 0) : [];
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilityFortune(null)}>
            <SpellCard color="#90caf9" title={`✦ ${abilityFortune.name}`} style={{ maxWidth: 340, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
              {!target ? (
                <div>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>アイテムを消費させる対象を選択</div>
                  {candidates.length === 0 ? (
                    <div style={{ fontSize: 10, color: C.textFaint, textAlign: "center", padding: "6px 0" }}>アイテムを持つ他キャラがいません</div>
                  ) : (
                    <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                      {candidates.map(x => (
                        <button key={x.uid} onClick={() => setAbilityFortune(f => ({ ...f, targetUid: x.uid }))} style={btnFull("rgba(144,202,249,0.1)", "#1565c080", "#90caf9", { fontSize: 11 })}>{x.charName}</button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>{target.charName} の消費するアイテムを選択（効果は自分に適用）</div>
                  <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                    {targetItems.map(it => (
                      <button key={it} onClick={() => confirmFortune(target.uid, it)} style={btnFull("rgba(144,202,249,0.12)", "#1565c080", "#90caf9", { fontSize: 11 })}>{it}（{target.items[it]}）— {ITEM_DATA[it]?.desc?.slice(0, 16)}…</button>
                    ))}
                  </div>
                </div>
              )}
              <button onClick={() => setAbilityFortune(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
            </SpellCard>
          </div>
        );
      })()}
      {abilityBoundary && (() => {
        const dests = abilityBoundary.mustBase
          ? (SPOTS || []).filter(s => s.id === (pc.baseSpotId || "11"))
          : (SPOTS || []).filter(s => s.id !== "dream");
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilityBoundary(null)}>
            <SpellCard color="#90caf9" title={`✦ ${abilityBoundary.name}`} style={{ maxWidth: 360, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>{abilityBoundary.mustBase ? "拠点へ移動してアクション" : "移動先のスポットを選択（その後アクション）"}{abilityBoundary.consume ? "（やる気-1）" : ""}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 10, maxHeight: 220, overflowY: "auto" }}>
                {dests.map(s => (
                  <button key={s.id} onClick={() => confirmBoundary(s.id)} style={btnFull("rgba(144,202,249,0.1)", "#1565c080", "#90caf9", { fontSize: 10, padding: "5px 6px" })}>{s.name}</button>
                ))}
              </div>
              <button onClick={() => setAbilityBoundary(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
            </SpellCard>
          </div>
        );
      })()}
      {abilityReadMind && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setAbilityReadMind(null)}>
          <SpellCard color="#ce93d8" title={`✦ ${abilityReadMind.name}`} style={{ maxWidth: 340, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>あなたへの絆を取得したキャラを選択（その相手への絆を取得）</div>
            <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
              {(gs.pcs || []).filter(x => x.uid !== pc.uid).map(x => (
                <button key={x.uid} onClick={() => confirmReadMind(x.uid)} style={btnFull("rgba(206,147,216,0.1)", "#ce93d850", "#ce93d8", { fontSize: 11 })}>{x.charName}</button>
              ))}
            </div>
            <button onClick={() => setAbilityReadMind(null)} style={{ width: "100%", padding: "8px", cursor: "pointer", borderRadius: 2, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.textFaint, fontSize: 12 }}>キャンセル</button>
          </SpellCard>
        </div>
      )}
      {detailModal && <CharDetailModal pc={pc} onClose={() => setDetailModal(false)} />}
    </div>
  );
}

// ─── ActionRenderer (イベント効果実行エンジン) ─────────────────────────
function ActionRenderer({ act, pc, gs, upd, animateDice, SPOTS, getSpot, isDone }) {
  const [selectedLose, setSelectedLose] = useState(null);

  if (isDone) {
    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.3s ease" }}>
        <div style={{ fontSize: 11, color: C.textDim, marginBottom: 12 }}>イベント効果の適用が完了しました</div>
        <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "explore_clue" } }))} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>手がかりの処理へ</button>
      </div>
    );
  }

  if (!act) return null;

  const proceed = (logs =[], extraUpdates = {}) => {
    setSelectedLose(null);
    upd(p => {
      const newPcs = p.pcs.map(x => {
        if (x.uid !== pc.uid) return x;
        const base = { ...x };
        if (extraUpdates.pc) {
          if (extraUpdates.pc.resources) base.resources = { ...base.resources, ...extraUpdates.pc.resources };
          if (extraUpdates.pc.items) {
            const sumQty = m => Object.values(m || {}).reduce((s, v) => s + (typeof v === "number" ? v : 1), 0);
            const oldQty = sumQty(base.items);
            base.items = { ...base.items, ...extraUpdates.pc.items };
            const gained = Math.max(0, sumQty(base.items) - oldQty);
            if (gained > 0) { const ca = base.ach || {}; base.ach = { ...ca, items: (ca.items || 0) + gained }; }
          }
          if (extraUpdates.pc.badStatus) base.badStatus = extraUpdates.pc.badStatus;
          if (extraUpdates.pc.bonds) {
            // 新規に獲得した絆は応援欄を未使用にする（再獲得=リフレッシュは handleBond 側で処理）
            const newBonds = extraUpdates.pc.bonds.filter(b => !(x.bonds || []).includes(b));
            base.bonds = extraUpdates.pc.bonds;
            if (newBonds.length > 0) {
              base.bondUsed = { ...(base.bondUsed || {}) };
              newBonds.forEach(b => { base.bondUsed[b] = false; });
            }
          }
          if (extraUpdates.pc.bondUsed) base.bondUsed = { ...(base.bondUsed || {}), ...extraUpdates.pc.bondUsed };
          if (extraUpdates.pc.tags) base.tags = extraUpdates.pc.tags;
          if (extraUpdates.pc.flags) base.flags = { ...base.flags, ...extraUpdates.pc.flags };
          if (extraUpdates.pc.currentSpot) {
            base.currentSpot = extraUpdates.pc.currentSpot;
            const ca = base.ach || {};
            // 通常移動（境界などの能力移動は confirmBoundary 等で別計上）。normalMoves は #8 用
            base.ach = { ...ca, moved: true, normalMoves: (ca.normalMoves || 0) + 1, spots: achAddTo(ca, "spots", extraUpdates.pc.currentSpot) };
          }
        }
        if (extraUpdates.achInc) base.ach = extraUpdates.achInc({ ...(base.ach || {}) });
        return base;
      });
      // 交流（他者への絆の新規獲得）を検出 → 特別な絆の親密度 +1D6（acting pc を対象に持つ保持者）
      const acquiredKouryu = extraUpdates.pc?.bonds && extraUpdates.pc.bonds.some(b => !(pc.bonds || []).includes(b) && !b.includes("自身への絆"));
      let finalPcs = newPcs, intimacyLogs = [];
      if (acquiredKouryu) {
        const r = gainIntimacy(newPcs, pc.uid, Math.ceil(Math.random() * 6), `${pc.charName}の交流`);
        finalPcs = r.pcs; intimacyLogs = r.logs;
      }
      const p2 = (extraUpdates.pc || acquiredKouryu) ? { ...p, pcs: finalPcs } : p;
      const p3 = extraUpdates.gs ? { ...p2, ...extraUpdates.gs } : p2;
      return {
        ...p3,
        currentScene: { ...p3.currentScene, currentActionIndex: (p3.currentScene.currentActionIndex || 0) + 1 },
        log:[...intimacyLogs, ...logs.reverse(), ...p3.log]
      };
    });
  };

  // 1. GAIN_REIRYOKU
  if (act.type === "GAIN_REIRYOKU") {
    if (act.amount === "1D6") {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.gold, marginBottom: 8, fontSize: 11 }}>【霊力増加】ダイスを振って回復量を決めます</div>
          <button onClick={() => animateDice(1, "霊力回復", res => {
            const gain = res[0];
            let nextCur = pc.resources.霊力?.cur || 0;
            if (!(pc.badStatus || []).includes("スランプ")) {
              nextCur = Math.min(pc.resources.霊力?.max || 20, nextCur + gain);
            }
            proceed([`${pc.charName} は霊力を ${gain} 点獲得した`], {
              pc: { resources: { ...pc.resources, 霊力: { ...pc.resources.霊力, cur: nextCur }, 攻撃力: { ...pc.resources.攻撃力, cur: 1 + Math.floor(nextCur / 5) } } }
            });
          })} style={btnFull(C.goldBg, C.goldDim, C.gold)}>🎲 1D6 を振る</button>
        </div>
      );
    } else {
      const gain = parseInt(act.amount) || 0;
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.gold, marginBottom: 8, fontSize: 11 }}>【霊力増加】霊力を {gain} 点獲得します</div>
          <button onClick={() => {
            let nextCur = pc.resources.霊力?.cur || 0;
            if (!(pc.badStatus || []).includes("スランプ")) {
              nextCur = Math.min(pc.resources.霊力?.max || 20, nextCur + gain);
            }
            proceed([`${pc.charName} は霊力を ${gain} 点獲得した`], {
              pc: { resources: { ...pc.resources, 霊力: { ...pc.resources.霊力, cur: nextCur }, 攻撃力: { ...pc.resources.攻撃力, cur: 1 + Math.floor(nextCur / 5) } } }
            });
          }} style={btnFull(C.goldBg, C.goldDim, C.gold)}>適用する</button>
        </div>
      );
    }
  }

  // 2. LOSE_REIRYOKU
  if (act.type === "LOSE_REIRYOKU") {
    const lose = parseInt(act.amount) || 0;
    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
        <div style={{ color: C.red, marginBottom: 8, fontSize: 11 }}>【霊力減少】霊力を {lose} 点失います</div>
        <button onClick={() => {
          const nextCur = Math.max(0, (pc.resources.霊力?.cur || 0) - lose);
          proceed([`${pc.charName} は霊力を ${lose} 点失った`], {
            pc: { resources: { ...pc.resources, 霊力: { ...pc.resources.霊力, cur: nextCur }, 攻撃力: { ...pc.resources.攻撃力, cur: 1 + Math.floor(nextCur / 5) } } }
          });
        }} style={btnFull(C.redBg, C.redBorder, C.red)}>適用する</button>
      </div>
    );
  }

  // 3. GAIN_MOTIVE
  if (act.type === "GAIN_MOTIVE") {
    const gain = parseInt(act.amount) || 0;
    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
        <button onClick={() => {
          let nextCur = pc.resources.やる気?.cur || 0;
          if (!(pc.badStatus || []).includes("だるい")) {
            nextCur = Math.min(pc.resources.やる気?.max || 3, nextCur + gain);
          }
          proceed([`${pc.charName} はやる気を ${gain} 点獲得した`], {
            pc: { resources: { ...pc.resources, やる気: { ...pc.resources.やる気, cur: nextCur } } }
          });
        }} style={btnFull(C.goldBg, C.goldDim, C.gold)}>やる気を {gain} 点獲得する</button>
      </div>
    );
  }

  // 4. LOSE_MOTIVE
  if (act.type === "LOSE_MOTIVE") {
    const lose = parseInt(act.amount) || 0;
    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
        <button onClick={() => {
          const nextCur = Math.max(0, (pc.resources.やる気?.cur || 0) - lose);
          proceed([`${pc.charName} はやる気を ${lose} 点失った`], {
            pc: { resources: { ...pc.resources, やる気: { ...pc.resources.やる気, cur: nextCur } } }
          });
        }} style={btnFull(C.redBg, C.redBorder, C.red)}>やる気を {lose} 点失う</button>
      </div>
    );
  }

  // 5. GAIN_ITEM
  if (act.type === "GAIN_ITEM") {
    const count = parseInt(act.count) || 1;
    if (act.item === "random") {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <button onClick={() => animateDice(count, "アイテム獲得", res => {
            // count 個のダイスをそれぞれ振り、各出目に対応するアイテムを1個ずつ獲得する
            const names = res.map(d => ITEM_NAMES[d - 1]);
            const nextItems = { ...pc.items };
            names.forEach(n => { nextItems[n] = (nextItems[n] || 0) + 1; });
            proceed([`${pc.charName} は【${names.join("】【")}】を獲得した`], {
              pc: { items: nextItems }
            });
          })} style={btnFull(C.goldBg, C.goldDim, C.gold)}>🎲 ランダムなアイテムを{count > 1 ? `${count}つ` : ""}獲得</button>
        </div>
      );
    } else if (act.item === "any") {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.gold, marginBottom: 8, fontSize: 11 }}>獲得するアイテムを選んでください</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {ITEM_NAMES.map(itemName => (
              <button key={itemName} onClick={() => {
                proceed([`${pc.charName} は【${itemName}】を ${count} 個獲得した`], {
                  pc: { items: { ...pc.items, [itemName]: (pc.items[itemName] || 0) + count } }
                });
              }} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text)}>{itemName}</button>
            ))}
          </div>
        </div>
      );
    } else {
      // 赤貧: 小銭獲得時に任意アイテムへ変換
      if (act.item === "小銭" && pc.ps?.name === "赤貧") {
        return (
          <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
            <div style={{ color: "#ffb74d", marginBottom: 8, fontSize: 11 }}>《赤貧》【小銭】は失われ、代わりに任意アイテムを1つ獲得します</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
              {ITEM_NAMES.filter(n => n !== "小銭").map(itemName => (
                <button key={itemName} onClick={() => {
                  proceed([`${pc.charName}《赤貧》: 【小銭】→【${itemName}】へ変換して獲得した`], {
                    pc: { items: { ...pc.items, [itemName]: (pc.items[itemName] || 0) + count } }
                  });
                }} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text)}>{itemName}</button>
              ))}
            </div>
          </div>
        );
      }
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <button onClick={() => {
            proceed([`${pc.charName} は【${act.item}】を ${count} 個獲得した`], {
              pc: { items: { ...pc.items, [act.item]: (pc.items[act.item] || 0) + count } }
            });
          }} style={btnFull(C.goldBg, C.goldDim, C.gold)}>【{act.item}】を獲得する</button>
        </div>
      );
    }
  }

  // 6. LOSE_ITEM
  if (act.type === "LOSE_ITEM") {
    const ownedItems = Object.entries(pc.items || {}).filter(([_k, v]) => v > 0).map(([k]) => k);
    if (ownedItems.length === 0) {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.textDim, marginBottom: 8, fontSize: 11 }}>失うアイテムを持っていません</div>
          <button onClick={() => proceed()} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>次へ</button>
        </div>
      );
    }
    
    if (act.item === "all") {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.red, marginBottom: 8, fontSize: 11 }}>すべてのアイテムを失います</div>
          <button onClick={() => {
            proceed([`${pc.charName} は所持しているアイテムを全て失った`], {
              pc: { items: { お酒: 0, 小銭: 0, お守り: 0, Pアイテム: 0, 残機のかけら: 0, スペカのかけら: 0, 妖器: 0 } }
            });
          }} style={btnFull(C.redBg, C.redBorder, C.red)}>適用する</button>
        </div>
      );
    } else if (act.item === "random") {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <button onClick={() => {
            const loseItem = ownedItems[Math.floor(Math.random() * ownedItems.length)];
            proceed([`${pc.charName} は【${loseItem}】を失った`], {
              pc: { items: { ...pc.items, [loseItem]: Math.max(0, pc.items[loseItem] - 1) } }
            });
          }} style={btnFull(C.redBg, C.redBorder, C.red)}>🎲 ランダムにアイテムを失う</button>
        </div>
      );
    } else if (act.item === "any") {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.red, marginBottom: 8, fontSize: 11 }}>失うアイテムを選んでください</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {ownedItems.map(itemName => (
              <button key={itemName} onClick={() => {
                proceed([`${pc.charName} は【${itemName}】を失った`], {
                  pc: { items: { ...pc.items, [itemName]: Math.max(0, pc.items[itemName] - 1) } }
                });
              }} style={btnFull("rgba(192,57,43,0.15)", C.redBorder, C.red)}>{itemName}</button>
            ))}
          </div>
        </div>
      );
    }
  }

  // 7. GAIN_SELECT_ITEM
  if (act.type === "GAIN_SELECT_ITEM") {
    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
        <div style={{ color: C.gold, marginBottom: 8, fontSize: 11 }}>獲得するアイテムを1つ選んでください</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 4 }}>
          {act.select.map(itemName => (
            <button key={itemName} onClick={() => {
              proceed([`${pc.charName} は【${itemName}】を獲得した`], {
                pc: { items: { ...pc.items,[itemName]: (pc.items[itemName] || 0) + 1 } }
              });
            }} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text)}>{itemName}</button>
          ))}
        </div>
      </div>
    );
  }

  // 8. OPTIONAL_TRADE
  if (act.type === "OPTIONAL_TRADE") {
    const ownedItems = Object.entries(pc.items || {}).filter(([_k, v]) => v > 0).map(([k]) => k);
    if (ownedItems.length === 0) {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.textDim, marginBottom: 8, fontSize: 11 }}>交換できるアイテムを持っていません</div>
          <button onClick={() => proceed()} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>次へ</button>
        </div>
      );
    }
    
    if (!selectedLose) {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.text, marginBottom: 8, fontSize: 11 }}>アイテムを手放して交換しますか？</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 8 }}>
            {ownedItems.map(itemName => (
              <button key={itemName} onClick={() => setSelectedLose(itemName)} style={btnFull("rgba(192,57,43,0.15)", C.redBorder, C.red)}>{itemName} を手放す</button>
            ))}
          </div>
          <button onClick={() => proceed()} style={btnFull("rgba(255,255,255,0.05)", C.border, C.textFaint)}>交換しない</button>
        </div>
      );
    }

    if (act.gain === "any") {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.gold, marginBottom: 8, fontSize: 11 }}>【{selectedLose}】と交換で獲得するアイテムを選んでください</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {ITEM_NAMES.map(itemName => (
              <button key={itemName} onClick={() => {
                proceed([`${pc.charName} は【${selectedLose}】を手放し、【${itemName}】を獲得した`], {
                  pc: { items: { ...pc.items, [selectedLose]: Math.max(0, pc.items[selectedLose] - 1), [itemName]: (pc.items[itemName] || 0) + 1 } }
                });
              }} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text)}>{itemName}</button>
            ))}
          </div>
        </div>
      );
    } else if (act.gain === "random") {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <button onClick={() => animateDice(1, "アイテム交換", res => {
            const itemName = ITEM_NAMES[res[0] - 1];
            proceed([`${pc.charName} は【${selectedLose}】を手放し、【${itemName}】を獲得した`], {
              pc: { items: { ...pc.items, [selectedLose]: Math.max(0, pc.items[selectedLose] - 1), [itemName]: (pc.items[itemName] || 0) + 1 } }
            });
          })} style={btnFull(C.goldBg, C.goldDim, C.gold)}>🎲 ランダムなアイテムを獲得する</button>
        </div>
      );
    }
  }

  // 9. GAIN_BAD_STATUS / CURE_BAD_STATUS
  if (act.type === "GAIN_BAD_STATUS") {
    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
        <button onClick={() => animateDice(1, "変調決定", res => {
          const bsName = BAD_STATUS_TABLE[res[0]].name;
          const newBs  = Array.from(new Set([...(pc.badStatus || []), bsName]));
          const nextYaruki = bsName === "だるい" ? 1 : pc.resources.やる気?.cur;
          proceed([`${pc.charName} は変調《${bsName}》を獲得した`], {
            pc: { badStatus: newBs, resources: { ...pc.resources, やる気: { ...pc.resources.やる気, cur: nextYaruki } } }
          });
        })} style={btnFull(C.redBg, C.redBorder, C.red)}>🎲 ランダムな変調を獲得する (1D6)</button>
      </div>
    );
  }

  if (act.type === "CURE_BAD_STATUS") {
    const bs = pc.badStatus || [];
    if (bs.length === 0) {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.textDim, marginBottom: 8, fontSize: 11 }}>回復する変調がありません</div>
          <button onClick={() => proceed()} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>次へ</button>
        </div>
      );
    }
    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
        <div style={{ color: C.gold, marginBottom: 8, fontSize: 11 }}>解除する変調を選んでください</div>
        {bs.map(b => (
          <button key={b} onClick={() => {
            proceed([`${pc.charName} は変調《${b}》を解除した`], {
              pc: { badStatus: pc.badStatus.filter(x => x !== b) }
            });
          }} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text, { marginBottom: 4 })}>《{b}》を解除</button>
        ))}
      </div>
    );
  }

  // 10. STOP_MOVEMENT
  if (act.type === "STOP_MOVEMENT") {
    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
        <div style={{ color: C.red, marginBottom: 8, fontSize: 11 }}>足止めを受けました</div>
        <button onClick={() => {
          proceed([`${pc.charName} は足止めを受けた`], { pc: { flags: { ...pc.flags, stopped: true } } });
        }} style={btnFull(C.redBg, C.redBorder, C.red)}>適用する</button>
      </div>
    );
  }

  // 11. STOP_IF_NO_ITEM
  if (act.type === "STOP_IF_NO_ITEM") {
    const hasItem = Object.values(pc.items || {}).some(v => v > 0);
    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
        <button onClick={() => {
          if (!hasItem) {
            proceed([`${pc.charName} はアイテムを持っていなかったため、足止めを受けた`], { pc: { flags: { ...pc.flags, stopped: true } } });
          } else {
            proceed();
          }
        }} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>アイテムの所持を確認する</button>
      </div>
    );
  }

  // 12. GAIN_BOND
  if (act.type === "GAIN_BOND") {
    if ((pc.badStatus || []).includes("不機嫌")) {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.red, marginBottom: 8, fontSize: 11 }}>変調《不機嫌》のため絆を獲得できません</div>
          <button onClick={() => proceed()} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>次へ</button>
        </div>
      );
    }

    if (act.target === "self") {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <button onClick={() => {
            const selfB = `${pc.charName}への絆`;
            const bonds = Array.from(new Set([...(pc.bonds || []), selfB]));
            proceed([`${pc.charName} は自身への絆を獲得した`], { pc: { bonds, bondUsed: { [selfB]: false } } });
          }} style={btnFull(C.goldBg, C.goldDim, C.gold)}>自身への絆を獲得する</button>
        </div>
      );
    }

    if (act.target === "here") {
      const others = gs.pcs.filter(p => p.uid !== pc.uid && p.currentSpot === pc.currentSpot && !(p.badStatus || []).includes("不機嫌"));
      if (others.length === 0) {
        return (
          <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
            <div style={{ color: C.textDim, marginBottom: 8, fontSize: 11 }}>同じスポットに絆を獲得できるキャラクターがいません</div>
            <button onClick={() => proceed()} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>次へ</button>
          </div>
        );
      }
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.gold, marginBottom: 8, fontSize: 11 }}>絆を獲得するキャラクターを選んでください</div>
          {others.map(o => (
            <button key={o.uid} onClick={() => {
              const newB = `${o.charName || o.name}への絆`;
              const bonds = Array.from(new Set([...(pc.bonds || []), newB]));
              proceed([`${pc.charName} は《${o.charName || o.name}への絆》を獲得した`], { pc: { bonds, bondUsed: { [newB]: false } } });
            }} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text, { marginBottom: 4 })}>
              {o.name}
            </button>
          ))}
        </div>
      );
    }

    if (act.target === "elsewhere") {
      const others = gs.pcs.filter(p => p.uid !== pc.uid && p.currentSpot !== pc.currentSpot && !(p.badStatus || []).includes("不機嫌"));
      if (others.length === 0) {
        return (
          <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
            <div style={{ color: C.textDim, marginBottom: 8, fontSize: 11 }}>他のスポットに絆を獲得できるキャラクターがいません</div>
            <button onClick={() => proceed()} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>次へ</button>
          </div>
        );
      }
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.gold, marginBottom: 8, fontSize: 11 }}>絆を獲得するキャラクターを選んでください</div>
          <select value={selectedLose || ""} onChange={e => setSelectedLose(e.target.value)} style={{ width: "100%", padding: 6, marginBottom: 8, background: "rgba(255,255,255,0.05)", color: C.text }}>
            <option value="">キャラクターを選択...</option>
            {others.map(o => <option key={o.uid} value={o.charName || o.name}>{o.name}</option>)}
          </select>
          <button disabled={!selectedLose} onClick={() => {
            const newB = `${selectedLose}への絆`;
            const bonds = Array.from(new Set([...(pc.bonds || []), newB]));
            proceed([`${pc.charName} は《${selectedLose}への絆》を獲得した`], { pc: { bonds, bondUsed: { [newB]: false } } });
          }} style={btnFull(selectedLose ? C.goldBg : "rgba(255,255,255,0.05)", C.border, selectedLose ? C.gold : C.textFaint)}>獲得する</button>
        </div>
      );
    }

    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
        <button onClick={() => {
          const newB = `${act.target}への絆`;
          const bonds = Array.from(new Set([...(pc.bonds || []), newB]));
          proceed([`${pc.charName} は《${act.target}への絆》を獲得した`], { pc: { bonds, bondUsed: { [newB]: false } } });
        }} style={btnFull(C.goldBg, C.goldDim, C.gold)}>《{act.target}への絆》を獲得する</button>
      </div>
    );
  }

  // 13. LOSE_LIFE
  if (act.type === "LOSE_LIFE") {
    const lose = parseInt(act.amount) || 1;
    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
        <button onClick={() => {
          const nextCur = Math.max(0, (pc.resources.残り人数?.cur || 0) - lose);
          proceed([`${pc.charName} は残り人数を ${lose} 点失った`], {
            pc: { resources: { ...pc.resources, 残り人数: { ...pc.resources.残り人数, cur: nextCur } } }
          });
        }} style={btnFull(C.redBg, C.redBorder, C.red)}>残り人数を {lose} 点失う</button>
      </div>
    );
  }

  // 14. MOVE
  if (act.type === "MOVE") {
    if (act.spot === "adjacent") {
      const adjacentIds = EDGES.filter(([a, b]) => a === pc.currentSpot || b === pc.currentSpot).map(([a, b]) => a === pc.currentSpot ? b : a);
      const candidates = SPOTS.filter(s => adjacentIds.includes(s.id));
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.gold, marginBottom: 8, fontSize: 11 }}>移動先（隣接スポット）を選んでください</div>
          {candidates.map(s => (
            <button key={s.id} onClick={() => {
              proceed([`${pc.charName} は [${s.name}] に移動した`], { pc: { currentSpot: s.id } });
            }} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text, { marginBottom: 4 })}>[{s.roll}] {s.name}</button>
          ))}
        </div>
      );
    }

    if (act.spot === "random") {
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <button onClick={() => animateDice(2, "ランダム移動", res => {
            const nextSpotId = getSpotByD66(res[0], res[1], SPOTS);
            if (nextSpotId) {
              proceed([`${pc.charName} は[${getSpot(nextSpotId)?.name}] に移動した`], { pc: { currentSpot: nextSpotId } });
            } else {
              proceed(["(移動先が見つからなかった)"]);
            }
          })} style={btnFull(C.goldBg, C.goldDim, C.gold)}>🎲 ランダムなスポットへ移動</button>
        </div>
      );
    }
    
    if (act.spot === "base_or_any") {
      if (pc.baseSpotId === "dream") {
        return (
          <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
            <div style={{ color: C.gold, marginBottom: 8, fontSize: 11 }}>拠点が夢の世界のため、任意の場所に移動します</div>
            <select 
              value={selectedLose || ""} 
              onChange={e => setSelectedLose(e.target.value)} 
              style={{ width: "100%", padding: 6, marginBottom: 8, background: "rgba(255,255,255,0.05)", color: C.text }}
            >
              <option value="">移動先を選択...</option>
              {SPOTS.filter(s => s.id !== "dream").map(s => (
                <option key={s.id} value={s.id}>[{s.roll}] {s.name}</option>
              ))}
            </select>
            <button 
              disabled={!selectedLose} 
              onClick={() => {
                proceed([`${pc.charName} は[${getSpot(selectedLose)?.name}] に移動した`], { pc: { currentSpot: selectedLose } });
              }} 
              style={btnFull(selectedLose ? C.goldBg : "rgba(255,255,255,0.05)", C.border, selectedLose ? C.gold : C.textFaint)}
            >
              移動する
            </button>
          </div>
        );
      } else {
        return (
          <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
            <button onClick={() => {
              proceed([`${pc.charName} は拠点に移動した`], { pc: { currentSpot: pc.baseSpotId } });
            }} style={btnFull(C.goldBg, C.goldDim, C.gold)}>拠点に移動する</button>
          </div>
        );
      }
    }

    if (act.spot === "pc") {
      const others = gs.pcs.filter(p => p.uid !== pc.uid);
      if (others.length === 0) {
        return (
          <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
            <div style={{ color: C.textDim, marginBottom: 8, fontSize: 11 }}>移動できるPCがいません</div>
            <button onClick={() => proceed()} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>次へ</button>
          </div>
        );
      }
      return (
        <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
          <div style={{ color: C.gold, marginBottom: 8, fontSize: 11 }}>移動先のPCを選んでください</div>
          {others.map(o => (
            <button key={o.uid} onClick={() => {
              const extraPc = { currentSpot: o.currentSpot };
              if (act.gainBond && !(pc.badStatus || []).includes("不機嫌") && !(o.badStatus || []).includes("不機嫌")) {
                const newB = `${o.charName || o.name}への絆`;
                extraPc.bonds = Array.from(new Set([...(pc.bonds || []), newB]));
                extraPc.bondUsed = { [newB]: false };
              }
              proceed([`${pc.charName} は ${o.name} のいるスポットへ移動した`], { pc: extraPc });
            }} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text, { marginBottom: 4 })}>
              {o.name}
            </button>
          ))}
        </div>
      );
    }
  }

  // 15. GAIN_SPELL
  if (act.type === "GAIN_SPELL") {
    const gain = parseInt(act.amount) || 1;
    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
        <button onClick={() => {
          let nextCur = pc.resources.スペルカード?.cur || 0;
          nextCur = Math.min(pc.resources.スペルカード?.max || 5, nextCur + gain);
          proceed([`${pc.charName} はスペルカードを ${gain} 点獲得した`], {
            pc: { resources: { ...pc.resources, スペルカード: { ...pc.resources.スペルカード, cur: nextCur } } }
          });
        }} style={btnFull(C.goldBg, C.goldDim, C.gold)}>スペルカードを {gain} 点獲得する</button>
      </div>
    );
  }

  // 16. GAIN_TAG
  if (act.type === "GAIN_TAG") {
    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
        <button onClick={() => {
          proceed([`${pc.charName} はセッション中《${act.tag}》のタグを得た`], {
            pc: { tags: Array.from(new Set([...(pc.tags || []), act.tag])) }
          });
        }} style={btnFull(C.goldBg, C.goldDim, C.gold)}>タグ《{act.tag}》を獲得する</button>
      </div>
    );
  }

  // 17. GAIN_CLUE
  if (act.type === "GAIN_CLUE") {
    return (
      <div style={{ textAlign: "center", animation: "fadeUp 0.2s ease" }}>
        <button onClick={() => animateDice(2, "手がかり配置", res => {
          const nextSpotId = getSpotByD66(res[0], res[1], SPOTS);
          if (nextSpotId) {
            const newClues = Array.from(new Set([...(gs.clues || []), nextSpotId]));
            proceed([`手がかりを【${getSpot(nextSpotId)?.name}】に配置した`], { gs: { clues: newClues, nonSearchCluePlaced: true }, achInc: a => ({ ...a, clues: (a.clues || 0) + 1 }) });
          } else {
            proceed(["(手がかりの配置先が見つからなかった)"]);
          }
        })} style={btnFull(C.goldBg, C.goldDim, C.gold)}>🎲 手がかりを配置する</button>
      </div>
    );
  }

  // フォールバック
  return (
    <div style={{ textAlign: "center" }}>
      <button onClick={() => proceed()} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>次へ (未実装: {act.type})</button>
    </div>
  );
}

// ─── ScenePanel ───────────────────────────────────────────────────
function ScenePanel({ gs, upd, user, isGm, getSpot, animateDice, SPOTS, room }) {
  const sc = gs.currentScene;
  const pc = sc ? gs.pcs.find(p => p.uid === sc.pcUid) : null;
  // フックは無条件に呼ぶ（rules-of-hooks）。実際の sc/pc の有無判定はフック群の後で行う。
  const [fusuiSel, setFusuiSel] = useState(null); // 風水：振り直し対象のダイス添字配列（null=非選択モード）
  const [kyoukiSel, setKyoukiSel] = useState(null); // 狂気：観戦保持者が振り直す対象のダイス添字配列（null=非選択モード）
  const [unmeiSel, setUnmeiSel] = useState(null); // 運命＋：裏返す対象のダイス添字配列（null=非選択モード）
  const [doubutsuSel, setDoubutsuSel] = useState(null); // 動物を導く：観戦保持者が応援で振り直す対象のダイス添字配列
  const [qDoubutsuSel, setQDoubutsuSel] = useState(null); // クエスト版 動物：{ uid, indices } 振り直し対象（判定者別）
  const [shiwoWarp, setShiwoWarp] = useState(false); // 死を操る：ワープ先選択モード
  const [selectedTarget, setSelectedTarget] = useState(""); // quest_penalty: 対象選択（条件付きフックにしないため先頭で宣言）
  if (!sc || !pc) return null;

  const isMyTurn  = pc.uid === user?.uid || isGm;
  // 手下シーン: sc.minionId があるとシーンの「位置」は手下のスポット。効果(霊力/絆/手がかり)は所有者pcが受ける。
  const sceneMinion = sc.minionId ? (gs.minions || []).find(m => m.id === sc.minionId) : null;
  const sceneSpot = sceneMinion ? sceneMinion.currentSpot : pc.currentSpot;
  const spotDetail = SPOT_DETAILS[sceneSpot] || { tags: [], events:[], desc: "" };
  const myPc = gs.pcs.find(p => p.uid === user?.uid); // 操作中ユーザーのPC（観戦者能力の判定用）

  const writeLog = msg => upd(p => ({ ...p, log: [msg, ...p.log] }));
  // 神仏を見つけ出す（あうん・オート）: シーン終了時、神(＋は巫女/神)タグを持つキャラへの絆のチェック(bondUsed)を解除
  const jinbutsuRefresh = (x) => {
    const abName = getActiveAbility(x)?.name;
    if (abName !== "神仏を見つけ出す程度の能力" && abName !== "神仏を見つけ出す程度の能力＋") return null;
    const wantTags = abName === "神仏を見つけ出す程度の能力＋" ? ["巫女", "神"] : ["神"];
    const charHasTag = (cn) => {
      const t = gs.pcs.find(z => z.charName === cn) || CHARACTERS.find(c => c.name === cn || c.id === cn);
      return (t?.tags || []).some(tag => wantTags.includes(tag));
    };
    const nbu = { ...(x.bondUsed || {}) };
    let changed = false;
    (x.bonds || []).forEach(b => { const m = b.match(/^(.+)への絆$/); if (m && nbu[b] && charHasTag(m[1])) { nbu[b] = false; changed = true; } });
    return changed ? nbu : null;
  };

  const endScene = () => upd(p => {
    const scenePc = p.pcs.find(x => x.uid === pc.uid);
    const lives = scenePc?.resources?.残り人数?.cur ?? 0;
    const jinbutsuBu = jinbutsuRefresh(pc);
    const nextPcs = p.pcs.map(x => {
      if (x.uid !== pc.uid) return x;
      let nx = x;
      if (lives === 0) nx = { ...nx, resources: { ...nx.resources, 残り人数: { ...nx.resources.残り人数, cur: 1 } } };
      if (jinbutsuBu) nx = { ...nx, bondUsed: jinbutsuBu };
      return nx;
    });
    const recoveryLog = lives === 0 ? [`🔵 ${pc.charName} の残り人数が0のため1に回復した`] : [];
    const jinbutsuLog = jinbutsuBu ? [`🔵 ${pc.charName} の《神仏を見つけ出す程度の能力》：神タグへの絆の応援欄を解除`] : [];
    return {
      ...p,
      pcs: nextPcs,
      actedPcs: [...(p.actedPcs || []), pc.uid],
      currentScene: null,
      log: [`${pc.charName} のシーンを終了した`, ...jinbutsuLog, ...recoveryLog, ...p.log]
    };
  });

  // 無意識を操る程度の能力（オート）: シーン終了時に隣接スポットへ移動してから終了する
  const endSceneAfterMove = (destSpot) => upd(p => {
    const scenePc = p.pcs.find(x => x.uid === pc.uid);
    const lives = scenePc?.resources?.残り人数?.cur ?? 0;
    const nextPcs = p.pcs.map(x => {
      if (x.uid !== pc.uid) return x;
      let nx = { ...x, currentSpot: destSpot };
      if (lives === 0) nx = { ...nx, resources: { ...nx.resources, 残り人数: { ...nx.resources.残り人数, cur: 1 } } };
      return nx;
    });
    const recoveryLog = lives === 0 ? [`🔵 ${pc.charName} の残り人数が0のため1に回復した`] : [];
    return {
      ...p,
      pcs: nextPcs,
      actedPcs: [...(p.actedPcs || []), pc.uid],
      currentScene: null,
      log: [`🌀 ${pc.charName} の《無意識を操る程度の能力》: シーン終了時に [${getSpot(destSpot)?.name}] へ移動`, `${pc.charName} のシーンを終了した`, ...recoveryLog, ...p.log]
    };
  });

  // 隣接スポット（スポットグラフで距離1）を返す
  const adjacentSpots = (spotId) => EDGES.filter(e => e.includes(spotId)).map(e => e[0] === spotId ? e[1] : e[0]);

  // クエスト解決のための弾幕ごっこを開始する。演出判定の有無に関わらず同じ戦闘を立ち上げる。
  const startQuestBattle = q => {
    const enemy = q?.enemy;
    if (!enemy) return;
    const isMassQuest = !!q.massBattle;
    // 集団戦時は enemy + extraEnemies、その場（クエスト場所）にいる全PCが参加する。
    const enemyList = [enemy, ...(isMassQuest ? (q.extraEnemies || []) : [])].filter(Boolean);
    const questLoc = sc.questLocation || pc.currentSpot;
    const massPcUids = gs.pcs.filter(x => x.currentSpot === questLoc).map(x => x.uid);
    upd(p => {
      const stamp = Date.now();
      const npcs = enemyList.map((en, i) => buildBattleNpc(en, `enemy_${i}_${stamp}`)).filter(Boolean);
      const scenePcUid = p.currentScene?.pcUid;
      const participantPcUids = isMassQuest
        ? (massPcUids.length ? massPcUids : [scenePcUid].filter(Boolean))
        : [scenePcUid].filter(Boolean);
      return {
        ...p,
        currentScene: null,
        battle: {
          active: true,
          type: isMassQuest ? "mass" : "normal",
          phase: "setup",
          questId: q.id,
          scenePcUid,
          participantPcUids,
          participants: { npcs },
        },
        log: [
          isMassQuest
            ? `⚖️ クエスト「${q.name}」解決のため集団戦を開始！`
            : `⚖️ クエスト「${q.name}」解決のため弾幕ごっこを開始！`,
          ...p.log,
        ],
      };
    });
  };

  const placeClueWithAnimation = count => {
    animateDice(count * 2, count === 1 ? "手がかり1つ配置" : "手がかり2つ配置", res => {
      upd(p => {
        let newClues = [...(p.clues || [])];
        const logs   =[];
        for (let i = 0; i < count; i++) {
          const d1 = res[i * 2], d2 = res[i * 2 + 1];
          const spotId = getSpotByD66(d1, d2, SPOTS);
          if (spotId) {
            if (!newClues.includes(spotId)) newClues.push(spotId);
            logs.push(`${pc.charName} は手がかりを [${spotId}] ${getSpot(spotId)?.name} に配置した（出目: ${d1}, ${d2}）`);
          }
        }
        return { ...p, clues: newClues, nonSearchCluePlaced: true, currentScene: { ...p.currentScene, phase: "action_done" }, log: [...logs.reverse(), ...p.log] };
      });
    });
  };

  const chooseStay = () => {
    upd(p => {
      const x = p.pcs.find(x => x.uid === pc.uid);
      const r = x.resources.やる気 || { cur: 0, max: 3 };
      const isDebuffed = (x.badStatus || []).includes("だるい");
      const newPcs = p.pcs.map(y =>
        y.uid !== pc.uid ? y
        : isDebuffed ? y
        : { ...y, resources: { ...y.resources, やる気: { ...r, cur: Math.min(r.max, r.cur + 1) } } }
      );
      const logText = isDebuffed
        ? `${pc.charName} はその場にとどまったが、変調《だるい》のためやる気は回復しなかった`
        : `${pc.charName} はその場にとどまり、やる気を1点回復した`;
      return { ...p, pcs: newPcs, currentScene: { ...p.currentScene, phase: "action" }, log:[logText, ...p.log] };
    });
  };

  const chooseMove = () => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "move_roll" } }));

  const rollMoveDice = () => {
    const count = pc.resources.やる気?.cur || 1;
    animateDice(count, "移動ダイス", res => upd(p => ({ ...p, currentScene: { ...p.currentScene, moveDice: res } })));
  };

  const selectMoveDie = val => {
    upd(p => {
      let logAdd = `${pc.charName} は移動ダイスで「${val}」を選んだ`;

      // 手下シーンの移動はハプニングを発生させず通常移動として扱う（手下はタグ等を持たないため）
      if (val === 6 && !sc.minionId) {
        return { ...p, currentScene: { ...p.currentScene, phase: "happening_roll" }, log: [logAdd + "（ハプニング発生！）", ...p.log] };
      }
      let actualVal = val;
      if ((pc.badStatus || []).includes("疲れた")) {
        actualVal = Math.max(0, val - 1);
        logAdd += `（※変調《疲れた》のため移動距離が ${actualVal} に減少）`;
      }
      if (p.newspaper?.roll === 24) {
        actualVal = Math.max(0, actualVal - 1);
        logAdd += `（※新聞[24:雨模様]のため減少）`;
      }
      // 活発: 移動距離+1
      if (pc.ps?.name === "活発") {
        actualVal += 1;
        logAdd += `（《活発》+1スポット）`;
      }
      return { ...p, currentScene: { ...p.currentScene, phase: "move_dest", selectedMoveDie: actualVal }, log: [logAdd, ...p.log] };
    });
  };

  const confirmMove = () => {
    if (!sc.selectedDestSpot) return;
    const dest = sc.selectedDestSpot;
    const sDetail = SPOTS.find(s => s.id === dest);

    // 手下シーン: 移動するのは手下（手下はタグを持たないため新聞ペナルティは適用しない）
    if (sc.minionId) {
      upd(p => ({
        ...p,
        minions: (p.minions || []).map(m => m.id === sc.minionId ? { ...m, currentSpot: dest } : m),
        currentScene: { ...p.currentScene, phase: "action" },
        log: [`手 ${pc.charName} の手下が [${sDetail?.name}] に移動した`, ...p.log],
      }));
      return;
    }

    const isMountain = sDetail?.area === "妖怪の山" && dest !== "22";
    const isHuman = (pc.tags || []).includes("人間");
    const news26 = gs.newspaper?.roll === 26 && isHuman && isMountain;
    const news35 = gs.newspaper?.roll === 35 && dest === gs.newspaper.targetSpot;
    if (news26 || news35) {
      animateDice(1, "霊力減少ペナルティ", res => {
        const dmg = res[0];
        upd(p => {
          const r = pc.resources.霊力 || { cur: 0, max: 20 };
          const nextRei = Math.max(0, r.cur - dmg);
          const pcs = p.pcs.map(x => x.uid === pc.uid ? {
            ...x,
            currentSpot: dest,
            resources: { ...x.resources, 霊力: { ...r, cur: nextRei }, 攻撃力: { ...x.resources.攻撃力, cur: 1 + Math.floor(nextRei / 5) } }
          } : x);
          const reason = news26 ? "《人間》の妖怪の山侵入ペナルティ(新聞26)" : "凶暴化した妖精の襲撃(新聞35)";
          return { ...p, pcs, currentScene: { ...p.currentScene, phase: "action" }, log:[`${pc.charName} は [${sDetail.name}] に移動したが、${reason}で霊力が ${dmg} 点減少した！`, ...p.log] };
        });
      });
    } else {
      upd(p => {
        const pcs   = p.pcs.map(x => x.uid === pc.uid ? { ...x, currentSpot: dest } : x);
        return { ...p, pcs, currentScene: { ...p.currentScene, phase: "action" }, log:[`${pc.charName} は [${sDetail?.name}] に移動した`, ...p.log] };
      });
    }
  };

  const startExplore = () => {
    if (gs.newspaper?.roll === 15 && pc.currentSpot === "15") {
      const r = pc.resources.やる気 || { cur: 0, max: 3 };
      upd(p => {
        const newPcs = p.pcs.map(x => x.uid === pc.uid ? { ...x, resources: { ...x.resources, やる気: { ...r, cur: r.max } } } : x);
        return { ...p, pcs: newPcs, log: [`${pc.charName} は間欠泉地下センターの足湯でやる気をMAXまで回復した！`, ...p.log] };
      });
    }

    const hasTag    = spotDetail.tags.some(t => (pc.tags || []).includes(t) || pc.charName === t || (pc.ps && pc.ps.name === t));
    let diceCount   = 2 + (hasTag ? 1 : 0);
    // 快適な拠点: 自身の拠点にいる場合+1（拠点拡張能力も反映）
    if (pc.ps?.name === "快適な拠点" && isAtBase(pc)) diceCount++;
    // 寂しがり屋: 同スポットに他PCがいる場合+1（弾幕ごっこ以外）
    if (pc.ps?.name === "寂しがり屋" && gs.pcs.some(x => x.uid !== pc.uid && x.currentSpot === pc.currentSpot)) diceCount++;
    // 火＋水＋…を操る程度の能力（オート）: 移動しなかったシーンでは判定ダイス+1（＋は拠点でも）
    {
      const ab = (pc.growthAbilityUnlocked && pc.growthAbility?.name) ? pc.growthAbility : pc.as;
      const didntMove = sc.startSpot != null && pc.currentSpot === sc.startSpot;
      if (ab?.name === "火＋水＋木＋金＋土＋日＋月を操る程度の能力" && didntMove) diceCount++;
      if (ab?.name === "火＋水＋木＋金＋土＋日＋月を操る程度の能力＋" && (didntMove || isAtBase(pc))) diceCount++;
      // 打ち出の小槌を扱う程度の能力（サポート相当・オート扱い）: 弾幕ごっこ以外で判定ダイス+1（代償は低出目ファンブル＝結果画面で判定）
      if (ab?.name === "打ち出の小槌を扱う程度の能力" || ab?.name === "打ち出の小槌を扱う程度の能力＋") diceCount++;
    }
    if ((pc.badStatus || []).includes("怪我")) diceCount = Math.min(2, diceCount);
    
    upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "explore_select", actionDiceCount: diceCount, hasTagBonus: hasTag } }));
  };

  const selectEvent  = ev  => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "explore_roll", selectedEvent: ev } }));
  const rollExplore  = ()  => animateDice(sc.actionDiceCount || 2, "行為判定", res => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "explore_result", actionDice: res } })));

  // ─── 応援システム ───────────────────────────────────────────────
  // 《〇〇への絆》を持つPCは、〇〇が同スポットにいるとき〇〇の行為判定にダイス+1できる。
  // 絆は1度使うと bondUsed[絆名] で消費され、同じ絆を再獲得する処理で回復する。
  // 我儘: 自分の判定なら全ての絆を自身絆として使える。怠け者: 自身絆で自分の判定に応援。
  const getCheerBonds = (cheerer, judgePc) => {
    const usedOf = (b) => cheerer.bondUsed?.[b];
    if (cheerer.uid === judgePc.uid) {
      if (cheerer.ps?.name === "我儘") {
        return (cheerer.bonds || []).filter(b => !usedOf(b));  // 我儘: 全絆を自身絆扱い
      }
      // 自身絆は2形式ある（怠け者=「〇〇自身への絆」/ボーナスアクション=「〇〇への絆」）
      const selfBonds = [`${judgePc.charName}自身への絆`, `${judgePc.charName}への絆`];
      return selfBonds.filter(sb => (cheerer.bonds || []).includes(sb) && !usedOf(sb));
    }
    const bondName = `${judgePc.charName}への絆`;
    return (cheerer.bonds || []).includes(bondName) && !usedOf(bondName) ? [bondName] : [];
  };

  // 魂の弱い所に入り込む程度の能力（オート）: 使用済み（黒い応援欄）の絆でも応援できる。
  // ただしこの応援を行った行為判定が失敗するとファンブルになる（=fragile）。
  const getFragileCheerBonds = (cheerer, judgePc) => {
    if (cheerer.uid === judgePc.uid) return [];
    const name = getActiveAbility(cheerer)?.name;
    if (name !== "魂の弱い所に入り込む程度の能力" && name !== "魂の弱い所に入り込む程度の能力＋") return [];
    const bondName = `${judgePc.charName}への絆`;
    // すでに使用済み（bondUsed）の絆を持つ場合のみ（未使用なら通常応援で出る）
    return ((cheerer.bonds || []).includes(bondName) && cheerer.bondUsed?.[bondName]) ? [bondName] : [];
  };

  // 人を狂わす程度の能力（サポート）: 絆を持たない相手にも応援できる（1フェイズ1回・kuruwasuUsedで近似）。失敗でファンブル。
  const getKuruwasuCheer = (cheerer, judgePc) => {
    if (cheerer.uid === judgePc.uid) return [];
    const name = getActiveAbility(cheerer)?.name;
    if (name !== "人を狂わす程度の能力" && name !== "人を狂わす程度の能力＋") return [];
    const bondName = `${judgePc.charName}への絆`;
    if ((cheerer.bonds || []).includes(bondName)) return [];        // 絆を持つなら通常応援
    if (cheerer.kuruwasuUsed?.[judgePc.uid]) return [];             // この相手には使用済み
    return [KURUWASU_BOND];
  };

  // 特別な絆（成長）による応援: judgePc を対象に持ち、応援欄(used)が空なら応援できる（親密度10で2ダイス）
  const getSpecialBondCheer = (cheerer, judgePc) => {
    const sb = cheerer.specialBond;
    if (!sb || sb.targetUid !== judgePc.uid || cheerer.uid === judgePc.uid || sb.used) return [];
    return [SPECIAL_BOND_CHEER];
  };

  // judgePc の行為判定に対する応援UI。onCheer(cheererUid, bondName, fragile) を渡す。
  const renderCheerSection = (judgePc, onCheer) => {
    const cheers = [];
    (gs.pcs || []).forEach(cheerer => {
      if (cheerer.currentSpot !== judgePc.currentSpot) return;  // 同スポット
      getCheerBonds(cheerer, judgePc).forEach(bondName => cheers.push({ cheerer, bondName, fragile: false }));
      getSpecialBondCheer(cheerer, judgePc).forEach(bondName => cheers.push({ cheerer, bondName, fragile: false }));
      getFragileCheerBonds(cheerer, judgePc).forEach(bondName => cheers.push({ cheerer, bondName, fragile: true }));
      getKuruwasuCheer(cheerer, judgePc).forEach(bondName => cheers.push({ cheerer, bondName, fragile: true }));
    });
    if (cheers.length === 0) return null;
    return (
      <div style={{ marginBottom: 8, padding: 8, background: "rgba(100,181,246,0.08)", border: `1px solid ${C.blueBorder}`, borderRadius: 4 }}>
        <div style={{ fontSize: 9, color: C.blue, marginBottom: 4 }}>💪 応援（絆1つ＝判定ダイス+1）</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {cheers.map(({ cheerer, bondName, fragile }, i) => {
            const isSpecial = bondName === SPECIAL_BOND_CHEER;
            const label = isSpecial ? `《${cheerer.specialBond.target}への${cheerer.specialBond.word || "敬意"}》${(cheerer.specialBond.intimacy ?? 1) >= 10 ? "(+2)" : ""}` : `《${bondName}》`;
            return (
              <button key={i} onClick={() => onCheer(cheerer.uid, bondName, fragile)}
                style={btnFull(isSpecial ? "rgba(255,213,79,0.16)" : fragile ? "rgba(156,39,176,0.15)" : "rgba(100,181,246,0.15)", isSpecial ? C.goldDim : fragile ? C.purpleBorder : C.blueBorder, isSpecial ? C.gold : fragile ? C.purple : C.blue, { width: "auto", fontSize: 9, padding: "3px 8px" })}>
                {fragile ? "🩸" : isSpecial ? "💞" : ""}{cheerer.uid === judgePc.uid ? label : `${cheerer.charName}：${label}`}{fragile ? "(失敗=ファンブル)" : ""}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // 応援者の絆消費フラグ（絆なし応援は kuruwasuUsed[対象]、特別な絆は specialBond.used、通常は bondUsed[絆名]）を返す
  const cheerConsumePatch = (x, bondName) =>
    bondName === KURUWASU_BOND
      ? { kuruwasuUsed: { ...(x.kuruwasuUsed || {}), [pc.uid]: true } }
      : bondName === SPECIAL_BOND_CHEER
      ? { specialBond: { ...x.specialBond, used: true } }
      : { bondUsed: { ...x.bondUsed, [bondName]: true } };

  // 特別な絆の応援ラベル（ログ用）
  const cheerLabel = (cheerer, bondName) =>
    bondName === KURUWASU_BOND ? "絆なしで"
    : bondName === SPECIAL_BOND_CHEER ? `《${cheerer?.specialBond?.target}への${cheerer?.specialBond?.word || "敬意"}》で`
    : `《${bondName}》で`;

  // 応援を1回適用（判定後）：ダイスを振り足して結果のダイス配列に追加する。
  // 特別な絆は親密度10で2ダイス。fragile=失敗時ファンブル
  const applyCheer = (cheererUid, bondName, fragile = false) => {
    const cheerer = gs.pcs.find(x => x.uid === cheererUid);
    const cheererName = cheerer?.charName;
    const diceN = (bondName === SPECIAL_BOND_CHEER && (cheerer?.specialBond?.intimacy ?? 1) >= 10) ? 2 : 1;
    animateDice(diceN, "応援（振り足し）", res => upd(p => ({
      ...p,
      pcs: p.pcs.map(x => x.uid !== cheererUid ? x : { ...x, ...cheerConsumePatch(x, bondName) }),
      currentScene: {
        ...p.currentScene,
        actionDice: [...(p.currentScene.actionDice || []), ...res],
        wasCheered: true,
        ...(fragile ? { fragileCheer: true } : {}),
      },
      log: [`💪 ${cheererName} が${cheerLabel(cheerer, bondName)}応援！ダイスを${diceN}個振り足した（出目${res.join(",")}）${fragile ? "（失敗でファンブル）" : ""}`, ...p.log],
    })));
  };

  const acquireClue = questId => {
    upd(p => {
      const spotId   = sceneSpot; // 手下シーンなら手下のスポット
      const newClues = (p.clues ||[]).filter(c => c !== spotId);

      let resolvedAuto = false;
      let nextQuests = p.quests.map(q => {
        if (String(q.id) === String(questId)) {
          const updatedClues = (q.clues || 0) + 1;
          const isReady = updatedClues >= q.level;
          if (q.solutionType === "自動解決" && isReady) {
            resolvedAuto = true;
            return { ...q, clues: updatedClues, solved: true };
          }
          return { ...q, clues: updatedClues };
        }
        return q;
      });

      if (resolvedAuto) {
        const allScenarioQuests = p.scenarioData?.quests || [];
        allScenarioQuests.forEach(scQ => {
          if (scQ.unlockType === "quest" && String(scQ.unlockQuestId) === String(questId)) {
            if (!nextQuests.find(nq => String(nq.id) === String(scQ.id))) {
              nextQuests.push({ ...scQ, revealed: true, solved: false, clues: 0 });
            }
          }
        });
      }

      const targetQName = nextQuests.find(q => String(q.id) === String(questId))?.name;
      const logMsg = `${pc.charName} は [${spotId}] で手がかりを獲得し、クエスト「${targetQName}」に配置した` + 
        (resolvedAuto ? "。クエストが自動解決されました！" : "");

      return {
        ...p,
        clues: newClues,
        nonSearchCluePlaced: true, // 実績(鼠算式探索): 探し物以外の手がかり配置
        quests: nextQuests,
        currentScene: { ...p.currentScene, phase: "action_done" },
        log: [logMsg, ...p.log]
      };
    });
  };

  const hasClueHere = gs.clues?.includes(sceneSpot);

  const _gainBond = targetName => {
    if ((pc.badStatus || []).includes("不機嫌")) {
      writeLog(`${pc.charName} は変調《不機嫌》のため絆を獲得できなかった`);
      return;
    }
    const targetPc = gs.pcs.find(p => p.charName === targetName);
    if (targetPc && (targetPc.badStatus || []).includes("不機嫌")) {
      writeLog(`${targetName} が変調《不機嫌》のため絆を獲得できなかった`);
      return;
    }

    upd(p => {
      const isMutual = p.newspaper?.roll === 34;
      // 人気者: 絆を獲得した相手もこちらへの絆を取得
      const hasPininkiWar = pc.ps?.name === "人気者";
      const newPcs = p.pcs.map(x => {
        if (x.uid === pc.uid) {
          const bonds = [...(x.bonds || [])];
          if (!bonds.includes(targetName)) bonds.push(targetName);
          return { ...x, bonds };
        }
        if ((isMutual || hasPininkiWar) && x.charName === targetName) {
          const bonds = [...(x.bonds || [])];
          if (!bonds.includes(pc.charName)) bonds.push(pc.charName);
          return { ...x, bonds };
        }
        return x;
      });
      const extra = isMutual ? "（新聞効果で双方向に獲得！）" : hasPininkiWar ? "（《人気者》で相手も絆を獲得！）" : "";
      return { ...p, pcs: newPcs, currentScene: { ...p.currentScene, phase: "action_done" }, log:[`${pc.charName} は《${targetName}への絆》を獲得した${extra}`, ...p.log] };
    });
  };

  return (
    <div style={{ padding: 10, background: "rgba(25,118,210,0.1)", borderBottom: `1px solid ${C.blueBorder}`, flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <CharSprite spriteRow={pc.spriteRow ?? -1} spriteCol={pc.spriteCol ?? -1} size={32} />
        <div>
          <div style={{ fontSize: 10, color: C.blue }}>現在のシーンプレイヤー{sceneMinion && <span style={{ color: "#ce93d8" }}>（手下が代行）</span>}</div>
          <div style={{ fontSize: 13, color: C.text }}>
            {pc.charName}{sceneMinion && <span style={{ color: "#ce93d8" }}> の手下</span>} <span style={{ fontSize: 9, color: C.textFaint }}>@ {getSpot(sceneSpot)?.name}</span>
          </div>
        </div>
      </div>

      {!isMyTurn ? (
        <div style={{ fontSize: 11, color: C.textFaint, textAlign: "center", padding: "8px 0" }}>{pc.charName} の操作を待っています…</div>
      ) : (
        <div>
          {sc.phase === "move_or_stay" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={chooseMove} style={btnFull(C.blueBg,  C.blueBorder,  C.blue)}>移動する（やる気D）</button>
                <button onClick={chooseStay} style={btnFull(C.greenBg, C.greenBorder, C.green)}>とどまる（やる気+1）</button>
              </div>

              {/* 死を操る程度の能力（サポート）: 異世界エリアとそれ以外を行き来するワープ。base=移動の代わり/＋=ワープ後に通常移動 */}
              {(getActiveAbility(pc)?.name === "死を操る程度の能力" || getActiveAbility(pc)?.name === "死を操る程度の能力＋") && (() => {
                const inOther = SPOTS.find(s => s.id === pc.currentSpot)?.area === "異世界";
                const dests = SPOTS.filter(s => inOther ? s.area !== "異世界" : s.area === "異世界");
                const isPlus = getActiveAbility(pc)?.name === "死を操る程度の能力＋";
                return shiwoWarp ? (
                  <div style={{ padding: 6, background: "rgba(156,39,176,0.08)", border: `1px solid ${C.purpleBorder}`, borderRadius: 4 }}>
                    <div style={{ fontSize: 10, color: C.purple, marginBottom: 6 }}>💀 ワープ先（{inOther ? "異世界以外" : "異世界エリア"}）を選択{isPlus ? "（その後 通常移動）" : ""}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                      {dests.map(s => (
                        <button key={s.id} onClick={() => { setShiwoWarp(false); upd(p => ({
                          ...p,
                          pcs: p.pcs.map(x => x.uid !== pc.uid ? x : { ...x, currentSpot: s.id }),
                          currentScene: { ...p.currentScene, phase: isPlus ? "move_roll" : "action" },
                          log: [`💀 ${pc.charName} の《死を操る程度の能力》: [${s.name}] へワープ${isPlus ? "（続けて移動）" : ""}`, ...p.log],
                        })); }} style={btnFull("rgba(156,39,176,0.14)", C.purpleBorder, C.purple, { fontSize: 10 })}>{s.name}</button>
                      ))}
                    </div>
                    <button onClick={() => setShiwoWarp(false)} style={{ ...btnFull("rgba(255,255,255,0.04)", C.border, C.textFaint, { fontSize: 10 }), marginTop: 4 }}>やめる</button>
                  </div>
                ) : (
                  <button onClick={() => setShiwoWarp(true)} style={btnFull("rgba(156,39,176,0.14)", C.purpleBorder, C.purple, { fontSize: 10 })}>💀 死を操る: 異世界エリアへワープ</button>
                );
              })()}

              {/* 坤を創造する程度の能力（諏訪子・サポート）: 人間の里(11)⇔守矢神社(22) の移動。保持者がセッションにいる時に可。 */}
              {(pc.currentSpot === "11" || pc.currentSpot === "22") && gs.pcs.some(x => getActiveAbility(x)?.name === "坤を創造する程度の能力") && (() => {
                const dest = pc.currentSpot === "11" ? "22" : "11";
                return (
                  <button onClick={() => upd(p => ({
                    ...p,
                    pcs: p.pcs.map(x => x.uid !== pc.uid ? x : { ...x, currentSpot: dest }),
                    currentScene: { ...p.currentScene, phase: "action" },
                    log: [`🌐 ${pc.charName}《坤を創造する程度の能力》: [${getSpot(dest)?.name}] へ移動`, ...p.log],
                  }))} style={btnFull("rgba(129,199,132,0.14)", C.greenBorder, C.green, { fontSize: 10 })}>
                    🌐 坤: {getSpot(dest)?.name} へ移動
                  </button>
                );
              })()}

              {/* インドア派: 移動の代わりに拠点へテレポート */}
              {pc.ps?.name === "インドア派" && pc.currentSpot !== pc.baseSpotId && (
                <button onClick={() => upd(p => ({
                  ...p,
                  pcs: p.pcs.map(x => x.uid !== pc.uid ? x : { ...x, currentSpot: pc.baseSpotId }),
                  currentScene: { ...p.currentScene, phase: "action" },
                  log: [`${pc.charName}《インドア派》: 移動の代わりに拠点[${getSpot(pc.baseSpotId)?.name}]へ移動`, ...p.log]
                }))} style={btnFull("rgba(255,183,77,0.15)", "#ffb74d40", "#ffb74d", { fontSize: 10 })}>
                  🏠《インドア派》拠点へ移動
                </button>
              )}

              {/* 能天気: やる気1消費で3スポット移動 */}
              {pc.ps?.name === "能天気" && (pc.resources.やる気?.cur || 0) >= 1 && (
                <button onClick={() => upd(p => ({
                  ...p,
                  pcs: p.pcs.map(x => x.uid !== pc.uid ? x : {
                    ...x, resources: { ...x.resources, やる気: { ...x.resources.やる気, cur: (x.resources.やる気?.cur || 0) - 1 } }
                  }),
                  currentScene: { ...p.currentScene, phase: "move_dest", selectedMoveDie: 3 },
                  log: [`${pc.charName}《能天気》: やる気1消費して3スポット移動`, ...p.log]
                }))} style={btnFull("rgba(255,183,77,0.15)", "#ffb74d40", "#ffb74d", { fontSize: 10 })}>
                  🌈《能天気》3スポット移動（やる気-1）
                </button>
              )}

              {(gs.quests || []).filter(q => !q.solved && q.revealed && (q.clues || 0) >= q.level).map(q => (
                <button 
                  key={q.id} 
                  onClick={() => {
                    const loc = q.location || pc.currentSpot;
                    upd(p => {
                      const newPcs = p.pcs.map(x => x.uid === pc.uid ? { ...x, currentSpot: loc } : x);
                      return {
                        ...p,
                        pcs: newPcs,
                        currentScene: { 
                          ...p.currentScene, 
                          phase: "quest_setup", 
                          questId: q.id,
                          questLocation: loc 
                        },
                        log: [`🎬 ${pc.charName} はクエスト「${q.name}」の解決に向かった！`, ...p.log]
                      };
                    });
                  }}
                  style={btnFull(C.goldBg, C.goldDim, C.gold, { marginTop: 4, fontWeight: "bold" })}
                >
                  ✨ クエストシーン：{q.name}
                </button>
              ))}
            </div>
          )}

          {sc.phase === "move_roll" && !sc.moveDice?.length && (
            <button onClick={rollMoveDice} style={btnFull(C.goldBg, C.goldDim, C.gold)}>🎲 やる気（{pc.resources.やる気?.cur || 1}）個のダイスを振る</button>
          )}
          {sc.phase === "move_roll" && sc.moveDice?.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 6, textAlign: "center" }}>移動する距離の出目を選んでください</div>
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                {sc.moveDice.map((d, i) => (
                  <button key={i} onClick={() => selectMoveDie(d)} style={{ width: 40, height: 40, background: "rgba(14,20,36,0.95)", border: `2px solid ${d === 6 ? C.redBorder : C.border}`, borderRadius: 5, fontSize: 18, color: d === 6 ? C.red : C.blue, cursor: "pointer" }}>{d}</button>
                ))}
              </div>
              {sc.moveDice.includes(6) && (
                <div style={{ fontSize: 10, color: C.red, textAlign: "center", marginTop: 4 }}>※6を選ぶとハプニングが発生します（お守りで回避可能）</div>
              )}
              {/* 距離を操る程度の能力（サポート）: 誰かの移動ダイスをやる気1で振り直す（base=6以外/＋=全部） */}
              {(() => {
                const distName = getActiveAbility(myPc)?.name;
                const isDist = distName === "距離を操る程度の能力" || distName === "距離を操る程度の能力＋";
                if (!isDist || (myPc?.resources?.やる気?.cur || 0) < 1) return null;
                const rerollAll = distName === "距離を操る程度の能力＋";
                const rerollIdx = sc.moveDice.map((d, i) => ({ d, i })).filter(({ d }) => rerollAll || d !== 6).map(({ i }) => i);
                if (rerollIdx.length === 0) return null;
                return (
                  <button onClick={() => animateDice(rerollIdx.length, "距離（移動振り直し）", res => upd(p => {
                    const dice = [...(p.currentScene.moveDice || [])];
                    rerollIdx.forEach((idx, k) => { dice[idx] = res[k]; });
                    const r = myPc.resources.やる気 || { cur: 0, max: 99 };
                    return {
                      ...p,
                      pcs: p.pcs.map(x => x.uid === myPc.uid ? { ...x, resources: { ...x.resources, やる気: { ...r, cur: Math.max(0, r.cur - 1) } } } : x),
                      currentScene: { ...p.currentScene, moveDice: dice },
                      log: [`🎲 ${myPc.charName} の《距離を操る程度の能力》: やる気1で移動ダイス${rerollIdx.length}個を振り直した`, ...p.log],
                    };
                  }))} style={{ ...btnFull("rgba(255,183,77,0.15)", "#ffb74d50", "#ffb74d", { fontSize: 10 }), marginTop: 8 }}>
                    🎲 距離: やる気1で{rerollAll ? "全" : "6以外の"}移動ダイスを振り直す（{myPc.charName}）
                  </button>
                );
              })()}
            </div>
          )}

          {sc.phase === "happening_roll" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 14, color: C.red, marginBottom: 8, fontWeight: "bold" }}>⚠️ ハプニング発生！</div>

              {pc.items?.["お守り"] > 0 && !(pc.badStatus || []).includes("二日酔い") && (
                <button onClick={() => {
                  upd(p => {
                    const nextPc = { ...pc, items: { ...pc.items, お守り: pc.items["お守り"] - 1 } };
                    return {
                      ...p,
                      pcs: p.pcs.map(x => x.uid === pc.uid ? nextPc : x),
                      currentScene: { ...p.currentScene, phase: "move_dest", exactMoveDist: null, selectedMoveDie: 6 },
                      log: [`${pc.charName} はお守りを使用し、ハプニングを無効化して6マス移動を選択した！`, ...p.log]
                    };
                  });
                }} style={{ ...btnFull("rgba(76,175,80,0.15)", C.greenBorder, C.green, { marginBottom: 12 }) }}>
                  🛡️ お守りを使用する（残り: {pc.items["お守り"]}）
                </button>
              )}

              <button onClick={() => animateDice(1, "ハプニング表", res => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "happening_result", happeningDice: res[0] } })))} style={btnFull(C.redBg, C.redBorder, C.red)}>🎲 ハプニング表を振る</button>
            </div>
          )}

          {sc.phase === "happening_result" && (() => {
            const h = {
              1: { title: "仲間が恋しい。", desc: "任意のPC1人を選ぶこと。強制的に選んだPCのいるスポットに移動する。" },
              2: { title: "【拠点】が恋しい。", desc: "強制的にあなたの【拠点】に移動する。" },
              3: { title: "あれ？行き過ぎてしまったかも。", desc: "ダイスを1つ振り、今いるスポットから出目の分だけ離れたスポット1つを選んで移動する。" },
              4: { title: "道に迷ってしまった。", desc: "D66を振って出た目と同じ番号のスポットに移動する。" },
              5: { title: "問題なし。", desc: "今いるスポットから6スポット分離れた距離までにある任意のスポットに移動する。" },
              6: { title: "「あなたは食べてもいい人類？」", desc: "通りがかりの妖怪に襲われた！\n（※今回は「問題なし」と同様に、6マス以内への移動として処理します）" },
            }[sc.happeningDice];
            const proceed = () => {
              const d = sc.happeningDice;
              if (d === 1) {
                const others = gs.pcs.filter(p => p.uid !== pc.uid);
                upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: others.length === 0 ? "action" : "happening_1" } }));
              } else if (d === 2) {
                upd(p => { const pcs = p.pcs.map(x => x.uid === pc.uid ? { ...x, currentSpot: pc.baseSpotId } : x); return { ...p, pcs, currentScene: { ...p.currentScene, phase: "action" }, log:[`${pc.charName} は強制的に拠点へ移動した`, ...p.log] }; });
              } else if (d === 3) {
                upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "happening_3_roll" } }));
              } else if (d === 4) {
                upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "happening_4_roll" } }));
              } else {
                upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "move_dest", selectedMoveDie: 6 } }));
              }
            };
            return (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 22, color: C.gold, marginBottom: 4 }}>[{sc.happeningDice}]</div>
                <div style={{ fontSize: 13, color: C.red, marginBottom: 8 }}>{h.title}</div>
                <div style={{ fontSize: 10, color: C.textDim, whiteSpace: "pre-wrap", marginBottom: 14, lineHeight: 1.5 }}>{h.desc}</div>
                <button onClick={proceed} style={btnFull(C.goldBg, C.goldDim, C.gold)}>この処理を進める</button>
              </div>
            );
          })()}

          {sc.phase === "happening_1" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8 }}>合流するPC（スポット）を選択してください</div>
              {gs.pcs.filter(p => p.uid !== pc.uid).map(other => (
                <button key={other.uid} onClick={() => {
                  upd(p => { const pcs = p.pcs.map(x => x.uid === pc.uid ? { ...x, currentSpot: other.currentSpot } : x); return { ...p, pcs, currentScene: { ...p.currentScene, phase: "action" }, log:[`${pc.charName} は ${other.name} と合流した`, ...p.log] }; });
                }} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text, { marginBottom: 4 })}>
                  {other.name} （{getSpot(other.currentSpot)?.name}）
                </button>
              ))}
            </div>
          )}

          {sc.phase === "happening_3_roll" && (
            <div style={{ textAlign: "center" }}>
              <button onClick={() => animateDice(1, "移動距離", res => {
                upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "move_dest", exactMoveDist: res[0], selectedMoveDie: res[0] } }));
              })} style={btnFull(C.goldBg, C.goldDim, C.gold)}>🎲 距離を振る (1D6)</button>
            </div>
          )}

          {sc.phase === "happening_4_roll" && (
            <div style={{ textAlign: "center" }}>
              <button onClick={() => animateDice(2, "道に迷う", res => {
                const nextSpotId = getSpotByD66(res[0], res[1], SPOTS);
                upd(p => {
                  const newPcs = p.pcs.map(x => x.uid === pc.uid ? { ...x, currentSpot: nextSpotId || x.currentSpot } : x);
                  return { ...p, pcs: newPcs, currentScene: { ...p.currentScene, phase: "action" }, log:[`${pc.charName} は道に迷い [${getSpot(nextSpotId)?.name}] に辿り着いた`, ...p.log] };
                });
              })} style={btnFull(C.goldBg, C.goldDim, C.gold)}>🎲 移動先を振る (D66)</button>
            </div>
          )}

          {sc.phase === "move_dest" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: C.gold, marginBottom: 4, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {isGm && !sc.exactMoveDist && <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, selectedMoveDie: Math.max(0, sc.selectedMoveDie - 1) } }))} style={btnSmall}>-</button>}
                <span>{sc.exactMoveDist ? `【ちょうど ${sc.exactMoveDist} マス移動】` : `【最大 ${sc.selectedMoveDie} マス移動可能】`}</span>
                {isGm && !sc.exactMoveDist && <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, selectedMoveDie: sc.selectedMoveDie + 1 } }))} style={btnSmall}>+</button>}
              </div>
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>マップ上の光っているスポットをクリックしてください。</div>
              {sc.selectedDestSpot ? (
                <div style={{ padding: 8, background: "rgba(200,160,64,0.1)", border: `1px solid ${C.goldDim}`, borderRadius: 4, marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: C.text, marginBottom: 6 }}>選択中: <span style={{ color: C.gold, fontWeight: "bold" }}>{getSpot(sc.selectedDestSpot)?.name}</span></div>
                  <button onClick={confirmMove} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>ここへ移動する</button>
                </div>
              ) : (
                <div style={{ padding: 8, border: `1px dashed ${C.border}`, color: C.textFaint, fontSize: 10, marginBottom: 8 }}>未選択</div>
              )}
              <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "action" } }))} style={{ ...btnFull("none", "none", C.textFaint), fontSize: 10 }}>移動せずにアクションへ進む</button>
            </div>
          )}

          {sc.phase === "action" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button onClick={startExplore} style={btnFull(C.greenBg, C.greenBorder, C.green)}>🔍 探索イベントの実行</button>
              {gs.newspaper?.roll === 13 && pc.currentSpot === "13" && (
                <button onClick={() => {
                  upd(p => {
                    const newPcs = p.pcs.map(x => x.uid === pc.uid ? { ...x, flags: { ...x.flags, kourindouNPC: true } } : x);
                    return { ...p, pcs: newPcs, currentScene: { ...p.currentScene, phase: "action_done" }, log: [`${pc.charName} はアクションを消費し、香霖堂のNPCの応援を取り付けた！`, ...p.log] };
                  });
                }} style={btnFull(C.purpleBg, C.purpleBorder, C.purple)}>🤝 香霖堂の新商品を見る（NPCの応援獲得）</button>
              )}

              {gs.newspaper?.roll === 45 && pc.currentSpot === "45" && !sc.gambleUsed && (
                <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "gamble_select_item" } }))} style={btnFull(C.redBg, C.redBorder, C.red)}>🎲 鬼の賭博に挑戦（アクション消費なし・シーンに1回）</button>
              )}
              {gs.newspaper?.roll === 45 && pc.currentSpot === "45" && sc.gambleUsed && (
                <div style={{ fontSize: 9, color: C.textFaint, textAlign: "center", padding: "4px 0" }}>🎲 鬼の賭博はこのシーンで使用済み</div>
              )}

              <button onClick={() => writeLog(`${pc.charName} はアクションスキルを使用した`)} style={btnFull("rgba(255,255,255,0.05)", C.border, C.textFaint)}>💡 アクションスキルの使用</button>
              <div style={{ marginTop: 8 }}>
                <button onClick={endScene} style={btnFull(C.redBg, C.redBorder, C.red)}>🎬 このシーンを終了する</button>
              </div>
            </div>
          )}

          {sc.phase === "gamble_select_item" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: C.gold, marginBottom: 8 }}>消費するアイテムを選んでください</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center", marginBottom: 12 }}>
                {Object.keys(INIT_ITEMS()).map(k => {
                  if ((pc.items[k] || 0) === 0) return null;
                  return (
                    <button key={k} onClick={() => {
                      upd(p => {
                        const newPcs = p.pcs.map(x => x.uid === pc.uid ? { ...x, items: { ...x.items, [k]: x.items[k] - 1 } } : x);
                        // アイテムを消費した時点で「シーンに1回」を消費したものとする（アクションは消費しない）
                        return { ...p, pcs: newPcs, currentScene: { ...p.currentScene, phase: "gamble_roll", gambleItem: k, gambleDiceCount: 2, gambleUsed: true } };
                      });
                    }} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text, { width: "auto" })}>{k}を消費</button>
                  );
                })}
              </div>
              <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "action" } }))} style={btnFull("none", "none", C.textFaint)}>戻る</button>
            </div>
          )}
          {sc.phase === "gamble_roll" && (
            <div style={{ textAlign: "center" }}>
              {pc.items?.["小銭"] > 0 && !(pc.badStatus || []).includes("二日酔い") && (
                <button onClick={() => {
                  upd(p => {
                    const nextCount = (p.currentScene.gambleDiceCount || 2) + 1;
                    const nextPc = { ...pc, items: { ...pc.items, 小銭: pc.items["小銭"] - 1 } };
                    return {
                      ...p,
                      pcs: p.pcs.map(x => x.uid === pc.uid ? nextPc : x),
                      currentScene: { ...p.currentScene, gambleDiceCount: nextCount },
                      log: [`${pc.charName} は小銭を使用し、判定ダイスを1つ増やした！`, ...p.log]
                    };
                  });
                }} style={{ ...btnFull("rgba(200,160,64,0.15)", C.goldDim, C.gold, { marginBottom: 12 }) }}>
                  💰 小銭を使用する（残り: {pc.items["小銭"]}）
                </button>
              )}

              <button onClick={() => animateDice(sc.gambleDiceCount || 2, "賭博の判定", res => {
                const max = Math.max(...res);
                const isFumble = res.every(d => d === 1);
                const success = max >= 6 && !isFumble;
                upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "gamble_result", gambleDice: res, gambleSuccess: success } }));
              })} style={btnFull(C.redBg, C.redBorder, C.red)}>🎲 {sc.gambleDiceCount || 2}D:6で勝負する</button>
            </div>
          )}
          {sc.phase === "gamble_result" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 8 }}>
                {sc.gambleDice?.map((d, i) => <div key={i} style={{ width: 36, height: 36, border: "1px solid #e07060", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{d}</div>)}
              </div>
              <div style={{ fontSize: 16, color: sc.gambleSuccess ? C.green : C.red, marginBottom: 12 }}>
                {sc.gambleSuccess ? "成功！ アイテムを3つ獲得できます" : "失敗… アイテムを失った"}
              </div>
              {sc.gambleSuccess ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center" }}>
                  {["お酒", "小銭", "お守り", "Pアイテム", "残機のかけら", "スペカのかけら"].map(k => (
                    <button key={k} onClick={() => {
                        const count = (sc.gambleRewards || 0) + 1;
                        upd(p => {
                          const uid = p.currentScene.pcUid;
                          const newPcs = p.pcs.map(x => x.uid === uid ? { ...x, items: { ...x.items, [k]: (x.items[k] || 0) + 1 } } : x);
                          // 3つ獲得しきったらアクションフェーズへ戻る（アクションは消費しない）
                          return {
                            ...p,
                            pcs: newPcs,
                            currentScene: { ...p.currentScene, gambleRewards: count, ...(count >= 3 ? { phase: "action" } : {}) },
                            log: [`${p.pcs.find(x => x.uid === uid)?.charName} は【${k}】を獲得した`, ...p.log],
                          };
                        });
                    }} style={btnFull("rgba(200,160,64,0.1)", C.goldDim, C.gold, { width: "auto" })}>+ {k}</button>
                  ))}
                  <div style={{ width: "100%", fontSize: 9, color: C.textDim, marginTop: 4 }}>残り獲得数: {3 - (sc.gambleRewards || 0)}</div>
                </div>
              ) : (
                <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "action" }, log: [`${pc.charName} は賭博に敗北した`, ...p.log] }))} style={btnFull("rgba(255,255,255,0.05)", C.border, C.textFaint)}>アクションへ戻る</button>
              )}
            </div>
          )}

          {sc.phase === "explore_select" && (
            <div>
              <div style={{ fontSize: 10, color: C.gold, marginBottom: 8, borderBottom: `1px solid ${C.gold}40` }}>探索イベントを選択</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {(SPOT_DETAILS[sceneSpot]?.events ||[]).map((ev, i) => (
                  <button key={i} onClick={() => selectEvent(ev)} style={btnFull("rgba(255,255,255,0.03)", C.border, C.text, { textAlign: "left", padding: "8px" })}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                      <span style={{ fontSize: 11 }}>{ev.name}</span>
                      <span style={{ fontSize: 10, color: C.blue }}>目標: {ev.target}</span>
                    </div>
                    <div style={{ fontSize: 8, color: C.textFaint, lineHeight: 1.3, whiteSpace: "pre-wrap" }}>{ev.effect}</div>
                  </button>
                ))}
              </div>
              <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "action" } }))} style={{ ...btnFull("none", "none", C.textFaint), marginTop: 10, fontSize: 10 }}>← 戻る</button>
            </div>
          )}

          {sc.phase === "explore_roll" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ padding: 8, background: "rgba(200,160,64,0.05)", borderRadius: 4, marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: C.gold }}>{sc.selectedEvent?.name}</div>
                <div style={{ fontSize: 10, color: C.blue }}>目標値: {sc.selectedEvent?.target}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 12 }}>
                <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, actionDiceCount: Math.max(1, sc.actionDiceCount - 1) } }))} style={btnSmall}>-</button>
                <span style={{ fontSize: 20, color: C.gold }}>{sc.actionDiceCount} 個</span>
                <button onClick={() => {
                  let next = sc.actionDiceCount + 1;
                  if ((pc.badStatus || []).includes("怪我")) next = Math.min(2, next);
                  upd(p => ({ ...p, currentScene: { ...p.currentScene, actionDiceCount: next } }));
                }} style={btnSmall}>+</button>
              </div>

              {pc.items?.["小銭"] > 0 && !(pc.badStatus || []).includes("二日酔い") && (
                <button onClick={() => {
                  upd(p => {
                    const nextCount = (p.currentScene.actionDiceCount || 2) + 1;
                    const nextPc = { ...pc, items: { ...pc.items, 小銭: pc.items["小銭"] - 1 } };
                    return {
                      ...p,
                      pcs: p.pcs.map(x => x.uid === pc.uid ? nextPc : x),
                      currentScene: { ...p.currentScene, actionDiceCount: nextCount },
                      log: [`${pc.charName} は小銭を使用し、判定ダイスを1つ増やした！`, ...p.log]
                    };
                  });
                }} style={{ ...btnFull("rgba(200,160,64,0.15)", C.goldDim, C.gold, { marginBottom: 12 }) }}>
                  💰 小銭を使用する（残り: {pc.items["小銭"]}）
                </button>
              )}

              {/* 瀟洒: 3ダイス以上かつ霊力1点消費で自動成功 */}
              {pc.ps?.name === "瀟洒" && (sc.actionDiceCount || 2) >= 3 && (pc.resources.霊力?.cur || 0) >= 1 && (
                <button onClick={() => {
                  upd(p => {
                    const rei = pc.resources.霊力;
                    return {
                      ...p,
                      pcs: p.pcs.map(x => x.uid !== pc.uid ? x : {
                        ...x, resources: { ...x.resources,
                          霊力: { ...rei, cur: rei.cur - 1 },
                          攻撃力: { ...x.resources.攻撃力, cur: 1 + Math.floor((rei.cur - 1) / 5) }
                        }
                      }),
                      currentScene: { ...p.currentScene, phase: "explore_result", actionDice: [], isAutoSuccess: true, fumbleResolved: true, specialResolved: true },
                      log: [`${pc.charName}《瀟洒》: 霊力1消費して行為判定を自動成功！`, ...p.log]
                    };
                  });
                }} style={btnFull("rgba(255,183,77,0.15)", "#ffb74d40", "#ffb74d", { marginBottom: 8, fontSize: 10 })}>
                  ✨《瀟洒》霊力1消費で自動成功
                </button>
              )}

              {/* 応援は判定後（explore_result）に宣言してダイスを振り足す方式に変更 */}
              <button onClick={rollExplore} style={btnFull(C.goldBg, C.goldDim, C.gold)}>🎲 判定ダイスを振る</button>
            </div>
          )}

          {sc.phase === "special_cure" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 13, color: C.gold, marginBottom: 14, fontWeight: "bold" }}>🌿 解除する変調を選択</div>
              {(pc.badStatus || []).map(bs => (
                <button key={bs} onClick={() => {
                  upd(p => {
                    const newBs  = pc.badStatus.filter(x => x !== bs);
                    const newPcs = p.pcs.map(x => x.uid === pc.uid ? { ...x, badStatus: newBs } : x);
                    const { pcs: pcs2, logs } = gainIntimacy(newPcs, pc.uid, 1, `${pc.charName}のスペシャル`);
                    return { ...p, pcs: pcs2, currentScene: { ...p.currentScene, phase: "explore_result", specialResolved: true }, log:[...logs, `${pc.charName} は変調《${bs}》を解除した`, ...p.log] };
                  });
                }} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text, { marginBottom: 4 })}>《{bs}》を解除</button>
              ))}
              <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "explore_result" } }))} style={{ ...btnFull("none", "none", C.textFaint), marginTop: 10 }}>戻る</button>
            </div>
          )}

          {sc.phase === "explore_result" && (() => {
            const maxDie       = Math.max(...(sc.actionDice ||[0]));
            // 何でもひっくり返す程度の能力（オート）: 同スポットに保持者がいると ファンブル/スペシャル 条件が反転（全6=ファンブル / 1あり=スペシャル）
            const flipCond = gs.pcs.some(x => x.currentSpot === pc.currentSpot && (getActiveAbility(x)?.name === "何でもひっくり返す程度の能力" || getActiveAbility(x)?.name === "何でもひっくり返す程度の能力＋"));
            // 打ち出の小槌を扱う程度の能力（判定ダイス+1の代償）: base=出目が全て2以下でファンブル / ＋=半分以上が1かつ残りが2でファンブル
            const uchideName = getActiveAbility(pc)?.name;
            const dice = sc.actionDice || [];
            const uchideFumble = dice.length > 0 && (
              uchideName === "打ち出の小槌を扱う程度の能力" ? dice.every(d => d <= 2)
              : uchideName === "打ち出の小槌を扱う程度の能力＋" ? (dice.every(d => d <= 2) && dice.filter(d => d === 1).length * 2 >= dice.length)
              : false);
            // 自分も含めて不運（紫苑）: このフェイズ中、出目すべて2以下でファンブル
            const unluckyFumble = gs.unluckyPhase && sc.actionDice?.length > 0 && sc.actionDice.every(d => d <= 2);
            const baseFumble   = (sc.actionDice?.length > 0 && (flipCond ? sc.actionDice.every(d => d === 6) : sc.actionDice.every(d => d === 1))) || uchideFumble || unluckyFumble;
            // 魂の弱い所/人を狂わす による応援（fragile）: 失敗するとファンブルになる
            const wouldSucceed = sc.isAutoSuccess || (maxDie >= (sc.selectedEvent?.target || 0));
            const fragileFumble = !!sc.fragileCheer && !wouldSucceed && (sc.actionDice?.length > 0);
            const isFumble     = baseFumble || fragileFumble;
            const isSpecial    = flipCond ? sc.actionDice?.includes(1) : sc.actionDice?.includes(6);
            const isSuccess    = sc.isAutoSuccess || (maxDie >= (sc.selectedEvent?.target || 0) && !isFumble);
            const pendingFumble  = isFumble  && !sc.fumbleResolved;
            const pendingSpecial = isSpecial && !isFumble && !sc.specialResolved;
            const canProceed   = !pendingFumble && !pendingSpecial;

            // 狂気（観戦保持者）の振り直し可能数：base=霊力3で1個、＋=霊力3点ごとに1個
            const kyoukiName = getActiveAbility(myPc)?.name;
            const kyoukiPlus = kyoukiName === "狂気を操る程度の能力＋";
            const kyoukiHolder = myPc && myPc.uid !== pc.uid && myPc.currentSpot === pc.currentSpot
              && (kyoukiName === "狂気を操る程度の能力" || kyoukiPlus);
            const myRei = myPc?.resources?.霊力?.cur || 0;
            const kyoukiMax = kyoukiPlus ? Math.floor(myRei / 3) : (myRei >= 3 ? 1 : 0);

            return (
              <div style={{ textAlign: "center" }}>
                <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 12 }}>
                  {sc.actionDice?.map((d, i) => {
                    const fusuiOn  = fusuiSel !== null;
                    const kyoukiOn = kyoukiSel !== null;
                    const unmeiOn  = unmeiSel !== null;
                    const doubutsuOn = doubutsuSel !== null;
                    const selecting = fusuiOn || kyoukiOn || unmeiOn || doubutsuOn;
                    const picked = (fusuiOn && fusuiSel.includes(i)) || (kyoukiOn && kyoukiSel.includes(i)) || (unmeiOn && unmeiSel.includes(i)) || (doubutsuOn && doubutsuSel.includes(i));
                    const onDie = !selecting ? undefined : () => {
                      if (fusuiOn) setFusuiSel(s => s.includes(i) ? s.filter(k => k !== i) : [...s, i]);
                      else if (unmeiOn) setUnmeiSel(s => s.includes(i) ? s.filter(k => k !== i) : [...s, i]);
                      else if (doubutsuOn) setDoubutsuSel(s => s.includes(i) ? s.filter(k => k !== i) : [...s, i]);
                      else setKyoukiSel(s => s.includes(i) ? s.filter(k => k !== i) : (s.length < kyoukiMax ? [...s, i] : s)); // 狂気: 霊力に応じた個数まで
                    };
                    return (
                      <div key={i} onClick={onDie}
                        style={{ width: 32, height: 32, background: picked ? "rgba(255,183,77,0.25)" : "rgba(14,20,36,0.95)", border: `${picked ? 2 : 1}px solid ${picked ? "#ffb74d" : d === 6 ? C.gold : d === 1 ? C.red : C.blueBorder}`, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: d === 6 ? C.gold : d === 1 ? C.red : C.blue, cursor: selecting ? "pointer" : "default", animation: `diceIn 0.32s ${(i * 0.09).toFixed(2)}s cubic-bezier(0.34,1.56,0.64,1) both` }}>{d}</div>
                    );
                  })}
                </div>

                {/* 風水を操る程度の能力（サポート・1日1回）: 選んだ任意のダイスを振り直す */}
                {isMyTurn && (sc.actionDice?.length > 0) && getActiveAbility(pc)?.name === "風水を操る程度の能力" && pc.abilityUse?.["風水を操る程度の能力"]?.day !== gs.day && (
                  fusuiSel === null ? (
                    <button onClick={() => setFusuiSel([])} style={{ ...btnFull("rgba(255,183,77,0.15)", "#ffb74d50", "#ffb74d", { fontSize: 10 }), marginBottom: 10 }}>🎲 風水: ダイスを振り直す</button>
                  ) : (
                    <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 10 }}>
                      <button disabled={fusuiSel.length === 0} onClick={() => {
                        const sel = fusuiSel; setFusuiSel(null);
                        animateDice(sel.length, "風水（振り直し）", res => upd(p => {
                          const dice = [...(p.currentScene.actionDice || [])];
                          sel.forEach((idx, k) => { dice[idx] = res[k]; });
                          return {
                            ...p,
                            pcs: p.pcs.map(x => x.uid === pc.uid ? { ...x, abilityUse: { ...(x.abilityUse || {}), "風水を操る程度の能力": { ...(x.abilityUse?.["風水を操る程度の能力"] || {}), day: gs.day } } } : x),
                            currentScene: { ...p.currentScene, actionDice: dice, fumbleResolved: false, specialResolved: false },
                            log: [`🎲 ${pc.charName} の《風水を操る程度の能力》: ${sel.length}個のダイスを振り直した`, ...p.log],
                          };
                        }));
                      }} style={btnFull(fusuiSel.length ? "rgba(255,183,77,0.2)" : "rgba(255,255,255,0.04)", fusuiSel.length ? "#ffb74d50" : C.border, fusuiSel.length ? "#ffb74d" : C.textFaint, { fontSize: 10 })}>振り直す（{fusuiSel.length}個）</button>
                      <button onClick={() => setFusuiSel(null)} style={btnFull("rgba(255,255,255,0.04)", C.border, C.textFaint, { fontSize: 10 })}>やめる</button>
                    </div>
                  )
                )}

                {/* 狂気を操る程度の能力（サポート）: 同スポットの保持者が霊力3点ごとに判定ダイス1つを振り直す（観戦者操作）。base=1個 / ＋=霊力に応じ複数 */}
                {kyoukiHolder && (sc.actionDice?.length > 0) && kyoukiMax > 0 && (
                  kyoukiSel === null ? (
                    <button onClick={() => setKyoukiSel([])} style={{ ...btnFull("rgba(156,39,176,0.16)", C.purpleBorder, C.purple, { fontSize: 10 }), marginBottom: 10 }}>🌀 狂気: 霊力3ごとに振り直す（{myPc.charName}・最大{kyoukiMax}個）</button>
                  ) : (
                    <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 10 }}>
                      <button disabled={kyoukiSel.length === 0} onClick={() => {
                        const sel = kyoukiSel; setKyoukiSel(null);
                        animateDice(sel.length, "狂気（振り直し）", res => upd(p => {
                          const dice = [...(p.currentScene.actionDice || [])];
                          sel.forEach((idx, k) => { dice[idx] = res[k]; });
                          const r = myPc.resources.霊力 || { cur: 0, max: 20 };
                          const nextRei = Math.max(0, r.cur - 3 * sel.length);
                          return {
                            ...p,
                            pcs: p.pcs.map(x => x.uid === myPc.uid ? { ...x, resources: { ...x.resources, 霊力: { ...r, cur: nextRei }, 攻撃力: { ...x.resources.攻撃力, cur: 1 + Math.floor(nextRei / 5) } } } : x),
                            currentScene: { ...p.currentScene, actionDice: dice, fumbleResolved: false, specialResolved: false },
                            log: [`🌀 ${myPc.charName} の《狂気を操る程度の能力》: 霊力${3 * sel.length}を消費し ${pc.charName} のダイス${sel.length}個を振り直した`, ...p.log],
                          };
                        }));
                      }} style={btnFull(kyoukiSel.length ? "rgba(156,39,176,0.2)" : "rgba(255,255,255,0.04)", kyoukiSel.length ? C.purpleBorder : C.border, kyoukiSel.length ? C.purple : C.textFaint, { fontSize: 10 })}>振り直す（{kyoukiSel.length}個・霊力{3 * kyoukiSel.length}）</button>
                      <button onClick={() => setKyoukiSel(null)} style={btnFull("rgba(255,255,255,0.04)", C.border, C.textFaint, { fontSize: 10 })}>やめる</button>
                    </div>
                  )
                )}

                {/* 運命を操る程度の能力（サポート・1日1回）: 出目を全て裏返す（1↔6,2↔5,3↔4） */}
                {isMyTurn && (sc.actionDice?.length > 0) && getActiveAbility(pc)?.name === "運命を操る程度の能力" && pc.abilityUse?.["運命を操る程度の能力"]?.day !== gs.day && (
                  <button onClick={() => upd(p => ({
                    ...p,
                    pcs: p.pcs.map(x => x.uid === pc.uid ? { ...x, abilityUse: { ...(x.abilityUse || {}), "運命を操る程度の能力": { ...(x.abilityUse?.["運命を操る程度の能力"] || {}), day: gs.day } } } : x),
                    currentScene: { ...p.currentScene, actionDice: sc.actionDice.map(d => 7 - d), fumbleResolved: false, specialResolved: false },
                    log: [`🔄 ${pc.charName} の《運命を操る程度の能力》: 出目を全て裏返した`, ...p.log],
                  }))} style={{ ...btnFull("rgba(156,39,176,0.16)", C.purpleBorder, C.purple, { fontSize: 10 }), marginBottom: 10 }}>
                    🔄 運命: 出目を全て裏返す
                  </button>
                )}

                {/* 運命を操る程度の能力＋（サポート・1日1回）: 好きな数だけ出目を裏返す（選択式） */}
                {isMyTurn && (sc.actionDice?.length > 0) && getActiveAbility(pc)?.name === "運命を操る程度の能力＋" && pc.abilityUse?.["運命を操る程度の能力＋"]?.day !== gs.day && (
                  unmeiSel === null ? (
                    <button onClick={() => setUnmeiSel([])} style={{ ...btnFull("rgba(156,39,176,0.16)", C.purpleBorder, C.purple, { fontSize: 10 }), marginBottom: 10 }}>🔄 運命＋: 裏返すダイスを選ぶ</button>
                  ) : (
                    <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 10 }}>
                      <button disabled={unmeiSel.length === 0} onClick={() => {
                        const sel = unmeiSel; setUnmeiSel(null);
                        upd(p => {
                          const dice = [...(p.currentScene.actionDice || [])];
                          sel.forEach(idx => { dice[idx] = 7 - dice[idx]; });
                          return {
                            ...p,
                            pcs: p.pcs.map(x => x.uid === pc.uid ? { ...x, abilityUse: { ...(x.abilityUse || {}), "運命を操る程度の能力＋": { ...(x.abilityUse?.["運命を操る程度の能力＋"] || {}), day: gs.day } } } : x),
                            currentScene: { ...p.currentScene, actionDice: dice, fumbleResolved: false, specialResolved: false },
                            log: [`🔄 ${pc.charName} の《運命を操る程度の能力＋》: ${sel.length}個の出目を裏返した`, ...p.log],
                          };
                        });
                      }} style={btnFull(unmeiSel.length ? "rgba(156,39,176,0.2)" : "rgba(255,255,255,0.04)", unmeiSel.length ? C.purpleBorder : C.border, unmeiSel.length ? C.purple : C.textFaint, { fontSize: 10 })}>裏返す（{unmeiSel.length}個）</button>
                      <button onClick={() => setUnmeiSel(null)} style={btnFull("rgba(255,255,255,0.04)", C.border, C.textFaint, { fontSize: 10 })}>やめる</button>
                    </div>
                  )
                )}

                {/* 応援（判定後に宣言してダイスを振り足す）: 結果確定（変調/スペシャル処理）の前に行える */}
                {!sc.fumbleResolved && !sc.specialResolved && renderCheerSection(pc, (cheererUid, bondName, fragile) => applyCheer(cheererUid, bondName, fragile))}

                {/* 奇跡を起こす程度の能力（サポート）: 同スポットの保持者が応援の代わりに出目を1つ+1（絆を消費） */}
                {!sc.fumbleResolved && !sc.specialResolved && (() => {
                  const kName = getActiveAbility(myPc)?.name;
                  if (!myPc || myPc.uid === pc.uid || myPc.currentSpot !== pc.currentSpot) return null;
                  if (kName !== "奇跡を起こす程度の能力" && kName !== "奇跡を起こす程度の能力＋") return null;
                  const bondName = `${pc.charName}への絆`;
                  if (!(myPc.bonds || []).includes(bondName) || myPc.bondUsed?.[bondName]) return null; // 未使用の絆が必要
                  const targets = (sc.actionDice || []).map((d, i) => ({ d, i })).filter(({ d }) => d < 6);
                  if (targets.length === 0) return null;
                  return (
                    <div style={{ marginBottom: 10, padding: 6, background: "rgba(255,213,79,0.08)", border: `1px solid ${C.goldDim}`, borderRadius: 4 }}>
                      <div style={{ fontSize: 9, color: C.gold, marginBottom: 4 }}>✨ 奇跡: 応援で出目を1つ+1（{myPc.charName}）</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center" }}>
                        {targets.map(({ d, i }) => (
                          <button key={i} onClick={() => upd(p => {
                            const dice = [...(p.currentScene.actionDice || [])];
                            dice[i] = Math.min(6, dice[i] + 1);
                            return {
                              ...p,
                              pcs: p.pcs.map(x => x.uid === myPc.uid ? { ...x, bondUsed: { ...x.bondUsed, [bondName]: true } } : x),
                              currentScene: { ...p.currentScene, actionDice: dice, fumbleResolved: false, specialResolved: false },
                              log: [`✨ ${myPc.charName} の《奇跡を起こす程度の能力》: 応援で出目を ${d}→${d + 1} に変更`, ...p.log],
                            };
                          })} style={btnFull("rgba(255,213,79,0.16)", C.goldDim, C.gold, { width: "auto", fontSize: 10, padding: "3px 8px" })}>{d}→{d + 1}</button>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* 動物を導く程度の能力（サポート）: 同スポットの保持者が応援で選んだ出目を振り直す（絆消費・base=1日1回） */}
                {!sc.fumbleResolved && !sc.specialResolved && (() => {
                  const dName = getActiveAbility(myPc)?.name;
                  if (!myPc || myPc.uid === pc.uid || myPc.currentSpot !== pc.currentSpot) return null;
                  const isDoubutsu = dName === "動物を導く程度の能力" || dName === "動物を導く程度の能力＋";
                  if (!isDoubutsu) return null;
                  const bondName = `${pc.charName}への絆`;
                  if (!(myPc.bonds || []).includes(bondName) || myPc.bondUsed?.[bondName]) return null;     // 未使用の絆が必要
                  const isPlus = dName === "動物を導く程度の能力＋";
                  if (!isPlus && myPc.abilityUse?.["動物を導く程度の能力"]?.day === gs.day) return null;    // base は1日1回
                  if (!(sc.actionDice?.length > 0)) return null;
                  return doubutsuSel === null ? (
                    <button onClick={() => setDoubutsuSel([])} style={{ ...btnFull("rgba(129,199,132,0.14)", C.greenBorder, C.green, { fontSize: 10 }), marginBottom: 10 }}>🐾 動物: 応援でダイスを振り直す（{myPc.charName}）</button>
                  ) : (
                    <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 10 }}>
                      <button disabled={doubutsuSel.length === 0} onClick={() => {
                        const sel = doubutsuSel; setDoubutsuSel(null);
                        animateDice(sel.length, "動物（振り直し）", res => upd(p => {
                          const dice = [...(p.currentScene.actionDice || [])];
                          sel.forEach((idx, k) => { dice[idx] = res[k]; });
                          return {
                            ...p,
                            pcs: p.pcs.map(x => x.uid === myPc.uid ? { ...x, bondUsed: { ...x.bondUsed, [bondName]: true }, abilityUse: isPlus ? x.abilityUse : { ...(x.abilityUse || {}), "動物を導く程度の能力": { ...(x.abilityUse?.["動物を導く程度の能力"] || {}), day: gs.day } } } : x),
                            currentScene: { ...p.currentScene, actionDice: dice, fumbleResolved: false, specialResolved: false },
                            log: [`🐾 ${myPc.charName} の《動物を導く程度の能力》: 応援で ${sel.length}個のダイスを振り直した`, ...p.log],
                          };
                        }));
                      }} style={btnFull(doubutsuSel.length ? "rgba(129,199,132,0.2)" : "rgba(255,255,255,0.04)", doubutsuSel.length ? C.greenBorder : C.border, doubutsuSel.length ? C.green : C.textFaint, { fontSize: 10 })}>振り直す（{doubutsuSel.length}個）</button>
                      <button onClick={() => setDoubutsuSel(null)} style={btnFull("rgba(255,255,255,0.04)", C.border, C.textFaint, { fontSize: 10 })}>やめる</button>
                    </div>
                  );
                })()}

                {/* 気質を見極める程度の能力（サポート）: 判定者(pc)が応援された時、出目を1つ+1（1判定1回） */}
                {!sc.fumbleResolved && !sc.specialResolved && isMyTurn && sc.wasCheered && !sc.kishitsuUsed
                  && (getActiveAbility(pc)?.name === "気質を見極める程度の能力" || getActiveAbility(pc)?.name === "気質を見極める程度の能力＋")
                  && (() => {
                    const targets = (sc.actionDice || []).map((d, i) => ({ d, i })).filter(({ d }) => d < 6);
                    if (targets.length === 0) return null;
                    return (
                      <div style={{ marginBottom: 10, padding: 6, background: "rgba(255,213,79,0.08)", border: `1px solid ${C.goldDim}`, borderRadius: 4 }}>
                        <div style={{ fontSize: 9, color: C.gold, marginBottom: 4 }}>✨ 気質: 応援を受け出目を1つ+1</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center" }}>
                          {targets.map(({ d, i }) => (
                            <button key={i} onClick={() => upd(p => {
                              const dice = [...(p.currentScene.actionDice || [])];
                              dice[i] = Math.min(6, dice[i] + 1);
                              return { ...p, currentScene: { ...p.currentScene, actionDice: dice, kishitsuUsed: true, fumbleResolved: false, specialResolved: false }, log: [`✨ ${pc.charName} の《気質を見極める程度の能力》: 応援を受け出目を ${d}→${d + 1} に変更`, ...p.log] };
                            })} style={btnFull("rgba(255,213,79,0.16)", C.goldDim, C.gold, { width: "auto", fontSize: 10, padding: "3px 8px" })}>{d}→{d + 1}</button>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                <div style={{ fontSize: 18, color: isSuccess ? C.green : C.red, fontWeight: "bold", marginBottom: 12, animation: "diceResultIn 0.42s 0.22s cubic-bezier(0.34,1.56,0.64,1) both" }}>
                  {isFumble && !sc.fumbleCanceled ? "ファンブル！" : isSuccess ? "成功！" : "失敗…"}
                </div>

                {pendingSpecial && (() => {
                  const reiFull = (pc.resources?.霊力?.cur || 0) >= (pc.resources?.霊力?.max || 0);
                  // 霊力が最大 → 回復ロールをスキップ（親密度+1・実績は付与）
                  const resolveNoRecover = () => upd(p => {
                    const { pcs: pcs2, logs } = gainIntimacy(p.pcs, pc.uid, 1, `${pc.charName}のスペシャル`);
                    const pcs3 = bumpAch(pcs2, pc.uid, a => ({ ...a, specials: (a.specials || 0) + 1, ...(p.unluckyPhase ? { unluckySpecials: (a.unluckySpecials || 0) + 1 } : {}) }));
                    return { ...p, pcs: pcs3, currentScene: { ...p.currentScene, specialResolved: true }, log:[...logs, `${pc.charName} のスペシャル（霊力は最大のため回復なし）`, ...p.log] };
                  });
                  return (
                  <div style={{ marginBottom: 12, padding: 10, background: "rgba(200,160,64,0.1)", border: "1px solid #8b691460", borderRadius: 4 }}>
                    <div style={{ fontSize: 11, color: C.gold, marginBottom: 8 }}>✨ スペシャル報酬を選択</div>
                    <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                      {reiFull ? (
                        <button onClick={resolveNoRecover} style={btnFull(C.goldBg, C.goldDim, C.gold, { fontSize: 10 })}>スペシャル確定（霊力最大）</button>
                      ) : (
                      <button onClick={() => animateDice(1, "霊力回復", res => {
                        upd(p => {
                          const gain    = (pc.badStatus || []).includes("スランプ") ? 0 : res[0];
                          const nextCur = Math.min(pc.resources.霊力.max, (pc.resources.霊力.cur || 0) + gain);
                          const newPcs  = p.pcs.map(x => x.uid !== pc.uid ? x : { ...x, resources: { ...x.resources, 霊力: { ...x.resources.霊力, cur: nextCur }, 攻撃力: { ...x.resources.攻撃力, cur: 1 + Math.floor(nextCur / 5) } } });
                          // 特別な絆: 対象(pc)のスペシャルで親密度+1
                          const { pcs: pcs2, logs } = gainIntimacy(newPcs, pc.uid, 1, `${pc.charName}のスペシャル`);
                          const pcs3 = bumpAch(pcs2, pc.uid, a => ({ ...a, specials: (a.specials || 0) + 1, ...(p.unluckyPhase ? { unluckySpecials: (a.unluckySpecials || 0) + 1 } : {}) }));
                          return { ...p, pcs: pcs3, currentScene: { ...p.currentScene, specialResolved: true }, log:[...logs, `${pc.charName} は霊力を ${gain} 点回復した`, ...p.log] };
                        });
                      })} style={btnFull(C.goldBg, C.goldDim, C.gold, { fontSize: 10 })}>霊力回復 (1D6)</button>
                      )}
                      {(pc.badStatus || []).length > 0 && <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "special_cure" } }))} style={btnFull(C.blueBg, C.blueBorder, C.blue, { fontSize: 10 })}>変調解除</button>}
                    </div>
                  </div>
                  );
                })()}

                {pendingFumble && (
                  <div style={{ marginBottom: 12, padding: 10, background: "rgba(224,112,96,0.1)", border: "1px solid #e0706060", borderRadius: 4 }}>
                    <div style={{ fontSize: 11, color: C.red, marginBottom: 8 }}>💀 変調を獲得します</div>
                    <button onClick={() => animateDice(1, "変調決定", res => {
                      const bsName = BAD_STATUS_TABLE[res[0]].name;
                      upd(p => {
                        const immune = isBadStatusImmune(pc, bsName);
                        const newBs  = immune ? (pc.badStatus || []) : Array.from(new Set([...(pc.badStatus || []), bsName]));
                        let newPcs = p.pcs.map(x => x.uid !== pc.uid ? x : { ...x, badStatus: newBs, resources: { ...x.resources, やる気: { ...x.resources.やる気, cur: !immune && bsName === "だるい" ? 1 : x.resources.やる気.cur } } });
                        // 実績(天邪鬼の悪運): 逆転(何でもひっくり返す)有効中の全ダイス6ファンブル
                        const isFlipFumble = flipCond && (sc.actionDice || []).length > 0 && (sc.actionDice || []).every(d => d === 6);
                        newPcs = bumpAch(newPcs, pc.uid, a => ({ ...a, fumbles: (a.fumbles || 0) + 1, ...(isFlipFumble ? { flipFumble: true } : {}), ...(p.unluckyPhase ? { unluckyFumbled: true } : {}) }));
                        const log = immune ? `🛡 ${pc.charName}《馬鹿》: 変調《${bsName}》を無効化！` : `${pc.charName} は変調《${bsName}》を獲得した`;
                        return { ...p, pcs: newPcs, currentScene: { ...p.currentScene, fumbleResolved: true, fumbleStatus: bsName }, log:[log, ...p.log] };
                      });
                    })} style={btnFull(C.redBg, C.redBorder, C.red, { fontSize: 10 })}>🎲 変調表を振る (1D6)</button>
                    {/* 喉の病気を癒す程度の能力（サポート）: 同スポットの保持者が他者のファンブルを無効化（base=通常失敗扱い / ＋=判定やり直し） */}
                    {(() => {
                      const nodoName = getActiveAbility(myPc)?.name;
                      const nodoHolder = myPc && myPc.uid !== pc.uid && myPc.currentSpot === pc.currentSpot
                        && (nodoName === "喉の病気を癒す程度の能力" || nodoName === "喉の病気を癒す程度の能力＋");
                      if (!nodoHolder) return null;
                      const isPlus = nodoName === "喉の病気を癒す程度の能力＋";
                      return (
                        <button onClick={() => upd(p => isPlus
                          ? { ...p, currentScene: { ...p.currentScene, phase: "explore_roll", actionDice: undefined, fumbleResolved: false, specialResolved: false }, log: [`🩹 ${myPc.charName} の《喉の病気を癒す程度の能力＋》: ${pc.charName} のファンブルを無効化し判定をやり直す`, ...p.log] }
                          : { ...p, currentScene: { ...p.currentScene, fumbleResolved: true, fumbleCanceled: true }, log: [`🩹 ${myPc.charName} の《喉の病気を癒す程度の能力》: ${pc.charName} のファンブルを通常の失敗にした`, ...p.log] }
                        )} style={{ ...btnFull("rgba(129,199,132,0.15)", C.greenBorder, C.green, { fontSize: 10 }), marginTop: 6 }}>
                          🩹 喉の病気: ファンブルを{isPlus ? "無効化してやり直す" : "通常の失敗にする"}（{myPc.charName}）
                        </button>
                      );
                    })()}
                  </div>
                )}

                {canProceed && (
                  <div style={{ animation: "fadeUp 0.3s ease" }}>
                    <div style={{ padding: 10, background: "rgba(255,255,255,0.03)", borderRadius: 4, fontSize: 10, color: C.textDim, textAlign: "left", whiteSpace: "pre-wrap", marginBottom: 12 }}>
                      <div style={{ color: C.gold, marginBottom: 4 }}>【イベント効果】</div>
                      {sc.selectedEvent?.effect}
                    </div>

                    {/* 熱中: 失敗時にやる気1消費で再判定 */}
                    {!isSuccess && !isFumble && pc.ps?.name === "熱中" && (pc.resources.やる気?.cur || 0) >= 1 && (
                      <button onClick={() => {
                        upd(p => ({
                          ...p,
                          pcs: p.pcs.map(x => x.uid !== pc.uid ? x : {
                            ...x, resources: { ...x.resources, やる気: { ...x.resources.やる気, cur: (x.resources.やる気?.cur || 0) - 1 } }
                          }),
                          currentScene: { ...p.currentScene, phase: "explore_roll", actionDice: undefined, fumbleResolved: false, specialResolved: false },
                          log: [`${pc.charName}《熱中》: やる気1消費して行為判定をやり直す！`, ...p.log]
                        }));
                      }} style={btnFull("rgba(255,183,77,0.15)", "#ffb74d40", "#ffb74d", { fontSize: 10, marginBottom: 8 })}>
                        🔄《熱中》やる気1消費で再判定
                      </button>
                    )}

                    {/* 直感: 失敗時でも手がかりを取得（1回限り・手がかりがある場合のみ） */}
                    {!isSuccess && pc.ps?.name === "直感" && !pc[PS_ONCE_FLAG] && hasClueHere && (
                      <button onClick={() => {
                        upd(p => ({
                          ...p,
                          pcs: p.pcs.map(x => x.uid !== pc.uid ? x : { ...x, [PS_ONCE_FLAG]: true }),
                          currentScene: { ...p.currentScene, phase: "explore_clue", isSuccess: true },
                          log: [`${pc.charName}《直感》: 失敗でも手がかりを取得！`, ...p.log]
                        }));
                      }} style={btnFull("rgba(255,183,77,0.15)", "#ffb74d40", "#ffb74d", { fontSize: 10, marginBottom: 8 })}>
                        🔍《直感》失敗でも手がかりを取得（1回限り）
                      </button>
                    )}

                    <button onClick={() => {
                      const event = sc.selectedEvent;
                      const actions =[];
                      if (event.onAlways) actions.push(...event.onAlways);
                      if (isSuccess && event.onSuccess) actions.push(...event.onSuccess);
                      if (!isSuccess && event.onFailure) actions.push(...event.onFailure);

                      upd(p => ({
                        ...p,
                        currentScene: {
                          ...p.currentScene,
                          phase: "explore_apply_effect",
                          eventActions: actions,
                          currentActionIndex: 0,
                          isSuccess
                        }
                      }));
                    }} style={btnFull(C.goldBg, C.goldDim, C.gold)}>イベント効果を適用する</button>
                  </div>
                )}
              </div>
            );
          })()}

          {sc.phase === "explore_apply_effect" && (
            <ActionRenderer 
              act={(sc.eventActions || [])[sc.currentActionIndex || 0]} 
              pc={pc} gs={gs} upd={upd} animateDice={animateDice} 
              SPOTS={SPOTS} getSpot={getSpot} 
              isDone={(sc.currentActionIndex || 0) >= (sc.eventActions ||[]).length}
            />
          )}

          {sc.phase === "explore_clue" && (() => {
            const unrevealedQuests = gs.quests?.filter(q => !q.solved && q.revealed);
            const isNoAvailableQuestSlots = unrevealedQuests.length === 0 || unrevealedQuests.every(q => (q.clues || 0) >= q.level);
            const useClueEvents = room.config?.useClueEvents;
            
            if (sc.isSuccess) {
              if (hasClueHere) {
                return (
                  <div style={{ padding: 8, background: "rgba(0,229,255,0.1)", border: "1px solid #00e5ff60", borderRadius: 4 }}>
                    <div style={{ fontSize: 10, color: "#00e5ff", marginBottom: 6 }}>💡 手がかりを獲得！</div>

                    {unrevealedQuests.filter(q => (q.clues || 0) < q.level).map(q => (
                      <button key={q.id} onClick={() => acquireClue(q.id)} style={btnFull("rgba(255,255,255,0.05)", C.border, C.text, { fontSize: 10, marginBottom: 4 })}>「{q.name}」</button>
                    ))}

                    {useClueEvents && isNoAvailableQuestSlots && (
                      <button onClick={() => animateDice(1, "手がかりイベント表", res => {
                        upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "clue_event_result", clueEventDice: res[0] } }));
                      })} style={btnFull(C.purpleBg, C.purpleBorder, C.purple, { marginTop: 4 })}>
                        📜 手がかりイベント表を振る
                      </button>
                    )}

                    <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "action_done" } }))} style={{ ...btnFull("none", "none", C.textFaint), marginTop: 8 }}>配置せず終了</button>
                  </div>
                );
              } else {
                return (
                  <div style={{ textAlign: "center" }}>
                    <button onClick={() => placeClueWithAnimation(2)} style={btnFull(C.goldBg, C.goldDim, C.gold)}>🎲 手がかりを2つ配置</button>
                  </div>
                );
              }
            } else {
              return (
                <div style={{ textAlign: "center" }}>
                  <button onClick={() => placeClueWithAnimation(1)} style={btnFull(C.redBg, C.redBorder, C.red)}>🎲 手がかりを1つ配置</button>
                </div>
              );
            }
          })()}

          {sc.phase === "quest_setup" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: C.gold, marginBottom: 12 }}>
                仲間の合流を待っています...<br/>
                <span style={{ fontSize: 9, color: C.textDim }}>（他のプレイヤーの画面に合流ボタンが表示されています）</span>
              </div>

              {isGm && (
                <button 
                  onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "quest_resolve" } }))}
                  style={btnFull(C.blueBg, C.blueBorder, C.blue)}
                >
                  全員揃ったので解決に進む
                </button>
              )}
            </div>
          )}

          {sc.phase === "quest_resolve" && (() => {
            const q = gs.quests?.find(x => x.id === sc.questId);
            return (
              <div style={{ textAlign: "center", animation: "fadeUp 0.3s ease" }}>
                <div style={{ fontSize: 13, color: C.gold, marginBottom: 8 }}>クエスト「{q?.name}」の解決</div>
                
                {isGm && (
                  <div style={{ marginTop: 16 }}>
                    {q?.solutionType === "自動解決" && (
                      <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "quest_done", isSuccess: true } }))} style={btnFull(C.greenBg, C.greenBorder, C.green)}>
                        自動解決でクリア！
                      </button>
                    )}
                    {q?.solutionType === "行為判定" && (
                      <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "quest_roll", rolls: {} } }))} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>
                        行為判定を開始する
                      </button>
                    )}
                    {q?.solutionType === "弾幕ごっこ" && (() => {
                      const enemy = q.enemy;
                      if (!enemy) return (
                        <div style={{ fontSize: 11, color: C.red }}>敵データが設定されていません</div>
                      );
                      const flavor = getPreBattleFlavorRoll(q);
                      return (
                        <button onClick={() => {
                          // 演出判定が設定されている場合は、弾幕ごっこ開始前に演出フェーズを挟む。
                          if (flavor) {
                            upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "quest_flavor_roll", flavorTarget: flavor.target, flavorRoll: null } }));
                          } else {
                            startQuestBattle(q);
                          }
                        }} style={btnFull(C.redBg, C.redBorder, C.red)}>
                          {flavor ? "▶ 演出判定へ進む" : "⚔️ 弾幕ごっこを開始する"}
                        </button>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          })()}

          {sc.phase === "quest_flavor_roll" && (() => {
            const q = gs.quests?.find(x => x.id === sc.questId);
            const scenePc = gs.pcs.find(p => p.uid === sc.pcUid);
            const target = sc.flavorTarget || 6;
            const rolled = sc.flavorRoll;
            const canRoll = sc.pcUid === user?.uid || isGm;
            return (
              <div style={{ animation: "fadeUp 0.3s ease" }}>
                <div style={{ textAlign: "center", marginBottom: 12 }}>
                  <div style={{ fontSize: 13, color: C.gold }}>演出判定（目標値: {target}）</div>
                  <div style={{ fontSize: 9, color: C.textFaint, marginTop: 3 }}>※ 演出のための判定です。スペシャル・ファンブルは発生しません</div>
                </div>

                {rolled ? (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 12, color: rolled.success ? C.green : C.textDim, marginBottom: 14, padding: "8px 10px", background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, borderRadius: 4 }}>
                      {scenePc?.charName}： {rolled.dice.join(", ")} → 最大 {Math.max(...rolled.dice)}（{rolled.success ? "成功" : "失敗"}）
                    </div>
                    {isGm ? (
                      <button onClick={() => startQuestBattle(q)} style={btnFull(C.redBg, C.redBorder, C.red)}>
                        ⚔️ 弾幕ごっこを開始する
                      </button>
                    ) : (
                      <div style={{ fontSize: 10, color: C.textFaint }}>GMが弾幕ごっこを開始します…</div>
                    )}
                  </div>
                ) : (
                  <div style={{ textAlign: "center", padding: 10, background: "rgba(0,0,0,0.2)", borderRadius: 6, border: `1px solid ${C.border}` }}>
                    {canRoll ? (
                      <button onClick={() => animateDice(2, "演出判定", res => {
                        const max = Math.max(...res);
                        upd(p => ({
                          ...p,
                          currentScene: { ...p.currentScene, flavorRoll: { dice: res, success: max >= target } },
                          log: [`🎭 ${scenePc?.charName} は弾幕ごっこ開始前の演出判定で ${res.join(", ")} を出した。`, ...p.log]
                        }));
                      })} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>
                        🎲 演出判定を行う
                      </button>
                    ) : (
                      <div style={{ fontSize: 11, color: C.textFaint }}>{scenePc?.charName} の演出判定を待っています…</div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {sc.phase === "quest_roll" && (() => {
            const q = gs.quests?.find(x => x.id === sc.questId);
            const pcsHere = gs.pcs.filter(p => p.currentSpot === sc.questLocation);
            const myPc = pcsHere.find(p => p.uid === user?.uid);
            
            // クエスト判定の評価（dice配列から成功/ファンブル/スペシャルを算出）。fragile=失敗→ファンブル
            const evalQuest = (diceArr, fragile) => {
              const max = Math.max(...diceArr);
              let isFumble = diceArr.every(d => d === 1) || (gs.unluckyPhase && diceArr.length > 0 && diceArr.every(d => d <= 2)); // 自分も含めて不運
              const success = max >= 4 && !isFumble;
              const isSpecial = diceArr.some(d => d === 6) && !isFumble;
              if (fragile && !success && !isFumble) isFumble = true;
              return { success, isFumble, isSpecial };
            };
            // 応援（判定後の振り足し）：対象 judgeUid のロールにダイスを1つ追加
            const applyCheerQuest = (cheererUid, bondName, judgeUid, fragile) => {
              const cheerer = gs.pcs.find(x => x.uid === cheererUid);
              const cheererName = cheerer?.charName;
              const isKuruwasu = bondName === KURUWASU_BOND;
              const isSpecial = bondName === SPECIAL_BOND_CHEER;
              const diceN = (isSpecial && (cheerer?.specialBond?.intimacy ?? 1) >= 10) ? 2 : 1;
              animateDice(diceN, "応援（振り足し）", res => upd(p => {
                const roll = p.currentScene.rolls?.[judgeUid];
                if (!roll) return p;
                const consume = isKuruwasu
                  ? { kuruwasuUsed: { ...(cheerer?.kuruwasuUsed || {}), [judgeUid]: true } }
                  : isSpecial
                  ? { specialBond: { ...cheerer?.specialBond, used: true } }
                  : { bondUsed: { ...(cheerer?.bondUsed || {}), [bondName]: true } };
                return {
                  ...p,
                  pcs: p.pcs.map(x => x.uid !== cheererUid ? x : { ...x, ...consume }),
                  currentScene: { ...p.currentScene, rolls: { ...p.currentScene.rolls, [judgeUid]: { ...roll, dice: [...roll.dice, ...res], fragile: roll.fragile || fragile, wasCheered: true } } },
                  log: [`💪 ${cheererName} が${isKuruwasu ? "絆なしで" : isSpecial ? `《${cheerer?.specialBond?.target}への${cheerer?.specialBond?.word || "敬意"}》で` : `《${bondName}》で`}応援！クエスト判定にダイスを${diceN}個振り足した（出目${res.join(",")}）${fragile ? "（失敗でファンブル）" : ""}`, ...p.log],
                };
              }));
            };
            // 判定確定：振り足し後の最終出目でファンブル/スペシャルを適用し resolved にする。
            // 探索同様、ファンブルは変調表、スペシャルは霊力回復を animateDice で振る。
            const confirmQuestRoll = (judgePc) => {
              const roll = gs.currentScene.rolls?.[judgePc.uid];
              if (!roll) return;
              const ev = evalQuest(roll.dice, roll.fragile);
              const resultLabel = `${judgePc.charName} のクエスト判定確定: ${ev.success ? "成功" : "失敗"}${ev.isFumble ? "（ファンブル）" : ev.isSpecial ? "（スペシャル）" : ""}`;
              const markResolved = (p) => ({ ...p, currentScene: { ...p.currentScene, rolls: { ...p.currentScene.rolls, [judgePc.uid]: { ...(p.currentScene.rolls?.[judgePc.uid] || roll), resolved: true } } } });

              if (ev.isFumble) {
                animateDice(1, "変調決定", r => upd(p => {
                  const bsName = BAD_STATUS_TABLE[r[0]]?.name;
                  const immune = isBadStatusImmune(judgePc, bsName);
                  let newPcs = (!bsName || immune) ? p.pcs : p.pcs.map(x => x.uid !== judgePc.uid ? x : { ...x, badStatus: [...(x.badStatus || []), bsName] });
                  newPcs = bumpAch(newPcs, judgePc.uid, a => ({ ...a, fumbles: (a.fumbles || 0) + 1, ...(p.unluckyPhase ? { unluckyFumbled: true } : {}) }));
                  const fl = !bsName ? [] : [immune ? `🛡 ${judgePc.charName}《馬鹿》: 変調《${bsName}》を無効化！` : `💀 ファンブル！ ${judgePc.charName} は変調《${bsName}》を獲得した`];
                  return { ...markResolved({ ...p, pcs: newPcs }), log: [...fl, resultLabel, ...p.log] };
                }));
              } else if (ev.isSpecial && ev.success) {
                animateDice(1, "霊力回復", r => upd(p => {
                  const gain = r[0];
                  const pcs0 = p.pcs.map(x => x.uid !== judgePc.uid ? x : { ...x, resources: { ...x.resources, 霊力: { ...x.resources.霊力, cur: Math.min((x.resources.霊力?.cur || 0) + gain, x.resources.霊力?.max || 20) }, 攻撃力: { ...x.resources.攻撃力, cur: 1 + Math.floor(Math.min((x.resources.霊力?.cur || 0) + gain, x.resources.霊力?.max || 20) / 5) } } });
                  const { pcs: pcs1, logs } = gainIntimacy(pcs0, judgePc.uid, 1, `${judgePc.charName}のスペシャル`);
                  const pcs2 = bumpAch(pcs1, judgePc.uid, a => ({ ...a, specials: (a.specials || 0) + 1, ...(p.unluckyPhase ? { unluckySpecials: (a.unluckySpecials || 0) + 1 } : {}) }));
                  return { ...markResolved({ ...p, pcs: pcs2 }), log: [...logs, `✨ スペシャル！ ${judgePc.charName} は霊力 +${gain}点回復した`, resultLabel, ...p.log] };
                }));
              } else {
                upd(p => ({ ...markResolved(p), log: [resultLabel, ...p.log] }));
              }
            };
            // クエスト判定者 p のロールに対する応援強化（奇跡=出目+1 / 動物=振り直し / 気質=被応援で出目+1）
            const writeRollDice = (judgeUid, newDice, consumeUid, consumeBond, extraPatch, logMsg) => upd(p2 => {
              const r = p2.currentScene.rolls?.[judgeUid]; if (!r) return p2;
              return {
                ...p2,
                pcs: consumeUid ? p2.pcs.map(x => x.uid === consumeUid ? { ...x, ...(consumeBond ? { bondUsed: { ...x.bondUsed, [consumeBond]: true } } : {}), ...(extraPatch ? extraPatch(x) : {}) } : x) : p2.pcs,
                currentScene: { ...p2.currentScene, rolls: { ...p2.currentScene.rolls, [judgeUid]: { ...r, dice: newDice } } },
                log: [logMsg, ...p2.log],
              };
            });
            const renderQuestCheerEffects = (judge, roll) => {
              const dice = roll.dice || [];
              const t = dice.map((d, i) => ({ d, i })).filter(({ d }) => d < 6);
              const oName = getActiveAbility(myPc)?.name;
              const obsOk = myPc && myPc.uid !== judge.uid && myPc.currentSpot === sc.questLocation;
              const bondName = `${judge.charName}への絆`;
              const hasBond = obsOk && (myPc.bonds || []).includes(bondName) && !myPc.bondUsed?.[bondName];
              const jName = getActiveAbility(judge)?.name;
              return (
                <>
                  {hasBond && (oName === "奇跡を起こす程度の能力" || oName === "奇跡を起こす程度の能力＋") && t.length > 0 && (
                    <div style={{ margin: "6px 0", padding: 6, background: "rgba(255,213,79,0.08)", border: `1px solid ${C.goldDim}`, borderRadius: 4 }}>
                      <div style={{ fontSize: 9, color: C.gold, marginBottom: 4 }}>✨ 奇跡: 応援で出目を1つ+1（{myPc.charName}）</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center" }}>
                        {t.map(({ d, i }) => (
                          <button key={i} onClick={() => { const nd = [...dice]; nd[i] = Math.min(6, d + 1); writeRollDice(judge.uid, nd, myPc.uid, bondName, null, `✨ ${myPc.charName} の《奇跡を起こす程度の能力》: ${judge.charName} の出目を ${d}→${d + 1} に`); }} style={btnFull("rgba(255,213,79,0.16)", C.goldDim, C.gold, { width: "auto", fontSize: 10, padding: "3px 8px" })}>{d}→{d + 1}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  {hasBond && (oName === "動物を導く程度の能力" || oName === "動物を導く程度の能力＋") && dice.length > 0 && (() => {
                    const isPlus = oName === "動物を導く程度の能力＋";
                    if (!isPlus && myPc.abilityUse?.["動物を導く程度の能力"]?.day === gs.day) return null;
                    const sel = qDoubutsuSel?.uid === judge.uid ? qDoubutsuSel.indices : null;
                    return sel === null ? (
                      <button onClick={() => setQDoubutsuSel({ uid: judge.uid, indices: [] })} style={{ ...btnFull("rgba(129,199,132,0.14)", C.greenBorder, C.green, { fontSize: 10 }), margin: "6px 0", width: "100%" }}>🐾 動物: 応援でダイスを振り直す（{myPc.charName}）</button>
                    ) : (
                      <div style={{ margin: "6px 0" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center", marginBottom: 4 }}>
                          {dice.map((d, i) => {
                            const picked = sel.includes(i);
                            return <button key={i} onClick={() => setQDoubutsuSel(s => ({ uid: judge.uid, indices: s.indices.includes(i) ? s.indices.filter(k => k !== i) : [...s.indices, i] }))} style={btnFull(picked ? "rgba(129,199,132,0.25)" : "rgba(255,255,255,0.04)", picked ? C.greenBorder : C.border, picked ? C.green : C.textDim, { width: "auto", fontSize: 10, padding: "2px 7px" })}>{picked ? "✓" : ""}{d}</button>;
                          })}
                        </div>
                        <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                          <button disabled={sel.length === 0} onClick={() => { const indices = sel; setQDoubutsuSel(null); animateDice(indices.length, "動物（振り直し）", res => { const nd = [...dice]; indices.forEach((idx, k) => { nd[idx] = res[k]; }); writeRollDice(judge.uid, nd, myPc.uid, bondName, isPlus ? null : (x => ({ abilityUse: { ...(x.abilityUse || {}), "動物を導く程度の能力": { ...(x.abilityUse?.["動物を導く程度の能力"] || {}), day: gs.day } } })), `🐾 ${myPc.charName} の《動物を導く程度の能力》: ${judge.charName} の ${indices.length}個を振り直した`); }); }} style={btnFull(sel.length ? "rgba(129,199,132,0.2)" : "rgba(255,255,255,0.04)", sel.length ? C.greenBorder : C.border, sel.length ? C.green : C.textFaint, { fontSize: 10 })}>振り直す（{sel.length}個）</button>
                          <button onClick={() => setQDoubutsuSel(null)} style={btnFull("rgba(255,255,255,0.04)", C.border, C.textFaint, { fontSize: 10 })}>やめる</button>
                        </div>
                      </div>
                    );
                  })()}
                  {judge.uid === user?.uid && roll.wasCheered && !roll.kishitsuUsed && (jName === "気質を見極める程度の能力" || jName === "気質を見極める程度の能力＋") && t.length > 0 && (
                    <div style={{ margin: "6px 0", padding: 6, background: "rgba(255,213,79,0.08)", border: `1px solid ${C.goldDim}`, borderRadius: 4 }}>
                      <div style={{ fontSize: 9, color: C.gold, marginBottom: 4 }}>✨ 気質: 応援を受け出目を1つ+1</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center" }}>
                        {t.map(({ d, i }) => (
                          <button key={i} onClick={() => upd(p2 => { const r = p2.currentScene.rolls?.[judge.uid]; if (!r) return p2; const nd = [...r.dice]; nd[i] = Math.min(6, nd[i] + 1); return { ...p2, currentScene: { ...p2.currentScene, rolls: { ...p2.currentScene.rolls, [judge.uid]: { ...r, dice: nd, kishitsuUsed: true } } }, log: [`✨ ${judge.charName} の《気質を見極める程度の能力》: 出目を ${d}→${d + 1} に`, ...p2.log] }; })} style={btnFull("rgba(255,213,79,0.16)", C.goldDim, C.gold, { width: "auto", fontSize: 10, padding: "3px 8px" })}>{d}→{d + 1}</button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              );
            };
            const myRoll = sc.rolls?.[user?.uid];
            // 確定済み（resolved）の判定のみ成功/全員ロール済みの集計に使う（応援の振り足しを待つため）
            const anySuccess = Object.values(sc.rolls || {}).some(r => r.resolved && evalQuest(r.dice, r.fragile).success);
            const allRolled = pcsHere.every(p => sc.rolls?.[p.uid]?.resolved);
            
            const hasTag = myPc && q?.specifiedTag && q.specifiedTag.split(/[、,]/).some(t => (myPc.tags ||[]).includes(t.trim()) || myPc.charName === t.trim() || (myPc.ps && myPc.ps.name === t.trim()));
            let baseDice = 2 + (hasTag ? 1 : 0);
            // 快適な拠点: 自身の拠点にいる場合+1
            if (myPc?.ps?.name === "快適な拠点" && isAtBase(myPc)) baseDice++;
            // 寂しがり屋: 同スポットに他PCがいる場合+1
            if (myPc?.ps?.name === "寂しがり屋" && gs.pcs.some(x => x.uid !== myPc?.uid && x.currentSpot === myPc?.currentSpot)) baseDice++;
            const myDiceCount = sc.diceCounts?.[user?.uid] || baseDice;

            return (
              <div style={{ animation: "fadeUp 0.3s ease" }}>
                <div style={{ textAlign: "center", marginBottom: 12 }}>
                  <div style={{ fontSize: 13, color: C.gold }}>クエスト判定（目標値: 4）</div>
                  {q?.specifiedTag && <div style={{ fontSize: 10, color: C.textDim }}>指定タグ: {q.specifiedTag} {hasTag && <span style={{color: C.green}}>ボーナス適用！</span>}</div>}
                </div>

                <div style={{ display: "grid", gap: 6, marginBottom: 16 }}>
                  {pcsHere.map(p => {
                    const r = sc.rolls?.[p.uid];
                    const ev = r ? evalQuest(r.dice, r.fragile) : null;
                    return (
                      <div key={p.uid} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, borderRadius: 4 }}>
                        <div style={{ fontSize: 11, color: C.text }}>{p.charName}</div>
                        <div style={{ fontSize: 11, color: r ? (ev.success ? C.green : C.red) : C.textFaint }}>
                          {r ? (`${ev.success ? "成功" : "失敗"} (${r.dice.join(", ")})${r.resolved ? "" : "・応援待ち"}`) : "待機中..."}
                          {ev?.isSpecial && <span style={{ color: C.gold, marginLeft: 4 }}>⭐スペシャル</span>}
                          {ev?.isFumble && <span style={{ color: C.red, marginLeft: 4 }}>💀ファンブル</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {!myRoll && myPc && !anySuccess && (
                  <div style={{ textAlign: "center", padding: 10, background: "rgba(0,0,0,0.2)", borderRadius: 6, border: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 11, color: C.text, marginBottom: 8 }}>あなたの判定ダイス: <span style={{color:C.gold, fontSize:14}}>{myDiceCount}</span> 個</div>

                    <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 12 }}>
                      <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, diceCounts: { ...(p.currentScene.diceCounts||{}), [user.uid]: Math.max(1, myDiceCount - 1) } } }))} style={btnSmall}>-</button>
                      <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, diceCounts: { ...(p.currentScene.diceCounts||{}), [user.uid]: myDiceCount + 1 } } }))} style={btnSmall}>+</button>
                    </div>

                    {myPc.items?.["小銭"] > 0 && !(myPc.badStatus || []).includes("二日酔い") && (
                      <button onClick={() => {
                        upd(p => {
                          const nextCount = myDiceCount + 1;
                          const nextPc = { ...myPc, items: { ...myPc.items, 小銭: myPc.items["小銭"] - 1 } };
                          return {
                            ...p,
                            pcs: p.pcs.map(x => x.uid === myPc.uid ? nextPc : x),
                            currentScene: { ...p.currentScene, diceCounts: { ...(p.currentScene.diceCounts||{}), [user.uid]: nextCount } },
                            log: [`${myPc.charName} は小銭を使用し、クエスト判定のダイスを増やした！`, ...p.log]
                          };
                        });
                      }} style={{ ...btnFull("rgba(200,160,64,0.15)", C.goldDim, C.gold, { marginBottom: 10 }) }}>
                        💰 小銭を使用する（残り: {myPc.items["小銭"]}）
                      </button>
                    )}

                    {/* 応援は判定後（振り足し）に変更。ここでは判定前のダイス調整のみ */}

                    {/* 瀟洒: 3ダイス以上かつ霊力1消費で自動成功 */}
                    {myPc.ps?.name === "瀟洒" && myDiceCount >= 3 && (myPc.resources.霊力?.cur || 0) >= 1 && (
                      <button onClick={() => {
                        upd(p => {
                          const rei = myPc.resources.霊力;
                          return {
                            ...p,
                            pcs: p.pcs.map(x => x.uid !== myPc.uid ? x : {
                              ...x, resources: { ...x.resources,
                                霊力: { ...rei, cur: rei.cur - 1 },
                                攻撃力: { ...x.resources.攻撃力, cur: 1 + Math.floor((rei.cur - 1) / 5) }
                              }
                            }),
                            currentScene: { ...p.currentScene, rolls: { ...(p.currentScene.rolls||{}), [user.uid]: { dice: [4, 4, 4], success: true, isSpecial: false, isFumble: false } } },
                            log: [`${myPc.charName}《瀟洒》: 霊力1消費してクエスト判定を自動成功！`, ...p.log]
                          };
                        });
                      }} style={{ ...btnFull("rgba(255,183,77,0.15)", "#ffb74d40", "#ffb74d", { marginBottom: 10, fontSize: 10 }) }}>
                        ✨《瀟洒》霊力1消費で自動成功
                      </button>
                    )}

                    {/* 我儘: 全ての絆を自身への絆として扱う */}
                    {myPc.ps?.name === "我儘" && (
                      <div style={{ fontSize: 9, color: "#ffb74d", marginBottom: 8, padding: "4px 8px", background: "rgba(255,183,77,0.08)", borderRadius: 4, border: "1px solid #ffb74d30" }}>
                        ♟《我儘》あなたの絆はすべて自身への絆として扱われます
                      </div>
                    )}

                    <button onClick={() => animateDice(myDiceCount, "クエスト判定", res => {
                      // 出目のみ保存（成功/ファンブル/スペシャルの効果は応援の振り足し後「判定確定」で適用）
                      upd(p => ({
                        ...p,
                        currentScene: { ...p.currentScene, rolls: { ...(p.currentScene.rolls||{}), [user.uid]: { dice: res, fragile: false, resolved: false } } },
                        log: [`${myPc.charName} はクエスト「${q?.name}」の判定で ${res.join(", ")} を出した`, ...p.log],
                      }));
                    })} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>
                      🎲 行為判定を行う
                    </button>
                  </div>
                )}

                {/* 判定後パネル：未確定のロールごとに 応援（振り足し）→ 判定確定。応援は観戦者にも見えるよう全PC分表示、確定は本人のみ */}
                {!anySuccess && pcsHere.some(p => sc.rolls?.[p.uid] && !sc.rolls[p.uid].resolved) && (
                  <div style={{ marginBottom: 12 }}>
                    {pcsHere.filter(p => sc.rolls?.[p.uid] && !sc.rolls[p.uid].resolved).map(p => {
                      const roll = sc.rolls[p.uid];
                      const ev = evalQuest(roll.dice, roll.fragile);
                      return (
                        <div key={p.uid} style={{ padding: 8, marginBottom: 6, background: "rgba(0,0,0,0.2)", borderRadius: 6, border: `1px solid ${C.border}` }}>
                          <div style={{ fontSize: 11, color: ev.success ? C.green : C.red, marginBottom: 6, textAlign: "center" }}>
                            {p.charName}: {roll.dice.join(", ")} → {ev.success ? "成功" : ev.isFumble ? "ファンブル" : "失敗"}
                          </div>
                          {renderCheerSection(p, (cheererUid, bondName, fragile) => applyCheerQuest(cheererUid, bondName, p.uid, fragile))}
                          {renderQuestCheerEffects(p, roll)}
                          {p.uid === user?.uid && (
                            <button onClick={() => confirmQuestRoll(p)} style={btnFull(ev.success ? C.greenBg : C.redBg, ev.success ? C.greenBorder : C.redBorder, ev.success ? C.green : C.red, { fontSize: 11 })}>
                              判定を確定する{ev.isFumble ? "（ファンブル）" : ev.success ? "（成功）" : "（失敗）"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {anySuccess && isGm && (
                  <div style={{ textAlign: "center", marginTop: 16 }}>
                    <div style={{ fontSize: 13, color: C.green, marginBottom: 8 }}>✨ 判定成功！</div>
                    <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "quest_done", isSuccess: true } }))} style={btnFull(C.greenBg, C.greenBorder, C.green)}>
                      解決処理へ進む
                    </button>
                  </div>
                )}

                {allRolled && !anySuccess && (
                  <div style={{ textAlign: "center", marginTop: 16 }}>
                    <div style={{ fontSize: 13, color: C.red, marginBottom: 8 }}>💀 全員失敗...</div>

                    {/* 熱中: やる気1消費で全員分の判定をリセットして再判定 */}
                    {myPc?.ps?.name === "熱中" && (myPc.resources.やる気?.cur || 0) >= 1 && (
                      <button onClick={() => {
                        upd(p => ({
                          ...p,
                          pcs: p.pcs.map(x => x.uid !== myPc.uid ? x : {
                            ...x, resources: { ...x.resources, やる気: { ...x.resources.やる気, cur: (x.resources.やる気?.cur || 0) - 1 } }
                          }),
                          currentScene: { ...p.currentScene, rolls: {}, diceCounts: {} },
                          log: [`${myPc.charName}《熱中》: やる気1消費してクエスト判定をやり直す！`, ...p.log]
                        }));
                      }} style={btnFull("rgba(255,183,77,0.15)", "#ffb74d40", "#ffb74d", { marginBottom: 8, fontSize: 10 })}>
                        🔄《熱中》やる気1消費で再判定
                      </button>
                    )}

                    {(pc.uid === user?.uid) && (
                      <button onClick={() => animateDice(1, "ペナルティ表", res => {
                        upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "quest_penalty", penaltyDice: res[0] } }));
                      })} style={btnFull(C.redBg, C.redBorder, C.red)}>
                        🎲 ペナルティ表を振る
                      </button>
                    )}
                    {pc.uid !== user?.uid && <div style={{ fontSize: 10, color: C.textDim }}>シーンプレイヤーがペナルティ表を振ります...</div>}
                  </div>
                )}
              </div>
            );
          })()}

          {sc.phase === "quest_penalty" && (() => {
            const pcsHere = gs.pcs.filter(p => p.currentSpot === sc.questLocation);
            const myPc = pcsHere.find(p => p.uid === user?.uid);
            const d = sc.penaltyDice;
            const decisions = sc.penaltyDecisions || {};

            const allDecided = pcsHere.every(p => decisions[p.uid] !== undefined);
            const anyPaid = Object.values(decisions).some(v => v === true);

            const makeDecision = (paid, updatedPc = null) => {
              upd(p => {
                const nextPcs = updatedPc ? p.pcs.map(x => x.uid === user.uid ? updatedPc : x) : p.pcs;
                return {
                  ...p,
                  pcs: nextPcs,
                  currentScene: { 
                    ...p.currentScene, 
                    penaltyDecisions: { ...(p.currentScene.penaltyDecisions || {}), [user.uid]: paid } 
                  }
                };
              });
            };
            
            const pData = {
              1: { title: "うぷ。頑張りすぎてしまったかも。", desc: "シーンプレイヤーのPCはランダムな【変調】1つを獲得する。\nその後、クエストは解決する。" },
              2: { title: "うっかりパワーを使いすぎてしまった。", desc: "シーンプレイヤーのPCは【霊力】を「D6点」消費する。\nその後、クエストは解決する。" },
              3: { title: "なかなかうまくいかない時って、一気に気分が萎えてしまうよね。", desc: "このシーンに登場しているPC全員の【やる気】が「1点」になる。\nその後、クエストは解決する。" },
              4: { title: "協力プレイでなんとか解決。", desc: "このシーンに登場しているPCは、自身の獲得している絆を1つ選んで消費できる。誰か一人が支払えばクエストは解決する。" },
              5: { title: "誰か、アレを持ってない！？", desc: "このシーンに登場しているPCは、所持している任意のアイテム1つを失うことができる。誰か一人が支払えばクエストは解決する。" },
              6: { title: "どうあがいても無理だった...", desc: "このクエストは解決されない。" }
            }[d];

            const applyAutoPenalty = () => {
              if (d === 1) {
                animateDice(1, "変調決定", res => {
                  const bsName = BAD_STATUS_TABLE[res[0]].name;
                  upd(p => {
                    const immune = isBadStatusImmune(pc, bsName);
                    const newBs = immune ? (pc.badStatus || []) : Array.from(new Set([...(pc.badStatus || []), bsName]));
                    const newPcs = p.pcs.map(x => x.uid === pc.uid ? { ...x, badStatus: newBs, resources: { ...x.resources, やる気: { ...x.resources.やる気, cur: !immune && bsName === "だるい" ? 1 : x.resources.やる気.cur } } } : x);
                    const log = immune ? `🛡 ${pc.charName}《馬鹿》: 変調《${bsName}》を無効化！` : `${pc.charName} はペナルティで変調《${bsName}》を獲得した。`;
                    return { ...p, pcs: newPcs, currentScene: { ...p.currentScene, phase: "quest_done", isSuccess: true }, log: [log, ...p.log] };
                  });
                });
              } else if (d === 2) {
                animateDice(1, "霊力減少", res => {
                  const dmg = res[0];
                  upd(p => {
                    const r = pc.resources.霊力 || { cur: 0, max: 20 };
                    const nextRei = Math.max(0, r.cur - dmg);
                    const newPcs = p.pcs.map(x => x.uid === pc.uid ? { ...x, resources: { ...x.resources, 霊力: { ...r, cur: nextRei }, 攻撃力: { ...x.resources.攻撃力, cur: 1 + Math.floor(nextRei / 5) } } } : x);
                    return { ...p, pcs: newPcs, currentScene: { ...p.currentScene, phase: "quest_done", isSuccess: true }, log: [`${pc.charName} はペナルティで霊力を ${dmg} 消費した。`, ...p.log] };
                  });
                });
              } else if (d === 3) {
                upd(p => {
                  const uidsHere = pcsHere.map(x => x.uid);
                  const newPcs = p.pcs.map(x => uidsHere.includes(x.uid) ? { ...x, resources: { ...x.resources, やる気: { ...x.resources.やる気, cur: 1 } } } : x);
                  return { ...p, pcs: newPcs, currentScene: { ...p.currentScene, phase: "quest_done", isSuccess: true }, log: [`ペナルティにより全員のやる気が 1 になった。`, ...p.log] };
                });
              }
            };

            return (
              <div style={{ textAlign: "center", animation: "fadeUp 0.3s ease" }}>
                <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>ペナルティ表: [{d}]</div>
                <div style={{ fontSize: 13, color: C.red, marginBottom: 8, fontWeight: "bold" }}>{pData.title}</div>
                <div style={{ fontSize: 10, color: C.text, whiteSpace: "pre-wrap", background: "rgba(192,57,43,0.15)", border: `1px solid ${C.redBorder}`, padding: 10, borderRadius: 4, marginBottom: 16 }}>
                  {pData.desc}
                </div>

                {isMyTurn && [1, 2, 3].includes(d) && (
                  <button onClick={applyAutoPenalty} style={btnFull(C.goldBg, C.goldDim, C.gold)}>ペナルティを受けて解決する</button>
                )}

                {[4, 5].includes(d) && !allDecided && (
                  <div style={{ background: "rgba(0,0,0,0.2)", padding: 10, borderRadius: 6, border: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 10, color: C.gold, marginBottom: 10, borderBottom: `1px solid ${C.border}`, paddingBottom: 4 }}>
                      全員の回答を待っています...
                    </div>
                    
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center", marginBottom: 12 }}>
                      {pcsHere.map(p => (
                        <div key={p.uid} style={{ fontSize: 9, padding: "2px 6px", borderRadius: 10, background: decisions[p.uid] === undefined ? "rgba(255,255,255,0.05)" : decisions[p.uid] ? C.greenBg : C.redBg, color: decisions[p.uid] === undefined ? C.textFaint : decisions[p.uid] ? C.green : C.red, border: `1px solid ${decisions[p.uid] === undefined ? C.border : decisions[p.uid] ? C.greenBorder : C.redBorder}` }}>
                          {p.charName}: {decisions[p.uid] === undefined ? "考え中" : decisions[p.uid] ? "支払う" : "パス"}
                        </div>
                      ))}
                    </div>

                    {myPc && decisions[user.uid] === undefined && (
                      <div style={{ animation: "fadeUp 0.2s ease" }}>
                        {d === 4 && (
                          <>
                            <select value={selectedTarget} onChange={e => setSelectedTarget(e.target.value)} style={{ ...iStyle, marginBottom: 8, fontSize: 11 }}>
                              <option value="">消費する絆を選択...</option>
                              {(myPc.bonds || []).map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                            <button 
                              disabled={!selectedTarget} 
                              onClick={() => {
                                const nextPc = { ...myPc, bonds: myPc.bonds.filter(b => b !== selectedTarget) };
                                makeDecision(true, nextPc);
                                upd(p => ({ ...p, log: [`${myPc.charName} は《${selectedTarget}への絆》を捧げて協力した！`, ...p.log] }));
                              }}
                              style={btnFull(selectedTarget ? C.greenBg : "rgba(255,255,255,0.05)", C.greenBorder, selectedTarget ? C.green : C.textFaint, { marginBottom: 6 })}
                            >
                              絆を消費して協力する
                            </button>
                          </>
                        )}
                        {d === 5 && (
                          <>
                            <select value={selectedTarget} onChange={e => setSelectedTarget(e.target.value)} style={{ ...iStyle, marginBottom: 8, fontSize: 11 }}>
                              <option value="">消費するアイテムを選択...</option>
                              {Object.entries(myPc.items || {}).filter(([_, count]) => count > 0).map(([name]) => <option key={name} value={name}>{name}</option>)}
                            </select>
                            <button 
                              disabled={!selectedTarget} 
                              onClick={() => {
                                const nextPc = { ...myPc, items: { ...myPc.items, [selectedTarget]: myPc.items[selectedTarget] - 1 } };
                                makeDecision(true, nextPc);
                                upd(p => ({ ...p, log: [`${myPc.charName} は【${selectedTarget}】を差し出して協力した！`, ...p.log] }));
                              }}
                              style={btnFull(selectedTarget ? C.greenBg : "rgba(255,255,255,0.05)", C.greenBorder, selectedTarget ? C.green : C.textFaint, { marginBottom: 6 })}
                            >
                              アイテムを消費して協力する
                            </button>
                          </>
                        )}
                        <button onClick={() => makeDecision(false)} style={btnFull(C.redBg, C.redBorder, C.red)}>パスする</button>
                      </div>
                    )}
                  </div>
                )}

                {[4, 5].includes(d) && allDecided && (
                  <div style={{ animation: "fadeUp 0.3s ease" }}>
                    <div style={{ fontSize: 16, color: anyPaid ? C.green : C.red, fontWeight: "bold", marginBottom: 12 }}>
                      {anyPaid ? "✨ 協力により解決！" : "💀 誰も協力できず解決失敗..."}
                    </div>
                    {isMyTurn && (
                      <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "quest_done", isSuccess: anyPaid } }))} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>
                        結果を確定して進む
                      </button>
                    )}
                  </div>
                )}

                {isMyTurn && d === 6 && (
                  <button onClick={() => upd(p => ({ ...p, currentScene: { ...p.currentScene, phase: "quest_done", isSuccess: false } }))} style={btnFull("rgba(255,255,255,0.05)", C.border, C.textFaint)}>クリアできずに終了する</button>
                )}
                
                {(!isMyTurn && ([1, 2, 3, 6].includes(d) || allDecided)) && (
                  <div style={{ fontSize: 10, color: C.textDim }}>シーンプレイヤーが処理を確定させています...</div>
                )}
              </div>
            );
          })()}

          {sc.phase === "quest_done" && (() => {
            const q = gs.quests?.find(x => x.id === sc.questId);
            
            const finishQuest = () => {
              if (sc.isSuccess) {
                animateDice(4, "手がかり2つ配置", res => {
                  const s1 = getSpotByD66(res[0], res[1], SPOTS);
                  const s2 = getSpotByD66(res[2], res[3], SPOTS);
                  upd(p => {
                    let nextQuests = p.quests.map(x => x.id === sc.questId ? { ...x, solved: true } : x);

                    const allScenarioQuests = p.scenarioData?.quests || [];
                    allScenarioQuests.forEach(scQ => {
                      if (scQ.unlockType === "quest" && String(scQ.unlockQuestId) === String(sc.questId)) {
                        if (!nextQuests.find(nq => String(nq.id) === String(scQ.id))) {
                          nextQuests.push({ ...scQ, revealed: true, solved: false, clues: 0 });
                        }
                      }
                    });

                    return {
                      ...p,
                      quests: nextQuests,
                      clues: [...new Set([...(p.clues||[]), s1, s2].filter(Boolean))],
                      nonSearchCluePlaced: true, // 実績(鼠算式探索): 探し物以外の手がかり配置
                      actedPcs: [...(p.actedPcs || []), pc.uid],
                      currentScene: null,
                      log: [
                        `手がかりを [${getSpot(s1)?.name}] と [${getSpot(s2)?.name}] に配置した`,
                        `✨ クエスト「${q?.name}」を解決した！`,
                        `${pc.charName} のシーンを終了した`,
                        ...p.log
                      ]
                    };
                  });
                });
              } else {
                upd(p => ({
                  ...p,
                  actedPcs: [...(p.actedPcs || []), pc.uid],
                  currentScene: null,
                  log: [`クエスト「${q?.name}」は解決できなかった...`, `${pc.charName} のシーンを終了した`, ...p.log]
                }));
              }
            };

            return (
              <div style={{ textAlign: "center", animation: "fadeUp 0.3s ease" }}>
                {sc.isSuccess ? (
                  <>
                    <div style={{ fontSize: 16, color: C.gold, marginBottom: 8, fontWeight: "bold" }}>✨ クエスト解決！</div>
                    <div style={{ fontSize: 11, color: C.textDim, marginBottom: 16 }}>報酬としてランダムなスポット2箇所に手がかりが配置されます。</div>
                  </>
                ) : (
                  <div style={{ fontSize: 16, color: C.red, marginBottom: 16, fontWeight: "bold" }}>クエスト解決ならず...</div>
                )}
                {(isGm || pc.uid === user?.uid) && (
                  <button onClick={finishQuest} style={btnFull(C.blueBg, C.blueBorder, C.blue)}>
                    {sc.isSuccess ? "🎲 手がかりを配置してシーン終了" : "シーンを終了する"}
                  </button>
                )}
              </div>
            );
          })()}

          {sc.phase === "action_done" && (() => {
            const ab = getActiveAbility(pc)?.name;
            const isMushiki = isMyTurn && (ab === "無意識を操る程度の能力" || ab === "無意識を操る程度の能力＋");
            const isChonoryoku = isMyTurn && (ab === "超能力を操る程度の能力" || ab === "超能力を操る程度の能力＋");
            const adj = isMushiki ? adjacentSpots(pc.currentSpot) : [];
            return (
              <div style={{ textAlign: "center", animation: "fadeUp 0.3s ease" }}>
                <div style={{ fontSize: 11, color: C.textDim, marginBottom: 12 }}>全てのアクションが終了しました</div>
                {/* 超能力を操る（菫子）: シーン終了時にコマを取り除く（次シーン開始時にランダム配置）。＋は霊力D6も */}
                {isChonoryoku && (
                  <button onClick={() => {
                    const isPlus = ab === "超能力を操る程度の能力＋";
                    const applyEnd = (reiGain) => upd(p => {
                      const scenePc = p.pcs.find(x => x.uid === pc.uid);
                      const lives = scenePc?.resources?.残り人数?.cur ?? 0;
                      return {
                        ...p,
                        pcs: p.pcs.map(x => {
                          if (x.uid !== pc.uid) return x;
                          let nx = { ...x, offMap: true };
                          if (lives === 0) nx = { ...nx, resources: { ...nx.resources, 残り人数: { ...nx.resources.残り人数, cur: 1 } } };
                          if (reiGain) { const r = nx.resources.霊力 || { cur: 0, max: 20 }; const nr = Math.min(r.max, r.cur + reiGain); nx = { ...nx, resources: { ...nx.resources, 霊力: { ...r, cur: nr }, 攻撃力: { ...nx.resources.攻撃力, cur: 1 + Math.floor(nr / 5) } } }; }
                          return nx;
                        }),
                        actedPcs: [...(p.actedPcs || []), pc.uid],
                        currentScene: null,
                        log: [`🛸 ${pc.charName} の《超能力を操る程度の能力》：マップからコマを取り除いた（次シーン開始時にランダム配置）${reiGain ? `・霊力+${reiGain}` : ""}`, ...p.log],
                      };
                    });
                    if (isPlus) animateDice(1, "超能力（霊力獲得）", res => applyEnd(res[0]));
                    else applyEnd(0);
                  }} style={{ ...btnFull("rgba(100,181,246,0.16)", C.blueBorder, C.blue, { fontSize: 10 }), marginBottom: 6 }}>🛸 超能力: コマを取り除いて終了</button>
                )}
                {isMushiki && adj.length > 0 ? (
                  <div>
                    <div style={{ fontSize: 10, color: C.purple, marginBottom: 6 }}>🌀 無意識: シーン終了時に隣接スポットへ移動する</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                      {adj.map(sid => (
                        <button key={sid} onClick={() => endSceneAfterMove(sid)} style={btnFull("rgba(156,39,176,0.14)", C.purpleBorder, C.purple, { fontSize: 10 })}>{getSpot(sid)?.name} へ移動して終了</button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <button onClick={endScene} style={btnFull(C.redBg, C.redBorder, C.red)}>🎬 シーンを終了する</button>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ─── RightPanel ───────────────────────────────────────────────────
export function RightPanel({ gs, upd, sceneData, setSceneData, isGm, user, room, animateDice, CYCLES, CYCLE_COLORS, NEWSPAPER, getSpot, doNewspaper, doReiryoku, setPendingAction, SPOTS, presence = {}, width = 300, undo, undoCount = 0 }) {
  const [tab, setTab]             = useState("progress");
  const [expandedQuests, setExpandedQuests] = useState({});
  const [paperModal, setPaperModal] = useState(null);
  const [sceneSelect, setSceneSelect] = useState("");
  const [logSearch, setLogSearch] = useState("");
  const [freeDiceLast, setFreeDiceLast] = useState(null);   // 任意ダイスの直近結果
  const [freeDiceN, setFreeDiceN] = useState(1);            // 任意ダイスの個数
  // 任意ダイス（GM裁定・自作判定用）: nD6 / D66 を振ってログに残す
  const rollFreeDice = (count, kind) => {
    const res = Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1);
    const who = room?.players?.[user?.uid]?.name || "";
    let text;
    if (kind === "d66") { const v = Math.min(res[0], res[1]) * 10 + Math.max(res[0], res[1]); text = `D66 → ${v}（${res.join(",")}）`; }
    else { const sum = res.reduce((a, b) => a + b, 0); text = `${count}D6 → ${res.join(",")}${count > 1 ? `（合計${sum}）` : ""}`; }
    setFreeDiceLast(text);
    upd(p => ({ ...p, log: [`🎲 ${who ? who + "の" : ""}任意ダイス: ${text}`, ...p.log] }));
    sfx.diceResult(Math.max(...res));
  };
  const [logFilter, setLogFilter] = useState("all");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showDiceHistory, setShowDiceHistory] = useState(false);
  const [motionReduced, setMotionReduced] = useState(motion.reduced);
  const toggleMotion = () => { motion.toggle(); setMotionReduced(motion.reduced); };
  const [fontLevel, setFontLevel] = useState(fontScale.level); // 0標準/1大/2特大
  const cycleFont = () => setFontLevel(fontScale.cycle());
  const [showBgm, setShowBgm] = useState(false);
  const [bgmMuted, setBgmMuted] = useState(bgm.muted);
  const [bgmVol, setBgmVol] = useState(bgm.volume);

  // 探索フェーズのダイス効果音（バトル中は BattleDiceTray が担当するため除外）
  const prevExploreDiceRef = useRef(false);
  useEffect(() => {
    const wasRolling = prevExploreDiceRef.current;
    const isRolling  = gs.dice?.rolling || false;
    prevExploreDiceRef.current = isRolling;
    if (gs.battle?.active) return;
    if (!wasRolling && isRolling) {
      sfx.diceRoll();
    } else if (wasRolling && !isRolling && (gs.dice?.results?.length ?? 0) > 0) {
      sfx.diceResult(Math.max(...gs.dice.results));
    }
  }, [gs.dice?.rolling]); // eslint-disable-line

  const cycleIdx   = gs.cycleIdx || 0;
  const isIntro    = gs.sessionPhase === "intro" || gs.sessionPhase === "intro_main";
  const isMorning  = cycleIdx === 0;
  const cycleColor = CYCLE_COLORS[cycleIdx];

  const handleNewspaper = () => {
    animateDice(2, "文々。新聞表", res => {
      const val   = Math.min(res[0], res[1]) * 10 + Math.max(res[0], res[1]);
      const paper = NEWSPAPER[val] || { title: `出目${val}`, effect: "（データなし）" };
      doNewspaper({ roll: val, dice: res, ...paper });
      setTimeout(() => setPaperModal({ roll: val, dice: res, ...paper }), 300);
    });
  };

  // 風を操る程度の能力（射命丸文）: 新聞表を巻き戻して振り直す（base=やる気1消費）
  const windHolder = (gs.pcs || []).find(x => { const n = getActiveAbility(x)?.name; return n === "風を操る程度の能力" || n === "風を操る程度の能力＋"; });
  const windReroll = () => {
    if (!windHolder) return;
    const isPlus = getActiveAbility(windHolder)?.name === "風を操る程度の能力＋";
    upd(p => ({
      ...p,
      newspaper: null,
      pcs: isPlus ? p.pcs : p.pcs.map(x => x.uid === windHolder.uid ? { ...x, resources: { ...x.resources, やる気: { ...(x.resources.やる気 || { cur: 0, max: 99 }), cur: Math.max(0, (x.resources.やる気?.cur || 0) - 1) } } } : x),
      log: [`🌀 ${windHolder.charName} の《風を操る程度の能力${isPlus ? "＋" : ""}》: 新聞表を振り直す${isPlus ? "" : "（やる気-1）"}`, ...p.log],
    }));
    setPaperModal(null);
    setTimeout(handleNewspaper, 100);
  };

  const startScene = () => {
    if (!sceneSelect) return;
    const targetPc = gs.pcs.find(p => p.uid === sceneSelect);
    if (!targetPc) return;
    const selectedUid = sceneSelect;
    setSceneSelect(""); // upd()より先にクリアして二重起動を防ぐ
    // 超能力を操る（菫子）: コマを取り除いていた(offMap)場合、シーン開始時にランダムスポットへ配置
    const placeSpots = (SPOTS || []).filter(s => s.id !== "dream");
    const randomSpot = targetPc.offMap && placeSpots.length ? placeSpots[Math.floor(Math.random() * placeSpots.length)] : null;
    const startSpot = randomSpot ? randomSpot.id : targetPc.currentSpot;
    upd(p => ({
      ...p,
      pcs: randomSpot ? p.pcs.map(x => x.uid === selectedUid ? { ...x, currentSpot: randomSpot.id, offMap: null } : x) : p.pcs,
      currentScene: { pcUid: selectedUid, phase: "move_or_stay", moveDice: [], actionDice: [], actionDiceCount: 2, startSpot },
      log:[`🎬 ${targetPc.charName} のシーンが開始された`, ...(randomSpot ? [`🛸 ${targetPc.charName} の超能力：[${randomSpot.name}] にランダム配置された`] : []), ...p.log],
    }));
  };

  const unactedPcs = (gs.pcs || []).filter(pc => !(gs.actedPcs ||[]).includes(pc.uid));

  const getMainAction = () => {
    if (gs.currentScene) return null;
    if (isIntro) return { label: "🎬 探索フェイズへ移行する", fn: () => setPendingAction("toExplore"), color: "#1976d2" };

    const allScenarioQuests = gs.scenarioData?.quests || [];
    const currentSolvedCount = (gs.quests || []).filter(q => q.solved).length;
    const isAllSolved = allScenarioQuests.length > 0 && currentSolvedCount >= allScenarioQuests.length;

    if (isAllSolved && gs.sessionPhase === "explore") {
      return {
        label: "⚔️ 決戦フェイズへ移行する",
        fn: () => setPendingAction("toBattle"),
        color: C.red
      };
    }

    if (isMorning) {
      if (!gs.newspaper) return { label: "📰 文々。新聞を読む", fn: handleNewspaper, color: C.blue };
      if (!gs.cluePlaced) return {
        label: "🔍 手がかりを配置",
        color: C.green,
        fn: () => animateDice(2, "朝の手がかり配置", res => {
          const spotId = getSpotByD66(res[0], res[1], SPOTS);
          if (spotId) {
            upd(p => ({ ...p, cluePlaced: true, clues:[...new Set([...p.clues, spotId])], log: [`手がかりを [${spotId}] ${getSpot(spotId)?.name} に配置（出目: ${res[0]}, ${res[1]}）`, ...p.log] }));
          }
        }),
      };

      return { label: `☀️ 昼のサイクルへ`, fn: () => setPendingAction("advance"), color: "#f57c00" };
    }
    if (cycleIdx !== 3 && !gs.reiryokuDone) return { label: "✦ 霊力の増加", fn: doReiryoku, color: "#ab47bc" };
    if (unactedPcs.length === 0) return { label: `🌙 ${cycleIdx === 3 ? "翌日の朝" : "次のサイクル"}へ`, fn: () => setPendingAction("advance"), color: "#f57c00" };
    return null;
  };
  const ma = isGm ? getMainAction() : null;

  const TABS = isGm
    ? [["progress", "進行"],["pcs", "PC一覧"], ["scene", "描写"], ["log", "ログ"]]
    : [["progress", "進行"],["pcs", "PC一覧"], ["log", "ログ"]];

  // ── キーボードショートカット（GM操作の高速化） ──────────────────────
  // 最新の ma / TABS をハンドラに渡すため ref に保持（リスナーは mount 時1回登録）
  const maRef   = useRef(ma);   maRef.current = ma;
  const tabsRef = useRef(TABS); tabsRef.current = TABS;
  useEffect(() => {
    const onKey = (e) => {
      // 入力欄フォーカス中・修飾キー併用時はショートカット無効
      const tag = (e.target?.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        setShowShortcuts(v => !v);
        return;
      }
      if (e.key === "Escape") { setShowShortcuts(false); return; }
      // 数字キー: タブ切替
      if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        const t = tabsRef.current[idx];
        if (t) { e.preventDefault(); setTab(t[0]); }
        return;
      }
      // M: 効果音ミュート切替
      if (e.key === "m" || e.key === "M") { e.preventDefault(); sfx.toggle(); return; }
      // Enter: 状況に応じた主要アクションを実行（GMのみ）
      if (e.key === "Enter" && isGm && maRef.current) {
        e.preventDefault();
        maRef.current.fn();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isGm]);

  const joinQuest = () => {
    const myPc = gs.pcs.find(p => p.uid === user.uid);
    if (!myPc || !gs.currentScene?.questLocation) return;
    
    upd(p => ({
      ...p,
      pcs: p.pcs.map(x => x.uid === user.uid ? { ...x, currentSpot: gs.currentScene.questLocation } : x),
      log: [`🏃 ${myPc.charName} がクエストに合流した！`, ...p.log]
    }));
  };

  return (
    <div style={{ width, height: "100%", display: "flex", flexDirection: "column", background: "#0b0d14", borderLeft: `1px solid ${C.border}`, flexShrink: 0, overflow: "hidden", fontFamily: "'Noto Serif JP', serif" }}>
      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes rollSpin { 50% { transform: scale(1.15) } }
        @keyframes scenePanelIn {
          from { opacity: 0; transform: translateX(22px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes diceIn {
          from { opacity: 0; transform: scale(0.45) rotate(-18deg); }
          70%  { transform: scale(1.15) rotate(4deg); }
          to   { opacity: 1; transform: scale(1) rotate(0deg); }
        }
        @keyframes diceResultIn {
          from { opacity: 0; transform: scale(0.55) translateY(6px); }
          60%  { transform: scale(1.14) translateY(-2px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>

      <div style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, background: "#08090f", flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: C.gold, letterSpacing: 2 }}>
            {gs.battle?.active ? "⚖️ 弾幕ごっこ" : (gs.sessionPhase === "intro" ? "✦ 導入フェイズ" : "✦ 探索フェイズ")}
          </span>
          {gs.battle?.active ? (
            <div style={{ padding: "2px 10px", background: "rgba(224,112,96,0.18)", border: `1px solid ${C.redBorder}`, borderRadius: 10, fontSize: 10, color: C.red }}>
              ROUND {gs.battle.round}
            </div>
          ) : (
            !isIntro && <div style={{ padding: "2px 10px", background: `${cycleColor}18`, border: `1px solid ${cycleColor}40`, borderRadius: 10, fontSize: 10, color: cycleColor }}>{gs.day}日目・{CYCLES[cycleIdx]}</div>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
        {gs.battle?.active ? (
          <BattleRightPanel
            gs={gs}
            upd={upd}
            user={user}
            isGm={isGm}
            getSpot={getSpot}
            animateDice={animateDice}
          />
        ) : (
          <>
            {gs.currentScene?.phase === "quest_setup" && gs.currentScene?.pcUid !== user.uid && !isGm && (
              <div style={{ padding: "10px", background: "rgba(200,160,64,0.15)", borderBottom: `1px solid ${C.goldDim}`, animation: "fadeUp 0.3s ease" }}>
                <div style={{ fontSize: 10, color: C.gold, marginBottom: 6, textAlign: "center" }}>
                  🌟 クエストシーンが開始されました
                </div>
                <button 
                  onClick={joinQuest}
                  disabled={gs.pcs.find(p => p.uid === user.uid)?.currentSpot === gs.currentScene.questLocation}
                  style={btnFull(C.goldBg, C.goldDim, C.gold, { fontSize: 10 })}
                >
                  {gs.pcs.find(p => p.uid === user.uid)?.currentSpot === gs.currentScene.questLocation 
                    ? "合流済み" 
                    : "このクエストに合流する（移動）"}
                </button>
              </div>
            )}

            {gs.currentScene && (
              <div style={{ animation: "scenePanelIn 0.3s ease both" }}>
                <ScenePanel gs={gs} upd={upd} user={user} isGm={isGm} getSpot={getSpot} animateDice={animateDice} SPOTS={SPOTS} room={room} />
              </div>
            )}

            {!gs.currentScene && isGm && (
              <div style={{ padding: "8px", borderBottom: `1px solid ${C.border}`, flexShrink: 0, background: "rgba(255,255,255,0.01)" }}>
                {ma ? (
                  <button onClick={ma.fn} style={{ width: "100%", padding: "9px", borderRadius: 4, cursor: "pointer", background: `${ma.color}20`, border: `1px solid ${ma.color}50`, color: ma.color, fontSize: 12, letterSpacing: 1 }}>{ma.label}</button>
                ) : (
                  <div>
                    <div style={{ fontSize: 9, color: C.textDim, marginBottom: 4 }}>▶ シーンプレイヤーの選択</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <select value={sceneSelect} onChange={e => setSceneSelect(e.target.value)} style={{ flex: 1, padding: "6px", fontSize: 11, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.text, borderRadius: 3 }}>
                        <option value="">未行動のPCを選択...</option>
                        {unactedPcs.map(pc => <option key={pc.uid} value={pc.uid}>{pc.charName}</option>)}
                      </select>
                      <button onClick={startScene} disabled={!sceneSelect} style={{ padding: "0 12px", background: C.goldBg, border: `1px solid ${C.goldDim}`, color: C.gold, borderRadius: 3, cursor: sceneSelect ? "pointer" : "not-allowed", fontSize: 11 }}>開始</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ flexShrink: 0, borderBottom: `1px solid ${C.border}` }}>
              {/* 1段目: ナビゲーションタブ */}
              <div style={{ display: "flex" }}>
                {TABS.map(([id, label]) => (
                  <div key={id} style={{ flex: 1, padding: "7px 2px", textAlign: "center", fontSize: 11, cursor: "pointer", color: tab === id ? C.gold : C.textFaint, borderBottom: tab === id ? `2px solid ${C.gold}` : "2px solid transparent", background: tab === id ? "rgba(200,160,64,0.05)" : "transparent" }} onClick={() => setTab(id)}>{label}</div>
                ))}
              </div>
              {/* 2段目: ツールバー（左=操作 / 右=表示設定） */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: `1px solid ${C.border}55`, background: "rgba(255,255,255,0.015)", padding: "1px 5px" }}>
                <div style={{ display: "flex", gap: 2 }}>
                  {isGm && (
                    <div onClick={() => { if (undoCount > 0 && undo && window.confirm("直近の操作を1つ取り消しますか？")) undo(); }} title={undoCount > 0 ? `直近の操作を取り消す（${undoCount}件）` : "取り消せる操作はありません"} style={{ padding: "4px 10px", fontSize: 13, cursor: undoCount > 0 ? "pointer" : "default", color: undoCount > 0 ? C.gold : "#2a3545", opacity: undoCount > 0 ? 1 : 0.6 }}>↩</div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 2 }}>
                  <div onClick={() => setShowBgm(v => !v)} title="BGM設定" style={{ padding: "4px 10px", fontSize: 13, cursor: "pointer", color: bgmMuted ? C.textFaint : C.gold }}>{bgmMuted ? "🔈" : "🎵"}</div>
                  <div onClick={toggleMotion} title={motionReduced ? "演出: 抑制中（クリックで通常に戻す）" : "演出: 通常（クリックで抑制）"} style={{ padding: "4px 10px", fontSize: 13, cursor: "pointer", color: motionReduced ? C.textFaint : C.gold }}>{motionReduced ? "🚫" : "🎬"}</div>
                  <div onClick={cycleFont} title={`文字サイズ: ${fontScale.label}（クリックで変更）`} style={{ padding: "4px 10px", fontSize: 11 + fontLevel * 2, lineHeight: 1.2, cursor: "pointer", color: fontLevel > 0 ? C.gold : C.textFaint, fontWeight: fontLevel > 0 ? 700 : 400 }}>A</div>
                  <div onClick={() => setShowShortcuts(true)} title="キーボードショートカット (?)" style={{ padding: "4px 10px", fontSize: 13, cursor: "pointer", color: C.textFaint }}>⌨</div>
                </div>
              </div>
            </div>

            {showBgm && (
              <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}`, background: "rgba(255,255,255,0.015)", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <button
                    onClick={() => setBgmMuted(bgm.toggleMute())}
                    style={{ padding: "4px 10px", fontSize: 11, cursor: "pointer", borderRadius: 4, background: bgmMuted ? "rgba(255,255,255,0.03)" : "rgba(200,160,64,0.2)", border: `1px solid ${bgmMuted ? C.border : C.goldDim}`, color: bgmMuted ? C.textFaint : C.gold }}
                  >{bgmMuted ? "🔈 BGM OFF" : "🎵 BGM ON"}</button>
                  <input
                    type="range" min="0" max="1" step="0.05" value={bgmVol}
                    onChange={e => { const v = parseFloat(e.target.value); setBgmVol(v); bgm.setVolume(v); }}
                    style={{ flex: 1, accentColor: C.gold, cursor: "pointer" }}
                    title="音量"
                  />
                  <span style={{ fontSize: 9, color: C.textFaint, minWidth: 28, textAlign: "right" }}>{Math.round(bgmVol * 100)}%</span>
                </div>
                <div style={{ fontSize: 8, color: C.textFaint, lineHeight: 1.6, marginBottom: isGm ? 8 : 0 }}>
                  ※ BGMは各自のブラウザでローカル再生されます{!bgm.unlocked && "（画面をクリックすると再生開始）"}
                </div>
                {isGm && (
                  <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                    <div style={{ fontSize: 9, color: C.red, letterSpacing: 1, marginBottom: 6 }}>▶ GM: BGMの設定</div>
                    
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, padding: "4px", background: "rgba(200,160,64,0.1)", borderRadius: 4, border: `1px solid ${C.goldDim}` }}>
                      <span style={{ fontSize: 9, color: C.gold, minWidth: 52 }}>手動再生</span>
                      <input
                        value={(gs.bgm || {}).override || ""}
                        onChange={e => { const v = e.target.value; upd(p => ({ ...p, bgm: { ...(p.bgm || {}), override: v } })); }}
                        placeholder="フェーズBGMを一時的に上書き"
                        style={{ ...iStyle, flex: 1, fontSize: 9, padding: "4px 6px", borderColor: "transparent", background: "rgba(0,0,0,0.3)" }}
                      />
                      {(gs.bgm || {}).override && (
                        <button 
                          onClick={() => upd(p => ({ ...p, bgm: { ...(p.bgm || {}), override: "" } }))}
                          style={{ background: "transparent", border: "none", color: C.textDim, cursor: "pointer", fontSize: 12, padding: "2px 6px" }}
                          title="手動再生を解除して元のBGMに戻す"
                        >✕</button>
                      )}
                    </div>

                    {[["explore", "探索/導入"], ["battle", "弾幕ごっこ"], ["end", "セッション終了"]].map(([key, label]) => (
                      <div key={key} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                        <span style={{ fontSize: 9, color: C.textDim, minWidth: 56 }}>{label}</span>
                        <input
                          value={(gs.bgm || {})[key] || ""}
                          onChange={e => { const v = e.target.value; upd(p => ({ ...p, bgm: { ...(p.bgm || {}), [key]: v } })); }}
                          placeholder="https://…（mp3/ogg）"
                          style={{ ...iStyle, flex: 1, fontSize: 9, padding: "4px 6px" }}
                        />
                      </div>
                    ))}
                    <div style={{ fontSize: 8, color: C.textFaint, lineHeight: 1.6, marginTop: 4 }}>
                      ※ 手動再生に入力するとフェーズのBGMより優先されます。空欄にしたり✕を押すと、フェーズに応じたBGMに戻ります。
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
              {tab === "progress" && (
                <div>
                  {/* 任意ダイス（GM裁定・自作判定用） */}
                  <div style={{ marginBottom: 8, padding: 6, background: "rgba(255,255,255,0.02)", border: `1px solid ${C.border}`, borderRadius: 4 }}>
                    <div style={{ fontSize: 9, color: C.gold, marginBottom: 4 }}>🎲 任意ダイス</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 3, alignItems: "center" }}>
                      {[1, 2, 3].map(n => <button key={n} onClick={() => rollFreeDice(n, "nd6")} style={{ padding: "3px 8px", fontSize: 9, cursor: "pointer", borderRadius: 3, background: C.blueBg, border: `1px solid ${C.blueBorder}`, color: C.blue }}>{n}D6</button>)}
                      <button onClick={() => rollFreeDice(2, "d66")} style={{ padding: "3px 8px", fontSize: 9, cursor: "pointer", borderRadius: 3, background: C.purpleBg, border: `1px solid ${C.purpleBorder}`, color: C.purple }}>D66</button>
                      <span style={{ width: 1, height: 16, background: C.border }} />
                      <input type="number" min={1} max={12} value={freeDiceN} onChange={e => setFreeDiceN(Math.max(1, Math.min(12, parseInt(e.target.value) || 1)))} style={{ width: 36, padding: "2px 4px", fontSize: 10, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, color: C.text, borderRadius: 3 }} />
                      <button onClick={() => rollFreeDice(freeDiceN, "nd6")} style={{ padding: "3px 8px", fontSize: 9, cursor: "pointer", borderRadius: 3, background: C.goldBg, border: `1px solid ${C.goldDim}`, color: C.gold }}>D6を振る</button>
                    </div>
                    {freeDiceLast && <div style={{ fontSize: 10, color: C.text, marginTop: 4 }}>結果: <span style={{ color: C.gold }}>{freeDiceLast}</span></div>}
                  </div>

                  <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginBottom: 6 }}>クエスト</div>
                  {(gs.quests ||[]).length === 0 ? (
                    <div style={{ fontSize: 10, color: "#2a3545", marginBottom: 8 }}>なし</div>
                  ) : (
                    (gs.quests ||[]).map(q => {
                      const isExpanded = expandedQuests[q.id];
                      const isReadyToSolve = !q.solved && (q.clues || 0) >= q.level;
                      
                      const toggleExpand = () => {
                        setExpandedQuests(prev => ({ ...prev, [q.id]: !prev[q.id] }));
                      };

                      return (
                        <div key={q.id || q.name} style={{ marginBottom: 4, background: q.solved ? "rgba(27,94,32,0.08)" : "rgba(255,255,255,0.02)", border: `1px solid ${q.solved ? "#1b5e20" : isReadyToSolve ? C.goldDim : C.border}`, borderRadius: 3, overflow: "hidden" }}>
                          
                          <div 
                            onClick={toggleExpand}
                            style={{ padding: "6px 8px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, transition: "background 0.2s" }}
                            onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                          >
                            <div style={{ fontSize: 8, color: C.textFaint }}>{isExpanded ? "▼" : "▶"}</div>
                            
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <span style={{ fontSize: 11, color: q.solved ? "#4caf50" : isReadyToSolve ? C.gold : C.text, textDecoration: q.solved ? "line-through" : "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  【Lv.{q.level}】{q.name}
                                </span>
                                {isReadyToSolve && <span style={{ fontSize: 8, color: C.gold, animation: "fadeUp 0.5s ease infinite alternate" }}>✨</span>}
                              </div>
                              
                              {!q.solved && (
                                <div style={{ fontSize: 8, color: isReadyToSolve ? C.gold : "#00bcd4", marginTop: 1 }}>
                                  {isReadyToSolve ? "調査完了：解決可能" : `💡 手がかり: ${q.clues || 0}/${q.level}`}
                                </div>
                              )}
                            </div>

                            {isGm && (
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  upd(p => {
                                    const isNowSolved = !q.solved;
                                    let nextQuests = p.quests.map(x => x.id === q.id ? { ...x, solved: isNowSolved } : x);
                                    if (isNowSolved) {
                                      const allScenarioQuests = p.scenarioData?.quests || [];
                                      allScenarioQuests.forEach(scQ => {
                                        if (scQ.unlockType === "quest" && String(scQ.unlockQuestId) === String(q.id)) {
                                          if (!nextQuests.find(nq => String(nq.id) === String(scQ.id))) {
                                            nextQuests.push({ ...scQ, revealed: true, solved: false, clues: 0 });
                                          }
                                        }
                                      });
                                    }
                                    return { ...p, quests: nextQuests };
                                  });
                                }}
                                style={{ width: 20, height: 20, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: q.solved ? C.red : "#4caf50", cursor: "pointer", borderRadius: 2, fontSize: 12, padding: 0 }}
                                >
                                {q.solved ? "↩" : "✓"}
                              </button>
                            )}
                          </div>

                          {isExpanded && (
                            <div style={{ padding: "0 8px 8px 22px", borderTop: "1px solid rgba(255,255,255,0.03)", animation: "fadeUp 0.2s ease" }}>
                              <div style={{ fontSize: 9, color: C.textDim, marginTop: 6, lineHeight: 1.4 }}>{q.summary}</div>
                              
                              {(isReadyToSolve || q.solved || isGm) && (
                                <div style={{ marginTop: 6, padding: "4px 6px", background: "rgba(200,160,64,0.05)", borderRadius: 2, borderLeft: `2px solid ${C.goldDim}` }}>
                                  <div style={{ fontSize: 8, color: C.goldDim, letterSpacing: 1, fontWeight: "bold" }}>真相 / 解決場所</div>
                                  <div style={{ fontSize: 9, color: C.text, marginTop: 2, whiteSpace: "pre-wrap" }}>{q.truth || "（真相なし）"}</div>
                                  {q.location && (
                                    <div style={{ fontSize: 9, color: "#90caf9", marginTop: 2 }}>📍 解決場所: {getSpot(q.location)?.name || `スポット[${q.location}]`}</div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}

                  {!isIntro && (gs.clues ||[]).length > 0 && (
                    <>
                      <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginBottom: 6, marginTop: 10 }}>手がかり配置済み</div>
                      {gs.clues.map(id => (
                        <div key={id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, padding: "2px 0" }}>
                          <span style={{ color: "#00bcd4" }}>💡[{getSpot(id)?.roll}] {getSpot(id)?.name}</span>
                          {isGm && <button onClick={() => upd(p => ({ ...p, clues: p.clues.filter(c => c !== id) }))} style={{ width: 16, height: 16, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, color: C.red, cursor: "pointer", borderRadius: 2, fontSize: 10, padding: 0 }}>✕</button>}
                        </div>
                      ))}
                    </>
                  )}
                  {gs.newspaper && !isIntro && (
                    <>
                      <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginBottom: 6, marginTop: 10 }}>本日の新聞</div>
                      <div style={{ padding: "6px 10px", background: C.blueBg, border: `1px solid ${C.blueBorder}`, borderRadius: 2, cursor: "pointer", borderLeft: `3px solid ${C.blue}` }} onClick={() => setPaperModal(gs.newspaper)}>
                        <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 2 }}>[{gs.newspaper.roll}]</div>
                        <div style={{ fontSize: 11, color: C.blue }}>{gs.newspaper.title}</div>
                      </div>
                    </>
                  )}
                  {gs.dice?.results && (
                    <div style={{ marginTop: 12, textAlign: "center" }}>
                      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 4 }}>
                        {gs.dice.results.map((d, i) => (
                          <div key={i} style={{ width: 44, height: 44, border: `2px solid ${gs.dice.rolling ? C.gold : C.goldDim}`, borderRadius: 3, background: "rgba(8,6,18,0.95)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: C.gold, fontWeight: "bold", animation: gs.dice.rolling ? "rollSpin 0.25s ease infinite" : "none", boxShadow: gs.dice.rolling ? `0 0 14px ${C.gold}50` : "none" }}>{d}</div>
                        ))}
                      </div>
                      {!gs.dice?.rolling && <div style={{ fontSize: 16, color: C.gold }}>{gs.dice?.results.join("")}</div>}
                    </div>
                  )}

                  {(gs.diceHistory || []).length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div onClick={() => setShowDiceHistory(v => !v)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginBottom: 6 }}>
                        <span>🎲 ダイス履歴 ({gs.diceHistory.length})</span>
                        <span style={{ fontSize: 9 }}>{showDiceHistory ? "▲" : "▼"}</span>
                      </div>
                      {showDiceHistory && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          {gs.diceHistory.slice(0, 20).map((h, i) => {
                            const mc = h.max === 6 ? C.gold : h.max === 1 ? C.red : C.textDim;
                            const tStr = h.t ? new Date(h.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
                            return (
                              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 6px", borderLeft: `2px solid ${mc}55`, borderBottom: `1px solid ${C.border}18`, fontSize: 10 }}>
                                <span style={{ color: C.textFaint, fontSize: 8, minWidth: 32 }}>{tStr}</span>
                                <span style={{ flex: 1, color: C.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.label}</span>
                                <span style={{ color: mc, fontWeight: "bold", fontFamily: "monospace" }}>{(h.results || []).join(" ")}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {tab === "pcs" && (
                <div>
                  {(gs.pcs || []).length === 0
                    ? <div style={{ fontSize: 10, color: "#2a3545" }}>PCなし</div>
                    : (gs.pcs || []).map(pc => (
                        <PCCard
                          key={pc.uid}
                          pc={pc}
                          gs={gs}
                          isGm={isGm}
                          onUpdatePc={updPc => upd(p => ({ ...p, pcs: p.pcs.map(x => x.uid === pc.uid ? updPc : x) }))}
                          upd={upd}
                          animateDice={animateDice}
                          getSpot={getSpot}
                          SPOTS={SPOTS}
                          room={room}
                          isOnline={!!presence[pc.uid]?.online}
                        />
                      ))
                  }
                </div>
              )}

              {tab === "scene" && isGm && (
                <div>
                  <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginBottom: 8 }}>描写モード</div>
                  <SceneEditor gs={gs} upd={upd} sceneData={sceneData} setSceneData={setSceneData} user={user} />
                </div>
              )}

              {tab === "log" && (() => {
                const logCategory = (e) =>
                  /^(⚔|✦|★|💀|⚖️)/.test(e) ? "combat"
                  : /^(🔵|🛡|💙|💠|🏃|🎬)/.test(e) ? "player"
                  : /^(✅|🎉|🌟|✨)/.test(e) ? "success"
                  : /^(💰|🏆)/.test(e) ? "reward"
                  : "other";
                const logColor = (e) =>
                  /^(🏆|🎉)/.test(e) ? C.gold
                  : /^💀/.test(e) ? C.red
                  : /^(🔮|💜)/.test(e) ? C.purple
                  : /^✨/.test(e) ? C.green
                  : /^(💡|🔍)/.test(e) ? "#00bcd4"
                  : /^(🛡|💠)/.test(e) ? C.blue
                  : /^⚖️/.test(e) ? C.gold
                  : C.textDim;
                const FILTERS = [
                  { key: "all", label: "すべて", color: C.textDim },
                  { key: "combat", label: "戦闘", color: C.red },
                  { key: "player", label: "行動", color: C.blue },
                  { key: "success", label: "成功", color: C.green },
                  { key: "reward", label: "報酬", color: C.gold },
                ];
                const allLogs = gs.log || [];
                const q = logSearch.trim();
                // 元配列の index を保持（同一文言の重複ログでも key が一意になるよう）
                const filtered = allLogs
                  .map((e, idx) => ({ e, idx }))
                  .filter(({ e }) =>
                    (logFilter === "all" || logCategory(e) === logFilter) &&
                    (q === "" || e.includes(q))
                  );
                return (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginBottom: 6 }}>
                      <span style={{ fontSize: 9, color: C.textFaint, letterSpacing: 2 }}>セッションログ</span>
                      <span style={{ fontSize: 8, color: C.textFaint }}>{filtered.length}/{allLogs.length}</span>
                    </div>
                    <input
                      value={logSearch}
                      onChange={e => setLogSearch(e.target.value)}
                      placeholder="🔍 ログを検索..."
                      style={{ ...iStyle, width: "100%", boxSizing: "border-box", fontSize: 10, padding: "5px 8px", marginBottom: 6 }}
                    />
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 8 }}>
                      {FILTERS.map(f => {
                        const active = logFilter === f.key;
                        return (
                          <button key={f.key} onClick={() => setLogFilter(f.key)}
                            style={{ padding: "2px 9px", fontSize: 9, cursor: "pointer", borderRadius: 10,
                              background: active ? `${f.color}22` : "rgba(255,255,255,0.02)",
                              border: `1px solid ${active ? f.color : C.border}`,
                              color: active ? f.color : C.textFaint }}>
                            {f.label}
                          </button>
                        );
                      })}
                    </div>
                    {allLogs.length === 0 && <div style={{ fontSize: 10, color: C.textFaint }}>なし</div>}
                    {allLogs.length > 0 && filtered.length === 0 && <div style={{ fontSize: 10, color: C.textFaint, textAlign: "center", padding: 8 }}>該当するログがありません</div>}
                    {filtered.map(({ e, idx }) => {
                      const lc = logColor(e);
                      return <div key={idx} style={{ fontSize: 10, color: lc, padding: "3px 6px", borderBottom: `1px solid ${C.border}18`, borderLeft: `2px solid ${lc}55`, marginBottom: 1, animation: "logSlideIn 0.32s ease forwards" }}>{e}</div>;
                    })}
                  </div>
                );
              })()}
            </div>

            {paperModal && (() => { 
              const r = paperModal.roll;
              const isZoro = [11, 22, 33, 44, 55, 66].includes(r);
              const needsSpot = [14, 35, 46].includes(r);
              const is25 = r === 25;
              const is36 = r === 36;
              const is23 = r === 23;
              const is56 = r === 56;

              const saveApplied = (extra = {}) => {
                upd(p => ({ ...p, newspaper: { ...p.newspaper, applied: true, ...extra } }));
                setPaperModal(prev => ({ ...prev, applied: true, ...extra }));
              };

              const applyZoro = () => {
                const target = "66";
                saveApplied({ targetSpot: target });
                upd(p => ({ ...p, log: [`新聞[${r}]の効果が適用された（帰還先に博麗神社を指定可能）`, ...p.log] }));
              };

              const rollTargetSpot = () => {
                animateDice(2, "対象スポットの決定", res => {
                  const spotId = getSpotByD66(res[0], res[1], SPOTS);
                  saveApplied({ targetSpot: spotId });
                  upd(p => ({ ...p, log: [`新聞[${r}]の対象スポットが [${getSpot(spotId)?.name}] に決定した`, ...p.log] }));
                });
              };

              const apply25 = () => {
                animateDice(4, "手がかり2箇所配置", res => {
                  const s1 = getSpotByD66(res[0], res[1], SPOTS);
                  const s2 = getSpotByD66(res[2], res[3], SPOTS);
                  upd(p => ({
                    ...p,
                    newspaper: { ...p.newspaper, applied: true },
                    clues: [...new Set([...(p.clues || []), s1, s2].filter(Boolean))],
                    nonSearchCluePlaced: true, // 実績(鼠算式探索): 探し物以外の手がかり配置
                    log: [`新聞[25]の効果で [${getSpot(s1)?.name}] と [${getSpot(s2)?.name}] に手がかりが追加された`, ...p.log],
                  }));
                  setPaperModal(prev => ({ ...prev, applied: true }));
                });
              };

              const apply36 = () => {
                const count = (gs.clues || []).length;
                if (count > 0) {
                  animateDice(count * 2, "手がかり再配置", res => {
                    const newClues = [];
                    for (let i = 0; i < count; i++) {
                      const s = getSpotByD66(res[i * 2], res[i * 2 + 1], SPOTS);
                      if (s) newClues.push(s);
                    }
                    upd(p => ({
                      ...p,
                      newspaper: { ...p.newspaper, applied: true },
                      clues: [...new Set(newClues)],
                      nonSearchCluePlaced: true, // 実績(鼠算式探索): 探し物以外の手がかり再配置
                      log: [`新聞[36]の効果で、すべての手がかりが再配置された`, ...p.log],
                    }));
                    setPaperModal(prev => ({ ...prev, applied: true }));
                  });
                } else {
                  saveApplied();
                }
              };

              const apply23 = () => {
                upd(p => ({
                  ...p,
                  newspaper: { ...p.newspaper, applied: true },
                  pcs: p.pcs.map(pc => ({
                    ...pc,
                    resources: { ...pc.resources, やる気: { ...pc.resources.やる気, cur: Math.min(pc.resources.やる気.max, (pc.resources.やる気.cur || 0) + 1) } },
                  })),
                  log: [`新聞[23]の効果で、全員のやる気が1回復した！`, ...p.log],
                }));
                setPaperModal(prev => ({ ...prev, applied: true }));
              };

              const apply56 = () => {
                upd(p => ({
                  ...p,
                  newspaper: { ...p.newspaper, applied: true },
                  pcs: p.pcs.map(pc => ({ ...pc, flags: { ...pc.flags, canCureBadStatus: true } })),
                  log: [`新聞[56]の効果で、全員が任意の変調を1つ解除できるようになった！`, ...p.log],
                }));
                setPaperModal(prev => ({ ...prev, applied: true }));
              };

              const isActionNeeded = isZoro || needsSpot || is25 || is36 || is23 || is56;
              const canClose = !isActionNeeded || paperModal.applied;

              return (
                <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => canClose && setPaperModal(null)}>
                  <div style={{ background: "#0c1020", border: "1px solid #1e2d45", borderRadius: 6, padding: 20, maxWidth: 380, width: "90%", animation: "fadeUp 0.2s ease" }} onClick={e => e.stopPropagation()}>
                    <div style={{ fontSize: 9, letterSpacing: 3, color: "#2a3a50", textAlign: "center", marginBottom: 4 }}>— 文々。新聞 —</div>
                    {paperModal.dice && (
                      <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 8 }}>
                        {paperModal.dice.map((d, i) => (
                          <div key={i} style={{ width: 44, height: 44, border: "2px solid #1e3a5a", borderRadius: 6, background: "rgba(14,20,36,0.95)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: "#60c0f0", fontWeight: "bold" }}>{d}</div>
                        ))}
                      </div>
                    )}
                    <div style={{ fontSize: 18, color: "#1976d2", textAlign: "center", marginBottom: 6 }}>[{paperModal.roll}]</div>
                    <div style={{ fontSize: 13, color: "#60c0f0", marginBottom: 8, textAlign: "center" }}>{paperModal.title}</div>
                    <div style={{ fontSize: 11, color: "#4a6070", lineHeight: 1.8, marginBottom: 8 }}>{paperModal.effect}</div>
                    
                    {paperModal.targetSpot && (
                      <div style={{ padding: 6, background: "rgba(255,255,255,0.05)", borderRadius: 4, textAlign: "center", fontSize: 11, color: C.gold, animation: "fadeUp 0.3s ease" }}>
                        対象スポット: {getSpot(paperModal.targetSpot)?.name}
                      </div>
                    )}

                    {/* 風を操る（文）: 新聞表を振り直す（やる気消費はbaseのみ） */}
                    {!paperModal.applied && windHolder && (windHolder.uid === user?.uid || isGm) && (getActiveAbility(windHolder)?.name === "風を操る程度の能力＋" || (windHolder.resources?.やる気?.cur || 0) >= 1) && (
                      <button onClick={windReroll} style={{ ...btnFull("rgba(129,199,132,0.14)", C.greenBorder, C.green), marginTop: 8 }}>🌀 風: 新聞表を振り直す（{windHolder.charName}）</button>
                    )}
                    {isGm && !paperModal.applied && isZoro && <button onClick={applyZoro} style={{ ...btnFull(C.blueBg, C.blueBorder, C.blue), marginTop: 12 }}>適用する</button>}
                    {isGm && !paperModal.applied && needsSpot && <button onClick={rollTargetSpot} style={{ ...btnFull(C.goldBg, C.goldDim, C.gold), marginTop: 12 }}>🎲 対象スポットを決定する</button>}
                    {isGm && !paperModal.applied && is25 && <button onClick={apply25} style={{ ...btnFull(C.goldBg, C.goldDim, C.gold), marginTop: 12 }}>🎲 手がかりを配置する</button>}
                    {isGm && !paperModal.applied && is36 && <button onClick={apply36} style={{ ...btnFull(C.goldBg, C.goldDim, C.gold), marginTop: 12 }}>🎲 手がかりを再配置する</button>}
                    {isGm && !paperModal.applied && is23 && <button onClick={apply23} style={{ ...btnFull(C.blueBg, C.blueBorder, C.blue), marginTop: 12 }}>適用する</button>}
                    {isGm && !paperModal.applied && is56 && <button onClick={apply56} style={{ ...btnFull(C.blueBg, C.blueBorder, C.blue), marginTop: 12 }}>適用する</button>}

                    {(!isGm || canClose) && (
                      <button onClick={() => setPaperModal(null)} style={{ ...btnFull("transparent", C.border, C.textFaint), marginTop: 12 }}>閉じる</button>
                    )}
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </div>

      {showShortcuts && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 130, display: "flex", alignItems: "center", justifyContent: "center", animation: "backdropIn 0.15s ease" }} onClick={() => setShowShortcuts(false)}>
          <SpellCard color={C.gold} title="✦ キーボードショートカット" style={{ maxWidth: 340, width: "90%", animation: "modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                ["1 〜 4", "タブ切り替え（進行／PC一覧／描写／ログ）"],
                ...(isGm ? [["Enter", "状況に応じた主要アクションを実行"]] : []),
                ["M", "効果音 ON / OFF"],
                ["?", "このヘルプを開閉"],
                ["Esc", "ヘルプを閉じる"],
              ].map(([key, desc]) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <kbd style={{ minWidth: 44, textAlign: "center", padding: "3px 8px", fontSize: 11, color: C.gold, background: "rgba(200,160,64,0.12)", border: `1px solid ${C.goldDim}`, borderRadius: 4, fontFamily: "'Noto Serif JP', serif" }}>{key}</kbd>
                  <span style={{ fontSize: 10, color: C.textDim }}>{desc}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 8, color: C.textFaint, marginTop: 12, lineHeight: 1.6 }}>
              ※ 入力欄にカーソルがあるときは無効になります<br />
              ※ タブ右の 🎬 で演出（アニメーション）の抑制を切り替えられます
            </div>
            <button onClick={() => setShowShortcuts(false)} style={{ ...btnFull("rgba(255,255,255,0.05)", C.border, C.textDim), marginTop: 12 }}>閉じる</button>
          </SpellCard>
        </div>
      )}
    </div>
  );
}

function BattleDiceTray({ diceResult, diceAnim, label }) {
  const prevAnimRef = useRef(diceAnim);
  useEffect(() => {
    const wasAnimating = prevAnimRef.current;
    prevAnimRef.current = diceAnim;
    if (!wasAnimating && diceAnim) {
      sfx.diceRoll();
    } else if (wasAnimating && !diceAnim && diceResult?.length > 0) {
      const maxDie = Math.max(...diceResult);
      sfx.diceResult(maxDie);
    }
  }, [diceAnim, diceResult]);

  if (!diceResult?.length && !diceAnim) return <div style={{ height: 20 }} />;

  const displayLabel = label ? label : "DICE ROLL";

  return (
    <div style={{ 
      margin: "0 0 10px 0", 
      padding: "12px 14px", 
      background: "rgba(0,0,0,0.45)", 
      border: `1px solid ${C.border}`, 
      borderRadius: 10,
      textAlign: "center",
      animation: "fadeUp 0.3s ease"
    }}>
      <div style={{ fontSize: 9, color: C.gold, letterSpacing: 2, marginBottom: 8, textTransform: "uppercase" }}>
        {diceAnim ? `${displayLabel} を振っています...` : displayLabel}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
        {(diceResult || [1, 1]).map((d, i) => (
          <div key={i} style={{ 
            width: 36, height: 36, 
            background: diceAnim ? "linear-gradient(180deg, rgba(35,55,90,1), rgba(10,22,36,0.98))" : "rgba(14,20,36,0.95)", 
            border: `2px solid ${diceAnim ? "#64b5f6" : C.blueBorder}`,
            borderRadius: 8,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, color: "#90caf9", fontWeight: "bold",
            animation: diceAnim ? "rollSpin 0.2s ease infinite" : "none",
            boxShadow: diceAnim ? "0 0 18px rgba(96,192,240,0.25)" : "none"
          }}>
            {d}
          </div>
        ))}
      </div>
      {!diceAnim && diceResult && (
        <div style={{ fontSize: 12, color: "#fff", marginTop: 8, fontWeight: "bold" }}>
          RESULT: {diceResult.join(", ")}
        </div>
      )}
    </div>
  );
}

function BattleRightPanel({ gs, upd, user, isGm, animateDice }) {
  const [battleTab, setBattleTab] = useState("info");
  const b = gs.battle;

  // バトル開始時点のログ長をスナップショット → 戦闘中に追加されたログのみ表示
  const battleStartLogRef = useRef((gs.log || [])[0]);
  const battleLogs = useMemo(() => {
    const logs = gs.log || [];
    const idx = logs.findIndex(l => l === battleStartLogRef.current);
    return idx >= 0 ? logs.slice(0, idx) : logs;
  }, [gs.log]);
  const pcCombatant = gs.pcs.find(p => p.uid === b.pcCombatant);
  const npcCombatant = b.participants.npcs.find(n => n.id === b.npcCombatant);

  const participantPcs = b.participantPcUids
    ? (gs.pcs || []).filter(pc => b.participantPcUids.includes(pc.uid))
    : (gs.pcs || []);
  const spectators = participantPcs.filter(p =>
    p.uid !== b.pcCombatant &&
    (p.resources?.残り人数?.cur || 0) > 0
  );

  const isSpectator = spectators.some(p => p.uid === user.uid);
  const _isCombatant = b.pcCombatant === user.uid;

  // PC/NPC 双方の名前を解決（援護/かばうの主体が NPC のこともあるため）
  const npcsList = b.participants?.npcs || [];
  const entityName = (id) => gs.pcs.find(x => x.uid === id)?.charName || npcsList.find(n => n.id === id)?.name || "?";

  // 集団戦で出撃していない生存 NPC（NPC観戦者）。GM が援護/かばうを実行できる。
  const npcSpectators = b.type === "mass"
    ? npcsList.filter(n => n.id !== b.npcCombatant && (n.resources?.残り人数?.cur || 0) > 0)
    : [];

  const isFinalBattle = b.isFinal ?? (b.type === "mass" && !b.questId);
  const bumpIntervene = (pcs, uid) => bumpAch(pcs, uid, a => ({ ...a, intervene: (a.intervene || 0) + 1, ...(isFinalBattle ? { interveneDecisive: (a.interveneDecisive || 0) + 1 } : {}) }));
  const handleSupportFire = (userUid) => {
    upd(p => ({
      ...p,
      pcs: bumpIntervene(p.pcs, userUid),
      battle: {
        ...p.battle,
        supportDice: (p.battle.supportDice || 0) + 1,
        usedIntervention: { ...p.battle.usedIntervention, [userUid]: "support" }
      },
      log: [`💥 ${entityName(userUid)} の援護射撃！攻撃ダイスが増加します。`, ...p.log]
    }));
  };

  const handleCover = (userUid, targetUid) => {
    animateDice(1, "かばう", (res) => {
      const die = res[0];
      upd(p => {
        const currentGrid = [...(p.battle.grids[targetUid] || [0,0,0,0,0,0])];
        let success = false;
        if (currentGrid[die - 1] > 0) {
          currentGrid[die - 1] -= 1;
          success = true;
        }
        return {
          ...p,
          pcs: bumpIntervene(p.pcs, userUid),
          battle: {
            ...p.battle,
            grids: { ...p.battle.grids, [targetUid]: currentGrid },
            usedIntervention: { ...p.battle.usedIntervention, [userUid]: "cover" }
          },
          log: [`🛡️ ${entityName(userUid)} が ${die}番マスをかばった！ ${success ? "弾幕を除去しました。" : "しかしそこには弾幕がなかった！"}`, ...p.log]
        };
      });
    });
  };
  const interventionUsed = b.usedIntervention?.[user.uid];

  // ─── ホークビーコン（extra_familiar_per_round_this_phase）: フェイズ中・毎ラウンド1回の追加介入 ───
  // 通常の観戦者介入(usedIntervention)とは別カウント(usedExtraFamiliar)で管理する。
  const hasHawkBeacon = (b.extraFamiliarPhase || []).includes(user.uid);
  const usedHawk = b.usedExtraFamiliar?.[user.uid];
  const handleHawkSupport = () => {
    upd(p => ({
      ...p,
      battle: {
        ...p.battle,
        supportDice: (p.battle.supportDice || 0) + 1,
        usedExtraFamiliar: { ...p.battle.usedExtraFamiliar, [user.uid]: "support" },
      },
      log: [`💥 ${entityName(user.uid)} のホークビーコン援護射撃！攻撃ダイスが増加します。`, ...p.log],
    }));
  };
  const handleHawkCover = (targetUid) => {
    animateDice(1, "ホークビーコンかばう", (res) => {
      const die = res[0];
      upd(p => {
        const grid = [...(p.battle.grids[targetUid] || [0,0,0,0,0,0])];
        const success = grid[die - 1] > 0;
        if (success) grid[die - 1] -= 1;
        return {
          ...p,
          battle: {
            ...p.battle,
            grids: { ...p.battle.grids, [targetUid]: grid },
            usedExtraFamiliar: { ...p.battle.usedExtraFamiliar, [user.uid]: "cover" },
          },
          log: [`🛡️ ${entityName(user.uid)} のホークビーコンかばう！${die}番マス ${success ? "弾幕除去" : "弾幕なし"}`, ...p.log],
        };
      });
    });
  };

  // ─── 追加援護/かばう（extraInterventionPool）ハンドラ ───
  const handleExtraSupport = () => {
    const myName = gs.pcs.find(x => x.uid === user.uid)?.charName || "?";
    upd(p => ({
      ...p,
      battle: {
        ...p.battle,
        supportDice: (p.battle.supportDice || 0) + 1,
        extraInterventionPool: { ...p.battle.extraInterventionPool, remaining: (p.battle.extraInterventionPool?.remaining || 0) - 1 },
      },
      log: [`💥 ${myName} の追加援護射撃！攻撃ダイスが増加します。`, ...p.log],
    }));
  };

  const handleExtraCover = () => {
    const pool = b.extraInterventionPool;
    const targetUid = b.phase === "npc_shot_after" ? b.pcCombatant : b.npcCombatant;
    const myName = gs.pcs.find(x => x.uid === user.uid)?.charName || "?";
    if (pool?.withDieChoice) {
      const usedDice = pool.usedDice || [];
      const available = [1, 2, 3, 4, 5, 6].filter(d => !usedDice.includes(d));
      if (available.length === 0) return;
      const input = parseInt(window.prompt(`かばうマスを選んでください（使用可能: ${available.join(", ")}）`, String(available[0])));
      if (!available.includes(input)) return;
      upd(p => {
        const grid = [...(p.battle.grids[targetUid] || [0, 0, 0, 0, 0, 0])];
        const success = grid[input - 1] > 0;
        if (success) grid[input - 1] -= 1;
        return {
          ...p,
          battle: {
            ...p.battle,
            grids: { ...p.battle.grids, [targetUid]: grid },
            extraInterventionPool: { ...p.battle.extraInterventionPool, remaining: (p.battle.extraInterventionPool?.remaining || 0) - 1, usedDice: [...usedDice, input] },
          },
          log: [`🛡️ ${myName} が ${input}番マスをかばう（任意選択）！ ${success ? "弾幕を除去しました。" : "しかしそこには弾幕がなかった！"}`, ...p.log],
        };
      });
    } else {
      animateDice(1, "追加かばう", res => {
        const die = res[0];
        upd(p => {
          const grid = [...(p.battle.grids[targetUid] || [0, 0, 0, 0, 0, 0])];
          const success = grid[die - 1] > 0;
          if (success) grid[die - 1] -= 1;
          return {
            ...p,
            battle: {
              ...p.battle,
              grids: { ...p.battle.grids, [targetUid]: grid },
              extraInterventionPool: { ...p.battle.extraInterventionPool, remaining: (p.battle.extraInterventionPool?.remaining || 0) - 1 },
            },
            log: [`🛡️ ${myName} が ${die}番マスを追加かばい！ ${success ? "弾幕を除去しました。" : "しかしそこには弾幕がなかった！"}`, ...p.log],
          };
        });
      });
    }
  };

  // ─── NPC ステータスカード ───
  const renderNpcCard = (npc, isCurrent) => {
    const npcId = npc.id;
    const graze = npc.resources?.グレイズ?.cur ?? 0;
    return (
      <div key={npcId} style={{
        padding: "8px 10px",
        background: "rgba(192,57,43,0.1)",
        border: `1px solid ${isCurrent ? C.red : C.redBorder}`,
        borderRadius: 6,
        boxShadow: isCurrent ? `0 0 10px ${C.red}33` : "none",
      }}>
        <div style={{ fontSize: 8, color: C.red, letterSpacing: 2, marginBottom: 2 }}>
          {isCurrent ? "▶ ENEMY" : "ENEMY"}
        </div>
        <div style={{ fontSize: 11, color: "#fff", fontWeight: "bold" }}>{npc.name}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, marginTop: 4 }}>
          <div style={{ fontSize: 9, color: C.textDim }}>残り人数: <span style={{color:C.red}}>{npc.resources?.残り人数?.cur ?? 0}</span></div>
          <div style={{ fontSize: 9, color: C.textDim }}>スペルカード: <span style={{color:C.purple}}>{npc.resources?.スペルカード?.cur ?? 0}</span></div>
          <div style={{ fontSize: 9, color: C.textDim }}>攻撃力: <span style={{color:C.gold}}>{calcShotDiceCount(npc.resources?.攻撃力?.cur ?? 0, 0, hasOfficialSkill(npc, "使い魔"))}</span>{hasOfficialSkill(npc, "使い魔") && <span style={{fontSize:8,color:C.textFaint}}> (-1)</span>}</div>
          <div style={{ fontSize: 9, color: C.textDim, display: "flex", alignItems: "center", gap: 6 }}>
            グレイズ: <span style={{color:C.green}}>{graze}点</span>
            {isGm && hasOfficialSkill(npc, "弾貨") && graze >= 4 && (
              <button
                onClick={() => upd(p => {
                  const n0 = p.battle.participants.npcs.find(n => n.id === npcId);
                  if (!n0) return p;
                  const ng = (n0.resources.グレイズ?.cur || 0) - 4;
                  const ns = Math.min((n0.resources.スペルカード?.max || 9), (n0.resources.スペルカード?.cur || 0) + 1);
                  return {
                    ...p,
                    battle: { ...p.battle, participants: { ...p.battle.participants,
                      npcs: p.battle.participants.npcs.map(n => n.id !== npcId ? n : {
                        ...n,
                        resources: { ...n.resources,
                          グレイズ:     { ...n.resources.グレイズ,     cur: ng },
                          スペルカード: { ...n.resources.スペルカード, cur: ns },
                        },
                      }),
                    }},
                    log: [`💠 ${n0.name} 『弾貨』グレイズ4点消費 → スペルカード+1 (現在:${ns})`, ...p.log],
                  };
                })}
                style={{ fontSize: 8, padding: "1px 5px", background: "rgba(171,71,188,0.2)", border: "1px solid #7b1fa2", color: "#ce93d8", borderRadius: 3, cursor: "pointer" }}
              >弾貨</button>
            )}
            {isGm && graze >= 5 && (
              <button
                onClick={() => upd(p => {
                  const n0 = p.battle.participants.npcs.find(n => n.id === npcId);
                  if (!n0) return p;
                  const ng = (n0.resources.グレイズ?.cur || 0) - 5;
                  const ns = Math.min((n0.resources.スペルカード?.max || 9), (n0.resources.スペルカード?.cur || 0) + 1);
                  return {
                    ...p,
                    battle: { ...p.battle, participants: { ...p.battle.participants,
                      npcs: p.battle.participants.npcs.map(n => n.id !== npcId ? n : {
                        ...n,
                        resources: { ...n.resources,
                          グレイズ:     { ...n.resources.グレイズ,     cur: ng },
                          スペルカード: { ...n.resources.スペルカード, cur: ns },
                        },
                      }),
                    }},
                    log: [`💠 ${n0.name} グレイズ5点消費 → スペルカード+1 (現在:${ns})`, ...p.log],
                  };
                })}
                style={{ fontSize: 8, padding: "1px 5px", background: "rgba(171,71,188,0.2)", border: "1px solid #7b1fa2", color: "#ce93d8", borderRadius: 3, cursor: "pointer" }}
              >G→SC</button>
            )}
          </div>
          <div style={{ fontSize: 9, color: C.textDim }}>回避力: <span style={{color:C.blue}}>{npc.resources?.回避力?.cur ?? 3}</span></div>
        </div>
      </div>
    );
  };

  // ─── PC ステータスカード ───
  const renderPcCard = (pc, isCurrent) => {
    const pcUid = pc.uid;
    const graze = pc.resources?.グレイズ?.cur ?? 0;
    return (
      <div key={pcUid} style={{
        padding: "8px 10px",
        background: "rgba(25,118,210,0.1)",
        border: `1px solid ${isCurrent ? C.blue : C.blueBorder}`,
        borderRadius: 6,
        boxShadow: isCurrent ? `0 0 10px ${C.blue}33` : "none",
      }}>
        <div style={{ fontSize: 8, color: C.blue, letterSpacing: 2, marginBottom: 2 }}>
          {isCurrent ? "▶ PLAYER" : "PLAYER"}
        </div>
        <div style={{ fontSize: 11, color: "#fff", fontWeight: "bold" }}>{pc.charName}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, marginTop: 4 }}>
          <div style={{ fontSize: 9, color: C.textDim }}>残り人数: <span style={{color:C.red}}>{pc.resources?.残り人数?.cur ?? 0}</span></div>
          <div style={{ fontSize: 9, color: C.textDim }}>スペルカード: <span style={{color:C.purple}}>{pc.resources?.スペルカード?.cur ?? 0}</span></div>
          <div style={{ fontSize: 9, color: C.textDim, display: "flex", alignItems: "center", gap: 6 }}>
            グレイズ: <span style={{color:C.green}}>{graze}点</span>
            {hasOfficialSkill(pc, "弾貨") && graze >= 4 && (
              <button
                onClick={() => upd(p => {
                  const x0 = p.pcs.find(x => x.uid === pcUid);
                  if (!x0) return p;
                  const ng = (x0.resources.グレイズ?.cur || 0) - 4;
                  const ns = Math.min((x0.resources.スペルカード?.max || 9), (x0.resources.スペルカード?.cur || 0) + 1);
                  return { ...p,
                    pcs: p.pcs.map(x => x.uid !== pcUid ? x : { ...x, resources: { ...x.resources,
                      グレイズ:     { ...x.resources.グレイズ,     cur: ng },
                      スペルカード: { ...x.resources.スペルカード, cur: ns },
                    }}),
                    log: [`💎 ${x0.charName} 弾貨：G4→SC+1(${ns})`, ...p.log],
                  };
                })}
                style={{ fontSize: 8, padding: "1px 5px", background: "rgba(100,181,246,0.2)", border: `1px solid ${C.blueBorder}`, color: C.blue, borderRadius: 3, cursor: "pointer" }}
              >弾貨(4G→SC)</button>
            )}
            {graze >= 5 && (
              <button
                onClick={() => upd(p => {
                  const x0 = p.pcs.find(x => x.uid === pcUid);
                  if (!x0) return p;
                  const ng = (x0.resources.グレイズ?.cur || 0) - 5;
                  const ns = Math.min((x0.resources.スペルカード?.max || 9), (x0.resources.スペルカード?.cur || 0) + 1);
                  return {
                    ...p,
                    pcs: p.pcs.map(x => x.uid !== pcUid ? x : {
                      ...x,
                      resources: { ...x.resources,
                        グレイズ:     { ...x.resources.グレイズ,     cur: ng },
                        スペルカード: { ...x.resources.スペルカード, cur: ns },
                      },
                    }),
                    log: [`💠 ${x0.charName} グレイズ5点消費 → スペルカード+1 (現在:${ns})`, ...p.log],
                  };
                })}
                style={{ fontSize: 8, padding: "1px 5px", background: "rgba(171,71,188,0.2)", border: "1px solid #7b1fa2", color: "#ce93d8", borderRadius: 3, cursor: "pointer" }}
              >G→SC</button>
            )}
          </div>
          <div style={{ fontSize: 9, color: C.textDim }}>回避力: <span style={{color:C.blue}}>{pc.resources?.回避力?.cur ?? 3}</span></div>
        </div>
      </div>
    );
  };

  // 表示対象（通常: 選出された2名のみ、集団戦: 生存全員）
  const isMassBattle = b.type === "mass";
  const npcsToShow = isMassBattle
    ? (b.participants?.npcs || []).filter(n => (n.resources?.残り人数?.cur ?? 0) > 0)
    : (npcCombatant ? [npcCombatant] : []);
  const pcsToShow = isMassBattle
    ? gs.pcs.filter(p => (p.resources?.残り人数?.cur ?? 0) > 0)
    : (pcCombatant ? [pcCombatant] : []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, marginBottom: 10, flexShrink: 0 }}>
        <button 
          onClick={() => setBattleTab("info")}
          style={{ 
            flex: 1, padding: "6px", fontSize: 10, cursor: "pointer",
            background: battleTab === "info" ? "rgba(200,160,64,0.1)" : "transparent",
            color: battleTab === "info" ? C.gold : C.textFaint,
            border: "none", borderBottom: battleTab === "info" ? `2px solid ${C.gold}` : "2px solid transparent"
          }}
        >情報</button>
        <button 
          onClick={() => setBattleTab("log")}
          style={{ 
            flex: 1, padding: "6px", fontSize: 10, cursor: "pointer",
            background: battleTab === "log" ? "rgba(200,160,64,0.1)" : "transparent",
            color: battleTab === "log" ? C.gold : C.textFaint,
            border: "none", borderBottom: battleTab === "log" ? `2px solid ${C.gold}` : "2px solid transparent"
          }}
        >ログ</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", paddingRight: 4 }}>
        {battleTab === "info" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {npcsToShow.length === 0 && pcsToShow.length === 0 ? (
              <div style={{ padding: "20px 10px", textAlign: "center", color: C.textFaint, fontSize: 10 }}>
                対戦者を選出すると<br />ステータスが表示されます
              </div>
            ) : (
              <>
                {isMassBattle && npcsToShow.length > 0 && (
                  <div style={{ fontSize: 8, color: C.red, letterSpacing: 2, opacity: 0.8 }}>◆ 敵陣 ({npcsToShow.length})</div>
                )}
                {npcsToShow.map(n => renderNpcCard(n, n.id === b.npcCombatant))}
                {isMassBattle && pcsToShow.length > 0 && (
                  <div style={{ fontSize: 8, color: C.blue, letterSpacing: 2, opacity: 0.8, marginTop: 4 }}>◆ PC陣 ({pcsToShow.length})</div>
                )}
                {pcsToShow.map(p => renderPcCard(p, p.uid === b.pcCombatant))}
              </>
            )}

            {isSpectator && pcCombatant && npcCombatant && (
              <div style={{ padding: 10, background: "rgba(200,160,64,0.1)", border: `1px solid ${C.goldDim}`, borderRadius: 6 }}>
                <div style={{ fontSize: 9, color: C.gold, letterSpacing: 1, marginBottom: 6 }}>観戦者介入</div>
                {interventionUsed ? (
                  <div style={{ fontSize: 9, color: C.textFaint, textAlign: "center" }}>使用済み ({interventionUsed === "support" ? "援護" : "かばう"})</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {/* 援護射撃: 味方(PC)のショット直前のみ。かばう: 敵(NPC)のショット直後のみ。 */}
                    <button
                      onClick={() => handleSupportFire(user.uid)}
                      disabled={!["pc_shot_intro","pc_shot_roll"].includes(b.phase)}
                      style={{...btnFull(C.redBg, C.redBorder, C.red), fontSize: 9, padding: "4px"}}
                    >💥 援護射撃<span style={{ fontSize: 7, color: C.textFaint, marginLeft: 3 }}>味方ショット前</span></button>

                    <button
                      onClick={() => handleCover(user.uid, b.pcCombatant)}
                      disabled={b.phase !== "npc_shot_after"}
                      style={{...btnFull(C.greenBg, C.greenBorder, C.green), fontSize: 9, padding: "4px"}}
                    >🛡️ かばう<span style={{ fontSize: 7, color: C.textFaint, marginLeft: 3 }}>敵ショット後</span></button>
                  </div>
                )}
              </div>
            )}

            {/* NPC観戦者の介入（集団戦・GM操作）: 出撃NPCを援護射撃 or かばう */}
            {isGm && npcSpectators.length > 0 && pcCombatant && npcCombatant && (
              <div style={{ padding: 10, background: "rgba(192,57,43,0.08)", border: `1px solid ${C.redBorder}`, borderRadius: 6 }}>
                <div style={{ fontSize: 9, color: C.red, letterSpacing: 1, marginBottom: 6 }}>NPC観戦者の介入（GM）</div>
                {npcSpectators.map(n => {
                  const used = b.usedIntervention?.[n.id];
                  return (
                    <div key={n.id} style={{ marginBottom: 6, paddingBottom: 6, borderBottom: `1px solid ${C.border}33` }}>
                      <div style={{ fontSize: 9, color: C.textDim, marginBottom: 3 }}>{n.name}</div>
                      {used ? (
                        <div style={{ fontSize: 8, color: C.textFaint }}>使用済み ({used === "support" ? "援護" : "かばう"})</div>
                      ) : (
                        <div style={{ display: "flex", gap: 4 }}>
                          {/* NPC観戦者: 援護=味方(NPC)ショット直前のみ。かばう=敵(PC)ショット直後のみ。 */}
                          <button
                            onClick={() => handleSupportFire(n.id)}
                            disabled={!["npc_shot_intro","npc_shot_roll"].includes(b.phase)}
                            style={{...btnFull(C.redBg, C.redBorder, C.red), fontSize: 8, padding: "3px", flex: 1}}
                          >💥 援護</button>
                          <button
                            onClick={() => handleCover(n.id, b.npcCombatant)}
                            disabled={b.phase !== "pc_shot_after"}
                            style={{...btnFull(C.greenBg, C.greenBorder, C.green), fontSize: 8, padding: "3px", flex: 1}}
                          >🛡️ かばう</button>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div style={{ fontSize: 8, color: C.textFaint, lineHeight: 1.5 }}>援護＝NPC攻撃ステップ／かばう＝PC攻撃後（NPC被弾時）</div>
              </div>
            )}

            {/* ホークビーコン: フェイズ中・毎ラウンド1回の追加介入（対戦者でも観戦者として行える） */}
            {hasHawkBeacon && pcCombatant && npcCombatant && (
              <div style={{ padding: 10, background: "rgba(120,160,80,0.1)", border: "1px solid #7a9a50", borderRadius: 6 }}>
                <div style={{ fontSize: 9, color: "#a8c878", letterSpacing: 1, marginBottom: 6 }}>🦅 ホークビーコン（毎ラウンド1回）</div>
                {usedHawk ? (
                  <div style={{ fontSize: 9, color: C.textFaint, textAlign: "center" }}>このラウンドは使用済み ({usedHawk === "support" ? "援護" : "かばう"})</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <button
                      onClick={handleHawkSupport}
                      disabled={!["pc_shot_intro","npc_shot_intro","pc_shot_roll","npc_shot_roll"].includes(b.phase)}
                      style={{...btnFull(C.redBg, C.redBorder, C.red), fontSize: 9, padding: "4px"}}
                    >💥 援護射撃</button>
                    <button
                      onClick={() => handleHawkCover(b.phase === "npc_shot_after" ? b.pcCombatant : b.npcCombatant)}
                      disabled={b.phase !== "npc_shot_after" && b.phase !== "pc_shot_after"}
                      style={{...btnFull(C.greenBg, C.greenBorder, C.green), fontSize: 9, padding: "4px"}}
                    >🛡️ かばう</button>
                  </div>
                )}
              </div>
            )}

            {/* 追加援護/かばう権（extra_support_cover 系スペルカード）: 宣言者(対戦者)自身が使う。
                援護=自分のショット直前 / かばう=相手のショット直後（フェイズ整合）。NPC宣言はGM操作。 */}
            {b.extraInterventionPool && b.extraInterventionPool.remaining > 0 && (() => {
              const pool = b.extraInterventionPool;
              const declarerIsPc = pool.declarerUid === b.pcCombatant;
              const canUse = user.uid === pool.declarerUid || (isGm && pool.declarerUid === b.npcCombatant);
              if (!canUse) return null;
              const supportPhases = declarerIsPc ? ["pc_shot_intro", "pc_shot_roll"] : ["npc_shot_intro", "npc_shot_roll"];
              const coverPhase    = declarerIsPc ? "npc_shot_after" : "pc_shot_after";
              return (
                <div style={{ padding: 10, background: "rgba(200,160,64,0.08)", border: `1px solid ${C.goldDim}`, borderRadius: 6 }}>
                  <div style={{ fontSize: 9, color: C.gold, letterSpacing: 1, marginBottom: 6 }}>
                    ✨ 追加介入権 ({pool.remaining}回残り){pool.withDieChoice && <span style={{ color: C.textFaint, fontSize: 8 }}> · ダイス任意選択</span>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <button
                      onClick={handleExtraSupport}
                      disabled={!supportPhases.includes(b.phase)}
                      style={{...btnFull(C.redBg, C.redBorder, C.red), fontSize: 9, padding: "4px"}}
                    >💥 追加援護射撃<span style={{ fontSize: 7, color: C.textFaint, marginLeft: 3 }}>自ショット前</span></button>
                    <button
                      onClick={handleExtraCover}
                      disabled={b.phase !== coverPhase}
                      style={{...btnFull(C.greenBg, C.greenBorder, C.green), fontSize: 9, padding: "4px"}}
                    >🛡️ 追加かばう<span style={{ fontSize: 7, color: C.textFaint, marginLeft: 3 }}>敵ショット後</span></button>
                  </div>
                </div>
              );
            })()}

            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 8, color: C.textFaint, letterSpacing: 2, borderBottom: `1px solid ${C.border}`, paddingBottom: 2, marginBottom: 4 }}>陣営状況</div>
              {gs.pcs.map(p => {
                const isDead = (p.resources?.残り人数?.cur || 0) <= 0;
                const isCombatant = p.uid === b.pcCombatant;
                const isActed = b.actedPcs?.includes(p.uid);
                return (
                  <div key={p.uid} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", opacity: isDead ? 0.4 : 1 }}>
                    <span style={{ fontSize: 10, color: isCombatant ? C.blue : C.text }}>{isCombatant ? "▶ " : ""}{p.charName}</span>
                    <span style={{ fontSize: 8, color: isDead ? C.red : (isActed ? C.textFaint : C.gold) }}>{isDead ? "脱落" : (isActed ? "済" : "未")}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {battleLogs.length === 0 && (
              <div style={{ fontSize: 10, color: C.textFaint, padding: 6, textAlign: "center" }}>戦闘ログはまだありません</div>
            )}
            {battleLogs.map((entry, i) => (
              <div key={i} style={{
                fontSize: 10, color: "#6a7a8a", padding: "4px 0",
                borderBottom: "1px solid rgba(255,255,255,0.02)",
                lineHeight: 1.4, animation: "logSlideIn 0.32s ease forwards"
              }}>
                {entry}
              </div>
            ))}
          </div>
        )}
      </div>

      {isGm && (
        <button 
          onClick={() => window.confirm("終了しますか？") && upd(p => ({ ...p, battle: { ...p.battle, active: false } }))}
          style={{ ...btnFull("none", C.redBorder, C.red), marginTop: 10, fontSize: 9, flexShrink: 0 }}
        >対戦を強制終了</button>
      )}
    </div>
  );
}