// Firebase Realtime Database のセキュリティルールのテスト用設定。
// 通常の `npm test` には含めない（エミュレーターが必要なため）。実行は `npm run test:rules`
// （firebase-tools と Java 11 以上が必要。firebase emulators:exec がエミュレーターを起動して、このテストを流す）。
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/rules/**/*.rules.js"],
    testTimeout: 20000,
  },
});
