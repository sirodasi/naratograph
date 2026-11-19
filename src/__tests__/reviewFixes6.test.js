import { describe, it, expect } from "vitest";
import { clearOwnGatePending, gateRecoveryActions, recoverRevealTx, undoGateTx } from "../gsSync";

describe("clearOwnGatePending（承認で解放したクエストの確認待ちの解除）", () => {
  it("指定の操作（opId）が付けた確認待ちだけを外す", () => {
    const qs = [{ id: 2, gatePending: "op_a" }, { id: 3, gatePending: "op_b" }, { id: 4 }];
    const out = clearOwnGatePending(qs, [2, 3], "op_a");
    expect(out[0]).toEqual({ id: 2 });
    expect(out[1]).toEqual({ id: 3, gatePending: "op_b" }); // 別の承認が付け直した確認待ちは残す
    expect(out[2]).toBe(qs[2]);
  });
  it("取り消し後に別の承認が付け直した確認待ちを、古い操作の完了で外さない", () => {
    const qs = [{ id: 2, gatePending: "op_new" }];
    expect(clearOwnGatePending(qs, [2], "op_old")).toBe(qs);
  });
  it("対象外の id や変化が無いときは同じ配列を返す", () => {
    const qs = [{ id: 2, gatePending: "op_a" }];
    expect(clearOwnGatePending(qs, [9], "op_a")).toBe(qs);
    expect(clearOwnGatePending(undefined, [2], "op_a")).toBeUndefined();
  });
});

describe("gateRecoveryActions（再読み込み後の確認待ちの回復）", () => {
  const sc = [
    { id: 1, unlockType: "start" },
    { id: 2, unlockType: "quest", unlockQuestId: 1 },
    { id: 3, unlockType: "quest", unlockQuestId: 2 },
  ];
  it("公開記録で登場済みなら確認待ちを外すだけ", () => {
    const gate = { revealed: { 1: true, 2: "op_a" }, approved: { 1: "op_a" } };
    expect(gateRecoveryActions([{ id: 2, gatePending: "op_a" }], sc, gate)).toEqual([{ id: 2, opId: "op_a", action: "clear", value: "op_a" }]);
  });
  it("元のクエストが承認済みで、登場済みの記録だけ失われていたら記録を書く", () => {
    const gate = { revealed: { 1: true }, approved: { 1: "op_a" } };
    expect(gateRecoveryActions([{ id: 2, gatePending: "op_a" }], sc, gate)).toEqual([{ id: 2, opId: "op_a", action: "reveal", value: "op_a", parent: 1 }]);
  });
  it("古い確認待ち（opA）が残ったまま再承認（opB）された場合、書く記録は再承認の操作（opB）のものにする", () => {
    // opB を取り消すと opB の記録だけが外れるので、回復で書いた登場済みの記録も一緒に外れる
    const gate = { revealed: { 1: true }, approved: { 1: "op_b" } };
    expect(gateRecoveryActions([{ id: 2, gatePending: "op_a" }], sc, gate)).toEqual([{ id: 2, opId: "op_a", action: "reveal", value: "op_b", parent: 1 }]);
  });
  it("公開条件が「クエスト解決時」以外なら、残っている unlockQuestId を根拠に登場済みにしない", () => {
    const sc2 = [{ id: 1, unlockType: "start" }, { id: 2, unlockType: "custom", unlockQuestId: 1 }, { id: 3, unlockQuestId: 1 }];
    const gate = { revealed: { 1: true }, approved: { 1: "op_a" } };
    expect(gateRecoveryActions([{ id: 2, gatePending: "x" }, { id: 3, gatePending: "y" }], sc2, gate)).toEqual([]);
  });
  it("承認の記録が無ければ何もしない（PL が書いた gatePending や solved は根拠にしない）", () => {
    const gate = { revealed: { 1: true }, approved: {} };
    expect(gateRecoveryActions([{ id: 1, solved: true }, { id: 2, gatePending: "op_a" }], sc, gate)).toEqual([]);
    expect(gateRecoveryActions([{ id: 2, gatePending: "op_a" }], sc, null)).toEqual([]);
  });
  it("秘匿シナリオに無いクエスト・旧版の true の確認待ちも扱える", () => {
    const gate = { revealed: { 1: true, 2: true }, approved: { 1: true } };
    expect(gateRecoveryActions([{ id: 99, gatePending: "x" }, { id: 2, gatePending: true }], sc, gate))
      .toEqual([{ id: 2, opId: true, action: "clear", value: true }]);
  });
});

describe("recoverRevealTx（回復で登場済みの記録を作るトランザクション）", () => {
  it("サーバーの値で親の承認が同じ操作のままなら、子の記録をその操作の値で作る", () => {
    const gate = { revealed: { 1: true }, approved: { 1: "op_a" }, createdAt: 1 };
    expect(recoverRevealTx(gate, 2, 1, "op_a")).toEqual({ revealed: { 1: true, 2: "op_a" }, approved: { 1: "op_a" }, createdAt: 1 });
  });
  it("親の承認が取り消されていれば（別の GM クライアントのアンドゥ）中止し、記録を復活させない", () => {
    expect(recoverRevealTx({ revealed: { 1: true }, approved: {} }, 2, 1, "op_a")).toBeUndefined();
    expect(recoverRevealTx({ revealed: { 1: true } }, 2, 1, "op_a")).toBeUndefined();
    expect(recoverRevealTx(null, 2, 1, "op_a")).toBeUndefined();
  });
  it("親が別の操作で承認し直されていれば、古い操作の値では作らない", () => {
    expect(recoverRevealTx({ revealed: { 1: true }, approved: { 1: "op_b" } }, 2, 1, "op_a")).toBeUndefined();
  });
  it("既に記録があれば変えずにそのまま返す", () => {
    const gate = { revealed: { 1: true, 2: "op_x" }, approved: { 1: "op_a" } };
    expect(recoverRevealTx(gate, 2, 1, "op_a")).toBe(gate);
  });
});

describe("undoGateTx（承認の取り消しで公開記録を外すトランザクション）", () => {
  it("その操作の承認と、子の登場済みの記録（回復が同じ承認を根拠に作ったものを含む）を一度に外す", () => {
    const gate = { revealed: { 1: true, 2: "op_a", 3: "op_b" }, approved: { 1: "op_a", 4: "op_b" }, createdAt: 1 };
    expect(undoGateTx(gate, "op_a")).toEqual({ revealed: { 1: true, 3: "op_b" }, approved: { 4: "op_b" }, createdAt: 1 });
  });
  it("回復が子の記録を先に作っていても、親と一緒に外れて子だけが残らない", () => {
    // 1) 回復が子の記録を作る → 2) 取り消しは親子をまとめて外す → 3) 回復を再実行しても親の承認が無いので作らない
    const after = recoverRevealTx({ revealed: { 1: true }, approved: { 1: "op_a" } }, 2, 1, "op_a");
    const undone = undoGateTx(after, "op_a");
    expect(undone.revealed[2]).toBeUndefined();
    expect(undone.approved[1]).toBeUndefined();
    expect(recoverRevealTx(undone, 2, 1, "op_a")).toBeUndefined();
  });
  it("外すものが無ければ中止する", () => {
    expect(undoGateTx({ revealed: { 1: true }, approved: { 1: "op_b" } }, "op_a")).toBeUndefined();
    expect(undoGateTx(null, "op_a")).toBeUndefined();
  });
});
