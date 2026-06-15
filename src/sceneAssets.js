// 描写画像のアセット分離（RTDB 負荷対策）の純粋ロジック。
// 画像（data URL）を sceneAssets/{id} に1回だけ保存し、scene 本体には id＋座標のみ持たせる。
// id は内容ハッシュ＝同一画像は同一 id（重複保存しない）。React/Firebase 非依存・ユニットテスト可能。

const _assetIdMemo = new Map(); // url → id（巨大文字列の再ハッシュ回避）

// data URL から安定な id を生成（djb2 ＋ 文字列長で衝突を低減）。
export function hashAssetId(url) {
  const cached = _assetIdMemo.get(url);
  if (cached) return cached;
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = ((h << 5) + h + url.charCodeAt(i)) | 0;
  const id = "a" + (h >>> 0).toString(36) + url.length.toString(36);
  _assetIdMemo.set(url, id);
  return id;
}

// 書き込み用：data URL を id に置換し、未知（known に無い）新規アセットだけ抽出する。
// 返り値 { scene: 軽量化した scene, newAssets: { id: dataURL } }。
export function dehydrateScene(scene, known = {}) {
  const newAssets = {};
  const conv = (url) => {
    if (typeof url !== "string" || !url.startsWith("data:")) return url; // id/プレーンURL/空はそのまま
    const id = hashAssetId(url);
    if (!(id in known) && !(id in newAssets)) newAssets[id] = url;
    return id;
  };
  const out = { ...scene, bg: conv(scene.bg ?? null) };
  out.portraits = (scene.portraits || []).map(p => {
    const np = { ...p, img: conv(p.img) };
    if (p.faces) np.faces = p.faces.map(conv);
    return np;
  });
  return { scene: out, newAssets };
}

// 読み取り用：id を実 URL に解決（assets に無ければそのまま＝レガシーの inline data URL を許容）。
export function hydrateScene(scene, assets = {}) {
  const conv = (id) => (typeof id === "string" && assets[id] != null) ? assets[id] : id;
  return {
    bg: conv(scene.bg ?? null),
    portraits: (scene.portraits || []).map(p => {
      const np = { ...p, img: conv(p.img) };
      if (p.faces) np.faces = p.faces.map(conv);
      return np;
    }),
    fx: scene.fx ?? {},
  };
}
