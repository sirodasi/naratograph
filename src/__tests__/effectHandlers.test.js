import { describe, it, expect } from 'vitest';
import {
  GRID_VERTICAL, GRID_HORIZONTAL, GRID_ALL_ADJ,
  emptyGrid, addBullets, removeBullets,
  applyAfterEffect, applyAfterEffects,
  applyStep, applyRandomResult,
  resolveCount, isRandomStep, isChoiceStep, analyzeSteps,
} from '../data/effectHandlers';

// ═══════════════════════════════════════════════════════════════════
// グリッド幾何定数の検証
// ═══════════════════════════════════════════════════════════════════
describe('グリッド幾何定数', () => {
  it('GRID_VERTICAL: 上下の対応が双方向に正しい', () => {
    expect(GRID_VERTICAL[1]).toBe(4);
    expect(GRID_VERTICAL[4]).toBe(1);
    expect(GRID_VERTICAL[2]).toBe(5);
    expect(GRID_VERTICAL[5]).toBe(2);
    expect(GRID_VERTICAL[3]).toBe(6);
    expect(GRID_VERTICAL[6]).toBe(3);
  });

  it('GRID_HORIZONTAL: 左右の隣接が正しい', () => {
    expect(GRID_HORIZONTAL[1]).toEqual([2]);
    expect(GRID_HORIZONTAL[2]).toEqual([1, 3]);
    expect(GRID_HORIZONTAL[3]).toEqual([2]);
    expect(GRID_HORIZONTAL[4]).toEqual([5]);
    expect(GRID_HORIZONTAL[5]).toEqual([4, 6]);
    expect(GRID_HORIZONTAL[6]).toEqual([5]);
  });

  it('GRID_ALL_ADJ: 上下左右の全隣接が正しい', () => {
    expect(GRID_ALL_ADJ[1].sort()).toEqual([2, 4]);
    expect(GRID_ALL_ADJ[2].sort()).toEqual([1, 3, 5]);
    expect(GRID_ALL_ADJ[3].sort()).toEqual([2, 6]);
    expect(GRID_ALL_ADJ[4].sort()).toEqual([1, 5]);
    expect(GRID_ALL_ADJ[5].sort()).toEqual([2, 4, 6]);
    expect(GRID_ALL_ADJ[6].sort()).toEqual([3, 5]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 基本操作
// ═══════════════════════════════════════════════════════════════════
describe('emptyGrid', () => {
  it('6要素の全ゼロ配列を返す', () => {
    expect(emptyGrid()).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('呼び出しごとに独立した配列を返す', () => {
    const a = emptyGrid();
    const b = emptyGrid();
    a[0] = 5;
    expect(b[0]).toBe(0);
  });
});

describe('addBullets', () => {
  it('指定セルに弾幕を追加する', () => {
    expect(addBullets([0,0,0,0,0,0], [3], 2)).toEqual([0,0,2,0,0,0]);
  });

  it('複数セルに同時追加できる', () => {
    expect(addBullets([0,0,0,0,0,0], [1,3,5], 1)).toEqual([1,0,1,0,1,0]);
  });

  it('既存の弾幕に加算する', () => {
    expect(addBullets([2,0,0,0,0,0], [1], 3)).toEqual([5,0,0,0,0,0]);
  });

  it('元の配列を変更しない（immutable）', () => {
    const orig = [1,2,3,4,5,6];
    addBullets(orig, [1], 10);
    expect(orig[0]).toBe(1);
  });

  it('範囲外セル番号は無視する', () => {
    expect(addBullets([0,0,0,0,0,0], [0, 7], 1)).toEqual([0,0,0,0,0,0]);
  });
});

describe('removeBullets', () => {
  it('指定セルから弾幕を除去する', () => {
    expect(removeBullets([3,0,0,0,0,0], [1], 2)).toEqual([1,0,0,0,0,0]);
  });

  it('0未満にはならない', () => {
    expect(removeBullets([1,0,0,0,0,0], [1], 5)).toEqual([0,0,0,0,0,0]);
  });

  it('元の配列を変更しない（immutable）', () => {
    const orig = [5,5,5,5,5,5];
    removeBullets(orig, [1], 3);
    expect(orig[0]).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// アフターエフェクト
// ═══════════════════════════════════════════════════════════════════
describe('applyAfterEffect: vertical_of_placed', () => {
  it('配置セルの上下隣接セルに弾幕を追加する', () => {
    // セル2に配置→垂直隣接はセル5
    const { defGrid } = applyAfterEffect(
      { type: "vertical_of_placed", count: 2 },
      [0,0,0,0,0,0], [0,0,0,0,0,0], [2]
    );
    expect(defGrid[4]).toBe(2); // セル5 (index 4)
  });

  it('セル4の上下隣接はセル1', () => {
    const { defGrid } = applyAfterEffect(
      { type: "vertical_of_placed", count: 1 },
      [0,0,0,0,0,0], [0,0,0,0,0,0], [4]
    );
    expect(defGrid[0]).toBe(1); // セル1
  });

  it('複数配置セルの全垂直隣接に追加', () => {
    // セル1(→4)とセル3(→6)に配置済み
    const { defGrid } = applyAfterEffect(
      { type: "vertical_of_placed", count: 1 },
      [0,0,0,0,0,0], [0,0,0,0,0,0], [1, 3]
    );
    expect(defGrid[3]).toBe(1); // セル4
    expect(defGrid[5]).toBe(1); // セル6
  });
});

describe('applyAfterEffect: horizontal_of_placed', () => {
  it('セル2の左右隣接（1と3）に追加', () => {
    const { defGrid } = applyAfterEffect(
      { type: "horizontal_of_placed", count: 1 },
      [0,0,0,0,0,0], [0,0,0,0,0,0], [2]
    );
    expect(defGrid[0]).toBe(1); // セル1
    expect(defGrid[2]).toBe(1); // セル3
    expect(defGrid[1]).toBe(0); // セル2 自体は変わらない
  });

  it('セル1の左右隣接はセル2のみ', () => {
    const { defGrid } = applyAfterEffect(
      { type: "horizontal_of_placed", count: 1 },
      [0,0,0,0,0,0], [0,0,0,0,0,0], [1]
    );
    expect(defGrid[1]).toBe(1); // セル2
    expect(defGrid[3]).toBe(0); // セル4は垂直なので対象外
  });
});

describe('applyAfterEffect: all_neighbors_of_placed', () => {
  it('セル5の全隣接（2,4,6）に追加', () => {
    const { defGrid } = applyAfterEffect(
      { type: "all_neighbors_of_placed", count: 1 },
      [0,0,0,0,0,0], [0,0,0,0,0,0], [5]
    );
    expect(defGrid[1]).toBe(1); // セル2
    expect(defGrid[3]).toBe(1); // セル4
    expect(defGrid[5]).toBe(1); // セル6
    expect(defGrid[4]).toBe(0); // セル5 自体は変わらない
  });
});

describe('applyAfterEffect: double_each_placed / add_to_placed', () => {
  it('double_each_placed: 配置セルに+count', () => {
    const { defGrid } = applyAfterEffect(
      { type: "double_each_placed", count: 1 },
      [0,0,0,0,0,0], [0,0,0,0,0,0], [1, 3]
    );
    expect(defGrid[0]).toBe(1);
    expect(defGrid[2]).toBe(1);
  });

  it('add_to_placed: double_each_placed と同じ動作', () => {
    const { defGrid } = applyAfterEffect(
      { type: "add_to_placed", count: 3 },
      [1,0,0,0,0,0], [0,0,0,0,0,0], [1]
    );
    expect(defGrid[0]).toBe(4); // 既存1 + 追加3
  });
});

describe('applyAfterEffect: remove_attacker_mirror', () => {
  it('配置セルと同番号の攻撃側グリッドから除去', () => {
    const { defGrid, atkGrid } = applyAfterEffect(
      { type: "remove_attacker_mirror", count: 1 },
      [0,0,0,0,0,0], [2,0,2,0,0,0], [1, 3]
    );
    expect(atkGrid[0]).toBe(1); // セル1: 2→1
    expect(atkGrid[2]).toBe(1); // セル3: 2→1
    expect(defGrid).toEqual([0,0,0,0,0,0]); // defGrid は変わらない
  });
});

describe('applyAfterEffects: リスト適用', () => {
  it('複数アフターエフェクトを順番に適用する', () => {
    const afterList = [
      { type: "vertical_of_placed", count: 1 },
      { type: "add_to_placed", count: 1 },
    ];
    const { defGrid } = applyAfterEffects(afterList, emptyGrid(), emptyGrid(), [2]);
    expect(defGrid[4]).toBe(1); // セル5 (vertical of 2)
    expect(defGrid[1]).toBe(1); // セル2 (add_to_placed)
  });
});

// ═══════════════════════════════════════════════════════════════════
// applyStep: 決定論的ステップ
// ═══════════════════════════════════════════════════════════════════
describe('applyStep: self', () => {
  it('攻撃側の現在位置に弾幕を配置する', () => {
    const { defGrid, placedCells } = applyStep(
      { type: "self", count: 2 },
      emptyGrid(), emptyGrid(), 3, 5
    );
    expect(defGrid[2]).toBe(2); // セル3
    expect(placedCells).toEqual([3]);
  });

  it('after: vertical_of_placed も適用される', () => {
    const { defGrid } = applyStep(
      { type: "self", count: 1, after: [{ type: "vertical_of_placed", count: 2 }] },
      emptyGrid(), emptyGrid(), 1, 5
    );
    expect(defGrid[0]).toBe(1); // セル1 (self)
    expect(defGrid[3]).toBe(2); // セル4 (vertical of 1)
  });
});

describe('applyStep: enemy', () => {
  it('回避側の現在位置に弾幕を配置する', () => {
    const { defGrid, placedCells } = applyStep(
      { type: "enemy", count: 1 },
      emptyGrid(), emptyGrid(), 2, 6
    );
    expect(defGrid[5]).toBe(1); // セル6
    expect(placedCells).toEqual([6]);
  });

  it('after: horizontal_of_placed も適用される', () => {
    const { defGrid } = applyStep(
      { type: "enemy", count: 1, after: [{ type: "horizontal_of_placed", count: 1 }] },
      emptyGrid(), emptyGrid(), 2, 5
    );
    expect(defGrid[4]).toBe(1); // セル5 (enemy)
    expect(defGrid[3]).toBe(1); // セル4 (horizontal of 5)
    expect(defGrid[5]).toBe(1); // セル6 (horizontal of 5)
  });
});

describe('applyStep: adjacent_enemy', () => {
  it('回避側のいるマスに隣接する全マスに配置する', () => {
    // defPos=2 の隣接: 1,3,5
    const { defGrid, placedCells } = applyStep(
      { type: "adjacent_enemy", count: 1 },
      emptyGrid(), emptyGrid(), 4, 2
    );
    expect(defGrid[0]).toBe(1); // セル1
    expect(defGrid[2]).toBe(1); // セル3
    expect(defGrid[4]).toBe(1); // セル5
    expect(defGrid[1]).toBe(0); // セル2 自体は0
    expect(placedCells.sort()).toEqual([1, 3, 5]);
  });

  it('回避側がセル5のとき隣接は2,4,6', () => {
    const { defGrid } = applyStep(
      { type: "adjacent_enemy", count: 2 },
      emptyGrid(), emptyGrid(), 1, 5
    );
    expect(defGrid[1]).toBe(2); // セル2
    expect(defGrid[3]).toBe(2); // セル4
    expect(defGrid[5]).toBe(2); // セル6
    expect(defGrid[4]).toBe(0); // セル5 自体は0
  });

  it('角マス（セル1）のとき隣接は2,4のみ', () => {
    const { defGrid } = applyStep(
      { type: "adjacent_enemy", count: 1 },
      emptyGrid(), emptyGrid(), 3, 1
    );
    expect(defGrid[1]).toBe(1); // セル2
    expect(defGrid[3]).toBe(1); // セル4
    expect(defGrid[0]).toBe(0); // セル1 自体は0
    expect(defGrid[2]).toBe(0);
    expect(defGrid[4]).toBe(0);
    expect(defGrid[5]).toBe(0);
  });
});

describe('applyStep: fixed_cells', () => {
  it('指定セルに弾幕を配置する', () => {
    const { defGrid } = applyStep(
      { type: "fixed_cells", cells: [1, 3, 4, 6], count: 1 },
      emptyGrid(), emptyGrid(), 2, 5
    );
    expect(defGrid[0]).toBe(1);
    expect(defGrid[2]).toBe(1);
    expect(defGrid[3]).toBe(1);
    expect(defGrid[5]).toBe(1);
    expect(defGrid[1]).toBe(0);
    expect(defGrid[4]).toBe(0);
  });

  it('cells に重複がある場合は重複分だけ追加', () => {
    // [2,2,5,5] → セル2に×2、セル5に×2
    const { defGrid } = applyStep(
      { type: "fixed_cells", cells: [2, 2, 5, 5], count: 1 },
      emptyGrid(), emptyGrid(), 1, 3
    );
    expect(defGrid[1]).toBe(2); // セル2
    expect(defGrid[4]).toBe(2); // セル5
  });
});

describe('applyStep: mirrored_adj_self', () => {
  it('攻撃側位置の上下左右隣接に配置（defPos は無関係）', () => {
    // atkPos=2 の隣接: 1,3,5
    const { defGrid } = applyStep(
      { type: "mirrored_adj_self", count: 1 },
      emptyGrid(), emptyGrid(), 2, 6
    );
    expect(defGrid[0]).toBe(1); // セル1
    expect(defGrid[2]).toBe(1); // セル3
    expect(defGrid[4]).toBe(1); // セル5
    expect(defGrid[1]).toBe(0); // セル2 自体は0
  });
});

describe('applyStep: fill_empty_cells', () => {
  it('弾幕が0のマス全てに配置する', () => {
    const defGrid = [1, 0, 2, 0, 0, 3];
    const { defGrid: result, placedCells } = applyStep(
      { type: "fill_empty_cells", count: 1 },
      defGrid, emptyGrid(), 1, 2
    );
    expect(result[1]).toBe(1); // セル2: 0→1
    expect(result[3]).toBe(1); // セル4: 0→1
    expect(result[4]).toBe(1); // セル5: 0→1
    expect(result[0]).toBe(1); // セル1: 変わらず
    expect(result[2]).toBe(2); // セル3: 変わらず
    expect(result[5]).toBe(3); // セル6: 変わらず
    expect(placedCells.sort()).toEqual([2, 4, 5]);
  });

  it('全マスが埋まっている場合は何もしない', () => {
    const defGrid = [1, 2, 1, 3, 1, 2];
    const { defGrid: result, placedCells } = applyStep(
      { type: "fill_empty_cells", count: 1 },
      defGrid, emptyGrid(), 1, 2
    );
    expect(result).toEqual(defGrid);
    expect(placedCells).toEqual([]);
  });
});

describe('applyStep: move_all_vertical', () => {
  it('全弾幕を上下隣接マスへ移動する', () => {
    // セル1(→4), セル3(→6), セル4(→1)
    const defGrid = [2, 0, 1, 3, 0, 0];
    const { defGrid: result } = applyStep(
      { type: "move_all_vertical" },
      defGrid, emptyGrid(), 1, 2
    );
    expect(result[0]).toBe(3); // セル1: セル4から来た3
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(0);
    expect(result[3]).toBe(2); // セル4: セル1から来た2
    expect(result[4]).toBe(0);
    expect(result[5]).toBe(1); // セル6: セル3から来た1
  });

  it('同じセルへの移動が重なる場合は加算される', () => {
    // セル2(→5)とセル5(→2)が互いに移動
    const defGrid = [0, 3, 0, 0, 2, 0];
    const { defGrid: result } = applyStep(
      { type: "move_all_vertical" },
      defGrid, emptyGrid(), 1, 1
    );
    expect(result[1]).toBe(2); // セル2: セル5から来た2
    expect(result[4]).toBe(3); // セル5: セル2から来た3
  });
});

describe('applyStep: shift_cells_up1', () => {
  it('全弾幕を1番号大きいマスへ移動（6→1へラップ）', () => {
    const defGrid = [1, 0, 2, 0, 0, 3];
    const { defGrid: result } = applyStep(
      { type: "shift_cells_up1" },
      defGrid, emptyGrid(), 1, 1
    );
    expect(result[0]).toBe(3); // セル1: セル6から来た3
    expect(result[1]).toBe(1); // セル2: セル1から来た1
    expect(result[2]).toBe(0);
    expect(result[3]).toBe(2); // セル4: セル3から来た2
    expect(result[4]).toBe(0);
    expect(result[5]).toBe(0);
  });
});

describe('applyStep: mirror_bullet_counts', () => {
  it('1個→3個、3個以上→1個に変換', () => {
    const defGrid = [1, 0, 3, 5, 1, 2];
    const { defGrid: result } = applyStep(
      { type: "mirror_bullet_counts" },
      defGrid, emptyGrid(), 1, 1
    );
    expect(result[0]).toBe(3); // 1→3
    expect(result[1]).toBe(0); // 0→変わらず
    expect(result[2]).toBe(1); // 3→1
    expect(result[3]).toBe(1); // 5→1
    expect(result[4]).toBe(3); // 1→3
    expect(result[5]).toBe(2); // 2→変わらず（1でも3以上でもない）
  });
});

describe('applyStep: double_single_bullets', () => {
  it('弾幕が1個だけのマスに+1する', () => {
    const defGrid = [1, 0, 3, 1, 2, 1];
    const { defGrid: result } = applyStep(
      { type: "double_single_bullets" },
      defGrid, emptyGrid(), 1, 1
    );
    expect(result[0]).toBe(2); // 1→2
    expect(result[1]).toBe(0); // 0→変わらず
    expect(result[2]).toBe(3); // 3→変わらず
    expect(result[3]).toBe(2); // 1→2
    expect(result[4]).toBe(2); // 2→変わらず
    expect(result[5]).toBe(2); // 1→2
  });
});

describe('applyStep: enemy_cross_h', () => {
  it('回避側の左右隣接 + それらの上下隣接に配置', () => {
    // defPos=2: 左右隣接=[1,3], 1の上下=4, 3の上下=6
    const { defGrid, placedCells } = applyStep(
      { type: "enemy_cross_h", count: 1 },
      emptyGrid(), emptyGrid(), 5, 2
    );
    expect(defGrid[0]).toBe(1); // セル1
    expect(defGrid[2]).toBe(1); // セル3
    expect(defGrid[3]).toBe(1); // セル4 (vertical of 1)
    expect(defGrid[5]).toBe(1); // セル6 (vertical of 3)
    expect(defGrid[1]).toBe(0); // セル2 自体は0
    expect(placedCells.sort()).toEqual([1, 3, 4, 6]);
  });

  it('端のセル（セル1）は左右隣接がセル2のみ', () => {
    const { defGrid } = applyStep(
      { type: "enemy_cross_h", count: 1 },
      emptyGrid(), emptyGrid(), 3, 1
    );
    expect(defGrid[1]).toBe(1); // セル2 (horizontal of 1)
    expect(defGrid[4]).toBe(1); // セル5 (vertical of 2)
    expect(defGrid[0]).toBe(0); // セル1 自体は0
  });
});

describe('applyStep: non_adjacent_to_mirrored', () => {
  it('atkPos の上下左右隣接以外の全マスに配置', () => {
    // atkPos=2: excluded=[2,1,3,5], non-adjacent=[4,6]
    const { defGrid, placedCells } = applyStep(
      { type: "non_adjacent_to_mirrored", count: 1 },
      emptyGrid(), emptyGrid(), 2, 5
    );
    expect(defGrid[3]).toBe(1); // セル4
    expect(defGrid[5]).toBe(1); // セル6
    expect(defGrid[0]).toBe(0); // セル1 (隣接なので除外)
    expect(defGrid[1]).toBe(0); // セル2 自体は除外
    expect(defGrid[2]).toBe(0); // セル3 (隣接なので除外)
    expect(defGrid[4]).toBe(0); // セル5 (隣接なので除外)
    expect(placedCells.sort()).toEqual([4, 6]);
  });
});

describe('applyStep: self_if_same_cell', () => {
  it('攻守が同じマスのとき配置する', () => {
    const { defGrid, placedCells } = applyStep(
      { type: "self_if_same_cell", count: 1 },
      emptyGrid(), emptyGrid(), 3, 3
    );
    expect(defGrid[2]).toBe(1);
    expect(placedCells).toEqual([3]);
  });

  it('攻守が異なるマスのとき配置しない', () => {
    const { defGrid, placedCells } = applyStep(
      { type: "self_if_same_cell", count: 1 },
      emptyGrid(), emptyGrid(), 3, 4
    );
    expect(defGrid).toEqual(emptyGrid());
    expect(placedCells).toEqual([]);
  });
});

describe('applyStep: clear_enemy_cell', () => {
  it('回避側のいるセルの弾幕を全て除去する', () => {
    const defGrid = [0, 3, 0, 0, 0, 0];
    const { defGrid: result } = applyStep(
      { type: "clear_enemy_cell" },
      defGrid, emptyGrid(), 1, 2
    );
    expect(result[1]).toBe(0); // セル2: 3→0
    expect(result).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe('applyStep: clear_enemy_adj_then_enemy', () => {
  it('敵機隣接マスの弾幕を除去→除去数分を敵機マスに配置', () => {
    // defPos=5: 隣接=[2,4,6], 弾幕=[0,2,0,3,0,1]
    const defGrid = [0, 2, 0, 3, 0, 1];
    const { defGrid: result, placedCells } = applyStep(
      { type: "clear_enemy_adj_then_enemy" },
      defGrid, emptyGrid(), 1, 5
    );
    expect(result[1]).toBe(0); // セル2: 除去
    expect(result[3]).toBe(0); // セル4: 除去
    expect(result[5]).toBe(0); // セル6: 除去
    expect(result[4]).toBe(6); // セル5: 除去した2+3+1=6
    expect(placedCells).toEqual([5]);
  });

  it('max が指定された場合は除去数を制限する', () => {
    // defPos=2: 隣接=[1,3,5], セル1=3, セル3=3, max=2
    const defGrid = [3, 0, 3, 0, 0, 0];
    const { defGrid: result } = applyStep(
      { type: "clear_enemy_adj_then_enemy", max: 2 },
      defGrid, emptyGrid(), 4, 2
    );
    // セル1から2つ除去（max=2）、セル3はそのまま
    expect(result[2]).toBe(3); // セル3は変わらず
    expect(result[0]).toBe(1); // セル1: 3→1
    expect(result[1]).toBe(2); // セル2: 0+2=2
  });
});

// ═══════════════════════════════════════════════════════════════════
// applyStep: ダイス必要ステップ
// ═══════════════════════════════════════════════════════════════════
describe('applyStep: random → needsDice', () => {
  it('needsDice=true と diceCount を返す', () => {
    const result = applyStep({ type: "random", count: 4 }, emptyGrid(), emptyGrid(), 1, 2);
    expect(result.needsDice).toBe(true);
    expect(result.diceCount).toBe(4);
    expect(result.placedCells).toEqual([]);
  });

  it('after リストを afterList として返す', () => {
    const after = [{ type: "vertical_of_placed", count: 1 }];
    const result = applyStep(
      { type: "random", count: 2, after },
      emptyGrid(), emptyGrid(), 1, 2
    );
    expect(result.afterList).toEqual(after);
  });
});

describe('applyStep: clear_all_then_random', () => {
  it('全弾幕を除去してから needsDice を返す（除去数×multiplier がダイス数）', () => {
    const defGrid = [1, 2, 0, 1, 0, 0]; // 合計 4
    const result = applyStep(
      { type: "clear_all_then_random", multiplier: 2 },
      defGrid, emptyGrid(), 1, 2
    );
    expect(result.needsDice).toBe(true);
    expect(result.diceCount).toBe(8); // 4 × 2
    expect(result.defGrid).toEqual(emptyGrid()); // 全除去後
  });

  it('step.count 指定時はそれをダイス数として使用', () => {
    const defGrid = [3, 3, 0, 0, 0, 0]; // 合計 6
    const result = applyStep(
      { type: "clear_all_then_random", multiplier: 1, count: 6 },
      defGrid, emptyGrid(), 1, 2
    );
    expect(result.diceCount).toBe(6); // countが優先
  });
});

describe('applyStep: clear_enemy_adj_then_random', () => {
  it('敵機隣接の弾幕を除去して needsDice を返す', () => {
    // defPos=2: 隣接=[1,3,5], 合計弾幕=5
    const defGrid = [2, 0, 1, 0, 2, 0];
    const result = applyStep(
      { type: "clear_enemy_adj_then_random", multiplier: 2 },
      defGrid, emptyGrid(), 4, 2
    );
    expect(result.needsDice).toBe(true);
    expect(result.diceCount).toBe(10); // 5 × 2
    expect(result.defGrid[0]).toBe(0); // セル1除去
    expect(result.defGrid[2]).toBe(0); // セル3除去
    expect(result.defGrid[4]).toBe(0); // セル5除去
  });
});

// ═══════════════════════════════════════════════════════════════════
// applyStep: 選択ステップ
// ═══════════════════════════════════════════════════════════════════
describe('applyStep: 選択ステップ → needsChoice', () => {
  it.each(["designated", "choice_fixed", "clear_chosen_then_random"])(
    '%s は needsChoice=true を返す', (type) => {
      const result = applyStep({ type }, emptyGrid(), emptyGrid(), 1, 2);
      expect(result.needsChoice).toBe(true);
      expect(result.choiceType).toBe(type);
    }
  );
});

// ═══════════════════════════════════════════════════════════════════
// applyRandomResult
// ═══════════════════════════════════════════════════════════════════
describe('applyRandomResult: 通常ランダム', () => {
  it('ダイス結果のセルに1ずつ追加する', () => {
    const { defGrid, placedCells } = applyRandomResult(
      emptyGrid(), [1, 3, 3, 6]
    );
    expect(defGrid[0]).toBe(1);  // セル1: 1回
    expect(defGrid[2]).toBe(2);  // セル3: 2回
    expect(defGrid[5]).toBe(1);  // セル6: 1回
    expect(placedCells).toEqual([1, 3, 3, 6]);
  });

  it('既存の弾幕に加算される', () => {
    const { defGrid } = applyRandomResult([2, 0, 0, 0, 0, 0], [1, 1]);
    expect(defGrid[0]).toBe(4); // 既存2 + 2回
  });

  it('afterList を適用する', () => {
    const after = [{ type: "vertical_of_placed", count: 1 }];
    const { defGrid } = applyRandomResult(emptyGrid(), [2], { afterList: after });
    expect(defGrid[1]).toBe(1); // セル2: ランダム配置
    expect(defGrid[4]).toBe(1); // セル5: vertical of 2
  });
});

describe('applyRandomResult: exclude_fill', () => {
  it('出た目のセル以外に fillCount ずつ配置する', () => {
    // ダイス=[2,5] → 2と5以外に配置: [1,3,4,6]
    const { defGrid } = applyRandomResult(emptyGrid(), [2, 5], {
      specialType: "exclude_fill", fillCount: 1,
    });
    expect(defGrid[0]).toBe(1); // セル1
    expect(defGrid[1]).toBe(0); // セル2: 除外
    expect(defGrid[2]).toBe(1); // セル3
    expect(defGrid[3]).toBe(1); // セル4
    expect(defGrid[4]).toBe(0); // セル5: 除外
    expect(defGrid[5]).toBe(1); // セル6
  });
});

describe('applyRandomResult: clear_then_double', () => {
  it('各ダイス目のセルを2個に置き直す', () => {
    const startGrid = [3, 0, 0, 0, 5, 0];
    const { defGrid } = applyRandomResult(startGrid, [1, 5], {
      specialType: "clear_then_double",
    });
    expect(defGrid[0]).toBe(2); // セル1: 3→2
    expect(defGrid[4]).toBe(2); // セル5: 5→2
  });
});

describe('applyRandomResult: clear_neighbors', () => {
  it('各ダイス目のセルを除去→その全隣接に+1', () => {
    // ダイス=[2]: セル2除去→隣接(1,3,5)に+1
    const startGrid = [0, 3, 0, 0, 0, 0];
    const { defGrid } = applyRandomResult(startGrid, [2], {
      specialType: "clear_neighbors",
    });
    expect(defGrid[1]).toBe(0); // セル2: 除去
    expect(defGrid[0]).toBe(1); // セル1: +1
    expect(defGrid[2]).toBe(1); // セル3: +1
    expect(defGrid[4]).toBe(1); // セル5: +1
  });
});

// ═══════════════════════════════════════════════════════════════════
// resolveCount
// ═══════════════════════════════════════════════════════════════════
describe('resolveCount', () => {
  it('数値はそのまま返す', () => {
    expect(resolveCount(3)).toBe(3);
    expect(resolveCount(0)).toBe(0);
  });

  it('null/undefined は 1 を返す', () => {
    expect(resolveCount(null)).toBe(1);
    expect(resolveCount(undefined)).toBe(1);
  });

  it('stat-based count はエンティティの resources から計算', () => {
    const entity = { resources: { 攻撃力: { cur: 4 } } };
    expect(resolveCount({ type: "stat", stat: "攻撃力" }, entity)).toBe(4);
    expect(resolveCount({ type: "stat", stat: "攻撃力", multiplier: 2 }, entity)).toBe(8);
  });

  it('stat が存在しない場合は 0 を返す', () => {
    expect(resolveCount({ type: "stat", stat: "存在しない" }, {})).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// isRandomStep / isChoiceStep / analyzeSteps
// ═══════════════════════════════════════════════════════════════════
describe('isRandomStep', () => {
  it.each(["random", "clear_all_then_random", "clear_enemy_adj_then_random"])(
    '"%s" はランダムステップ', (type) => {
      expect(isRandomStep({ type })).toBe(true);
    }
  );

  it.each(["self", "enemy", "fixed_cells", "adjacent_enemy", "fill_empty_cells"])(
    '"%s" はランダムでない', (type) => {
      expect(isRandomStep({ type })).toBe(false);
    }
  );
});

describe('isChoiceStep', () => {
  it.each(["designated", "choice_fixed", "clear_chosen_then_random"])(
    '"%s" は選択ステップ', (type) => {
      expect(isChoiceStep({ type })).toBe(true);
    }
  );

  it.each(["self", "enemy", "random", "adjacent_enemy"])(
    '"%s" は選択でない', (type) => {
      expect(isChoiceStep({ type })).toBe(false);
    }
  );
});

describe('analyzeSteps', () => {
  it('全deterministic のカードは hasRandom=false, hasChoice=false', () => {
    const steps = [{ type: "self", count: 1 }, { type: "enemy", count: 1 }];
    const { hasRandom, hasChoice } = analyzeSteps(steps);
    expect(hasRandom).toBe(false);
    expect(hasChoice).toBe(false);
  });

  it('randomを含む場合は hasRandom=true', () => {
    const { hasRandom } = analyzeSteps([{ type: "random", count: 4 }]);
    expect(hasRandom).toBe(true);
  });

  it('designatedを含む場合は hasChoice=true', () => {
    const { hasChoice } = analyzeSteps([{ type: "designated", count: 2 }]);
    expect(hasChoice).toBe(true);
  });

  it('totalDice はランダムステップの count の合計', () => {
    const steps = [
      { type: "random", count: 3 },
      { type: "random", count: 2 },
    ];
    const { totalDice } = analyzeSteps(steps);
    expect(totalDice).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 統合テスト: 実際のスペルカード効果
// ═══════════════════════════════════════════════════════════════════
describe('統合テスト: 恋符「マスタースパーク」 (self + vertical)', () => {
  it('自機マスに×1 → 垂直隣接マスに×2', () => {
    // atkPos=2 (→垂直はセル5): self+1, 次にvertical_of_placed(セル5に+2)
    const { defGrid } = applyStep(
      { type: "self", count: 1, after: [{ type: "vertical_of_placed", count: 2 }] },
      emptyGrid(), emptyGrid(), 2, 5
    );
    expect(defGrid[1]).toBe(1); // セル2 (self)
    expect(defGrid[4]).toBe(2); // セル5 (vertical of 2)
  });
});

describe('統合テスト: 視符「ナズーリンペンデュラム」 (random×3 + remove_attacker_mirror)', () => {
  it('ダイス結果適用後、配置セルと同番号の攻撃側グリッドから-1', () => {
    // ダイス=[1,1,3]: defGrid に配置 → atkGrid のセル1,3 から除去
    const atkGrid = [2, 0, 2, 0, 0, 0];
    const after = [{ type: "remove_attacker_mirror", count: 1 }];
    const { defGrid: afterDef, placedCells } = applyRandomResult(
      emptyGrid(), [1, 1, 3], { afterList: [] }
    );
    // after-effect は applyAfterEffects で別途適用
    const { atkGrid: finalAtk } = applyAfterEffects(after, afterDef, atkGrid, placedCells);
    expect(afterDef[0]).toBe(2); // セル1: 2回配置
    expect(afterDef[2]).toBe(1); // セル3: 1回配置
    expect(finalAtk[0]).toBe(1); // 攻撃側セル1: 2→1
    expect(finalAtk[2]).toBe(1); // 攻撃側セル3: 2→1
  });
});

describe('統合テスト: 逆符「天地有用」 (move_all_vertical)', () => {
  it('上段は下段へ、下段は上段へ移動する', () => {
    const defGrid = [1, 0, 2, 3, 0, 1]; // 1→4, 3→6, 4→1, 6→3
    const { defGrid: result } = applyStep(
      { type: "move_all_vertical" },
      defGrid, emptyGrid(), 1, 1
    );
    expect(result[0]).toBe(3); // セル1: セル4から来た
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(1); // セル3: セル6から来た
    expect(result[3]).toBe(1); // セル4: セル1から来た
    expect(result[4]).toBe(0);
    expect(result[5]).toBe(2); // セル6: セル3から来た
  });
});

// ═══════════════════════════════════════════════════════════════════
// applyStep: 未テストのダイス必要ステップ
// ═══════════════════════════════════════════════════════════════════
describe('applyStep: clear_mirrored_adj_then_random', () => {
  it('自機と同番号の回避側マスの隣接弾幕を除去して needsDice を返す', () => {
    // atkPos=2: mirrored_adj=[1,3,5], セル1=2, セル3=1, セル5=3 → cleared=6
    const defGrid = [2, 0, 1, 0, 3, 0];
    const result = applyStep(
      { type: "clear_mirrored_adj_then_random", multiplier: 1 },
      defGrid, emptyGrid(), 2, 6
    );
    expect(result.needsDice).toBe(true);
    expect(result.diceCount).toBe(6); // 2+1+3=6 × multiplier=1
    expect(result.defGrid[0]).toBe(0); // セル1除去
    expect(result.defGrid[2]).toBe(0); // セル3除去
    expect(result.defGrid[4]).toBe(0); // セル5除去
  });

  it('multiplier が適用される', () => {
    // atkPos=3: mirrored_adj=[2,6], セル2=1, セル6=2 → cleared=3
    const defGrid = [0, 1, 0, 0, 0, 2];
    const result = applyStep(
      { type: "clear_mirrored_adj_then_random", multiplier: 3 },
      defGrid, emptyGrid(), 3, 4
    );
    expect(result.needsDice).toBe(true);
    expect(result.diceCount).toBe(9); // 3 × 3
  });
});

describe('applyStep: random_2d_exclude_then_fill', () => {
  it('needsDice=true, diceCount=2, specialType=exclude_fill を返す', () => {
    const result = applyStep(
      { type: "random_2d_exclude_then_fill", count: 2 },
      emptyGrid(), emptyGrid(), 1, 3
    );
    expect(result.needsDice).toBe(true);
    expect(result.diceCount).toBe(2);
    expect(result.specialType).toBe("exclude_fill");
    expect(result.fillCount).toBe(2);
  });
});

describe('applyStep: random_clear_then_double', () => {
  it('needsDice=true, count 分のダイス, specialType=clear_then_double を返す', () => {
    const result = applyStep(
      { type: "random_clear_then_double", count: 3 },
      emptyGrid(), emptyGrid(), 1, 2
    );
    expect(result.needsDice).toBe(true);
    expect(result.diceCount).toBe(3);
    expect(result.specialType).toBe("clear_then_double");
  });
});

describe('applyStep: random_3d_clear_then_all_neighbors', () => {
  it('needsDice=true, diceCount=3, specialType=clear_neighbors を返す', () => {
    const result = applyStep(
      { type: "random_3d_clear_then_all_neighbors" },
      emptyGrid(), emptyGrid(), 1, 4
    );
    expect(result.needsDice).toBe(true);
    expect(result.diceCount).toBe(3);
    expect(result.specialType).toBe("clear_neighbors");
  });
});

// ═══════════════════════════════════════════════════════════════════
// applyStep: 選択ステップ（未テスト分）
// ═══════════════════════════════════════════════════════════════════
describe('applyStep: directional_move_shoot / roll_check_then_place / duplicate_previous_shot', () => {
  it.each(["directional_move_shoot", "roll_check_then_place", "duplicate_previous_shot"])(
    '%s は needsChoice=true を返す', (type) => {
      const result = applyStep({ type }, emptyGrid(), emptyGrid(), 2, 4);
      expect(result.needsChoice).toBe(true);
      expect(result.choiceType).toBe(type);
    }
  );
});

// ═══════════════════════════════════════════════════════════════════
// isRandomStep / isChoiceStep: 全タイプ網羅
// ═══════════════════════════════════════════════════════════════════
describe('isRandomStep: 全ランダムタイプ', () => {
  it.each([
    "random",
    "clear_all_then_random",
    "clear_enemy_adj_then_random",
    "clear_mirrored_adj_then_random",
    "random_2d_exclude_then_fill",
    "random_clear_then_double",
    "random_3d_clear_then_all_neighbors",
  ])('"%s" はランダムステップ', (type) => {
    expect(isRandomStep({ type })).toBe(true);
  });

  it.each(["self", "enemy", "designated", "duplicate_previous_shot"])(
    '"%s" はランダムでない', (type) => {
      expect(isRandomStep({ type })).toBe(false);
    }
  );
});

describe('isChoiceStep: 全選択タイプ', () => {
  it.each([
    "designated",
    "choice_fixed",
    "clear_chosen_then_random",
    "directional_move_shoot",
    "roll_check_then_place",
    "duplicate_previous_shot",
  ])('"%s" は選択ステップ', (type) => {
    expect(isChoiceStep({ type })).toBe(true);
  });

  it.each(["self", "enemy", "random", "move_all_vertical"])(
    '"%s" は選択でない', (type) => {
      expect(isChoiceStep({ type })).toBe(false);
    }
  );
});

describe('analyzeSteps: stat-based count は totalDice に加算しない', () => {
  it('stat-based count の random ステップは hasRandom=true だが totalDice には反映されない', () => {
    const steps = [{ type: "random", count: { type: "stat", stat: "グレイズ", multiplier: 2 } }];
    const { hasRandom, hasChoice, totalDice } = analyzeSteps(steps);
    expect(hasRandom).toBe(true);
    expect(hasChoice).toBe(false);
    expect(totalDice).toBe(0); // object count はスキップ
  });
});

// ═══════════════════════════════════════════════════════════════════
// applyStep: stat-based count のデフォルト値
// ═══════════════════════════════════════════════════════════════════
describe('applyStep: count がオブジェクトのとき rawCount=1 として扱う', () => {
  it('stat-based count の self ステップは×1 として配置する', () => {
    const { defGrid, placedCells } = applyStep(
      { type: "self", count: { type: "stat", stat: "グレイズ", multiplier: 2 } },
      emptyGrid(), emptyGrid(), 3, 5
    );
    expect(defGrid[2]).toBe(1); // セル3に×1（rawCount=1）
    expect(placedCells).toEqual([3]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 統合テスト: 実際のスペルカード効果（未カバー）
// ═══════════════════════════════════════════════════════════════════
describe('統合テスト: 夢符「封魔陣」 (fill_empty_cells)', () => {
  it('弾幕なしのマス全てに×1配置', () => {
    const defGrid = [2, 0, 0, 1, 0, 3];
    const { defGrid: result, placedCells } = applyStep(
      { type: "fill_empty_cells", count: 1 },
      defGrid, emptyGrid(), 2, 4
    );
    expect(result[1]).toBe(1); // セル2
    expect(result[2]).toBe(1); // セル3
    expect(result[4]).toBe(1); // セル5
    expect(result[0]).toBe(2); // セル1: 変わらず
    expect(result[3]).toBe(1); // セル4: 変わらず
    expect(result[5]).toBe(3); // セル6: 変わらず
    expect(placedCells.sort()).toEqual([2, 3, 5]);
  });
});

describe('統合テスト: 狂符「マインドストーム」 (random_2d_exclude_then_fill + applyRandomResult)', () => {
  it('ダイス=[1,4] → 2と3と5と6に×count 配置', () => {
    const hint = applyStep(
      { type: "random_2d_exclude_then_fill", count: 1 },
      emptyGrid(), emptyGrid(), 2, 5
    );
    const { defGrid } = applyRandomResult(emptyGrid(), [1, 4], {
      specialType: hint.specialType, fillCount: hint.fillCount,
    });
    expect(defGrid[0]).toBe(0); // セル1: 除外
    expect(defGrid[1]).toBe(1); // セル2
    expect(defGrid[2]).toBe(1); // セル3
    expect(defGrid[3]).toBe(0); // セル4: 除外
    expect(defGrid[4]).toBe(1); // セル5
    expect(defGrid[5]).toBe(1); // セル6
  });
});

describe('統合テスト: 邪符「ナズーリン・ダウザー」 (clear_enemy_adj_then_random)', () => {
  it('敵機隣接弾幕を除去してダイス数を算出', () => {
    // defPos=3: 隣接=[2,6], セル2=3, セル6=2 → cleared=5
    const defGrid = [0, 3, 0, 0, 0, 2];
    const hint = applyStep(
      { type: "clear_enemy_adj_then_random", multiplier: 1 },
      defGrid, emptyGrid(), 1, 3
    );
    expect(hint.needsDice).toBe(true);
    expect(hint.diceCount).toBe(5);
    expect(hint.defGrid[1]).toBe(0); // セル2除去
    expect(hint.defGrid[5]).toBe(0); // セル6除去
  });
});

describe('統合テスト: 「妖怪弾幕バリア」 (random_3d_clear_then_all_neighbors + applyRandomResult)', () => {
  it('ダイス=[1,3,5] → 各セル除去 → 隣接ユニークセットに+1', () => {
    // unique=[1,3,5]除去 → neighbors=union([2,4],[2,6],[2,4,6])→unique=[2,4,6]→各+1
    const startGrid = [2, 1, 3, 0, 1, 0];
    const { defGrid } = applyRandomResult(startGrid, [1, 3, 5], { specialType: "clear_neighbors" });
    expect(defGrid[0]).toBe(0); // セル1: 除去
    expect(defGrid[2]).toBe(0); // セル3: 除去
    expect(defGrid[4]).toBe(0); // セル5: 除去
    // unique neighbor set → 各+1（重複は1回のみ）
    expect(defGrid[1]).toBe(2); // セル2: 既存1+1
    expect(defGrid[3]).toBe(1); // セル4: 既存0+1
    expect(defGrid[5]).toBe(1); // セル6: 既存0+1
  });
});

describe('統合テスト: 幻符「殺人ドール」 (enemy + effects[reduce_enemy_evasion] — グリッドのみ検証)', () => {
  it('回避側マス(defPos=4)に×1配置', () => {
    const { defGrid, placedCells } = applyStep(
      { type: "enemy", count: 1 },
      emptyGrid(), emptyGrid(), 2, 4
    );
    expect(defGrid[3]).toBe(1); // セル4
    expect(placedCells).toEqual([4]);
  });
});

describe('統合テスト: 廃線「ぶらり廃駅下車の旅」 (fixed_cells [2,2,5,5])', () => {
  it('2番と5番マスにそれぞれ×2配置', () => {
    const { defGrid } = applyStep(
      { type: "fixed_cells", cells: [2, 2, 5, 5], count: 1 },
      emptyGrid(), emptyGrid(), 3, 1
    );
    expect(defGrid[1]).toBe(2); // セル2: 2回
    expect(defGrid[4]).toBe(2); // セル5: 2回
    expect(defGrid[0]).toBe(0);
    expect(defGrid[2]).toBe(0);
  });
});

describe('統合テスト: 清符「オーパーツ清め」 (clear_enemy_adj_then_enemy with max)', () => {
  it('隣接弾幕を最大2個除去して敵マスに集める', () => {
    // defPos=2: 隣接=[1,3,5], セル1=3, セル3=2, セル5=1
    const defGrid = [3, 0, 2, 0, 1, 0];
    const { defGrid: result } = applyStep(
      { type: "clear_enemy_adj_then_enemy", max: 2 },
      defGrid, emptyGrid(), 4, 2
    );
    // max=2: セル1から2除去（残1）、セル3以降はそのまま
    expect(result[0]).toBe(1); // セル1: 3→1
    expect(result[2]).toBe(2); // セル3: 変わらず
    expect(result[4]).toBe(1); // セル5: 変わらず
    expect(result[1]).toBe(2); // セル2: 0+2=2
  });
});
