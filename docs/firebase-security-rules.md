# Firebase Realtime Database セキュリティルール

[`database.rules.json`](../database.rules.json) は **deny-by-default**（明示的に許可した経路以外は読み書き不可）。
**リポジトリを変更してもサーバーには反映されない**ので、変更のたびに下の「適用方法」でデプロイすること。

## 何を強制するか

| パス | 読み取り | 書き込み |
|---|---|---|
| `rooms`（一覧） | `orderByChild("gmUid").equalTo(自分のuid)` のクエリのみ（プロフィールの部屋一覧用、`.indexOn: gmUid`） | — |
| `rooms/{code}` | 認証済み（部屋コードを知っていれば可。未参加者の閲覧専用画面のため） | **作成**は `admins/{自分のuid} === true` かつ `gmUid=自分` のときのみ。既存部屋は **GM のみ**（全操作・削除） |
| `rooms/{code}/players/{uid}` | 〃 | 本人のみ（GM は部屋権限で全員可）。`role` は本人が書く場合 `"pl"` しか許さない（PL の GM 昇格を防止） |
| `rooms/{code}/presence/{uid}` | 〃 | 本人のみ |
| `rooms/{code}/state`（gs 全体） | 〃 | **参加者**。ただし削除（null 書き込み）は GM のみ |
| `rooms/{code}/scene`（描写：id＋座標） | 〃 | 参加者（削除は GM のみ） |
| `rooms/{code}/sceneAssets`（描写画像 id→data URL） | 〃 | 参加者 |
| `rooms/{code}/logArchive`（上限超過で退避したログ） | 〃 | 参加者 |
| `roomSecrets/{code}/gm`（シナリオ全文） | **GM のみ** | GM のみ |
| `roomSecrets/{code}/plot/{uid}`（プロット配置の選択） | **本人のみ**（GM も読めない） | 本人（参加者であること）。GM は部屋の後片付けで削除可 |
| `admins/{uid}` | 本人のみ（自分が GM 権限を持つかの確認用） | 不可（コンソールから手動で設定） |
| `users/{uid}`（シナリオ・プリセット・実績など） | 本人のみ | 本人のみ |
| `users/{uid}/bgm` | 認証済み（他クライアントが GM の BGM プリセットを読むため） | 本人のみ |
| `grownChars/{uid}` | 本人のみ | 本人のみ |
| その他すべて | 拒否 | 拒否 |

### なぜ `roomSecrets` が `rooms` の外にあるのか

RTDB のルールでは、親で許可した読み取りを子で取り消すことができない。`rooms/{code}` は参加者全員
（＋閲覧専用画面）が読めるため、その配下に置いた秘匿データは隠せない。そこで秘匿データだけを
トップレベルの `roomSecrets/{code}` に分けている。

## GM 権限の付与

1. 付与したいアカウントでログインし、プロフィール →「アカウント」タブの **ユーザーID** をコピーする。
2. Firebase コンソールの Realtime Database → データで、ルート直下に `admins` → `{ユーザーID}: true` を追加する。
3. ロビーに「GMとして部屋を作る」が表示されれば完了。

（以前はメールアドレスをコードとルールに直書きしていたが、配信される JS に個人情報が載るため廃止した。
**ルールをデプロイする前に必ず自分の UID を `admins` に登録すること**。登録前にデプロイすると部屋を作れなくなる。）

## 適用方法

### A. Firebase コンソール（手軽）

Realtime Database → ルール を開き、[`database.rules.json`](../database.rules.json) の中身を貼り付けて **「公開」**。

### B. Firebase CLI

```bash
npm i -g firebase-tools
firebase login
firebase deploy --only database
```

（`firebase.json` / `.firebaserc` を同梱済み。プロジェクトは `naratograph`。）

## 適用前に必ずテスト（重要）

ルールが厳しすぎると**書き込みが黙って拒否されアプリが壊れる**。適用後に一通り確認すること：

1. `admins` に登録したアカウントで**部屋作成**できる（未登録アカウントでは拒否される）
2. 別アカウントで**参加**でき、自分のキャラ選択・ready ができる
3. 探索でプレイヤーが**行動**（state 書き込み）できる
4. GM が**描写**（scene 書き込み）・サイクル進行できる
5. GM のプロフィール「部屋一覧」に自分の部屋が表示される
6. プロット配置ありの弾幕ごっこで、選択→一斉公開→開始まで進む
7. GM が他 PC の成長を適用 → 本人の画面で保存される（GM の終了画面で ✓ になる）
8. セッション終了で GM が**部屋削除**できる

コンソールの **Rules Playground** でも個別パスの可否を事前検証できる。
うまくいかない場合、コンソールはルール履歴を保持しているので**いつでも前バージョンに戻せる**。

## 残る制約

- **gs（state）は参加者なら誰でも書き換えられる**。PL の行動を PL のクライアントが書く設計のため。
  ルールで項目ごとの権限を分けるには、Cloud Functions（Blaze プラン）でのサーバー側処理が必要。
- 部屋の読み取りは「認証済み＋コードを知っている」まで（閲覧専用画面のため）。秘匿が必要なものは `roomSecrets` へ。
- `grownChars/{uid}` は本人のみ書き込み可。GM が他 PC の成長を代理適用した場合は gs の
  `pendingGrowthRecord` を経由して本人のクライアントが保存する（本人がオンラインである必要がある）。
