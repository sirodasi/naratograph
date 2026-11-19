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
2. **PrepRoom** (inside `Lobby.jsx`): GM loads scenario; PLs confirm ready
3. **Intro**: Backstory narrative screen
4. **Explore**: Map movement, resource management, quest/clue discovery
5. **Battle**: Turn-based danmaku (bullet pattern) mini-game
6. **Bonus** (optional, config-gated): Extra actions if solving before the time limit
7. **Epilogue** (`sessionPhase: "epilogue"`, `EpilogueView`): after the **final** battle (any outcome, `isFinal`), a 終幕 depiction shown to all before the end screen. Uses the **same scene-mode UI as explore's 描写** — `SceneStage` (bg + 立ち絵 + text) + GM-side `SceneEditor` (in `src/session/scene.jsx`, re-exported via `SessionView.jsx`; also used by `MapView`/`RightPanel`); data flows through `sceneData` (`rooms/{roomCode}/scene` — `{ bg, portraits, fx }`; the scene listener in SessionApp.jsx must read **all three** back) + `gs.sceneText`. `finishBattle` routes `isFinal ? "epilogue" : "explore"`. Images are encoded transparency-preserving (webp→PNG fallback) for portraits, JPEG for bg (`loadImage(..., transparent)`).
   - **Portraits** (`{ img, name, x, y, h, flip, hidden, faces[], face }`, x,y = bottom-center %, h = height %, max 8; legacy `{img,name}` falls back to a centered-bottom spread): GM-only `editable` `SceneStage` lets the GM **drag** to place (local state during drag, commits on pointer-up to avoid Firebase spam) + a per-portrait toolbar (size/flip/layer/隠す/delete/表情). `hidden` skips render; **expressions** = `faces[]` of images with `img` always synced to the current `face`. `SceneEditor` lists portraits with 👁 visibility + a 表情 strip (select/add/remove).
   - **Effects** (`sceneData.fx = { particles, tone }`): `SceneParticles` CSS layer (桜/雪/光粒/雨) + a tone overlay (夕焼け/夜/セピア/暗転/暖色), rendered above portraits / below the text box.
   - **Scene presets** (`users/{uid}/scenePresets/{id}` = `{ name, bg, portraits, fx, text }`): `SceneEditor` (given `user`) saves the current composition and reloads it (overwrites sceneData + `gs.sceneText`) — set up scenes in advance, reuse across sessions. Image fields are **asset ids** (`dehydrateScene`); bytes live in `users/{uid}/presetAssets/{id}` (deduped across presets, orphaned ones removed on delete, fetched per preset on load via `collectSceneAssetIds`). Legacy inline presets (`hasInlineImages`) are migrated when the list loads.
8. **End** (`SessionEndView`): result + 成長 ceremony; the GM's end button exports the log (.txt) and **deletes the Firebase room** (`remove(rooms/{roomCode})` + `roomSecrets/{roomCode}`) — clients return to the lobby.

Phase is tracked as `gs.sessionPhase` and transitions are explicit with confirmation modals.

### Responsive / Mobile

`useIsMobile(breakpoint = 820)` ([src/useIsMobile.js](src/useIsMobile.js), shared to avoid an App↔Lobby import cycle) drives layout switches via `window.matchMedia`. On mobile (`SessionApp`): the `RightPanel` (normally a fixed 300px sidebar) becomes a right-side **drawer** (`min(90vw,360px)`, `translateX` toggled by a floating ☰/✕ button + tap-backdrop); content (map/battle) goes full-width. `RightPanel` takes a `width` prop (300 desktop / "100%" mobile). The drawer **auto-opens** when `currentScene.pcUid === user.uid` (your turn), and the button pulses (`panelAlertGlow`) while your scene is active and the drawer is closed. `PrepRoom` (Lobby) stacks its two columns (`flexDirection` column) and wraps the header on mobile; the character grid already uses `auto-fill`. Battle grids (`BattleGrid` fixed 210px) wrap via the existing `flexWrap`; modals are `width: "90%"` + `maxWidth`.

### State Management

Firebase Realtime Database is the **only** source of truth. The `gs` (game state) object is synced to `rooms/{roomCode}/state`. All mutations go through the `upd()` callback, which runs a **`runTransaction`** on the state node (SessionApp.jsx):

```javascript
const upd = useCallback((fn) => {
  if (!isParticipantRef.current) return;            // view-only clients never write
  let last = null;
  runTransaction(ref(db, gsPath), raw => {
    const prev = normalizeGs(raw);                   // same shape the onValue listener produces
    if (!prev) return raw;                           // cache miss → SDK retries with server data
    last = { prev, ...computeGsUpdate(prev, fn) };   // log cap/archive + sanitizeGsForWrite
    return stripUndefined(last.next);
  }).then(({ committed }) => { /* undo snapshot (last.prev) + logArchive write */ });
}, [gsPath, roomCode]);
```

Because a transaction **re-runs `fn` against the server value on conflict**, concurrent GM/PL writes no longer clobber each other (the old `setGs`+`set(whole gs)` was last-write-wins). Consequences: **updaters must be pure** (they may run more than once — randomness inside is fine, side effects/closure assignments are not), and `fn` receives the **public** gs (`normalizeGs` of the raw value), never the GM's merged view. `applyLocally` (default) fires the `onValue` listener immediately, so the UI stays optimistic. The pure helpers (`DEFAULT_GS`, `normalizeGs`, `normalizePc`, `normalizeScenario`, `computeGsUpdate`, `stripUndefined`, scenario-secrecy helpers) live in [src/gsSync.js](src/gsSync.js) and are unit-tested in `src/__tests__/gsSync.test.js`.

Local React state is only used for UI-only concerns (hover, modals, animation frames). Never write game state to local state directly — always go through `upd()`.

Firebase strips empty arrays on write — always guard array reads with `|| []`. `upd()` also runs `stripUndefined(next)` before the Firebase write (Firebase throws on `undefined`; empty objects/arrays get stripped on write and read back as `undefined`, which then fails to re-write).

**Undo** (GM): after a committed transaction, `upd()` pushes the pre-update state into `undoStackRef` (cap 20) when the log grew (`computeGsUpdate().logGrew`, measured **before** the LOG_CAP trim; dice-animation frames don't log so they're skipped); `undo()` restores the last snapshot with a plain `set` (intentionally overwrites — it also discards PL actions taken since). ↩ button in `RightPanel`'s tab bar (`undoCount` gates it).

**Free dice** (任意ダイス): `RightPanel` 進行 tab has a GM-ruling roller (nD6 / D66) that logs the result; not tied to game actions.

**Images → data URL (Spark) / Firebase Storage (Blaze)**: scene images (bg/portraits/expressions, via `SceneEditor.loadImage`) are resized (bg ≤960px, 立ち絵/表情 ≤420px) → `toBlob` (webp transparent / jpeg, slightly lower quality). The `SCENE_IMG_USE_STORAGE` module flag (`src/session/shared.jsx`, **default `false`**) decides storage: when **`false` (Spark plan — Storage requires Blaze)** the image is stored **inline as a data URL** in `sceneData`; when `true` it is **uploaded to `sceneImages/{uid}/...`** (`getStorageLazy()` from firebase.js — `firebase/storage` is only loaded when the flag is on) storing the **download URL** (keeps RTDB light), falling back to a data URL on failure. **Asset decoupling (RTDB load)**: image bytes are **not** stored inline in the `scene` node. `setSceneDataAndSync`/the scene listener (SessionApp.jsx) run `dehydrateScene`/`hydrateScene`: each image data URL is stored once under `rooms/{code}/sceneAssets/{id}` (`id` = content hash, so identical images dedupe; `update()` writes only **new** assets), and the `scene` node holds only the `id` + geometry. So a立ち絵 drag rewrites a tiny `scene` node, not the image bytes. Clients subscribe to assets via **`onChildAdded`** (incremental, not whole-map). Local `sceneData` stays hydrated (real URLs) so `SceneStage`/`SceneEditor` are unchanged; legacy inline-data-URL scenes pass through `hydrate` untouched and auto-migrate to assets on next write. Assets are room-scoped and cleaned up when the room is removed at session end. To enable Storage: upgrade to Blaze, provision the bucket, apply CORS (`cors.json` / [docs/firebase-storage-cors.md](docs/firebase-storage-cors.md)), set Storage rules (authenticated write+read on `sceneImages/`), then flip the flag. (128px char/NPC `PortraitUpload` icons in ScenarioEditor are also data URLs — small.)

**Double-firing UI**: a fast double click still issues two `upd()` calls (each is applied, now without lost updates). Guard one-shot UI at the UI level:
- Clear guard state **before** calling `upd()` (e.g. `setSceneSelect("")` then `upd(...)`)
- Use `useRef(false)` as a one-shot flag for full-screen clickable areas (see `BackstoryScreen`)

### Firebase Schema

```
rooms/{roomCode}/
├── gmUid, gmName, phase
├── players/{uid}/{ charId, charName, personalitySkill, role, ready, grownBase? }
├── scenario, scenarioData   ← PUBLIC projection only (publicScenario); full text is in roomSecrets
├── config/{ useAdditionalActions, useClueEvents, useRandomPlacement, useLastResort }
├── state   ← gs object (entire game state)
├── scene   ← background/portrait data for scene mode (image fields hold asset ids, not data URLs)
├── sceneAssets/{id}  ← scene image bytes (data URL), keyed by content hash; write-once
├── logArchive/{e0000000}  ← gs.log entries evicted past LOG_CAP (400), keyed "e"+zero-padded absolute index
└── presence/{uid}/{ online, name, ts }  ← live presence (onDisconnect-managed)

roomSecrets/{roomCode}/       ← OUTSIDE rooms/ because a readable parent cannot hide a child in RTDB rules
├── gm/scenarioData           ← full scenario (answers, enemies, locked quests, GM notes); GM-only read
└── plot/{uid}/{entityId}     ← { cell, nonce } plot-placement choice; readable ONLY by {uid} (not even the GM)

admins/{uid}: true            ← GM (room creation) allow-list; set by hand in the console; user can read own entry
users/{uid}/scenePresets/{id} ← scene presets (image fields hold asset ids)
users/{uid}/presetAssets/{id} ← preset image bytes (data URL), content-hash keyed, shared across presets
users/{uid}/ihenPresets/{id}  ← GM-made 異変再現 presets { name, desc, defs, createdAt, updatedAt } (owner read/write via the generic users/$uid rule)
```

**Subscriptions**: never `onValue(rooms/{code})` as a whole (it drags in state, scene assets and the log archive). The root `App` watches only `rooms/{code}/phase` (missing ⇒ room deleted); `SessionApp` subscribes to `ROOM_META_KEYS` (`gmUid, players, config, scenarioData, limit, phase`) individually and builds `room` once all have arrived.

**Scenario secrecy**: `sanitizeGsForWrite` (applied inside `computeGsUpdate`, so on **every** client's write) strips `SECRET_SCENARIO_KEYS` (`quests, finalBattleEnemies, finalBattleOptionalEnemies, phaseNotes, notes`) from `gs.scenarioData` (adding `questCount`) and `truth` from **unsolved** `gs.quests`. The GM client subscribes to `roomSecrets/{code}/gm/scenarioData` (`gmScenario`) and SessionApp exposes `gs = mergeScenarioSecret(gsRaw, gmScenario)` to its children, so GM-side code reading `gs.scenarioData.quests` etc. works unchanged. **Quest unlock + truth reveal** is done by a GM-client effect via `reconcileQuests(gs.quests, gmScenario.quests)` (do NOT unlock inside updaters — `p.scenarioData` there is public). At `epilogue`/`end` the GM effect writes the full scenario with `gs.scenarioRevealed = true` (sanitizing stops). Lobby writes `publicScenario(sc)` to the room and the full text to roomSecrets on create/scenario change; legacy rooms are migrated by a GM effect.

`config` lives at `rooms/{roomCode}/config`, **not** inside `gs`. Components that need config must receive `room` as a prop (not just `gs`). `BattleView` takes `room` and reads `roomConfig = room?.config` (never `gs.config`, which does not exist).

**Log cap / archive**: `upd()` caps `gs.log` at `LOG_CAP` (400). Overflowing (oldest) entries are written to `rooms/{code}/logArchive` keyed by absolute index (`gs.logBase` = number archived so far), so re-archiving after an undo is idempotent. The undo snapshot test uses the **pre-cap** length. `SessionEndView.exportLog` (async) merges the archive + `gs.log` for the full .txt.

**Profile room list** queries `rooms` with `orderByChild("gmUid").equalTo(uid)`; the rules allow `rooms` reads only for exactly that query (+ `.indexOn: ["gmUid"]`).

### GM permission & write-side rules

Room creation (GM) is allowed for users with `admins/{uid} === true` (set manually in the Firebase console; ProfilePage's アカウント tab shows the user's UID and GM status). `useIsAllowedGm(user)` ([src/useIsAllowedGm.js](src/useIsAllowedGm.js)) only drives UI; `database.rules.json` enforces it. No e-mail address is hard-coded anywhere. GM-ness inside a room is `room.gmUid === user.uid` (never `players/{uid}/role`, which the player can write); rules `.validate` that a player can only set `role: "pl"` for themselves, and only the GM may delete `state`/`scene`. Rejoining via the join form does not overwrite an existing player entry. Rules changes are **not** deployed automatically — run `firebase deploy --only database` (see [docs/firebase-security-rules.md](docs/firebase-security-rules.md)).

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
| `gmRequests[]` | GM → PL requests (dice / choice / notice), see "GM intervention tools". Capped at `MAX_REQUESTS` (12). |
| `custom` | GM-built custom elements (異変再現 etc.): stat/item/table/token/state/rule **definitions** + global stat values + placed map tokens. See "Custom elements". |

### Major Components

| File | Responsibility |
|---|---|
| [App.jsx](src/App.jsx) | Root only: auth, the `rooms/{code}/phase` watch, Lobby/SessionApp routing (both lazy) + the single `<Suspense>`. Keep it tiny — it is the initial chunk with React + Firebase. |
| [SessionApp.jsx](src/SessionApp.jsx) | The session screen (lazy-loaded from App): Firebase room listeners, `upd()`, phase screens, BFS pathfinding (`getDistances`), `MapView`, cinematic overlays. Tests import `getDistances`/`normalizeScenario` from here. |
| [SessionView.jsx](src/SessionView.jsx) | Compatibility barrel: `export *` from every `src/session/*.jsx` module (tests and old imports use it) |
| [src/session/](src/session/) | The former ~11,600-line SessionView monolith, split by screen (see below) |
| [gsSync.js](src/gsSync.js) | Pure gs sync logic: normalization, update computation, log cap, scenario secrecy |
| [CharSprite.jsx](src/CharSprite.jsx) | Sprite-sheet portrait (`sprite.webp`); split out so session code doesn't import Lobby |
| [Lobby.jsx](src/Lobby.jsx) | Auth flow, room prep, character + skill selection, extra rule toggles |
| [ScenarioEditor.jsx](src/ScenarioEditor.jsx) | GM tool for authoring scenarios, quests, enemies, danmaku skills; ProfilePage |
| [firebase.js](src/firebase.js) | Firebase init + auth providers; `getStorageLazy()` |

`src/session/` modules (generated by splitting on top-level declarations; each declaration is `export`ed and cross-module references are explicit imports):

| Module | Contents |
|---|---|
| `shared.jsx` | Constants, pure helpers (`buildSpellCard`, `hasOfficialSkill`, `INIT_RESOURCES`/`INIT_ITEMS`, …), `SpellCard`, `ConfirmModal`. **Must not import other session modules** (init-order safety); non-function top-level values live here. |
| `scene.jsx` | `BackstoryScreen`, `SceneStage`, `SceneEditor` (+ presets), `SceneParticles`, `EpilogueView` |
| `battle.jsx` | `BattleView`, `BattleRightPanel`, `BattleGrid`, `BattleParticleCanvas`, `PlotPlacementPanel` (+ `plotHash`/`plotNonce`) |
| `battleFx.jsx` | Battle effects: `useBattleFx` hook, `HitOverlay`, `SpellCutin`, cell effects (`CellHitBurst`/`CellGhost`/`CellSparks`/`GrazeText`), `BATTLE_FX_CSS` keyframes. See "Battle effects". |
| `phases.jsx` | `BonusPhaseView`, `GrowthCeremony`, `SessionEndView` |
| `pcCard.jsx` | `PCCard`, `ActionRenderer`, `CharDetailModal`, `SkillActivateModal`, item modals |
| `scenePanel.jsx` | `ScenePanel` |
| `rightPanel.jsx` | `RightPanel` |
| `gmPanel.jsx` | GM intervention UI: `GmToolsPanel` (RightPanel "GM" tab; collapsible above `BattleRightPanel` during battle), `GmRequestOverlay` (PL-side cards, rendered by `SessionApp`), `GmPcEditor` (PCCard GM編集). Imported directly by SessionApp — must not import lazily loaded session modules. |
| `reminders.jsx` | `GmReminderOverlay` — GM-only timing memos (bottom-left), rendered by `SessionApp` for the GM. Imported directly by SessionApp — keep it free of lazily loaded modules. |
| `customPanel.jsx` | Custom-element UI: `CustomRulesEditor` (RightPanel GM「独自」tab), `CustomBoard` (rule board + global/battle stats, top of 進行 tab and above `BattleRightPanel`, visible to all), `CustomPcSection` (PCCard), `GmFieldEditor` (GM battle-field editing, above `CustomBoard` during battle), `PresetDefsEditor` (defs-only editing for a sandbox `{ custom, pcs: [], log: [] }`; sections take `prep` to hide runtime ops — give to PC / roll / place tokens). |
| `presetManager.jsx` | `IhenPresetManager` (ProfilePage「異変再現」tab, outside sessions) + `PresetEditor` (name/desc/clock + `PresetDefsEditor`). Lazily loaded via ScenarioEditor. |

**Code splitting**: the root `App` lazy-loads `Lobby` (which lazy-loads `ScenarioEditor`) and `SessionApp`; `SessionApp` lazy-loads `BattleView`, `RightPanel`, `BonusPhaseView`, `SessionEndView`. A single `<Suspense>` in the root `App` covers them all. The initial chunk is essentially React + Firebase (~450KB / ~140KB gzip); do **not** import session/data modules from `SessionApp.jsx` or they move back into it. Keep `shared.jsx`/`scene.jsx` free of imports from the lazily loaded session modules.

`RightPanel` registers a `window` keydown listener (GM-operation shortcuts): `1`–`4` switch tabs, `Enter` runs the current `getMainAction()` (`ma`) result, `M` toggles sfx, `?` opens the shortcut help modal. The handler reads `ma`/`TABS` through refs (`maRef`/`tabsRef`) updated every render so the listener (registered once on mount) always sees current values; it no-ops while an `INPUT`/`TEXTAREA`/`SELECT`/contentEditable is focused or a modifier key is held. The log tab has a text search box + category filter chips (combat/player/success/reward) driven by emoji-prefix classification.

`BattleRightPanel` is a **separate top-level function** (in `battle.jsx`), not a closure inside `BattleView`. Functions defined inside `BattleView` are not accessible from `BattleRightPanel`; shared logic must be defined at module level or passed as props.

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

Danmaku skill utilities (module-level exports in `src/session/shared.jsx`, re-exported from `SessionView.jsx`):
- `hasOfficialSkill(entity, skillName)` — checks `entity.ds.name` / `entity.dsName` / `entity.skillName` / `entity.ps.name` against `OFFICIAL_DANMAKU_SKILLS` (ds.name takes precedence)
- `isSkillUsed(usedds, attackerId, skillName)` — checks `usedds[attackerId]` array
- `markSkillUsed(usedds, attackerId, skillName)` — returns a new `usedds` map with the skill appended (immutable)

`BattleView` also defines instance-scoped wrappers `isDanmakuUsed(id, name)` / `markDanmakuUsed(id, name)` that read/write `b.usedds` via the closure's `upd`. Use the module-level versions from outside `BattleView`.

Skill data on enemies is stored as `ds: { name, desc }` (normalized from legacy flat fields via `normalizeScenario()` in `SessionApp.jsx`).

### Spell-card data flow

The canonical spell-card representation is **`{ name, desc }`** (PC, from `characters.js`) or `{ name, desc, ref? }` (NPC). Derived fields are recomputed at render time. (Legacy raw strings are still accepted everywhere for backward-compat.)

- **Storage**: PC `spellCards[]` and `growthSpellCard` (in `characters.js` and carried into `gs.pcs`) are **`{ name, desc }`** objects — `name` is the spell title (up to the first `」`), `desc` is the effect text. NPC `spellCards[]` are `{ name, desc, ref? }` (omit `ref` when empty). Older saved data (Firebase `grownChars`, in-flight rooms) and custom-character spell cards may still be **raw strings**; all consumers tolerate both (`typeof sc === "string" ? sc : sc.name`). `normalizeScenario()` does **not** pre-build spell objects.
- **Rendering**: `buildSpellCard(card)` (exported from `SessionView.jsx`) accepts a string **or** an object (`{name, desc}`/`{name, text}`) and returns a full view-model with `name`, `text` (= `desc`), `textBody`, `condition`, `effects`, `timing`, `effectTiming`, `manual`, `structured`. The structured-effect lookup keys on `card.ref || name`. Render `spell.name` as the header and `spell.textBody || spell.text` as the body (since `desc` no longer repeats the name, there is no duplication). Call at render time only.
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

**`structured.effects` auto-handling vs manual fallback** (`AUTO_HANDLED_EFFECTS` set in `src/session/`): only effect types in this set are auto-applied by `declareSpell`; everything else is **not silently dropped** — `buildSpellCard` collects them into `spellCard.manualEffects` and `SpellDeclareItem` shows a "⚠ 配置以外の効果はGMが手動で処理してください" warning (with the spell's `note`). Currently auto-handled: `extra_support_cover*` / `enemy_*move*` / `shift_non_25_horizontal`; post-random grid removals `remove_from_enemy_cell` (写真「籠もりパパラッチ」) / `remove_if_hit_enemy_cell` (天星馬「ペガサスクロス」); and **evasion changes** `reduce_enemy_evasion` / `increase_enemy_evasion` / `reduce_own_evasion` / `costs_own_evasion`. When you automate one, add its type here and the warning disappears automatically.

**Instant resource effects** (`computeResourceEffects` in `declareSpell`): applied at declaration. Returns `{ pcs, npcs, evRestore }`; the caller applies them to `p` before `mergeConsumeWithBattle` so SC-consume and the resource change coexist. Wired into all three placement paths (full-deterministic, full-random, designated-choose). Covers:
- **Evasion** (`reduce_enemy_evasion` / `increase_enemy_evasion` / `reduce_own_evasion` / `costs_own_evasion`): mutate `resources.回避力.cur` ±1 so `getDefaultEvadeDice` picks it up without touching the evade step. Saved in `gs.battle.evasionRestore[entityId]` and **restored in `handleCleanup`** (round-scoped) — **all four incl. `costs_own_evasion`** (杞人地). 回避力 recovers to max at round end by design, so 杞人地's "回避力 -1" is a current-value (not max) reduction biting only that round (先攻→後攻 evade starts at 2 / 後攻→fewer moves).
- **`reset_graze`** (バレットドミニオン/マーケット): attacker's グレイズ → 0 (after the X-count was already read via `resolveCount`). Permanent (not restored).
- **`costs_rei`** (五穀豊穣ライスシャワー): attacker's 霊力 -1, 攻撃力 recomputed as `1 + floor(霊力/5)`. Permanent.
- **`no_sc_cost`** (幻想春花): handled in `consumeSpell` itself (returns `p` unchanged when present).

**Still manual** (remaining): costs_rei is done; remaining are the post-dodge / on-hit / round-end timing effects (`random_3d_after_first_dodge`, `mirror_graze_gain`, `cancel_hp_reduction`, etc.) and the move-selection effects (`enemy_move_adjacent`, `self_move_*`, `pre_self_move_adjacent`, `optional_*`).

### GM intervention tools (GM 操作)

Policy: instead of adding a ScenarioEditor feature for every scenario-specific rule (custom tables, ambushes, branching events), the GM handles them **at the table** with generic tools. Pure logic lives in [src/gmTools.js](src/gmTools.js) (updaters `p => next`, randomness rolled by the caller and passed in; tested in `gmTools.test.js`), UI in `src/session/gmPanel.jsx` (tested in `gmPanel.test.jsx`). Nothing is auto-applied — tools produce results/logs and the GM rules on them.

- **Requests** (`gs.gmRequests[] = { id, kind: "dice"|"choice"|"notice", title, text, targets[uid], dice?: { count, mode: "nd6"|"d66", target? }, table?, options?, responses: { [uid]: { dice?, cheers?, confirmed?, choice?, ack?, byGm?, given? } } }`). **Custom-table dice requests**: `table = { id, name, dice, rows, give? }` is a **snapshot** of a `gs.custom` table taken at request time (dice count/mode derived from it, no target); `describeDice`/`tableResult` look the result up in it. With `give`, `respondDice(…, iid)` hands the same-named custom item to the roller via `giveTableItem` (once, `responses[uid].given`); otherwise the GM monitor shows a 渡す button. The PL overlay keeps a local result card (target-less rolls confirm instantly, so the request card disappears). `GmRequestOverlay` (fixed bottom card, every screen incl. battle; collapsible) shows each PL their unanswered requests (`pendingFor`). Dice **with a target** is a 行為判定 (`evalJudgment`: max ≥ target, all-1 fumble, any-6 special, 不運 honoured): after rolling, eligible cheerers (same spot, `cheerOptions` = normal bonds + special bond + the **fragile** ones — `getFragileCheerBonds` 魂の弱い所 / `getKuruwasuCheer` 人を狂わす, shared with ScenePanel) get a 応援 card on their own screen (fragile = purple 🩸); `addCheerDice(…, fragile)` appends dice, records `cheers[{ by, bond, fragile? }]` and consumes the slot (`cheerConsumePatch(x, bond, judgeUid)`: `kuruwasuUsed[judge]` for 人を狂わす); `evalJudgment(dice, target, unlucky, fragile)` turns a failure into a fumble when `isFragileResp(resp)`; the judge presses 確定 (`confirmDice`). Without a target the roll is final immediately. The GM monitor can roll/confirm/choose **on behalf** of offline PLs, and closes (removes) requests. `getCheerBonds`/`getSpecialBondCheer` were moved here from ScenePanel (shared).
- **Ad-hoc battle** (`startAdhocBattle`): enemies picked from `scenarioEnemies(gs.scenarioData)` (GM's merged view: quest enemies, extra enemies, final/optional) and/or created on the spot; participants chosen; `battle = { adhoc: true, title, participantPcUids, scenePcUid?, resumeScene?, … }` (`mass` if >1 enemy or PC). The running `currentScene` is stashed in `battle.resumeScene`; **every battle close goes through `closeBattlePatch(p)`** (finishBattle + GM 強制終了) which restores it. Ad-hoc battles don't change `sessionPhase`, don't solve quests or mark PCs acted; lives-0 recovery applies to every non-final battle. The form's participants **follow the current scene PC** until the GM picks (`chosen === null`), with 「シーンと同じスポットの全員」/「シーンの PC に戻す」 shortcuts.
- **PC GM編集** (`GmPcEditor`, under PCCard's GM編集 toggle): 変調付与, 絆 add/remove + 応援欄 (`bondUsed`) toggle, forced move, 行動済み toggle, `abilityUse` reset, resource max ±.

### Custom elements (独自要素 — 異変再現 support, A-1/A-2/B)

Official 異変再現 (expansion rules) and GM-made ones keep adding new stats / items / tables / tokens / states. Rather than coding each, the GM **defines generic parts in-session** and runs them by hand (nothing auto-triggers). Pure logic in [src/customRules.js](src/customRules.js) (tested in `customRules.test.js`) and [src/gmBattle.js](src/gmBattle.js) (battle field), UI in `src/session/customPanel.jsx` (`customPanel.test.jsx`, `gmFieldEditor.test.jsx`).

- **Definitions** live in `gs.custom` (`stats`, `cats`, `items`, `tables`, `tokens`, `states`, `rules`, `reminders`, plus `global` values and placed `mapTokens`). Always read via `getCustom(gs)` (Firebase array guards). `removeDef` also cleans up referencing values/instances/tokens/states.
- **Values**: stat `scope` is `pc` (→ `pc.custom.vals[id]`), `global` (→ `gs.custom.global[id]`) or `battle` (→ `gs.battle.customVals[id]`, naturally reset when a new battle object is built; edits ignored outside battle). `setStat`/`adjustStat` clamp to min/max; unset = `init`.
- **Items**: instances `pc.custom.items = [{ iid, def, used? }]`; category `cap` is a soft limit (over-cap is allowed but logged ⚠ — the rules say "choose one to discard"). Owner (`PCCard` `myUid`) can use/toggle 使用済/discard/pass to a same-spot PC; GM can do all and give from the tab.
- **Tables** (`d6`/`2d6`/`d66`, rows `{min,max,text}` parsed from "1-2 赤" lines): rolled by the GM, logged; a result whose text equals a custom item name gets a 渡す button.
- **Map tokens**: kinds `{ name, color, unique }`; `placeTokens` honours `unique` (one per spot); random placement excludes `dream`. Rendered in `MapView` (SessionApp.jsx) as small colored dots above spots; `CustomBoard` (needs `getSpot`) lists a legend (name, count, spots) for all players because the dot tooltips are hover-only.
- **Timing memos** (`reminders: [{ id, timing, text, finalOnly? }]`, 「独自」tab › タイミングのメモ): nothing is automated, so the GM registers "what to do when". `REMINDER_TIMINGS` = day_start / cycle_start / scene_start / scene_end / cycle_end (all PCs acted, no scene) / battle_start / round_start / round_end (entering `round_end_check`/`cleanup`, or the round advancing without them) / battle_end; `finalOnly` filters battle timings to the final battle. `timingSnapshot(gs)` + `detectTimings(prev, cur)` (pure, tested in `reminders.test.jsx`) compare consecutive gs summaries — scene stash/restore around battles is ignored; a cycle "starts" on intro→explore, a clock change, or a `gs.cycleSeq` bump (`repeatCycle` / `setClock` / 永遠と須臾's night repeat — acted counts are not used). `GmReminderOverlay` runs this on the GM client only and keeps fired/checked state **locally** (no gs writes; nothing fires on join/reload). Built-in presets carry reminders too.
- **States**: `pc.custom.states = [stateId]`, toggled by the GM (PCCard or tab).
- **Time control**: `setClock` (resets acted/scene/reiryoku; newspaper on day change), `repeatCycle` (same cycle again, no return / やる気 loss — 永夜異変), `setLimit` (`gs.limit`).
- **Battle-field editing (A-2)** — pure logic in [src/gmBattle.js](src/gmBattle.js) (`gmBattle.test.js`), UI `GmFieldEditor` (`gmFieldEditor.test.jsx`), GM-only, collapsible above the battle panel:
  - bullets ± per cell / random N (dice → cells) / clear field (霊撃), move a piece, 残り人数 ± (PC and NPC).
  - **Hit cancel** (`cancelHit`): only in `pc_hit_check`/`npc_hit_check` (before damage); jumps to `afterDefense`.
  - **Field tokens** `battle.fieldTokens = [{ id, owner, cell, kind }]` (kinds reuse `gs.custom.tokens`), drawn on `BattleGrid` via the `tokens` prop. `fieldTokenAlerts` (piece standing on it / bullets placed on it — チェリー / UFO) are shown to the GM even when collapsed, with 獲得 (owner or opponent) / 取り除く.
  - **Extra evade step** (`startExtraEvade`, ラストスペル): places dice-rolled bullets on a combatant's field, sets `pc|npc_evade_intro` and `battle.extraEvade = { entityId, returnTo: "round_end_check" }`. `afterDefensePhase` in BattleView now delegates to `gmBattle.afterDefense`, which returns `extraEvade.returnTo` when set, so the evade/hit/recovery path ends at round_end_check instead of the next shot. **Every update that ends a defense must also set `extraEvade: null`** (evade dice exhausted, recovery, SAFE, 不死身, `cancelHit`) so the next normal defense doesn't reuse it. Evasion dice use `回避力.cur ?? 3` (an explicit 0 stays 0).
  - **Temporary danmaku skill** (`grantSkill`, アビリティカード「装備」): `battle.grantedDs[entityId] = [name]`. `hasOfficialSkill` also accepts `entity.battleGrantDs`; BattleView's `pcs`/`npcs`, the 使い魔 auto-support updaters and `BattleRightPanel` cards wrap entities with `withGrants(b, e)`. **Any new `hasOfficialSkill` call on an entity read from `p.pcs`/`participants` must wrap it with `withGrants`** or granted skills are ignored there.
  - `handleCleanup` spreads `ROUND_RESET` (`grantedDs`, `extraEvade` → null); `fieldTokens` persist for the battle.
- **異変再現 presets (B)** — a preset is `{ name, desc, defs: { stats, cats, items, tables, tokens, states, rules }, clock? }`. Built-ins (春雪/永夜/弾幕撮影/宝船を追って/月虹の市場) live in [src/data/ihenPresets.js](src/data/ihenPresets.js); rule texts and card descriptions there are **own-words summaries, not transcriptions of the book** — keep it that way. GM-made ones are saved to `users/{uid}/ihenPresets/{id}` from the current `gs.custom` (`presetFromGs`, values/placed tokens excluded). UI: `PresetSection` at the top of the 「独自」 tab (`CustomRulesEditor` needs `user`; per-row JSON export + 「JSON を読み込んで保存」).
  - **Before a session**: ProfilePage「異変再現」tab (`IhenPresetManager`) creates / edits / duplicates (built-ins as templates) / deletes saved presets; edits run on a local sandbox and save via `presetFromGs` → `sanitizePreset` (same id on edit, `createdAt` kept).
  - **JSON files** (`presetToFile` / `parsePresetFile`, format `PRESET_FILE_FORMAT` v`PRESET_FILE_VERSION`, browser helpers in [src/fileTransfer.js](src/fileTransfer.js)): imported content is untrusted — `sanitizePreset` keeps only known fields per kind, makes ids Firebase-safe without `__` (`safeDefId`; stat ids become keys of `global`/`vals`), dedupes ids, drops unknown reminder timings / dangling `cat` refs, validates colors, clamps clock and sizes. The profile tab opens imports in the editor for review; the in-session button saves directly after a confirm.
  - `applyPreset(p, preset, key, { pcCount, withClock })` copies every def into `gs.custom` with id **`${key}__${baseId}`** (`PRESET_SEP`; item `cat` refs remapped too), so several presets coexist, re-applying **replaces** that key's defs (defs dropped from the preset are removed via `removeDef`; remaining values are kept), and `unapplyPreset(p, key)` removes exactly that preset's defs (and, via `removeDef`, their values/instances/tokens/states). `gs.custom.applied = [{ key, name }]`. Built-in keys are the preset `key`; saved ones are `u${firebaseId}`.
  - Stat `initFromPcCount: true` (刻符ノルマ) seeds the global value with the PC count on first apply. `clock` (永夜: 1日目の夜, limit 1日目の夜) is applied only when the GM keeps the checkbox on; applied during `intro*` it is also stored as `gs.custom.startClock` and `doTransitionToExplore` starts exploration at that time (instead of day 1 morning). `presetFromGs` keeps colliding base ids distinct (`key_id`).
  - Tests: `ihenPresets.test.jsx` (logic, data integrity — table results must match item names, the D66 table covers all 21 values, 【装備】 skills are official names — and the UI with an in-memory `firebase/database` mock); `presetFile.test.jsx` (JSON round-trip of every built-in, rejection/sanitizing, profile-tab create/edit/duplicate/import/export, in-session import).
- **Later**: C = code hooks for official ones (弾幕撮影 battle variant etc.). 完全憑依 (one player, two PCs) needs a dedicated PC-model change and is out of scope.

### Quest Resolution Types

Quests (`gs.quests[].solutionType`) support three resolution flows:

| Type | Flow |
|---|---|
| `"自動解決"` | Resolved automatically when enough clues are placed |
| `"行為判定"` | PCs at the quest spot roll dice; success/failure triggers penalty table |
| `"弾幕ごっこ"` | Starts a `type: "normal"` battle with `quest.enemy`; `finishBattle()` marks the quest solved on PC victory |

When starting a 弾幕ごっこ quest battle, set `battle.scenePcUid` to `currentScene.pcUid` so `finishBattle` can add the scene player to `actedPcs`.

### Map & Movement

`getDistances(startSpotId)` in `SessionApp.jsx` runs BFS over the spot graph (defined in `gameData.js`) to compute shortest paths. Results gate which spots a PC can move to in one turn.

### 能力スキル (Ability Skills) — ★全120能力 自動化完了

Each character has a base ability `pc.as = { name, type, desc }` and a grown version `pc.growthAbility` (same shape). `type` is `アクション` / `サポート` / `オート`. Built onto the PC object in `SessionApp.jsx` (both `as` and `growthAbility` are carried). There are **120** abilities (60 chars × {as, growthAbility}); 2 share a name (「魔法を使う程度の能力」＝霧雨魔理沙[アクション] / 聖白蓮[オート]) — disambiguated by `type`.

**Architecture mirrors spell cards**: declarative data in [src/data/abilityEffects.js](src/data/abilityEffects.js) (`ABILITY_EFFECTS` map + `getAbilityEffect(ability)` which resolves `byType` collisions via `ability.type`), handlers in `activateAbility` (PCCard). Each entry: `{ freq, auto, kind, params, passive?, note? }`.
- `freq`: usage limit `"day"` / `"session"` / `"scene"` / `null`. Tracked on `pc.abilityUse = { [name]: { day, session, sceneId } }`; `abilityUsedUp(ability)` gates the button, `withAbilityUse(base,name,freq)` records.
- `auto:true` + implemented `kind` → auto-applied. **Un-registered / un-implemented `kind` → manual fallback** (`activateAbility` logs `🔵 …を発動（効果はGMが処理）` so nothing silently breaks). Many kinds implemented — resource gains (`gain_yaruki`/`gain_rei`/`set_rei`/`gain_random_item`/`gain_choice_item`/`gain_yaruki_selfbond`/`reactive_gain`), cross-target pickers (`cure_bad_status`/`refresh_other_cheer_slot`/`destroy_one`/`boost_other_yaruki`/`surprise_bond`/`party_move`/`set_return_spot`/`grant_extra_scene`), `spend_item_gain_random`, scene re-process (`redo_own_scene`), subsystem (`spawn_minion`/`disguise`/`consume_rei_newspaper`).
- `reactive:true` → shows a 発動 button **even for オート** type (PCCard button condition `type !== "オート" || getAbilityEffect()?.reactive`); used for trigger-on-event abilities (死体を持ち去る etc.) where the player presses when the event fires.
- `passive:true` (オート) abilities have **no activate button**; effect woven into the subsystem site. Implemented passives: `applyAbilityPassiveStats` (虚無 霊力max), judgment-dice (`startAction`: パチュリー/打ち出の小槌), battle (`effectiveAttackPower` 剣術; `finishBattle` 怪力乱神), scene-end move (こいし 無意識), 拠点拡張 (`getBaseSpots`/`isAtBase`), movement BFS (`getAbilityMoveEdges` → `getDistances` extraEdges), 何でもひっくり返す (explore_result fumble/special flip), 比類なき脚力＋ (night やる気 in `doAdvanceCycle`).

**Activation UI**: `PCCard` shows the **active** ability (`activeAbility = grown ? growthAbility : as`) with a 「成長」 badge; non-`オート` types get a 発動 button → `SkillActivateModal` (reused, fully generic) → `activateAbility`. The old button was **broken** (reused the personality-skill `skillModal`); fixed to a dedicated `abilityModal`. **Always commit pc-update + log in one `upd`** (PCCard receives `upd` as a prop) — calling `onUpdatePc` then a separate `upd` for the log double-writes.

**成長 (growth)**: `growthAbilityUnlocked` (ability→＋) and `growthSpellUnlocked` (additional spell card) are **separate** unlock flags, each also toggleable in PCCard's GM-edit panel. `activeAbility = growthAbilityUnlocked ? growthAbility : as`.

The **session-end 成長 ceremony** (`GrowthCeremony` in `src/session/phases.jsx`, opened from `SessionEndView`'s 🌟 button): each player (GM: all PCs) chooses **成長** (both ok) — 弾幕スキル再修得 (pick from the session's appeared-character `ds` pool) + タグ獲得 (free text) — and **強化** (one of, each once-per-campaign) — 追加スペカ (`spell`) / 能力スキル＋ (`ability`) / 特別な絆 (`bond`, → `pc.specialBond = { target, targetUid, intimacy, word }`).

**Grown-character instances**: growth is persisted **per instance** to **Firebase `grownChars/{uid}/{instanceId}`** = `{ charId, charName, ds, tags[], enhancementsUsed[], specialBond, createdAt, updatedAt }` (NOT one-per-character). Only the owner may write `grownChars/{uid}` (rules), so when the **GM applies growth for another PC** the record is stored in gs as `pc.pendingGrowthRecord = { instanceId, record }` and the owner's `SessionEndView` effect persists it, then clears the field (the GM's end-session confirm warns while any are pending). The once-per-campaign check reads `pc.grownBase = { tags, enhancementsUsed, createdAt }` (snapshotted by Lobby at join and updated on apply) because the GM cannot read others' `grownChars`; `pc.growthApplied` prevents re-applying after reopening the modal. The ceremony writes to `pc.grownInstanceId` if the player joined as a grown char (updates it) or a **new id** if they joined ungrown (so the same base character grown in different playthroughs becomes **separate** selectable instances). `Lobby` lists the player's `grownChars` as a "★成長済みキャラクター" section alongside the ungrown base grid; selecting one sets `player.grownInstanceId` + writes the grown fields (tags = base+acquired, ds override, growth flags from `enhancementsUsed`, specialBond). PC build in SessionApp.jsx carries `specialBond` + `grownInstanceId`. `ProfilePage` (ScenarioEditor) has a "成長キャラ" tab to view/delete instances. The 特別な絆 "feeling word" is free-text (`specialBond.word`, default 敬意) → 《target への word》. **Session end** (`SessionEndView` delete-room button) exports the log, removes `roomSecrets/{code}` and `rooms/{code}`, which returns clients to the lobby (App's `phase` listener clears `roomCode` + the `?room` URL param when the room no longer exists). Before that, the GM sees a per-PL status panel (成長 ✓/⏳保存待ち, 実績 ✓/未記録 — `pc.growthApplied`, `pc.pendingGrowthRecord`, `pc.achRecorded` set when the player records achievements) and the confirm dialog warns about pending growth records and unrecorded achievements.

**親密度 (intimacy) live mechanics** (`pc.specialBond = { target, targetUid, intimacy, word, used }`): module-level `gainIntimacy(pcs, targetUid, amount, reason)` raises intimacy (1→10) of every holder whose `specialBond.targetUid` is that PC, and refreshes the cheer slot (`used=false`) each increase. Triggers: target's スペシャル (+1, in `explore_result` special reward + `confirmQuestRoll`) and 交流 (+1D6, in `proceed` when a non-self bond is newly acquired). The special bond **cheers** like a 《target への絆》 via `SPECIAL_BOND_CHEER` pseudo-label woven into `getSpecialBondCheer`→`renderCheerSection` (explore/quest) and `renderEvadeCheer` (danmaku); `cheerConsumePatch`/`applyCheer`/`applyCheerQuest`/evade-apply consume `specialBond.used` and roll **2 dice at intimacy 10** (1 otherwise).

**手下 (minion) subsystem**: `gs.minions = [{ id, ownerUid, ownerName, currentSpot }]`. `spawn_minion` adds one (人形/偶像 at spot, 式神 at base + SC cost). Rendered as a small 「手」 token layer in `MapView` (SessionApp.jsx). PCCard shows an owner-only panel to move (spot picker) / log an action / remove each minion. Minion-acts-in-scene re-processing is GM-run.

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
| `usePlotPlacement` | プロット配置: initial danmaku positions are chosen secretly and revealed simultaneously |

**Plot placement (commit–reveal)**: `PlotPlacementPanel` (battle.jsx). Each chooser writes `{ cell, nonce }` to `roomSecrets/{code}/plot/{ownUid}/{entityId}` (owner-only read; the GM owns NPC entries) and publishes only `gs.battle.plotCommits[entityId] = SHA-256("entityId:cell:nonce")`. When all committed the GM sets `phase: "plot_reveal"`; every owner's client copies its secrets into `gs.battle.plotRevealed` and deletes its secret node; the GM client verifies each hash against the commit, logs `⚠` on mismatch, and starts `round_start`. A GM fallback button places anyone who never revealed (disconnected) at random. BattleView needs `room` (config) and `roomCode` props.

### 実績 (Achievements)

Steam-style achievements, **per-player (uid)**, two layers. Defined declaratively in [src/data/achievements.js](src/data/achievements.js) (`ACHIEVEMENTS`, each `{ id, name, desc, type: "session"|"lifetime", bad?, check(ctx) }`; `bad:true` = 不名誉枠). ~41 total (incl. 8 char/situation-specific 超ニッチ). `SPOT_TOTAL`/`DS_TOTAL` import the real `SPOTS`/`OFFICIAL_DANMAKU_SKILLS` counts.

- **Session stats** are tracked per-PC in `pc.ach` (`{ spots[], graze, grazeTotal, specials, fumbles, intervene, interveneDecisive, spells, clues, items, livesDropped, livesZero, moved, specialBondGained, growthBoth }`), woven in at event sites via `bumpAch(pcs, uid, fn)` / `achAddTo` (exported from achievements.js). Because the PC is rebuilt each session, `pc.ach` is naturally session-scoped (no reset needed). `dsDecisive` is **derived** from `gs.battle.usedds[uid]` (final battle) — not tracked.
- **Lifetime stats** live at `users/{uid}/stats` (`sessions, chars[], bondTargets[], wins, graze, specials, fumbles, intervene, ds[], spots[], maxEnh, intimacy10, losses`); unlocked at `users/{uid}/achievements = { [id]: { at } }`; per-room dedup guard at `users/{uid}/achProcessed/{roomCode}`.
- **Processing**: `SessionEndView`'s "🏆 実績を記録する" button (player only, after growth) runs `aggregateLifetime(prevLife, pc, gs)` → `buildAchContext(pc, gs, life)` → evaluates every `check(ctx)` → persists new unlocks + shows a result modal. `maxEnh`/`intimacy10` are recomputed from `grownChars/{uid}` at processing time.
- **UI**: ProfilePage (ScenarioEditor) has an 実績 tab (unlocked/locked list + progress bar; 💀 for `bad`).
- **Not yet wired**: nothing major; item gains are counted only on the `proceed`-based path (`extraUpdates.pc.items`), and lifetime `ds` only captures final-battle skills (approximate).

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
- **Scene start/end**: fired in `SessionApp`'s scene-detection `useEffect` (SessionApp.jsx) — `sfx.sceneStart()` when `currentScene.pcUid` goes null→value, `sfx.sceneEnd()` when it goes value→null. Battle-active guard suppresses both.
- **Once-per-session skill activation**: `PCCard` has a `useEffect` watching `pc[PS_ONCE_FLAG]`; fires `sfx.skillActivate()` on the false→true transition, capturing all once-skills (カリスマ/不夜城/ご執心/用意周到/直感) in one place regardless of which button triggered them.
- **Item use**: `sfx.itemUse()` fired at the top of `PCCard`'s `useItem`.

**Dice sfx routing**:
- **Battle dice**: `BattleDiceTray` (inside `BattleView`) fires `sfx.diceRoll()` on rolling-start and `sfx.diceResult(maxDie)` on rolling-end via a `useRef(prevAnim)` watcher.
- **Explore dice**: `RightPanel` has a parallel `useEffect` watching `gs.dice?.rolling` that fires the same sfx — but **guards with `if (gs.battle?.active) return;`** to avoid double-firing during battle.

### BGM (`src/bgm.js`)

Background music is **GM-supplied URLs, played locally per client** (not synced playback). Two layers: a per-session override `gs.bgm.{explore,battle,end}` (🎵 panel in `RightPanel`), and a **pre-set GM preset** `users/{gmUid}/bgm.{explore,battle,end}` editable in advance (`BgmPresetEditor`, exported from `ScenarioEditor.jsx`, shown in ProfilePage's アカウント tab + the PrepRoom GM column). Each client's `SessionApp` subscribes to `users/{room.gmUid}/bgm` (`gmBgm`) and derives the active URL from phase with `gs.bgm[key] || gmBgm[key]` (session override wins, else the preset) → `bgm.setTrack(url)`. `bgm` wraps two `HTMLAudioElement`s for **crossfade** on track change. Volume/mute are personal settings in `localStorage` (`bgmVolume`/`bgmMuted`, **default muted**). Browser autoplay policy: `bgm.unlock()` is called on the first `pointerdown` (so `play()` runs inside a user gesture); before unlock, the desired track is remembered and started on unlock. Invalid URLs / autoplay rejections are swallowed silently.

### Reduced motion (`src/motion.js`)

`motion` centralizes animation suppression with a **3-state model** in `localStorage["reduceMotion"]`: unset → follow OS `prefers-reduced-motion`; `"1"` → user-forced suppression; `"0"` → user-forced animations (overrides an OS `reduce` setting). `motion.toggle()` flips the *effective* value and persists it as an explicit override, so **a user whose OS disables animations can still re-enable them in-app** (the earlier `_userPref || osReduced()` design wrongly let OS always win, killing all animation with no recourse). `motion.init()` (called once in `App`) injects a `<style id="reduce-motion-style">` into `<head>` and reflects the effective value into `<html data-reduce-motion="1">`; the injected CSS clamps all `animation-duration`/`transition-duration` to ~1ms and `animation-iteration-count` to 1 under that attribute, neutralizing every keyframe/transition across all screens in one place. The OS media-query listener only re-applies while no explicit override is set. **JS canvas animations are not covered by CSS** — `BattleParticleCanvas` separately early-returns when `motion.reduced`. Toggle UI lives in the `RightPanel` tab bar (🎬/🚫 button, always enabled).

### Font size (`src/fontScale.js`)

Because font sizes are **hardcoded px in inline styles** (~283 sites at 8–9px), readability is handled with a single global **`zoom` on `document.body`** rather than touching each site. `fontScale` is a 3-level setting (`1.0`/`1.15`/`1.3` = 標準/大/特大) persisted in `localStorage["fontScale"]`; **default `1.0` sets no zoom = pixel-identical to before** (opt-in). `fontScale.init()` (once in `App`) applies it; `fontScale.cycle()` advances the level. Toggle UI is the **`A` button in the `RightPanel` tab bar** (the glyph itself grows with the level as a cue). `zoom` reflows (so it scales the whole UI incl. portaled modals, which attach to `body`); at >1.0 the viewport-locked `height:100vh` roots exceed the viewport and the page scrolls. Mobile pinch-zoom is also available (the viewport meta does not set `user-scalable=no`). **GM panels on phones**: `fontScale.apply()` also sets `<html data-font-scale="0|1|2">` and injects `#touch-ui-style`: under `(pointer: coarse), (max-width: 820px)` every `[data-touch-zoom]` element gets `zoom: 1.2` (1.08 / 1 when the body zoom is already 大 / 特大; nested ones stay 1) and, on touch, buttons/selects/inputs get `min-height: 26px`. Marked roots: `GmToolsPanel`, `CustomRulesEditor`, `GmFieldEditor`, `GmPcEditor` — add the attribute to new dense GM-only panels (not to `position: fixed` overlays, whose width would grow past the viewport).

### Cinematic overlay pattern

`SessionApp` (in `SessionApp.jsx`) detects game events and shows transient full-screen overlays. The pattern is consistent:

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

- **Global keyframes** (used across phases): defined in `SessionApp.jsx`'s top-level `<style>` block — `logSlideIn`, `modalIn`, `backdropIn`, `resFlashUp/Down`, `questSolveAnim`, `clueBannerAnim`, `cycleOverlayAnim`, `badStatusIn`, `battleFadeIn`, `spotTipIn`, `sceneStartAnim`, `phaseFlashAnim`, `phaseStripe`.
- **Component-local keyframes**: defined in inline `<style>` blocks inside the component using them (e.g. `RightPanel` defines `scenePanelIn`, `diceIn`, `diceResultIn`; `BattleView` defines `phaseBannerAnim`, `brRing`/`brGlow`/`brCardIn` for the battle result cinematic).
- **MapView animations**: `mySpotGlow`, `myPortraitGlow`, `pulseRing` live in `MapView`'s local style.

### MapView PC layer

PCs on the map are rendered in a **separate absolute-positioned layer** after the spot list, not as children of spot divs. Their `left`/`top` use CSS `transition: left 0.52s cubic-bezier(0.4,0,0.2,1), top 0.52s ...` with a stable `key={pc.uid}`, so React reuses the DOM node and the browser animates the move when `pc.currentSpot` changes. Multiple PCs on the same spot are horizontally offset via `(idx - (N-1)/2) * 26px`.

### Battle effects (被弾・カットイン・回避)

Detection is pure in [src/battleFx.js](src/battleFx.js): `fxSnapshot(gs)` summarizes the battle (participants' 残り人数/グレイズ, positions, `spellUsedBy`, phase, isFinal) and `detectFx(prev, cur)` returns `spell` (new `spellUsedBy` entry), `hit` (残り人数 decreased; `cell` = position before, `ko` at 0), `dodge` (position changed while the previous phase matched `_evade_(intro|move|result)` — hit-recovery moves don't count) and `graze` (グレイズ increased; `cell` only during evasion). Nothing fires on join or across battle start/end. `useBattleFx(gs)` in `src/session/battleFx.jsx` runs it on every client locally (**no gs writes**, like the cinematic overlays) and returns `{ cutin, dismissCutin, hit, shake, gridFx }`; `BattleView` renders `HitOverlay` + `SpellCutin` at its root (outside the shaken content div, whose `animation` is `shakeAnimation(shake)` — two identical keyframe names alternate so the shake restarts) and passes `fx={fx.gridFx[id]}` to each `BattleGrid` (hit ring+shards on the cell, the lost 残り人数 dot breaking, dodge afterimage + dash-in, graze sparks + 「GRAZE +N」). The cut-in (replaces the old small `spellFlash` box) uses the attacker's 描写モード立ち絵 matched by name, else `customPortrait`, else the sprite; PC enters from the left (blue), enemy from the right (red), final battle in gold; tap to skip. Sounds: `sfx.hit` / `sfx.ko` / `sfx.graze(n)` / `sfx.cutin` + `sfx.spell`. **Reduced motion**: the global CSS would jump animations to their (transparent) end state, so with `motion.reduced` the hook emits no shake/grid effects and marks hit/cut-in `still` (static, `pointer-events: none` cut-in). Tests: `battleFx.test.jsx`.

### Battle background particles

`BattleParticleCanvas` (module-level in `src/session/battle.jsx`) is a 48-bullet canvas particle system rendered inside `BattleView`'s main return at `zIndex: 0`. Battle content is wrapped in a sibling div with `zIndex: 1` so it stacks above. The canvas uses `requestAnimationFrame` + `ResizeObserver`; cleanup cancels both on unmount.
