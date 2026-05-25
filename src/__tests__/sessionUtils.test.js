import { vi, describe, it, expect } from 'vitest';

// firebase.js を空オブジェクトに差し替えて、import 連鎖でも実接続が走らないようにする
vi.mock('../firebase', () => ({ db: {}, auth: {}, googleProvider: {} }));

import {
  getSpotByD66,
  hasOfficialSkill,
  parseSpell,
  buildSpellCard,
  ITEM_DATA,
  INIT_RESOURCES,
  INIT_ITEMS,
  ITEM_NAMES,
} from '../SessionView';
import { SPOTS } from '../data/gameData';

describe('getSpotByD66 (D66ロール→スポットID)', () => {
  it('ゾロ目で単独スポットを返す (1,1 → "11" 人間の里)', () => {
    expect(getSpotByD66(1, 1, SPOTS)).toBe('11');
  });

  it('ゾロ目で単独スポットを返す (6,6 → "66" 博麗神社)', () => {
    expect(getSpotByD66(6, 6, SPOTS)).toBe('66');
  });

  it('2変種ある目で d1 < d2 → Aを返す (1,4 → "14A")', () => {
    expect(getSpotByD66(1, 4, SPOTS)).toBe('14A');
  });

  it('2変種ある目で d1 > d2 → Bを返す (4,1 → "14B")', () => {
    expect(getSpotByD66(4, 1, SPOTS)).toBe('14B');
  });

  it('対応スポットがない組み合わせは null を返す', () => {
    expect(getSpotByD66(9, 9, SPOTS)).toBeNull();
  });
});

describe('hasOfficialSkill (公式弾幕スキル判定)', () => {
  it('null/undefined エンティティでは false', () => {
    expect(hasOfficialSkill(null, 'ホーミング')).toBe(false);
    expect(hasOfficialSkill(undefined, 'ホーミング')).toBe(false);
  });

  it('ds.name が指定スキルと一致しかつ公式なら true', () => {
    expect(hasOfficialSkill({ ds: { name: 'ホーミング' } }, 'ホーミング')).toBe(true);
  });

  it('スキル名が一致しなければ false', () => {
    expect(hasOfficialSkill({ ds: { name: 'ホーミング' } }, 'ワイドショット')).toBe(false);
  });

  it('公式リストにないスキル名は false', () => {
    expect(hasOfficialSkill({ ds: { name: '架空スキル' } }, '架空スキル')).toBe(false);
  });

  it('レガシー dsName フィールドも参照する', () => {
    expect(hasOfficialSkill({ dsName: 'ホーミング' }, 'ホーミング')).toBe(true);
  });

  it('スキル名のないエンティティは false', () => {
    expect(hasOfficialSkill({ name: '無名敵' }, 'ホーミング')).toBe(false);
  });
});

describe('parseSpell (スペルカードテキスト解析)', () => {
  it('タイミング指定なしは standard', () => {
    const r = parseSpell('テストスペル。');
    expect(r.timing).toBe('standard');
  });

  it('「ラウンド開始時」を round_start として検出', () => {
    const r = parseSpell('ラウンド開始時に使用できる。');
    expect(r.timing).toBe('round_start');
  });

  it('「回避ステップ」を evade として検出', () => {
    const r = parseSpell('回避ステップで使用できる。');
    expect(r.timing).toBe('evade');
  });

  it('「被弾」を hit として検出', () => {
    const r = parseSpell('被弾したときに使用できる。');
    expect(r.timing).toBe('hit');
  });

  it('【自機マス×2】を SELF として解析', () => {
    const r = parseSpell('効果【自機マス×2】');
    expect(r.effects).toContainEqual({ type: 'SELF', count: 2 });
  });

  it('【指定マス×2】を CHOOSE として解析', () => {
    const r = parseSpell('霊符「夢想封印」【指定マス×2】');
    expect(r.effects).toContainEqual({ type: 'CHOOSE', count: 2 });
  });

  it('【隣接マス×1】を ADJACENT として解析', () => {
    const r = parseSpell('夢符「二重結界」【隣接マス×1】');
    expect(r.effects).toContainEqual({ type: 'ADJACENT', count: 1 });
  });

  it('【ランダム×X】の X は count=-1 として解析', () => {
    const r = parseSpell('魔符「スターダストレヴァリエ」【ランダム×X】');
    expect(r.effects).toContainEqual({ type: 'RANDOM', count: -1 });
  });

  it('【4番マス×2】を FIXED として cell/count を解析', () => {
    const r = parseSpell('効果【4番マス×2】');
    expect(r.effects).toContainEqual({ type: 'FIXED', cell: 4, count: 2 });
  });

  it('効果パターンなしは manual=true', () => {
    const r = parseSpell('GMが任意に効果を裁定する。');
    expect(r.manual).toBe(true);
    expect(r.effects).toHaveLength(0);
  });

  it('「ラウンド終了時」効果は effectTiming=round_end', () => {
    const r = parseSpell('ラウンド終了時に効果が発揮される。');
    expect(r.effectTiming).toBe('round_end');
  });
});

describe('buildSpellCard (スペルカード組み立て)', () => {
  it('null/undefined はそのまま null を返す', () => {
    expect(buildSpellCard(null)).toBeNull();
    expect(buildSpellCard(undefined)).toBeNull();
  });

  it('文字列入力から「」までを名前として抽出', () => {
    const card = buildSpellCard('霊符「夢想封印」【指定マス×2】');
    expect(card).not.toBeNull();
    expect(card.name).toBe('霊符「夢想封印」');
  });

  it('オブジェクト入力では name が明示指定されていれば優先', () => {
    const card = buildSpellCard({ name: '明示名', text: '霊符「別名」【自機マス×1】' });
    expect(card.name).toBe('明示名');
  });
});

describe('INIT_RESOURCES / INIT_ITEMS / ITEM_NAMES', () => {
  it('INIT_RESOURCES は呼び出すたびに別オブジェクトを返す', () => {
    const a = INIT_RESOURCES();
    const b = INIT_RESOURCES();
    expect(a).not.toBe(b);
    a.やる気.cur = 99;
    expect(b.やる気.cur).not.toBe(99);
  });

  it('INIT_RESOURCES のリソースが正しい初期値', () => {
    const r = INIT_RESOURCES();
    expect(r.やる気).toEqual({ cur: 1, max: 3 });
    expect(r.残り人数.max).toBe(5);
    expect(r.スペルカード.max).toBe(5);
  });

  it('INIT_ITEMS は ITEM_NAMES の全アイテムを 0 で持つ', () => {
    const items = INIT_ITEMS();
    for (const name of ITEM_NAMES) {
      expect(items[name]).toBe(0);
    }
  });
});

describe('ITEM_DATA - お酒', () => {
  const makePC = (overrides = {}) => ({
    items: { 'お酒': 1 },
    badStatus: [],
    resources: { 'やる気': { cur: 1, max: 3 } },
    currentSpot: '12',
    ...overrides,
  });

  it('canUse: お酒所持＆二日酔いなしで true', () => {
    expect(ITEM_DATA['お酒'].canUse(makePC())).toBe(true);
  });

  it('canUse: 二日酔いがあると false', () => {
    expect(ITEM_DATA['お酒'].canUse(makePC({ badStatus: ['二日酔い'] }))).toBe(false);
  });

  it('canUse: お酒未所持で false', () => {
    expect(ITEM_DATA['お酒'].canUse(makePC({ items: { 'お酒': 0 } }))).toBe(false);
  });

  it('use: やる気を1上昇させ、お酒を1消費', () => {
    const result = ITEM_DATA['お酒'].use(makePC(), {});
    expect(result.resources['やる気'].cur).toBe(2);
    expect(result.items['お酒']).toBe(0);
  });

  it('use: やる気は max を超えない', () => {
    const pc = makePC({ resources: { 'やる気': { cur: 3, max: 3 } } });
    const result = ITEM_DATA['お酒'].use(pc, {});
    expect(result.resources['やる気'].cur).toBe(3);
  });

  it('use: 「だるい」状態ではやる気が回復しない（だが消費はされる）', () => {
    const pc = makePC({ badStatus: ['だるい'] });
    const result = ITEM_DATA['お酒'].use(pc, {});
    expect(result.resources['やる気'].cur).toBe(1);
    expect(result.items['お酒']).toBe(0);
  });

  it('use: プレミアムフライデー (新聞12, 人間の里) で 2点回復', () => {
    const pc = makePC({ currentSpot: '11' });
    const gs = { newspaper: { roll: 12 } };
    const result = ITEM_DATA['お酒'].use(pc, gs);
    expect(result.resources['やる気'].cur).toBe(3);
  });
});

describe('ITEM_DATA - 残機のかけら', () => {
  const makePC = (count) => ({
    items: { '残機のかけら': count },
    badStatus: [],
    resources: { '残り人数': { cur: 2, max: 5 } },
  });

  it('canUse: 2個以下では false', () => {
    expect(ITEM_DATA['残機のかけら'].canUse(makePC(2))).toBe(false);
  });

  it('canUse: ちょうど3個では true', () => {
    expect(ITEM_DATA['残機のかけら'].canUse(makePC(3))).toBe(true);
  });

  it('use: 3つ消費して残り人数を1点獲得', () => {
    const result = ITEM_DATA['残機のかけら'].use(makePC(4), {});
    expect(result.items['残機のかけら']).toBe(1);
    expect(result.resources['残り人数'].cur).toBe(3);
  });

  it('use: 残り人数は max を超えない', () => {
    const pc = makePC(4);
    pc.resources['残り人数'] = { cur: 5, max: 5 };
    const result = ITEM_DATA['残機のかけら'].use(pc, {});
    expect(result.resources['残り人数'].cur).toBe(5);
  });
});

describe('ITEM_DATA - Pアイテム', () => {
  const makePC = () => ({
    items: { 'Pアイテム': 2 },
    badStatus: [],
    resources: { '霊力': { cur: 0, max: 20 } },
  });

  it('use: 霊力を3点獲得し、アイテムを1消費', () => {
    const result = ITEM_DATA['Pアイテム'].use(makePC(), {});
    expect(result.resources['霊力'].cur).toBe(3);
    expect(result.items['Pアイテム']).toBe(1);
  });

  it('use: スランプ状態では霊力が回復しない（消費はされる）', () => {
    const pc = makePC();
    pc.badStatus = ['スランプ'];
    const result = ITEM_DATA['Pアイテム'].use(pc, {});
    expect(result.resources['霊力'].cur).toBe(0);
    expect(result.items['Pアイテム']).toBe(1);
  });
});
