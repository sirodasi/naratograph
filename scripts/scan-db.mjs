#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { ref, get } from "firebase/database";
import { db } from "../src/firebase.js";

function checkKeys(obj, keys) {
  if (!obj || typeof obj !== "object") return [];
  return keys.filter(k => Object.prototype.hasOwnProperty.call(obj, k));
}

async function scan() {
  try {
    console.log("Scanning Firebase Realtime Database for legacy ds fields...");
    const roomsSnap = await get(ref(db, `rooms`));
    if (!roomsSnap.exists()) {
      console.log("No rooms found in DB.");
      return;
    }
    const rooms = roomsSnap.val();
    const report = { generatedAt: new Date().toISOString(), rooms: {}, summary: { roomsWithLegacy: 0 } };

    const legacyKeys = ["dsName", "dsType", "dsDesc", "dsCustomName", "skillId", "skillName", "personalitySkill"];

    for (const [roomId, room] of Object.entries(rooms)) {
      const roomReport = { legacyFields: [] };

      const sd = room.scenarioData;
      if (sd) {
        (sd.finalBattleEnemies || []).forEach((en, idx) => {
          const found = checkKeys(en, legacyKeys);
          if (found.length) roomReport.legacyFields.push({ path: `scenarioData.finalBattleEnemies[${idx}]`, keys: found });
        });
        (sd.quests || []).forEach((q, qi) => {
          const en = q?.enemy;
          const found = checkKeys(en, legacyKeys);
          if (found.length) roomReport.legacyFields.push({ path: `scenarioData.quests[${qi}].enemy`, keys: found });
        });
      }

      if (room.players) {
        Object.entries(room.players).forEach(([pid, p]) => {
          const found = checkKeys(p, ["skillId", "skillName", "personalitySkill", "ps", "dsName", "dsType", "dsDesc", "dsCustomName"]);
          if (found.length) roomReport.legacyFields.push({ path: `players.${pid}`, keys: found });
        });
      }

      if (room.state) {
        const st = room.state;
        const npcs = st?.battle?.participants?.npcs || [];
        npcs.forEach((n, idx) => {
          const found = checkKeys(n, ["dsName", "dsType", "dsDesc", "dsCustomName"]);
          if (found.length) roomReport.legacyFields.push({ path: `state.battle.participants.npcs[${idx}]`, keys: found });
        });
        const pcs = st.pcs || [];
        pcs.forEach((p, idx) => {
          const found = checkKeys(p, ["dsName", "skillName", "skillId", "ps", "personalitySkill"]);
          if (found.length) roomReport.legacyFields.push({ path: `state.pcs[${idx}]`, keys: found });
        });
      }

      if (roomReport.legacyFields.length) {
        report.rooms[roomId] = roomReport;
        report.summary.roomsWithLegacy += 1;
      }
    }

    fs.mkdirSync(path.resolve("reports"), { recursive: true });
    const outPath = path.resolve("reports", `db-scan-${Date.now()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`Report written to ${outPath}`);
    console.log(`Rooms with legacy fields: ${report.summary.roomsWithLegacy}`);
  } catch (e) {
    console.error("Error scanning DB:", e);
    process.exit(1);
  }
}

scan();
