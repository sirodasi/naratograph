# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**幻想ナラトグラフ (Gensou Naratograph)** is a real-time collaborative TRPG (Tabletop RPG) session support web app for Touhou Project-themed tabletop gaming. GMs and players connect to shared rooms via Firebase Realtime Database, which serves as the single source of truth.

## Commands

```bash
npm run dev        # Vite dev server with HMR
npm run build      # Production build
npm run lint       # ESLint (flat config)
npm run preview    # Preview production build locally
npm run normalize-db  # Node script to normalize Firebase DB schema
```

No test runner is configured.

## Architecture

### Tech Stack

- **React 19** (functional components + hooks only, no class components)
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
  setGs(prev => {
    const next = typeof fn === "function" ? fn(prev) : fn;
    set(ref(db, gsPath), next).catch(console.error);
    return next;
  });
}, [gsPath]);
```

Local React state is only used for UI-only concerns (hover, modals, animation frames). Never write game state to local state directly — always go through `upd()`.

### Firebase Schema

```
rooms/{roomCode}/
├── gmUid, gmName, phase
├── players/{uid}/{ charId, charName, personalitySkill, role, ready }
├── scenario, scenarioData
├── config/{ useAdditionalActions, useClueEvents }
├── state   ← gs object (entire game state)
└── scene   ← background/portrait data for scene mode
```

### Key `gs` Fields

| Field | Description |
|---|---|
| `sessionPhase` | `"intro" \| "explore" \| "battle" \| "battle_bonus"` |
| `day`, `cycleIdx` | Current day (1–5) and time slot (0=朝, 1=昼, 2=夕, 3=夜) |
| `pcs[]` | Player character array with resources, position, items |
| `battle` | Full battle state (phase, round, participants, danmaku grid) |
| `quests[]` | Quest list with solved status and enemy references |
| `clues[]` | Discovered spot IDs |
| `resources` | Shared party resources (やる気, 残り人数, etc.) |
| `log[]` | Session event log |

### Major Components

| File | Responsibility |
|---|---|
| [App.jsx](src/App.jsx) | Root: Firebase listeners, phase routing, BFS pathfinding (`getDistances`), map rendering |
| [SessionView.jsx](src/SessionView.jsx) | **~5000-line monolith**: BattleView, BonusPhaseView, BackstoryScreen, RightPanel |
| [Lobby.jsx](src/Lobby.jsx) | Auth flow, room prep, character/skill selection |
| [ScenarioEditor.jsx](src/ScenarioEditor.jsx) | GM tool for authoring scenarios, quests, enemies, danmaku skills |
| [firebase.js](src/firebase.js) | Firebase init + auth providers |

### Data Files

| File | Contents |
|---|---|
| [src/data/characters.js](src/data/characters.js) | 60+ characters with abilities and spells |
| [src/data/gameData.js](src/data/gameData.js) | Spots, edges, newspaper effects (D66), danmaku skills |
| [src/data/spots.js](src/data/spots.js) | Spot descriptions and event text |

### Danmaku Combat System

The battle mini-game uses a 6×6 grid. Each round:
1. Attacker selects a danmaku skill and places bullets on the defender's grid
2. Defender moves to avoid bullets (movement limited by resources)
3. Skills modify outcomes: homing, wide shot, evasion, bullet erase, etc.
4. Spellcard declarations are announced at the start of a round (`declaredSpellcard`)

Danmaku skill data is stored as a nested `ds` object on enemies (normalized from legacy flat `dsType/dsName` fields via `normalizeScenario()` in App.jsx).

### Map & Movement

`getDistances(startSpotId)` in App.jsx runs BFS over the spot graph (defined in `gameData.js`) to compute shortest paths. Results gate which spots a PC can move to in one turn.

### Adding Content

- **New character**: Add an entry to the `CHARACTERS` array in [src/data/characters.js](src/data/characters.js)
- **New scenario**: Use ScenarioEditor in-app, or write a scenario object matching the `scenarioData` shape in [src/data/gameData.js](src/data/gameData.js)
- **New spot**: Add to the spots array in [src/data/gameData.js](src/data/gameData.js) and add edges; add description to [src/data/spots.js](src/data/spots.js)
- **New danmaku skill**: Add to `DANMAKU_SKILLS` in [src/data/gameData.js](src/data/gameData.js) and handle the skill type in BattleView's attack resolution logic

## Conventions

- All UI text and comments are in Japanese
- Inline styles only; import color constants from [src/styles/colors.js](src/styles/colors.js) rather than hardcoding hex values
- GM-only actions are styled red; PL actions blue; success states green; selection gold
- `gs` mutations must go through `upd()` — never call `set()`/`update()` directly from child components; pass `upd` as a prop
