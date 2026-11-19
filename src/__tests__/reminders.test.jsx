import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
vi.mock("../firebase", () => ({ db: {}, auth: {} }));
vi.mock("../audio", () => ({ sfx: new Proxy({}, { get: () => () => {} }) }));
import {
  timingSnapshot, detectTimings, remindersFor, upsertDef, applyPreset, getCustom, REMINDER_TIMINGS,
  presetFromGs, pcCustom,
} from "../customRules";
import { addRequest, respondDice, giveTableItem, getRequests, describeDice, tableResult } from "../gmTools";
import { GmReminderOverlay } from "../session/reminders";
import { GmRequestOverlay, GmToolsPanel } from "../session/gmPanel";
import { IHEN_PRESETS, getIhenPreset } from "../data/ihenPresets";

afterEach(cleanup);

const pcs = [{ uid: "a", charName: "霊夢", currentSpot: "s1" }, { uid: "b", charName: "魔理沙", currentSpot: "s1" }];
const ex = (over = {}) => ({ sessionPhase: "explore", day: 1, cycleIdx: 0, actedPcs: [], currentScene: null, pcs, log: [], ...over });
const keys = (prev, cur) => detectTimings(timingSnapshot(prev), timingSnapshot(cur)).map(e => e.key);
const bt = (over = {}) => ({ active: true, type: "normal", questId: "q1", phase: "setup", round: 1, ...over });

describe("タイミングの検出", () => {
  it("導入から探索へ入ると 日の開始・サイクル開始", () => {
    expect(keys(ex({ sessionPhase: "intro_main" }), ex())).toEqual(["day_start", "cycle_start"]);
  });

  it("シーンの開始と終了", () => {
    expect(keys(ex(), ex({ currentScene: { pcUid: "a" } }))).toEqual(["scene_start"]);
    expect(keys(ex({ currentScene: { pcUid: "a" } }), ex({ actedPcs: ["a"] }))).toEqual(["scene_end"]);
  });

  it("全員が行動済みになるとサイクル終了、次のサイクルで開始（終了は重ねて出さない）", () => {
    const last = ex({ actedPcs: ["a"], currentScene: { pcUid: "b" } });
    const done = ex({ actedPcs: ["a", "b"] });
    expect(keys(last, done)).toEqual(["scene_end", "cycle_end"]);
    expect(keys(done, ex({ cycleIdx: 1 }))).toEqual(["cycle_start"]);
    expect(keys(ex({ cycleIdx: 3, actedPcs: ["a", "b"] }), ex({ day: 2, cycleIdx: 0 }))).toEqual(["day_start", "cycle_start"]);
  });

  it("全員の行動を待たずに時刻を進めたらサイクル終了も出す", () => {
    expect(keys(ex({ actedPcs: ["a"] }), ex({ cycleIdx: 1 }))).toEqual(["cycle_end", "cycle_start"]);
  });

  it("同じサイクルの繰り返し（行動済みが全員→0）もサイクル開始として扱う", () => {
    expect(keys(ex({ actedPcs: ["a", "b"] }), ex())).toEqual(["cycle_start"]);
    // 1人を未行動に戻しただけでは出さない
    expect(keys(ex({ actedPcs: ["a", "b"] }), ex({ actedPcs: ["a"] }))).toEqual([]);
  });

  it("弾幕ごっこ: 開始・ラウンド開始・ラウンド終了・終了。シーンの退避は数えない", () => {
    const scene = ex({ currentScene: { pcUid: "a" } });
    const setup = ex({ currentScene: { pcUid: "a" }, battle: bt() });
    expect(keys(scene, { ...setup, currentScene: null })).toEqual(["battle_start"]);
    const r1 = ex({ battle: bt({ phase: "round_start" }) });
    expect(keys(setup, r1)).toEqual(["round_start"]);
    const shot = ex({ battle: bt({ phase: "pc_shot_intro" }) });
    const endChk = ex({ battle: bt({ phase: "round_end_check" }) });
    expect(keys(shot, endChk)).toEqual(["round_end"]);
    // 終了確認 → 次ラウンド（終了は重ねない）
    expect(keys(endChk, ex({ battle: bt({ phase: "round_start", round: 2 }) }))).toEqual(["round_start"]);
    // 終了処理を通らずにラウンドが進んだ場合も終了を出す
    expect(keys(shot, ex({ battle: bt({ phase: "round_start", round: 2 }) }))).toEqual(["round_end", "round_start"]);
    // 終了（シーンが戻っても scene_start は出さない）
    expect(keys(shot, ex({ battle: { active: false }, currentScene: { pcUid: "a" } }))).toEqual(["battle_end"]);
  });

  it("決戦かどうかを渡し、決戦のみのメモを絞り込む", () => {
    let gs = ex();
    gs = upsertDef(gs, "reminders", { id: "r1", timing: "round_end", text: "ベントラー", finalOnly: true });
    gs = upsertDef(gs, "reminders", { id: "r2", timing: "round_end", text: "いつでも" });
    const fin = { type: "mass", isFinal: true, phase: "pc_shot_intro" };
    const ev = detectTimings(timingSnapshot(ex({ battle: bt(fin) })), timingSnapshot(ex({ battle: bt({ ...fin, phase: "cleanup" }) })));
    expect(ev).toEqual([{ key: "round_end", final: true }]);
    expect(remindersFor(gs, ev)[0].items.map(r => r.id)).toEqual(["r1", "r2"]);
    expect(remindersFor(gs, [{ key: "round_end", final: false }])[0].items.map(r => r.id)).toEqual(["r2"]);
    expect(remindersFor(gs, [{ key: "cycle_start" }])).toEqual([]);
  });
});

describe("プリセットのメモ", () => {
  it("組み込みのメモはすべて既知のタイミング", () => {
    const known = REMINDER_TIMINGS.map(t => t.key);
    IHEN_PRESETS.forEach(pr => (pr.defs.reminders || []).forEach(r => expect(known).toContain(r.timing)));
  });

  it("適用すると id が付け替わり、書き出しで元に戻る", () => {
    const p = applyPreset(ex(), getIhenPreset("eiya"), "eiya");
    expect(getCustom(p).reminders.map(r => r.id)).toEqual(["eiya__m1", "eiya__m2"]);
    expect(presetFromGs(p, "x").defs.reminders.map(r => r.id)).toEqual(["m1", "m2"]);
  });
});

describe("GM のメモ表示", () => {
  it("タイミングが来たら出て、チェック・閉じるができる。入室直後は出さない", () => {
    let gs = upsertDef(ex(), "reminders", { id: "r1", timing: "cycle_start", text: "かけらを置く" });
    const view = render(<GmReminderOverlay gs={gs} />);
    expect(screen.queryByText("かけらを置く")).not.toBeInTheDocument();
    gs = { ...gs, cycleIdx: 1 };
    view.rerender(<GmReminderOverlay gs={gs} />);
    expect(screen.getByText("⏰ サイクル開始時")).toBeInTheDocument();
    fireEvent.click(screen.getByText("かけらを置く"));
    expect(screen.getByText("☑")).toBeInTheDocument();
    fireEvent.click(screen.getByText("閉じる"));
    expect(screen.queryByText("かけらを置く")).not.toBeInTheDocument();
  });

  it("メモの無いタイミングでは何も出ない", () => {
    const gs = ex();
    const view = render(<GmReminderOverlay gs={gs} />);
    view.rerender(<GmReminderOverlay gs={{ ...gs, cycleIdx: 1 }} />);
    expect(screen.queryByText(/GM のメモ/)).not.toBeInTheDocument();
  });
});

// ─── ダイス要求で独自の表を振らせる ──────────────────────────────
const withTable = () => {
  let p = applyPreset(ex(), getIhenPreset("takarabune"), "tb");
  return p;
};
const tableOf = (p) => getCustom(p).tables[0];

describe("表のダイス要求", () => {
  it("表を写して持ち、振ると結果とアイテムが渡る", () => {
    let p = withTable();
    p = addRequest(p, { kind: "dice", targets: ["a"], table: { ...tableOf(p), give: true } }, "q1", 1);
    const req = getRequests(p)[0];
    expect(req.dice).toEqual({ count: 1, mode: "nd6" });
    expect(req.table.rows).toHaveLength(3);
    expect(p.log[0]).toContain("表「ベントラーアイテム決定表」(D6)");
    p = respondDice(p, "q1", "a", [4], false, "i1");
    const r = getRequests(p)[0].responses.a;
    expect(r).toMatchObject({ confirmed: true, given: true });
    expect(describeDice(getRequests(p)[0], r)).toBe("4 → ベントラー青");
    expect(pcCustom(p.pcs[0]).items).toEqual([{ iid: "i1", def: "tb__blue" }]);
    // 二重に渡さない
    expect(giveTableItem(p, "q1", "a", "i2")).toBe(p);
  });

  it("自動で渡さない指定なら、GM が後から1回だけ渡せる", () => {
    let p = withTable();
    p = addRequest(p, { kind: "dice", targets: ["a"], table: tableOf(p) }, "q1", 1);
    p = respondDice(p, "q1", "a", [1], false, "i1");
    expect(pcCustom(p.pcs[0]).items).toEqual([]);
    expect(tableResult(getRequests(p)[0], getRequests(p)[0].responses.a, p).item.name).toBe("ベントラー赤");
    p = giveTableItem(p, "q1", "a", "i2");
    expect(pcCustom(p.pcs[0]).items).toHaveLength(1);
    expect(giveTableItem(p, "q1", "a", "i3")).toBe(p);
  });

  it("D66 の表は D66 で振る", () => {
    let p = applyPreset(ex(), getIhenPreset("geppei"), "gp");
    p = addRequest(p, { kind: "dice", targets: ["a"], table: getCustom(p).tables[0] }, "q1", 1);
    expect(getRequests(p)[0].dice).toEqual({ count: 2, mode: "d66" });
    p = respondDice(p, "q1", "a", [5, 2]);
    expect(p.log[0]).toContain("25（5,2） → 疾風の下駄");
  });

  it("GM 操作タブで表を選んで送れる", () => {
    let gs = withTable();
    const h = (() => {
      let cur = gs;
      const upd = (fn) => { cur = fn(cur); view.rerender(<GmToolsPanel gs={cur} upd={upd} getSpot={() => null} />); };
      const view = render(<GmToolsPanel gs={cur} upd={upd} getSpot={() => null} />);
      return { get gs() { return cur; } };
    })();
    fireEvent.click(screen.getAllByText("霊夢")[0]);
    fireEvent.click(screen.getByText("独自の表"));
    expect(screen.getByText("🎲 ダイスを振らせる")).toBeDisabled();
    fireEvent.change(screen.getByDisplayValue("表を選択..."), { target: { value: "tb__decide" } });
    expect(screen.getByText(/そのまま渡す/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("🎲 ダイスを振らせる"));
    expect(getRequests(h.gs)[0].table).toMatchObject({ id: "tb__decide", give: true });
  });

  it("PL が表を振ると結果カードが手元に残る", () => {
    vi.useFakeTimers();
    let gs = withTable();
    gs = addRequest(gs, { kind: "dice", targets: ["a"], table: { ...tableOf(gs), give: true } }, "q1", 1);
    let cur = gs;
    const upd = (fn) => { cur = fn(cur); view.rerender(<GmRequestOverlay gs={cur} upd={upd} user={{ uid: "a" }} />); };
    const view = render(<GmRequestOverlay gs={cur} upd={upd} user={{ uid: "a" }} />);
    fireEvent.click(screen.getByText("🎲 表を振る"));
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    expect(screen.getByText("結果")).toBeInTheDocument();
    expect(screen.getByText(/を獲得しました/)).toBeInTheDocument();
    expect(pcCustom(cur.pcs[0]).items).toHaveLength(1);
  });
});
