# 幻想ナラトグラフ セッション支援ツール

東方Project 二次創作 TRPG「幻想ナラトグラフ」のオンラインセッションを支援する Web アプリ。
GM と PL が同じ部屋に入り、探索（マップ移動・手がかり・クエスト）から弾幕ごっこ（戦闘）、
終幕・成長処理までをリアルタイムに共有しながら進行できる。

- React 19 + Vite 8
- Firebase Realtime Database（状態の唯一の正）＋ Google 認証
- スタイルはインライン、UI 文言・コメントは日本語

## セットアップ

```bash
npm install
npm run dev        # 開発サーバー
npm run build      # 本番ビルド
npm run lint       # ESLint
npm run test:run   # Vitest（単発実行）
```

Firebase の接続先は `src/firebase.js`。データベースのセキュリティルールは `database.rules.json` にあり、
**サーバーへの反映は手動**（`firebase deploy --only database`）。GM 権限の付与方法や確認手順は
[docs/firebase-security-rules.md](docs/firebase-security-rules.md) を参照。

## ディレクトリ

| パス | 内容 |
|---|---|
| `src/App.jsx` | ルート・部屋の購読・フェイズ遷移・マップ・`upd()`（gs 更新） |
| `src/gsSync.js` | gs 同期の純粋ロジック（正規化・ログ上限・シナリオ秘匿） |
| `src/session/` | セッション画面（戦闘・PC カード・シーン・サイドバー・終了処理など） |
| `src/Lobby.jsx` | ログイン・部屋作成/参加・キャラ選択 |
| `src/ScenarioEditor.jsx` | シナリオ編集・プロフィール |
| `src/data/` | キャラクター・スポット・スペルカード効果などのデータ |
| `src/scenarios/` | 収録シナリオと Hard/Lunatic 用フック |
| `src/__tests__/` | Vitest のテスト（Firebase はモック） |

開発時の設計メモ・規約は [CLAUDE.md](CLAUDE.md) にまとめている。
