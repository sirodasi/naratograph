import { vi, describe, it, expect } from 'vitest';

// firebase 接続を回避
vi.mock('../firebase', () => ({ db: {}, auth: {}, googleProvider: {} }));

import { buildBattleNpc, isNpcSideDefeated } from '../SessionView';

describe('buildBattleNpc（シナリオ敵→戦闘NPC変換）', () => {
  const enemy = {
    name: 'ゆっくりれいむ', life: 1, spellcard: 1, attack: 4, evade: 3,
    ds: { name: '使い魔', desc: 'desc' },
    sc1name: 'ふぅグランドダム', sc1effect: '効果', sc1ref: '',
    sc2name: '', sc2effect: '',
  };

  it('基本ステータスを resources にマップする', () => {
    const npc = buildBattleNpc(enemy, 'e1');
    expect(npc.id).toBe('e1');
    expect(npc.name).toBe('ゆっくりれいむ');
    expect(npc.resources.残り人数.cur).toBe(1);
    expect(npc.resources.スペルカード.cur).toBe(1);
    expect(npc.resources.攻撃力.cur).toBe(4);
    expect(npc.resources.回避力.cur).toBe(3);
  });

  it('回避力を反映する（ゆっくりまりさは2）', () => {
    const npc = buildBattleNpc({ ...enemy, name: 'まりさ', evade: 2 }, 'e2');
    expect(npc.resources.回避力.cur).toBe(2);
  });

  it('回避力未指定なら3にフォールバック', () => {
    const npc = buildBattleNpc({ ...enemy, evade: undefined }, 'e3');
    expect(npc.resources.回避力.cur).toBe(3);
  });

  it('グレイズを 0/5 で初期化する', () => {
    const npc = buildBattleNpc(enemy, 'e4');
    expect(npc.resources.グレイズ).toEqual({ cur: 0, max: 5 });
  });

  it('名前のあるスペルカードのみ採用する', () => {
    const npc = buildBattleNpc(enemy, 'e5');
    expect(npc.spellCards).toHaveLength(1);
    expect(npc.spellCards[0].name).toBe('ふぅグランドダム');
  });

  it('ds が無ければ dsName/dsDesc からフォールバック', () => {
    const npc = buildBattleNpc({ name: '敵', dsName: 'ホーミング', dsDesc: '説明' }, 'e6');
    expect(npc.ds).toEqual({ name: 'ホーミング', desc: '説明' });
  });

  it('enemy.primary を primary フラグに伝播する', () => {
    const npc = buildBattleNpc({ ...enemy, primary: true }, 'e7');
    expect(npc.primary).toBe(true);
  });

  it('opts.primary でも primary を付与する', () => {
    const npc = buildBattleNpc(enemy, 'e8', { primary: true });
    expect(npc.primary).toBe(true);
  });

  it('primary 未指定なら primary キーを持たない', () => {
    const npc = buildBattleNpc(enemy, 'e9');
    expect(npc.primary).toBeUndefined();
  });

  it('customPortrait があれば NPC に伝搬する', () => {
    const npc = buildBattleNpc({ ...enemy, customPortrait: 'data:image/jpeg;base64,xxx' }, 'e10');
    expect(npc.customPortrait).toBe('data:image/jpeg;base64,xxx');
  });

  it('customPortrait が無ければキーを持たない', () => {
    expect(buildBattleNpc(enemy, 'e11').customPortrait).toBeUndefined();
  });

  it('null 敵には null を返す', () => {
    expect(buildBattleNpc(null, 'x')).toBeNull();
  });
});

describe('isNpcSideDefeated（NPC陣営の敗北判定）', () => {
  const alive = (primary) => ({ resources: { 残り人数: { cur: 1 } }, ...(primary ? { primary: true } : {}) });
  const dead  = (primary) => ({ resources: { 残り人数: { cur: 0 } }, ...(primary ? { primary: true } : {}) });

  it('primary 無し: 全員生存なら未敗北', () => {
    expect(isNpcSideDefeated([alive(), alive()])).toBe(false);
  });

  it('primary 無し: 一部生存なら未敗北', () => {
    expect(isNpcSideDefeated([dead(), alive()])).toBe(false);
  });

  it('primary 無し: 全滅で敗北', () => {
    expect(isNpcSideDefeated([dead(), dead()])).toBe(true);
  });

  it('primary 有り: 主敵が倒れれば、非主敵が残っていても敗北（決戦終了）', () => {
    // アリス(primary)=dead, ゆっくり(非primary)=alive
    expect(isNpcSideDefeated([dead(true), alive(false)])).toBe(true);
  });

  it('primary 有り: 主敵が生存なら、非主敵が全滅していても未敗北', () => {
    expect(isNpcSideDefeated([alive(true), dead(false)])).toBe(false);
  });

  it('primary 複数: 全ての主敵が倒れて初めて敗北', () => {
    expect(isNpcSideDefeated([dead(true), alive(true)])).toBe(false);
    expect(isNpcSideDefeated([dead(true), dead(true), alive(false)])).toBe(true);
  });

  it('空配列は敗北扱い（脱落者なし）', () => {
    expect(isNpcSideDefeated([])).toBe(true);
    expect(isNpcSideDefeated(undefined)).toBe(true);
  });
});
