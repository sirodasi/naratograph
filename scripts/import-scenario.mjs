// ── Firebase エクスポート JSON → コード同梱シナリオ への変換ツール ────────
//
// 使い方:
//   node scripts/import-scenario.mjs <export.json> <id>
//
//   <id> はコード上の安定ID（kebab-case 推奨）。フック登録キー・部屋識別子になる。
//
//   difficulty が Hard / Lunatic   → src/scenarios/{hard|lunatic}/<id>.js を生成
//                                    （data を書き出す。コードフックが要れば後から hooks を追記）
//   difficulty が Easy / Normal    → 標準出力に EASY_NORMAL 追記用スニペットを表示
//                                    （src/scenarios/data/easy-normal.js の配列に貼る）
//
// Firebase メタ（createdAt/updatedAt）は除去し、id を指定値に正規化する。
// customPortrait 等の base64 はそのまま保持する（必要なら別途 Storage 化）。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const [, , file, id] = process.argv;
if (!file || !id) {
  console.error("usage: node scripts/import-scenario.mjs <export.json> <id>");
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(file, "utf8"));
delete raw.createdAt;
delete raw.updatedAt;
const data = { ...raw, id };
const json = JSON.stringify(data, null, 2);
const diff = raw.difficulty;

if (diff === "Hard" || diff === "Lunatic") {
  const dir = diff.toLowerCase();
  const outDir = path.join(ROOT, "src", "scenarios", dir);
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${id}.js`);
  fs.writeFileSync(
    out,
    `// 自動生成（scripts/import-scenario.mjs）。コードフックが要るならこのファイルに hooks を追記する。\n` +
      `export const data = ${json};\n\n` +
      `// export const hooks = {\n` +
      `//   blockedSpots(gs) { return []; },\n` +
      `//   resolveBaseSpot(spotId, gs) { return spotId; },\n` +
      `// };\n`,
  );
  console.log("wrote", path.relative(ROOT, out));
} else {
  console.log(`// ↓ src/scenarios/data/easy-normal.js の EASY_NORMAL 配列に追記:\n`);
  console.log(json + ",");
}
