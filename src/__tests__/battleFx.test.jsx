import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
const sfxCalls = [];
vi.mock("../firebase", () => ({ db: {}, auth: {} }));
vi.mock("../audio", () => ({ sfx: new Proxy({}, { get: (_t, k) => (...a) => { sfxCalls.push([k, ...a]); } }) }));
import { fxSnapshot, detectFx } from "../battleFx";
import { useBattleFx, HitOverlay, SpellCutin, shakeAnimation } from "../session/battleFx";
import { BattleGrid } from "../session/battle";
import { motion } from "../motion";

afterEach(() => { cleanup(); sfxCalls.length = 0; vi.useRealTimers(); });

const res = (lives, graze = 0) => ({ 残り人数: { cur: lives, max: 3 }, グレイズ: { cur: graze } });
const gsOf = ({ phase = "pc_shot_intro", round = 1, pcLives = 3, pcGraze = 0, npcLives = 2, pos = { a: 5, n1: 2 }, spells = {}, isFinal, active = true } = {}) => ({
  pcs: [{ uid: "a", charName: "霊夢", resources: res(pcLives, pcGraze) }, { uid: "z", charName: "見学", resources: res(3) }],
  battle: active ? {
    active: true, phase, round, isFinal, participantPcUids: ["a"], pcCombatant: "a", npcCombatant: "n1", positions: pos, spellUsedBy: spells,
    participants: { npcs: [{ id: "n1", name: "ルーミア", resources: res(npcLives) }] },
  } : { active: false },
});
const ev = (a, b) => detectFx(fxSnapshot(gsOf(a)), fxSnapshot(gsOf(b)));

describe("演出イベントの検出", () => {
  it("参加者だけを要約する（見学の PC は含めない）", () => {
    expect(Object.keys(fxSnapshot(gsOf()).ents)).toEqual(["a", "n1"]);
    expect(fxSnapshot(gsOf({ active: false }))).toEqual({ active: false });
  });

  it("入室直後・戦闘の開始／終了をまたぐ変化では何も出さない", () => {
    expect(detectFx(null, fxSnapshot(gsOf()))).toEqual([]);
    expect(ev({ active: false }, { pcLives: 1 })).toEqual([]);
    expect(ev({}, { active: false })).toEqual([]);
  });

  it("被弾: 残り人数が減ったら、そのときのマスと撃破かどうかを出す", () => {
    expect(ev({ phase: "pc_hit_check" }, { phase: "pc_hit_recovery", pcLives: 2 })).toEqual([
      { type: "hit", id: "a", pc: true, name: "霊夢", lives: 2, lost: 1, ko: false, cell: 5 },
    ]);
    const ko = ev({ phase: "npc_hit_check", npcLives: 1 }, { phase: "npc_dropout", npcLives: 0 });
    expect(ko[0]).toMatchObject({ type: "hit", id: "n1", pc: false, ko: true, cell: 2 });
  });

  it("回避: 回避ステップ中の移動は残像、移動前のマスでグレイズの火花", () => {
    const out = ev({ phase: "pc_evade_move", pcGraze: 1 }, { phase: "pc_evade_intro", pos: { a: 4, n1: 2 }, pcGraze: 3 });
    expect(out).toEqual([
      { type: "dodge", id: "a", pc: true, name: "霊夢", from: 5, to: 4 },
      { type: "graze", id: "a", pc: true, name: "霊夢", amount: 2, cell: 5 },
    ]);
  });

  it("被弾後の復帰（回避ステップ以外）の移動は残像を出さない。回避以外のグレイズはマス無し", () => {
    expect(ev({ phase: "pc_hit_recovery" }, { phase: "npc_shot_intro", pos: { a: 1, n1: 2 } })).toEqual([]);
    expect(ev({ phase: "npc_shot_roll" }, { phase: "npc_shot_roll", pcGraze: 2 })).toEqual([
      { type: "graze", id: "a", pc: true, name: "霊夢", amount: 2, cell: null },
    ]);
  });

  it("スペルカード宣言: 新しく宣言されたものだけ。決戦かどうかを渡す", () => {
    expect(ev({}, { spells: { n1: "闇符「ディマーケイション」" }, isFinal: true })).toEqual([
      { type: "spell", id: "n1", pc: false, name: "闇符「ディマーケイション」", who: "ルーミア", final: true },
    ]);
    expect(ev({ spells: { n1: "x" } }, { spells: { n1: "x" } })).toEqual([]);
    // 次のラウンドでリセット → 再宣言
    expect(ev({ round: 1, spells: {} }, { round: 2, spells: { a: "霊符「夢想封印」" } })[0]).toMatchObject({ type: "spell", id: "a", pc: true });
  });
});

describe("演出の再生", () => {
  function Probe({ gs }) {
    const fx = useBattleFx(gs);
    return (
      <div data-testid="shake" data-anim={shakeAnimation(fx.shake)}>
        <HitOverlay hit={fx.hit} />
        <SpellCutin cutin={fx.cutin} portrait={{ spriteRow: -1, spriteCol: -1 }} onDone={fx.dismissCutin} />
        <BattleGrid name="霊夢" grid={[0, 0, 0, 0, 0, 0]} pos={gs.battle.positions?.a} lives={gs.pcs[0].resources.残り人数.cur} maxLives={3} fx={fx.gridFx.a} sprite={<span>駒</span>} />
      </div>
    );
  }

  it("被弾で閃光・文字・揺れ・マスの衝撃・残り人数の割れ・効果音。時間で消える", () => {
    vi.useFakeTimers();
    const view = render(<Probe gs={gsOf({ phase: "pc_hit_check" })} />);
    expect(screen.queryByTestId("fx-hit")).toBeNull();
    view.rerender(<Probe gs={gsOf({ phase: "pc_hit_recovery", pcLives: 2 })} />);
    expect(screen.getByText("被弾！")).toBeInTheDocument();
    expect(screen.getByTestId("shake").dataset.anim).toMatch(/^fxShake/);
    expect(screen.getByTestId("fx-cell-hit")).toBeInTheDocument();
    expect(screen.getAllByTestId("fx-life")).toHaveLength(1);
    expect(sfxCalls.map(c => c[0])).toContain("hit");
    act(() => { vi.advanceTimersByTime(1400); });
    expect(screen.queryByTestId("fx-hit")).toBeNull();
  });

  it("残り人数0は「脱落」と強い揺れ・撃破音", () => {
    const view = render(<Probe gs={gsOf({ phase: "pc_hit_check", pcLives: 1 })} />);
    view.rerender(<Probe gs={gsOf({ phase: "pc_dropout", pcLives: 0 })} />);
    expect(screen.getByText("脱落")).toBeInTheDocument();
    expect(screen.getByTestId("shake").dataset.anim).toMatch(/^fxShakeKo/);
    expect(sfxCalls.map(c => c[0])).toContain("ko");
  });

  it("回避で残像と火花・GRAZE 表示", () => {
    const view = render(<Probe gs={gsOf({ phase: "pc_evade_move" })} />);
    view.rerender(<Probe gs={gsOf({ phase: "pc_evade_intro", pos: { a: 4, n1: 2 }, pcGraze: 2 })} />);
    expect(screen.getByTestId("fx-ghost")).toBeInTheDocument();
    expect(screen.getByTestId("fx-sparks")).toBeInTheDocument();
    expect(screen.getByText("GRAZE +2")).toBeInTheDocument();
    expect(sfxCalls.find(c => c[0] === "graze")).toEqual(["graze", 2]);
  });

  it("スペルカードのカットイン: 名前を1文字ずつ出し、タップで閉じる", () => {
    const view = render(<Probe gs={gsOf()} />);
    view.rerender(<Probe gs={gsOf({ spells: { a: "霊符「夢想封印」" } })} />);
    const cut = screen.getByTestId("fx-cutin");
    expect(cut.textContent).toContain("霊符「夢想封印」");
    expect(cut.textContent).toContain("霊夢");
    expect(sfxCalls.map(c => c[0])).toEqual(expect.arrayContaining(["cutin", "spell"]));
    fireEvent.click(cut);
    expect(screen.queryByTestId("fx-cutin")).toBeNull();
  });

  it("演出を抑える設定では、揺れ・マス内の演出を出さず、カットインはタップを塞がない静止表示", () => {
    const spy = vi.spyOn(motion, "reduced", "get").mockReturnValue(true);
    const view = render(<Probe gs={gsOf({ phase: "pc_evade_move" })} />);
    view.rerender(<Probe gs={gsOf({ phase: "pc_evade_intro", pos: { a: 4, n1: 2 }, pcGraze: 2, spells: { a: "霊符「夢想封印」" } })} />);
    expect(screen.queryByTestId("fx-ghost")).toBeNull();
    expect(screen.queryByTestId("fx-sparks")).toBeNull();
    expect(screen.getByTestId("fx-cutin").style.pointerEvents).toBe("none");
    view.rerender(<Probe gs={gsOf({ phase: "pc_hit_recovery", pos: { a: 4, n1: 2 }, pcGraze: 2, pcLives: 2, spells: { a: "霊符「夢想封印」" } })} />);
    expect(screen.getByText("被弾！")).toBeInTheDocument();
    expect(screen.getByTestId("shake").dataset.anim).toBe("none");
    expect(screen.queryByTestId("fx-cell-hit")).toBeNull();
    spy.mockRestore();
  });

  it("入室直後は何も再生しない", () => {
    render(<Probe gs={gsOf({ phase: "pc_dropout", pcLives: 0, spells: { a: "x" } })} />);
    expect(screen.queryByTestId("fx-hit")).toBeNull();
    expect(screen.queryByTestId("fx-cutin")).toBeNull();
    expect(sfxCalls).toEqual([]);
  });
});
