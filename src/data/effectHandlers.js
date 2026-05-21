// ─── 弾幕グリッドハンドラー ────────────────────────────────────────────────────
// スペルカード効果の純粋関数実装。Firebase・React に依存しない。
//
// グリッド: 6要素配列 [0..5]、インデックス i = セル番号 i+1
// 配置:  1 | 2 | 3
//        ─────────
//        4 | 5 | 6

// ─── グリッド幾何定数 ────────────────────────────────────────────────────────

export const GRID_VERTICAL   = { 1: 4, 4: 1, 2: 5, 5: 2, 3: 6, 6: 3 };
export const GRID_HORIZONTAL = { 1: [2], 2: [1, 3], 3: [2], 4: [5], 5: [4, 6], 6: [5] };
export const GRID_ALL_ADJ    = { 1: [2, 4], 2: [1, 3, 5], 3: [2, 6], 4: [1, 5], 5: [2, 4, 6], 6: [3, 5] };

// ─── 基本操作 ─────────────────────────────────────────────────────────────────

export function emptyGrid() {
  return [0, 0, 0, 0, 0, 0];
}

/** グリッドの指定セルに弾幕を追加（元の配列は変更しない） */
export function addBullets(grid, cells, count = 1) {
  const g = [...grid];
  for (const cell of cells) {
    if (cell >= 1 && cell <= 6) g[cell - 1] = (g[cell - 1] || 0) + count;
  }
  return g;
}

/** グリッドの指定セルから弾幕を除去（0未満にはならない） */
export function removeBullets(grid, cells, count = 1) {
  const g = [...grid];
  for (const cell of cells) {
    if (cell >= 1 && cell <= 6) g[cell - 1] = Math.max(0, (g[cell - 1] || 0) - count);
  }
  return g;
}

// ─── アフターエフェクト ────────────────────────────────────────────────────────

/**
 * steps[].after[] の1つを適用する。
 * @param {object}   afterDef    - after エフェクト定義
 * @param {number[]} defGrid     - 回避側グリッド
 * @param {number[]} atkGrid     - 攻撃側グリッド（remove_attacker_mirror で使用）
 * @param {number[]} placedCells - このステップで配置したセル番号リスト
 * @returns {{ defGrid: number[], atkGrid: number[] }}
 */
export function applyAfterEffect(afterDef, defGrid, atkGrid, placedCells) {
  const count = afterDef.count ?? 1;
  let def = [...defGrid];
  let atk = [...atkGrid];
  const unique = [...new Set(placedCells.filter(c => c >= 1 && c <= 6))];

  switch (afterDef.type) {
    case "vertical_of_placed": {
      const targets = unique.map(c => GRID_VERTICAL[c]).filter(Boolean);
      def = addBullets(def, targets, count);
      break;
    }
    case "horizontal_of_placed": {
      const targets = [...new Set(unique.flatMap(c => GRID_HORIZONTAL[c] || []))];
      def = addBullets(def, targets, count);
      break;
    }
    case "all_neighbors_of_placed": {
      const targets = [...new Set(unique.flatMap(c => GRID_ALL_ADJ[c] || []))];
      def = addBullets(def, targets, count);
      break;
    }
    case "double_each_placed":
    case "add_to_placed": {
      def = addBullets(def, unique, count);
      break;
    }
    case "remove_attacker_mirror": {
      // 配置したマスと同番号の攻撃側フィールドの弾幕を除去
      atk = removeBullets(atk, unique, count);
      break;
    }
    default:
      break;
  }

  return { defGrid: def, atkGrid: atk };
}

/** steps[].after[] リストを順番に適用 */
export function applyAfterEffects(afterList, defGrid, atkGrid, placedCells) {
  let result = { defGrid, atkGrid };
  for (const after of (afterList || [])) {
    result = applyAfterEffect(after, result.defGrid, result.atkGrid, placedCells);
  }
  return result;
}

// ─── ステップ適用 ─────────────────────────────────────────────────────────────

/**
 * 1ステップを適用する。
 *
 * 戻り値パターン:
 *   同期完了:  { defGrid, atkGrid, placedCells }
 *   ダイス必要: { defGrid, atkGrid, placedCells: [], needsDice: true, diceCount, specialType?, afterList? }
 *   選択必要:  { defGrid, atkGrid, placedCells: [], needsChoice: true, choiceType }
 *
 * @param {object}   step    - steps[] の1要素
 * @param {number[]} defGrid - 回避側グリッド（変更前）
 * @param {number[]} atkGrid - 攻撃側グリッド（変更前）
 * @param {number}   atkPos  - 攻撃側現在位置 (1-6)
 * @param {number}   defPos  - 回避側現在位置 (1-6)
 */
export function applyStep(step, defGrid, atkGrid, atkPos, defPos) {
  // stat-based count は caller が解決してから渡すこと; objectの場合は1として扱う
  const rawCount = (typeof step.count === "object" || step.count == null) ? 1 : step.count;
  let def = [...defGrid];
  let atk = [...atkGrid];
  let placedCells = [];

  switch (step.type) {

    // ── 決定論的配置 ───────────────────────────────────────────────────────

    case "self": {
      placedCells = [atkPos];
      def = addBullets(def, placedCells, rawCount);
      break;
    }
    case "enemy": {
      placedCells = [defPos];
      def = addBullets(def, placedCells, rawCount);
      break;
    }
    case "fixed_cells": {
      // cells 配列は重複あり（例: [2,2,5,5] → 2番と5番に×2）
      const tally = {};
      for (const c of (step.cells || [])) tally[c] = (tally[c] || 0) + rawCount;
      for (const [c, n] of Object.entries(tally)) {
        def = addBullets(def, [+c], n);
        placedCells.push(+c);
      }
      placedCells = [...new Set(placedCells)];
      break;
    }
    case "adjacent_enemy": {
      // 回避側のいるマスに隣接する全マスに配置（自動処理）
      placedCells = [...new Set(GRID_ALL_ADJ[defPos] || [])];
      def = addBullets(def, placedCells, rawCount);
      break;
    }
    case "mirrored_adj_self": {
      // 自機マスと同番号の回避側マスの上下左右隣接マス
      placedCells = [...new Set(GRID_ALL_ADJ[atkPos] || [])];
      def = addBullets(def, placedCells, rawCount);
      break;
    }
    case "fill_empty_cells": {
      // 空きマス全てに配置
      placedCells = [1, 2, 3, 4, 5, 6].filter(c => (def[c - 1] || 0) === 0);
      def = addBullets(def, placedCells, rawCount);
      break;
    }
    case "move_all_vertical": {
      // 全弾幕を上下隣接マスへ移動
      const next = emptyGrid();
      for (let i = 0; i < 6; i++) {
        if (def[i] > 0) {
          const target = GRID_VERTICAL[i + 1];
          if (target) next[target - 1] += def[i];
        }
      }
      def = next;
      placedCells = [1, 2, 3, 4, 5, 6].filter(c => def[c - 1] > 0);
      break;
    }
    case "shift_cells_up1": {
      // 全弾幕を1番号大きいマスへ移動（6番→1番へラップ）
      const next = emptyGrid();
      for (let i = 0; i < 6; i++) next[(i + 1) % 6] += def[i];
      def = next;
      placedCells = [1, 2, 3, 4, 5, 6].filter(c => def[c - 1] > 0);
      break;
    }
    case "mirror_bullet_counts": {
      // 1個のマス→3個、3個以上のマス→1個に置き直す
      def = def.map(v => v === 1 ? 3 : v >= 3 ? 1 : v);
      placedCells = [1, 2, 3, 4, 5, 6].filter(c => def[c - 1] > 0);
      break;
    }
    case "double_single_bullets": {
      // 弾幕が1個だけのマスに+1
      placedCells = [1, 2, 3, 4, 5, 6].filter(c => def[c - 1] === 1);
      def = addBullets(def, placedCells, 1);
      break;
    }
    case "enemy_cross_h": {
      // 回避側の左右隣接マス + それらの上下隣接マス
      const hAdj = GRID_HORIZONTAL[defPos] || [];
      const vOfH = hAdj.map(c => GRID_VERTICAL[c]).filter(Boolean);
      placedCells = [...new Set([...hAdj, ...vOfH])];
      def = addBullets(def, placedCells, rawCount);
      break;
    }
    case "non_adjacent_to_mirrored": {
      // 自機と同番号の回避側マスに隣接するマス以外の全マスに配置
      const excluded = new Set([atkPos, ...(GRID_ALL_ADJ[atkPos] || [])]);
      placedCells = [1, 2, 3, 4, 5, 6].filter(c => !excluded.has(c));
      def = addBullets(def, placedCells, rawCount);
      break;
    }
    case "self_if_same_cell": {
      // 攻守が同マスのときのみ自機マスに追加
      if (atkPos === defPos) {
        placedCells = [atkPos];
        def = addBullets(def, placedCells, rawCount);
      }
      break;
    }
    case "clear_enemy_cell": {
      // 回避側のいるマスの弾幕を全除去
      def[defPos - 1] = 0;
      break;
    }
    case "clear_enemy_adj_then_enemy": {
      // 敵機隣接マスの弾幕を除去（最大 step.max 個）→除去数分を敵機マスに配置
      const adjCells = GRID_ALL_ADJ[defPos] || [];
      const maxClear = step.max ?? Infinity;
      let cleared = 0;
      for (const c of adjCells) {
        if (cleared >= maxClear) break;
        const toRemove = Math.min(def[c - 1] || 0, maxClear - cleared);
        def[c - 1] = Math.max(0, (def[c - 1] || 0) - toRemove);
        cleared += toRemove;
      }
      if (cleared > 0) {
        placedCells = [defPos];
        def = addBullets(def, placedCells, cleared);
      }
      break;
    }

    // ── ダイス必要ステップ ──────────────────────────────────────────────────

    case "random": {
      const count = typeof step.count === "object" ? 1 : (step.count ?? 1);
      return { defGrid: def, atkGrid: atk, placedCells: [],
        needsDice: true, diceCount: count, afterList: step.after || [] };
    }
    case "clear_all_then_random": {
      const cleared = def.reduce((s, v) => s + v, 0);
      def = emptyGrid();
      // step.count が指定されている場合は固定ダイス数（羊符「ナイトメア・オブ・キメラ」）
      const diceCount = step.count != null ? step.count : cleared * (step.multiplier ?? 1);
      return { defGrid: def, atkGrid: atk, placedCells: [],
        needsDice: true, diceCount: Math.max(0, diceCount), afterList: step.after || [] };
    }
    case "clear_enemy_adj_then_random": {
      const adjCells = GRID_ALL_ADJ[defPos] || [];
      let cleared = 0;
      for (const c of adjCells) { cleared += (def[c - 1] || 0); def[c - 1] = 0; }
      const diceCount = cleared * (step.multiplier ?? 1);
      return { defGrid: def, atkGrid: atk, placedCells: [],
        needsDice: true, diceCount, afterList: step.after || [] };
    }
    case "clear_mirrored_adj_then_random": {
      // 自機マスと同番号の回避側マスの隣接弾幕を除去→除去数×multiplier のランダム
      const mirroredAdj = GRID_ALL_ADJ[atkPos] || [];
      let cleared = 0;
      for (const c of mirroredAdj) { cleared += (def[c - 1] || 0); def[c - 1] = 0; }
      const diceCount = cleared * (step.multiplier ?? 1);
      return { defGrid: def, atkGrid: atk, placedCells: [],
        needsDice: true, diceCount, afterList: step.after || [] };
    }
    case "random_2d_exclude_then_fill": {
      // 2D振り→出た目以外の全マスに×count
      return { defGrid: def, atkGrid: atk, placedCells: [],
        needsDice: true, diceCount: 2, specialType: "exclude_fill",
        fillCount: rawCount, afterList: step.after || [] };
    }
    case "random_clear_then_double": {
      // ランダム×N。配置マスの既存弾幕を除去→新たに2つずつ配置
      return { defGrid: def, atkGrid: atk, placedCells: [],
        needsDice: true, diceCount: rawCount, specialType: "clear_then_double",
        afterList: step.after || [] };
    }
    case "random_3d_clear_then_all_neighbors": {
      // 3D振り→3マスをランダム選択→各マスの弾幕除去→上下左右隣接に×1
      return { defGrid: def, atkGrid: atk, placedCells: [],
        needsDice: true, diceCount: 3, specialType: "clear_neighbors",
        afterList: step.after || [] };
    }

    // ── 選択必要ステップ（UI で処理） ──────────────────────────────────────

    case "designated":
    case "choice_fixed":
    case "clear_chosen_then_random":
    case "directional_move_shoot":
    case "roll_check_then_place": {
      return { defGrid: def, atkGrid: atk, placedCells: [],
        needsChoice: true, choiceType: step.type };
    }

    default:
      break;
  }

  // アフターエフェクトを適用（配置があった場合のみ）
  if (step.after && placedCells.length > 0) {
    const r = applyAfterEffects(step.after, def, atk, placedCells);
    def = r.defGrid;
    atk = r.atkGrid;
  }

  return { defGrid: def, atkGrid: atk, placedCells };
}

// ─── ランダム結果の適用 ────────────────────────────────────────────────────────

/**
 * ダイス結果をグリッドに適用する。
 * specialType で特殊ロジックを切り替える。
 *
 * @param {number[]} defGrid     - 現在の回避側グリッド（deterministic steps 適用済み）
 * @param {number[]} diceResults - 1-6 の配列
 * @param {object}   stepHint    - applyStep が返した { specialType?, fillCount?, afterList? }
 * @returns {{ defGrid: number[], placedCells: number[] }}
 */
export function applyRandomResult(defGrid, diceResults, stepHint = {}) {
  let def = [...defGrid];
  const placedCells = [];
  const { specialType, fillCount = 1, afterList = [] } = stepHint;

  if (specialType === "exclude_fill") {
    // 出た目のマス以外の全マスに×fillCount
    const excluded = new Set(diceResults.filter(d => d >= 1 && d <= 6));
    const targets = [1, 2, 3, 4, 5, 6].filter(c => !excluded.has(c));
    def = addBullets(def, targets, fillCount);
    targets.forEach(c => placedCells.push(c));
  } else if (specialType === "clear_then_double") {
    // 各ダイス目のマス: 既存弾幕を除去→2つ配置
    const unique = [...new Set(diceResults.filter(d => d >= 1 && d <= 6))];
    for (const d of unique) {
      def[d - 1] = 2;
      placedCells.push(d);
    }
  } else if (specialType === "clear_neighbors") {
    // 各ダイス目のマスの弾幕除去→その全隣接マスに×1
    const unique = [...new Set(diceResults.filter(d => d >= 1 && d <= 6))];
    for (const d of unique) def[d - 1] = 0;
    const neighbors = [...new Set(unique.flatMap(c => GRID_ALL_ADJ[c] || []))];
    def = addBullets(def, neighbors, 1);
    neighbors.forEach(c => placedCells.push(c));
  } else {
    // 通常: 各ダイス目のマスに+1
    for (const d of diceResults) {
      if (d >= 1 && d <= 6) {
        def[d - 1] = (def[d - 1] || 0) + 1;
        placedCells.push(d);
      }
    }
  }

  // アフターエフェクト
  if (afterList.length > 0 && placedCells.length > 0) {
    const r = applyAfterEffects(afterList, def, emptyGrid(), placedCells);
    def = r.defGrid;
  }

  return { defGrid: def, placedCells };
}

// ─── ユーティリティ ────────────────────────────────────────────────────────────

/**
 * stat-based count を解決する。
 * countDef が数値ならそのまま返す。
 * オブジェクトの場合は entity.resources から値を取得する。
 */
export function resolveCount(countDef, entity = {}) {
  if (typeof countDef !== "object" || countDef === null) return countDef ?? 1;
  if (countDef.type === "stat") {
    const val = entity.resources?.[countDef.stat]?.cur ?? 0;
    return val * (countDef.multiplier ?? 1);
  }
  return 1;
}

/** ステップがダイス必要か */
export function isRandomStep(step) {
  return [
    "random", "clear_all_then_random", "clear_enemy_adj_then_random",
    "clear_mirrored_adj_then_random", "random_2d_exclude_then_fill",
    "random_clear_then_double", "random_3d_clear_then_all_neighbors",
  ].includes(step.type);
}

/** ステップがプレイヤー選択必要か */
export function isChoiceStep(step) {
  return [
    "designated", "choice_fixed", "clear_chosen_then_random",
    "directional_move_shoot", "roll_check_then_place",
  ].includes(step.type);
}

/**
 * structured steps を分析してカードの自動化レベルを返す。
 * @returns {{ hasRandom: boolean, hasChoice: boolean, totalDice: number }}
 */
export function analyzeSteps(steps) {
  let hasRandom = false;
  let hasChoice = false;
  let totalDice = 0;

  for (const step of (steps || [])) {
    if (isRandomStep(step)) {
      hasRandom = true;
      if (typeof step.count !== "object") totalDice += (step.count ?? 1);
    }
    if (isChoiceStep(step)) hasChoice = true;
  }

  return { hasRandom, hasChoice, totalDice };
}
