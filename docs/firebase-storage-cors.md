# Firebase Storage の CORS 設定

描写モードの画像（背景・立ち絵・表情）は `sceneImages/{uid}/...` に
アップロードし、ダウンロードURLを RTDB に保存している（base64 を直接 RTDB に
入れると同期が重くなるため）。

ブラウザから Storage バケットへ直接アップロードするには、バケットに **CORS 設定**が
必要。未設定だとプリフライト（OPTIONS）が通らず、以下のように失敗する：

```
Access to XMLHttpRequest at 'https://firebasestorage.googleapis.com/.../sceneImages%2F...'
from origin 'https://naratograph.vercel.app' has been blocked by CORS policy:
Response to preflight request doesn't pass access control check:
It does not have HTTP ok status.
```

このときコード側は **data URL フォールバック**（`SceneEditor.loadImage` の try/catch）で
画像を RTDB に直接保存するので動作はするが、RTDB が重くなる。Storage を正しく使うには
下記を **1回だけ** 実行する。

## 適用手順

バケット名は `gs://naratograph.firebasestorage.app`（`src/firebase.js` の
`storageBucket`）。リポジトリ直下の [`cors.json`](../cors.json) を適用する。

### gcloud CLI（推奨・新しい方）

```bash
gcloud storage buckets update gs://naratograph.firebasestorage.app --cors-file=cors.json
```

### gsutil（旧 Cloud SDK）

```bash
gsutil cors set cors.json gs://naratograph.firebasestorage.app
```

どちらも事前に `gcloud auth login`（プロジェクト `naratograph` の権限が必要）。
[Cloud Shell](https://console.cloud.google.com/?project=naratograph) で実行すれば
ローカルに gcloud を入れなくてもよい（`cors.json` をアップロードして実行）。

### 確認

```bash
gcloud storage buckets describe gs://naratograph.firebasestorage.app --format="default(cors_config)"
```

設定後、ブラウザのキャッシュをクリアして再読み込みすれば CORS エラーは消え、
以降の画像は Storage の URL（`https://firebasestorage.googleapis.com/...`）で保存される。

## 注意

- 新しいプレビューデプロイ（`*.vercel.app` の動的サブドメイン）からアップロードする
  場合は、その origin を `cors.json` の `origin` に追加して再適用する。本番ドメインだけで
  よければ現状のままでよい。手間を避けたいなら `"origin": ["*"]` でも可
  （書き込みは Storage ルール＋認証で守られているため）。
- Storage ルール（`sceneImages/` への認証済み書き込み・読み取り許可）は別途
  Firebase コンソールの Storage → Rules で設定すること。CORS とルールは別物。
