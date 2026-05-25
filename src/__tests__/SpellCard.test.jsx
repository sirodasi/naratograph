import { vi, describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../firebase', () => ({ db: {}, auth: {}, googleProvider: {} }));

import { SpellCard, ConfirmModal } from '../SessionView';
import { C } from '../styles/colors';

describe('SpellCard コンポーネント', () => {
  it('子要素を描画する', () => {
    render(<SpellCard>テストコンテンツ</SpellCard>);
    expect(screen.getByText('テストコンテンツ')).toBeInTheDocument();
  });

  it('title を渡すとタイトルバーに表示される', () => {
    render(<SpellCard title="霊符「夢想封印」">内容</SpellCard>);
    expect(screen.getByText('霊符「夢想封印」')).toBeInTheDocument();
  });

  it('title 未指定の場合、タイトル要素が描画されない', () => {
    render(<SpellCard>内容のみ</SpellCard>);
    expect(screen.queryByText('霊符「夢想封印」')).toBeNull();
  });

  it('headerRight に渡した要素がタイトルバー右に描画される', () => {
    render(
      <SpellCard title="タイトル" headerRight={<span>右バッジ</span>}>
        本文
      </SpellCard>
    );
    expect(screen.getByText('右バッジ')).toBeInTheDocument();
    expect(screen.getByText('タイトル')).toBeInTheDocument();
  });

  it('onClick が指定されていればクリックで発火する', () => {
    const onClick = vi.fn();
    render(<SpellCard onClick={onClick}>クリック対象</SpellCard>);
    fireEvent.click(screen.getByText('クリック対象'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('四隅に装飾ダイヤ (45度回転) が4つ描画される', () => {
    const { container } = render(<SpellCard>内容</SpellCard>);
    // インラインスタイルで transform: rotate(45deg) が設定されたdivが4つ
    const allDivs = container.querySelectorAll('div');
    const diamonds = Array.from(allDivs).filter(el =>
      (el.getAttribute('style') || '').includes('rotate(45deg)')
    );
    expect(diamonds).toHaveLength(4);
  });

  it('color プロパティが枠線色に反映される', () => {
    const { container } = render(<SpellCard color={C.red}>赤枠</SpellCard>);
    const outer = container.firstChild;
    // インラインstyleのborderにC.redが含まれることを確認
    expect(outer.getAttribute('style')).toContain(C.red);
  });
});

describe('ConfirmModal コンポーネント', () => {
  it('title と body が描画される', () => {
    render(
      <ConfirmModal
        title="確認"
        body="本当に実行しますか?"
        onOk={() => {}}
        onCancel={() => {}}
      />
    );
    // ConfirmModal は title を SpellCard に "◆ {title}" 形式で渡す
    expect(screen.getByText('◆ 確認')).toBeInTheDocument();
    expect(screen.getByText('本当に実行しますか?')).toBeInTheDocument();
  });

  it('OK / キャンセルボタンが描画される', () => {
    render(
      <ConfirmModal
        title="t"
        body="b"
        onOk={() => {}}
        onCancel={() => {}}
        okLabel="決行"
      />
    );
    expect(screen.getByText('決行')).toBeInTheDocument();
    expect(screen.getByText('キャンセル')).toBeInTheDocument();
  });

  it('OK クリックで onOk が呼ばれる', () => {
    const onOk = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmModal title="t" body="b" onOk={onOk} onCancel={onCancel} okLabel="決行" />
    );
    fireEvent.click(screen.getByText('決行'));
    expect(onOk).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('キャンセルクリックで onCancel が呼ばれる', () => {
    const onOk = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmModal title="t" body="b" onOk={onOk} onCancel={onCancel} />
    );
    fireEvent.click(screen.getByText('キャンセル'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onOk).not.toHaveBeenCalled();
  });
});
