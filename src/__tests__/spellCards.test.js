// スペルカードデータ(SPELL_CARD_EFFECTS)と効果ハンドラの統合テスト。
// 「内容の被っていないスペルカード」= ステップ構成(signature)がユニークなカードを各1枚ずつ代表として取り、
// 期待される処理結果と一致することを検証する。
//
// 既存の effectHandlers.test.js は applyStep/applyRandomResult の単体テストを担当。
// このファイルは「実カード名 → getSpellCardEffect → applyStep」の End-to-End 結合を担う。

import { describe, it, expect } from 'vitest';
import {
  SPELL_CARD_EFFECTS,
  getSpellCardEffect,
  extractSpellCardName,
} from '../data/spellCardEffects';
import {
  applyStep,
  applyRandomResult,
  applyAfterEffects,
  emptyGrid,
  resolveCount,
  analyzeSteps,
  isRandomStep,
  isChoiceStep,
} from '../data/effectHandlers';

// ═══════════════════════════════════════════════════════════════════
// getSpellCardEffect / extractSpellCardName: 名前ルックアップ
// ═══════════════════════════════════════════════════════════════════
describe('getSpellCardEffect: 名前ルックアップ', () => {
  it('完全名指定で取得できる', () => {
    expect(getSpellCardEffect('霊符「夢想封印」')).toBeDefined();
  });

  it('効果テキスト付き名でも「」内を抽出して取得', () => {
    const result = getSpellCardEffect('霊符「夢想封印」【指定マス×2】');
    expect(result).toBeDefined();
    expect(result.auto).toBe('partial');
  });

  it('存在しないカード名は null', () => {
    expect(getSpellCardEffect('架空符「存在しない」')).toBeNull();
  });

  it('null/空文字は null', () => {
    expect(getSpellCardEffect(null)).toBeNull();
    expect(getSpellCardEffect('')).toBeNull();
  });
});

describe('extractSpellCardName: 名前抽出', () => {
  it('【...】手前までを返す', () => {
    expect(extractSpellCardName('霊符「夢想封印」【指定マス×2】')).toBe('霊符「夢想封印」');
  });

  it('【がない場合はそのまま返す', () => {
    expect(extractSpellCardName('霊符「夢想封印」')).toBe('霊符「夢想封印」');
  });

  it('null は null のまま返す', () => {
    expect(extractSpellCardName(null)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// データ整合性: 全エントリの構造検証
// ═══════════════════════════════════════════════════════════════════
describe('SPELL_CARD_EFFECTS データ整合性', () => {
  const entries = Object.entries(SPELL_CARD_EFFECTS);

  it('カードが1枚以上登録されている', () => {
    expect(entries.length).toBeGreaterThan(50);
  });

  it.each(entries)('「%s」: auto は full/partial/manual のいずれか', (_name, def) => {
    expect(['full', 'partial', 'manual']).toContain(def.auto);
  });

  it('manual 以外はステップまたは effects が定義されている', () => {
    for (const [name, def] of entries) {
      if (def.auto === 'manual') continue;
      const hasSteps = Array.isArray(def.steps) && def.steps.length > 0;
      const hasEffects = Array.isArray(def.effects) && def.effects.length > 0;
      expect(hasSteps || hasEffects, `${name} に steps/effects がない`).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// ヘルパー: 「スペルカードを実行する」エンドツーエンド適用
// ═══════════════════════════════════════════════════════════════════

/**
 * カード名で SPELL_CARD_EFFECTS を引き、steps を順番に applyStep で適用する。
 * ダイス/選択ステップに当たった時点で stop し、その時点までの結果を返す。
 *
 * @returns { defGrid, atkGrid, stoppedAt, lastResult }
 */
function runCardSteps(name, opts = {}) {
  const def = getSpellCardEffect(name);
  if (!def || !def.steps) return { error: `no steps for ${name}` };
  const { atkPos = 2, defPos = 5, startDefGrid = emptyGrid(), startAtkGrid = emptyGrid(), entity = {} } = opts;
  let defGrid = [...startDefGrid];
  let atkGrid = [...startAtkGrid];
  let i = 0;
  for (const step of def.steps) {
    // stat-based count を解決
    const resolvedStep = (typeof step.count === 'object' && step.count !== null)
      ? { ...step, count: resolveCount(step.count, entity) }
      : step;
    const result = applyStep(resolvedStep, defGrid, atkGrid, atkPos, defPos);
    defGrid = result.defGrid;
    atkGrid = result.atkGrid;
    if (result.needsDice || result.needsChoice) {
      return { defGrid, atkGrid, stoppedAt: i, lastResult: result };
    }
    i++;
  }
  return { defGrid, atkGrid, stoppedAt: -1, lastResult: null };
}

// ═══════════════════════════════════════════════════════════════════
// Group 1: 自機 + アフター
// ═══════════════════════════════════════════════════════════════════
describe('スペルカード: 自機マス + アフターエフェクト', () => {
  it('恋符「マスタースパーク」: 自機マス×1 → 上下隣接マス×2', () => {
    // atkPos=2 → self=2, vertical of 2 = 5
    const { defGrid } = runCardSteps('恋符「マスタースパーク」', { atkPos: 2, defPos: 6 });
    expect(defGrid[1]).toBe(1); // セル2 (self)
    expect(defGrid[4]).toBe(2); // セル5 (vertical of 2, ×2)
  });

  it('禁忌「レーヴァテイン」: 自機マス×1 → 左右隣接マス×1', () => {
    // atkPos=2 → self=2, horizontal of 2 = [1,3]
    const { defGrid } = runCardSteps('禁忌「レーヴァテイン」', { atkPos: 2, defPos: 5 });
    expect(defGrid[1]).toBe(1); // セル2 (self)
    expect(defGrid[0]).toBe(1); // セル1 (horizontal)
    expect(defGrid[2]).toBe(1); // セル3 (horizontal)
  });

  it('鬼符「ミッシングパワー」: 自機マス×1 → 上下左右隣接マス×1', () => {
    // atkPos=5 → self=5, all_neighbors of 5 = [2,4,6]
    const { defGrid } = runCardSteps('鬼符「ミッシングパワー」', { atkPos: 5, defPos: 1 });
    expect(defGrid[4]).toBe(1); // セル5 (self)
    expect(defGrid[1]).toBe(1); // セル2
    expect(defGrid[3]).toBe(1); // セル4
    expect(defGrid[5]).toBe(1); // セル6
  });
});

// ═══════════════════════════════════════════════════════════════════
// Group 2: 敵機 + アフター
// ═══════════════════════════════════════════════════════════════════
describe('スペルカード: 敵機マス + アフターエフェクト', () => {
  it('人符「勧善懲悪は古の良き典なり」: 敵機マス×1 → 上下隣接マス×1', () => {
    // defPos=2 → enemy=2, vertical of 2 = 5
    const { defGrid } = runCardSteps('人符「勧善懲悪は古の良き典なり」', { atkPos: 4, defPos: 2 });
    expect(defGrid[1]).toBe(1); // セル2 (enemy)
    expect(defGrid[4]).toBe(1); // セル5 (vertical)
  });

  it('包符「義腕プロテウス」: 敵機マス×1 → 左右隣接マス×1', () => {
    // defPos=5 → enemy=5, horizontal of 5 = [4,6]
    const { defGrid } = runCardSteps('包符「義腕プロテウス」', { atkPos: 1, defPos: 5 });
    expect(defGrid[4]).toBe(1); // セル5 (enemy)
    expect(defGrid[3]).toBe(1); // セル4
    expect(defGrid[5]).toBe(1); // セル6
  });

  it('贄符「御射山御狩神事」: 敵機マス×2', () => {
    const { defGrid } = runCardSteps('贄符「御射山御狩神事」', { atkPos: 1, defPos: 3 });
    expect(defGrid[2]).toBe(2); // セル3 ×2
  });

  it('幻符「殺人ドール」: 敵機マス×1 (回避力減少効果は別途)', () => {
    const def = getSpellCardEffect('幻符「殺人ドール」');
    expect(def.effects).toContainEqual({ type: 'reduce_enemy_evasion', amount: 1 });
    const { defGrid } = runCardSteps('幻符「殺人ドール」', { atkPos: 2, defPos: 4 });
    expect(defGrid[3]).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Group 3: 隣接マス系
// ═══════════════════════════════════════════════════════════════════
describe('スペルカード: 隣接マス系', () => {
  it('夢符「二重結界」: 敵機の上下左右隣接マス×1', () => {
    // defPos=2 → adjacent = [1,3,5]
    const { defGrid } = runCardSteps('夢符「二重結界」', { atkPos: 6, defPos: 2 });
    expect(defGrid[0]).toBe(1); // セル1
    expect(defGrid[2]).toBe(1); // セル3
    expect(defGrid[4]).toBe(1); // セル5
    expect(defGrid[1]).toBe(0); // セル2 自体は対象外
  });

  it('滅罪「正直者の死」: 敵機の上下左右隣接マス×2', () => {
    // defPos=5 → adjacent = [2,4,6]
    const { defGrid } = runCardSteps('滅罪「正直者の死」', { atkPos: 1, defPos: 5 });
    expect(defGrid[1]).toBe(2);
    expect(defGrid[3]).toBe(2);
    expect(defGrid[5]).toBe(2);
  });

  it('薬符「胡蝶夢丸ナイトメア」: 自機と同番号の回避側マス隣接×1', () => {
    // atkPos=3 → mirrored_adj_self = adjacent of 3 = [2,6]
    const { defGrid } = runCardSteps('薬符「胡蝶夢丸ナイトメア」', { atkPos: 3, defPos: 1 });
    expect(defGrid[1]).toBe(1); // セル2
    expect(defGrid[5]).toBe(1); // セル6
  });

  it('QED「495年の波紋」: 自機隣接+自身以外の全マス×1', () => {
    // atkPos=2 → excluded = [2,1,3,5], remaining = [4,6]
    const { defGrid } = runCardSteps('QED「495年の波紋」', { atkPos: 2, defPos: 4 });
    expect(defGrid[3]).toBe(1); // セル4
    expect(defGrid[5]).toBe(1); // セル6
    expect(defGrid[0]).toBe(0); // 隣接なので除外
    expect(defGrid[1]).toBe(0); // 自身なので除外
    expect(defGrid[2]).toBe(0); // 隣接なので除外
    expect(defGrid[4]).toBe(0); // 隣接なので除外
  });

  it('眼光「十七条のレーザー」: 敵機左右隣接 + その上下隣接', () => {
    // defPos=2 → horizontal=[1,3], vertical of those = [4,6]
    const { defGrid } = runCardSteps('眼光「十七条のレーザー」', { atkPos: 5, defPos: 2 });
    expect(defGrid[0]).toBe(1); // セル1
    expect(defGrid[2]).toBe(1); // セル3
    expect(defGrid[3]).toBe(1); // セル4
    expect(defGrid[5]).toBe(1); // セル6
  });
});

// ═══════════════════════════════════════════════════════════════════
// Group 4: 固定マス・空きマス
// ═══════════════════════════════════════════════════════════════════
describe('スペルカード: 固定マス系', () => {
  it('神祭「エクスパンデッド・オンバシラ」: マス[1,3,4,6]に×1', () => {
    const { defGrid } = runCardSteps('神祭「エクスパンデッド・オンバシラ」', { atkPos: 2, defPos: 5 });
    expect(defGrid[0]).toBe(1);
    expect(defGrid[2]).toBe(1);
    expect(defGrid[3]).toBe(1);
    expect(defGrid[5]).toBe(1);
    expect(defGrid[1]).toBe(0);
    expect(defGrid[4]).toBe(0);
  });

  it('廃線「ぶらり廃駅下車の旅」: マス[2,2,5,5]→ 2番と5番に×2', () => {
    const { defGrid } = runCardSteps('廃線「ぶらり廃駅下車の旅」', { atkPos: 1, defPos: 6 });
    expect(defGrid[1]).toBe(2); // セル2
    expect(defGrid[4]).toBe(2); // セル5
  });

  it('日符「ロイヤルフレア」: 空きマス全てに×1 (timing=round_end)', () => {
    const def = getSpellCardEffect('日符「ロイヤルフレア」');
    expect(def.timing).toBe('round_end');
    const { defGrid } = runCardSteps('日符「ロイヤルフレア」', {
      atkPos: 1, defPos: 2,
      startDefGrid: [2, 0, 1, 0, 0, 3],
    });
    expect(defGrid).toEqual([2, 1, 1, 1, 1, 3]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Group 5: グリッド全体操作
// ═══════════════════════════════════════════════════════════════════
describe('スペルカード: グリッド全体操作', () => {
  it('逆符「天地有用」: 全弾幕を上下隣接マスへ移動', () => {
    const { defGrid } = runCardSteps('逆符「天地有用」', {
      atkPos: 1, defPos: 1,
      startDefGrid: [2, 0, 0, 0, 3, 0],
    });
    expect(defGrid[3]).toBe(2); // セル1→セル4
    expect(defGrid[1]).toBe(3); // セル5→セル2
    expect(defGrid[0]).toBe(0);
    expect(defGrid[4]).toBe(0);
  });

  it('逆転「リバースヒエラルキー」: 全弾幕を1番大きいマスへ(6→1ラップ)', () => {
    const { defGrid } = runCardSteps('逆転「リバースヒエラルキー」', {
      atkPos: 1, defPos: 1,
      startDefGrid: [1, 0, 0, 0, 0, 2],
    });
    expect(defGrid[1]).toBe(1); // セル1→セル2
    expect(defGrid[0]).toBe(2); // セル6→セル1 (ラップ)
  });

  it('逆符「鏡の国の弾幕」: 1個→3個, 3個以上→1個に変換', () => {
    const { defGrid } = runCardSteps('逆符「鏡の国の弾幕」', {
      atkPos: 1, defPos: 1,
      startDefGrid: [1, 0, 3, 5, 1, 2],
    });
    expect(defGrid[0]).toBe(3); // 1→3
    expect(defGrid[1]).toBe(0); // 0→そのまま
    expect(defGrid[2]).toBe(1); // 3→1
    expect(defGrid[3]).toBe(1); // 5→1
    expect(defGrid[4]).toBe(3); // 1→3
    expect(defGrid[5]).toBe(2); // 2→そのまま
  });

  it('小槌「大きくなあれ」: 弾幕1個のマスに+1', () => {
    const { defGrid } = runCardSteps('小槌「大きくなあれ」', {
      atkPos: 1, defPos: 1,
      startDefGrid: [1, 0, 3, 1, 0, 1],
    });
    expect(defGrid[0]).toBe(2);
    expect(defGrid[1]).toBe(0);
    expect(defGrid[2]).toBe(3); // 1ではないので変化なし
    expect(defGrid[3]).toBe(2);
    expect(defGrid[5]).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Group 6: ランダム + アフター
// ═══════════════════════════════════════════════════════════════════
describe('スペルカード: ランダム + アフターエフェクト', () => {
  it('魔符「アーティフルサクリファイス」: random×1 → 上下左右隣接×1', () => {
    const def = getSpellCardEffect('魔符「アーティフルサクリファイス」');
    const hint = applyStep(def.steps[0], emptyGrid(), emptyGrid(), 1, 4);
    expect(hint.needsDice).toBe(true);
    expect(hint.diceCount).toBe(1);
    // ダイス結果=3 → セル3配置 → 隣接=[2,6]に+1
    const { defGrid } = applyRandomResult(emptyGrid(), [3], { afterList: hint.afterList });
    expect(defGrid[2]).toBe(1); // セル3 (random)
    expect(defGrid[1]).toBe(1); // セル2 (隣接)
    expect(defGrid[5]).toBe(1); // セル6 (隣接)
  });

  it('爆符「メガフレア」: random×1 → 配置マスに+3', () => {
    const def = getSpellCardEffect('爆符「メガフレア」');
    const hint = applyStep(def.steps[0], emptyGrid(), emptyGrid(), 1, 4);
    // ダイス結果=4 → セル4に1配置 + add_to_placed +3 → 計4
    const { defGrid } = applyRandomResult(emptyGrid(), [4], { afterList: hint.afterList });
    expect(defGrid[3]).toBe(4);
  });

  it('神宝「ブディストダイアモンド」: random×2 → 配置マスの上下隣接×1', () => {
    const def = getSpellCardEffect('神宝「ブディストダイアモンド」');
    const hint = applyStep(def.steps[0], emptyGrid(), emptyGrid(), 1, 4);
    expect(hint.diceCount).toBe(2);
    // ダイス結果=[1,3] → セル1,3配置 → vertical of those = [4,6]
    const { defGrid } = applyRandomResult(emptyGrid(), [1, 3], { afterList: hint.afterList });
    expect(defGrid[0]).toBe(1); // セル1
    expect(defGrid[2]).toBe(1); // セル3
    expect(defGrid[3]).toBe(1); // セル4
    expect(defGrid[5]).toBe(1); // セル6
  });

  it('龍符「龍紋弾」: random×2 → 配置マスに+1ずつ追加', () => {
    const def = getSpellCardEffect('龍符「龍紋弾」');
    const hint = applyStep(def.steps[0], emptyGrid(), emptyGrid(), 1, 4);
    // ダイス結果=[1,1] → セル1に2配置 + double_each(unique=[1])+1 → 計3
    const { defGrid } = applyRandomResult(emptyGrid(), [1, 1], { afterList: hint.afterList });
    expect(defGrid[0]).toBe(3);
  });

  it('視符「ナズーリンペンデュラム」: random×3 → 攻撃側の配置マス同番号から-1', () => {
    const def = getSpellCardEffect('視符「ナズーリンペンデュラム」');
    const hint = applyStep(def.steps[0], emptyGrid(), [2, 0, 2, 0, 0, 0], 1, 4);
    // ダイス=[1,1,3] → defGrid: セル1×2, セル3×1
    // after の remove_attacker_mirror で atkGrid: セル1,3から-1 → [1,0,1,0,0,0]
    const { defGrid: afterDef, placedCells } = applyRandomResult(
      emptyGrid(), [1, 1, 3], { afterList: [] }
    );
    const { atkGrid: finalAtk } = applyAfterEffects(hint.afterList, afterDef, [2, 0, 2, 0, 0, 0], placedCells);
    expect(afterDef[0]).toBe(2);
    expect(afterDef[2]).toBe(1);
    expect(finalAtk[0]).toBe(1);
    expect(finalAtk[2]).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Group 7: 除去→ランダム派生
// ═══════════════════════════════════════════════════════════════════
describe('スペルカード: 除去→ランダム派生', () => {
  it('涷符「パーフェクトフリーズ」: 全弾幕除去 → ランダム×(除去数×1)', () => {
    const startGrid = [1, 2, 0, 1, 0, 0]; // 合計4
    const def = getSpellCardEffect('涷符「パーフェクトフリーズ」');
    const hint = applyStep(def.steps[0], startGrid, emptyGrid(), 1, 2);
    expect(hint.needsDice).toBe(true);
    expect(hint.diceCount).toBe(4);
    expect(hint.defGrid).toEqual(emptyGrid()); // 全除去
  });

  it('「お腹を空かせたグリードモンスター」: 全弾幕除去 → ランダム×(除去数×2)', () => {
    const startGrid = [0, 0, 2, 0, 1, 0]; // 合計3
    const def = getSpellCardEffect('「お腹を空かせたグリードモンスター」');
    const hint = applyStep(def.steps[0], startGrid, emptyGrid(), 1, 2);
    expect(hint.diceCount).toBe(6); // 3×2
  });

  it('羊符「ナイトメア・オブ・キメラ」: 全弾幕除去 → ランダム×6 (固定)', () => {
    const startGrid = [3, 3, 0, 0, 0, 0]; // 合計6だが count=6 が固定
    const def = getSpellCardEffect('羊符「ナイトメア・オブ・キメラ」');
    const hint = applyStep(def.steps[0], startGrid, emptyGrid(), 1, 2);
    expect(hint.diceCount).toBe(6); // count 指定が優先
  });

  it('月＆木符「サテライトヒマワリ」: 自機mirrored隣接の弾幕除去→×(除去数×2)', () => {
    // atkPos=2 → mirrored_adj=[1,3,5]
    const startGrid = [2, 0, 1, 0, 3, 0]; // 隣接合計=6
    const def = getSpellCardEffect('月＆木符「サテライトヒマワリ」');
    const hint = applyStep(def.steps[0], startGrid, emptyGrid(), 2, 6);
    expect(hint.needsDice).toBe(true);
    expect(hint.diceCount).toBe(12); // 6×2
    expect(hint.defGrid[0]).toBe(0);
    expect(hint.defGrid[2]).toBe(0);
    expect(hint.defGrid[4]).toBe(0);
  });

  it('投皿「物部の八十瓮」: 敵機隣接の弾幕除去→×(除去数×1)', () => {
    // defPos=3 → adjacent=[2,6]
    const startGrid = [0, 3, 0, 0, 0, 2];
    const def = getSpellCardEffect('投皿「物部の八十瓮」');
    const hint = applyStep(def.steps[0], startGrid, emptyGrid(), 1, 3);
    expect(hint.diceCount).toBe(5); // (3+2)×1
  });

  it('宝塔「グレイテイストトレジャー」: 敵機隣接の弾幕除去→×(除去数×2)', () => {
    const startGrid = [0, 3, 0, 0, 0, 2];
    const def = getSpellCardEffect('宝塔「グレイテイストトレジャー」');
    const hint = applyStep(def.steps[0], startGrid, emptyGrid(), 1, 3);
    expect(hint.diceCount).toBe(10); // (3+2)×2
  });

  it('鵺符「弾幕キメラ」: 敵機隣接の弾幕除去(最大2)→敵機マスへ配置', () => {
    // defPos=2 → adjacent=[1,3,5], セル1=3, セル3=2, セル5=1, max=2
    const startGrid = [3, 0, 2, 0, 1, 0];
    const def = getSpellCardEffect('鵺符「弾幕キメラ」');
    const { defGrid } = applyStep(def.steps[0], startGrid, emptyGrid(), 4, 2);
    expect(defGrid[0]).toBe(1); // セル1: 3→1 (2除去)
    expect(defGrid[1]).toBe(2); // セル2: 0+2=2
    expect(defGrid[2]).toBe(2); // セル3: 変わらず
    expect(defGrid[4]).toBe(1); // セル5: 変わらず
  });
});

// ═══════════════════════════════════════════════════════════════════
// Group 8: 特殊ランダム
// ═══════════════════════════════════════════════════════════════════
describe('スペルカード: 特殊ランダム派生', () => {
  it('「遊星よりの弾幕X」: ランダム×4, 配置マスを2個に置き直す', () => {
    const def = getSpellCardEffect('「遊星よりの弾幕X」');
    const hint = applyStep(def.steps[0], emptyGrid(), emptyGrid(), 1, 2);
    expect(hint.needsDice).toBe(true);
    expect(hint.diceCount).toBe(4);
    expect(hint.specialType).toBe('clear_then_double');
    // ダイス=[1,4] → 各セルを2に置き直し
    const { defGrid } = applyRandomResult([3, 0, 0, 5, 0, 0], [1, 4], { specialType: 'clear_then_double' });
    expect(defGrid[0]).toBe(2); // 3→2
    expect(defGrid[3]).toBe(2); // 5→2
  });

  it('管狐「シリンダーフォックス」: 2D振り→出た目以外の全マスに×1', () => {
    const def = getSpellCardEffect('管狐「シリンダーフォックス」');
    const hint = applyStep(def.steps[0], emptyGrid(), emptyGrid(), 1, 2);
    expect(hint.needsDice).toBe(true);
    expect(hint.diceCount).toBe(2);
    expect(hint.specialType).toBe('exclude_fill');
    // ダイス=[2,5] → 2,5以外の[1,3,4,6]に×1
    const { defGrid } = applyRandomResult(emptyGrid(), [2, 5], { specialType: 'exclude_fill', fillCount: 1 });
    expect(defGrid).toEqual([1, 0, 1, 1, 0, 1]);
  });

  it('「フェイクアポロ」: 3D振り→各マス除去→上下左右隣接ユニーク+1', () => {
    const def = getSpellCardEffect('「フェイクアポロ」');
    const hint = applyStep(def.steps[0], [2, 1, 3, 0, 1, 0], emptyGrid(), 1, 4);
    expect(hint.specialType).toBe('clear_neighbors');
    // ダイス=[1,3,5] → 1,3,5除去 → 隣接unique=[2,4,6]→+1
    const { defGrid } = applyRandomResult([2, 1, 3, 0, 1, 0], [1, 3, 5], { specialType: 'clear_neighbors' });
    expect(defGrid[0]).toBe(0); // 1除去
    expect(defGrid[2]).toBe(0); // 3除去
    expect(defGrid[4]).toBe(0); // 5除去
    expect(defGrid[1]).toBe(2); // セル2: 1+1
    expect(defGrid[3]).toBe(1); // セル4: 0+1
    expect(defGrid[5]).toBe(1); // セル6: 0+1
  });
});

// ═══════════════════════════════════════════════════════════════════
// Group 9: ステータス連動カウント
// ═══════════════════════════════════════════════════════════════════
describe('スペルカード: ステータス連動カウント (stat-based count)', () => {
  it('火水木金土符「賢者の石」: ランダム×攻撃力', () => {
    const def = getSpellCardEffect('火水木金土符「賢者の石」');
    expect(def.steps[0].count).toEqual({ type: 'stat', stat: '攻撃力' });
    const entity = { resources: { 攻撃力: { cur: 4 } } };
    expect(resolveCount(def.steps[0].count, entity)).toBe(4);
  });

  it('雨傘「超撥水かさかさお化け」: ランダム×攻撃力 (賢者の石と同様)', () => {
    const def = getSpellCardEffect('雨傘「超撥水かさかさお化け」');
    const entity = { resources: { 攻撃力: { cur: 3 } } };
    expect(resolveCount(def.steps[0].count, entity)).toBe(3);
  });

  it('「バレットドミニオン」: ランダム×グレイズ×2', () => {
    const def = getSpellCardEffect('「バレットドミニオン」');
    const entity = { resources: { グレイズ: { cur: 5 } } };
    expect(resolveCount(def.steps[0].count, entity)).toBe(10);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Group 10: 複合ステップ
// ═══════════════════════════════════════════════════════════════════
describe('スペルカード: 複合ステップ', () => {
  it('邪符「ヤンシャオグイ」: 敵機マスをクリア → 敵機マス×2', () => {
    const { defGrid } = runCardSteps('邪符「ヤンシャオグイ」', {
      atkPos: 1, defPos: 3,
      startDefGrid: [0, 0, 4, 0, 0, 0], // 敵機マスに4個
    });
    // step1: clear_enemy_cell → セル3=0
    // step2: enemy×2 → セル3=2
    expect(defGrid[2]).toBe(2);
  });

  it('彩符「彩光風鈴」: 固定マス[2,4,6]×1 → 自機マス×1', () => {
    // atkPos=1
    const { defGrid } = runCardSteps('彩符「彩光風鈴」', { atkPos: 1, defPos: 3 });
    expect(defGrid[0]).toBe(1); // セル1 (self)
    expect(defGrid[1]).toBe(1); // セル2
    expect(defGrid[3]).toBe(1); // セル4
    expect(defGrid[5]).toBe(1); // セル6
  });

  it('彩符「彩光風鈴」: condition (attacker_in_cells) が定義されている', () => {
    const def = getSpellCardEffect('彩符「彩光風鈴」');
    expect(def.condition).toEqual({ attacker_in_cells: [1, 2, 3] });
  });

  it('獄界剣「二百由旬の一閃」: 固定マス[1,2,3]×1 → 自機マス×1 (1〜3マスの場合自機マスは+2)', () => {
    const { defGrid } = runCardSteps('獄界剣「二百由旬の一閃」', { atkPos: 2, defPos: 5 });
    expect(defGrid[0]).toBe(1); // セル1
    expect(defGrid[1]).toBe(2); // セル2 (fixed + self)
    expect(defGrid[2]).toBe(1); // セル3
  });

  it('転覆「道連れアンカー」: 自機マス×1 → 敵機マス×1', () => {
    const { defGrid } = runCardSteps('転覆「道連れアンカー」', { atkPos: 2, defPos: 5 });
    expect(defGrid[1]).toBe(1); // セル2 (self)
    expect(defGrid[4]).toBe(1); // セル5 (enemy)
  });

  it('「クイーンオブバブル」: 敵機マス×1 → 自機マス×1', () => {
    const { defGrid } = runCardSteps('「クイーンオブバブル」', { atkPos: 3, defPos: 6 });
    expect(defGrid[2]).toBe(1); // セル3 (self)
    expect(defGrid[5]).toBe(1); // セル6 (enemy)
  });

  it('神宝「ブリリアントドラゴンバレッタ」: 敵機マス×1 → ランダム×2', () => {
    // step1: enemy → 配置
    // step2: random → ダイス必要 → stoppedAt=1
    const result = runCardSteps('神宝「ブリリアントドラゴンバレッタ」', { atkPos: 1, defPos: 5 });
    expect(result.defGrid[4]).toBe(1); // セル5 (enemy)
    expect(result.stoppedAt).toBe(1); // 2番目のstepでdice必要
    expect(result.lastResult.needsDice).toBe(true);
    expect(result.lastResult.diceCount).toBe(2);
  });

  it('式神「橙」: ランダム×3 (停止) → ステップ2は self×1', () => {
    const def = getSpellCardEffect('式神「橙」');
    expect(def.steps).toHaveLength(2);
    expect(def.steps[0].type).toBe('random');
    expect(def.steps[1].type).toBe('self');
    const result = runCardSteps('式神「橙」', { atkPos: 1, defPos: 2 });
    expect(result.stoppedAt).toBe(0); // ランダムで停止
    expect(result.lastResult.diceCount).toBe(3);
  });

  it('萃符「戸隠山投げ」: 自機×1 → ランダム×1 → 攻守同マスなら自機×1', () => {
    const def = getSpellCardEffect('萃符「戸隠山投げ」');
    expect(def.steps).toHaveLength(3);
    expect(def.steps[2].type).toBe('self_if_same_cell');
    // step1: self → 配置
    // step2: random → 停止
    const result = runCardSteps('萃符「戸隠山投げ」', { atkPos: 2, defPos: 4 });
    expect(result.defGrid[1]).toBe(1); // セル2 (self)
    expect(result.stoppedAt).toBe(1); // ランダムで停止
  });
});

// ═══════════════════════════════════════════════════════════════════
// Group 11: 選択ステップ (needsChoice)
// ═══════════════════════════════════════════════════════════════════
describe('スペルカード: プレイヤー選択ステップ', () => {
  it.each([
    ['霊符「夢想封印」', 'designated', 2],
    ['想起「恐怖症催眠術」', 'designated', 1],
    ['時符「プライベートスクェア」', 'designated', 3],
  ])('「%s」: %s × %i (needsChoice=true)', (name, type, count) => {
    const def = getSpellCardEffect(name);
    expect(def.steps[0].type).toBe(type);
    expect(def.steps[0].count).toBe(count);
    const result = applyStep(def.steps[0], emptyGrid(), emptyGrid(), 1, 2);
    expect(result.needsChoice).toBe(true);
    expect(result.choiceType).toBe(type);
  });

  it('望遠「キャンディッドショット」: designated + remove_attacker_mirror', () => {
    const def = getSpellCardEffect('望遠「キャンディッドショット」');
    expect(def.steps[0].after).toContainEqual({ type: 'remove_attacker_mirror', count: 1 });
  });

  it('新難題「金閣寺の一枚天井」: designated + horizontal_of_placed', () => {
    const def = getSpellCardEffect('新難題「金閣寺の一枚天井」');
    expect(def.steps[0].after).toContainEqual({ type: 'horizontal_of_placed', count: 1 });
  });

  it('秘術「グレイソーマタージ」: choice_fixed 奇数列 or 偶数列', () => {
    const def = getSpellCardEffect('秘術「グレイソーマタージ」');
    expect(def.steps[0].type).toBe('choice_fixed');
    expect(def.steps[0].options).toEqual([[1, 3, 5], [2, 4, 6]]);
    const result = applyStep(def.steps[0], emptyGrid(), emptyGrid(), 1, 2);
    expect(result.needsChoice).toBe(true);
  });

  it('涷符「マイナスK」: clear_chosen_then_random', () => {
    const def = getSpellCardEffect('涷符「マイナスK」');
    expect(def.steps[0].type).toBe('clear_chosen_then_random');
    expect(def.steps[0].choose).toBe(3);
    expect(def.steps[0].multiplier).toBe(2);
    const result = applyStep(def.steps[0], [1, 0, 1, 0, 1, 0], emptyGrid(), 1, 2);
    expect(result.needsChoice).toBe(true);
  });

  it('彗星「ブレイジングスター」: directional_move_shoot', () => {
    const def = getSpellCardEffect('彗星「ブレイジングスター」');
    expect(def.steps[0].type).toBe('directional_move_shoot');
    expect(def.steps[0].countPerCell).toBe(2);
    const result = applyStep(def.steps[0], emptyGrid(), emptyGrid(), 1, 2);
    expect(result.needsChoice).toBe(true);
  });

  it('銃符「3Dプリンターガン」: roll_check_then_place (2D振り判定)', () => {
    const def = getSpellCardEffect('銃符「3Dプリンターガン」');
    expect(def.steps[0].type).toBe('roll_check_then_place');
    expect(def.steps[0].check).toEqual({ dice: 2, target: 6 });
    expect(def.steps[0].success).toEqual([{ type: 'enemy', count: 3 }]);
    expect(def.steps[0].fail).toEqual([]);
  });

  it('狛符「独り阿吽の呼吸」: duplicate_previous_shot', () => {
    const def = getSpellCardEffect('狛符「独り阿吽の呼吸」');
    expect(def.steps[0].type).toBe('duplicate_previous_shot');
    const result = applyStep(def.steps[0], emptyGrid(), emptyGrid(), 1, 2);
    expect(result.needsChoice).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Group 12: ステップなし (effects のみ / round_start / manual)
// ═══════════════════════════════════════════════════════════════════
describe('スペルカード: ステップなし / 特殊timing', () => {
  it('禁忌「フォーオブアカインド」: timing=round_start, extra_support_cover×3', () => {
    const def = getSpellCardEffect('禁忌「フォーオブアカインド」');
    expect(def.timing).toBe('round_start');
    expect(def.steps).toBeUndefined();
    expect(def.effects).toContainEqual({ type: 'extra_support_cover', count: 3 });
  });

  it('「リザレクション」: timing=on_dodge_fail, cancel_hp_reduction', () => {
    const def = getSpellCardEffect('「リザレクション」');
    expect(def.timing).toBe('on_dodge_fail');
    expect(def.auto).toBe('manual');
    expect(def.effects).toContainEqual({ type: 'cancel_hp_reduction' });
  });

  it('「亡羊のキングダム」: timing=hit_check_end', () => {
    const def = getSpellCardEffect('「亡羊のキングダム」');
    expect(def.timing).toBe('hit_check_end');
    expect(def.auto).toBe('manual');
  });

  it('「アーンギラサヴェーダ」: effects のみ (steps なし)', () => {
    const def = getSpellCardEffect('「アーンギラサヴェーダ」');
    expect(def.steps).toBeUndefined();
    expect(def.effects.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Group 13: 全体検証 - 各カードを analyzeSteps に通して破綻しないこと
// ═══════════════════════════════════════════════════════════════════
describe('SPELL_CARD_EFFECTS: 全カードが analyzeSteps で破綻しない', () => {
  const cardsWithSteps = Object.entries(SPELL_CARD_EFFECTS)
    .filter(([, def]) => Array.isArray(def.steps) && def.steps.length > 0);

  it('steps を持つカードが30枚以上', () => {
    expect(cardsWithSteps.length).toBeGreaterThan(30);
  });

  it.each(cardsWithSteps)('「%s」: analyzeSteps が hasRandom/hasChoice/totalDice を返す', (_name, def) => {
    const result = analyzeSteps(def.steps);
    expect(result).toHaveProperty('hasRandom');
    expect(result).toHaveProperty('hasChoice');
    expect(result).toHaveProperty('totalDice');
    expect(typeof result.totalDice).toBe('number');
  });

  it.each(cardsWithSteps)('「%s」: 各 step.type が isRandom/isChoice/deterministic のいずれか', (_name, def) => {
    for (const step of def.steps) {
      const isR = isRandomStep(step);
      const isC = isChoiceStep(step);
      // ランダム・選択でなければ決定論的型として処理されるはず
      // applyStep に通して needsDice/needsChoice が立つかを検証
      const result = applyStep(step, emptyGrid(), emptyGrid(), 1, 2);
      const isDet = !result.needsDice && !result.needsChoice;
      expect(isR || isC || isDet, `${step.type} がいずれにも分類されない`).toBe(true);
    }
  });
});
