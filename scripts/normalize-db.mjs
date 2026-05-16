#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { ref, get, update } from "firebase/database";
import { db } from "../src/firebase.js";
import { OFFICIAL_DANMAKU_SKILLS } from "../src/data/gameData.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply") || args.includes("-a");

function checkKeys(obj, keys) {
  if (!obj || typeof obj !== "object") return [];
  return keys.filter(k => Object.prototype.hasOwnProperty.call(obj, k));
}

function normalizeEnemy(enemy) {
  if (!enemy || typeof enemy !== "object") return enemy;

  const ds = enemy.ds ?? {};
  const type = ds.type ?? enemy.dsType ?? (enemy.dsName ? "official" : (enemy.dsCustomName || enemy.dsDesc ? "custom" : "none"));
  const name = ds.name ?? enemy.dsName ?? enemy.dsCustomName ?? "";
  const customName = ds.customName ?? enemy.dsCustomName ?? "";
  const desc = ds.desc ?? enemy.dsDesc ?? (type === "official" ? (OFFICIAL_DANMAKU_SKILLS.find(x => x.name === name)?.desc || "") : "");

  return {
    ...enemy,
    ds: { type, name, desc, customName },
  };
}

function normalizePlayer(player) {
  if (!player || typeof player !== "object") return player;

  const ps = player.ps ?? player.personalitySkill ?? (player.skillId ? {
    id: player.skillId,
    name: player.skillName ?? "",
    type: null,
    desc: null,
  } : null);

  const ds = player.ds ?? (player.dsType || player.dsName || player.dsCustomName || player.dsDesc ? {
    type: player.dsType ?? (player.dsName ? "official" : (player.dsCustomName || player.dsDesc ? "custom" : "none")),
    name: player.dsName ?? player.dsCustomName ?? "",
    desc: player.dsDesc ?? "",
    customName: player.dsCustomName ?? "",
  } : null);

  return {
    ...player,
    ps,
    ds,
  };
}

function normalizeScenario(scenario) {
  if (!scenario || typeof scenario !== "object") return scenario;
  let changed = false;

  const finalBattleEnemies = (scenario.finalBattleEnemies || []).map((enemy) => {
    if (!enemy) return enemy;
    const normalized = normalizeEnemy(enemy);
    if (normalized !== enemy && JSON.stringify(normalized) !== JSON.stringify(enemy)) changed = true;
    return normalized;
  });

  const quests = (scenario.quests || []).map((quest) => {
    if (!quest || typeof quest !== "object") return quest;
    const enemy = quest.enemy;
    if (!enemy) return quest;
    const normalizedEnemy = normalizeEnemy(enemy);
    if (JSON.stringify(normalizedEnemy) !== JSON.stringify(enemy)) changed = true;
    return { ...quest, enemy: normalizedEnemy };
  });

  const normalized = { ...scenario, finalBattleEnemies, quests };
  return { normalized, changed };
}

function normalizeRoomState(state) {
  if (!state || typeof state !== "object") return { normalized: state, changed: false };
  let changed = false;
  const normalizedState = { ...state };

  if (Array.isArray(state.pcs)) {
    const pcs = state.pcs.map((pc) => {
      const normalizedPc = normalizePlayer(pc);
      if (JSON.stringify(normalizedPc) !== JSON.stringify(pc)) changed = true;
      return normalizedPc;
    });
    normalizedState.pcs = pcs;
  }

  const npcs = state?.battle?.participants?.npcs;
  if (Array.isArray(npcs)) {
    const normalizedNpcs = npcs.map((npc) => {
      const normalizedNpc = normalizeEnemy(npc);
      if (JSON.stringify(normalizedNpc) !== JSON.stringify(npc)) changed = true;
      return normalizedNpc;
    });
    normalizedState.battle = {
      ...state.battle,
      participants: {
        ...state.battle?.participants,
        npcs: normalizedNpcs,
      },
    };
  }

  return { normalized: normalizedState, changed };
}

function normalizePlayers(players) {
  if (!players || typeof players !== "object") return { normalized: players, changed: false };
  let changed = false;
  const normalized = {};

  for (const [pid, player] of Object.entries(players)) {
    const normalizedPlayer = normalizePlayer(player);
    if (JSON.stringify(normalizedPlayer) !== JSON.stringify(player)) changed = true;
    normalized[pid] = normalizedPlayer;
  }

  return { normalized, changed };
}

async function normalize() {
  console.log("DB normalize script starting.");
  console.log(apply ? "Mode: apply changes" : "Mode: dry run (no writes). Use --apply to persist changes.");

  const rootSnap = await get(ref(db, "rooms"));
  if (!rootSnap.exists()) {
    console.log("No rooms found.");
    return;
  }

  const rooms = rootSnap.val();
  const report = { generatedAt: new Date().toISOString(), rooms: {}, summary: { roomsScanned: 0, roomsUpdated: 0 } };

  for (const [roomId, room] of Object.entries(rooms)) {
    const roomChanges = {};
    const roomReport = { changes: [] };

    if (room.scenarioData) {
      const { normalized, changed } = normalizeScenario(room.scenarioData);
      if (changed) {
        roomChanges["scenarioData"] = normalized;
        roomReport.changes.push("scenarioData");
      }
    }

    if (room.state) {
      const { normalized, changed } = normalizeRoomState(room.state);
      if (changed) {
        roomChanges["state"] = normalized;
        roomReport.changes.push("state");
      }
    }

    if (room.players) {
      const { normalized, changed } = normalizePlayers(room.players);
      if (changed) {
        roomChanges["players"] = normalized;
        roomReport.changes.push("players");
      }
    }

    if (roomReport.changes.length) {
      report.rooms[roomId] = roomReport;
      report.summary.roomsUpdated += 1;
      if (apply) {
        await update(ref(db, `rooms/${roomId}`), roomChanges);
        console.log(`Updated room ${roomId}:`, roomReport.changes.join(", "));
      } else {
        console.log(`Would update room ${roomId}:`, roomReport.changes.join(", "));
      }
    }

    report.summary.roomsScanned += 1;
  }

  fs.mkdirSync(path.resolve("reports"), { recursive: true });
  const outPath = path.resolve("reports", `normalize-db-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`Scan complete. Rooms scanned: ${report.summary.roomsScanned}. Rooms with updates: ${report.summary.roomsUpdated}.`);
  console.log(`Report written to ${outPath}`);
}

normalize().catch((error) => {
  console.error("Normalization failed:", error);
  process.exit(1);
});
