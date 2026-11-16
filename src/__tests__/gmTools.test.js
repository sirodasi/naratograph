import { describe, it, expect, vi } from "vitest";
vi.mock("../firebase", () => ({ db: {}, auth: {} }));
import {
  addRequest, removeRequest, respondDice, addCheerDice, confirmDice, respondChoice, ackNotice,
  isAnswered, pendingFor, evalJudgment, describeDice, cheerOptions, getRequests, MAX_REQUESTS,
  scenarioEnemies, startAdhocBattle, closeBattlePatch,
  gmAddBadStatus, gmAddBond, gmRemoveBond, gmToggleBondUsed, gmMovePc, gmToggleActed, gmAdjustMax, gmResetAbilityUse,
} from "../gmTools";
import { SPECIAL_BOND_CHEER } from "../session/shared";

const pcs = () => ([
  { uid: "a", charName: "霊夢", currentSpot: "s1", bonds: ["魔理沙への絆"], bondUsed: {}, resources: { やる気: { cur: 2, max: 3 } } },
  { uid: "b", charName: "魔理沙", currentSpot: "s1", bonds: ["霊夢への絆"], bondUsed: {}, resources: {} },
  { uid: "c", charName: "咲夜", currentSpot: "s2", bonds: ["霊夢への絆"], bondUsed: {}, resources: {} },
]);
const base = () => ({ pcs: pcs(), log: [], actedPcs: [] });

describe("ダイス要求", () => {
  it("要求を作るとログが残り、対象の未回答に入る", () => {
    const p = addRequest(base(), { kind: "dice", title: "災い表", targets: ["a", "b"], dice: { count: 2, mode: "nd6", target: 4 } }, "r1", 1);
    expect(getRequests(p)).toHaveLength(1);
    expect(p.log[0]).toContain("災い表");
    expect(pendingFor(p, "a").map(r => r.id)).toEqual(["r1"]);
    expect(pendingFor(p, "c")).toEqual([]);
  });

  it("対象なし・選択肢不足の要求は作らない", () => {
    const b = base();
    expect(addRequest(b, { kind: "dice", targets: [] }, "x", 1)).toBe(b);
    expect(addRequest(b, { kind: "choice", targets: ["a"], options: ["1つだけ"] }, "x", 1)).toBe(b);
  });

  it("D66 は個数2・目標値なしに正規化する", () => {
    const p = addRequest(base(), { kind: "dice", targets: ["a"], dice: { count: 5, mode: "d66", target: 4 } }, "r1", 1);
    expect(getRequests(p)[0].dice).toEqual({ count: 2, mode: "d66" });
  });

  it("要求は MAX_REQUESTS 件までで古いものから落ちる", () => {
    let p = base();
    for (let i = 0; i < MAX_REQUESTS + 3; i++) p = addRequest(p, { kind: "notice", title: `n${i}`, targets: ["a"] }, `r${i}`, i);
    expect(getRequests(p)).toHaveLength(MAX_REQUESTS);
    expect(getRequests(p)[0].id).toBe("r3");
  });

  it("目標値なしは振った時点で確定、二重振りは無視", () => {
    let p = addRequest(base(), { kind: "dice", targets: ["a"], dice: { count: 2, mode: "nd6" } }, "r1", 1);
    p = respondDice(p, "r1", "a", [3, 5]);
    expect(isAnswered(getRequests(p)[0], "a")).toBe(true);
    const again = respondDice(p, "r1", "a", [6, 6]);
    expect(getRequests(again)[0].responses.a.dice).toEqual([3, 5]);
  });

  it("対象外の PC は回答できない", () => {
    const p = addRequest(base(), { kind: "dice", targets: ["a"], dice: { count: 1 } }, "r1", 1);
    expect(respondDice(p, "r1", "c", [6])).toBe(p);
  });

  it("目標値ありは応援で振り足して再評価し、本人の確定で終わる", () => {
    let p = addRequest(base(), { kind: "dice", targets: ["a"], dice: { count: 2, target: 5 } }, "r1", 1);
    p = respondDice(p, "r1", "a", [2, 3]);
    expect(isAnswered(getRequests(p)[0], "a")).toBe(false);
    expect(describeDice(getRequests(p)[0], getRequests(p)[0].responses.a)).toContain("失敗");
    p = addCheerDice(p, "r1", "a", "b", "霊夢への絆", [6]);
    const resp = getRequests(p)[0].responses.a;
    expect(resp.dice).toEqual([2, 3, 6]);
    expect(p.pcs.find(x => x.uid === "b").bondUsed["霊夢への絆"]).toBe(true);
    expect(describeDice(getRequests(p)[0], resp)).toContain("成功・スペシャル");
    p = confirmDice(p, "r1", "a");
    expect(isAnswered(getRequests(p)[0], "a")).toBe(true);
    // 確定後は応援できない
    const after = addCheerDice(p, "r1", "a", "b", "霊夢への絆", [6]);
    expect(after).toBe(p);
  });

  it("D66 の表示は値に変換する", () => {
    let p = addRequest(base(), { kind: "dice", targets: ["a"], dice: { mode: "d66" } }, "r1", 1);
    p = respondDice(p, "r1", "a", [5, 2]);
    expect(p.log[0]).toContain("D66 → 25");
  });

  it("取り下げで消える", () => {
    const p = addRequest(base(), { kind: "notice", title: "x", targets: ["a"] }, "r1", 1);
    expect(getRequests(removeRequest(p, "r1"))).toEqual([]);
  });
});

describe("選択・告知", () => {
  it("選択は1回だけ記録される", () => {
    let p = addRequest(base(), { kind: "choice", title: "誘い", targets: ["a", "b"], options: ["乗る", "断る"] }, "r1", 1);
    p = respondChoice(p, "r1", "a", 1);
    p = respondChoice(p, "r1", "a", 0);
    const r = getRequests(p)[0];
    expect(r.responses.a.choice).toBe(1);
    expect(isAnswered(r, "b")).toBe(false);
    expect(p.log[0]).toContain("断る");
  });

  it("存在しない選択肢は無視", () => {
    const p = addRequest(base(), { kind: "choice", targets: ["a"], options: ["x", "y"] }, "r1", 1);
    expect(respondChoice(p, "r1", "a", 5)).toBe(p);
  });

  it("告知の確認", () => {
    let p = addRequest(base(), { kind: "notice", text: "雨が降り出した", targets: ["a"] }, "r1", 1);
    p = ackNotice(p, "r1", "a");
    expect(pendingFor(p, "a")).toEqual([]);
  });
});

describe("行為判定の評価と応援候補", () => {
  it("最大値≧目標で成功、全1でファンブル、6でスペシャル", () => {
    expect(evalJudgment([1, 4], 4)).toMatchObject({ success: true, isFumble: false, isSpecial: false });
    expect(evalJudgment([1, 1], 1)).toMatchObject({ success: false, isFumble: true });
    expect(evalJudgment([6, 2], 4)).toMatchObject({ success: true, isSpecial: true });
    expect(evalJudgment([2, 2], 2, true)).toMatchObject({ isFumble: true });
  });

  it("同スポットの絆持ちだけが応援できる", () => {
    const list = pcs();
    const opts = cheerOptions(list, list[0]);
    expect(opts.map(o => o.cheerer.uid)).toEqual(["b"]); // 咲夜は別スポット
  });

  it("特別な絆は親密度10で2ダイス", () => {
    const list = pcs();
    list[1].specialBond = { targetUid: "a", target: "霊夢", intimacy: 10 };
    const sb = cheerOptions(list, list[0]).find(o => o.bondName === SPECIAL_BOND_CHEER);
    expect(sb.diceN).toBe(2);
    let p = addRequest({ ...base(), pcs: list }, { kind: "dice", targets: ["a"], dice: { count: 1, target: 6 } }, "r1", 1);
    p = respondDice(p, "r1", "a", [2]);
    p = addCheerDice(p, "r1", "a", "b", SPECIAL_BOND_CHEER, [3, 6]);
    expect(p.pcs.find(x => x.uid === "b").specialBond.used).toBe(true);
  });
});

describe("臨時の弾幕ごっこ", () => {
  const enemy = { name: "妖怪", life: 2, spellcard: 1, attack: 1, evade: 3 };

  it("シナリオの敵を重複なしで列挙する", () => {
    const sd = { quests: [{ name: "Q1", enemy }, { name: "Q2", enemy, extraEnemies: [{ name: "子分", life: 1 }] }], finalBattleEnemies: [{ name: "黒幕", life: 5 }] };
    expect(scenarioEnemies(sd).map(e => e.enemy.name)).toEqual(["妖怪", "子分", "黒幕"]);
    expect(scenarioEnemies(null)).toEqual([]);
  });

  it("進行中のシーンを退避し、終了で戻す", () => {
    const scene = { pcUid: "a", phase: "happening_result", happeningDice: 6 };
    let p = { ...base(), currentScene: scene };
    p = startAdhocBattle(p, { enemies: [enemy], participantPcUids: ["a"], title: "通りがかりの妖怪" }, 7);
    expect(p.currentScene).toBeNull();
    expect(p.battle).toMatchObject({ active: true, adhoc: true, type: "normal", phase: "setup", title: "通りがかりの妖怪", participantPcUids: ["a"], scenePcUid: "a" });
    expect(p.battle.participants.npcs[0]).toMatchObject({ id: "adhoc_0_7", name: "妖怪" });
    const closed = { ...p, ...closeBattlePatch(p) };
    expect(closed.currentScene).toEqual(scene);
    expect(closed.battle.active).toBe(false);
    expect(closed.battle.resumeScene).toBeUndefined();
  });

  it("複数の敵または複数の PC なら集団戦", () => {
    const p = startAdhocBattle(base(), { enemies: [enemy, enemy], participantPcUids: ["a"] }, 1);
    expect(p.battle.type).toBe("mass");
  });

  it("戦闘中・敵なし・参加者なしでは始めない", () => {
    const b = base();
    expect(startAdhocBattle(b, { enemies: [], participantPcUids: ["a"] }, 1)).toBe(b);
    expect(startAdhocBattle(b, { enemies: [enemy], participantPcUids: [] }, 1)).toBe(b);
    const inBattle = { ...b, battle: { active: true } };
    expect(startAdhocBattle(inBattle, { enemies: [enemy], participantPcUids: ["a"] }, 1)).toBe(inBattle);
  });

  it("シーンなしで始めた戦闘は終了後もシーンなし", () => {
    const p = startAdhocBattle(base(), { enemies: [enemy], participantPcUids: ["a"] }, 1);
    expect(closeBattlePatch(p).currentScene).toBeNull();
  });
});

describe("PC の GM 編集", () => {
  it("変調の付与（重複しない）", () => {
    let p = gmAddBadStatus(base(), "a", "怪我");
    p = gmAddBadStatus(p, "a", "怪我");
    expect(p.pcs[0].badStatus).toEqual(["怪我"]);
  });

  it("絆の追加で応援欄が未使用に戻り、削除で消える", () => {
    let p = gmToggleBondUsed(base(), "a", "魔理沙への絆");
    expect(p.pcs[0].bondUsed["魔理沙への絆"]).toBe(true);
    p = gmAddBond(p, "a", "魔理沙への絆");
    expect(p.pcs[0].bonds).toEqual(["魔理沙への絆"]);
    expect(p.pcs[0].bondUsed["魔理沙への絆"]).toBe(false);
    p = gmRemoveBond(p, "a", "魔理沙への絆");
    expect(p.pcs[0].bonds).toEqual([]);
    expect(p.pcs[0].bondUsed).toEqual({});
  });

  it("強制移動・行動済み切替", () => {
    let p = gmMovePc(base(), "a", "s9", "妖怪の山");
    expect(p.pcs[0].currentSpot).toBe("s9");
    expect(gmMovePc(p, "a", "s9")).toBe(p);
    p = gmToggleActed(p, "a");
    expect(p.actedPcs).toEqual(["a"]);
    p = gmToggleActed(p, "a");
    expect(p.actedPcs).toEqual([]);
  });

  it("最大値の変更で現在値も切り詰める", () => {
    let p = gmAdjustMax(base(), "a", "やる気", -2);
    expect(p.pcs[0].resources.やる気).toEqual({ cur: 1, max: 1 });
    expect(gmAdjustMax(p, "a", "やる気", -1)).toBe(p); // 1 未満にはしない
  });

  it("能力の使用回数リセット", () => {
    const b = base();
    b.pcs[0].abilityUse = { x: { day: 1 } };
    expect(gmResetAbilityUse(b, "a").pcs[0].abilityUse).toBeNull();
  });
});
