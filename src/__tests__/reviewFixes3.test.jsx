// PR #2 の CodeRabbit 指摘（6回目の確認）で求められた回帰テスト
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
vi.mock("../firebase", () => ({ db: {}, auth: {} }));
vi.mock("../audio", () => ({ sfx: new Proxy({}, { get: () => () => {} }) }));
import { CustomRulesEditor } from "../session/customPanel";
import { canRunMainActionByEnter } from "../session/rightPanel";
import { upsertDef, pcCustom, parseTableRows, applyPreset, getCustom } from "../customRules";
import { addRequest, respondDice, getRequests, tableGrantIid } from "../gmTools";
import { getIhenPreset } from "../data/ihenPresets";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const pcs = [{ uid: "a", charName: "霊夢", currentSpot: "11" }, { uid: "b", charName: "魔理沙", currentSpot: "11" }];

describe("表の報酬を PC に渡す（GM の独自タブ）", () => {
  // results: upd の結果を順に返す（committed: false は書き込みの失敗）
  function harness(initial, results) {
    let gs = initial;
    let n = 0;
    const calls = [];
    const upd = (fn) => {
      const r = results[Math.min(n++, results.length - 1)];
      calls.push(fn);
      if (r.committed) { gs = fn(gs); view.rerender(<CustomRulesEditor gs={gs} upd={upd} SPOTS={[]} />); }
      return Promise.resolve(r.committed ? { committed: true, gs } : { committed: false, gs: null });
    };
    const view = render(<CustomRulesEditor gs={gs} upd={upd} SPOTS={[]} />);
    return { get gs() { return gs; }, calls };
  }
  const setup = () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // 出目は全て 1
    let gs = upsertDef({ pcs, log: [] }, "items", { id: "red", name: "ベントラー赤" });
    return upsertDef(gs, "tables", { id: "t", name: "決定表", dice: "d6", rows: parseTableRows("1-6 ベントラー赤") });
  };
  const rollAndPick = () => {
    fireEvent.click(screen.getByText(/カスタム表/));
    fireEvent.change(screen.getByDisplayValue("表を選択..."), { target: { value: "t" } });
    fireEvent.click(screen.getByText("振る"));
    fireEvent.change(screen.getAllByDisplayValue("PC...").at(-1), { target: { value: "b" } });
  };

  it("渡している間はボタンが消え、連続して押しても1回しか渡さない", async () => {
    const h = harness(setup(), [{ committed: true }]);
    rollAndPick();
    const updsBefore = h.calls.length;
    const btn = screen.getAllByText("渡す").at(-1);
    fireEvent.click(btn);
    fireEvent.click(btn); // 連続クリック
    expect(h.calls.length).toBe(updsBefore + 1);
    expect(await screen.findByText("渡した")).toBeInTheDocument();
    expect(pcCustom(h.gs.pcs[1]).items).toHaveLength(1);
  });

  it("書き込みに失敗したら「渡す」に戻り、もう一度渡せる", async () => {
    const h = harness(setup(), [{ committed: true }, { committed: false }, { committed: true }]);
    rollAndPick();
    fireEvent.click(screen.getAllByText("渡す").at(-1));
    await act(async () => {}); // 失敗の結果を待つ
    expect(screen.queryByText("渡した")).toBeNull();
    expect(pcCustom(h.gs.pcs[1]).items).toHaveLength(0);
    fireEvent.click(screen.getAllByText("渡す").at(-1)); // 再試行
    expect(await screen.findByText("渡した")).toBeInTheDocument();
    expect(pcCustom(h.gs.pcs[1]).items).toHaveLength(1);
  });
});

describe("表のダイス要求: 回答が消されて答え直しても二重に渡さない", () => {
  it("iid は要求 × PC で決まり、既に持っていれば渡さずに「渡し済み」だけ戻す", () => {
    let p = applyPreset({ pcs, log: [] }, getIhenPreset("takarabune"), "tb");
    p = addRequest(p, { kind: "dice", targets: ["a"], table: { ...getCustom(p).tables[0], give: true } }, "q1", 1);
    p = respondDice(p, "q1", "a", [3]);
    expect(pcCustom(p.pcs[0]).items.map(i => i.iid)).toEqual([tableGrantIid("q1", "a")]);
    // 誰かが回答を丸ごと消した → 本人が答え直す
    p = { ...p, gmRequests: getRequests(p).map(r => ({ ...r, responses: {} })) };
    p = respondDice(p, "q1", "a", [3]);
    expect(pcCustom(p.pcs[0]).items).toHaveLength(1);
    expect(getRequests(p)[0].responses.a.given).toBe(true);
  });
});

describe("Enter の主要アクション", () => {
  const base = { isGm: true, hasAction: true, interactive: false, inBattle: false, overlayOpen: false, dialogOpen: false };
  it("通常は実行する", () => {
    expect(canRunMainActionByEnter(base)).toBe(true);
  });
  it("新聞やショートカット一覧を開いている間（フォーカスがモーダルの外でも）は実行しない", () => {
    expect(canRunMainActionByEnter({ ...base, overlayOpen: true })).toBe(false);
    expect(canRunMainActionByEnter({ ...base, dialogOpen: true })).toBe(false);
  });
  it("ボタンにフォーカスがある・弾幕ごっこ中・PL・主要アクションが無いときは実行しない", () => {
    expect(canRunMainActionByEnter({ ...base, interactive: true })).toBe(false);
    expect(canRunMainActionByEnter({ ...base, inBattle: true })).toBe(false);
    expect(canRunMainActionByEnter({ ...base, isGm: false })).toBe(false);
    expect(canRunMainActionByEnter({ ...base, hasAction: false })).toBe(false);
  });
});
