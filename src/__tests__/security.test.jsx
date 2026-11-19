// セキュリティ修正（PR #2 の CodeRabbit 指摘）のテスト
//   段階1: タイミングのメモは roomSecrets、クエストの敵データは公開しない
//   段階2: GM の要求の定義は GM だけが書ける場所（ビューと state の変換）
//   段階3: クエストの真相は GM の承認で公開
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
vi.mock("../firebase", () => ({ db: {}, auth: {} }));
import {
  viewOfState, splitView, publicQuest, mergeScenarioSecret, reconcileQuests, computeGsUpdate, normalizeGs, sanitizeGsForWrite,
} from "../gsSync";
import { addRequest, respondDice, removeRequest, getRequests, fillAwaitingEnemies } from "../gmTools";
import { upsertDef, applyPreset, getCustom } from "../customRules";
import { getIhenPreset } from "../data/ihenPresets";
import { GmTruthApproval } from "../session/reminders";

afterEach(cleanup);

const pcs = [{ uid: "a", charName: "霊夢", currentSpot: "s1" }, { uid: "b", charName: "魔理沙", currentSpot: "s1" }];
const state0 = () => normalizeGs({ sessionPhase: "explore", pcs, log: [] });

// SessionApp.upd と同じ手順で 1 回更新する（ビューを作る → 更新関数 → 分割）
function updOnce(state, fn, { defs = {}, secret = null, gm = false } = {}) {
  const prev = viewOfState(state, { requestDefs: defs, secretCustom: gm ? secret : null });
  const { next } = computeGsUpdate(prev, fn);
  return splitView(next, { prevState: state, knownIds: prev.gmRequests.map(r => r.id), authoritative: gm });
}

describe("段階1: タイミングのメモは公開の state に書かない", () => {
  it("GM が追加したメモは secretCustom に分かれ、state には残らない", () => {
    const parts = updOnce(state0(), p => upsertDef(p, "reminders", { id: "m1", timing: "cycle_start", text: "黒幕は〇〇" }), { gm: true, secret: {} });
    expect(parts.state.custom?.reminders).toBeUndefined();
    expect(JSON.stringify(parts.state)).not.toContain("黒幕");
    expect(parts.secretCustom.reminders).toHaveLength(1);
  });

  it("プリセットのメモも同じく分かれ、GM のビューでは合わさって見える", () => {
    const parts = updOnce(state0(), p => applyPreset(p, getIhenPreset("eiya"), "eiya"), { gm: true, secret: {} });
    expect(parts.state.custom.reminders).toBeUndefined();
    expect(getCustom(parts.state).stats.length).toBeGreaterThan(0); // メモ以外の定義は公開のまま
    const gmView = viewOfState(normalizeGs(parts.state), { secretCustom: { reminders: parts.secretCustom.reminders } });
    expect(getCustom(gmView).reminders.map(r => r.id)).toEqual(["eiya__m1", "eiya__m2"]);
    expect(getCustom(viewOfState(normalizeGs(parts.state), {})).reminders).toEqual([]); // PL には見えない
  });
});

describe("段階1: クエストの敵データ", () => {
  const sq = { id: 1, name: "Q", truth: "真相", enemy: { name: "ルーミア", life: 2 }, extraEnemies: [{ name: "妖精" }], massBattle: true };

  it("公開版からは敵データを外し、敵がいることだけ残す", () => {
    const pub = publicQuest({ ...sq, revealed: true, solved: false });
    expect(pub.enemy).toBeUndefined();
    expect(pub.extraEnemies).toBeUndefined();
    expect(pub.truth).toBeUndefined();
    expect(pub).toMatchObject({ hasEnemy: true, extraEnemyCount: 1, massBattle: true });
    expect(sanitizeGsForWrite({ quests: [sq] }).quests[0].enemy).toBeUndefined();
  });

  it("GM の表示では敵データを戻す", () => {
    const view = mergeScenarioSecret({ quests: [publicQuest(sq)] }, { quests: [sq] });
    expect(view.quests[0].enemy.name).toBe("ルーミア");
  });

  it("PL が始めた戦闘に GM のクライアントが敵を補う。見つからなければ中止してシーンに戻す", () => {
    const p = { pcs, log: [], battle: { active: true, type: "mass", questId: 1, awaitingEnemies: true, participants: { npcs: [] }, resumeScene: { pcUid: "a" } } };
    const filled = fillAwaitingEnemies(p, [sq], 5);
    expect(filled.battle.awaitingEnemies).toBeNull();
    expect(filled.battle.participants.npcs.map(n => n.name)).toEqual(["ルーミア", "妖精"]);
    const missing = fillAwaitingEnemies(p, [{ id: 9 }], 5);
    expect(missing.battle.active).toBe(false);
    expect(missing.currentScene).toEqual({ pcUid: "a" });
    expect(missing.log[0]).toMatch(/中止/);
  });
});

describe("段階2: GM の要求の定義と回答", () => {
  it("GM が送った要求は定義（GM 専用の場所）と回答（state）に分かれる", () => {
    const parts = updOnce(state0(), p => addRequest(p, { kind: "dice", targets: ["a"], title: "判定", dice: { count: 2, mode: "nd6" } }, "q1", 1), { gm: true });
    expect(parts.state.gmRequests).toBeUndefined();
    expect(parts.state.reqResponses).toBeNull();
    expect(parts.requestDefs.q1).toMatchObject({ id: "q1", kind: "dice", title: "判定" });
    expect(parts.requestDefs.q1.responses).toBeUndefined();
  });

  it("PL の回答は state.reqResponses に入り、定義は変わらない", () => {
    const defs = { q1: { id: "q1", kind: "dice", targets: ["a"], dice: { count: 2, mode: "nd6" }, createdAt: 1 } };
    const parts = updOnce(state0(), p => respondDice(p, "q1", "a", [3, 4]), { defs });
    expect(parts.state.reqResponses.q1.a.dice).toEqual([3, 4]);
    // 定義を知らない（まだ届いていない）要求への他人の回答は消さない
    const st = normalizeGs({ ...state0(), reqResponses: { q9: { b: { dice: [6] } } } });
    const kept = updOnce(st, p => ({ ...p, log: ["x", ...p.log] }), { defs });
    expect(kept.state.reqResponses.q9.b.dice).toEqual([6]);
  });

  it("GM が閉じた要求は、定義も回答も消える", () => {
    const defs = { q1: { id: "q1", kind: "notice", targets: ["a"], createdAt: 1 } };
    const st = normalizeGs({ ...state0(), reqResponses: { q1: { a: { ack: true } }, stale: { a: {} } } });
    const parts = updOnce(st, p => removeRequest(p, "q1"), { defs, gm: true });
    expect(parts.requestDefs).toEqual({});
    expect(parts.state.reqResponses).toBeNull(); // GM は定義の正本を持つので、定義の無い回答も片付ける
  });

  it("state に紛れ込んだ旧形式の gmRequests は、ビューに出さない（PL が偽の要求を書いても表示されない）", () => {
    const st = normalizeGs({ ...state0(), gmRequests: [{ id: "fake", kind: "notice", title: "偽", targets: ["a"] }] });
    expect(getRequests(viewOfState(st, { requestDefs: {} }))).toEqual([]);
  });
});

describe("段階3: クエストの真相は GM の承認で公開", () => {
  const scQs = [
    { id: 1, name: "Q1", truth: "T1" },
    { id: 2, name: "Q2", truth: "T2" },
    { id: 3, name: "Q3", truth: "T3", unlockType: "quest", unlockQuestId: 1 },
  ];
  const quests = [{ id: 1, name: "Q1", solved: true }, { id: 2, name: "Q2", solved: true }];

  it("承認したクエストだけ真相を付け、次のクエストもそのときだけ解放する", () => {
    const only2 = reconcileQuests(quests, scQs, [2]);
    expect(only2.find(q => q.id === 1).truth).toBeUndefined();
    expect(only2.find(q => q.id === 2).truth).toBe("T2");
    expect(only2.some(q => q.id === 3)).toBe(false);
    const all = reconcileQuests(quests, scQs);
    expect(all.find(q => q.id === 3)).toMatchObject({ revealed: true, solved: false });
  });

  it("GM の表示では、未公開の真相に truthPending が付き、承認カードが出る", () => {
    const view = mergeScenarioSecret({ quests }, { quests: scQs });
    expect(view.quests.every(q => q.truthPending)).toBe(true);
    const onReveal = vi.fn();
    const onAuto = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<GmTruthApproval gs={view} onReveal={onReveal} onAuto={onAuto} />);
    fireEvent.click(screen.getAllByText("公開する")[0]);
    expect(onReveal).toHaveBeenCalledWith([1]);
    fireEvent.click(screen.getByText("すべて公開する"));
    expect(onReveal).toHaveBeenLastCalledWith([1, 2]);
    fireEvent.click(screen.getByText("以後は自動で公開する"));
    expect(onAuto).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("公開待ちが無ければ何も出さない", () => {
    render(<GmTruthApproval gs={{ quests: [{ id: 1, solved: true, truth: "T" }] }} onReveal={() => {}} onAuto={() => {}} />);
    expect(screen.queryByTestId("truth-approval")).toBeNull();
  });
});
