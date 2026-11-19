// PR #2 の CodeRabbit 指摘（4〜5回目）への修正の回帰テスト
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
vi.mock("../firebase", () => ({ db: {}, auth: {} }));
vi.mock("../audio", () => ({ sfx: new Proxy({}, { get: () => () => {} }) }));
import { splitView, normalizeGs } from "../gsSync";
import { ActionRenderer } from "../session/pcCard";

afterEach(cleanup);

describe("旧形式のタイミングのメモ", () => {
  const prevState = normalizeGs({ pcs: [], log: [], custom: { reminders: [{ id: "m", text: "旧メモ" }], stats: [] } });

  it("写し終える前は、更新後の custom が null・無しでも旧形式のメモを state に残す", () => {
    for (const view of [{ ...prevState, custom: null }, (({ custom: _c, ...v }) => v)(prevState)]) {
      const { state } = splitView(view, { prevState, keepSecretCustom: true });
      expect(state.custom.reminders).toEqual([{ id: "m", text: "旧メモ" }]);
    }
  });

  it("写し終えた後（keepSecretCustom なし）は state から消える", () => {
    const { state } = splitView(prevState, { prevState });
    expect(state.custom.reminders).toBeUndefined();
  });
});

describe("イベント効果の完了（アイテム交換）", () => {
  const pc = { uid: "a", charName: "霊夢", items: { お酒: 1, 小銭: 0 }, resources: {}, bonds: [] };
  const sceneAt = (idx, items = pc.items) => ({
    pcs: [{ ...pc, items }], log: [],
    currentScene: { pcUid: "a", phase: "explore_apply_effect", currentActionIndex: idx, eventActions: [{ type: "OPTIONAL_TRADE", gain: "any" }, { type: "X" }] },
  });
  function harness(initial, actionIndex) {
    let gs = initial;
    const upd = (fn) => { gs = fn(gs); return Promise.resolve({ committed: true, gs }); };
    render(<ActionRenderer act={{ type: "OPTIONAL_TRADE", gain: "any" }} actionIndex={actionIndex} pc={pc} gs={gs} upd={upd} animateDice={() => {}} SPOTS={[]} getSpot={() => null} isDone={false} />);
    return { get gs() { return gs; }, set gs(v) { gs = v; } };
  }
  const trade = () => {
    fireEvent.click(screen.getByText("お酒 を手放す"));
    fireEvent.click(screen.getByText("小銭"));
  };

  it("通常は交換して次のアクションへ進む", () => {
    const h = harness(sceneAt(0), 0);
    trade();
    expect(h.gs.pcs[0].items).toMatchObject({ お酒: 0, 小銭: 1 });
    expect(h.gs.currentScene.currentActionIndex).toBe(1);
    expect(h.gs.log[0]).toMatch(/手放し/);
  });

  it("手放すアイテムが（振っている間などに）無くなっていたら、何も変えず成功のログも残さない", () => {
    const h = harness(sceneAt(0), 0);
    h.gs = sceneAt(0, { お酒: 0, 小銭: 0 });
    trade();
    expect(h.gs.pcs[0].items).toEqual({ お酒: 0, 小銭: 0 });
    expect(h.gs.currentScene.currentActionIndex).toBe(0);
    expect(h.gs.log).toEqual([]);
  });

  it("同じアクションの完了が二重に届いても（シーンが先へ進んでいれば）適用しない", () => {
    const h = harness(sceneAt(0), 0);
    h.gs = sceneAt(1); // 既に別の完了で次へ進んだ
    trade();
    expect(h.gs.pcs[0].items).toEqual(pc.items);
    expect(h.gs.currentScene.currentActionIndex).toBe(1);
  });
});
