// buildSpellCard / expandStoredSpell のリグレッションテスト。
//
// 直近で修正したスペルカード関連バグのうち、純粋関数として検証できるものを固定する:
//   1. structured.timing の伝播 — SPELL_CARD_EFFECTS の timing がテキスト解析より優先される。
//      （NPC スペカの desc に timing キーワードが無いと standard と誤判定され、
//       round_start スペカが「スペルカードステップ」で宣言できてしまったバグ）
//   2. pendingSpell / manualSpell の保存形式 — slim 形 {name,text,manual,ref} から
//      expandStoredSpell で派生フィールドを正しく復元できること。

import { vi, describe, it, expect } from 'vitest';

vi.mock('../firebase', () => ({ db: {}, auth: {}, googleProvider: {} }));

import { buildSpellCard, expandStoredSpell } from '../SessionView';

// ═══════════════════════════════════════════════════════════════════
// 1. structured.timing の伝播（実バグのリグレッション）
// ═══════════════════════════════════════════════════════════════════
describe('buildSpellCard: structured.timing がテキスト解析より優先される', () => {
  it('忿怒のレッドUFO襲来: desc に timing 語が無くても round_start（実バグ再現）', () => {
    // NPC スペカ形式 {name, desc, ref}。desc にはタイミング語を含めない。
    const sc = buildSpellCard({
      name: '正体不明「忿怒のレッドUFO襲来」',
      desc: '援護射撃・かばうを2回まで宣言できる',
      ref: '正体不明「忿怒のレッドUFO襲来」',
    });
    expect(sc.timing).toBe('round_start');
  });

  it('埴輪「偶像人馬造形術」: round_start', () => {
    const sc = buildSpellCard({
      name: '埴輪「偶像人馬造形術」',
      desc: '援護射撃・かばうを3回まで',
      ref: '埴輪「偶像人馬造形術」',
    });
    expect(sc.timing).toBe('round_start');
  });

  it('禁忌「フォーオブアカインド」: round_start', () => {
    const sc = buildSpellCard({
      name: '禁忌「フォーオブアカインド」',
      desc: '効果説明（timing語なし）',
      ref: '禁忌「フォーオブアカインド」',
    });
    expect(sc.timing).toBe('round_start');
  });

  it('PC 生テキスト形式でも ref 相当の名前から structured.timing を引く', () => {
    // PC スペカは生テキスト文字列。名前は先頭の「」から抽出され、それで structured を引く。
    // desc/本文にタイミング語が無いケースを作るため、名前のみ + 無関係な本文にする。
    const sc = buildSpellCard('正体不明「忿怒のレッドUFO襲来」弾幕を展開する');
    expect(sc.timing).toBe('round_start');
    expect(sc.name).toBe('正体不明「忿怒のレッドUFO襲来」');
  });
});

describe('buildSpellCard: round_end / その他 timing も structured が反映される', () => {
  it('日符「ロイヤルフレア」: round_end（effectTiming も round_end）', () => {
    const sc = buildSpellCard({
      name: '日符「ロイヤルフレア」',
      desc: '空きマスを埋める',
      ref: '日符「ロイヤルフレア」',
    });
    expect(sc.timing).toBe('round_end');
    expect(sc.effectTiming).toBe('round_end');
  });
});

describe('buildSpellCard: structured が無い場合はテキスト解析の timing を使う', () => {
  it('未登録カード + 「回避ステップ」本文 → evade', () => {
    const sc = buildSpellCard('架空符「テスト回避」回避ステップに使用できる【自機マス×1】');
    expect(sc.structured).toBeNull();
    expect(sc.timing).toBe('evade');
  });

  it('未登録カード + 「ラウンドの開始時」本文 → round_start', () => {
    const sc = buildSpellCard('架空符「テスト開始」ラウンドの開始時に使用できる【敵機マス×1】');
    expect(sc.structured).toBeNull();
    expect(sc.timing).toBe('round_start');
  });

  it('未登録カード + タイミング語なし → standard', () => {
    const sc = buildSpellCard('架空符「通常」【敵機マス×2】');
    expect(sc.structured).toBeNull();
    expect(sc.timing).toBe('standard');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. name 抽出
// ═══════════════════════════════════════════════════════════════════
describe('buildSpellCard: 名前抽出', () => {
  it('生テキストの先頭「」を name にする', () => {
    const sc = buildSpellCard('霊符「夢想封印」【指定マス×2】');
    expect(sc.name).toBe('霊符「夢想封印」');
  });

  it('オブジェクトの name を優先する', () => {
    const sc = buildSpellCard({ name: '指定名', desc: '別「カッコ名」効果' });
    expect(sc.name).toBe('指定名');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. manual フラグ（structured auto による解除）
// ═══════════════════════════════════════════════════════════════════
describe('buildSpellCard: manual フラグ', () => {
  it('structured が partial/full のカードは manual=false', () => {
    const ufo = buildSpellCard({ name: '正体不明「忿怒のレッドUFO襲来」', desc: 'x', ref: '正体不明「忿怒のレッドUFO襲来」' });
    expect(ufo.manual).toBe(false);
  });

  it('structured が無く効果記号も無いテキストは manual=true（GM手動）', () => {
    const sc = buildSpellCard('架空符「手動」特殊な効果（自動処理不可）');
    expect(sc.structured).toBeNull();
    expect(sc.manual).toBe(true);
  });

  it('structured が無くても効果記号があれば manual=false', () => {
    const sc = buildSpellCard('架空符「自動」【敵機マス×1】');
    expect(sc.manual).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3.5 manualEffects: 自動処理されない structured.effects の抽出
// （宣言UIで「GM手動」警告を出すためのフラグ）
// ═══════════════════════════════════════════════════════════════════
describe('buildSpellCard: manualEffects（要GM手動の effects 抽出）', () => {
  it('被弾処理系（warning+手動運用）は manualEffects に含まれる', () => {
    // 「リザレクション」: cancel_hp_reduction（複雑なルール解釈のため警告+GM手動のまま）
    const sc = buildSpellCard({ name: '「リザレクション」', desc: 'x', ref: '「リザレクション」' });
    expect(sc.manualEffects).toContain('cancel_hp_reduction');
  });

  it('自動化された即時リソース効果（グレイズリセット）は manualEffects に含まれない', () => {
    // 「バレットドミニオン」: reset_graze は自動化済み（AUTO_HANDLED）
    const sc = buildSpellCard({ name: '「バレットドミニオン」', desc: 'ランダム配置', ref: '「バレットドミニオン」' });
    expect(sc.manualEffects).not.toContain('reset_graze');
  });

  it('自動化された効果（回避力減少）は manualEffects に含まれない', () => {
    // 幻符「殺人ドール」: reduce_enemy_evasion は自動化済み（AUTO_HANDLED）
    const sc = buildSpellCard({ name: '幻符「殺人ドール」', desc: '敵機マスに配置', ref: '幻符「殺人ドール」' });
    expect(sc.manualEffects).not.toContain('reduce_enemy_evasion');
  });

  it('自動処理される効果（配置直後の除去）は manualEffects に含まれない', () => {
    // 写真「籠もりパパラッチ」: effects に remove_from_enemy_cell（AUTO_HANDLED）
    const sc = buildSpellCard({ name: '写真「籠もりパパラッチ」', desc: 'ランダム配置', ref: '写真「籠もりパパラッチ」' });
    expect(sc.manualEffects).not.toContain('remove_from_enemy_cell');
  });

  it('extra_support_cover 等の処理済み効果は manualEffects に含まれない', () => {
    const sc = buildSpellCard({ name: '正体不明「忿怒のレッドUFO襲来」', desc: 'x', ref: '正体不明「忿怒のレッドUFO襲来」' });
    expect(sc.manualEffects).not.toContain('extra_support_cover_with_die_choice');
  });

  it('effects が無いカードは manualEffects が空配列', () => {
    const sc = buildSpellCard('霊符「夢想封印」【指定マス×2】');
    expect(sc.manualEffects).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. condition / textBody の抽出
// ═══════════════════════════════════════════════════════════════════
describe('buildSpellCard: condition と textBody', () => {
  it('「このスペルカードは…できない」を condition に抽出し textBody から除く', () => {
    const text = '符「条件付き」【敵機マス×1】このスペルカードは、攻撃力が3未満の場合は使用できない。';
    const sc = buildSpellCard(text);
    expect(sc.condition).toMatch(/使用できない/);
    expect(sc.textBody).not.toMatch(/このスペルカードは、攻撃力が3未満の場合は使用できない/);
  });

  it('条件文が無ければ condition は null、textBody は元テキストと一致', () => {
    const text = '符「無条件」【自機マス×1】';
    const sc = buildSpellCard(text);
    expect(sc.condition).toBeNull();
    expect(sc.textBody).toBe(text);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. null / 空入力
// ═══════════════════════════════════════════════════════════════════
describe('buildSpellCard: 異常系', () => {
  it('null は null を返す', () => {
    expect(buildSpellCard(null)).toBeNull();
  });

  it('undefined は null を返す', () => {
    expect(buildSpellCard(undefined)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. expandStoredSpell: slim 形からの復元（pendingSpell/manualSpell 保存形式）
// ═══════════════════════════════════════════════════════════════════
describe('expandStoredSpell: slim 形 → 派生フィールド復元', () => {
  it('slim {name,text,manual,ref} から timing/effects/structured を復元する', () => {
    const full = buildSpellCard({
      name: '正体不明「忿怒のレッドUFO襲来」',
      desc: '援護射撃・かばうを2回まで',
      ref: '正体不明「忿怒のレッドUFO襲来」',
    });
    // slimSpellForStorage 相当（name/text/manual/ref のみ保持）
    const slim = { name: full.name, text: full.text, manual: full.manual, ref: full.ref };
    const restored = expandStoredSpell(slim);

    expect(restored.name).toBe(full.name);
    expect(restored.timing).toBe('round_start');     // structured 由来が復元される
    expect(restored.structured).toBeTruthy();
    expect(restored.manual).toBe(false);
  });

  it('位置情報など追加フィールドは保持される', () => {
    const slim = {
      name: '霊符「夢想封印」',
      text: '霊符「夢想封印」【指定マス×2】',
      manual: false,
      ref: '霊符「夢想封印」',
      attackerId: 'pc1',
      defenderId: 'npc1',
      attPos: 2,
      defPos: 5,
    };
    const restored = expandStoredSpell(slim);
    expect(restored.attackerId).toBe('pc1');
    expect(restored.defenderId).toBe('npc1');
    expect(restored.attPos).toBe(2);
    expect(restored.defPos).toBe(5);
  });

  it('null は null を返す', () => {
    expect(expandStoredSpell(null)).toBeNull();
  });

  it('text を持たないレガシー全展開済みオブジェクトはそのまま返す', () => {
    const legacy = { name: 'X', timing: 'standard', effects: [] };
    expect(expandStoredSpell(legacy)).toBe(legacy);
  });
});
