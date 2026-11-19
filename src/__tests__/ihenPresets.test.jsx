import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

// Firebase は保存先（users/{uid}/ihenPresets）をメモリ上で模擬する
const store = {};
vi.mock("../firebase", () => ({ db: {}, auth: {} }));
vi.mock("firebase/database", () => ({
  ref: (_db, path) => path,
  get: vi.fn(async (path) => {
    const parts = path.split("/").filter(Boolean);
    let v = store;
    for (const k of parts) v = v?.[k];
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

import { CustomRulesEditor } from "../session/customPanel";
import {
  getCustom, upsertDef, applyPreset, unapplyPreset, presetFromGs, normalizePreset, appliedPresets,
  giveItem, setStat, getStatValue, pcCustom, presetSummary, lookupTable, PRESET_SEP,
} from "../customRules";
import { IHEN_PRESETS, getIhenPreset } from "../data/ihenPresets";
import { OFFICIAL_DS_NAMES } from "../gmBattle";

beforeEach(() => { Object.keys(store).forEach(k => delete store[k]); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const gs0 = () => ({
  log: [], day: 1, cycleIdx: 0, limit: "3日目の夜", actedPcs: [],
  pcs: [{ uid: "a", charName: "霊夢" }, { uid: "b", charName: "魔理沙" }, { uid: "c", charName: "咲夜" }],
});

describe("プリセットの適用・解除", () => {
  it("永夜異変: ノルマの初期値はPC人数、時刻とリミットも設定", () => {
    const p = applyPreset(gs0(), getIhenPreset("eiya"), "eiya", { pcCount: 3, withClock: true });
    const c = getCustom(p);
    const norma = c.stats.find(s => s.name === "刻符ノルマ");
    expect(norma.id).toBe(`eiya${PRESET_SEP}norma`);
    expect(getStatValue(p, norma)).toBe(3);
    expect(p).toMatchObject({ day: 1, cycleIdx: 3, limit: "1日目の夜" });
    expect(p.log[0]).toBe("📜 GM: 異変再現「永夜異変」を適用した");
    expect(appliedPresets(p)).toEqual([{ key: "eiya", name: "永夜異変" }]);
  });

  it("時刻を設定しない指定なら時刻は変わらない", () => {
    const p = applyPreset(gs0(), getIhenPreset("eiya"), "eiya", { pcCount: 3, withClock: false });
    expect(p).toMatchObject({ day: 1, cycleIdx: 0, limit: "3日目の夜" });
  });

  it("再適用しても値は保持され、定義は重複しない", () => {
    let p = applyPreset(gs0(), getIhenPreset("shunsetsu"), "shunsetsu");
    const haru = getCustom(p).stats[0];
    p = setStat(p, haru.id, 4, "a");
    p = applyPreset(p, getIhenPreset("shunsetsu"), "shunsetsu");
    expect(getCustom(p).stats).toHaveLength(1);
    expect(getStatValue(p, haru, "a")).toBe(4);
    expect(appliedPresets(p)).toHaveLength(1);
  });

  it("複数のプリセットを同時に使え、解除はそのプリセット分だけ消える", () => {
    let p = upsertDef(gs0(), "stats", { id: "mine", name: "自前", scope: "pc" });
    p = applyPreset(p, getIhenPreset("takarabune"), "takarabune");
    p = applyPreset(p, getIhenPreset("geppei"), "geppei");
    const red = getCustom(p).items.find(i => i.name === "ベントラー赤");
    expect(red.cat).toBe(`takarabune${PRESET_SEP}ventra`); // 分類の参照も付け替わる
    p = giveItem(p, "a", red.id, "i1");
    p = unapplyPreset(p, "takarabune");
    const c = getCustom(p);
    expect(c.items.some(i => i.name === "ベントラー赤")).toBe(false);
    expect(c.items.filter(i => i.cat === `geppei${PRESET_SEP}ability`)).toHaveLength(21);
    expect(c.stats.map(s => s.id)).toEqual(["mine"]);
    expect(pcCustom(p.pcs[0]).items).toEqual([]); // 所持分も消える
    expect(appliedPresets(p).map(a => a.key)).toEqual(["geppei"]);
  });
});

describe("書き出しと読み戻し", () => {
  it("適用済みの定義を書き出すと元の id に戻り、別のキーで再適用できる", () => {
    let p = applyPreset(gs0(), getIhenPreset("takarabune"), "takarabune");
    const out = presetFromGs(p, " 自作 ", "説明");
    expect(out.name).toBe("自作");
    expect(out.defs.items.find(i => i.name === "ベントラー青")).toMatchObject({ id: "blue", cat: "ventra" });
    // Firebase 経由で空配列が消え、配列がオブジェクトになっても読める
    const viaFirebase = normalizePreset(JSON.parse(JSON.stringify({ ...out, defs: { ...out.defs, states: undefined, items: { ...out.defs.items } } })));
    const q = applyPreset(gs0(), viaFirebase, "uX");
    expect(getCustom(q).items.find(i => i.name === "ベントラー青")).toMatchObject({ id: `uX${PRESET_SEP}blue`, cat: `uX${PRESET_SEP}ventra` });
  });

  it("要約表示", () => {
    expect(presetSummary(getIhenPreset("eiya"))).toBe("ステータス2・ルール1・メモ2");
  });
});

describe("組み込みデータの整合性", () => {
  it("どのプリセットも適用でき、ルール文を持つ", () => {
    IHEN_PRESETS.forEach(pr => {
      const p = applyPreset(gs0(), pr, pr.key, { pcCount: 2, withClock: true });
      expect(getCustom(p).rules.length).toBeGreaterThan(0);
    });
  });

  it("表の結果はすべて同じプリセットのアイテム名と一致する", () => {
    IHEN_PRESETS.forEach(pr => {
      const names = new Set((pr.defs.items || []).map(i => i.name));
      (pr.defs.tables || []).forEach(t => t.rows.forEach(r => expect(names.has(r.text)).toBe(true)));
    });
  });

  it("アビリティカード表は D66 の21通りを過不足なく覆う", () => {
    const t = getIhenPreset("geppei").defs.tables[0];
    const d66 = [];
    for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) d66.push(a * 10 + b);
    expect(d66).toHaveLength(21);
    d66.forEach(v => expect(lookupTable(t, v)).not.toBeNull());
  });

  it("【装備】カードの弾幕スキルは公式の弾幕スキル名", () => {
    getIhenPreset("geppei").defs.items.forEach(i => {
      const m = i.desc.match(/《(.+?)》/);
      if (i.desc.startsWith("【装備】")) expect(OFFICIAL_DS_NAMES).toContain(m?.[1]);
    });
  });
});

describe("独自タブのプリセット欄", () => {
  function harness(initial, user = { uid: "gm" }) {
    let gs = initial;
    const upd = (fn) => { gs = fn(gs); view.rerender(<CustomRulesEditor gs={gs} upd={upd} user={user} />); };
    const view = render(<CustomRulesEditor gs={gs} upd={upd} user={user} />);
    return { get gs() { return gs; } };
  }

  it("公式プリセットを適用→解除", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const h = harness(gs0());
    await waitFor(() => expect(screen.queryByText("読み込み中…")).not.toBeInTheDocument());
    const row = screen.getByText("春雪異変").parentElement;
    fireEvent.click(row.querySelector("button"));
    expect(appliedPresets(h.gs)).toEqual([{ key: "shunsetsu", name: "春雪異変" }]);
    fireEvent.click(screen.getByText("解除"));
    expect(appliedPresets(h.gs)).toEqual([]);
    expect(getCustom(h.gs).stats).toEqual([]);
  });

  it("現在の定義を保存すると一覧に出て、適用・削除できる", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const start = upsertDef(gs0(), "stats", { id: "st1", name: "侵食度", scope: "global", min: 0, init: 0 });
    harness(start);
    await waitFor(() => expect(screen.queryByText("読み込み中…")).not.toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/プリセット名/), { target: { value: "自作異変" } });
    fireEvent.click(screen.getByText("保存する"));
    await waitFor(() => expect(screen.getByText("自作異変")).toBeInTheDocument());
    const saved = Object.values(store.users.gm.ihenPresets)[0];
    expect(saved.defs.stats[0]).toMatchObject({ id: "st1", name: "侵食度" });
    fireEvent.click(screen.getByText("削除"));
    await waitFor(() => expect(screen.queryByText("自作異変")).not.toBeInTheDocument());
    expect(store.users.gm.ihenPresets).toEqual({});
  });
});
