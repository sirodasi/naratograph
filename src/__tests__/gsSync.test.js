import { describe, it, expect } from 'vitest';
import { normalizeGs, computeGsUpdate, stripUndefined, DEFAULT_GS, publicScenario, publicQuest, sanitizeGsForWrite, mergeScenarioSecret, reconcileQuests, normalizeScenario } from '../gsSync';

const withLog = (n, prefix = 'L') => Array.from({ length: n }, (_, i) => `${prefix}${n - 1 - i}`); // prepend 運用: 先頭が最新

describe('normalizeGs', () => {
  it('null / 非オブジェクトは null（state 未作成）', () => {
    expect(normalizeGs(null)).toBeNull();
    expect(normalizeGs(undefined)).toBeNull();
    expect(normalizeGs('x')).toBeNull();
  });

  it('Firebase が消した空配列を補い、オブジェクト化した配列を配列に戻す', () => {
    const gs = normalizeGs({ day: 2, pcs: { 0: { uid: 'a', charId: 'x' } }, log: { 0: 'b', 1: 'a' } });
    expect(gs.day).toBe(2);
    expect(gs.quests).toEqual([]);
    expect(gs.clues).toEqual([]);
    expect(gs.log).toEqual(['b', 'a']);
    expect(gs.pcs).toHaveLength(1);
    expect(gs.pcs[0].currentSpot).toBe('11'); // normalizePc の救済
    expect(gs.resources).toEqual(DEFAULT_GS.resources);
  });
});

describe('computeGsUpdate', () => {
  const base = normalizeGs({ day: 1, log: ['a'] });

  it('関数・オブジェクトの両方を受け付ける', () => {
    expect(computeGsUpdate(base, p => ({ ...p, day: 3 })).next.day).toBe(3);
    expect(computeGsUpdate(base, { ...base, day: 4 }).next.day).toBe(4);
  });

  it('ログが増えたときだけ logGrew（アンドゥ対象）', () => {
    expect(computeGsUpdate(base, p => ({ ...p, log: ['b', ...p.log] })).logGrew).toBe(true);
    expect(computeGsUpdate(base, p => ({ ...p, dice: { rolling: true } })).logGrew).toBe(false);
  });

  it('上限到達後も、切り詰め前の件数でログ増加を判定する（400件以降もアンドゥ可能）', () => {
    const prev = { ...base, log: withLog(5) };
    const r = computeGsUpdate(prev, p => ({ ...p, log: ['new', ...p.log] }), 5);
    expect(r.next.log).toHaveLength(5);
    expect(r.logGrew).toBe(true);
  });

  it('上限超過分を古い順の通し番号キーで退避し、logBase を進める', () => {
    const prev = { ...base, log: withLog(5) }; // L4..L0（L0 が最古）
    const r = computeGsUpdate(prev, p => ({ ...p, log: ['N1', 'N0', ...p.log] }), 5);
    expect(r.next.log).toEqual(['N1', 'N0', 'L4', 'L3', 'L2']);
    expect(r.archived).toEqual({ e0000000: 'L0', e0000001: 'L1' });
    expect(r.next.logBase).toBe(2);

    // 続けて超過 → 次の番号から
    const r2 = computeGsUpdate(r.next, p => ({ ...p, log: ['N2', ...p.log] }), 5);
    expect(r2.archived).toEqual({ e0000002: 'L2' });
    expect(r2.next.logBase).toBe(3);
  });

  it('アンドゥで戻した状態から同じ操作をしても同じキーに退避される（重複しない）', () => {
    const prev = { ...base, log: withLog(5) };
    const op = p => ({ ...p, log: ['N', ...p.log] });
    const a = computeGsUpdate(prev, op, 5);
    const b = computeGsUpdate(prev, op, 5); // undo 後の再実行に相当
    expect(Object.keys(b.archived)).toEqual(Object.keys(a.archived));
  });

  it('超過が無ければ archived は null', () => {
    expect(computeGsUpdate(base, p => ({ ...p, log: ['b', ...p.log] })).archived).toBeNull();
  });
});

describe('stripUndefined', () => {
  it('入れ子の undefined キーと配列要素を除去する', () => {
    expect(stripUndefined({ a: 1, b: undefined, c: { d: undefined, e: [1, undefined, 2] } }))
      .toEqual({ a: 1, c: { e: [1, 2] } });
  });
});

describe('シナリオ秘匿', () => {
  const scenario = {
    id: 's1', name: 'テスト', backstory: '導入', limit: '3日目の夜', blockedSpots: ['11'],
    phaseNotes: { intro: 'GMメモ' }, notes: '内緒',
    finalBattleEnemies: [{ name: 'ラスボス' }],
    finalBattleOptionalEnemies: [{ name: '追加' }],
    quests: [
      { id: 1, name: 'Q1', summary: 's1', truth: 'T1', unlockType: 'start' },
      { id: 2, name: 'Q2', summary: 's2', truth: 'T2', unlockType: 'quest', unlockQuestId: '1' },
      { id: 3, name: 'Q3', summary: 's3', truth: 'T3', unlockType: 'quest', unlockQuestId: '2' },
    ],
  };

  it('publicScenario: 答え・敵・未登場クエスト・GMメモを除き、公開項目とクエスト数は残す', () => {
    const pub = publicScenario(scenario);
    expect(pub).not.toHaveProperty('quests');
    expect(pub).not.toHaveProperty('finalBattleEnemies');
    expect(pub).not.toHaveProperty('finalBattleOptionalEnemies');
    expect(pub).not.toHaveProperty('phaseNotes');
    expect(pub).not.toHaveProperty('notes');
    expect(pub).toMatchObject({ id: 's1', name: 'テスト', backstory: '導入', limit: '3日目の夜', blockedSpots: ['11'], questCount: 3 });
    // 公開版を再度通しても questCount は保たれる
    expect(publicScenario(pub).questCount).toBe(3);
  });

  it('normalizeScenario は公開版に空の quests を足さない', () => {
    expect(normalizeScenario(publicScenario(scenario))).not.toHaveProperty('quests');
  });

  it('publicQuest: 未解決クエストの真相だけ除く', () => {
    expect(publicQuest({ id: 1, truth: 'T' })).toEqual({ id: 1 });
    expect(publicQuest({ id: 1, truth: 'T', solved: true })).toEqual({ id: 1, truth: 'T', solved: true });
  });

  it('computeGsUpdate はどの更新でも秘匿情報を書き込まない', () => {
    const prev = normalizeGs({ log: [] });
    const { next } = computeGsUpdate(prev, p => ({ ...p, scenarioData: scenario, quests: [{ ...scenario.quests[0] }] }));
    expect(next.scenarioData).not.toHaveProperty('quests');
    expect(next.quests[0]).not.toHaveProperty('truth');
  });

  it('scenarioRevealed（終幕公開後）は秘匿しない', () => {
    const gs = { scenarioRevealed: true, scenarioData: scenario, quests: [{ id: 1, truth: 'T1' }] };
    expect(sanitizeGsForWrite(gs)).toBe(gs);
  });

  it('mergeScenarioSecret: GM 表示には全文と未解決の真相を重ねる', () => {
    const gs = { scenarioData: publicScenario(scenario), quests: [{ id: 1, name: 'Q1' }] };
    const merged = mergeScenarioSecret(gs, scenario);
    expect(merged.scenarioData.finalBattleEnemies).toHaveLength(1);
    expect(merged.quests[0].truth).toBe('T1');
  });

  it('reconcileQuests: 解決済みに真相を付け、次クエストを真相抜きで解放する', () => {
    const next = reconcileQuests([{ id: 1, name: 'Q1', solved: true }], scenario.quests);
    expect(next[0].truth).toBe('T1');
    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({ id: 2, revealed: true, solved: false, clues: 0 });
    expect(next[1]).not.toHaveProperty('truth');
    // 変化が無ければ null（GM の effect が無限に upd しないため）
    expect(reconcileQuests(next, scenario.quests)).toBeNull();
  });

  it('reconcileQuests: 未解決のみなら何もしない', () => {
    expect(reconcileQuests([{ id: 1, solved: false }], scenario.quests)).toBeNull();
  });
});
