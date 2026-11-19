import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

// Firebase は保存先（users/{uid}/ihenPresets）をメモリ上で模擬する
const store = {};
vi.mock("../firebase", () => ({ db: {}, auth: {} }));
vi.mock("firebase/database", () => ({
  ref: (_db, path) => path,
  get: vi.fn(async (path) => {
    let v = store;
    for (const k of path.split("/").filter(Boolean)) v = v?.[k];
    return { val: () => (v === undefined ? null : JSON.parse(JSON.stringify(v))) };
  }),
  set: vi.fn(async (path, value) => {
    const parts = path.split("/").filter(Boolean);
    let o = store;
    parts.slice(0, -1).forEach(k => { o[k] = o[k] || {}; o = o[k]; });
    o[parts.at(-1)] = JSON.parse(JSON.stringify(value));
  }),
  remove: vi.fn(async (path) => {
    const parts = path.split("/").filter(Boolean);
    let o = store;
    parts.slice(0, -1).forEach(k => { o = o?.[k]; });
    if (o) delete o[parts.at(-1)];
  }),
}));

import {
  presetToFile, parsePresetFile, sanitizePreset, presetFileName, safeDefId, applyPreset, getCustom,
  PRESET_FILE_FORMAT, DEF_KINDS, normalizePreset,
} from "../customRules";
import { IHEN_PRESETS, getIhenPreset } from "../data/ihenPresets";
import { IhenPresetManager } from "../session/presetManager";
import { CustomRulesEditor } from "../session/customPanel";

beforeEach(() => { Object.keys(store).forEach(k => delete store[k]); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const savedPresets = () => Object.entries(store.users?.gm?.ihenPresets || {});
const fileOf = (obj) => new File([typeof obj === "string" ? obj : JSON.stringify(obj)], "p.json", { type: "application/json" });

describe("JSON の書き出しと読み込み", () => {
  it("公式プリセットは書き出し→読み込みで定義が欠けない", () => {
    IHEN_PRESETS.forEach(pr => {
      const file = presetToFile(pr);
      expect(file).toMatchObject({ format: PRESET_FILE_FORMAT, version: 1, name: pr.name });
      expect(file.key).toBeUndefined();
      const { preset, error } = parsePresetFile(JSON.stringify(file));
      expect(error).toBeUndefined();
      const orig = normalizePreset(pr);
      DEF_KINDS.forEach(k => expect(preset.defs[k].map(d => d.id)).toEqual(orig.defs[k].map(d => d.id)));
      expect(preset.clock).toEqual(pr.clock);
      expect(preset).toEqual(sanitizePreset(preset)); // 冪等
    });
  });

  it("壊れたファイル・別の形式・新しい版・空は読み込まない", () => {
    expect(parsePresetFile("{oops").error).toMatch(/JSON/);
    expect(parsePresetFile("[1,2]").error).toBeTruthy();
    expect(parsePresetFile(JSON.stringify({ format: "other", defs: {} })).error).toMatch(/ファイルではありません/);
    expect(parsePresetFile(JSON.stringify({ name: "x" })).error).toBeTruthy();
    expect(parsePresetFile(JSON.stringify({ format: PRESET_FILE_FORMAT, version: 99, defs: { rules: [{ id: "a", title: "t" }] } })).error).toMatch(/新しい版/);
    expect(parsePresetFile(JSON.stringify({ format: PRESET_FILE_FORMAT, version: 1, defs: { stats: [{ id: "a" }] } })).error).toMatch(/定義がありません/);
  });

  it("中身は信用せず、既知の項目だけを安全な形に整える", () => {
    const { preset } = parsePresetFile(JSON.stringify({
      format: PRESET_FILE_FORMAT, version: 1, name: "  自作  ", evil: "x",
      defs: {
        stats: [{ id: "a.b", name: "侵食", scope: "???", min: "0", max: "x", init: "2", hack: 1 },
                { id: "a.b", name: "重複", scope: "global", initFromPcCount: true }],
        cats: [{ id: "k", name: "札", cap: 3 }],
        items: [{ id: "x__y", name: "札1", cat: "k" }, { id: "i2", name: "札2", cat: "nope" }, { name: "" }],
        tokens: [{ id: "t", name: "コマ", color: "red;background:url(x)" }],
        reminders: [{ id: "r1", timing: "cycle_start", text: "置く", finalOnly: true }, { id: "r2", timing: "whenever", text: "?" }],
        unknownKind: [{ id: "z" }],
      },
      clock: { day: 20, cycleIdx: -3, limitDay: "2", limitCycleIdx: 9 },
    }));
    expect(preset.name).toBe("自作");
    expect(preset.evil).toBeUndefined();
    expect(preset.defs.unknownKind).toBeUndefined();
    expect(preset.defs.stats).toEqual([
      { id: "a_b", name: "侵食", scope: "pc", min: 0, max: null, init: 2 },
      { id: "a_b_2", name: "重複", scope: "global", min: null, max: null, init: 0, initFromPcCount: true },
    ]);
    expect(preset.defs.items.map(i => [i.id, i.cat])).toEqual([["y", "k"], ["i2", null]]);
    expect(preset.defs.tokens[0].color).toBe("#e8a0b8");
    expect(preset.defs.reminders).toEqual([{ id: "r1", timing: "cycle_start", text: "置く", finalOnly: false }]);
    expect(preset.clock).toEqual({ day: 9, cycleIdx: 0, limitDay: 2, limitCycleIdx: 3 });
    // 読み込んだものもそのまま適用できる
    const p = applyPreset({ log: [], pcs: [] }, preset, "uX", { pcCount: 4 });
    expect(getCustom(p).global["uX__a_b_2"]).toBe(4);
  });

  it("id とファイル名の整形", () => {
    expect(safeDefId("pre__a.b/c")).toBe("a_b_c");
    expect(safeDefId("")).toBe("");
    expect(presetFileName({ name: "春 雪/異変" })).toBe("異変再現_春_雪_異変.json");
  });
});

describe("プロフィールの「異変再現」タブ", () => {
  const user = { uid: "gm" };
  const ready = () => waitFor(() => expect(screen.queryByText("読み込み中…")).not.toBeInTheDocument());

  it("新規作成して保存し、一覧から編集・削除できる", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<IhenPresetManager user={user} />);
    await ready();
    fireEvent.click(screen.getByText("＋ 新規作成"));
    // 運用の操作（PCに渡す・表を振る・コマの配置）は出さない
    expect(screen.queryByText("PCに渡す")).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/自作異変/), { target: { value: "自作異変" } });
    fireEvent.click(screen.getByText(/独自ステータス/));
    fireEvent.change(screen.getByPlaceholderText("名前（例: 春度）"), { target: { value: "侵食度" } });
    fireEvent.change(screen.getByDisplayValue("PC個別"), { target: { value: "global" } });
    fireEvent.click(screen.getByText(/初期値をPCの人数にする/));
    fireEvent.click(screen.getAllByText("追加").find(el => el.tagName === "BUTTON"));
    expect(screen.getByText(/初期PC人数/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("開始時刻"));
    fireEvent.click(screen.getByText("保存する"));
    await waitFor(() => expect(savedPresets()).toHaveLength(1));
    const [id, sp] = savedPresets()[0];
    expect(sp).toMatchObject({ name: "自作異変", clock: { day: 1, cycleIdx: 0 } });
    expect(sp.defs.stats[0]).toMatchObject({ name: "侵食度", scope: "global", initFromPcCount: true });
    const created = sp.createdAt;

    // 編集（同じ id に上書き、作成日時は保持）
    fireEvent.click(screen.getByText("← 一覧に戻る"));
    await waitFor(() => expect(screen.getByText("自作異変")).toBeInTheDocument());
    fireEvent.click(screen.getByText("編集"));
    fireEvent.change(screen.getByDisplayValue("自作異変"), { target: { value: "自作異変・改" } });
    fireEvent.click(screen.getByText("保存する"));
    await waitFor(() => expect(savedPresets()[0][1].name).toBe("自作異変・改"));
    expect(savedPresets()).toHaveLength(1);
    expect(savedPresets()[0][0]).toBe(id);
    expect(savedPresets()[0][1].createdAt).toBe(created);

    fireEvent.click(screen.getByText("← 一覧に戻る"));
    await waitFor(() => expect(screen.getByText("自作異変・改")).toBeInTheDocument());
    fireEvent.click(screen.getByText("削除"));
    await waitFor(() => expect(savedPresets()).toHaveLength(0));
  });

  it("公式を複製して自作の土台にできる", async () => {
    render(<IhenPresetManager user={user} />);
    await ready();
    const card = screen.getByText("宝船を追って").closest("div").parentElement;
    fireEvent.click(card.querySelector("button"));
    expect(screen.getByDisplayValue("宝船を追って（コピー）")).toBeInTheDocument();
    fireEvent.click(screen.getByText("保存する"));
    await waitFor(() => expect(savedPresets()).toHaveLength(1));
    const sp = savedPresets()[0][1];
    const orig = normalizePreset(getIhenPreset("takarabune"));
    expect(sp.defs.items.map(i => i.name)).toEqual(orig.defs.items.map(i => i.name));
    expect(sp.defs.reminders).toHaveLength(orig.defs.reminders.length);
  });

  it("JSON を読み込むと編集画面で確認してから保存する", async () => {
    render(<IhenPresetManager user={user} />);
    await ready();
    fireEvent.change(screen.getByTestId("preset-file"), { target: { files: [fileOf(presetToFile(getIhenPreset("eiya")))] } });
    await waitFor(() => expect(screen.getByDisplayValue("永夜異変")).toBeInTheDocument());
    expect(savedPresets()).toHaveLength(0);
    fireEvent.click(screen.getByText("保存する"));
    await waitFor(() => expect(savedPresets()).toHaveLength(1));
    expect(savedPresets()[0][1].clock).toEqual(getIhenPreset("eiya").clock);
  });

  it("壊れた JSON は知らせて何もしない", async () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<IhenPresetManager user={user} />);
    await ready();
    fireEvent.change(screen.getByTestId("preset-file"), { target: { files: [fileOf("{not json")] } });
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(alert.mock.calls[0][0]).toMatch(/読み込めませんでした/);
    expect(screen.getByText("＋ 新規作成")).toBeInTheDocument();
  });

  it("JSON ボタンでファイルとして書き出す", async () => {
    const blobs = [];
    URL.createObjectURL = vi.fn((b) => { blobs.push(b); return "blob:x"; });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<IhenPresetManager user={user} />);
    await ready();
    const card = screen.getByText("春雪異変").closest("div").parentElement;
    fireEvent.click([...card.querySelectorAll("button")].find(b => b.textContent === "JSON"));
    expect(click).toHaveBeenCalled();
    const parsed = parsePresetFile(await blobs[0].text());
    expect(parsed.preset.name).toBe("春雪異変");
  });
});

describe("セッション中の「独自」タブからの読み込み", () => {
  it("JSON を読み込んで自作プリセットとして保存し、一覧に出る", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const gs = { log: [], pcs: [] };
    render(<CustomRulesEditor gs={gs} upd={() => {}} user={{ uid: "gm" }} />);
    await waitFor(() => expect(screen.queryByText("読み込み中…")).not.toBeInTheDocument());
    const mine = { format: PRESET_FILE_FORMAT, version: 1, name: "友人の異変", defs: { rules: [{ id: "r", title: "侵食", text: "…" }] } };
    fireEvent.change(screen.getByTestId("preset-file"), { target: { files: [fileOf(mine)] } });
    await waitFor(() => expect(screen.getByText("友人の異変")).toBeInTheDocument());
    expect(savedPresets()[0][1].defs.rules[0]).toMatchObject({ id: "r", title: "侵食" });
  });
});
