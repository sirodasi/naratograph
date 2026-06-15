# Firebase Realtime Database セキュリティルール

公開デプロイ（`naratograph.vercel.app`）はこれまで RTDB に**サーバー側ルールが無く**、
GM 制限（`ALLOWED_GM_EMAILS`）も**クライアント側だけ**だった。つまり認証済みなら誰でも
任意ルームの読み書き・削除や他人の個人データ参照ができる状態だった。

[`database.rules.json`](../database.rules.json) はこれを **deny-by-default** で塞ぐ。

## 何を強制するか

| パス | 読み取り | 書き込み |
|---|---|---|
| `rooms/{code}` | 認証済み（部屋コードを知っていれば可） | **作成**は許可メール＋`gmUid=自分`のときのみ。既存部屋は **GM のみ**（全操作・削除） |
| `rooms/{code}/players/{uid}` | 〃（部屋経由） | 本人のみ（GM は部屋権限で全員可） |
| `rooms/{code}/presence/{uid}` | 〃 | 本人のみ |
| `rooms/{code}/state`（gs 全体） | 〃 | **参加者**（GM もしくはその部屋の players に居る者） |
| `rooms/{code}/scene`（描写） | 〃 | 参加者 |
| `users/{uid}` | 本人のみ | 本人のみ |
| `users/{uid}/bgm` | 認証済み（他クライアントが GM の BGM プリセットを読むため） | 本人のみ |
| `grownChars/{uid}` | 本人のみ | 本人のみ |
| その他すべて | 拒否 | 拒否 |

これで「非参加者による部屋改ざん・削除」「他人の `grownChars`/`stats`/自作シナリオの覗き見」
「許可外アカウントの GM 部屋作成」をサーバー側で遮断できる。

## 適用方法

### A. Firebase コンソール（手軽）

[Realtime Database → ルール](https://console.firebase.google.com/project/naratograph/database/naratograph-default-rtdb/rules)
を開き、[`database.rules.json`](../database.rules.json) の中身を貼り付けて **「公開」**。

### B. Firebase CLI

```bash
npm i -g firebase-tools
firebase login
firebase deploy --only database
```

（`firebase.json` / `.firebaserc` を同梱済み。プロジェクトは `naratograph`。）

## 適用前に必ずテスト（重要）

ルールが厳しすぎると**書き込みが黙って拒否されアプリが壊れる**。適用後に一通り確認すること：

1. 許可アカウント（`sora1225n@gmail.com`）で**部屋作成**できる
2. 別アカウントで**参加**でき、自分のキャラ選択・ready ができる
3. 探索でプレイヤーが**行動**（state 書き込み）できる
4. GM が**描写**（scene 書き込み）・サイクル進行できる
5. セッション終了で GM が**部屋削除**できる
6. 別アカウントでは**部屋作成ボタンが拒否**される

コンソールの **Rules Playground** でも個別パスの可否を事前検証できる。
うまくいかない場合、コンソールはルール履歴を保持しているので**いつでも前バージョンに戻せる**。

## 注意・今後の課題

- **GM 許可メールはルールにハードコード**（`sora1225n@gmail.com`）。`src/Lobby.jsx` の
  `ALLOWED_GM_EMAILS` を増やしたら、このルールの作成条件も合わせて更新すること。
  （頻繁に増やすなら `allowedGMs/{uid}: true` ノード方式に切り替える。）
- **部屋の読み取りは「認証済み＋コードを知っている」**まで。コードは 5 文字なので強い秘匿性は無い。
  より厳格にするなら参加者限定読み取り＋join 用の限定プレビューに分離する（将来課題）。
- `scripts/normalize-db.mjs` はクライアント SDK 経由なら、許可アカウントで認証するか
  Admin SDK 利用に切り替えないと、ルール適用後は書き込めない。
