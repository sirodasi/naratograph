// SessionView から分割: ボーナスフェイズ・成長セレモニー・セッション終了
import { useState, useEffect, useRef, useMemo } from "react";
import { sfx } from "../audio";
import { C, btnFull, iStyle } from "../styles/colors";
import { ACHIEVEMENTS, buildAchContext, aggregateLifetime, getAchievement } from "../data/achievements";
import { db } from "../firebase";
import { ref as dbRef, set as dbSet, get as dbGet, update as dbUpdate } from "firebase/database";
import { ENHANCE_LABELS } from "./shared";

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

export function GrowthCeremony({ gs, upd, user, isGm, onClose }) {
  // 操作対象PC（GMは全員、PLは自分のPCのみ）
  // useMemo: 毎レンダー新しい配列だと下の読み込み effect が setRecords→再レンダー→再実行 と無限ループする
  const myPcs = useMemo(() => (gs.pcs || []).filter(pc => isGm || pc.uid === user?.uid), [gs.pcs, isGm, user?.uid]);
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
        // gs 上のスナップショット（参加時に Lobby が格納／セレモニー適用時に更新）。GM 代理でも参照できる。
        if (pc.grownBase) acc[pc.uid] = pc.grownBase;
        if (!pc.grownInstanceId || pc.uid !== user?.uid) continue; // 他人の grownChars はルールで読めない
        try {
          const snap = await dbGet(dbRef(db, `grownChars/${pc.uid}/${pc.grownInstanceId}`));
          if (snap.exists()) acc[pc.uid] = snap.val();
        } catch (e) { /* 読めなくても続行 */ }
      }
      if (alive) { setRecords(acc); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [myPcs, user?.uid]);

  const setForm = (uid, patch) => setForms(f => ({ ...f, [uid]: { ...(f[uid] || {}), ...patch } }));

  const savingRef = useRef(new Set());
  const instanceIdRef = useRef({});
  const applyGrowth = async (pc) => {
    if (savingRef.current.has(pc.uid)) return;
    savingRef.current.add(pc.uid);
    try { await applyGrowthOnce(pc); } finally { savingRef.current.delete(pc.uid); }
  };
  const applyGrowthOnce = async (pc) => {
    const form = forms[pc.uid] || {};
    const existing = records[pc.uid] || {};
    const usedSet = new Set(existing.enhancementsUsed || []);
    // 弾幕再修得
    const chosenDs = form.newDs ? danmakuPool.find(d => d.name === form.newDs) : null;
    // タグ
    const newTag = (form.newTag || "").trim();
    // 強化（未使用のもののみ）
    let specialBond = existing.specialBond || pc.specialBond || null;
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
    const instanceId = pc.grownInstanceId || instanceIdRef.current[pc.uid] || (instanceIdRef.current[pc.uid] = `g_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
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
    // Firebase 永続化（charId が無い独自キャラはスキップ）。
    // grownChars/{uid} は本人しか書けないため、GM が代理で適用した分は gs に pendingGrowthRecord として残し、
    // 本人のクライアント（SessionEndView の effect）が保存する。
    let pendingGrowthRecord = null;
    if (pc.charId) {
      if (pc.uid === user?.uid) {
        try { await dbSet(dbRef(db, `grownChars/${pc.uid}/${instanceId}`), record); }
        catch (e) { console.error(e); alert("成長記録の保存に失敗しました。通信状況を確認して再度お試しください。"); return; }
      } else {
        pendingGrowthRecord = { instanceId, record };
      }
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
        grownBase: { tags: record.tags, enhancementsUsed: record.enhancementsUsed, createdAt: record.createdAt, specialBond: record.specialBond || null },
        growthApplied: true,
        pendingGrowthRecord,
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
          const isDone = done[pc.uid] || pc.growthApplied; // gs 側フラグで再オープン時の二重適用も防ぐ
          return (
            <div key={pc.uid} style={{ marginTop: 12, padding: 12, background: "rgba(255,255,255,0.03)", border: `1px solid ${isDone ? C.greenBorder : C.border}`, borderRadius: 6, opacity: isDone ? 0.7 : 1 }}>
              <div style={{ fontSize: 13, color: C.gold, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{pc.charName}</span>
                {isDone && (pc.pendingGrowthRecord
                  ? <span style={{ fontSize: 10, color: C.gold }}>⏳ 適用済み（本人の画面で保存待ち）</span>
                  : <span style={{ fontSize: 10, color: C.green }}>✅ 適用済み</span>)}
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

  // GM が代理で適用した成長記録を、本人のクライアントが grownChars/{自分} に保存する（ルール上本人しか書けない）
  const pendingGrowth = myPc?.pendingGrowthRecord;
  const savingGrowthRef = useRef(null);
  useEffect(() => {
    if (!pendingGrowth?.instanceId || !user?.uid) return;
    if (savingGrowthRef.current === pendingGrowth.instanceId) return; // 保存中の二重実行防止
    savingGrowthRef.current = pendingGrowth.instanceId;
    const { instanceId, record } = pendingGrowth;
    dbSet(dbRef(db, `grownChars/${user.uid}/${instanceId}`), record)
      .then(() => upd(p => ({ ...p, pcs: (p.pcs || []).map(x => x.uid !== user.uid ? x : { ...x, pendingGrowthRecord: null }) })))
      .catch(e => { console.error("成長記録の保存に失敗", e); savingGrowthRef.current = null; });
  }, [pendingGrowth, user?.uid, upd]);
  const pendingGrowthCount = pcs.filter(p => p.pendingGrowthRecord).length;
  // 終了前チェック: 実績が未記録（成長は任意なので警告対象外）または成長記録が保存待ちの PC
  const unfinishedPcs = pcs.filter(p => !p.achRecorded || p.pendingGrowthRecord);
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
      setAchResult({ newly, unlocked: Object.keys(nextUnlocked) });
      // GM の終了画面で「実績記録済み」を表示するためのフラグ
      upd(p => ({ ...p, pcs: (p.pcs || []).map(x => x.uid !== uid ? x : { ...x, achRecorded: true }) }));
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
  const exportLog = async () => {
    // gs.log は LOG_CAP 件に切り詰められているため、退避済みの古いログ（logArchive）を取得して全文を復元する
    let archivedLines = [];
    let archiveFailed = false;
    if (roomCode) {
      try {
        const snap = await dbGet(dbRef(db, `rooms/${roomCode}/logArchive`));
        if (snap.exists()) {
          const v = snap.val();
          archivedLines = Object.keys(v).sort().map(k => v[k]); // キーは "e"+0埋め通し番号＝辞書順で古い順
        }
      } catch (e) { console.error("退避ログの取得に失敗", e); archiveFailed = true; }
    }
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
    if (archiveFailed) L.push("  ※古いログの取得に失敗したため、直近分のみ出力しています");
    archivedLines.forEach(l => L.push(`  ${l}`));
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

          {/* GM 向け: 各 PL の終了処理の進み具合（ルーム削除で処理できなくなるため、終了前に確認できるように） */}
          {isGm && pcs.length > 0 && (
            <div style={{ marginBottom: 14, padding: "10px 14px", background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 10, color: C.textDim, textAlign: "left", minWidth: 260 }}>
              <div style={{ fontSize: 10, color: C.gold, marginBottom: 6, letterSpacing: 1 }}>◆ 各PLの終了処理</div>
              {pcs.map(p => (
                <div key={p.uid} style={{ display: "flex", justifyContent: "space-between", gap: 12, lineHeight: 1.9 }}>
                  <span>{p.charName}</span>
                  <span>
                    <span style={{ color: p.growthApplied ? (p.pendingGrowthRecord ? C.gold : C.green) : C.textFaint }}>
                      成長 {p.growthApplied ? (p.pendingGrowthRecord ? "⏳保存待ち" : "✓") : "—"}
                    </span>
                    {"　"}
                    <span style={{ color: p.achRecorded ? C.green : C.textFaint }}>実績 {p.achRecorded ? "✓" : "未記録"}</span>
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* 終了ボタン / 待機テキスト */}
          {isGm ? (
            <button
              disabled={ending}
              onClick={async () => {
                if (ending) return;
                const warns = [];
                if (pendingGrowthCount > 0) warns.push(`⚠ ${pendingGrowthCount}人分の成長記録が本人の画面でまだ保存されていません。今終了すると失われます。`);
                const noAch = unfinishedPcs.filter(p => !p.achRecorded).map(p => p.charName);
                if (noAch.length > 0) warns.push(`⚠ 実績が未記録: ${noAch.join("、")}（終了後は記録できません）`);
                const pendingWarn = warns.length ? `\n\n${warns.join("\n")}` : "";
                if (window.confirm(`セッションを終了しますか？\nセッションログ(.txt)を保存し、ルームデータを削除します。この操作は元に戻せません。${pendingWarn}`)) {
                  setEnding(true);
                  try {
                    await exportLog(); // ログを出力（退避ログ取得を待ってから部屋を消す）
                    // 秘匿データ（GM のみ削除可）と部屋を、複数パスの更新で同時に消す（片方だけ残さない）
                    if (roomCode) await dbUpdate(dbRef(db), { [`roomSecrets/${roomCode}`]: null, [`rooms/${roomCode}`]: null });
                  } catch (e) {
                    console.error(e);
                    alert(`セッションの終了に失敗しました: ${e?.message || e}\n通信状況を確認して、もう一度お試しください。`);
                    setEnding(false);
                  }
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
