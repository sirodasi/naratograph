# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**幻想ナラトグラフ (Gensou Naratograph)** is a real-time collaborative TRPG (Tabletop RPG) session support web app for Touhou Project-themed tabletop gaming. GMs and players connect to shared rooms via Firebase Realtime Database, which serves as the single source of truth.

## Commands

```bash
npm run dev          # Vite dev server with HMR
npm run build        # Production build
npm run lint         # ESLint (flat config)
npm run preview      # Preview production build locally
npm run normalize-db # Node script to normalize Firebase DB schema
npm test             # Vitest in watch mode
npm run test:run     # Vitest single run
```

### Running a single test

```bash
npx vitest run src/__tests__/danmaku.test.js                       # one file
npx vitest run src/__tests__/danmaku.test.js -t "条件文を抽出"      # one test by name fragment
```

Tests live in [src/__tests__/](src/__tests__/). Firebase is mocked via [src/__tests__/setup.js](src/__tests__/setup.js); individual test files also `vi.mock('../firebase', ...)` defensively. There is no `firebase` real call from tests.

## Architecture

### Tech Stack

- **React 19** (functional components + hooks only; the sole class component is `ErrorBoundary`, which React requires to be a class)
- **Firebase 12** (Realtime Database + Google OAuth)
- **Vite 8** with `@vitejs/plugin-react` (Oxc transform)
- **Styling**: Inline styles throughout; color constants live in [src/styles/colors.js](src/styles/colors.js)

### Session Flow

```
Lobby → PrepRoom → Intro → Explore → Battle → (Bonus) → Epilogue → End
```

1. **Lobby** (`Lobby.jsx`): Auth, room creation/joining, character + skill selection
2. **PrepRoom** (inside `App.jsx`): GM loads scenario; PLs confirm ready
3. **Intro**: Backstory narrative screen
4. **Explore**: Map movement, resource management, quest/clue discovery
5. **Battle**: Turn-based danmaku (bullet pattern) mini-game
6. **Bonus** (optional, config-gated): Extra actions if solving before the time limit
7. **Epilogue** (`sessionPhase: "epilogue"`, `EpilogueView`): after the **final** battle (any outcome, `isFinal`), a 終幕 depiction shown to all before the end screen. Uses the **same scene-mode UI as explore's 描写** — `SceneStage` (bg + 立ち絵 + text) + GM-side `SceneEditor` (both exported from `SessionView.jsx`, also used by `MapView`/`RightPanel`); data flows through `sceneData` (`rooms/{roomCode}/scene` — `{ bg, portraits, fx }`; the scene listener in App.jsx must read **all three** back) + `gs.sceneText`. `finishBattle` routes `isFinal ? "epilogue" : "explore"`. Images are encoded transparency-preserving (webp→PNG fallback) for portraits, JPEG for bg (`loadImage(..., transparent)`).
   - **Portraits** (`{ img, name, x, y, h, flip, hidden, faces[], face }`, x,y = bottom-center %, h = height %, max 8; legacy `{img,name}` falls back to a centered-bottom spread): GM-only `editable` `SceneStage` lets the GM **drag** to place (local state during drag, commits on pointer-up to avoid Firebase spam) + a per-portrait toolbar (size/flip/layer/隠す/delete/表情). `hidden` skips render; **expressions** = `faces[]` of images with `img` always synced to the current `face`. `SceneEditor` lists portraits with 👁 visibility + a 表情 strip (select/add/remove).
   - **Effects** (`sceneData.fx = { particles, tone }`): `SceneParticles` CSS layer (桜/雪/光粒/雨) + a tone overlay (夕焼け/夜/セピア/暗転/暖色), rendered above portraits / below the text box.
   - **Scene presets** (`users/{uid}/scenePresets/{id}` = `{ name, bg, portraits, fx, text }`): `SceneEditor` (given `user`) saves the current composition and reloads it (overwrites sceneData + `gs.sceneText`) — set up scenes in advance, reuse across sessions.
8. **End** (`SessionEndView`): result + 成長 ceremony; the GM's end button exports the log (.txt) and **deletes the Firebase room** (`remove(rooms/{roomCode})`) — clients then hit `roomPhase: "error"`.

Phase is tracked as `gs.sessionPhase` and transitions are explicit with confirmation modals.

### Responsive / Mobile

`useIsMobile(breakpoint = 820)` ([src/useIsMobile.js](src/useIsMobile.js), shared to avoid an App↔Lobby import cycle) drives layout switches via `window.matchMedia`. On mobile (`SessionApp`): the `RightPanel` (normally a fixed 300px sidebar) becomes a right-side **drawer** (`min(90vw,360px)`, `translateX` toggled by a floating ☰/✕ button + tap-backdrop); content (map/battle) goes full-width. `RightPanel` takes a `width` prop (300 desktop / "100%" mobile). The drawer **auto-opens** when `currentScene.pcUid === user.uid` (your turn), and the button pulses (`panelAlertGlow`) while your scene is active and the drawer is closed. `PrepRoom` (Lobby) stacks its two columns (`flexDirection` column) and wraps the header on mobile; the character grid already uses `auto-fill`. Battle grids (`BattleGrid` fixed 210px) wrap via the existing `flexWrap`; modals are `width: "90%"` + `maxWidth`.

### State Management

Firebase Realtime Database is the **only** source of truth. The `gs` (game state) object is synced to `rooms/{roomCode}/state`. All mutations go through the `upd()` callback:

```javascript
// upd() in App.jsx — optimistic local update + async Firebase write
const upd = useCallback((fn) => {
  let fired = false;  // prevents double Firebase write (React StrictMode / Concurrent Mode)
  setGs(prev => {
    const next = typeof fn === "function" ? fn(prev) : fn;
    if (!fired) { fired = true; set(ref(db, gsPath), next).catch(console.error); }
    return next;
  });
}, [gsPath]);
```

Local React state is only used for UI-only concerns (hover, modals, animation frames). Never write game state to local state directly — always go through `upd()`.

Firebase strips empty arrays on write — always guard array reads with `|| []`.

**Double-write / log duplication**: Because React batches multiple `setGs` calls, if `upd()` is called twice quickly the second updater receives the first's result as `prev`, causing the same log entry to be appended twice and written to Firebase. Guard against this at the UI level:
- Clear guard state **before** calling `upd()` (e.g. `setSceneSelect("")` then `upd(...)`)
- Use `useRef(false)` as a one-shot flag for full-screen clickable areas (see `BackstoryScreen`)

### Firebase Schema

```
rooms/{roomCode}/
├── gmUid, gmName, phase
├── players/{uid}/{ charId, charName, personalitySkill, role, ready }
├── scenario, scenarioData
├── config/{ useAdditionalActions, useClueEvents, useRandomPlacement, useLastResort }
├── state   ← gs object (entire game state)
├── scene   ← background/portrait data for scene mode
└── presence/{uid}/{ online, name, ts }  ← live presence (onDisconnect-managed)
```

`config` lives at `rooms/{roomCode}/config`, **not** inside `gs`. Components that need config must receive `room` as a prop (not just `gs`).

### Connection & Presence

`SessionApp` watches Firebase `.info/connected`; on disconnect it shows a fixed top banner (`connected` state). On (re)connect it registers `rooms/{roomCode}/presence/{uid}` with an `onDisconnect().remove()` so the entry self-cleans when the tab closes or drops. The full `presence` map is subscribed and passed to `RightPanel` → `PCCard` as `isOnline` (green/grey dot on the portrait). Presence writes use `serverTimestamp()` for `ts`.

A class-based `ErrorBoundary` ([src/ErrorBoundary.jsx](src/ErrorBoundary.jsx)) wraps `<App>` in [main.jsx](src/main.jsx) — the **only** sanctioned class component (React error boundaries cannot be functional). It shows a reload-prompt fallback instead of a white screen; game state survives because it lives in Firebase.

### Key `gs` Fields

| Field | Description |
|---|---|
| `sessionPhase` | `"intro" \| "explore" \| "battle" \| "battle_bonus" \| "end"` |
| `day`, `cycleIdx` | Current day (1–5) and time slot (0=朝, 1=昼, 2=夕, 3=夜) |
| `pcs[]` | Player character array with resources, position, items |
| `actedPcs[]` | UIDs of PCs who have acted this cycle (cleared each cycle advance) |
| `battle` | Full battle state (phase, round, participants, danmaku grid) |
| `quests[]` | Quest list with solved status and enemy references |
| `clues[]` | Spot IDs that currently have clue tokens |
| `currentScene` | Active scene state (`{ pcUid, phase, isAutoSuccess?, ... }`); `null` when no scene. `isAutoSuccess: true` is set by 瀟洒 skill to force success in `explore_result` regardless of dice. |
| `resources` | Shared party resources (やる気, 残り人数, etc.) |
| `log[]` | Session event log (prepend new entries: `[newMsg, ...p.log]`) |
| `diceHistory[]` | Roll history `{ label, results[], max, t }`; written by `animateDice` on roll-confirm (prepend, capped at 50). Surfaced in `RightPanel`'s 進行 tab (collapsible) and exported by `SessionEndView`. |
| `bgm` | GM-set BGM track URLs `{ explore, battle, end }`. Each client plays the phase-appropriate track locally (see BGM section). |

### Major Components

| File | Responsibility |
|---|---|
| [App.jsx](src/App.jsx) | Root: Firebase listeners, phase routing, BFS pathfinding (`getDistances`), map rendering |
| [SessionView.jsx](src/SessionView.jsx) | **~7200-line monolith**: multiple exported functions (see below) |
| [Lobby.jsx](src/Lobby.jsx) | Auth flow, room prep, character + skill selection, extra rule toggles |
| [ScenarioEditor.jsx](src/ScenarioEditor.jsx) | GM tool for authoring scenarios, quests, enemies, danmaku skills |
| [firebase.js](src/firebase.js) | Firebase init + auth providers |

`SessionView.jsx` exports several independent top-level functions (approximate line numbers — drift as the file evolves):

| Function | Approx. line | Responsibility |
|---|---|---|
| `BattleView` | ~680 | Danmaku combat UI and phase state machine |
| `CharDetailModal` | ~3930 | Read-only character sheet (spell cards full text, skills, bonds, 変調); opened via the 🔍 button on `PCCard` |
| `BonusPhaseView` | ~3650 | Post-solve bonus action phase |
| `SessionEndView` | ~3790 | End-of-session summary |
| `PCCard` | ~4010 | Per-PC card with scene/action UI |
| `ScenePanel` | ~5050 | Scene player action panel (move, explore, quest, etc.) |
| `RightPanel` | ~6400 | GM sidebar: newspaper, cycle control, scene launching, log search/filter, keyboard shortcuts |
| `BattleRightPanel` | ~7050 | Battle info sidebar rendered inside `RightPanel` |

`RightPanel` registers a `window` keydown listener (GM-operation shortcuts): `1`–`4` switch tabs, `Enter` runs the current `getMainAction()` (`ma`) result, `M` toggles sfx, `?` opens the shortcut help modal. The handler reads `ma`/`TABS` through refs (`maRef`/`tabsRef`) updated every render so the listener (registered once on mount) always sees current values; it no-ops while an `INPUT`/`TEXTAREA`/`SELECT`/contentEditable is focused or a modifier key is held. The log tab has a text search box + category filter chips (combat/player/success/reward) driven by emoji-prefix classification.

`BattleRightPanel` is a **separate top-level function**, not a closure inside `BattleView`. Functions defined inside `BattleView` are not accessible from `BattleRightPanel`; shared logic must be defined at module level or passed as props.

`BattleRightPanel`'s log tab snapshots `gs.log.length` on mount via `useRef((gs.log || []).length)`, then renders only `log.slice(0, currentLen - snapshot)` to scope display to entries added during the current battle (logs are prepended, so newer entries are at the front).

### Data Files

| File | Contents |
|---|---|
| [src/data/characters.js](src/data/characters.js) | 60+ characters with abilities and spells; exports `PERSONALITY_SKILLS` (21 skills keyed by D66 roll) |
| [src/data/gameData.js](src/data/gameData.js) | Spots, edges, newspaper effects (D66), danmaku skills |
| [src/data/spots.js](src/data/spots.js) | Spot descriptions and event text |
| [src/data/spellCardEffects.js](src/data/spellCardEffects.js) | **Master spell-card effect definitions** (`SPELL_CARD_EFFECTS` map): auto-processability flag (`auto: full/partial/manual`), timing, steps, conditions. Looked up by name via `getSpellCardEffect()`. |
| [src/data/effectHandlers.js](src/data/effectHandlers.js) | **Pure grid-manipulation functions** for structured spell steps: `applyStep`, `applyAfterEffect`, `applyRandomResult`, `resolveCount`, `isChoiceStep`, `isRandomStep`, `analyzeSteps`. No React/Firebase dependency — fully unit-testable. |

### Danmaku Combat System

The battle mini-game uses a 6-cell grid. Each round has two half-rounds (PC attacks then NPC attacks, or vice versa). The phase state machine inside `BattleView`:

```
setup → round_start → {pc,npc}_shot_intro → {pc,npc}_shot_roll → {pc,npc}_shot_after
      → {pc,npc}_evade_intro → {pc,npc}_evade_move → {pc,npc}_hit_check
      → {pc,npc}_hit_recovery | {pc,npc}_dropout → round_end_check → cleanup → result
```

Key battle state fields (`gs.battle.*`):

| Field | Description |
|---|---|
| `active` | `true` while battle is in progress |
| `type` | `"normal"` or `"mass"` (集団戦) |
| `questId` | ID of the quest this battle resolves (if any) |
| `scenePcUid` | UID of scene player who triggered a quest battle (added to `actedPcs` on finish) |
| `phase` | Current battle phase string |
| `round` | Current round number |
| `pcCombatant` | UID of the active PC combatant |
| `npcCombatant` | ID of the active NPC combatant |
| `grids` | `{ [entityId]: [0..5] }` — bullet counts per cell |
| `positions` | `{ [entityId]: 1–6 }` — current cell positions |
| `usedds` | `{ [attackerId]: string[] }` — danmaku skills used this battle |
| `usedIntervention` | `{ [uid]: "support" \| "cover" }` — spectator interventions per round |
| `pcLastResort` / `npcLastResort` | 喰らいボム used this round (reset each round) |
| `declaredSpellcard` | Spellcard declared at round start |
| `spellChoose` | Active CHOOSE selection: `{ attackerId, defenderId, remaining, selected[], excludeEnemyCell }` — set when player must pick grid cells |
| `spellRollCheck` | Active roll-check: `{ attackerId, defenderId, attPos, defPos, snapDef, snapAtk, check:{dice,target}, success[], fail[], spellName }` — set when a `roll_check_then_place` step is pending (宇佐見菫子スペカ等) |
| `spellMoveSelect` | Active move pick: `{ targetId, candidates[], spellName, isPcAttacker }` — set when a spell's move effect needs the attacker to pick a destination cell. `targetId` is whoever moves (defender for `enemy_move_adjacent*`; attacker for `self_move_*`). Display/handler key on `isPcAttacker` (the attacker operates it). `handleSpellMoveCell` sets `positions[targetId]`. Auto-move variants (`enemy_forced_to_attacker_number_cell`→`attPos`, `self_move_to_enemy_number`→`defPos`) skip the select and write `posPatch` directly. All these spells are `auto: "full"` so placement runs through the structured deterministic/random block, then `declareSpell` derives the move from `structured.effects`. |
| `slowBulletProtect` | `{ [entityId]: cellNum[] }` — cells protected by 低速弾. `confirmSlowBullet` records (does **not** mutate grid); `handleCleanup`'s decay does `min(val, decayed+1)` on protected cells so one would-be-removed bullet stays. Reset each round. |
| `extraInterventionPool` | Extra 援護/かばう rights from spells like 忿怒のレッドUFO襲来: `{ remaining: N, usedDice: [], withDieChoice: bool }`. `withDieChoice: true` lets spectators pick any unused die face instead of rolling. Reset to `null` in `handleCleanup`. |

Danmaku skill utilities (module-level exports in `SessionView.jsx`):
- `hasOfficialSkill(entity, skillName)` — checks `entity.ds.name` / `entity.dsName` / `entity.skillName` / `entity.ps.name` against `OFFICIAL_DANMAKU_SKILLS` (ds.name takes precedence)
- `isSkillUsed(usedds, attackerId, skillName)` — checks `usedds[attackerId]` array
- `markSkillUsed(usedds, attackerId, skillName)` — returns a new `usedds` map with the skill appended (immutable)

`BattleView` also defines instance-scoped wrappers `isDanmakuUsed(id, name)` / `markDanmakuUsed(id, name)` that read/write `b.usedds` via the closure's `upd`. Use the module-level versions from outside `BattleView`.

Skill data on enemies is stored as `ds: { name, desc }` (normalized from legacy flat fields via `normalizeScenario()` in `App.jsx`).

### Spell-card data flow

To keep Firebase writes small, the canonical spell-card representation is **raw text** (PC) or `{name, desc, ref?}` (NPC). Derived fields are recomputed at render time.

- **Storage**: PC `spellCards[]` and `growthSpellCard` in `gs.pcs` are stored as raw strings. NPC `spellCards[]` are stored as `{ name, desc, ref? }` (omit `ref` when empty). `normalizeScenario()` in `App.jsx` does **not** pre-build spell objects.
- **Rendering**: `buildSpellCard(card)` (exported from `SessionView.jsx`) accepts a string or an object and returns a full view-model with `name`, `text`, `textBody`, `condition`, `effects`, `timing`, `effectTiming`, `manual`, `structured`. Call at render time only.
- **In-battle persistence** (`pendingSpell`, `manualSpell` in `gs.battle`): store via `slimSpellForStorage(spellCard)` (only `name`, `text`, `manual`, optional `ref`). Read via `expandStoredSpell(stored)` to rebuild derived fields. The expand helper is tolerant of legacy full-shape data.
- **Condition extraction**: `parseSpell` runs `extractCondition(text)` which locates `"このスペルカード"` and returns the first sentence containing `できない` / `限り使用できない` / `場合にしか使用できない`. `textBody` is `text` with that condition sentence stripped — render `textBody` for the body and `condition` separately with the ⚠ warning to avoid duplication.

**Structured step choice types** (`effectHandlers.js` `isChoiceStep()`): when a step requires player interaction, `applyStep()` returns `{ needsChoice: true, choiceType }`. Handled in `declareSpell`:
- `designated` / `choice_fixed` / `clear_chosen_then_random` → sets `gs.battle.spellChoose` for cell-pick UI (works for both `auto: "full"` and `auto: "partial"`)
- `roll_check_then_place` → sets `gs.battle.spellRollCheck`; after the player rolls, `resolveSpellRollCheck()` applies the `success[]` or `fail[]` substeps (which may be deterministic, random, or designated)
- `directional_move_shoot` / `duplicate_previous_shot` → falls through to manual (GM-handled)

**Stat-based step counts**: `step.count` can be `{ type: "stat", stat: "グレイズ", multiplier: N }`. `applyStep()` treats unknown-type count objects as `rawCount=1`. Always call `resolveCount(step.count, attackerEntity)` before `applyStep()` to get the actual number from the entity's current resource value. `resolveCount` is imported from `effectHandlers.js`.

**`extra_support_cover` / `extra_support_cover_with_die_choice` / `double_support_cover` effect types**: grant extra intervention rights. `declareSpell` checks for these after the steps block and sets `gs.battle.extraInterventionPool` (`double_support_cover` (上海人形) has no `count` → defaults to 2). Spectator buttons (援護/かばう) in `BattleRightPanel` consume from the pool. `withDieChoice: true` (忿怒のレッドUFO襲来) lets the player pick any unused die face; normal variant (フォーオブアカインド) rolls randomly.

**`extra_familiar_per_round_this_phase`** (ホークビーコン): a **phase-long, once-per-round** intervention right for a specific entity, distinct from the one-shot `extraInterventionPool`. Declared in the full-random block → appends `attackerId` to `gs.battle.extraFamiliarPhase[]`. `BattleRightPanel` shows a 🦅 intervention block to holders (`hasHawkBeacon`) with its own counter `gs.battle.usedExtraFamiliar[uid]` (so it stacks on top of the normal `usedIntervention` and 使い魔). `usedExtraFamiliar` resets every round in `handleCleanup`/`startRound`; `extraFamiliarPhase` persists (carried via `...currentB`) until the battle ends.

**Dodge-step flags** set at declaration, read during the evade step, reset each round in `handleCleanup`/`startRound`:
- **`enemy_may_stay_on_dodge`** (正直者の死/吉弔大結界): sets `gs.battle.mayStayOnDodge`. `renderEvadeMove` then shows a "🛡 その場にとどまって回避する" button → `handleEvadeStay` clears the dodger's current cell + gains グレイズ + spends evade dice **without moving the piece**.
- **`next_dodge_no_evasion_loss`** (オプティカルカモフラージュ): sets `gs.battle.noEvasionLoss[attackerId] = true`. In `handleEvadeMove`/`handleEvadeStay`, when the mover has this flag, `nextDice` is **not** decremented and the flag is consumed (set false). One free dodge.
- **`mirror_graze_gain`** (ミシガンロール): `gs.battle.mirrorGraze[attackerId]`. `applyMirrorGraze` (called in `handleEvadeMove`/`handleEvadeStay`) adds the dodger's just-gained グレイズ to each holder (except the dodger).
- **`place_at_enemy_after_first_dodge`** (全霊鬼渡り) / **`random_3d_after_first_dodge`** (マッスル/狐符): `gs.battle.afterDodgeShot[attackerId] = { type, count, used? }`. On the **first** successful dodge, `applyAfterDodgeShot` either places `count` on the dodger's moved-to cell (place; synchronous) or sets `gs.battle.pendingDodgeRandom` (random_3d) — the central panel then shows a "🎲 ND を振って配置" button (`handleDodgeRandomRoll`) for the attacker. `used` marks the one-shot consumed.

**Misc declaration-time penalties/flags** (reset each round): `self_hp_loss_if_no_damage` (太陽を盗んだ鴉) → `suntanPenalty[id]`; checked against `hpReducedThisRound[id]` (set in `applyHit`) at `handleCleanup` to deduct 残り人数 if the holder wasn't hit. `extra_hp_loss_if_same_cell_fail` (余命幾許) → `zanmeiPenalty[id]`; `applyHit` adds an extra −1 when the holder shares the被弾側's cell number.

**Move / optional-action picks** (attacker-operated UI, keyed by `isPcAttacker` or `attackerId`, reset each round): `spellMoveSelect` (enemy/self move), `optionalRedo` (ブラックペガサス re-place), `optionalClear` (ドリームキャッチャー: toggle cells → remove → random×N), `preSpellMove` (死歌/怒面/貧符: move-then-place 2-stage). Each has its own branch at the top of `renderSpellStep`.

**Cell-placement constraint** (`condition_on_placement.exclude_enemy_cell: true` in `SPELL_CARD_EFFECTS`): propagated into `spellChoose.excludeEnemyCell`. The CHOOSE UI disables the defender's current cell.

**`structured.effects` auto-handling vs manual fallback** (`AUTO_HANDLED_EFFECTS` set in `SessionView.jsx`): only effect types in this set are auto-applied by `declareSpell`; everything else is **not silently dropped** — `buildSpellCard` collects them into `spellCard.manualEffects` and `SpellDeclareItem` shows a "⚠ 配置以外の効果はGMが手動で処理してください" warning (with the spell's `note`). Currently auto-handled: `extra_support_cover*` / `enemy_*move*` / `shift_non_25_horizontal`; post-random grid removals `remove_from_enemy_cell` (写真「籠もりパパラッチ」) / `remove_if_hit_enemy_cell` (天星馬「ペガサスクロス」); and **evasion changes** `reduce_enemy_evasion` / `increase_enemy_evasion` / `reduce_own_evasion` / `costs_own_evasion`. When you automate one, add its type here and the warning disappears automatically.

**Instant resource effects** (`computeResourceEffects` in `declareSpell`): applied at declaration. Returns `{ pcs, npcs, evRestore }`; the caller applies them to `p` before `mergeConsumeWithBattle` so SC-consume and the resource change coexist. Wired into all three placement paths (full-deterministic, full-random, designated-choose). Covers:
- **Evasion** (`reduce_enemy_evasion` / `increase_enemy_evasion` / `reduce_own_evasion` / `costs_own_evasion`): mutate `resources.回避力.cur` ±1 so `getDefaultEvadeDice` picks it up without touching the evade step. Saved in `gs.battle.evasionRestore[entityId]` and **restored in `handleCleanup`** (round-scoped) — **all four incl. `costs_own_evasion`** (杞人地). 回避力 recovers to max at round end by design, so 杞人地's "回避力 -1" is a current-value (not max) reduction biting only that round (先攻→後攻 evade starts at 2 / 後攻→fewer moves).
- **`reset_graze`** (バレットドミニオン/マーケット): attacker's グレイズ → 0 (after the X-count was already read via `resolveCount`). Permanent (not restored).
- **`costs_rei`** (五穀豊穣ライスシャワー): attacker's 霊力 -1, 攻撃力 recomputed as `1 + floor(霊力/5)`. Permanent.
- **`no_sc_cost`** (幻想春花): handled in `consumeSpell` itself (returns `p` unchanged when present).

**Still manual** (remaining): costs_rei is done; remaining are the post-dodge / on-hit / round-end timing effects (`random_3d_after_first_dodge`, `mirror_graze_gain`, `cancel_hp_reduction`, etc.) and the move-selection effects (`enemy_move_adjacent`, `self_move_*`, `pre_self_move_adjacent`, `optional_*`).

### Quest Resolution Types

Quests (`gs.quests[].solutionType`) support three resolution flows:

| Type | Flow |
|---|---|
| `"自動解決"` | Resolved automatically when enough clues are placed |
| `"行為判定"` | PCs at the quest spot roll dice; success/failure triggers penalty table |
| `"弾幕ごっこ"` | Starts a `type: "normal"` battle with `quest.enemy`; `finishBattle()` marks the quest solved on PC victory |

When starting a 弾幕ごっこ quest battle, set `battle.scenePcUid` to `currentScene.pcUid` so `finishBattle` can add the scene player to `actedPcs`.

### Map & Movement

`getDistances(startSpotId)` in `App.jsx` runs BFS over the spot graph (defined in `gameData.js`) to compute shortest paths. Results gate which spots a PC can move to in one turn.

### 能力スキル (Ability Skills) — ★全120能力 自動化完了

Each character has a base ability `pc.as = { name, type, desc }` and a grown version `pc.growthAbility` (same shape). `type` is `アクション` / `サポート` / `オート`. Built onto the PC object in `App.jsx` (both `as` and `growthAbility` are carried). There are **120** abilities (60 chars × {as, growthAbility}); 2 share a name (「魔法を使う程度の能力」＝霧雨魔理沙[アクション] / 聖白蓮[オート]) — disambiguated by `type`.

**Architecture mirrors spell cards**: declarative data in [src/data/abilityEffects.js](src/data/abilityEffects.js) (`ABILITY_EFFECTS` map + `getAbilityEffect(ability)` which resolves `byType` collisions via `ability.type`), handlers in `activateAbility` (PCCard). Each entry: `{ freq, auto, kind, params, passive?, note? }`.
- `freq`: usage limit `"day"` / `"session"` / `"scene"` / `null`. Tracked on `pc.abilityUse = { [name]: { day, session, sceneId } }`; `abilityUsedUp(ability)` gates the button, `withAbilityUse(base,name,freq)` records.
- `auto:true` + implemented `kind` → auto-applied. **Un-registered / un-implemented `kind` → manual fallback** (`activateAbility` logs `🔵 …を発動（効果はGMが処理）` so nothing silently breaks). Many kinds implemented — resource gains (`gain_yaruki`/`gain_rei`/`set_rei`/`gain_random_item`/`gain_choice_item`/`gain_yaruki_selfbond`/`reactive_gain`), cross-target pickers (`cure_bad_status`/`refresh_other_cheer_slot`/`destroy_one`/`boost_other_yaruki`/`surprise_bond`/`party_move`/`set_return_spot`/`grant_extra_scene`), `spend_item_gain_random`, scene re-process (`redo_own_scene`), subsystem (`spawn_minion`/`disguise`/`consume_rei_newspaper`).
- `reactive:true` → shows a 発動 button **even for オート** type (PCCard button condition `type !== "オート" || getAbilityEffect()?.reactive`); used for trigger-on-event abilities (死体を持ち去る etc.) where the player presses when the event fires.
- `passive:true` (オート) abilities have **no activate button**; effect woven into the subsystem site. Implemented passives: `applyAbilityPassiveStats` (虚無 霊力max), judgment-dice (`startAction`: パチュリー/打ち出の小槌), battle (`effectiveAttackPower` 剣術; `finishBattle` 怪力乱神), scene-end move (こいし 無意識), 拠点拡張 (`getBaseSpots`/`isAtBase`), movement BFS (`getAbilityMoveEdges` → `getDistances` extraEdges), 何でもひっくり返す (explore_result fumble/special flip), 比類なき脚力＋ (night やる気 in `doAdvanceCycle`).

**Activation UI**: `PCCard` shows the **active** ability (`activeAbility = grown ? growthAbility : as`) with a 「成長」 badge; non-`オート` types get a 発動 button → `SkillActivateModal` (reused, fully generic) → `activateAbility`. The old button was **broken** (reused the personality-skill `skillModal`); fixed to a dedicated `abilityModal`. **Always commit pc-update + log in one `upd`** (PCCard receives `upd` as a prop) — calling `onUpdatePc` then a separate `upd` for the log double-writes.

**成長 (growth)**: `growthAbilityUnlocked` (ability→＋) and `growthSpellUnlocked` (additional spell card) are **separate** unlock flags, each also toggleable in PCCard's GM-edit panel. `activeAbility = growthAbilityUnlocked ? growthAbility : as`.

The **session-end 成長 ceremony** (`GrowthCeremony` in `SessionView.jsx`, opened from `SessionEndView`'s 🌟 button): each player (GM: all PCs) chooses **成長** (both ok) — 弾幕スキル再修得 (pick from the session's appeared-character `ds` pool) + タグ獲得 (free text) — and **強化** (one of, each once-per-campaign) — 追加スペカ (`spell`) / 能力スキル＋ (`ability`) / 特別な絆 (`bond`, → `pc.specialBond = { target, targetUid, intimacy, word }`).

**Grown-character instances**: growth is persisted **per instance** to **Firebase `grownChars/{uid}/{instanceId}`** = `{ charId, charName, ds, tags[], enhancementsUsed[], specialBond, createdAt, updatedAt }` (NOT one-per-character). The ceremony writes to `pc.grownInstanceId` if the player joined as a grown char (updates it) or a **new id** if they joined ungrown (so the same base character grown in different playthroughs becomes **separate** selectable instances). `Lobby` lists the player's `grownChars` as a "★成長済みキャラクター" section alongside the ungrown base grid; selecting one sets `player.grownInstanceId` + writes the grown fields (tags = base+acquired, ds override, growth flags from `enhancementsUsed`, specialBond). PC build in App.jsx carries `specialBond` + `grownInstanceId`. `ProfilePage` (ScenarioEditor) has a "成長キャラ" tab to view/delete instances. The 特別な絆 "feeling word" is free-text (`specialBond.word`, default 敬意) → 《target への word》. **Session end** (`SessionEndView` delete-room button) returns clients to the lobby: App's `roomRef` listener clears `roomCode` + the `?room` URL param when the room no longer exists.

**親密度 (intimacy) live mechanics** (`pc.specialBond = { target, targetUid, intimacy, word, used }`): module-level `gainIntimacy(pcs, targetUid, amount, reason)` raises intimacy (1→10) of every holder whose `specialBond.targetUid` is that PC, and refreshes the cheer slot (`used=false`) each increase. Triggers: target's スペシャル (+1, in `explore_result` special reward + `confirmQuestRoll`) and 交流 (+1D6, in `proceed` when a non-self bond is newly acquired). The special bond **cheers** like a 《target への絆》 via `SPECIAL_BOND_CHEER` pseudo-label woven into `getSpecialBondCheer`→`renderCheerSection` (explore/quest) and `renderEvadeCheer` (danmaku); `cheerConsumePatch`/`applyCheer`/`applyCheerQuest`/evade-apply consume `specialBond.used` and roll **2 dice at intimacy 10** (1 otherwise).

**手下 (minion) subsystem**: `gs.minions = [{ id, ownerUid, ownerName, currentSpot }]`. `spawn_minion` adds one (人形/偶像 at spot, 式神 at base + SC cost). Rendered as a small 「手」 token layer in `MapView` (App.jsx). PCCard shows an owner-only panel to move (spot picker) / log an action / remove each minion. Minion-acts-in-scene re-processing is GM-run.

**★ All 120/120 automated (累計~59 commits)**. Notable infra built: `gs.unluckyPhase` (紫苑 phase-wide fumble), `gs.reiBoostTargets`→`doReiryoku` (隠岐奈), `gs.itemSwapTargets` (千亦), `gs.eternityNight`→`doAdvanceCycle` night re-run + `shortenLimit` (輝夜), `consume_others_item` reusing `ITEM_DATA.use` (女苑), newspaper `windReroll` in RightPanel (文), `pc.untargetable` toggle excluded from target pickers (ぬえ), `pc.offMap`→random placement at `startScene` (菫子), `immortalCost` (妹紅), minion scene (`currentScene.minionId`+`sceneSpot`), and **table-roll reroll woven into `animateDice`** (霊夢 空を飛ぶ): a 空を飛ぶ holder rolling アイテム/変調/ペナルティ/ハプニング/手がかりイベント表 gets a reroll prompt (`pendingReroll` state + `pendingRerollCb` ref in `SessionApp`; cb deferred until 確定; `pc.soraFlewDay` = once/day). Per-entry `note`s flag the only residual GM bits (＋-only "行為判定以外" extra rolls beyond the 5 tables). All effect-less/contextual `note`-only entries are still real automations living in ScenePanel/BattleView/RightPanel.

### 個性スキル (Personality Skills)

Each PC has one personality skill stored as `pc.ps = { id, name, type, desc }`. Skills are defined in `PERSONALITY_SKILLS` (exported from `characters.js`, keyed by D66 roll 11–66).

Key exported helpers in `SessionView.jsx`:

| Export | Purpose |
|---|---|
| `isBadStatusImmune(pc, bsName)` | Returns `true` if PC has 馬鹿 skill and is immune to the named 変調 |
| `PS_ONCE_FLAG` | String `"psUsedThisSession"` — stored on the PC object to track once-per-session skills |
| `BAD_STATUS_TABLE` | `{ 1..6: { name, desc } }` — maps dice results to 変調 names |

**Once-per-session skills** (カリスマ, 不夜城, ご執心, 直感, 用意周到): guarded by `pc[PS_ONCE_FLAG]`. Set this flag **on the PC object via `upd()`** when consuming the skill. Never reset during a session.

**馬鹿 immunity**: `pc.badStatusImmune` stores the one 変調 name the PC is immune to (chosen at skill acquisition). Always call `isBadStatusImmune(pc, bsName)` before applying a 変調 in explore/quest fumble handlers and quest penalty tables.

**瀟洒 auto-success**: Sets `currentScene.isAutoSuccess: true` instead of fake dice values. The `explore_result` handler checks `sc.isAutoSuccess || (maxDie >= target && !isFumble)`. Quest roll uses `{ success: true }` directly in the roll result object.

**赤貧**: Triggered in `ActionRenderer` when `act.item === "小銭"` and `pc.ps?.name === "赤貧"` — shows an item conversion picker instead of granting 小銭 directly.

**我儘**: Integrated into the 応援 (cheer) system — when the cheerer is the judge, **all** their unused bonds count as self-bonds (`getCheerBonds`/`getEvadeCheerBonds` 我儘 branch). No separate manual note needed.

### 応援 (Cheer) System

A 《〇〇への絆》 holder can cheer 〇〇's 行為判定 when at the same spot. Applies to all three judgment types: **explore**, **quest**, and **danmaku evasion (回避判定)**.

**Timing: post-roll (判定後).** Per the actual rules, a cheer is declared **after** the judgment is rolled and **rolls one additional die that is appended to the rolled-dice pool** (振り足し), then the result is re-evaluated. (It is NOT a pre-roll dice-count increment.) Because of this, quest and danmaku evasion **defer their fumble/special resolution** to a "確定/resolve" step so cheers can be applied first.

- **Bond storage**: bonds are plain string arrays in the canonical form `"〇〇への絆"` / `"〇〇自身への絆"` / `"〇〇からの絆"`. All acquisition paths (探索 act bond, ボーナス `handleBond`, ご執心, 怠け者, 移動同時獲得) must store this form — never a bare charName. (`gainBond` at ~line 6219 is **dead code** that stores bare names; do not wire it up.)
- **Cheer slot**: consuming a cheer sets `pc.bondUsed[bondName] = true`. The slot **recovers when that bond is (re)acquired** — every acquisition path clears `bondUsed[bondName]` (the `proceed` handler clears it for genuinely-new bonds; each site also passes an explicit `bondUsed: { [bond]: false }` so re-acquiring an already-held bond also refreshes it).
- **黒い応援欄（■）= `bondUsed[bond] === true`** (a bond already used to cheer and not yet refreshed); 白い/未チェック = `bondUsed` falsy. Rule text referring to 黒い応援欄 maps directly to `bondUsed` — **no separate subsystem**. e.g. 感情を操る程度の能力 = clear one used slot on another PC (`bondUsed[x]=false`); 魂の弱い所に入り込む程度の能力 = may cheer using a **used** bond (fail → ファンブル).
- **Eligibility helpers**: `getCheerBonds(cheerer, judgePc)` (explore/quest, in `ScenePanel`) and `getEvadeCheerBonds(cheererPc)` (danmaku, in `BattleView`). Self-cheer accepts **both** self-bond forms (`〇〇自身への絆` from 怠け者 / `〇〇への絆` from the ボーナス self action). 我儘 → all unused bonds usable when self-judging.
- **Apply (post-roll)**: each cheer rolls 1 die via `animateDice(1, …)` and appends it — explore → `currentScene.actionDice`; quest → `rolls[judgeUid].dice` (`applyCheerQuest`); danmaku → `gs.battle.evadeRoll.dice` (`renderEvadeCheer`). The result re-evaluates from the dice array. Each apply also consumes the cheerer's slot (`cheerConsumePatch`: `bondUsed[bond]` or `kuruwasuUsed[judgeUid]`) and logs `💪 …で応援！`.
- **UI (post-roll)**: explore renders `renderCheerSection(pc, …)` in **explore_result** (gated `!fumbleResolved && !specialResolved`); quest shows a per-unresolved-roll panel (cheer visible to all, **確定** button only for the judge → `confirmQuestRoll`); danmaku has a **`pc_evade_result`** phase (`renderEvadeResult` → `renderEvadeCheer` + 判定を確定する → `resolveEvade`). `handleEvadeRoll` stores dice in `battle.evadeRoll` and defers to `resolveEvadeApply`; NPC evade resolves immediately. Danmaku eligibility is gated on `b.participantPcUids` (same-spot equivalent).
- **Fragile cheers** (失敗→ファンブル): `getFragileCheerBonds` (魂の弱い所: cheer with a **used** bond) and `getKuruwasuCheer` (人を狂わす: bondless cheer via `KURUWASU_BOND`/`kuruwasuUsed`). Applying one sets `currentScene.fragileCheer`; explore_result then forces a fumble when the cheered judgment fails (`fragileFumble`). quest carries `fragile` on the roll into `evalQuest`.
- **怠け者**: gets a self-bond (`〇〇自身への絆`) and cheers its own judgments — treated as an ordinary **consumable** self-bond (per user decision), not an unlimited passive.

### Extra Rules (追加ルール)

Toggled by GM in Lobby; stored at `rooms/{roomCode}/config`:

| Key | Effect |
|---|---|
| `useAdditionalActions` | Enables bonus action phase after early quest solve |
| `useClueEvents` | Enables clue event table when no quest slots are available |
| `useRandomPlacement` | Initial danmaku positions are D6-random instead of fixed at cell 5 |
| `useLastResort` | 喰らいボム: spend 1 SC after failed dodge to roll 2 extra dice |

## Conventions

- All UI text and comments are in Japanese
- Inline styles only; import color constants and `iStyle` (input style) from [src/styles/colors.js](src/styles/colors.js)
- GM-only actions are styled red; PL actions blue; success states green; selection gold
- `gs` mutations must go through `upd()` — never call `set()`/`update()` directly from child components; pass `upd` as a prop
- Components needing `room.config` must receive `room` as a prop explicitly — it is not part of `gs`

## Visual Design System

The app uses a **東方Project (Touhou) aesthetic** — dark purple-black backgrounds, indigo-purple borders, vermilion red for GM/danger, group-blue (群青) for player actions, gold for selection/titles.

### Font

`'Noto Serif JP', serif` is the global font (loaded via Google Fonts in `index.html`, weights 400/600/700). All components must use this stack — no bare `"serif"`.

### UI Components

Three reusable frame components exist for the Touhou spell-card visual style:

**`SpellCard`** (exported from `SessionView.jsx`) — primary decorative frame used throughout:
- Double border + 4 corner `◆` diamonds + colored glow `boxShadow`
- Optional `title` prop adds a gradient header bar with `◆ title ◆` text
- Optional `headerRight` prop adds right-aligned content in the title bar
- `color` prop sets the accent color (default `C.gold`); `onClick` prop for modal stop-propagation

```jsx
<SpellCard color={C.blue} title="スペルカード名" headerRight={<Badge/>} style={...} contentStyle={...} onClick={...}>
  {children}
</SpellCard>
```

**`LobbyCard`** (defined locally in `Lobby.jsx`) — lighter variant for lobby/login screens; same double-border + corners pattern but with `C.goldBg` inner fill.

**`Divider`** (defined locally in `Lobby.jsx`) — `◆`-centered horizontal gradient rule for section separation.

### Log Entry Color Coding

Log entries in `gs.log[]` are color-coded by emoji prefix rendered in `RightPanel`:

| Prefix | Color |
|---|---|
| `⚔` / `✦` / `★` | `C.red` (combat/danger) |
| `🔵` / `🛡` / `💙` | `C.blue` (player action) |
| `✅` / `🎉` / `🌟` | `C.green` (success) |
| `💰` / `🏆` / `✨` | `C.gold` (reward/achievement) |
| others | `C.text` (default) |

New entries are prepended: `[newMsg, ...p.log]`.

## Visual Effects & Sound

### Sound effects (`src/audio.js`)

`sfx` exports browser-synthesized methods using Web Audio API — no external files. Methods include `bullet`, `spell`, `phase(name)`, `diceRoll`, `diceResult(maxDie)`, `hit`, `victory`, `defeat`, `questSolve`, `cluePlaced`, `sceneStart`, `sceneEnd`, `skillActivate`, `itemUse`, `cycle(idx)`. `_enabled` is persisted in `localStorage["sfxMuted"]` and toggled via `sfx.toggle()`.

**Scene / skill / item sfx routing**:
- **Scene start/end**: fired in `SessionApp`'s scene-detection `useEffect` (App.jsx) — `sfx.sceneStart()` when `currentScene.pcUid` goes null→value, `sfx.sceneEnd()` when it goes value→null. Battle-active guard suppresses both.
- **Once-per-session skill activation**: `PCCard` has a `useEffect` watching `pc[PS_ONCE_FLAG]`; fires `sfx.skillActivate()` on the false→true transition, capturing all once-skills (カリスマ/不夜城/ご執心/用意周到/直感) in one place regardless of which button triggered them.
- **Item use**: `sfx.itemUse()` fired at the top of `PCCard`'s `useItem`.

**Dice sfx routing**:
- **Battle dice**: `BattleDiceTray` (inside `BattleView`) fires `sfx.diceRoll()` on rolling-start and `sfx.diceResult(maxDie)` on rolling-end via a `useRef(prevAnim)` watcher.
- **Explore dice**: `RightPanel` has a parallel `useEffect` watching `gs.dice?.rolling` that fires the same sfx — but **guards with `if (gs.battle?.active) return;`** to avoid double-firing during battle.

### BGM (`src/bgm.js`)

Background music is **GM-supplied URLs, played locally per client** (not synced playback). Two layers: a per-session override `gs.bgm.{explore,battle,end}` (🎵 panel in `RightPanel`), and a **pre-set GM preset** `users/{gmUid}/bgm.{explore,battle,end}` editable in advance (`BgmPresetEditor`, exported from `ScenarioEditor.jsx`, shown in ProfilePage's アカウント tab + the PrepRoom GM column). Each client's `SessionApp` subscribes to `users/{room.gmUid}/bgm` (`gmBgm`) and derives the active URL from phase with `gs.bgm[key] || gmBgm[key]` (session override wins, else the preset) → `bgm.setTrack(url)`. `bgm` wraps two `HTMLAudioElement`s for **crossfade** on track change. Volume/mute are personal settings in `localStorage` (`bgmVolume`/`bgmMuted`, **default muted**). Browser autoplay policy: `bgm.unlock()` is called on the first `pointerdown` (so `play()` runs inside a user gesture); before unlock, the desired track is remembered and started on unlock. Invalid URLs / autoplay rejections are swallowed silently.

### Reduced motion (`src/motion.js`)

`motion` centralizes animation suppression with a **3-state model** in `localStorage["reduceMotion"]`: unset → follow OS `prefers-reduced-motion`; `"1"` → user-forced suppression; `"0"` → user-forced animations (overrides an OS `reduce` setting). `motion.toggle()` flips the *effective* value and persists it as an explicit override, so **a user whose OS disables animations can still re-enable them in-app** (the earlier `_userPref || osReduced()` design wrongly let OS always win, killing all animation with no recourse). `motion.init()` (called once in `App`) injects a `<style id="reduce-motion-style">` into `<head>` and reflects the effective value into `<html data-reduce-motion="1">`; the injected CSS clamps all `animation-duration`/`transition-duration` to ~1ms and `animation-iteration-count` to 1 under that attribute, neutralizing every keyframe/transition across all screens in one place. The OS media-query listener only re-applies while no explicit override is set. **JS canvas animations are not covered by CSS** — `BattleParticleCanvas` separately early-returns when `motion.reduced`. Toggle UI lives in the `RightPanel` tab bar (🎬/🚫 button, always enabled).

### Cinematic overlay pattern

`SessionApp` (in `App.jsx`) detects game events and shows transient full-screen overlays. The pattern is consistent:

```javascript
const [flash, setFlash] = useState(null);
const prevRef = useRef(null);  // or undefined for "first-run skip"
useEffect(() => {
  const cur = /* derive from gs */;
  const prev = prevRef.current;
  if (prev === null /* or undefined */) { prevRef.current = cur; return; }  // skip on join
  prevRef.current = cur;
  if (/* transition detected */) {
    setFlash(/* content */);
    sfx.someEvent();
    const t = setTimeout(() => setFlash(null), DURATION_MS);
    return () => clearTimeout(t);
  }
}, [/* deps */]);
```

Active overlay states in `SessionApp`: `cycleOverlay`, `questSolveFlash`, `clueFlash`, `sceneStartFlash`, `phaseFlash`. Each renders a `position: fixed` element with `pointer-events: none`, a unique `zIndex` (150–160), and a CSS `@keyframes` animation (defined in the global `<style>` block near the top of the render).

**Guard against duplicate triggers**: scene/phase flashes guard with `!gs.battle?.active` so they don't overlay the battle UI when state changes mid-fight.

### Animation keyframes location

- **Global keyframes** (used across phases): defined in `App.jsx`'s top-level `<style>` block — `logSlideIn`, `modalIn`, `backdropIn`, `resFlashUp/Down`, `questSolveAnim`, `clueBannerAnim`, `cycleOverlayAnim`, `badStatusIn`, `battleFadeIn`, `spotTipIn`, `sceneStartAnim`, `phaseFlashAnim`, `phaseStripe`.
- **Component-local keyframes**: defined in inline `<style>` blocks inside the component using them (e.g. `RightPanel` defines `scenePanelIn`, `diceIn`, `diceResultIn`; `BattleView` defines `spellFlashIn`, `phaseBannerAnim`, `brRing`/`brGlow`/`brCardIn` for the battle result cinematic).
- **MapView animations**: `mySpotGlow`, `myPortraitGlow`, `pulseRing` live in `MapView`'s local style.

### MapView PC layer

PCs on the map are rendered in a **separate absolute-positioned layer** after the spot list, not as children of spot divs. Their `left`/`top` use CSS `transition: left 0.52s cubic-bezier(0.4,0,0.2,1), top 0.52s ...` with a stable `key={pc.uid}`, so React reuses the DOM node and the browser animates the move when `pc.currentSpot` changes. Multiple PCs on the same spot are horizontally offset via `(idx - (N-1)/2) * 26px`.

### Battle background particles

`BattleParticleCanvas` (module-level in `SessionView.jsx`) is a 48-bullet canvas particle system rendered inside `BattleView`'s main return at `zIndex: 0`. Battle content is wrapped in a sibling div with `zIndex: 1` so it stacks above. The canvas uses `requestAnimationFrame` + `ResizeObserver`; cleanup cancels both on unmount.
