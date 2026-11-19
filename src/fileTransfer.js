// ブラウザでのファイルの書き出し（ダウンロード）と読み込みの小さなヘルパー。
// 異変再現プリセットの JSON 書き出し・読み込みで使う。

export function downloadText(filename, text, mime = "application/json") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 読み込みの上限。書き出しでも同じ上限を確かめ、読み込めないファイルを作らない
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

// 上限を超える場合は知らせて書き出さず、false を返す
export function downloadJson(filename, obj) {
  const text = JSON.stringify(obj, null, 2);
  if (new Blob([text]).size > MAX_FILE_BYTES) {
    window.alert("内容が大きすぎるため書き出せません（2MB まで）。表やアイテムの説明を短くしてください。");
    return false;
  }
  downloadText(filename, text);
  return true;
}

// 選択されたファイルを文字列で読む（大きすぎるファイルは読まない）
export function readFileText(file, maxBytes = MAX_FILE_BYTES) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error("ファイルが選択されていません"));
    if (file.size > maxBytes) return reject(new Error("ファイルが大きすぎます"));
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error || new Error("読み込みに失敗しました"));
    reader.readAsText(file, "utf-8");
  });
}
