// database.rules.json のテスト（Firebase エミュレーター上で実行: npm run test:rules）
import { readFileSync } from "node:fs";
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";

const ROOM = "R1";
let env;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-naratograph",
    database: { rules: readFileSync("database.rules.json", "utf8"), host: "127.0.0.1", port: 9000 },
  });
});
afterAll(async () => { await env?.cleanup(); });

// 部屋: GM=gm、参加 PL=pl1・pl2、未参加=stranger
beforeEach(async () => {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.database().ref().set({
      rooms: {
        [ROOM]: {
          gmUid: "gm",
          phase: "explore",
          players: { gm: { role: "gm" }, pl1: { role: "pl" }, pl2: { role: "pl" } },
          state: {
            sessionPhase: "explore",
            log: { 0: "start" },
            battle: { active: true, plotCommits: { pl1: "h1", npc1: "hn" } },
          },
          gmRequests: { r1: { id: "r1", kind: "dice", title: "判定" } },
        },
      },
      roomSecrets: { [ROOM]: { gm: { custom: { reminders: { 0: { id: "m", text: "秘密のメモ" } } } } } },
    });
  });
});

const db = (uid) => env.authenticatedContext(uid).database();
const statePath = `rooms/${ROOM}/state`;

describe("フェイズと公開フラグは GM だけ", () => {
  it("PL は sessionPhase を変えられないが、他の項目は書ける", async () => {
    await assertFails(db("pl1").ref(`${statePath}/sessionPhase`).set("end"));
    await assertSucceeds(db("pl1").ref(`${statePath}/log/1`).set("PL の行動"));
  });

  it("PL が state 全体を書くとき、sessionPhase を変えていなければ通る", async () => {
    const snap = await env.withSecurityRulesDisabled(ctx => ctx.database().ref(statePath).get());
    const cur = snap.val();
    await assertSucceeds(db("pl1").ref(statePath).set({ ...cur, log: { 0: "start", 1: "x" } }));
    await assertFails(db("pl1").ref(statePath).set({ ...cur, sessionPhase: "epilogue" }));
  });

  it("PL は scenarioRevealed を立てられない。GM は立てられる", async () => {
    await assertFails(db("pl1").ref(`${statePath}/scenarioRevealed`).set(true));
    await assertSucceeds(db("gm").ref(`${statePath}/scenarioRevealed`).set(true));
    await assertSucceeds(db("gm").ref(`${statePath}/sessionPhase`).set("end"));
  });
});

describe("GM の要求の定義", () => {
  it("PL は読めるが書けない。GM は書ける", async () => {
    await assertSucceeds(db("pl1").ref(`rooms/${ROOM}/gmRequests`).get());
    await assertFails(db("pl1").ref(`rooms/${ROOM}/gmRequests/r1/title`).set("偽の要求"));
    await assertFails(db("pl1").ref(`rooms/${ROOM}/gmRequests/r2`).set({ id: "r2", kind: "notice" }));
    await assertSucceeds(db("gm").ref(`rooms/${ROOM}/gmRequests/r2`).set({ id: "r2", kind: "notice" }));
  });

  it("PL は回答（state.reqResponses）を書ける", async () => {
    await assertSucceeds(db("pl1").ref(`${statePath}/reqResponses/r1/pl1`).set({ dice: { 0: 3 } }));
  });
});

describe("GM 用の独自要素（タイミングのメモ）", () => {
  it("GM だけが読み書きできる", async () => {
    const path = `roomSecrets/${ROOM}/gm/custom`;
    await assertFails(db("pl1").ref(path).get());
    await assertFails(db("pl1").ref(`${path}/reminders/1`).set({ id: "x", text: "y" }));
    await assertSucceeds(db("gm").ref(path).get());
    await assertSucceeds(db("gm").ref(`${path}/reminders/1`).set({ id: "x", text: "y" }));
  });
});

describe("プロット配置", () => {
  const commits = `${statePath}/battle/plotCommits`;
  const revealed = `${statePath}/battle/plotRevealed`;

  it("コミットは自分のキャラだけ。NPC は GM", async () => {
    await assertSucceeds(db("pl2").ref(`${commits}/pl2`).set("h2"));
    await assertFails(db("pl2").ref(`${commits}/pl1`).set("偽"));
    await assertFails(db("pl1").ref(`${commits}/npc1`).set("偽"));
    await assertSucceeds(db("gm").ref(`${commits}/npc1`).set("hn2"));
  });

  it("公開も自分のキャラだけ", async () => {
    await assertSucceeds(db("pl1").ref(`${revealed}/pl1`).set({ cell: 3, nonce: "n" }));
    await assertFails(db("pl2").ref(`${revealed}/pl1`).set({ cell: 5, nonce: "x" }));
    await assertSucceeds(db("gm").ref(`${revealed}/npc1`).set({ cell: 2, nonce: "g" }));
  });
});

describe("未参加のユーザー", () => {
  it("state を書けない", async () => {
    await assertFails(db("stranger").ref(`${statePath}/log/1`).set("x"));
  });
});
