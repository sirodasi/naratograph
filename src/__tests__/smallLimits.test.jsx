// 以前から分かっていた小さな制限の解消
//   ・ダイス要求の応援で「魂の弱い所」「人を狂わす」（失敗でファンブル）を使える
//   ・臨時の弾幕ごっこの参加 PC が、タブを開いた時点ではなく現在のシーンに追従する
//   ・スマホ向けの GM パネル拡大（data-touch-zoom）用のスタイル
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
vi.mock("../firebase", () => ({ db: {}, auth: {} }));
vi.mock("../audio", () => ({ sfx: new Proxy({}, { get: () => () => {} }) }));
import { GmToolsPanel, GmRequestOverlay } from "../session/gmPanel";
import {
  getRequests, addRequest, respondDice, addCheerDice, confirmDice, evalJudgment, describeDice, cheerOptions, isFragileResp,
} from "../gmTools";
import { KURUWASU_BOND } from "../session/shared";
import { fontScale } from "../fontScale";

afterEach(cleanup);

function harness(Comp, initial, props = {}) {
  let gs = initial;
  const upd = (fn) => { gs = fn(gs); view.rerender(<Comp gs={gs} upd={upd} {...props} />); };
  const view = render(<Comp gs={gs} upd={upd} {...props} />);
  return { get gs() { return gs; }, set gs(v) { gs = v; view.rerender(<Comp gs={gs} upd={upd} {...props} />); } };
}

const judge = { uid: "a", charName: "霊夢", currentSpot: "s1", bonds: [], bondUsed: {} };
const soul = { uid: "b", charName: "青娥", currentSpot: "s1", bonds: ["霊夢への絆"], bondUsed: { "霊夢への絆": true }, as: { name: "魂の弱い所に入り込む程度の能力", type: "オート" } };
const mad = { uid: "c", charName: "クラウンピース", currentSpot: "s1", bonds: [], bondUsed: {}, as: { name: "人を狂わす程度の能力", type: "サポート" } };
const far = { ...mad, uid: "d", charName: "遠くの狂人", currentSpot: "s2" };
const gs0 = () => ({ pcs: [judge, soul, mad, far], log: [], actedPcs: [] });
const withJudgment = (dice) => {
  let p = addRequest(gs0(), { kind: "dice", targets: ["a"], dice: { count: 2, mode: "nd6", target: 5 } }, "q1", 1);
  return respondDice(p, "q1", "a", dice);
};

describe("失敗でファンブルになる応援（ダイス要求）", () => {
  it("判定の評価: fragile なら失敗はファンブル、成功はそのまま", () => {
    expect(evalJudgment([2, 3], 5, false, true)).toMatchObject({ success: false, isFumble: true, isSpecial: false });
    expect(evalJudgment([2, 6], 5, false, true)).toMatchObject({ success: true, isFumble: false, isSpecial: true });
    expect(evalJudgment([2, 3], 5)).toMatchObject({ success: false, isFumble: false });
  });

  it("応援候補に、使用済みの絆（魂の弱い所）と絆なし（人を狂わす）が出る。別のスポットは出ない", () => {
    const opts = cheerOptions(gs0().pcs, judge);
    expect(opts.map(o => [o.cheerer.uid, o.bondName, o.fragile])).toEqual([
      ["b", "霊夢への絆", true],
      ["c", KURUWASU_BOND, true],
    ]);
  });

  it("人を狂わすの応援: 相手ごとに1回を消費し、失敗ならファンブルとして記録・確定される", () => {
    let p = withJudgment([2, 3]);
    p = addCheerDice(p, "q1", "a", "c", KURUWASU_BOND, [4], true);
    const r = getRequests(p)[0].responses.a;
    expect(r.dice).toEqual([2, 3, 4]);
    expect(isFragileResp(r)).toBe(true);
    expect(p.pcs.find(x => x.uid === "c").kuruwasuUsed).toEqual({ a: true });
    expect(p.log[0]).toMatch(/絆なしで応援.*失敗でファンブル/);
    expect(describeDice(getRequests(p)[0], r)).toMatch(/ファンブル$/);
    // 使ったので次の候補には出ない
    expect(cheerOptions(p.pcs, judge).some(o => o.cheerer.uid === "c")).toBe(false);
    p = confirmDice(p, "q1", "a");
    expect(p.log[0]).toMatch(/判定確定.*ファンブル/);
  });

  it("魂の弱い所の応援で成功すれば、通常どおり成功", () => {
    let p = withJudgment([2, 3]);
    p = addCheerDice(p, "q1", "a", "b", "霊夢への絆", [6], true);
    expect(describeDice(getRequests(p)[0], getRequests(p)[0].responses.a)).toMatch(/成功・スペシャル$/);
  });

  it("確定後の応援は記録せず、絆も消費しない", () => {
    let p = confirmDice(withJudgment([2, 3]), "q1", "a");
    const after = addCheerDice(p, "q1", "a", "c", KURUWASU_BOND, [6], true);
    expect(after).toBe(p);
  });

  it("応援する PC の画面に、紫の「失敗でファンブル」ボタンが出る", () => {
    harness(GmRequestOverlay, withJudgment([2, 3]), { user: { uid: "c" } });
    const btn = screen.getByText(/絆なしで応援（\+1D・失敗でファンブル）/);
    expect(btn).toBeInTheDocument();
  });

  it("判定者の画面では、fragile な応援を受けた失敗がファンブル表示になる", async () => {
    const p = addCheerDice(withJudgment([2, 3]), "q1", "a", "c", KURUWASU_BOND, [4], true);
    harness(GmRequestOverlay, p, { user: { uid: "a" } });
    expect(screen.getByText("ファンブル")).toBeInTheDocument();
  });
});

describe("臨時の弾幕ごっこの参加 PC", () => {
  const base = () => ({
    pcs: [judge, { ...soul, currentSpot: "s1" }, { ...mad, currentSpot: "s9" }], log: [], actedPcs: [],
    scenarioData: { quests: [{ name: "Q", enemy: { name: "ルーミア", life: 2, spellcard: 1, attack: 1 } }] },
  });

  it("GM が選ぶまでは、いま進行中のシーンの PC に追従する", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const h = harness(GmToolsPanel, base(), { getSpot: () => null });
    // タブを開いた後でシーンが始まる
    act(() => { h.gs = { ...h.gs, currentScene: { pcUid: "b" } }; });
    fireEvent.click(screen.getByText(/ルーミア/));
    fireEvent.click(screen.getByText("⚔ 弾幕ごっこを開始する"));
    expect(h.gs.battle.participantPcUids).toEqual(["b"]);
    vi.restoreAllMocks();
  });

  it("同じスポットの全員を選べ、シーンの PC に戻せる", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const h = harness(GmToolsPanel, { ...base(), currentScene: { pcUid: "a" } }, { getSpot: () => null });
    fireEvent.click(screen.getByText("シーンと同じスポットの全員"));
    fireEvent.click(screen.getByText("シーンの PC に戻す"));
    fireEvent.click(screen.getByText("シーンと同じスポットの全員"));
    fireEvent.click(screen.getByText(/ルーミア/));
    fireEvent.click(screen.getByText("⚔ 弾幕ごっこを開始する"));
    expect(h.gs.battle.participantPcUids).toEqual(["a", "b"]);
    vi.restoreAllMocks();
  });
});

describe("スマホ向けの GM パネル拡大", () => {
  it("文字サイズの段階を html に反映し、拡大用のスタイルを1つだけ入れる", () => {
    fontScale.apply();
    fontScale.apply();
    expect(document.documentElement.dataset.fontScale).toBe(String(fontScale.level));
    const styles = document.querySelectorAll("#touch-ui-style");
    expect(styles).toHaveLength(1);
    expect(styles[0].textContent).toMatch(/\[data-touch-zoom\] \{ zoom: 1\.2; \}/);
  });

  it("GM 操作タブは拡大対象", () => {
    render(<GmToolsPanel gs={{ pcs: [judge], log: [] }} upd={() => {}} getSpot={() => null} />);
    expect(document.querySelector("[data-touch-zoom]")).not.toBeNull();
  });
});
