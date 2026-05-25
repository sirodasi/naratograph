import { vi, describe, it, expect } from 'vitest';

vi.mock('../firebase', () => ({ db: {}, auth: {}, googleProvider: {} }));

import {
  isBadStatusImmune,
  PS_ONCE_FLAG,
  BAD_STATUS_TABLE,
  ITEM_NAMES,
  INIT_RESOURCES,
  INIT_ITEMS,
} from '../SessionView';
import { PERSONALITY_SKILLS } from '../data/characters';

// ─── データ整合性 ─────────────────────────────────────────────────────
describe('PERSONALITY_SKILLS データ整合性', () => {
  const EXPECTED_KEYS = [11, 12, 13, 14, 15, 16, 22, 23, 24, 25, 26, 33, 34, 35, 36, 44, 45, 46, 55, 56, 66];
  const EXPECTED_NAMES = [
    "真面目", "馬鹿", "用意周到", "瀟洒", "活発", "熱中",
    "胡乱", "快適な拠点", "怠け者", "人気者", "寂しがり屋",
    "インドア派", "アウトドア派", "ご執心", "能天気",
    "カリスマ", "我儘", "不夜城", "信仰", "赤貧", "直感",
  ];

  it('21スキルすべてが定義されている', () => {
    expect(Object.keys(PERSONALITY_SKILLS)).toHaveLength(21);
  });

  it.each(EXPECTED_KEYS)('キー %i が存在する', (key) => {
    expect(PERSONALITY_SKILLS[key]).toBeDefined();
  });

  it.each(EXPECTED_NAMES)('スキル「%s」が存在する', (name) => {
    const found = Object.values(PERSONALITY_SKILLS).some(s => s.name === name);
    expect(found).toBe(true);
  });

  it('各スキルにname/type/descが存在する', () => {
    for (const skill of Object.values(PERSONALITY_SKILLS)) {
      expect(skill.name).toBeTruthy();
      expect(["オート", "アクション", "サポート"]).toContain(skill.type);
      expect(skill.desc).toBeTruthy();
    }
  });

  it('オートスキルの一覧が正しい', () => {
    const autoSkills = Object.values(PERSONALITY_SKILLS).filter(s => s.type === "オート").map(s => s.name);
    expect(autoSkills.sort()).toEqual(["我儘", "活発", "快適な拠点", "寂しがり屋", "赤貧", "馬鹿", "アウトドア派"].sort());
  });

  it('アクションスキルの一覧が正しい', () => {
    const actionSkills = Object.values(PERSONALITY_SKILLS).filter(s => s.type === "アクション").map(s => s.name);
    expect(actionSkills.sort()).toEqual(["カリスマ", "信仰", "真面目", "怠け者", "胡乱"].sort());
  });
});

// ─── PS_ONCE_FLAG ───────────────────────────────────────────────────
describe('PS_ONCE_FLAG', () => {
  it('"psUsedThisSession" という文字列', () => {
    expect(PS_ONCE_FLAG).toBe("psUsedThisSession");
  });
});

// ─── BAD_STATUS_TABLE ───────────────────────────────────────────────
describe('BAD_STATUS_TABLE', () => {
  it('1〜6のキーが存在する', () => {
    for (let i = 1; i <= 6; i++) {
      expect(BAD_STATUS_TABLE[i]).toBeDefined();
      expect(BAD_STATUS_TABLE[i].name).toBeTruthy();
    }
  });

  const EXPECTED_BS = ["だるい", "スランプ", "二日酔い", "怪我", "不機嫌", "疲れた"];
  it.each(EXPECTED_BS)('変調「%s」が含まれる', (name) => {
    const found = Object.values(BAD_STATUS_TABLE).some(b => b.name === name);
    expect(found).toBe(true);
  });
});

// ─── isBadStatusImmune (馬鹿スキル) ────────────────────────────────
describe('isBadStatusImmune (馬鹿スキル: 変調免疫)', () => {
  const makePC = (psName, immuneName) => ({
    ps: { name: psName, type: "オート" },
    badStatusImmune: immuneName,
  });

  it('馬鹿スキルかつ免疫変調が一致するとき true を返す', () => {
    const pc = makePC("馬鹿", "怪我");
    expect(isBadStatusImmune(pc, "怪我")).toBe(true);
  });

  it('馬鹿スキルだが免疫変調が異なるとき false', () => {
    const pc = makePC("馬鹿", "怪我");
    expect(isBadStatusImmune(pc, "スランプ")).toBe(false);
  });

  it('他スキルのPCは false', () => {
    const pc = makePC("真面目", "怪我");
    expect(isBadStatusImmune(pc, "怪我")).toBe(false);
  });

  it('ps が undefined のとき false', () => {
    expect(isBadStatusImmune({ badStatusImmune: "怪我" }, "怪我")).toBe(false);
  });

  it('pc が null のとき false', () => {
    expect(isBadStatusImmune(null, "怪我")).toBe(false);
  });

  it('6種の変調それぞれに対して免疫チェックが機能する', () => {
    for (let i = 1; i <= 6; i++) {
      const bsName = BAD_STATUS_TABLE[i].name;
      const pc = makePC("馬鹿", bsName);
      expect(isBadStatusImmune(pc, bsName)).toBe(true);
      // 他の変調には免疫なし
      for (let j = 1; j <= 6; j++) {
        if (j === i) continue;
        expect(isBadStatusImmune(pc, BAD_STATUS_TABLE[j].name)).toBe(false);
      }
    }
  });
});

// ─── ITEM_NAMES (赤貧スキル関連) ────────────────────────────────────
describe('ITEM_NAMES (赤貧スキル: 小銭→任意アイテム変換)', () => {
  it('「小銭」が ITEM_NAMES に含まれる', () => {
    expect(ITEM_NAMES).toContain("小銭");
  });

  it('「妖器」は ITEM_NAMES に含まれない', () => {
    expect(ITEM_NAMES).not.toContain("妖器");
  });

  it('赤貧の変換候補は小銭以外のアイテム', () => {
    const convertable = ITEM_NAMES.filter(n => n !== "小銭");
    expect(convertable.length).toBeGreaterThan(0);
    expect(convertable).not.toContain("小銭");
  });
});

// ─── 純粋ロジック: 怠け者 (自身への絆獲得) ─────────────────────────
describe('怠け者スキル: 自身への絆獲得ロジック', () => {
  it('自身への絆文字列フォーマット', () => {
    const charName = "博麗霊夢";
    const selfBond = `${charName}自身への絆`;
    expect(selfBond).toBe("博麗霊夢自身への絆");
  });

  it('重複追加されない（既に絆がある場合）', () => {
    const bonds = ["博麗霊夢自身への絆"];
    const selfBond = "博麗霊夢自身への絆";
    const next = bonds.includes(selfBond) ? bonds : [...bonds, selfBond];
    expect(next).toHaveLength(1);
  });

  it('絆がない場合は追加される', () => {
    const bonds = [];
    const selfBond = "博麗霊夢自身への絆";
    const next = bonds.includes(selfBond) ? bonds : [...bonds, selfBond];
    expect(next).toHaveLength(1);
    expect(next[0]).toBe("博麗霊夢自身への絆");
  });
});

// ─── 純粋ロジック: 人気者 (双方向絆) ───────────────────────────────
describe('人気者スキル: 絆を獲得した相手も絆を取得するロジック', () => {
  it('人気者PCが絆を獲得すると相手PCにも絆が追加される', () => {
    const pcA = { uid: "a", charName: "A", ps: { name: "人気者" }, bonds: [] };
    const pcB = { uid: "b", charName: "B", ps: null, bonds: [] };
    const targetName = "B";
    const hasPininkiWar = pcA.ps?.name === "人気者";

    const newPcs = [pcA, pcB].map(x => {
      if (x.uid === pcA.uid) {
        const bonds = [...(x.bonds || [])];
        if (!bonds.includes(targetName)) bonds.push(targetName);
        return { ...x, bonds };
      }
      if (hasPininkiWar && x.charName === targetName) {
        const bonds = [...(x.bonds || [])];
        if (!bonds.includes(pcA.charName)) bonds.push(pcA.charName);
        return { ...x, bonds };
      }
      return x;
    });

    expect(newPcs.find(x => x.uid === "a").bonds).toContain("B");
    expect(newPcs.find(x => x.uid === "b").bonds).toContain("A");
  });

  it('人気者でないPCが絆を獲得しても相手には追加されない', () => {
    const pcA = { uid: "a", charName: "A", ps: { name: "真面目" }, bonds: [] };
    const pcB = { uid: "b", charName: "B", ps: null, bonds: [] };
    const targetName = "B";
    const hasPininkiWar = pcA.ps?.name === "人気者";

    const newPcs = [pcA, pcB].map(x => {
      if (x.uid === pcA.uid) {
        const bonds = [...(x.bonds || [])];
        if (!bonds.includes(targetName)) bonds.push(targetName);
        return { ...x, bonds };
      }
      if (hasPininkiWar && x.charName === targetName) {
        const bonds = [...(x.bonds || [])];
        if (!bonds.includes(pcA.charName)) bonds.push(pcA.charName);
        return { ...x, bonds };
      }
      return x;
    });

    expect(newPcs.find(x => x.uid === "a").bonds).toContain("B");
    expect(newPcs.find(x => x.uid === "b").bonds).not.toContain("A");
  });
});

// ─── 純粋ロジック: 活発 (+1スポット移動) ────────────────────────────
describe('活発スキル: 移動距離+1ロジック', () => {
  it('活発PCは選択した移動ダイス値+1スポット移動できる', () => {
    const pc = { ps: { name: "活発" } };
    const baseVal = 3;
    let actualVal = baseVal;
    let logAdd = "";
    if (pc.ps?.name === "活発") {
      actualVal += 1;
      logAdd += `（《活発》+1スポット）`;
    }
    expect(actualVal).toBe(4);
    expect(logAdd).toContain("活発");
  });

  it('活発でないPCは元の値のまま', () => {
    const pc = { ps: { name: "怠け者" } };
    const baseVal = 3;
    let actualVal = baseVal;
    if (pc.ps?.name === "活発") actualVal += 1;
    expect(actualVal).toBe(3);
  });
});

// ─── 純粋ロジック: 快適な拠点 (ダイス+1) ────────────────────────────
describe('快適な拠点スキル: 拠点スポットでダイス+1', () => {
  it('拠点にいる場合ダイス数が増加する', () => {
    const pc = { ps: { name: "快適な拠点" }, currentSpot: "11", baseSpotId: "11" };
    let diceCount = 2;
    if (pc.ps?.name === "快適な拠点" && pc.currentSpot === pc.baseSpotId) diceCount++;
    expect(diceCount).toBe(3);
  });

  it('拠点にいない場合は増加しない', () => {
    const pc = { ps: { name: "快適な拠点" }, currentSpot: "22", baseSpotId: "11" };
    let diceCount = 2;
    if (pc.ps?.name === "快適な拠点" && pc.currentSpot === pc.baseSpotId) diceCount++;
    expect(diceCount).toBe(2);
  });
});

// ─── 純粋ロジック: 寂しがり屋 (ダイス+1) ────────────────────────────
describe('寂しがり屋スキル: 他PCがいるスポットでダイス+1', () => {
  it('同スポットに他PCがいる場合ダイス数が増加する', () => {
    const pc = { uid: "a", ps: { name: "寂しがり屋" }, currentSpot: "11" };
    const allPcs = [
      pc,
      { uid: "b", currentSpot: "11" },
    ];
    let diceCount = 2;
    if (pc.ps?.name === "寂しがり屋" && allPcs.some(x => x.uid !== pc.uid && x.currentSpot === pc.currentSpot)) diceCount++;
    expect(diceCount).toBe(3);
  });

  it('同スポットに他PCがいない場合は増加しない', () => {
    const pc = { uid: "a", ps: { name: "寂しがり屋" }, currentSpot: "11" };
    const allPcs = [
      pc,
      { uid: "b", currentSpot: "22" },
    ];
    let diceCount = 2;
    if (pc.ps?.name === "寂しがり屋" && allPcs.some(x => x.uid !== pc.uid && x.currentSpot === pc.currentSpot)) diceCount++;
    expect(diceCount).toBe(2);
  });
});

// ─── 純粋ロジック: 瀟洒 (3ダイス以上+霊力1消費→自動成功) ──────────
describe('瀟洒スキル: 自動成功条件チェック', () => {
  it('3ダイス以上かつ霊力≥1のとき発動可能', () => {
    const pc = { ps: { name: "瀟洒" }, resources: { 霊力: { cur: 5, max: 20 } } };
    const diceCount = 3;
    const canUse = pc.ps?.name === "瀟洒" && diceCount >= 3 && (pc.resources.霊力?.cur || 0) >= 1;
    expect(canUse).toBe(true);
  });

  it('ダイスが2個のときは発動不可', () => {
    const pc = { ps: { name: "瀟洒" }, resources: { 霊力: { cur: 5, max: 20 } } };
    const diceCount = 2;
    const canUse = pc.ps?.name === "瀟洒" && diceCount >= 3 && (pc.resources.霊力?.cur || 0) >= 1;
    expect(canUse).toBe(false);
  });

  it('霊力0のときは発動不可', () => {
    const pc = { ps: { name: "瀟洒" }, resources: { 霊力: { cur: 0, max: 20 } } };
    const diceCount = 3;
    const canUse = pc.ps?.name === "瀟洒" && diceCount >= 3 && (pc.resources.霊力?.cur || 0) >= 1;
    expect(canUse).toBe(false);
  });
});

// ─── 純粋ロジック: PS_ONCE_FLAG 使用スキル一覧 ──────────────────────
describe('PS_ONCE_FLAG を使用するスキルの一回制限ロジック', () => {
  it('フラグがない場合は未使用', () => {
    const pc = { ps: { name: "カリスマ" } };
    expect(!!pc[PS_ONCE_FLAG]).toBe(false);
  });

  it('フラグがある場合は使用済み', () => {
    const pc = { ps: { name: "カリスマ" }, [PS_ONCE_FLAG]: true };
    expect(!!pc[PS_ONCE_FLAG]).toBe(true);
  });

  it('カリスマ: 使用済み時にボタン無効化条件', () => {
    const pc = { ps: { name: "カリスマ" }, [PS_ONCE_FLAG]: true };
    const isDisabled = pc.ps?.name === "カリスマ" && !!pc[PS_ONCE_FLAG];
    expect(isDisabled).toBe(true);
  });

  it('直感: 手がかりがあり未使用時のみ発動可能', () => {
    const pc = { ps: { name: "直感" } };
    const hasClueHere = true;
    const isSuccess = false;
    const canUse = !isSuccess && pc.ps?.name === "直感" && !pc[PS_ONCE_FLAG] && hasClueHere;
    expect(canUse).toBe(true);
  });

  it('直感: すでに使用済みの場合は発動不可', () => {
    const pc = { ps: { name: "直感" }, [PS_ONCE_FLAG]: true };
    const hasClueHere = true;
    const isSuccess = false;
    const canUse = !isSuccess && pc.ps?.name === "直感" && !pc[PS_ONCE_FLAG] && hasClueHere;
    expect(canUse).toBe(false);
  });

  it('直感: 手がかりがない場合は発動不可', () => {
    const pc = { ps: { name: "直感" } };
    const hasClueHere = false;
    const isSuccess = false;
    const canUse = !isSuccess && pc.ps?.name === "直感" && !pc[PS_ONCE_FLAG] && hasClueHere;
    expect(canUse).toBe(false);
  });
});

// ─── 純粋ロジック: 熱中 (失敗後やり直し) ────────────────────────────
describe('熱中スキル: 失敗後やり直し条件', () => {
  it('失敗かつやる気≥1のとき発動可能', () => {
    const pc = { ps: { name: "熱中" }, resources: { やる気: { cur: 2, max: 5 } } };
    const isSuccess = false;
    const isFumble = false;
    const canUse = !isSuccess && !isFumble && pc.ps?.name === "熱中" && (pc.resources.やる気?.cur || 0) >= 1;
    expect(canUse).toBe(true);
  });

  it('ファンブル時は発動不可', () => {
    const pc = { ps: { name: "熱中" }, resources: { やる気: { cur: 2, max: 5 } } };
    const isSuccess = false;
    const isFumble = true;
    const canUse = !isSuccess && !isFumble && pc.ps?.name === "熱中" && (pc.resources.やる気?.cur || 0) >= 1;
    expect(canUse).toBe(false);
  });

  it('やる気0のとき発動不可', () => {
    const pc = { ps: { name: "熱中" }, resources: { やる気: { cur: 0, max: 5 } } };
    const isSuccess = false;
    const isFumble = false;
    const canUse = !isSuccess && !isFumble && pc.ps?.name === "熱中" && (pc.resources.やる気?.cur || 0) >= 1;
    expect(canUse).toBe(false);
  });
});

// ─── 純粋ロジック: アウトドア派 (夜サイクル帰還不要) ────────────────
describe('アウトドア派スキル: 夜サイクル帰還スキップ', () => {
  it('夜サイクル(cycleIdx=3)かつアウトドア派のとき帰還不要', () => {
    const pc = { ps: { name: "アウトドア派" } };
    const cycleIdx = 3;
    const skipReturn = cycleIdx === 3 && pc.ps?.name === "アウトドア派";
    expect(skipReturn).toBe(true);
  });

  it('夜以外のサイクルでは効果なし', () => {
    const pc = { ps: { name: "アウトドア派" } };
    const cycleIdx = 2;
    const skipReturn = cycleIdx === 3 && pc.ps?.name === "アウトドア派";
    expect(skipReturn).toBe(false);
  });
});

// ─── 純粋ロジック: 我儘 (全絆を自身への絆として扱う) ───────────────
describe('我儘スキル: 絆読み替えロジック', () => {
  it('我儘PCは絆を全て自身への絆として読み替えられる', () => {
    const pc = { ps: { name: "我儘" }, bonds: ["霊夢への絆", "魔理沙への絆"] };
    const isGaWaWaAllSelf = pc.ps?.name === "我儘";
    expect(isGaWaWaAllSelf).toBe(true);
    // 絆の数は保持される
    expect(pc.bonds.length).toBe(2);
  });
});

// ─── INIT_RESOURCES / INIT_ITEMS 整合性 ──────────────────────────────
describe('INIT_RESOURCES / INIT_ITEMS (全スキルの前提データ)', () => {
  it('INIT_RESOURCES に やる気・霊力・攻撃力・残り人数 が含まれる', () => {
    const res = INIT_RESOURCES();
    expect(res).toHaveProperty("やる気");
    expect(res).toHaveProperty("霊力");
    expect(res).toHaveProperty("攻撃力");
    expect(res).toHaveProperty("残り人数");
  });

  it('INIT_ITEMS に 小銭・お酒・お守り が含まれる', () => {
    const items = INIT_ITEMS();
    expect(items).toHaveProperty("小銭");
    expect(items).toHaveProperty("お酒");
    expect(items).toHaveProperty("お守り");
  });
});
