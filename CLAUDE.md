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
Lobby → PrepRoom → Intro → Explore → Battle → (Bonus) → End
```

1. **Lobby** (`Lobby.jsx`): Auth, room creation/joining, character + skill selection
2. **PrepRoom** (inside `App.jsx`): GM loads scenario; PLs confirm ready
3. **Intro**: Backstory narrative screen
4. **Explore**: Map movement, resource management, quest/clue discovery
5. **Battle**: Turn-based danmaku (bullet pattern) mini-game
6. **Bonus** (optional, config-gated): Extra actions if solving before the time limit

Phase is tracked as `gs.sessionPhase` and transitions are explicit with confirmation modals.

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

**`extra_support_cover` / `extra_support_cover_with_die_choice` effect types**: spells with only `structured.effects` (no `steps`) that grant extra intervention rights. `declareSpell` checks for these effect types after the steps block and sets `gs.battle.extraInterventionPool`. Spectator buttons (援護/かばう) in `BattleRightPanel` consume from the pool. `withDieChoice: true` variant (忿怒のレッドUFO襲来) lets the player pick any die face not yet used; normal variant (フォーオブアカインド) rolls a die randomly.

**Cell-placement constraint** (`condition_on_placement.exclude_enemy_cell: true` in `SPELL_CARD_EFFECTS`): propagated into `spellChoose.excludeEnemyCell`. The CHOOSE UI disables the defender's current cell.

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

**我儘**: Informational note displayed in explore_roll and quest_roll UI; no automatic dice adjustment (player interprets all bonds as self-bonds manually).

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

### Reduced motion (`src/motion.js`)

`motion` centralizes animation suppression. `motion.reduced` is the composite of the OS `prefers-reduced-motion` media query **and** an in-app toggle (`localStorage["reduceMotion"]`). `motion.init()` (called once in `App`) injects a `<style id="reduce-motion-style">` into `<head>` and reflects the composite into `<html data-reduce-motion="1">`; the injected CSS clamps all `animation-duration`/`transition-duration` to ~1ms and `animation-iteration-count` to 1 under that attribute, so every keyframe/transition across all screens is neutralized in one place. **JS canvas animations are not covered by CSS** — `BattleParticleCanvas` separately early-returns when `motion.reduced`. Toggle UI lives in the `RightPanel` tab bar (🎬/🚫 button, disabled when `motion.osForced`).

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
