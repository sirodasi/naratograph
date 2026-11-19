// SessionView から分割: 弾幕ごっこ（BattleView / BattleRightPanel / プロット配置）
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { CharSprite } from "../CharSprite";
import { BATTLE_FX_CSS, useBattleFx, shakeAnimation, HitOverlay, SpellCutin, CellHitBurst, CellGhost, CellSparks, GrazeText } from "./battleFx";
import { CHARACTERS } from "../data/characters";
import { sfx } from "../audio";
import { motion } from "../motion";
import { ADJACENT_MAP, OFFICIAL_DANMAKU_SKILLS } from "../data/gameData";
import { C, btnFull } from "../styles/colors";
import { getActiveAbility } from "../data/abilityEffects";
import { applyStep, applyRandomResult, resolveCount, shiftNon25Horizontal } from "../data/effectHandlers";
import { bumpAch } from "../data/achievements";
import { closeBattlePatch } from "../gmTools";
import { withGrants, afterDefense, getFieldTokens, ROUND_RESET } from "../gmBattle";
import { getCustom } from "../customRules";
import { db } from "../firebase";
import { ref as dbRef, set as dbSet, remove as dbRemove, onValue } from "firebase/database";
import { BAD_STATUS_TABLE, KURUWASU_BOND, PHASE_LABELS, SPECIAL_BOND_CHEER, SpellCard, buildBattleNpc, buildSpellCard, gainIntimacy, isBadStatusImmune } from "./shared";

// fx: 演出（battleFx.jsx の useBattleFx が返す gridFx[entityId]）。{ hit, life, ghost, graze } それぞれ key 付き
export function BattleGrid({ name, grid, pos, isCombatant, isNpc, sprite, isDead, highlightCells = [], onCellClick, lives, maxLives, sc, tokens = {}, fx = null }) {
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
      {fx?.graze && <GrazeText key={`gz${fx.graze.key}`} amount={fx.graze.amount} />}

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

              {/* 独自コマ（チェリー・UFO 等。GM が盤面編集で配置） */}
              {(tokens[num] || []).length > 0 && (
                <div style={{ position: "absolute", bottom: 2, left: 3, display: "flex", gap: 2, zIndex: 4 }} title={(tokens[num] || []).map(t => t.name).join("・")}>
                  {tokens[num].slice(0, 5).map((t, i) => (
                    <div key={i} style={{ width: 7, height: 7, transform: "rotate(45deg)", background: t.color, border: "1px solid rgba(255,255,255,0.8)", boxShadow: `0 0 4px ${t.color}` }} />
                  ))}
                  {tokens[num].length > 5 && <span style={{ fontSize: 7, color: "#fff" }}>+{tokens[num].length - 5}</span>}
                </div>
              )}

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
                <div key={fx?.ghost ? `pc${fx.ghost.key}` : "pc"} style={{ position: "absolute", inset: 2, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2, animation: fx?.ghost ? "fxDashIn 0.38s ease-out" : undefined }}>
                  {sprite}
                </div>
              )}
              {/* 演出: 回避の残像・グレイズの火花・被弾の衝撃 */}
              {fx?.ghost?.from === num && !hasChar && <CellGhost key={`gh${fx.ghost.key}`} sprite={sprite} color={campColor} />}
              {fx?.graze?.cell === num && <CellSparks key={`sp${fx.graze.key}`} color={C.gold} />}
              {fx?.hit?.cell === num && <CellHitBurst key={`ht${fx.hit.key}`} color={campColor} />}

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
                <div key={i} style={{ position: "relative", width: 8, height: 8, borderRadius: "50%", background: i < lives ? campColor : "rgba(255,255,255,0.1)", boxShadow: i < lives ? `0 0 5px ${campColor}99` : "none" }}>
                  {/* 被弾で失った残り人数のアイコンが割れて消える */}
                  {fx?.life && i >= fx.life.index && i < fx.life.index + (fx.life.lost || 1) && (
                    <div key={`lf${fx.life.key}`} data-testid="fx-life" style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "#fff", boxShadow: `0 0 8px ${campColor}`, animation: "fxLifeBreak 0.7s ease-out forwards" }} />
                  )}
                </div>
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

// ─── 弾幕スキルユーティリティ（BattleView / BattleRightPanel 共用） ─────
export function hasOfficialSkill(entity, skillName) {
  if (!entity) return false;
  // GM が付与した「このラウンドだけ修得している」弾幕スキル（gmBattle.withGrants が battleGrantDs を載せる）
  if ((entity.battleGrantDs || []).includes(skillName) && OFFICIAL_DANMAKU_SKILLS.some(s => s.name === skillName)) return true;
  const dsName = (entity.ds && entity.ds.name) || entity.dsName
    || entity.skillName || (entity.ps && entity.ps.name) || null;
  if (!dsName) return false;
  const isOfficial = OFFICIAL_DANMAKU_SKILLS.some(s => s.name === dsName);
  return isOfficial && dsName === skillName;
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

// Firebase に書き込むpendingSpell/manualSpell用のスリム形。
// 派生フィールド (effects, condition, textBody, timing, effectTiming, structured) は
// 持たず、表示・適用時は expandStoredSpell で再構築する。
export function slimSpellForStorage(spellCard) {
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

export function BattleParticleCanvas() {
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

export function SpellDeclareItem({ spell, cardColor, declareSpell, isPcAttacker }) {
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

// ─── プロット配置（初期位置の秘匿同時決定） ───────────────────────────
// 選択値は roomSecrets/{room}/plot/{自分のuid} にだけ保存し、ルールで本人以外は読めない（GM も PL の選択を読めない）。
// 公開 gs には SHA-256 コミット（entityId:cell:nonce のハッシュ）だけを載せ、一斉公開時に各自が {cell, nonce} を
// gs へ書き、全員の画面でハッシュを照合する（後出しの書き換えを検知）。NPC は GM が自分のノードに保存する。
export async function plotHash(entityId, cell, nonce) {
  const data = new TextEncoder().encode(`${entityId}:${cell}:${nonce}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, "0")).join("");
}
export function plotNonce() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map(x => x.toString(16).padStart(2, "0")).join("");
}

export function PlotPlacementPanel({ b, allPcs, npcs, upd, user, isGm, roomCode }) {
  const participantUids = useMemo(() => b.participantPcUids || allPcs.map(p => p.uid), [b.participantPcUids, allPcs]);
  const myEntities = useMemo(() => [
    ...allPcs.filter(p => p.uid === user.uid && participantUids.includes(p.uid)).map(p => ({ id: p.uid, name: p.charName, isNpc: false })),
    ...(isGm ? npcs.map(n => ({ id: n.id, name: n.name, isNpc: true })) : []),
  ], [allPcs, user.uid, participantUids, isGm, npcs]);
  const allEntityIds = useMemo(() => [...participantUids, ...npcs.map(n => n.id)], [participantUids, npcs]);
  const commits = useMemo(() => b.plotCommits || {}, [b.plotCommits]);
  const revealed = useMemo(() => b.plotRevealed || {}, [b.plotRevealed]);
  const isReveal = b.phase === "plot_reveal";
  const isAllCommitted = allEntityIds.every(id => commits[id]);
  const secretPath = roomCode && user?.uid ? `roomSecrets/${roomCode}/plot/${user.uid}` : null;

  // 自分の秘匿選択（自分のノードだけ読める）
  const [mySecret, setMySecret] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!secretPath) return;
    const unsub = onValue(dbRef(db, secretPath), snap => setMySecret(snap.val() || {}), () => setMySecret({}));
    return () => unsub();
  }, [secretPath]);

  const choose = async (entityId, cell) => {
    if (!secretPath || isReveal || saving) return;
    setSaving(true);
    try {
      const nonce = plotNonce();
      await dbSet(dbRef(db, `${secretPath}/${entityId}`), { cell, nonce });
      const hash = await plotHash(entityId, cell, nonce);
      upd(st => ({ ...st, battle: { ...st.battle, plotCommits: { ...(st.battle?.plotCommits || {}), [entityId]: hash } } }));
    } catch (e) {
      console.error("プロットの保存に失敗", e);
      alert("配置マスの保存に失敗しました。通信状況を確認してください。");
    } finally {
      setSaving(false);
    }
  };

  // 一斉公開: 自分の担当分を gs に公開し、秘匿ノードを片付ける
  const revealingRef = useRef(false);
  useEffect(() => {
    if (!isReveal || !secretPath || revealingRef.current) return;
    const mine = myEntities.filter(e => !revealed[e.id] && mySecret[e.id]);
    if (mine.length === 0) return;
    revealingRef.current = true;
    const patch = Object.fromEntries(mine.map(e => [e.id, mySecret[e.id]]));
    upd(st => ({ ...st, battle: { ...st.battle, plotRevealed: { ...(st.battle?.plotRevealed || {}), ...patch } } }));
    dbRemove(dbRef(db, secretPath)).catch(() => {}).finally(() => { revealingRef.current = false; });
  }, [isReveal, secretPath, mySecret, revealed, myEntities, upd]);

  // GM: 全員分そろったらハッシュを照合して開始（不一致は記録して公開値を採用）
  const finalizingRef = useRef(false);
  const finalize = useCallback(async (fallbackRandom) => {
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    try {
      const positions = {};
      const mismatched = [];
      const randomized = [];
      for (const id of allEntityIds) {
        const r = revealed[id];
        if (r && r.cell >= 1 && r.cell <= 6) {
          positions[id] = r.cell;
          if (commits[id] && (await plotHash(id, r.cell, r.nonce)) !== commits[id]) mismatched.push(id);
        } else if (fallbackRandom) {
          positions[id] = Math.floor(Math.random() * 6) + 1;
          randomized.push(id);
        } else {
          return;
        }
      }
      const nameOf = id => allPcs.find(p => p.uid === id)?.charName || npcs.find(n => n.id === id)?.name || id;
      const logs = ["⚖️ 全員の配置マスが一斉に公開されました！ 弾幕ごっこを開始します。"];
      if (randomized.length) logs.unshift(`🎲 未公開のため乱数で配置: ${randomized.map(nameOf).join("、")}`);
      if (mismatched.length) logs.unshift(`⚠ 公開値が事前の決定と一致しません（書き換えの疑い）: ${mismatched.map(nameOf).join("、")}`);
      upd(p => ({
        ...p,
        battle: { ...p.battle, phase: "round_start", positions, plotCommits: null, plotRevealed: null },
        log: [...logs, ...(p.log || [])],
      }));
    } finally {
      finalizingRef.current = false;
    }
  }, [allEntityIds, revealed, commits, allPcs, npcs, upd]);

  const isAllRevealed = allEntityIds.every(id => revealed[id]);
  useEffect(() => {
    if (isGm && isReveal && isAllRevealed) finalize(false);
  }, [isGm, isReveal, isAllRevealed, finalize]);

  const statusChip = (id, name) => {
    const done = isReveal ? !!revealed[id] : !!commits[id];
    return <span key={id} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: done ? C.greenBg : "rgba(255,255,255,0.05)", color: done ? C.green : C.textFaint, border: `1px solid ${done ? C.greenBorder : C.border}` }}>{name} {done ? "✓" : "…"}</span>;
  };

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#040608" }}>
      <div style={{ background: "#0c1020", border: `1px solid ${C.goldDim}`, padding: 30, borderRadius: 8, maxWidth: 500, width: "90%" }}>
        <div style={{ fontSize: 16, color: C.gold, marginBottom: 6, textAlign: "center" }}>プロット配置：初期位置の秘匿決定</div>
        <div style={{ fontSize: 9, color: C.textFaint, marginBottom: 18, textAlign: "center" }}>選んだマスは本人の画面にしか表示されず、GM・他のPLからも見えません</div>

        {myEntities.map(e => {
          const color = e.isNpc ? C.red : C.blue;
          const mine = mySecret[e.id]?.cell;
          return (
            <div key={e.id} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color, marginBottom: 8 }}>{e.name} の配置マスを選択</div>
              <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                {[1, 2, 3, 4, 5, 6].map(num => {
                  const selected = mine === num;
                  return (
                    <button key={num} disabled={isReveal || saving} onClick={() => choose(e.id, num)}
                      style={btnFull(selected ? (e.isNpc ? C.redBg : C.blueBg) : "rgba(255,255,255,0.05)", selected ? (e.isNpc ? C.redBorder : C.blueBorder) : C.border, selected ? color : C.text, { width: 40, height: 40, fontSize: 14, opacity: isReveal ? 0.6 : 1 })}>
                      {num}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8 }}>{isReveal ? "公開状況" : "現在の準備状況"}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {participantUids.map(uid => statusChip(uid, allPcs.find(p => p.uid === uid)?.charName || "PC"))}
            {npcs.map(n => statusChip(n.id, n.name))}
          </div>
        </div>

        {isGm ? (
          isReveal ? (
            <div style={{ marginTop: 20 }}>
              <div style={{ textAlign: "center", fontSize: 11, color: C.textDim, marginBottom: 8 }}>各参加者の画面から公開しています…</div>
              <button onClick={() => finalize(true)} style={{ ...btnFull("rgba(255,255,255,0.04)", C.border, C.textDim, { padding: "8px", fontSize: 11 }) }}>
                未公開の参加者を乱数で配置して開始（接続が切れている場合）
              </button>
            </div>
          ) : (
            <button
              disabled={!isAllCommitted}
              onClick={() => upd(p => ({ ...p, battle: { ...p.battle, phase: "plot_reveal" } }))}
              style={{ ...btnFull(C.goldBg, C.goldDim, C.gold, { marginTop: 20, padding: "12px" }), opacity: isAllCommitted ? 1 : 0.4 }}
            >
              一斉公開して弾幕ごっこを開始
            </button>
          )
        ) : (
          <div style={{ textAlign: "center", fontSize: 11, color: C.textDim, marginTop: 20 }}>
            {isReveal ? "公開中…" : isAllCommitted ? "全員の準備が完了しました。GMの開始を待っています…" : "他の参加者のプロットを待っています…"}
          </div>
        )}
      </div>
    </div>
  );
}

export function BattleView({ gs, upd, user, isGm, animateDice, sceneData, room, roomCode }) {
  // 追加ルールは rooms/{code}/config にある（gs には含まれない）。room を props で受け取って参照する。
  const roomConfig = room?.config || {};
  // b は実際には常に存在する（battle.active 時のみ描画）。フックを無条件に呼ぶため || {} で安全化し、
  // 実際の null 判定はフック群の後で行う（rules-of-hooks 準拠）。
  const b = gs.battle || {};

  const allPcs = gs.pcs || [];
  const pcs = (b.participantPcUids
    ? allPcs.filter(pc => b.participantPcUids.includes(pc.uid))
    : allPcs).map(pc => withGrants(b, pc));
  const npcs = useMemo(() => (b.participants?.npcs || []).map(n => withGrants({ grantedDs: b.grantedDs }, n)), [b.participants?.npcs, b.grantedDs]);
  // 盤面の独自コマ: { [entityId]: { [cell]: [{ name, color }] } }
  const fieldTokenMap = (() => {
    const kinds = getCustom(gs).tokens;
    const map = {};
    getFieldTokens(b).forEach(t => {
      const k = kinds.find(x => x.id === t.kind);
      if (!k) return;
      ((map[t.owner] = map[t.owner] || {})[t.cell] = map[t.owner][t.cell] || []).push({ name: k.name, color: k.color || "#e8a0b8" });
    });
    return map;
  })();

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
      log: [...[...resetLogs].reverse(), ...p.log] // 更新関数は再実行されるので、元の配列は並べ替えない
    }));
  }, [b.phase, alivePcs.length, aliveNpcs.length, unactedPcs.length, unactedNpcs.length, b.actedPcs, b.actedNpcs, upd]);

  // 使い魔: スキップ → ショットイントロで自動援護射撃（PC/NPC両対応・状態は独立管理）
  useEffect(() => {
    if (b.phase === "pc_shot_intro" && b.pcFamiliarAction === "skip_to_support") {
      upd(p => {
        // 複数のクライアントが同時に出しても1回だけ（トランザクション内で未処理かを確かめる）
        if (p.battle?.phase !== "pc_shot_intro" || p.battle?.pcFamiliarAction !== "skip_to_support") return p;
        const pc = withGrants(p.battle, p.pcs.find(x => x.uid === p.battle.pcCombatant));
        if (!pc || !hasOfficialSkill(pc, "使い魔")) return p;
        return {
          ...p,
          battle: { ...p.battle, supportDice: (p.battle.supportDice || 0) + 1, pcFamiliarAction: "done" },
          log: [`💠 ${pc.charName} の使い魔が自動援護射撃！攻撃ダイス+1`, ...p.log],
        };
      });
    } else if (b.phase === "npc_shot_intro" && b.npcFamiliarAction === "skip_to_support") {
      upd(p => {
        if (p.battle?.phase !== "npc_shot_intro" || p.battle?.npcFamiliarAction !== "skip_to_support") return p;
        const npc = withGrants(p.battle, p.battle.participants.npcs.find(n => n.id === p.battle.npcCombatant));
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

  // ── 演出（スペルカードのカットイン・被弾・回避の残像・グレイズ）──────────
  // gs の変化から各クライアントでローカルに再生する（src/battleFx.js / ./battleFx.jsx）
  const fx = useBattleFx(gs);
  // カットインの立ち絵: 描写モードで登録した立ち絵（名前一致）> カスタム画像 > キャラスプライト
  const cutinPortrait = (() => {
    if (!fx.cutin) return null;
    const id = fx.cutin.id;
    const ent = pcs.find(x => x.uid === id) || npcs.find(n => n.id === id);
    const nm = ent?.charName || ent?.name || fx.cutin.who || "";
    const sp = (sceneData?.portraits || []).find(x => x?.img && x.name && nm && (x.name === nm || nm.includes(x.name) || x.name.includes(nm)));
    if (sp) return { img: sp.img };
    if (ent?.customPortrait) return { img: ent.customPortrait };
    const charMatch = !fx.cutin.pc ? CHARACTERS.find(c => c.name === ent?.name) : null;
    return { spriteRow: ent?.spriteRow ?? charMatch?.spriteRow ?? -1, spriteCol: ent?.spriteCol ?? charMatch?.spriteCol ?? -1 };
  })();

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
      setPhaseBanner({ label, key: Date.now() }); // key で毎回アニメーションをやり直す
      sfx.phase(b.phase);
      const t = setTimeout(() => setPhaseBanner(null), 1600);
      return () => clearTimeout(t);
    }
    setPhaseBanner(null); // バナーの無いフェイズへ進んだら消す（次のバナーが同じ要素で再生されないように）
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
  // PL が始めたクエストの弾幕ごっこ: 敵データ（秘匿）を GM のクライアントが補うまで待つ
  if (b.awaitingEnemies) {
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#040608", color: C.textDim, fontSize: 12, letterSpacing: 2, fontFamily: "'Noto Serif JP', serif", textAlign: "center", padding: 16 }}>
        ⚔ 弾幕ごっこの準備中…<br />（GM の画面から敵のデータを読み込んでいます）
      </div>
    );
  }

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
      // 出目の分だけの差分（元の盤面は含めない。呼び出し側で現在の盤面に足す）
      const delta = [0, 0, 0, 0, 0, 0];
      res.forEach(d => { delta[d - 1] += 1; });
      cb({ [defenderGridId]: delta });
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
          // 効果はラウンド終了時でも、宣言（SC 消費）は今なので spellUsedBy に記録する（同じラウンドで2枚目を宣言できないように）
          ...mergeConsumeWithBattle(p, { spellUsedBy: { ...(p.battle.spellUsedBy || {}), [attackerId]: spellCard.name }, [isPcAttacker ? "pcPendingSpell" : "npcPendingSpell"]: { ...slimSpellForStorage(spellCard), attackerId, defenderId, attPos, defPos } }),
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
        ...mergeConsumeWithBattle(p, { spellUsedBy: { ...(p.battle.spellUsedBy || {}), [attackerId]: spellCard.name }, [isPcAttacker ? "pcPendingSpell" : "npcPendingSpell"]: { ...slimSpellForStorage(spellCard), attackerId, defenderId, attPos, defPos, defenderPos: defPos } }),
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
      const nonRandomDelta = updatedGrid.map((v, i) => v - (defenderGrid[i] || 0));
      resolveRandomEffects(spellCard.effects, defenderId, customCount, gridPatch => {
        upd(p => ({
          ...p,
          battle: {
            ...p.battle,
            // 現在の盤面に「非ランダム効果の差分＋出目の差分」を足す（振っている間の GM の編集も残す）
            grids: { ...p.battle.grids, [defenderId]: (p.battle.grids?.[defenderId] || [0,0,0,0,0,0]).map((v, i) => Math.max(0, v + (nonRandomDelta[i] || 0) + (gridPatch[defenderId]?.[i] || 0))), },
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

  // 回避力 0（スペル等で減った）はそのまま 0。値が無いときだけ既定の 3
  const getDefaultEvadeDice = (entity) => entity?.resources?.回避力?.cur ?? 3;

  const getEvadeNeighbors = (pos, wallPass) => {
    const base = ADJACENT_MAP[pos] || [];
    if (!wallPass) return base;
    const extras = { 1: [3], 3: [1], 4: [6], 6: [4] };
    return [...new Set([...base, ...(extras[pos] || [])])];
  };

  // 回避側の処理後のフェイズ。GM が発生させた追加の回避ステップ中なら、その戻り先（gmBattle.afterDefense）
  const afterDefensePhase = (isAttackerPc) => afterDefense(b, isAttackerPc);

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

    upd(p => {
      // 消える弾幕・グレイズはトランザクション内の最新の盤面から数える（振っている間に GM が弾幕を足した等）
      if (p.battle?.phase !== (isPc ? "pc_evade_move" : "npc_evade_move") || (isPc ? p.battle.pcCombatant : p.battle.npcCombatant) !== combatantId) return p;
      if (p.battle.positions?.[combatantId] !== oldPos) return p;
      const bulletsCleared = p.battle.grids[combatantId]?.[oldPos - 1] || 0;
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
          ...(nextDice > 0 ? {} : { extraEvade: null }),
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
    upd(p => {
      if ((isPc ? p.battle?.pcCombatant : p.battle?.npcCombatant) !== combatantId) return p;
      const pos = p.battle.positions?.[combatantId];
      const bulletsCleared = p.battle.grids[combatantId]?.[pos - 1] || 0;
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
          ...(nextDice > 0 ? {} : { extraEvade: null }),
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
        phase: nextPhase, extraEvade: null,
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

      // デメリットでどちらかの陣営が全滅したら、次のラウンドに進まず結果（cleanup の勝敗表示）にとどまる
      if (suntanLogs.length) {
        const uids = currentB.participantPcUids || restoredPcs.map(x => x.uid);
        const alive = (e) => (e.resources?.残り人数?.cur || 0) > 0;
        const pcsWiped = !restoredPcs.filter(x => uids.includes(x.uid)).some(alive);
        const npcsWiped = !restoredNpcs.some(alive);
        if (pcsWiped || npcsWiped) {
          return {
            ...p,
            pcs: restoredPcs,
            battle: { ...currentB, participants: { ...currentB.participants, npcs: restoredNpcs }, suntanPenalty: {}, phase: "cleanup" },
            log: [...suntanLogs, ...p.log],
          };
        }
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
          tempSelectedNpc: null,
          ...ROUND_RESET,
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
    const canUseWideShot = canProceed && hasOfficialSkill(attacker, "ワイドショット") && !isDanmakuUsed(attackerId, "ワイドショット");
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
                      return { ...p, pcs, battle: { ...p.battle, phase: next, extraEvade: null }, log: [`🛡 ${combatantPc?.charName} の『不死身』が発動（霊力-${immortalCost}・攻撃力更新）`, ...p.log] };
                    });
                  } else {
                    upd(p => ({ ...p,
                      battle: { ...p.battle, phase: next, extraEvade: null,
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
        {!isSafe && roomConfig.useLastResort && !(isPc ? b.pcLastResort : b.npcLastResort) && canApply && (
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
                    // 使った側（PC / NPC）の SC を1消費し、その側の「このラウンド使用済み」を立てる
                    const spend = (x) => ({ ...x, resources: { ...x.resources, スペルカード: { ...x.resources.スペルカード, cur: Math.max(0, (x.resources.スペルカード?.cur || 0) - 1) } } });
                    let pcs = isPc ? p.pcs.map(x => x.uid !== defenderId ? x : spend(x)) : p.pcs;
                    const npcs = isPc ? p.battle.participants?.npcs : (p.battle.participants?.npcs || []).map(n => n.id !== defenderId ? n : spend(n));
                    // 実績記録（PC のみ）
                    const isFinalB = b.isFinal ?? (b.type === "mass" && !b.questId);
                    if (isPc && isFinalB && Math.max(...res) >= targetValue) {
                      pcs = bumpAch(pcs, defenderId, a => ({ ...a, kuraibomuSuccess: true }));
                    }

                    // 現在の回避ダイスプールに追加
                    const newDice = [...(p.battle.evadeRoll?.dice || []), ...res];

                    return {
                      ...p,
                      pcs,
                      battle: {
                        ...p.battle,
                        ...(isPc ? { pcLastResort: true } : { npcLastResort: true, participants: { ...p.battle.participants, npcs } }),
                        evadeRoll: { ...p.battle.evadeRoll, dice: newDice }
                      },
                      log: [`💜 ${target?.charName || target?.name} 喰らいボム！SC-1 (追加:${res.join(",")})`, ...p.log]
                    };
                  });
                  // 振り足した出目で再判定を確定させる（遅延させない: 遅らせると戦闘終了後に古い戦闘へ書き込む恐れがある）
                  const combatant = isPc ? combatantPc : combatantNpc;
                  const currentDice = [...(gs.battle?.evadeRoll?.dice || []), ...res];
                  resolveEvadeApply(isPc, currentDice, targetValue, combatant);
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
              upd(p => ({ ...p, battle: { ...p.battle, phase: next, extraEvade: null,
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
              const useRandom = roomConfig.useRandomPlacement;
              const usePlot = roomConfig.usePlotPlacement;
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
                    plotCommits: null, // { [entityId]: sha256 } 公開コミット（選択値そのものは roomSecrets に本人のみ）
                    plotRevealed: null, // { [entityId]: { cell, nonce } } 一斉公開時に各自が書く
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

  if (b.phase === "plot_initial" || b.phase === "plot_reveal") {
    return <PlotPlacementPanel b={b} allPcs={allPcs} npcs={npcs} upd={upd} user={user} isGm={isGm} roomCode={roomCode} />;
  }

  if (b.phase === "result") {
    const isVictory  = b.result === "pc_win";
    // 「最終決戦（final）」か否か。type:"mass" は集団戦の演出/機構を表すだけで、
    // セッション終了などの最終決戦セマンティクスは isFinal で判定する（集団戦クエストと区別）。
    // 後方互換: 旧セーブの最終決戦は isFinal 未設定だが mass かつ questId 無し。
    const isFinal    = b.isFinal ?? (b.type === "mass" && !b.questId);
    const questId    = b.questId;
    const relatedQ   = questId ? (gs.quests || []).find(q => String(q.id) === String(questId)) : null;
    const isAdhoc    = !!b.adhoc;

    const finishBattle = () => {
      upd(p => {
        let nextQuests = p.quests || [];

        if (isVictory && questId) {
          nextQuests = nextQuests.map(q => String(q.id) === String(questId) ? { ...q, solved: true } : q);
          // 次クエストの解放・真相の公開は GM クライアントの reconcileQuests が行う（シナリオ秘匿のため）
        }

        // 決戦（最終決戦）後は勝敗にかかわらず終幕フェイズへ。通常クエスト戦は探索へ戻る。
        // 臨時の弾幕ごっこ（GM 操作）はフェイズを変えない（導入中などに起きても元のフェイズへ戻る）
        const nextSessionPhase = isFinal ? "epilogue" : isAdhoc ? p.sessionPhase : "explore";
        const logLine = isAdhoc
          ? (isVictory ? `🏆 弾幕ごっこ「${b.title || ""}」に勝利！` : `💀 弾幕ごっこ「${b.title || ""}」に敗北...`)
          : isVictory
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

        const recoveredPcs = !isFinal
          ? p.pcs.map(x => {
              const lives = x.resources?.残り人数?.cur ?? 0;
              return lives === 0
                ? { ...x, resources: { ...x.resources, 残り人数: { ...x.resources.残り人数, cur: 1 } } }
                : x;
            })
          : p.pcs;
        const recoveredNames = !isFinal
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
          ...closeBattlePatch(p), // 臨時の弾幕ごっこで中断したシーンを戻す
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
      {/* 演出: 被弾の閃光と、スペルカード宣言のカットイン（揺れの外側に置く） */}
      <HitOverlay hit={fx.hit} />
      <SpellCutin cutin={fx.cutin} portrait={cutinPortrait} onDone={fx.dismissCutin} />
    <div style={{ position: "relative", zIndex: 1, width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "16px 20px 24px", boxSizing: "border-box", gap: 14, overflowY: "auto", animation: shakeAnimation(fx.shake) }}>
      <style>{`${BATTLE_FX_CSS}
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

      {/* フェーズチェンジバナー */}
      {phaseBanner && (
        <div key={phaseBanner.key} style={{ position: "absolute", top: "18%", left: "50%", zIndex: 20, pointerEvents: "none", animation: "phaseBannerAnim 1.6s forwards" }}>
          <div style={{ fontSize: 22, fontWeight: "bold", color: C.gold, letterSpacing: 8, whiteSpace: "nowrap", textShadow: `0 0 24px ${C.gold}, 0 0 48px ${C.gold}66` }}>
            {phaseBanner.label}
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
              tokens={fieldTokenMap[n.id]}
              fx={fx.gridFx[n.id]}
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
              tokens={fieldTokenMap[p.uid]}
              fx={fx.gridFx[p.uid]}
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

export function BattleDiceTray({ diceResult, diceAnim, label }) {
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

export function BattleRightPanel({ gs, upd, user, isGm, animateDice }) {
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
  const renderNpcCard = (npc0, isCurrent) => {
    const npc = withGrants(b, npc0);
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
  const renderPcCard = (pc0, isCurrent) => {
    const pc = withGrants(b, pc0);
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
          onClick={() => window.confirm("終了しますか？") && upd(p => ({ ...p, ...closeBattlePatch(p), log: [`⚔ GM: 弾幕ごっこを強制終了した`, ...p.log] }))}
          style={{ ...btnFull("none", C.redBorder, C.red), marginTop: 10, fontSize: 9, flexShrink: 0 }}
        >対戦を強制終了</button>
      )}
    </div>
  );
}
