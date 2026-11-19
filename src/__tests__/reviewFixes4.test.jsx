// PR #2 の CodeRabbit 指摘（7回目の確認）で求められた回帰テスト
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
vi.mock("../firebase", () => ({ db: {}, auth: {} }));
vi.mock("../audio", () => ({ sfx: new Proxy({}, { get: () => () => {} }) }));
import { legacyReminderPatch, missingLegacyReminders, splitView, normalizeGs } from "../gsSync";
import { ActionRenderer } from "../session/pcCard";
import { GmQuestGateInit } from "../session/reminders";
import { lastResortHeld, LAST_RESORT_HOLD_MS } from "../session/battle";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("旧形式のタイミングのメモの移行", () => {
  const A = { id: "a", text: "旧メモA" };
  const B = { id: "b", text: "GM 用の場所にあるメモB" };

  it("GM 用の場所に別のメモがあっても、旧形式のメモを足す（既存のメモは上書きしない）", () => {
    expect(legacyReminderPatch([A], { b: B })).toEqual({ a: A });
    expect(legacyReminderPatch([A, B], { b: { ...B, text: "別タブで編集" } })).toEqual({ a: A });
    // 配列の番号をキーにして保存されていても id で判断する
    expect(legacyReminderPatch([A], { 0: A })).toEqual({});
  });

  it("写した後に1件でも足りなければ、写し終えた扱いにしない（書き込み失敗）", () => {
    expect(missingLegacyReminders([A, B], { b: B })).toEqual([A]);
    expect(missingLegacyReminders([A, B], { a: A, b: B })).toEqual([]);
  });

  it("取り消しでも、写し終える前なら旧形式のメモを state に残す", () => {
    const cur = normalizeGs({ pcs: [], log: [], custom: { reminders: [A] } });
    const undoView = { ...normalizeGs({ pcs: [], log: [] }), custom: { stats: [] } }; // 移行前の状態に戻す取り消し
    const { state } = splitView(undoView, { authoritative: true, prevState: cur, keepSecretCustom: true });
    expect(state.custom.reminders).toEqual([A]);
  });
});

describe("アイテム交換（ランダム）: 振っている間に手放すアイテムが無くなった", () => {
  it("ダイスの結果が届いても、何も変えず成功のログも残さず次へ進まない", () => {
    const pc = { uid: "a", charName: "霊夢", items: { お酒: 1, 小銭: 0 }, resources: {}, bonds: [] };
    let gs = { pcs: [pc], log: [], currentScene: { pcUid: "a", phase: "explore_apply_effect", currentActionIndex: 0 } };
    const upd = (fn) => { gs = fn(gs); return Promise.resolve({ committed: true, gs }); };
    let pendingCb = null;
    const animateDice = (n, label, cb) => { pendingCb = cb; }; // ダイスを振り始めた（結果はまだ）
    render(<ActionRenderer act={{ type: "OPTIONAL_TRADE", gain: "random" }} actionIndex={0} pc={pc} gs={gs} upd={upd} animateDice={animateDice} SPOTS={[]} getSpot={() => null} isDone={false} />);
    fireEvent.click(screen.getByText("お酒 を手放す"));
    fireEvent.click(screen.getByText(/ランダムなアイテムを獲得する/));
    expect(pendingCb).toBeTypeOf("function");
    // 振っている間に、お酒を使ってしまった
    gs = { ...gs, pcs: [{ ...pc, items: { お酒: 0, 小銭: 0 } }] };
    pendingCb([2]); // 出目 2 = 小銭
    expect(gs.pcs[0].items).toEqual({ お酒: 0, 小銭: 0 });
    expect(gs.log).toEqual([]);
    expect(gs.currentScene.currentActionIndex).toBe(0);
  });
});

describe("旧形式の部屋のクエストの公開記録", () => {
  it("GM が登場済み・真相公開済みを選んで記録する（最初のクエストは登場済みが初期値）", () => {
    const onSave = vi.fn();
    render(<GmQuestGateInit candidates={[
      { id: 1, name: "Q1", solved: true, start: true },
      { id: 2, name: "Q2", solved: false, start: false },
    ]} onSave={onSave} />);
    // 解決済みの Q1 の真相は、GM が確かめて公開済みにする
    fireEvent.click(screen.getAllByText("真相公開済み")[0]);
    fireEvent.click(screen.getByText("この内容で記録する"));
    expect(onSave).toHaveBeenCalledWith([1], [1]);
  });
});

describe("喰らいボムの予約", () => {
  it("振っている間だけ有効で、完了しなかった古い予約は一定時間で取り直せる", () => {
    const now = 1_000_000;
    expect(lastResortHeld({ t: "x", at: now - 1000 }, now)).toBe(true);
    expect(lastResortHeld({ t: "x", at: now - LAST_RESORT_HOLD_MS - 1 }, now)).toBe(false);
    expect(lastResortHeld(null, now)).toBe(false);
  });
});
