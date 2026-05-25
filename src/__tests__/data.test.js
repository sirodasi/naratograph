import { describe, it, expect } from 'vitest';
import { CHARACTERS } from '../data/characters';
import { SPOTS, EDGES, OFFICIAL_DANMAKU_SKILLS, AREA_COLORS, CYCLES, CYCLE_COLORS } from '../data/gameData';

describe('CHARACTERS データ整合性', () => {
  it('キャラクターIDに重複がない', () => {
    const ids = CHARACTERS.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('すべてのキャラクターに必須フィールドが揃っている', () => {
    for (const ch of CHARACTERS) {
      expect(ch.id, `${ch.id ?? '(no id)'} が id を欠いている`).toBeTruthy();
      expect(ch.name, `${ch.id} が name を欠いている`).toBeTruthy();
      expect(ch.ds, `${ch.id} が ds を欠いている`).toBeDefined();
      expect(ch.ds.name, `${ch.id} の ds.name が空`).toBeTruthy();
      expect(ch.as, `${ch.id} が as を欠いている`).toBeDefined();
      expect(ch.as.type, `${ch.id} の as.type が空`).toBeTruthy();
      expect(ch.spellCards, `${ch.id} の spellCards が配列ではない`).toBeInstanceOf(Array);
    }
  });

  it('全キャラクターが1枚以上のスペルカードを持つ', () => {
    for (const ch of CHARACTERS) {
      expect(ch.spellCards.length, `${ch.id} のスペルカードが0枚`).toBeGreaterThan(0);
    }
  });

  it('全キャラクターの spriteRow / spriteCol が数値', () => {
    for (const ch of CHARACTERS) {
      expect(typeof ch.spriteRow, `${ch.id} の spriteRow`).toBe('number');
      expect(typeof ch.spriteCol, `${ch.id} の spriteCol`).toBe('number');
    }
  });

  it('as.type は「アクション」「サポート」「オート」のいずれか', () => {
    const validTypes = ['アクション', 'サポート', 'オート'];
    for (const ch of CHARACTERS) {
      expect(validTypes, `${ch.id} の as.type=${ch.as.type}`).toContain(ch.as.type);
    }
  });
});

describe('SPOTS データ整合性', () => {
  it('スポットIDに重複がない', () => {
    const ids = SPOTS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('すべてのスポットに必須フィールドが揃っている', () => {
    for (const spot of SPOTS) {
      expect(spot.id, '(no id) のスポット').toBeTruthy();
      expect(spot.name, `${spot.id} が name を欠いている`).toBeTruthy();
      expect(typeof spot.x, `${spot.id} の x`).toBe('number');
      expect(typeof spot.y, `${spot.id} の y`).toBe('number');
      expect(spot.area, `${spot.id} が area を欠いている`).toBeTruthy();
    }
  });

  it('座標は 0〜100 の範囲内', () => {
    for (const spot of SPOTS) {
      expect(spot.x).toBeGreaterThanOrEqual(0);
      expect(spot.x).toBeLessThanOrEqual(100);
      expect(spot.y).toBeGreaterThanOrEqual(0);
      expect(spot.y).toBeLessThanOrEqual(100);
    }
  });

  it('各スポットの area は AREA_COLORS に登録されている', () => {
    for (const spot of SPOTS) {
      expect(AREA_COLORS, `${spot.id} の area=${spot.area}`).toHaveProperty(spot.area);
    }
  });
});

describe('EDGES データ整合性', () => {
  it('すべてのエッジが有効なスポットIDを参照', () => {
    const spotIds = new Set(SPOTS.map(s => s.id));
    for (const [a, b] of EDGES) {
      expect(spotIds.has(a), `無効なスポット参照: ${a}`).toBe(true);
      expect(spotIds.has(b), `無効なスポット参照: ${b}`).toBe(true);
    }
  });

  it('自己ループするエッジが存在しない', () => {
    for (const [a, b] of EDGES) {
      expect(a, `自己ループエッジ: ${a}`).not.toBe(b);
    }
  });

  it('同一エッジが重複定義されていない', () => {
    const keys = EDGES.map(([a, b]) => [a, b].sort().join('-'));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('CYCLES / OFFICIAL_DANMAKU_SKILLS', () => {
  it('CYCLES は 4 要素 (朝/昼/夕/夜)', () => {
    expect(CYCLES).toHaveLength(4);
    expect(CYCLE_COLORS).toHaveLength(4);
  });

  it('公式弾幕スキル名に重複がない', () => {
    const names = OFFICIAL_DANMAKU_SKILLS.map(s => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('全公式弾幕スキルに name と desc がある', () => {
    for (const skill of OFFICIAL_DANMAKU_SKILLS) {
      expect(skill.name).toBeTruthy();
      expect(skill.desc).toBeTruthy();
    }
  });
});
