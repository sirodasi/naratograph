import { describe, it, expect } from "vitest";
import { hashAssetId, dehydrateScene, hydrateScene } from "../sceneAssets";

const DATA = "data:image/webp;base64,AAAA";
const DATA2 = "data:image/jpeg;base64,BBBBBB";

describe("hashAssetId", () => {
  it("同じ data URL は同じ id（決定的）", () => {
    expect(hashAssetId(DATA)).toBe(hashAssetId(DATA));
  });
  it("異なる data URL は異なる id", () => {
    expect(hashAssetId(DATA)).not.toBe(hashAssetId(DATA2));
  });
});

describe("dehydrateScene", () => {
  it("画像 data URL を id に置換し、新規アセットを抽出する", () => {
    const scene = { bg: DATA, portraits: [{ img: DATA2, name: "霊夢", x: 50, y: 90 }], fx: { tone: "夜" } };
    const { scene: out, newAssets } = dehydrateScene(scene, {});
    expect(out.bg).toBe(hashAssetId(DATA));
    expect(out.portraits[0].img).toBe(hashAssetId(DATA2));
    expect(out.portraits[0].name).toBe("霊夢");      // 非画像フィールドは保持
    expect(out.portraits[0].x).toBe(50);
    expect(out.fx).toEqual({ tone: "夜" });
    expect(newAssets).toEqual({ [hashAssetId(DATA)]: DATA, [hashAssetId(DATA2)]: DATA2 });
  });

  it("known に既存の id は newAssets に含めない（再送しない）", () => {
    const scene = { bg: DATA, portraits: [] };
    const known = { [hashAssetId(DATA)]: DATA };
    const { newAssets } = dehydrateScene(scene, known);
    expect(newAssets).toEqual({});
  });

  it("同一画像が複数箇所でも1アセット（重複排除）", () => {
    const scene = { bg: DATA, portraits: [{ img: DATA }, { img: DATA }] };
    const { newAssets } = dehydrateScene(scene, {});
    expect(Object.keys(newAssets)).toHaveLength(1);
  });

  it("faces[] の画像も id 化する", () => {
    const scene = { bg: null, portraits: [{ img: DATA, faces: [DATA, DATA2] }] };
    const { scene: out } = dehydrateScene(scene, {});
    expect(out.portraits[0].faces).toEqual([hashAssetId(DATA), hashAssetId(DATA2)]);
  });

  it("data URL でない値（id・空・null）はそのまま", () => {
    const scene = { bg: "alreadyId", portraits: [{ img: "" }] };
    const { scene: out, newAssets } = dehydrateScene(scene, {});
    expect(out.bg).toBe("alreadyId");
    expect(out.portraits[0].img).toBe("");
    expect(newAssets).toEqual({});
  });
});

describe("hydrateScene", () => {
  it("id を実 URL に解決する", () => {
    const id = hashAssetId(DATA);
    const raw = { bg: id, portraits: [{ img: id, name: "魔理沙" }], fx: {} };
    const out = hydrateScene(raw, { [id]: DATA });
    expect(out.bg).toBe(DATA);
    expect(out.portraits[0].img).toBe(DATA);
    expect(out.portraits[0].name).toBe("魔理沙");
  });

  it("assets に無い id はそのまま（レガシー inline data URL を許容）", () => {
    const raw = { bg: DATA, portraits: [{ img: DATA2 }] };
    const out = hydrateScene(raw, {});
    expect(out.bg).toBe(DATA);
    expect(out.portraits[0].img).toBe(DATA2);
  });

  it("faces[] も解決する", () => {
    const id1 = hashAssetId(DATA), id2 = hashAssetId(DATA2);
    const raw = { bg: null, portraits: [{ img: id1, faces: [id1, id2] }] };
    const out = hydrateScene(raw, { [id1]: DATA, [id2]: DATA2 });
    expect(out.portraits[0].faces).toEqual([DATA, DATA2]);
  });
});

describe("round-trip", () => {
  it("dehydrate → 全アセットを assets として hydrate すると元に戻る", () => {
    const scene = {
      bg: DATA,
      portraits: [
        { img: DATA, name: "A", x: 10, y: 20, h: 80, faces: [DATA, DATA2] },
        { img: DATA2, name: "B", hidden: true },
      ],
      fx: { particles: "桜", tone: "夕焼け" },
    };
    const { scene: raw, newAssets } = dehydrateScene(scene, {});
    const back = hydrateScene(raw, newAssets);
    expect(back).toEqual(scene);
  });
});
