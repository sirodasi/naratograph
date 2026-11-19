// SessionView から分割: 探索シーンの行動パネル（ScenePanel）
import { useState } from "react";
import { getCheerBonds, getSpecialBondCheer, getFragileCheerBonds, getKuruwasuCheer } from "../gmTools";
import { CharSprite } from "../CharSprite";
import { CHARACTERS } from "../data/characters";
import { SPOT_DETAILS } from "../data/spots";
import { EDGES } from "../data/gameData";
import { C, btnFull, btnSmall, iStyle } from "../styles/colors";
import { getActiveAbility, isAtBase } from "../data/abilityEffects";
import { getPreBattleFlavorRoll } from "../scenarios";
import { bumpAch } from "../data/achievements";
import { BAD_STATUS_TABLE, INIT_ITEMS, KURUWASU_BOND, PS_ONCE_FLAG, SPECIAL_BOND_CHEER, buildBattleNpc, gainIntimacy, getSpotByD66, isBadStatusImmune } from "./shared";
import { ActionRenderer } from "./pcCard";

// ─── ScenePanel ───────────────────────────────────────────────────
export function ScenePanel({ gs, upd, user, isGm, getSpot, animateDice, SPOTS, room }) {
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
    const scenePc = sc.pcUid;
    animateDice(count, "移動ダイス", res => upd(p => (!p.currentScene || p.currentScene.pcUid !== scenePc || p.currentScene.phase !== "move_roll") ? p
      : ({ ...p, currentScene: { ...p.currentScene, moveDice: res } })));
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
  // getCheerBonds / getSpecialBondCheer は gmTools.js（ダイス要求の応援と共通）

  // 魂の弱い所／人を狂わすの応援（失敗でファンブル）も gmTools.js の getFragileCheerBonds / getKuruwasuCheer

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
      // 同時に別の操作で使われた手がかり・埋まったクエストには配置しない（1つの手がかりで2枠を埋めない）
      const target = (p.quests || []).find(q => String(q.id) === String(questId));
      if (!(p.clues || []).includes(spotId) || !target || target.solved || (target.clues || 0) >= target.level) return p;
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

      // 次クエストの解放・真相の公開は GM クライアントの reconcileQuests が行う（シナリオ秘匿のため）

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
              6: { title: "「あなたは食べてもいい人類？」", desc: "通りがかりの妖怪に襲われた！\n（※襲撃は GM が「GM」タブの「臨時の弾幕ごっこ」で開始できます。戦闘後このシーンに戻るので、続けて「問題なし」と同様に6マス以内へ移動します）" },
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
                          ? { ...p, currentScene: { ...p.currentScene, phase: "explore_roll", actionDice: undefined, fumbleResolved: false, specialResolved: false, fragileCheer: false, wasCheered: false, kishitsuUsed: false }, log: [`🩹 ${myPc.charName} の《喉の病気を癒す程度の能力＋》: ${pc.charName} のファンブルを無効化し判定をやり直す`, ...p.log] }
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
                          currentScene: { ...p.currentScene, phase: "explore_roll", actionDice: undefined, fumbleResolved: false, specialResolved: false, fragileCheer: false, wasCheered: false, kishitsuUsed: false },
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

          {/* 手がかりイベント表の結果: 表の内容は書籍を参照し、処理は GM が行う（ここではシーンを止めないための確認だけ） */}
          {sc.phase === "clue_event_result" && (
            <div style={{ padding: 8, background: "rgba(156,39,176,0.1)", border: `1px solid ${C.purpleBorder}`, borderRadius: 4 }}>
              <div style={{ fontSize: 10, color: C.purple, marginBottom: 4 }}>📜 手がかりイベント表: 出目 {sc.clueEventDice ?? "?"}</div>
              <div style={{ fontSize: 9, color: C.textDim, lineHeight: 1.6, marginBottom: 6 }}>書籍の手がかりイベント表で出目の結果を確認し、GM が処理してください。処理が済んだらシーンを終えます。</div>
              <button onClick={() => upd(p => (p.currentScene?.phase !== "clue_event_result" ? p : {
                ...p,
                currentScene: { ...p.currentScene, phase: "action_done" },
                log: [`📜 ${pc.charName} の手がかりイベント表: 出目${p.currentScene.clueEventDice ?? "?"}（GM が処理）`, ...p.log],
              }))} style={btnFull(C.purpleBg, C.purpleBorder, C.purple)}>処理した（シーンを終える）</button>
            </div>
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

                    // 次クエストの解放・真相の公開は GM クライアントの reconcileQuests が行う（シナリオ秘匿のため）

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
