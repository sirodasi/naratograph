import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
vi.mock("../firebase", () => ({ db: {}, auth: {} }));
import { CustomRulesEditor, CustomBoard, CustomPcSection } from "../session/customPanel";
import { getCustom, upsertDef, giveItem, pcCustom, parseTableRows } from "../customRules";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function harness(Comp, initial, props = {}) {
  let gs = initial;
  const upd = (fn) => { gs = fn(gs); view.rerender(<Comp gs={gs} upd={upd} {...props} />); return Promise.resolve({ committed: true, gs }); };
  const view = render(<Comp gs={gs} upd={upd} {...props} />);
  return { get gs() { return gs; } };
}

const pcs = [
  { uid: "a", charName: "霊夢", currentSpot: "11" },
  { uid: "b", charName: "魔理沙", currentSpot: "11" },
  { uid: "c", charName: "咲夜", currentSpot: "12" },
];
const gs0 = () => ({ pcs, log: [], day: 1, cycleIdx: 0, limit: "3日目の夜" });
const SPOTS = [{ id: "11", roll: 11, name: "人間の里" }, { id: "12", roll: 12, name: "命蓮寺" }, { id: "dream", name: "夢の世界" }];

describe("独自タブ（GM）", () => {
  it("独自ステータスを追加できる", () => {
    const h = harness(CustomRulesEditor, gs0(), { SPOTS });
    fireEvent.click(screen.getByText(/独自ステータス/));
    fireEvent.change(screen.getByPlaceholderText("名前（例: 春度）"), { target: { value: "春度" } });
    fireEvent.change(screen.getAllByPlaceholderText("なし")[0], { target: { value: "5" } });
    fireEvent.click(screen.getByText("追加"));
    expect(getCustom(h.gs).stats[0]).toMatchObject({ name: "春度", scope: "pc", min: 0, max: 5, init: 0 });
  });

  it("ルールを掲示すると全員の掲示板に出る", () => {
    const h = harness(CustomRulesEditor, gs0(), { SPOTS });
    fireEvent.click(screen.getByText(/ルールの掲示/));
    fireEvent.change(screen.getByPlaceholderText(/見出し/), { target: { value: "春雪異変" } });
    fireEvent.change(screen.getByPlaceholderText(/ルール本文/), { target: { value: "春度を集める" } });
    fireEvent.click(screen.getByText("掲示する"));
    cleanup();
    render(<CustomBoard gs={h.gs} upd={() => {}} isGm={false} />);
    fireEvent.click(screen.getByText(/春雪異変/));
    expect(screen.getByText("春度を集める")).toBeInTheDocument();
  });

  it("表を作って振り、結果のアイテムをPCに渡せる", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // 出目は全て 1
    let gs = upsertDef(gs0(), "items", { id: "red", name: "ベントラー赤" });
    gs = upsertDef(gs, "tables", { id: "t", name: "ベントラー決定表", dice: "d6", rows: parseTableRows("1-2 ベントラー赤\n3-6 その他") });
    const h = harness(CustomRulesEditor, gs, { SPOTS });
    fireEvent.click(screen.getByText(/カスタム表/));
    fireEvent.change(screen.getByDisplayValue("表を選択..."), { target: { value: "t" } });
    fireEvent.click(screen.getByText("振る"));
    expect(h.gs.log[0]).toContain("1→ベントラー赤");
    fireEvent.change(screen.getAllByDisplayValue("PC...").at(-1), { target: { value: "b" } });
    fireEvent.click(screen.getAllByText("渡す").at(-1));
    expect(pcCustom(h.gs.pcs[1]).items).toHaveLength(1);
    expect(await screen.findByText("渡した")).toBeInTheDocument();
  });

  it("マップの独自コマをランダム配置（1スポット1つまで・夢の世界は除外）", () => {
    let gs = upsertDef(gs0(), "tokens", { id: "k", name: "春のかけら", color: "#f8a", unique: true });
    const h = harness(CustomRulesEditor, gs, { SPOTS, getSpot: id => SPOTS.find(s => s.id === id) });
    fireEvent.click(screen.getByText(/マップの独自コマ/));
    fireEvent.click(screen.getByText("ランダム配置")); // 既定は PC 人数（3）→ 候補 2 スポットのみ
    const spots = getCustom(h.gs).mapTokens.map(t => t.spot).sort();
    expect(spots).toEqual(["11", "12"]);
  });

  it("時間操作：このサイクルをもう一度", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const h = harness(CustomRulesEditor, { ...gs0(), actedPcs: ["a"] }, { SPOTS });
    fireEvent.click(screen.getByText(/時間操作/));
    fireEvent.click(screen.getByText("このサイクルをもう一度行う"));
    expect(h.gs.actedPcs).toEqual([]);
    expect(h.gs.log[0]).toContain("もう一度行う");
  });
});

describe("PCカードの独自要素", () => {
  const withItem = () => {
    let gs = upsertDef(gs0(), "items", { id: "red", name: "ベントラー赤", desc: "赤い破片" });
    gs = upsertDef(gs, "states", { id: "s", name: "森羅結界", desc: "霊撃可" });
    return giveItem(gs, "a", "red", "i1");
  };

  it("本人は同じスポットのPCにだけ渡せる", () => {
    const gs = withItem();
    const h = harness(CustomPcSection, gs, { pc: gs.pcs[0], isGm: false, myUid: "a" });
    expect(screen.getByText("赤い破片")).toBeInTheDocument();
    fireEvent.click(screen.getByText("渡す"));
    expect(screen.queryByText("→ 咲夜")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("→ 魔理沙"));
    expect(pcCustom(h.gs.pcs[1]).items).toHaveLength(1);
  });

  it("他人のアイテムは操作できず、未付与の状態は表示しない", () => {
    const gs = withItem();
    harness(CustomPcSection, gs, { pc: gs.pcs[0], isGm: false, myUid: "b" });
    expect(screen.queryByText("使う")).not.toBeInTheDocument();
    expect(screen.queryByText(/森羅結界/)).not.toBeInTheDocument();
  });

  it("GM は状態を付与できる", () => {
    const gs = withItem();
    const h = harness(CustomPcSection, gs, { pc: gs.pcs[0], isGm: true, myUid: "gm" });
    fireEvent.click(screen.getByText(/森羅結界/));
    expect(pcCustom(h.gs.pcs[0]).states).toEqual(["s"]);
  });
});
