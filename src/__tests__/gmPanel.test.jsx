import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
vi.mock("../firebase", () => ({ db: {}, auth: {} }));
vi.mock("../audio", () => ({ sfx: new Proxy({}, { get: () => () => {} }) }));
import { GmToolsPanel, GmRequestOverlay, GmPcEditor } from "../session/gmPanel";
import { getRequests } from "../gmTools";

afterEach(cleanup);

// upd を「gs を保持して更新関数を適用する」形で模擬し、再描画まで行う
function harness(Comp, initial, props = {}) {
  let gs = initial;
  const upd = (fn) => { gs = fn(gs); view.rerender(<Comp gs={gs} upd={upd} {...props} />); };
  const view = render(<Comp gs={gs} upd={upd} {...props} />);
  return { get gs() { return gs; } };
}

const pcs = [
  { uid: "a", charName: "霊夢", currentSpot: "s1", bonds: [], bondUsed: {}, resources: { やる気: { cur: 1, max: 3 } } },
  { uid: "b", charName: "魔理沙", currentSpot: "s1", bonds: ["霊夢への絆"], bondUsed: {}, resources: {} },
];
const gs0 = () => ({ pcs, log: [], actedPcs: [], scenarioData: { quests: [{ name: "Q", enemy: { name: "ルーミア", life: 2, spellcard: 1, attack: 1 } }] } });

describe("GM 操作タブ", () => {
  it("ダイス要求を送ると進行中の要求に出て、代理で振れる", () => {
    const h = harness(GmToolsPanel, gs0(), { getSpot: () => null });
    fireEvent.click(screen.getAllByText("霊夢")[0]);
    fireEvent.change(screen.getByPlaceholderText(/見出し/), { target: { value: "梅雨の災い表" } });
    fireEvent.click(screen.getByText("🎲 ダイスを振らせる"));
    expect(getRequests(h.gs)).toHaveLength(1);
    expect(screen.getByText(/梅雨の災い表/, { selector: "span" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("代理で振る"));
    expect(getRequests(h.gs)[0].responses.a.dice).toHaveLength(2);
    fireEvent.click(screen.getByText("閉じる"));
    expect(getRequests(h.gs)).toHaveLength(0);
  });

  it("シナリオの敵を選んで臨時の弾幕ごっこを始められる", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const h = harness(GmToolsPanel, gs0(), { getSpot: () => null });
    fireEvent.click(screen.getByText(/ルーミア/));
    // 参加PC（2つ目の TargetPicker）の霊夢
    fireEvent.click(screen.getAllByText("霊夢")[1]);
    fireEvent.click(screen.getByText("⚔ 弾幕ごっこを開始する"));
    expect(h.gs.battle).toMatchObject({ active: true, adhoc: true, participantPcUids: ["a"] });
  });
});

describe("PL 側の要求カード", () => {
  it("自分宛ての選択に答えるとカードが消える", () => {
    const gs = { ...gs0(), gmRequests: [{ id: "r1", kind: "choice", title: "誘いに乗る？", targets: ["a"], options: ["乗る", "断る"], responses: {} }] };
    const h = harness(GmRequestOverlay, gs, { user: { uid: "a" } });
    fireEvent.click(screen.getByText("断る"));
    expect(getRequests(h.gs)[0].responses.a.choice).toBe(1);
    expect(screen.queryByText("誘いに乗る？")).not.toBeInTheDocument();
  });

  it("他人宛ての要求は表示しない", () => {
    const gs = { ...gs0(), gmRequests: [{ id: "r1", kind: "notice", title: "告知X", targets: ["a"], responses: {} }] };
    harness(GmRequestOverlay, gs, { user: { uid: "b" } });
    expect(screen.queryByText("告知X")).not.toBeInTheDocument();
  });

  it("ダイスを振る→応援できる人に応援カードが出る", async () => {
    vi.useFakeTimers();
    const gs = { ...gs0(), gmRequests: [{ id: "r1", kind: "dice", title: "判定", targets: ["a"], dice: { count: 2, mode: "nd6", target: 6 }, responses: {} }] };
    const h = harness(GmRequestOverlay, gs, { user: { uid: "a" } });
    fireEvent.click(screen.getByText("🎲 ダイスを振る"));
    await act(async () => { vi.advanceTimersByTime(1000); });
    vi.useRealTimers();
    expect(getRequests(h.gs)[0].responses.a.dice).toHaveLength(2);
    expect(screen.getByText("この結果で確定する")).toBeInTheDocument();
    // 魔理沙の画面では応援カードが出る
    cleanup();
    harness(GmRequestOverlay, h.gs, { user: { uid: "b" } });
    expect(screen.getByText(/《霊夢への絆》で応援/)).toBeInTheDocument();
  });
});

describe("PC カードの GM 編集", () => {
  it("変調付与・絆追加・行動済み切替", () => {
    const h = harness(GmPcEditor, gs0(), { pc: pcs[0], SPOTS: [{ id: "s1", name: "神社" }], getSpot: () => null });
    fireEvent.click(screen.getByText("怪我"));
    fireEvent.click(screen.getByText("＋魔理沙への絆"));
    fireEvent.click(screen.getByText("行動済みにする"));
    const a = h.gs.pcs.find(x => x.uid === "a");
    expect(a.badStatus).toEqual(["怪我"]);
    expect(a.bonds).toEqual(["魔理沙への絆"]);
    expect(h.gs.actedPcs).toEqual(["a"]);
  });
});
