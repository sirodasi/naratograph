import { vi, describe, it, expect } from 'vitest';

// firebase 接続を回避
vi.mock('../firebase', () => ({ db: {}, auth: {}, googleProvider: {} }));

import {
  hasOfficialSkill,
  isSkillUsed,
  markSkillUsed,
  parseSpell,
  buildSpellCard,
} from '../SessionView';
import { OFFICIAL_DANMAKU_SKILLS, ADJACENT_MAP } from '../data/gameData';

// ═══════════════════════════════════════════════════════════════════
// 公式弾幕スキル一覧の検証（13種が定義されているか）
// ═══════════════════════════════════════════════════════════════════
describe('OFFICIAL_DANMAKU_SKILLS 一覧の網羅性', () => {
  const EXPECTED_SKILLS = [
    'ホーミング',
    'ワイドショット',
    '弾消し',
    '不死身',
    '大威力',
    '近接攻撃',
    '低速弾',
    '壁抜け',
    '高速移動',
    '弾貨',
    '使い魔',
    '想起',
    '憑依',
  ];

  it.each(EXPECTED_SKILLS)('「%s」が公式リストに登録されている', (name) => {
    const skill = OFFICIAL_DANMAKU_SKILLS.find(s => s.name === name);
    expect(skill, `${name} が未登録`).toBeDefined();
    expect(skill.desc, `${name} の desc が空`).toBeTruthy();
  });

  it('全公式スキルの name に空文字がない', () => {
    for (const s of OFFICIAL_DANMAKU_SKILLS) {
      expect(s.name.length).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// hasOfficialSkill: 各種エンティティ形式 × 全公式スキル
// ═══════════════════════════════════════════════════════════════════
describe('hasOfficialSkill: 公式スキル全種の検出', () => {
  it.each(OFFICIAL_DANMAKU_SKILLS.map(s => s.name))(
    '%s を ds.name 形式で検出できる',
    (skillName) => {
      expect(hasOfficialSkill({ ds: { name: skillName } }, skillName)).toBe(true);
    }
  );

  it.each(OFFICIAL_DANMAKU_SKILLS.map(s => s.name))(
    '%s を dsName 形式 (旧仕様) で検出できる',
    (skillName) => {
      expect(hasOfficialSkill({ dsName: skillName }, skillName)).toBe(true);
    }
  );

  it.each(OFFICIAL_DANMAKU_SKILLS.map(s => s.name))(
    '%s を skillName 形式で検出できる',
    (skillName) => {
      expect(hasOfficialSkill({ skillName }, skillName)).toBe(true);
    }
  );

  it.each(OFFICIAL_DANMAKU_SKILLS.map(s => s.name))(
    '%s を ps.name 形式 (個性スキル) で検出できる',
    (skillName) => {
      expect(hasOfficialSkill({ ps: { name: skillName } }, skillName)).toBe(true);
    }
  );

  it('カスタム名 (非公式) は一致してもfalse', () => {
    expect(hasOfficialSkill({ ds: { name: '自作スキル' } }, '自作スキル')).toBe(false);
  });

  it('skillName が空文字でも誤検出しない', () => {
    expect(hasOfficialSkill({ ds: { name: 'ホーミング' } }, '')).toBe(false);
  });

  it('スキル名のフィールドが複数あるとき、ds.name が優先される', () => {
    // ds.name=ホーミング, dsName=壁抜け → ホーミング判定が優先
    const e = { ds: { name: 'ホーミング' }, dsName: '壁抜け' };
    expect(hasOfficialSkill(e, 'ホーミング')).toBe(true);
    expect(hasOfficialSkill(e, '壁抜け')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// isSkillUsed: 使用済み判定
// ═══════════════════════════════════════════════════════════════════
describe('isSkillUsed: 使用済みスキル判定', () => {
  it('usedds が undefined の場合は常に false', () => {
    expect(isSkillUsed(undefined, 'pc1', 'ホーミング')).toBe(false);
  });

  it('usedds が null の場合は常に false', () => {
    expect(isSkillUsed(null, 'pc1', 'ホーミング')).toBe(false);
  });

  it('usedds が空オブジェクトの場合は false', () => {
    expect(isSkillUsed({}, 'pc1', 'ホーミング')).toBe(false);
  });

  it('該当attackerIdに記録があり、その中にskillNameが含まれれば true', () => {
    const usedds = { pc1: ['ホーミング'] };
    expect(isSkillUsed(usedds, 'pc1', 'ホーミング')).toBe(true);
  });

  it('別のattackerIdに記録があってもfalse', () => {
    const usedds = { pc1: ['ホーミング'] };
    expect(isSkillUsed(usedds, 'pc2', 'ホーミング')).toBe(false);
  });

  it('同じattackerIdでも別スキル名なら false', () => {
    const usedds = { pc1: ['ホーミング'] };
    expect(isSkillUsed(usedds, 'pc1', '壁抜け')).toBe(false);
  });

  it('複数のスキルが記録されている場合も正しく判定', () => {
    const usedds = { pc1: ['ホーミング', '近接攻撃', '大威力'] };
    expect(isSkillUsed(usedds, 'pc1', '近接攻撃')).toBe(true);
    expect(isSkillUsed(usedds, 'pc1', '大威力')).toBe(true);
    expect(isSkillUsed(usedds, 'pc1', 'ワイドショット')).toBe(false);
  });

  it('複数attackerが独立して記録されている', () => {
    const usedds = {
      pc1: ['ホーミング'],
      pc2: ['壁抜け'],
      npc1: ['弾消し'],
    };
    expect(isSkillUsed(usedds, 'pc1', 'ホーミング')).toBe(true);
    expect(isSkillUsed(usedds, 'pc1', '壁抜け')).toBe(false);
    expect(isSkillUsed(usedds, 'pc2', '壁抜け')).toBe(true);
    expect(isSkillUsed(usedds, 'npc1', '弾消し')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// markSkillUsed: 使用済み追加（イミュータブル）
// ═══════════════════════════════════════════════════════════════════
describe('markSkillUsed: 使用済み記録の追加', () => {
  it('undefined から新しい記録を生成', () => {
    const next = markSkillUsed(undefined, 'pc1', 'ホーミング');
    expect(next).toEqual({ pc1: ['ホーミング'] });
  });

  it('null から新しい記録を生成', () => {
    const next = markSkillUsed(null, 'pc1', 'ホーミング');
    expect(next).toEqual({ pc1: ['ホーミング'] });
  });

  it('空オブジェクトから新しい記録を生成', () => {
    const next = markSkillUsed({}, 'pc1', 'ホーミング');
    expect(next).toEqual({ pc1: ['ホーミング'] });
  });

  it('既存記録を破壊せず新しいオブジェクトを返す (イミュータブル)', () => {
    const before = { pc1: ['ホーミング'] };
    const beforeClone = JSON.parse(JSON.stringify(before));
    const after = markSkillUsed(before, 'pc1', '近接攻撃');
    // 元のオブジェクトは変化していない
    expect(before).toEqual(beforeClone);
    // 別の参照が返る
    expect(after).not.toBe(before);
    expect(after.pc1).not.toBe(before.pc1);
  });

  it('既存attackerIdに対しスキルを末尾に追加', () => {
    const before = { pc1: ['ホーミング'] };
    const after = markSkillUsed(before, 'pc1', '近接攻撃');
    expect(after.pc1).toEqual(['ホーミング', '近接攻撃']);
  });

  it('別のattackerIdの記録には影響しない', () => {
    const before = { pc1: ['ホーミング'], pc2: ['壁抜け'] };
    const after = markSkillUsed(before, 'pc1', '近接攻撃');
    expect(after.pc2).toEqual(['壁抜け']);
  });

  it('attackerId が空/null なら usedds をそのまま返す', () => {
    const before = { pc1: ['ホーミング'] };
    expect(markSkillUsed(before, null, 'ホーミング')).toBe(before);
    expect(markSkillUsed(before, '', 'ホーミング')).toBe(before);
  });

  it('attackerId が空のとき、undefined を渡しても空オブジェクトを返す', () => {
    expect(markSkillUsed(undefined, null, 'x')).toEqual({});
  });

  it('isSkillUsed と組み合わせて1ラウンドの記録ライフサイクルが成立', () => {
    let usedds = {};
    expect(isSkillUsed(usedds, 'pc1', 'ホーミング')).toBe(false);
    usedds = markSkillUsed(usedds, 'pc1', 'ホーミング');
    expect(isSkillUsed(usedds, 'pc1', 'ホーミング')).toBe(true);
    // 同じスキルを再度マークしようとしても、使用済み判定は true のまま
    usedds = markSkillUsed(usedds, 'pc1', 'ホーミング');
    expect(usedds.pc1.filter(s => s === 'ホーミング')).toHaveLength(2);
    expect(isSkillUsed(usedds, 'pc1', 'ホーミング')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// スキル発動可否シミュレーション
// （実コードの canUseXxx 判定ロジックを再現してテスト）
// ═══════════════════════════════════════════════════════════════════
describe('スキル発動可否判定の組み合わせ', () => {
  // attacker, usedds から「このスキルを今使えるか」を判定
  const canUse = (entity, usedds, attackerId, skillName) =>
    hasOfficialSkill(entity, skillName) && !isSkillUsed(usedds, attackerId, skillName);

  it('スキル未習得なら発動不可', () => {
    const pc = { uid: 'pc1', ds: { name: '近接攻撃' } };
    expect(canUse(pc, {}, 'pc1', 'ホーミング')).toBe(false);
  });

  it('スキル習得済み・未使用なら発動可', () => {
    const pc = { uid: 'pc1', ds: { name: 'ホーミング' } };
    expect(canUse(pc, {}, 'pc1', 'ホーミング')).toBe(true);
  });

  it('使用済みなら発動不可', () => {
    const pc = { uid: 'pc1', ds: { name: 'ホーミング' } };
    const usedds = { pc1: ['ホーミング'] };
    expect(canUse(pc, usedds, 'pc1', 'ホーミング')).toBe(false);
  });

  it('他PCの使用は影響しない（個別管理）', () => {
    const pc1 = { uid: 'pc1', ds: { name: 'ホーミング' } };
    const pc2 = { uid: 'pc2', ds: { name: 'ホーミング' } };
    const usedds = { pc1: ['ホーミング'] };
    expect(canUse(pc1, usedds, 'pc1', 'ホーミング')).toBe(false);
    expect(canUse(pc2, usedds, 'pc2', 'ホーミング')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// parseSpell: スペルカード弾幕効果の解析
// ═══════════════════════════════════════════════════════════════════
describe('parseSpell: スペルカード効果パターン詳細', () => {
  it('複数の効果パターンを同一テキストから抽出', () => {
    const r = parseSpell('恋符「マスタースパーク」【自機マス×1】このスペルカードの処理で【弾幕】を配置した上下のマスに、さらに【弾幕】を2つずつ配置する。');
    expect(r.effects).toContainEqual({ type: 'SELF', count: 1 });
  });

  it('【敵機マス×N】を ENEMY として解析', () => {
    const r = parseSpell('効果【敵機マス×3】');
    expect(r.effects).toContainEqual({ type: 'ENEMY', count: 3 });
  });

  it('複数の同種効果も全て抽出 (重複可)', () => {
    const r = parseSpell('【自機マス×1】の後【自機マス×2】を追加');
    const selfs = r.effects.filter(e => e.type === 'SELF');
    expect(selfs).toHaveLength(2);
    expect(selfs.map(e => e.count).sort()).toEqual([1, 2]);
  });

  it('FIXED は cell と count を別フィールドで保持', () => {
    const r = parseSpell('【3番マス×2】に弾幕配置');
    const fixed = r.effects.find(e => e.type === 'FIXED');
    expect(fixed).toEqual({ type: 'FIXED', cell: 3, count: 2 });
  });

  it('「使用できない」を含むテキストから条件文を抽出', () => {
    const r = parseSpell('このスペルカードは【霊力】が5点未満の場合にしか使用できない。');
    expect(r.condition).toBeTruthy();
    expect(r.condition).toMatch(/使用できない/);
  });

  it('条件文がなければ condition は null', () => {
    const r = parseSpell('効果【自機マス×1】');
    expect(r.condition).toBeNull();
  });

  // ─── 条件抽出: 効果記号を含むテキストから条件文だけを切り出す ──────
  // 旧実装の貪欲マッチで「テキスト全体」が condition に入ってしまう問題のリグレッション防止
  describe('extractCondition: 効果記号を含むテキストでも条件文だけを抽出', () => {
    it('魂魄妖夢『獄界剣「二百由旬の一閃」』: 効果【...×N】部分を含まず、条件文のみ抽出', () => {
      const text = '獄界剣「二百由旬の一閃」【1番マス×1】【2番マス×1】【3番マス×1】【自機マス×1】このスペルカードはあなたが1番マス、2番マス、3番マスのいずれかのマスにいない限り使用できない。';
      const r = parseSpell(text);
      expect(r.condition).toBe('このスペルカードはあなたが1番マス、2番マス、3番マスのいずれかのマスにいない限り使用できない。');
      // 効果記号は condition に含まれてはならない
      expect(r.condition).not.toMatch(/【1番マス×1】/);
      expect(r.condition).not.toMatch(/獄界剣/);
    });

    it('八雲紫『彩符「彩光風鈴」』: 同じパターンで条件文のみ抽出', () => {
      const text = '彩符「彩光風鈴」【2番マス×1】【4番マス×1】【6番マス×1】【自機マス×1】このスペルカードはあなたが1番マス、2番マス、3番マスのいずれかのマスにいない限り使用できない。';
      const r = parseSpell(text);
      expect(r.condition).toBe('このスペルカードはあなたが1番マス、2番マス、3番マスのいずれかのマスにいない限り使用できない。');
      expect(r.condition).not.toMatch(/彩符/);
    });

    it('魂魄妖夢『傷魂「ソウルスカルプチュア」』(成長スペカ): ランダム配置型でも条件文のみ抽出', () => {
      const text = '傷魂「ソウルスカルプチュア」【ランダム×5】このスペルカードは、回避側のいるマスに【弾幕】が配置されていない場合にしか使用できない。';
      const r = parseSpell(text);
      expect(r.condition).toBe('このスペルカードは、回避側のいるマスに【弾幕】が配置されていない場合にしか使用できない。');
      expect(r.condition).not.toMatch(/ソウル/);
      expect(r.condition).not.toMatch(/【ランダム×5】/);
    });

    it('複数文ある場合に条件文(中央の文)のみを抽出し、副作用文は含めない', () => {
      // 「憂面」: 条件文＋副作用文の2文構成
      const text = '憂面「杞人地を憂う」【敵機マス×2】このスペルカードは、あなたの【回避力】が「1」以上の時しか使用できない。このスペルカードを使用した後、あなたの【回避力】が「1」減少する。';
      const r = parseSpell(text);
      expect(r.condition).toBe('このスペルカードは、あなたの【回避力】が「1」以上の時しか使用できない。');
      // 副作用文は別の文なので含まれない
      expect(r.condition).not.toMatch(/減少する/);
    });
  });

  // ─── textBody: 条件文を取り除いた本文（重複表示防止） ───────────────
  describe('textBody: 条件文を除いた本文', () => {
    it('条件文なしの場合は textBody === text', () => {
      const text = '効果【自機マス×1】';
      const r = parseSpell(text);
      expect(r.textBody).toBe(text);
    });

    it('条件文が末尾にある場合、textBody には条件文が含まれない', () => {
      const text = '獄界剣「二百由旬の一閃」【1番マス×1】【2番マス×1】【3番マス×1】【自機マス×1】このスペルカードはあなたが1番マス、2番マス、3番マスのいずれかのマスにいない限り使用できない。';
      const r = parseSpell(text);
      expect(r.textBody).not.toMatch(/このスペルカードはあなたが/);
      expect(r.textBody).not.toMatch(/使用できない/);
      // 効果記号と名前は残る
      expect(r.textBody).toMatch(/獄界剣/);
      expect(r.textBody).toMatch(/【1番マス×1】/);
    });

    it('条件文＋副作用文の場合、条件文だけが除かれて副作用文は textBody に残る', () => {
      const text = '憂面「杞人地を憂う」【敵機マス×2】このスペルカードは、あなたの【回避力】が「1」以上の時しか使用できない。このスペルカードを使用した後、あなたの【回避力】が「1」減少する。';
      const r = parseSpell(text);
      expect(r.textBody).not.toMatch(/「1」以上の時しか使用できない/);
      expect(r.textBody).toMatch(/減少する/);
    });
  });

  it('全タイミングルールが排他的に判定される (round_start > evade > hit)', () => {
    // round_start が優先
    expect(parseSpell('ラウンド開始時に被弾を防ぐ').timing).toBe('round_start');
    // round_start がなければ evade
    expect(parseSpell('回避ステップで効果を発揮').timing).toBe('evade');
    // hit (被弾)
    expect(parseSpell('被弾したとき効果').timing).toBe('hit');
  });
});

// ═══════════════════════════════════════════════════════════════════
// buildSpellCard: 名前抽出と effects 反映
// ═══════════════════════════════════════════════════════════════════
describe('buildSpellCard: スペルカード組み立て', () => {
  it('文字列から name と effects 両方を抽出', () => {
    const card = buildSpellCard('霊符「夢想封印」【指定マス×2】');
    expect(card.name).toBe('霊符「夢想封印」');
    expect(card.effects).toContainEqual({ type: 'CHOOSE', count: 2 });
  });

  it('カギ括弧「」がない場合は先頭20文字を名前として使用', () => {
    const text = 'これは括弧なしの説明文だけのスペルカード効果';
    const card = buildSpellCard(text);
    expect(card.name.length).toBeLessThanOrEqual(20);
  });

  it('オブジェクト入力の text フィールドから解析', () => {
    const card = buildSpellCard({ text: '夢符「二重結界」【隣接マス×1】' });
    expect(card.name).toBe('夢符「二重結界」');
    expect(card.effects).toContainEqual({ type: 'ADJACENT', count: 1 });
  });

  it('オブジェクト入力で desc フィールドも text の代替として使われる', () => {
    const card = buildSpellCard({ desc: '神符「八方鬼縛陣」【自機マス×2】' });
    expect(card.name).toBe('神符「八方鬼縛陣」');
  });
});

// ═══════════════════════════════════════════════════════════════════
// ADJACENT_MAP: 隣接定義（壁抜けスキル前提）
// ═══════════════════════════════════════════════════════════════════
describe('ADJACENT_MAP: グリッド隣接定義', () => {
  it('1〜6マスすべてに隣接定義がある', () => {
    for (const cell of [1, 2, 3, 4, 5, 6]) {
      expect(ADJACENT_MAP[cell]).toBeInstanceOf(Array);
      expect(ADJACENT_MAP[cell].length).toBeGreaterThan(0);
    }
  });

  it('隣接関係は対称 (A→B なら B→A も成立)', () => {
    for (const [a, neighbors] of Object.entries(ADJACENT_MAP)) {
      const aNum = parseInt(a);
      for (const b of neighbors) {
        expect(ADJACENT_MAP[b], `${b} → ${aNum} が逆方向に存在しない`).toContain(aNum);
      }
    }
  });

  it('自身は隣接に含まれない', () => {
    for (const [cell, neighbors] of Object.entries(ADJACENT_MAP)) {
      expect(neighbors).not.toContain(parseInt(cell));
    }
  });

  it('「壁抜け」未使用時、1と3 は直接隣接していない', () => {
    expect(ADJACENT_MAP[1]).not.toContain(3);
    expect(ADJACENT_MAP[3]).not.toContain(1);
  });

  it('「壁抜け」未使用時、4と6 は直接隣接していない', () => {
    expect(ADJACENT_MAP[4]).not.toContain(6);
    expect(ADJACENT_MAP[6]).not.toContain(4);
  });
});
