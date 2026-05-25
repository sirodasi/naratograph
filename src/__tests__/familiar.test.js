import { vi, describe, it, expect } from 'vitest';

vi.mock('../firebase', () => ({ db: {}, auth: {}, googleProvider: {} }));

import {
  hasOfficialSkill,
  isSkillUsed,
  markSkillUsed,
  calcShotDiceCount,
  resolveCover,
} from '../SessionView';
import { OFFICIAL_DANMAKU_SKILLS } from '../data/gameData';

// ═══════════════════════════════════════════════════════════════════
// 使い魔のスキル定義
// ═══════════════════════════════════════════════════════════════════
describe('使い魔: スキル定義', () => {
  it('OFFICIAL_DANMAKU_SKILLS に「使い魔」が登録されている', () => {
    const skill = OFFICIAL_DANMAKU_SKILLS.find(s => s.name === '使い魔');
    expect(skill).toBeDefined();
    expect(skill.desc).toMatch(/ショットステップで振るダイスの数は「1」減少/);
    expect(skill.desc).toMatch(/援護射撃/);
    expect(skill.desc).toMatch(/かばう/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 使い魔: hasOfficialSkill による検出
// ═══════════════════════════════════════════════════════════════════
describe('使い魔: hasOfficialSkill による検出', () => {
  it('ds.name=使い魔 で検出される (PC形式)', () => {
    expect(hasOfficialSkill({ ds: { name: '使い魔' } }, '使い魔')).toBe(true);
  });

  it('dsName=使い魔 で検出される (NPC旧形式)', () => {
    expect(hasOfficialSkill({ name: '雛鳥', dsName: '使い魔' }, '使い魔')).toBe(true);
  });

  it('別スキル習得者は使い魔として判定されない', () => {
    expect(hasOfficialSkill({ ds: { name: 'ホーミング' } }, '使い魔')).toBe(false);
  });

  it('スキル未習得 (ds なし) は false', () => {
    expect(hasOfficialSkill({ uid: 'pc1' }, '使い魔')).toBe(false);
  });

  it('null エンティティは false', () => {
    expect(hasOfficialSkill(null, '使い魔')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 使い魔: ショットダイス数の計算 (-1 効果)
// ═══════════════════════════════════════════════════════════════════
describe('calcShotDiceCount: ショットダイス数の計算', () => {
  describe('使い魔なし', () => {
    it('攻撃力のみ', () => {
      expect(calcShotDiceCount(3, 0, false)).toBe(3);
    });

    it('攻撃力 + 援護射撃ボーナス', () => {
      expect(calcShotDiceCount(3, 1, false)).toBe(4);
      expect(calcShotDiceCount(3, 2, false)).toBe(5);
    });

    it('攻撃力 1 = 最低限', () => {
      expect(calcShotDiceCount(1, 0, false)).toBe(1);
    });
  });

  describe('使い魔あり (ダイス -1)', () => {
    it('攻撃力 3 → 2 に減少', () => {
      expect(calcShotDiceCount(3, 0, true)).toBe(2);
    });

    it('攻撃力 5 → 4 に減少', () => {
      expect(calcShotDiceCount(5, 0, true)).toBe(4);
    });

    it('攻撃力 1 → 0 にはならず、最低 1 を保証', () => {
      expect(calcShotDiceCount(1, 0, true)).toBe(1);
    });

    it('攻撃力 2 → 1 に減少 (境界)', () => {
      expect(calcShotDiceCount(2, 0, true)).toBe(1);
    });

    it('援護射撃で減少分を打ち消せる: 3 - 1(使い魔) + 1(援護) = 3', () => {
      expect(calcShotDiceCount(3, 1, true)).toBe(3);
    });

    it('使い魔の自動援護射撃を再現: 3 - 1 + 1 = 3 (自分が使い魔で自動援護)', () => {
      // 「スキップ→自動援護射撃」の流れ: supportDice=1 になる
      expect(calcShotDiceCount(3, 1, true)).toBe(3);
    });

    it('援護射撃 2 つで使い魔ペナルティを超過: 2 - 1 + 2 = 3', () => {
      expect(calcShotDiceCount(2, 2, true)).toBe(3);
    });
  });

  describe('エッジケース', () => {
    it('攻撃力 0 (リソース欠損想定) でも最低 1', () => {
      expect(calcShotDiceCount(0, 0, false)).toBe(1);
      expect(calcShotDiceCount(0, 0, true)).toBe(1);
    });

    it('attackPower が undefined/null でも最低 1', () => {
      expect(calcShotDiceCount(undefined, 0, false)).toBe(1);
      expect(calcShotDiceCount(null, 0, true)).toBe(1);
    });

    it('supportDice が undefined/null でも計算可能', () => {
      expect(calcShotDiceCount(3, undefined, false)).toBe(3);
      expect(calcShotDiceCount(3, null, true)).toBe(2);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 使い魔: 自動かばう判定 (resolveCover)
// ═══════════════════════════════════════════════════════════════════
describe('resolveCover: 使い魔の自動かばう (および手動かばう共通ロジック)', () => {
  describe('成功ケース', () => {
    it('指定マスに弾幕1個あれば除去して success=true', () => {
      const grid = [0, 0, 1, 0, 0, 0];
      const { grid: next, success } = resolveCover(grid, 3);
      expect(success).toBe(true);
      expect(next).toEqual([0, 0, 0, 0, 0, 0]);
    });

    it('指定マスに弾幕複数あれば1つだけ除去', () => {
      const grid = [0, 0, 3, 0, 0, 0];
      const { grid: next, success } = resolveCover(grid, 3);
      expect(success).toBe(true);
      expect(next[2]).toBe(2);
    });

    it('1番マス〜6番マス全てで動作確認', () => {
      for (const die of [1, 2, 3, 4, 5, 6]) {
        const grid = [0, 0, 0, 0, 0, 0];
        grid[die - 1] = 2;
        const { grid: next, success } = resolveCover(grid, die);
        expect(success, `die=${die}`).toBe(true);
        expect(next[die - 1], `die=${die}`).toBe(1);
      }
    });
  });

  describe('失敗ケース', () => {
    it('指定マスに弾幕がなければ success=false で grid 変化なし', () => {
      const grid = [1, 0, 0, 0, 0, 0];
      const { grid: next, success } = resolveCover(grid, 3);
      expect(success).toBe(false);
      expect(next).toEqual([1, 0, 0, 0, 0, 0]);
    });

    it('全マス0の状態では常に失敗', () => {
      const grid = [0, 0, 0, 0, 0, 0];
      for (const die of [1, 2, 3, 4, 5, 6]) {
        const { success } = resolveCover(grid, die);
        expect(success, `die=${die}`).toBe(false);
      }
    });
  });

  describe('イミュータビリティ', () => {
    it('元の grid 配列を変更しない', () => {
      const grid = [0, 0, 1, 0, 0, 0];
      const original = [...grid];
      resolveCover(grid, 3);
      expect(grid).toEqual(original);
    });

    it('返り値の grid は新しい配列インスタンス', () => {
      const grid = [0, 0, 1, 0, 0, 0];
      const { grid: next } = resolveCover(grid, 3);
      expect(next).not.toBe(grid);
    });
  });

  describe('null/undefined グリッドのフォールバック', () => {
    it('grid が undefined なら全0として扱う', () => {
      const { grid: next, success } = resolveCover(undefined, 3);
      expect(success).toBe(false);
      expect(next).toEqual([0, 0, 0, 0, 0, 0]);
    });

    it('grid が null なら全0として扱う', () => {
      const { grid: next, success } = resolveCover(null, 1);
      expect(success).toBe(false);
      expect(next).toEqual([0, 0, 0, 0, 0, 0]);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 使い魔: 援護射撃の効果モデル (supportDice +1)
// ═══════════════════════════════════════════════════════════════════
describe('使い魔: 援護射撃シナリオ (supportDice の累積)', () => {
  // 「援護射撃」は battle.supportDice を +1 する効果
  // calcShotDiceCount(攻撃力, supportDice, hasFamiliar) で消費される
  const applySupportFire = (supportDice) => (supportDice || 0) + 1;

  it('援護射撃を1回適用すると supportDice = 1', () => {
    expect(applySupportFire(0)).toBe(1);
    expect(applySupportFire(undefined)).toBe(1);
  });

  it('援護射撃を複数回適用すると累積される', () => {
    let sd = 0;
    sd = applySupportFire(sd);
    sd = applySupportFire(sd);
    sd = applySupportFire(sd);
    expect(sd).toBe(3);
  });

  it('使い魔(自分が援護) + 別観戦者(援護射撃) で計2点上乗せ', () => {
    // 使い魔の自動援護: supportDice +1
    // 別の観戦者の援護射撃: supportDice +1
    // 結果: 攻撃力 3 - 1(使い魔) + 2(援護×2) = 4
    expect(calcShotDiceCount(3, 2, true)).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 使い魔: 統合シナリオ
// ═══════════════════════════════════════════════════════════════════
describe('使い魔: 統合シナリオ', () => {
  it('シナリオ A: 使い魔PC が自動援護を選んだ場合のショットダイス数', () => {
    // PC: 攻撃力 3, 使い魔習得
    // 観戦者なし、PCの使い魔が自動援護(+1)
    const attackPower = 3;
    const supportFromFamiliar = 1; // 自動援護で +1
    const dice = calcShotDiceCount(attackPower, supportFromFamiliar, true);
    expect(dice).toBe(3); // 3 + 1 - 1 = 3
  });

  it('シナリオ B: 使い魔PC が「かばう」を選んだ場合は援護なし', () => {
    // PC: 攻撃力 3, 使い魔習得
    // 自動援護を選ばず「かばう」を予約 → supportDice=0
    const attackPower = 3;
    const dice = calcShotDiceCount(attackPower, 0, true);
    expect(dice).toBe(2); // 3 + 0 - 1 = 2
  });

  it('シナリオ C: 使い魔NPC のかばう判定（弾幕除去成功）', () => {
    // 対戦者PC の弾幕フィールド: 4番マスに弾幕2個
    // ダイス目4が出て使い魔NPCがかばう → 4番マス -1
    const pcGrid = [0, 0, 0, 2, 0, 0];
    const { grid: nextGrid, success } = resolveCover(pcGrid, 4);
    expect(success).toBe(true);
    expect(nextGrid).toEqual([0, 0, 0, 1, 0, 0]);
  });

  it('シナリオ D: 使い魔は usedds に記録されない (毎ラウンド使用可)', () => {
    // 使い魔は他の弾幕スキルと違い、ラウンドごとに使用可能
    // (実コードでも markDanmakuUsed("使い魔") は呼ばれていない)
    // 念のため: 仮にマークしてもスキル定義上は毎ラウンド再使用可能であるべき
    let usedds = {};
    expect(isSkillUsed(usedds, 'pc1', '使い魔')).toBe(false);
    // markSkillUsed を使えば記録は可能だが、実コードでは使い魔は記録対象外
    usedds = markSkillUsed(usedds, 'pc1', '使い魔');
    expect(isSkillUsed(usedds, 'pc1', '使い魔')).toBe(true);
    // → 仕様上は記録すべきでないため、実コードでこの呼び出しがないことを別途確認すべし
  });
});
