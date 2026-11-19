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

describe("旧形式の部屋: PL が真相と solved を書いても、GM の確認前は信用しない", () => {
  it("候補は秘匿シナリオにあるクエストだけで、真相公開済みは初期値では付かない（登場済みは最初のクエストだけ）", async () => {
    const { questGateCandidates } = await import("../gsSync");
    const { fillAwaitingEnemies } = await import("../gmTools");
    const scenario = [
      { id: 1, name: "Q1", truth: "T1", enemy: { name: "敵1", life: 1 } },
      { id: 2, name: "Q2", truth: "T2", unlockType: "quest", unlockQuestId: 1, enemy: { name: "秘密の敵", life: 2 } },
    ];
    // PL が未登場の Q2 を「真相つき・解決済み」として書き、架空のクエストも足した
    const playerQuests = [{ id: 1, name: "Q1", solved: true, truth: "T1" }, { id: 2, name: "偽", solved: true, truth: "T2" }, { id: 9, name: "架空" }];
    const cands = questGateCandidates(playerQuests, scenario);
    expect(cands.map(c => c.id)).toEqual([1, 2]); // 架空のクエストは出さない
    expect(cands.find(c => c.id === 2)).toMatchObject({ name: "Q2", start: false }); // 名前は秘匿シナリオのもの・登場済みの初期値なし
    // GM の確認前（公開記録で未登場）に Q2 の戦闘が作られても、敵データは補わずに中止する
    const battle = { pcs: [], log: [], battle: { active: true, questId: 2, awaitingEnemies: true, participants: { npcs: [] } } };
    const out = fillAwaitingEnemies(battle, [], 1);
    expect(out.battle.active).toBe(false);
    expect(JSON.stringify(out)).not.toContain("秘密の敵");
  });
});
