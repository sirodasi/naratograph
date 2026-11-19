import { describe, it, expect } from "vitest";
import {
  getCustom, upsertDef, removeDef, getStatValue, setStat, adjustStat, giveItem, removeItem,
  toggleItemUsed, transferItem, overCap, parseTableRows, rowsToText, tableValue, lookupTable,
  logTableRoll, itemByName, placeTokens, removeToken, clearTokens, tokenCandidates, toggleState,
  setClock, repeatCycle, setLimit, parseLimit, postRule, pcCustom, hasCustomContent,
} from "../customRules";

const base = () => ({
  day: 1, cycleIdx: 2, limit: "3日目の夜", log: [], actedPcs: ["a"], currentScene: { pcUid: "a" },
  pcs: [{ uid: "a", charName: "霊夢", currentSpot: "11" }, { uid: "b", charName: "魔理沙", currentSpot: "11" }],
});

const withDefs = () => {
  let p = base();
  p = upsertDef(p, "stats", { id: "haru", name: "春度", scope: "pc", min: 0, max: 5, init: 0 });
  p = upsertDef(p, "stats", { id: "koku", name: "刻符", scope: "global", min: 0, init: 0 });
  p = upsertDef(p, "stats", { id: "score", name: "撮影スコア", scope: "battle", min: 0, init: 0 });
  p = upsertDef(p, "cats", { id: "ben", name: "ベントラー", cap: 3 });
  p = upsertDef(p, "items", { id: "red", name: "ベントラー赤", desc: "", cat: "ben" });
  p = upsertDef(p, "items", { id: "blue", name: "ベントラー青", desc: "", cat: "ben" });
  p = upsertDef(p, "tokens", { id: "kake", name: "春のかけら", color: "#f8a", unique: true });
  p = upsertDef(p, "states", { id: "shinra", name: "森羅結界", desc: "霊撃が使える" });
  return p;
};

describe("定義", () => {
  it("Firebase の疎配列（オブジェクト）でも配列として読める", () => {
    const c = getCustom({ custom: { stats: { 0: { id: "x" } }, tables: [{ id: "t", rows: { 0: { min: 1, max: 1, text: "a" } } }] } });
    expect(c.stats).toEqual([{ id: "x" }]);
    expect(c.tables[0].rows).toHaveLength(1);
    expect(c.items).toEqual([]);
  });

  it("追加・更新ができ、定義があれば hasCustomContent", () => {
    let p = upsertDef(base(), "stats", { id: "s", name: "A", scope: "pc" });
    p = upsertDef(p, "stats", { id: "s", name: "B" });
    expect(getCustom(p).stats).toEqual([{ id: "s", name: "B", scope: "pc" }]);
    expect(hasCustomContent(p)).toBe(true);
    expect(hasCustomContent(base())).toBe(false);
  });

  it("削除すると参照している値・所持品・コマ・状態も片付く", () => {
    let p = withDefs();
    p = setStat(p, "haru", 3, "a");
    p = giveItem(p, "a", "red", "i1");
    p = placeTokens(p, "kake", ["11"], ["t1"]);
    p = toggleState(p, "a", "shinra");
    p = removeDef(p, "stats", "haru");
    p = removeDef(p, "items", "red");
    p = removeDef(p, "tokens", "kake");
    p = removeDef(p, "states", "shinra");
    const a = pcCustom(p.pcs[0]);
    expect(a.vals).toEqual({});
    expect(a.items).toEqual([]);
    expect(a.states).toEqual([]);
    expect(getCustom(p).mapTokens).toEqual([]);
  });

  it("分類を消すとアイテムは分類なしになる", () => {
    const p = removeDef(withDefs(), "cats", "ben");
    expect(getCustom(p).items.every(it => it.cat === null)).toBe(true);
  });
});

describe("独自ステータス", () => {
  it("PC個別：初期値・最大値で丸め・ログ", () => {
    let p = withDefs();
    const def = getCustom(p).stats[0];
    expect(getStatValue(p, def, "a")).toBe(0);
    p = adjustStat(p, "haru", 9, "a");
    expect(getStatValue(p, def, "a")).toBe(5);
    expect(getStatValue(p, def, "b")).toBe(0);
    expect(p.log[0]).toContain("霊夢 の【春度】0 → 5");
    const same = adjustStat(p, "haru", 1, "a");
    expect(same).toBe(p); // 上限で変化なし
  });

  it("全体共有：上限なし", () => {
    let p = adjustStat(withDefs(), "koku", 12);
    expect(p.custom.global.koku).toBe(12);
    p = adjustStat(p, "koku", -20);
    expect(p.custom.global.koku).toBe(0);
  });

  it("戦闘中のみ：戦闘外では変更できず、戦闘中は battle に保存", () => {
    const p = withDefs();
    expect(adjustStat(p, "score", 1)).toBe(p);
    const q = adjustStat({ ...p, battle: { active: true } }, "score", 2);
    expect(q.battle.customVals.score).toBe(2);
  });

  it("PC個別は uid が無いと何もしない", () => {
    const p = withDefs();
    expect(setStat(p, "haru", 2)).toBe(p);
  });
});

describe("独自アイテム", () => {
  it("付与・使用済切替・使用で失う", () => {
    let p = giveItem(withDefs(), "a", "red", "i1");
    expect(pcCustom(p.pcs[0]).items).toEqual([{ iid: "i1", def: "red" }]);
    p = toggleItemUsed(p, "a", "i1");
    expect(pcCustom(p.pcs[0]).items[0].used).toBe(true);
    p = removeItem(p, "a", "i1", "use");
    expect(pcCustom(p.pcs[0]).items).toEqual([]);
    expect(p.log[0]).toContain("【ベントラー赤】を使用した");
  });

  it("分類の上限を超えると警告ログ（付与はする）", () => {
    let p = withDefs();
    ["i1", "i2", "i3"].forEach(i => { p = giveItem(p, "a", "red", i); });
    expect(overCap(p, "a", "ben")).toBeNull();
    p = giveItem(p, "a", "blue", "i4");
    expect(pcCustom(p.pcs[0]).items).toHaveLength(4);
    expect(p.log[0]).toContain("上限3を超過");
  });

  it("受け渡し", () => {
    let p = giveItem(withDefs(), "a", "red", "i1");
    p = transferItem(p, "a", "b", "i1");
    expect(pcCustom(p.pcs[0]).items).toEqual([]);
    expect(pcCustom(p.pcs[1]).items).toEqual([{ iid: "i1", def: "red" }]);
    expect(p.log[0]).toContain("魔理沙 に渡した");
  });

  it("存在しない定義・PC には付与しない", () => {
    const p = withDefs();
    expect(giveItem(p, "a", "nope", "i1")).toBe(p);
    expect(giveItem(p, "zz", "red", "i1")).toBe(p);
  });
});

describe("カスタム表", () => {
  it("行テキストを解釈する（範囲・単独・コロン区切り）", () => {
    const rows = parseTableRows("1-2 赤\n3〜4：青\n5-6 緑\nでたらめ\n11 不死鳥の尾");
    expect(rows).toEqual([
      { min: 1, max: 2, text: "赤" }, { min: 3, max: 4, text: "青" }, { min: 5, max: 6, text: "緑" }, { min: 11, max: 11, text: "不死鳥の尾" },
    ]);
    expect(rowsToText(rows.slice(0, 1).concat(rows[3]))).toBe("1-2 赤\n11 不死鳥の尾");
  });

  it("出目 → 値 → 行", () => {
    expect(tableValue("d66", [5, 2])).toBe(25);
    expect(tableValue("2d6", [5, 2])).toBe(7);
    expect(tableValue("d6", [4])).toBe(4);
    expect(lookupTable({ rows: parseTableRows("1-2 赤\n3-4 青") }, 3).text).toBe("青");
    expect(lookupTable({ rows: [] }, 3)).toBeNull();
  });

  it("振った結果をログに残す・結果名から独自アイテムを引く", () => {
    let p = upsertDef(withDefs(), "tables", { id: "t", name: "ベントラー決定表", dice: "d6", rows: parseTableRows("1-2 ベントラー赤\n3-4 ベントラー青\n5-6 緑") });
    p = logTableRoll(p, "t", [[1], [6]]);
    expect(p.log[0]).toBe("🎲 表「ベントラー決定表」(D6): 1→ベントラー赤 / 6→緑");
    expect(itemByName(p, "ベントラー赤").id).toBe("red");
    expect(itemByName(p, "緑")).toBeNull();
  });
});

describe("マップの独自コマ", () => {
  it("同じスポットに1つまで（unique）", () => {
    let p = placeTokens(withDefs(), "kake", ["11", "11", "12"], ["t1", "t2", "t3"]);
    expect(getCustom(p).mapTokens.map(t => t.spot)).toEqual(["11", "12"]);
    expect(placeTokens(p, "kake", ["11"], ["t4"])).toBe(p);
  });

  it("ランダム配置の候補は置かれたスポットと夢の世界を除く", () => {
    const p = placeTokens(withDefs(), "kake", ["11"], ["t1"]);
    const c = tokenCandidates(p, "kake", [{ id: "11" }, { id: "12" }, { id: "dream" }]);
    expect(c.map(s => s.id)).toEqual(["12"]);
  });

  it("取り除く・全て取り除く", () => {
    let p = placeTokens(withDefs(), "kake", ["11", "12"], ["t1", "t2"]);
    p = removeToken(p, "t1", id => `S${id}`);
    expect(p.log[0]).toContain("S11 の【春のかけら】を取り除いた");
    p = clearTokens(p, "kake");
    expect(getCustom(p).mapTokens).toEqual([]);
  });
});

describe("独自の状態", () => {
  it("付与と解除", () => {
    let p = toggleState(withDefs(), "a", "shinra");
    expect(pcCustom(p.pcs[0]).states).toEqual(["shinra"]);
    expect(p.log[0]).toContain("《森羅結界》になった");
    p = toggleState(p, "a", "shinra");
    expect(pcCustom(p.pcs[0]).states).toEqual([]);
  });
});

describe("時間操作", () => {
  it("時刻を変えると行動済み・シーンがリセット、日付が変われば新聞もリセット", () => {
    const p = setClock({ ...base(), newspaper: { roll: 11 } }, 2, 3);
    expect(p).toMatchObject({ day: 2, cycleIdx: 3, actedPcs: [], currentScene: null, newspaper: null });
    expect(p.log[0]).toContain("1日目・夕 → 2日目・夜");
    expect(setClock(p, 2, 3)).toBe(p);
  });

  it("サイクルをもう一度（時刻は進めない）", () => {
    const p = repeatCycle(base());
    expect(p).toMatchObject({ day: 1, cycleIdx: 2, actedPcs: [], currentScene: null });
  });

  it("リミットの変更と解釈", () => {
    const p = setLimit(base(), 1, 3);
    expect(p.limit).toBe("1日目の夜");
    expect(parseLimit(p.limit)).toEqual({ day: 1, cycleIdx: 3 });
    expect(parseLimit(undefined)).toEqual({ day: 3, cycleIdx: 3 });
  });
});

describe("ルールの掲示", () => {
  it("新規掲示はログに残し、更新ではログを増やさない", () => {
    let p = postRule(base(), { id: "r", title: "春雪異変", text: "春度..." });
    expect(p.log).toHaveLength(1);
    p = postRule(p, { id: "r", title: "春雪異変", text: "改訂" });
    expect(p.log).toHaveLength(1);
    expect(getCustom(p).rules[0].text).toBe("改訂");
    expect(postRule(p, { id: "x", title: " " })).toBe(p);
  });
});
