import { vi, describe, it, expect } from 'vitest';

vi.mock('../firebase', () => ({ db: {}, auth: {}, googleProvider: {} }));

import { getDistances, normalizeScenario } from '../App';

describe('getDistances (BFSによる最短距離)', () => {
  it('null/undefined start では空オブジェクト', () => {
    expect(getDistances(null)).toEqual({});
    expect(getDistances(undefined)).toEqual({});
  });

  it('開始スポット自身は距離0', () => {
    const d = getDistances('11');
    expect(d['11']).toBe(0);
  });

  it('「11」(人間の里)に直接接続するスポットは距離1', () => {
    // EDGES より: 11 → 12, 13, 14A, 14B, 15, 16, 66
    const d = getDistances('11');
    expect(d['12']).toBe(1);
    expect(d['13']).toBe(1);
    expect(d['14A']).toBe(1);
    expect(d['14B']).toBe(1);
    expect(d['15']).toBe(1);
    expect(d['16']).toBe(1);
    expect(d['66']).toBe(1);
  });

  it('距離は双方向で一致 (A→Bの距離 == B→Aの距離)', () => {
    const fromA = getDistances('11');
    const fromB = getDistances('22');
    expect(fromA['22']).toBeDefined();
    expect(fromB['11']).toBeDefined();
    expect(fromA['22']).toBe(fromB['11']);
  });

  it('全到達可能スポットの距離は非負整数', () => {
    const d = getDistances('11');
    for (const dist of Object.values(d)) {
      expect(dist).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(dist)).toBe(true);
    }
  });

  it('「夢の世界」はエッジを持たないため未到達 (undefined)', () => {
    const d = getDistances('11');
    expect(d['dream']).toBeUndefined();
  });

  it('「11」(人間の里) → 「33」(紅魔館) は2ホップ以上', () => {
    // 11 → 13 → 35A/35B → ... → 33 (直接接続なし)
    const d = getDistances('11');
    expect(d['33']).toBeGreaterThanOrEqual(2);
  });

  it('BFSの単調性: 隣接スポット間で距離差は1以下', () => {
    const d = getDistances('11');
    // 隣接エッジの両端で距離差をチェック (EDGES の代わりに、両側に距離が割り当たっている各ペアを確認)
    // ここでは具体例で確認: 12 と 25 は直接接続 → 距離差は最大1
    expect(Math.abs(d['12'] - d['25'])).toBeLessThanOrEqual(1);
  });
});

describe('normalizeScenario (シナリオ正規化)', () => {
  it('null/undefined はそのまま返す', () => {
    expect(normalizeScenario(null)).toBeNull();
    expect(normalizeScenario(undefined)).toBeUndefined();
  });

  it('finalBattleEnemies の旧 dsName → ds オブジェクトに変換', () => {
    const scenario = {
      finalBattleEnemies: [{ name: '敵A', dsName: 'ホーミング' }],
      quests: [],
    };
    const result = normalizeScenario(scenario);
    const en = result.finalBattleEnemies[0];
    expect(en.ds).toBeDefined();
    expect(en.ds.name).toBe('ホーミング');
    expect(en.ds.type).toBe('official');
    expect(en.ds.desc).toMatch(/ショットステップ/);
  });

  it('既に ds がある敵はそのまま', () => {
    const original = { name: '敵', ds: { type: 'custom', name: 'カスタム', desc: '説明' } };
    const result = normalizeScenario({
      finalBattleEnemies: [original],
      quests: [],
    });
    expect(result.finalBattleEnemies[0].ds).toEqual(original.ds);
  });

  it('quests[].enemy の旧形式も正規化される', () => {
    const scenario = {
      finalBattleEnemies: [],
      quests: [
        { id: 'q1', name: 'クエ1', enemy: { name: 'ボス', dsName: 'ワイドショット' } },
      ],
    };
    const result = normalizeScenario(scenario);
    const enemy = result.quests[0].enemy;
    expect(enemy.ds.name).toBe('ワイドショット');
    expect(enemy.ds.type).toBe('official');
  });

  it('スキル名なしの敵は ds.type=none', () => {
    const scenario = {
      finalBattleEnemies: [{ name: 'モブ' }],
      quests: [],
    };
    const result = normalizeScenario(scenario);
    expect(result.finalBattleEnemies[0].ds.type).toBe('none');
  });

  it('dsCustomName のみの敵は ds.type=custom', () => {
    const scenario = {
      finalBattleEnemies: [{ name: '独自敵', dsCustomName: '独自技', dsDesc: '独自説明' }],
      quests: [],
    };
    const result = normalizeScenario(scenario);
    const ds = result.finalBattleEnemies[0].ds;
    expect(ds.type).toBe('custom');
    expect(ds.name).toBe('独自技');
    expect(ds.customName).toBe('独自技');
  });

  it('enemy のないクエストは変更されない', () => {
    const scenario = {
      finalBattleEnemies: [],
      quests: [{ id: 'q1', name: '自動解決クエ', solutionType: '自動解決' }],
    };
    const result = normalizeScenario(scenario);
    expect(result.quests[0]).toEqual(scenario.quests[0]);
  });
});
