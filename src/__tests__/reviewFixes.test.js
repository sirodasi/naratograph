// PR #2 のレビュー指摘（CodeRabbit）への修正の回帰テスト
import { describe, it, expect, vi } from "vitest";
vi.mock("../firebase", () => ({ db: {}, auth: {} }));
import {
  applyPreset, unapplyPreset, presetFromGs, getCustom, upsertDef, removeDef, transferItem, giveItem, pcCustom,
  sanitizePreset, parsePresetFile, PRESET_FILE_FORMAT, safeDefId, timingSnapshot, detectTimings, setClock,
} from "../customRules";
import { addRequest, respondDice, addCheerDice, giveTableItem, getRequests, startAdhocBattle } from "../gmTools";
import { cancelHit, startExtraEvade } from "../gmBattle";
import { fxSnapshot, detectFx } from "../battleFx";
import { buildBattleNpc, buildSpellCard, ITEM_DATA } from "../session/shared";
import { tradeItems } from "../session/pcCard";
import { getIhenPreset } from "../data/ihenPresets";

const pcs = () => [
  { uid: "a", charName: "霊夢", currentSpot: "s1", bonds: [], bondUsed: {} },
  { uid: "b", charName: "魔理沙", currentSpot: "s1", bonds: ["霊夢への絆"], bondUsed: {} },
];
const base = (over = {}) => ({ pcs: pcs(), log: [], actedPcs: [], day: 1, cycleIdx: 0, ...over });

describe("異変再現プリセット", () => {
  it("複数プリセット由来で元の id が重なる定義は、保存しても両方残る", () => {
    let p = applyPreset(base(), getIhenPreset("eiya"), "eiya");
    p = applyPreset(p, getIhenPreset("satsuei"), "satsuei");
    const saved = presetFromGs(p, "合成");
    const normas = saved.defs.stats.filter(s => s.name.includes("ノルマ"));
    expect(normas).toHaveLength(2);
    expect(new Set(saved.defs.stats.map(s => s.id)).size).toBe(saved.defs.stats.length);
    const back = applyPreset(base(), sanitizePreset(saved), "u1");
    expect(getCustom(back).stats.filter(s => s.name.includes("ノルマ"))).toHaveLength(2);
  });

  it("再適用は置き換え: プリセットから消えた定義は外れる", () => {
    const pr = { name: "X", defs: { rules: [{ id: "r1", title: "A" }, { id: "r2", title: "B" }] } };
    let p = applyPreset(base(), pr, "k");
    p = applyPreset(p, { name: "X", defs: { rules: [{ id: "r1", title: "A2" }] } }, "k");
    expect(getCustom(p).rules.map(r => [r.id, r.title])).toEqual([["k__r1", "A2"]]);
  });

  it("PC 人数の初期値はトランザクション内の p.pcs から数える", () => {
    const p = applyPreset(base({ pcs: [...pcs(), { uid: "c", charName: "咲夜" }] }), getIhenPreset("eiya"), "eiya");
    expect(getCustom(p).global["eiya__norma"]).toBe(3);
  });

  it("導入中に時刻付きで適用すると、探索の開始時刻として残す。解除すれば消える", () => {
    const p = applyPreset(base({ sessionPhase: "intro_main" }), getIhenPreset("eiya"), "eiya", { withClock: true });
    expect(p.custom.startClock).toMatchObject({ key: "eiya", day: 1, cycleIdx: 3 });
    expect(unapplyPreset(p, "eiya").custom.startClock).toBeNull();
    // 探索中に適用した場合は開始時刻を残さない
    expect(applyPreset(base({ sessionPhase: "explore" }), getIhenPreset("eiya"), "eiya", { withClock: true }).custom?.startClock).toBeUndefined();
  });

  it("読み込み: 列挙値は文字列だけ、id の制御文字は除く、時刻だけのファイルも読める", () => {
    const pr = sanitizePreset({ name: "x", defs: { stats: [{ id: "s", name: "a", scope: ["global"] }], tables: [{ id: "t", name: "t", dice: ["d6"], rows: [] }] } });
    expect(pr.defs.stats[0].scope).toBe("pc");
    expect(pr.defs.tables[0].dice).toBe("d6");
    expect(safeDefId("a\u0001b")).toBe("a_b");
    const { preset, error } = parsePresetFile(JSON.stringify({ format: PRESET_FILE_FORMAT, version: 1, name: "時刻だけ", defs: {}, clock: { day: 2, cycleIdx: 1 } }));
    expect(error).toBeUndefined();
    expect(preset.clock).toEqual({ day: 2, cycleIdx: 1 });
  });
});

describe("独自要素", () => {
  it("コマの種類を消すと、弾幕フィールド上の同じ種類のコマも消える", () => {
    let p = upsertDef(base(), "tokens", { id: "ch", name: "チェリー" });
    p = upsertDef(p, "tokens", { id: "uf", name: "UFO" });
    p = { ...p, battle: { active: true, fieldTokens: [{ id: "1", kind: "ch", owner: "a", cell: 2 }, { id: "2", kind: "uf", owner: "a", cell: 3 }] } };
    expect(removeDef(p, "tokens", "ch").battle.fieldTokens.map(t => t.kind)).toEqual(["uf"]);
  });

  it("PL 同士の受け渡しは、同じスポットにいるときだけ（GM は離れていても渡せる）", () => {
    let p = upsertDef(base(), "items", { id: "it", name: "札" });
    p = giveItem(p, "a", "it", "i1");
    const away = { ...p, pcs: p.pcs.map(x => x.uid === "b" ? { ...x, currentSpot: "s9" } : x) };
    expect(transferItem(away, "a", "b", "i1", true)).toBe(away);
    expect(pcCustom(transferItem(away, "a", "b", "i1", false).pcs[1]).items).toHaveLength(1);
  });

  it("サイクルの繰り返しは cycleSeq で検出し、時刻の変更でも進む", () => {
    const p = base({ sessionPhase: "explore" });
    const q = setClock(p, 1, 2);
    expect(q.cycleSeq).toBe(1);
    expect(detectTimings(timingSnapshot(p), timingSnapshot(q)).map(e => e.key)).toContain("cycle_start");
  });
});

describe("GM 操作", () => {
  it("臨時の弾幕ごっこは集団戦でも決戦ではない", () => {
    const p = startAdhocBattle(base(), { enemies: [{ name: "A", life: 1 }, { name: "B", life: 1 }], participantPcUids: ["a"] }, 1);
    expect(p.battle).toMatchObject({ type: "mass", isFinal: false });
    expect(fxSnapshot(p).final).toBe(false);
  });

  it("応援は、トランザクション内で応援できる状態か確かめ直す", () => {
    let p = addRequest(base(), { kind: "dice", targets: ["a"], dice: { count: 2, mode: "nd6", target: 5 } }, "q1", 1);
    p = respondDice(p, "q1", "a", [1, 2]);
    const moved = { ...p, pcs: p.pcs.map(x => x.uid === "b" ? { ...x, currentSpot: "s9" } : x) };
    expect(addCheerDice(moved, "q1", "a", "b", "霊夢への絆", [6])).toBe(moved);
    const used = { ...p, pcs: p.pcs.map(x => x.uid === "b" ? { ...x, bondUsed: { "霊夢への絆": true } } : x) };
    expect(addCheerDice(used, "q1", "a", "b", "霊夢への絆", [6])).toBe(used);
    expect(getRequests(addCheerDice(p, "q1", "a", "b", "霊夢への絆", [6]))[0].responses.a.dice).toEqual([1, 2, 6]);
  });

  it("表の報酬は、実際に渡せたときだけ「渡し済み」にする", () => {
    let p = applyPreset(base(), getIhenPreset("takarabune"), "tb");
    p = addRequest(p, { kind: "dice", targets: ["a"], table: getCustom(p).tables[0] }, "q1", 1);
    p = respondDice(p, "q1", "a", [3]);
    const gone = { ...p, pcs: p.pcs.filter(x => x.uid !== "a") };
    expect(giveTableItem(gone, "q1", "a", "i1")).toBe(gone);
    expect(getRequests(giveTableItem(p, "q1", "a", "i1"))[0].responses.a.given).toBe(true);
  });
});

describe("弾幕ごっこ", () => {
  const battle = (over = {}) => ({
    ...base(),
    battle: { active: true, phase: "pc_hit_check", pcCombatant: "a", npcCombatant: "n", positions: { a: 1, n: 2 }, grids: { a: [0, 0, 0, 0, 0, 0], n: [0, 0, 0, 0, 0, 0] },
      participants: { npcs: [{ id: "n", name: "敵", resources: { 残り人数: { cur: 2 }, 回避力: { cur: 0 } } }] }, ...over },
  });

  it("被弾の無効化で追加の回避ステップの記録も消す", () => {
    const p = cancelHit(battle({ extraEvade: { entityId: "a", returnTo: "round_end_check" } }));
    expect(p.battle.phase).toBe("round_end_check");
    expect(p.battle.extraEvade).toBeNull();
  });

  it("回避力 0 はそのまま 0（未設定だけ 3）", () => {
    const p = startExtraEvade(battle({ phase: "npc_shot_after" }), false, [1]);
    expect(p.battle.currentEvadeDice).toBe(0);
    expect(buildBattleNpc({ name: "x", evade: 0 }, "id").resources.回避力.cur).toBe(0);
    expect(buildBattleNpc({ name: "x", evade: "" }, "id").resources.回避力.cur).toBe(3);
    expect(buildBattleNpc({ name: "x" }, "id").resources.回避力.cur).toBe(3);
  });

  it("グレイズの火花は回避側のフィールドだけ。ラウンドが変われば同名のスペルも再び出す", () => {
    const g = (o) => ({ pcs: [{ uid: "a", charName: "霊夢", resources: { 残り人数: { cur: 3 }, グレイズ: { cur: o.pg || 0 } } }],
      battle: { active: true, phase: o.phase, round: o.round || 1, pcCombatant: "a", npcCombatant: "n", positions: { a: 5, n: 2 }, spellUsedBy: o.sp || {},
        participants: { npcs: [{ id: "n", name: "敵", resources: { 残り人数: { cur: 2 }, グレイズ: { cur: o.ng || 0 } } }] } } });
    const out = detectFx(fxSnapshot(g({ phase: "pc_evade_move" })), fxSnapshot(g({ phase: "pc_evade_intro", pg: 2, ng: 2 })));
    expect(out.find(e => e.id === "a").cell).toBe(5);
    expect(out.find(e => e.id === "n").cell).toBeNull();
    const sp = detectFx(fxSnapshot(g({ phase: "x", round: 1, sp: { n: "S" } })), fxSnapshot(g({ phase: "x", round: 2, sp: { n: "S" } })));
    expect(sp.map(e => e.type)).toEqual(["spell"]);
  });
});

describe("その他", () => {
  it("アイテム交換で同じアイテムを選んでも個数は増えない", () => {
    expect(tradeItems({ お酒: 1 }, "お酒", "お酒")).toEqual({ お酒: 1 });
    expect(tradeItems({ お酒: 1 }, "お酒", "小銭")).toEqual({ お酒: 0, 小銭: 1 });
  });

  it("Pアイテムで霊力が増えたら攻撃力も計算し直す", () => {
    const pc = { items: { Pアイテム: 1 }, badStatus: [], resources: { 霊力: { cur: 4, max: 30 }, 攻撃力: { cur: 1, max: 99 } } };
    const after = ITEM_DATA["Pアイテム"].use(pc, {});
    expect(after.resources.霊力.cur).toBe(7);
    expect(after.resources.攻撃力.cur).toBe(2);
  });

  it("末尾に「。」の無い使用条件も本文から取り除く", () => {
    const sc = buildSpellCard({ name: "テスト", desc: "ランダム×2。このスペルカードは残り人数が1の場合にしか使用できない" });
    expect(sc.condition).toMatch(/使用できない。$/);
    expect(sc.textBody).not.toMatch(/このスペルカード/);
  });
});
