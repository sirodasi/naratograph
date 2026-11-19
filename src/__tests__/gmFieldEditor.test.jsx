import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
vi.mock("../firebase", () => ({ db: {}, auth: {} }));
import { GmFieldEditor } from "../session/customPanel";
import { upsertDef } from "../customRules";
import { getFieldTokens } from "../gmBattle";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function harness(initial) {
  let gs = initial;
  const upd = (fn) => { gs = fn(gs); view.rerender(<GmFieldEditor gs={gs} upd={upd} />); };
  const view = render(<GmFieldEditor gs={gs} upd={upd} />);
  return { get gs() { return gs; } };
}

const base = (battle = {}) => upsertDef({
  log: [],
  pcs: [{ uid: "a", charName: "霊夢", resources: { 残り人数: { cur: 2, max: 3 }, 回避力: { cur: 3 } } }],
  battle: {
    active: true, phase: "pc_hit_check", startOrder: "pc", pcCombatant: "a", npcCombatant: "n1", round: 1,
    grids: { a: [0, 3, 0, 0, 0, 0], n1: [0, 0, 0, 0, 0, 0] }, positions: { a: 2, n1: 5 },
    participants: { npcs: [{ id: "n1", name: "幽々子", resources: { 残り人数: { cur: 1, max: 3 } } }] },
    ...battle,
  },
}, "tokens", { id: "cherry", name: "チェリー", color: "#f8a" });

describe("GM 盤面編集", () => {
  it("霊撃：全消去と被弾の無効化", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const h = harness(base());
    fireEvent.click(screen.getByText(/盤面編集/));
    fireEvent.click(screen.getByText("弾幕を全消去"));
    expect(h.gs.battle.grids.a).toEqual([0, 0, 0, 0, 0, 0]);
    fireEvent.click(screen.getByText(/霊夢 の被弾を無効にする/));
    expect(h.gs.battle.phase).toBe("round_end_check");
  });

  it("独自コマを置き、踏んだら通知から獲得できる", () => {
    const h = harness(base({ phase: "pc_evade_move" }));
    fireEvent.click(screen.getByText(/盤面編集/));
    fireEvent.change(screen.getByDisplayValue("種類..."), { target: { value: "cherry" } });
    fireEvent.change(screen.getByDisplayValue("ランダムなマス"), { target: { value: "2" } });
    fireEvent.click(screen.getByText("置く"));
    expect(getFieldTokens(h.gs.battle)).toHaveLength(1);
    expect(screen.getByText(/駒がこのマスにいる/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("霊夢 が獲得"));
    expect(getFieldTokens(h.gs.battle)).toHaveLength(0);
    expect(h.gs.log[0]).toContain("【チェリー】×1 を獲得");
  });

  it("ラストスペル：追加の回避ステップを始める", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(Math, "random").mockReturnValue(0.99); // 出目は全て 6
    const h = harness(base({ phase: "npc_dropout" }));
    fireEvent.click(screen.getByText(/盤面編集/));
    fireEvent.click(screen.getByText("開始"));
    expect(h.gs.battle.phase).toBe("pc_evade_intro");
    expect(h.gs.battle.grids.a[5]).toBe(6);
    expect(h.gs.battle.extraEvade).toMatchObject({ entityId: "a", returnTo: "round_end_check" });
  });

  it("このラウンドだけ弾幕スキルを付与・解除", () => {
    const h = harness(base());
    fireEvent.click(screen.getByText(/盤面編集/));
    fireEvent.change(screen.getByDisplayValue("弾幕スキル..."), { target: { value: "不死身" } });
    fireEvent.click(screen.getByText("霊夢 に付与"));
    expect(h.gs.battle.grantedDs).toEqual({ a: ["不死身"] });
    fireEvent.click(screen.getByText("霊夢《不死身》✕"));
    expect(h.gs.battle.grantedDs).toEqual({ a: [] });
  });
});
