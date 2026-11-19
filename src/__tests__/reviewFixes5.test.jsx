// PR #2 の CodeRabbit 指摘（8回目の確認）で求められた回帰テスト
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
vi.mock("../firebase", () => ({ db: {}, auth: {} }));
vi.mock("../audio", () => ({ sfx: new Proxy({}, { get: () => () => false }) }));
import { convertReminderKeys, insertReminderIfAbsent } from "../gsSync";
import { RightPanel } from "../session/rightPanel";
import { CYCLES, CYCLE_COLORS, NEWSPAPER, SPOTS } from "../data/gameData";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("GM 用のメモの移行・形式の変換（トランザクションの更新関数）", () => {
  it("書く時点でまだ無いときだけ写す（読んだ後に別タブが同じ id を写して編集していたら上書きしない）", () => {
    const legacy = { id: "m1", text: "旧メモ" };
    expect(insertReminderIfAbsent(legacy)(null)).toEqual(legacy);
    expect(insertReminderIfAbsent(legacy)({ id: "m1", text: "別タブで編集" })).toBeUndefined(); // 中止＝既存を残す
  });

  it("番号キーを id キーへ直す。同じ id のキーが既にあれば、そちら（編集済み）を優先する", () => {
    expect(convertReminderKeys({ 0: { id: "m1", text: "古い写し" }, m1: { id: "m1", text: "編集済み" } }))
      .toEqual({ m1: { id: "m1", text: "編集済み" } });
    expect(convertReminderKeys({ 0: { id: "m1", text: "a" } })).toEqual({ m1: { id: "m1", text: "a" } });
    expect(convertReminderKeys({ m1: { id: "m1", text: "a" } })).toBeUndefined(); // 変更なし＝中止
    expect(convertReminderKeys(null)).toBeUndefined();
  });
});

describe("Enter の主要アクション（RightPanel を実際に描画）", () => {
  function renderPanel(animateDice) {
    const gs = {
      sessionPhase: "explore", day: 1, cycleIdx: 0, pcs: [], quests: [], clues: [], log: [], actedPcs: [],
      newspaper: { ...NEWSPAPER[11], roll: 11, title: "テストの号外" }, newspaperDone: true, cluePlaced: false,
      resources: {}, items: {}, currentScene: null,
    };
    render(
      <RightPanel gs={gs} upd={() => Promise.resolve({ committed: true, gs })} sceneData={{}} setSceneData={() => {}}
        isGm user={{ uid: "gm" }} room={{ gmUid: "gm", config: {} }} animateDice={animateDice}
        CYCLES={CYCLES} CYCLE_COLORS={CYCLE_COLORS} NEWSPAPER={NEWSPAPER} getSpot={() => null}
        doNewspaper={() => {}} doReiryoku={() => {}} setPendingAction={() => {}} SPOTS={SPOTS} />
    );
  }
  const pressEnterOnPage = () => act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });

  it("何も開いていなければ、Enter で主要アクション（手がかりの配置）を実行する", () => {
    const animateDice = vi.fn();
    renderPanel(animateDice);
    pressEnterOnPage();
    expect(animateDice).toHaveBeenCalledWith(2, "朝の手がかり配置", expect.any(Function));
  });

  it("新聞を開いている間は、フォーカスがモーダルの外でも Enter で主要アクションを実行しない", () => {
    const animateDice = vi.fn();
    renderPanel(animateDice);
    fireEvent.click(screen.getByText("テストの号外")); // 新聞を開く
    expect(screen.getAllByText(/テストの号外/).length).toBeGreaterThan(1); // モーダルが開いた
    expect(document.activeElement === document.body || !document.activeElement?.closest?.("[role=dialog]")).toBe(true);
    pressEnterOnPage();
    expect(animateDice).not.toHaveBeenCalled();
  });
});
