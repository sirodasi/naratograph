import { describe, it, expect, afterEach } from 'vitest';

import {
  getBlockedSpots,
  resolveBaseSpot,
  getPreBattleFlavorRoll,
  getScenarioHooks,
  SCENARIO_HOOKS,
} from '../scenarios';

// フック登録簿はモジュール共有なので、各テスト後に必ず掃除する
afterEach(() => {
  for (const k of Object.keys(SCENARIO_HOOKS)) delete SCENARIO_HOOKS[k];
});

describe('getBlockedSpots（探索不可スポット）', () => {
  it('scenarioData が無ければ空配列', () => {
    expect(getBlockedSpots(null, {})).toEqual([]);
    expect(getBlockedSpots(undefined, {})).toEqual([]);
  });

  it('blockedSpots が無ければ空配列', () => {
    expect(getBlockedSpots({ id: 's1' }, {})).toEqual([]);
  });

  it('データの blockedSpots をそのまま返す', () => {
    expect(getBlockedSpots({ blockedSpots: ['41', '42'] }, {})).toEqual(['41', '42']);
  });

  it('フックが返すスポットをデータと統合し重複排除する', () => {
    SCENARIO_HOOKS['s1'] = { blockedSpots: () => ['42', '43'] };
    const result = getBlockedSpots({ id: 's1', blockedSpots: ['41', '42'] }, {});
    expect(result).toEqual(['41', '42', '43']);
  });

  it('フックが空/未定義を返してもデータ分は保持する', () => {
    SCENARIO_HOOKS['s1'] = { blockedSpots: () => null };
    expect(getBlockedSpots({ id: 's1', blockedSpots: ['41'] }, {})).toEqual(['41']);
  });

  it('フックには gs が渡る', () => {
    let received = null;
    SCENARIO_HOOKS['s1'] = { blockedSpots: (gs) => { received = gs; return []; } };
    const gs = { day: 3 };
    getBlockedSpots({ id: 's1' }, gs);
    expect(received).toBe(gs);
  });
});

describe('resolveBaseSpot（拠点リダイレクト）', () => {
  it('scenarioData が無ければ素のIDを返す', () => {
    expect(resolveBaseSpot(null, '41')).toBe('41');
    expect(resolveBaseSpot(undefined, '41')).toBe('41');
  });

  it('spotRebind に該当が無ければ素のIDを返す', () => {
    expect(resolveBaseSpot({ spotRebind: { '99': '11' } }, '41')).toBe('41');
  });

  it('spotRebind に該当があれば代替IDを返す（紅魔館→霧の湖）', () => {
    expect(resolveBaseSpot({ spotRebind: { '41': '42' } }, '41')).toBe('42');
  });

  it('フック resolveBaseSpot がデータ解決後にさらに適用される', () => {
    SCENARIO_HOOKS['s1'] = { resolveBaseSpot: (id) => (id === '42' ? '11' : id) };
    // データで 41→42、フックで 42→11
    expect(resolveBaseSpot({ id: 's1', spotRebind: { '41': '42' } }, '41')).toBe('11');
  });

  it('フックが null を返したらデータ解決値を維持する', () => {
    SCENARIO_HOOKS['s1'] = { resolveBaseSpot: () => null };
    expect(resolveBaseSpot({ id: 's1', spotRebind: { '41': '42' } }, '41')).toBe('42');
  });
});

describe('getPreBattleFlavorRoll（演出判定）', () => {
  it('未設定なら null', () => {
    expect(getPreBattleFlavorRoll({})).toBeNull();
    expect(getPreBattleFlavorRoll({ preBattleFlavorRoll: false })).toBeNull();
    expect(getPreBattleFlavorRoll(null)).toBeNull();
  });

  it('true なら既定の目標値6', () => {
    expect(getPreBattleFlavorRoll({ preBattleFlavorRoll: true })).toEqual({ target: 6 });
  });

  it('オブジェクトなら target を上書き', () => {
    expect(getPreBattleFlavorRoll({ preBattleFlavorRoll: { target: 4 } })).toEqual({ target: 4 });
  });

  it('target 未指定のオブジェクトは6にフォールバック', () => {
    expect(getPreBattleFlavorRoll({ preBattleFlavorRoll: {} })).toEqual({ target: 6 });
  });
});

describe('getScenarioHooks（登録簿）', () => {
  it('未登録/未指定なら空オブジェクト', () => {
    expect(getScenarioHooks(null)).toEqual({});
    expect(getScenarioHooks({ id: 'unknown' })).toEqual({});
  });

  it('登録済みIDのフックを返す', () => {
    const hooks = { blockedSpots: () => [] };
    SCENARIO_HOOKS['s1'] = hooks;
    expect(getScenarioHooks({ id: 's1' })).toBe(hooks);
  });
});
