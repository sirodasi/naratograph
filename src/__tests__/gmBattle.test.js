import { describe, it, expect, vi } from "vitest";
vi.mock("../firebase", () => ({ db: {}, auth: {} }));
import {
  adjustBullets, placeBulletsByDice, clearField, moveEntity, adjustLives, afterDefense, cancelHit,
  startExtraEvade, placeFieldToken, takeFieldTokens, fieldTokenAlerts, getFieldTokens, grantSkill,
  revokeSkill, withGrants, ROUND_RESET,
} from "../gmBattle";
import { upsertDef } from "../customRules";
import { hasOfficialSkill } from "../session/battle";

const gs = (battle = {}) => upsertDef({
  log: [],
  pcs: [{ uid: "a", charName: "霊夢", resources: { 残り人数: { cur: 2, max: 3 }, 回避力: { cur: 3, max: 3 } } }],
  battle: {
    active: true, phase: "npc_dropout", startOrder: "pc", pcCombatant: "a", npcCombatant: "n1",
    grids: { a: [0, 0, 0, 0, 0, 0], n1: [1, 0, 0, 0, 0, 2] }, positions: { a: 2, n1: 5 },
    participants: { npcs: [{ id: "n1", name: "輝夜", resources: { 残り人数: { cur: 0, max: 3 }, 回避力: { cur: 2 } } }] },
    ...battle,
  },
}, "tokens", { id: "cherry", name: "チェリー", color: "#f8a" });

describe("弾幕の編集", () => {
  it("マス単位で増減（0未満にならない）", () => {
    let p = adjustBullets(gs(), "a", 3, 2);
    expect(p.battle.grids.a).toEqual([0, 0, 2, 0, 0, 0]);
    expect(p.log[0]).toContain("霊夢 のフィールド 3番マスに弾幕を2つ追加");
    p = adjustBullets(p, "a", 3, -5);
    expect(p.battle.grids.a[2]).toBe(0);
    expect(adjustBullets(p, "a", 3, -1)).toBe(p);
  });

  it("出目どおりに配置・全消去", () => {
    let p = placeBulletsByDice(gs(), "a", [1, 1, 6], "ラストスペル");
    expect(p.battle.grids.a).toEqual([2, 0, 0, 0, 0, 1]);
    expect(p.log[0]).toContain("ラストスペル");
    p = clearField(p, "a", "霊撃");
    expect(p.battle.grids.a).toEqual([0, 0, 0, 0, 0, 0]);
    expect(clearField(p, "a")).toBe(p);
  });

  it("戦闘外では何もしない", () => {
    const p = gs({ active: false });
    expect(adjustBullets(p, "a", 1, 1)).toBe(p);
  });

  it("駒の移動・残り人数の補正（NPC も）", () => {
    let p = moveEntity(gs(), "a", 6);
    expect(p.battle.positions.a).toBe(6);
    p = adjustLives(p, "n1", +1);
    expect(p.battle.participants.npcs[0].resources.残り人数.cur).toBe(1);
    p = adjustLives(p, "a", +5);
    expect(p.pcs[0].resources.残り人数.cur).toBe(3);
  });
});

describe("回避・被弾の流れ", () => {
  it("afterDefense は通常の先攻後攻の規則どおり", () => {
    expect(afterDefense({ startOrder: "pc" }, true)).toBe("npc_shot_intro");
    expect(afterDefense({ startOrder: "pc" }, false)).toBe("round_end_check");
    expect(afterDefense({ startOrder: "npc" }, false)).toBe("pc_shot_intro");
  });

  it("被弾を無効にすると被弾処理を飛ばして次へ", () => {
    // NPC 先攻で PC が被弾 → 無効にして PC の後攻ショットへ
    const p = cancelHit(gs({ phase: "pc_hit_check", startOrder: "npc" }));
    expect(p.battle.phase).toBe("pc_shot_intro");
    // PC 先攻で PC が（後攻の NPC ショットを）被弾 → ラウンド終了判定へ
    expect(cancelHit(gs({ phase: "pc_hit_check", startOrder: "pc" })).battle.phase).toBe("round_end_check");
    expect(p.log[0]).toContain("霊夢 の被弾を無効にした");
    const q = gs({ phase: "pc_evade_intro" });
    expect(cancelHit(q)).toBe(q);
  });

  it("追加の回避ステップ: 弾幕を置いて回避ステップへ、終了後はラウンド終了判定へ", () => {
    const p = startExtraEvade(gs(), true, [2, 2, 4], "ラストスペル");
    expect(p.battle.grids.a).toEqual([0, 2, 0, 1, 0, 0]);
    expect(p.battle.phase).toBe("pc_evade_intro");
    expect(p.battle.currentEvadeDice).toBe(3);
    expect(afterDefense(p.battle, false)).toBe("round_end_check");
    // 先攻 PC の状態でも、追加回避中は NPC ショットへ進まない
    expect(afterDefense(p.battle, true)).toBe("round_end_check");
    expect(ROUND_RESET.extraEvade).toBeNull();
  });
});

describe("盤面の独自コマ", () => {
  it("置く→踏んだら通知→獲得", () => {
    let p = placeFieldToken(gs(), "a", 2, "cherry", "t1");
    p = placeFieldToken(p, "a", 2, "cherry", "t2");
    expect(getFieldTokens(p.battle)).toHaveLength(2);
    const alerts = fieldTokenAlerts(p.battle); // 霊夢は 2番マスにいる
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ owner: "a", cell: 2, standing: true });
    p = takeFieldTokens(p, ["t1", "t2"], "collect", "a");
    expect(p.log[0]).toBe("💰 霊夢 が 【チェリー】×2 を獲得した（2番マス）");
    expect(getFieldTokens(p.battle)).toEqual([]);
  });

  it("弾幕が置かれたマスのコマも通知（UFO）", () => {
    const p = placeFieldToken(gs(), "n1", 1, "cherry", "u");
    expect(fieldTokenAlerts(p.battle)[0]).toMatchObject({ owner: "n1", cell: 1, standing: false, bullets: true });
  });

  it("未定義の種類は置けない", () => {
    const p = gs();
    expect(placeFieldToken(p, "a", 1, "nope", "x")).toBe(p);
  });
});

describe("このラウンドだけの弾幕スキル", () => {
  it("付与すると hasOfficialSkill が真になり、外すと偽", () => {
    let p = grantSkill(gs(), "a", "壁抜け");
    expect(hasOfficialSkill(p.pcs[0], "壁抜け")).toBe(false); // 素の PC には無い
    expect(hasOfficialSkill(withGrants(p.battle, p.pcs[0]), "壁抜け")).toBe(true);
    expect(hasOfficialSkill(withGrants(p.battle, p.pcs[0]), "弾消し")).toBe(false);
    p = revokeSkill(p, "a", "壁抜け");
    expect(hasOfficialSkill(withGrants(p.battle, p.pcs[0]), "壁抜け")).toBe(false);
  });

  it("公式以外の名前は付与しない・付与なしなら同じ参照", () => {
    const p = gs();
    expect(grantSkill(p, "a", "でたらめ")).toBe(p);
    expect(withGrants(p.battle, p.pcs[0])).toBe(p.pcs[0]);
  });
});
