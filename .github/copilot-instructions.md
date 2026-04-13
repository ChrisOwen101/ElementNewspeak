# Element Web – Copilot Instructions

## Monorepo Structure

This is a pnpm monorepo managed with Nx:

- `apps/web/` – The Element Web application (not published to npm; has its own `src/`, `test/`, `playwright/`)
- `packages/shared-components/` – `@element-hq/web-shared-components`, a reusable React component library (published to npm, developed in Storybook)
- `packages/playwright-common/` – Shared Playwright helpers

All commands are run from the **repo root** using `pnpm`. App-level commands delegate to Nx: `pnpm build`, `pnpm start`, `pnpm test`.

## Developer Workflow

### Quick Start (recommended)

```bash
./dev.sh   # installs deps, starts Element Web + generation server with live reload
```

`dev.sh` handles:

- `pnpm install` (skips postinstall scripts that need Node >=22.18)
- Copies `.env.example` → `.env` on first run (then exits so you can fill in credentials)
- Kills stale processes on ports 8080 / 3001
- Enables `--experimental-strip-types --experimental-transform-types` on Node <22.18
- Starts both services in parallel with colour-coded output; Ctrl+C stops both

Element Web dev server: `http://127.0.0.1:8080` (webpack HMR)
Generation server: `http://localhost:3001` (tsx, restarts on file changes)

### Individual Commands

```bash
pnpm install              # install all workspace dependencies
pnpm start                # webpack dev server at http://127.0.0.1:8080
pnpm build                # production build
pnpm test                 # unit tests (Jest via Nx)
pnpm lint                 # runs lint:types + lint:js + lint:style
pnpm test:playwright      # E2E tests (Playwright)
```

### Docker

```bash
docker-compose up --build   # starts Element Web + bot-server together
```

Config: copy `apps/web/config.sample.json` → `apps/web/config.json` before running locally.

To develop against a local `matrix-js-sdk`, create `apps/web/.link-config`:

```
matrix-js-sdk=/path/to/matrix-js-sdk
```

## Architecture

### Flux Dispatcher

All cross-component communication flows through `src/dispatcher/dispatcher.ts` (a singleton `MatrixDispatcher`). Actions are defined as an enum in `src/dispatcher/actions.ts` (snake_case naming, e.g. `Action.ViewRoom`). Each action has a typed payload interface in `src/dispatcher/payloads/`.

### Stores

Stores live in `src/stores/`. The base classes are:

- `AsyncStore<T>` – flux store with async action handling
- `AsyncStoreWithClient<T>` – extends above, gains `onReady()`/`onNotReady()` lifecycle tied to `MatrixClient` availability

Stores dispatch actions and are not imported directly into React components; use hooks or context instead.

### MVVM Pattern (new UI code)

New UI should follow MVVM:

1. **View** – dumb React component in `packages/shared-components/src/`, uses `useViewModel(vm)` hook, defines its own `ViewModel` interface
2. **ViewModel** – class extending `BaseViewModel` in `apps/web/src/viewmodels/`, implements the view's interface, calls stores/SDK
3. **Model** – `matrix-js-sdk` or existing stores

Views must not contain business logic. Views call `useViewModel(vm)` which is powered by `useSyncExternalStore`. Example:  
`packages/shared-components/src/` + `apps/web/src/viewmodels/`

### Settings & Feature Flags

All settings are declared in `src/settings/Settings.tsx` under the `SETTINGS` constant. Read/write via `SettingsStore.getValue(name, roomId)` / `SettingsStore.setValue(name, roomId, level, value)`.

Feature flags are settings with `isFeature: true` and the name prefix `feature_`. Use `LEVELS_FEATURE` as `supportedLevels`. Document new labs features in `docs/labs.md`.

Levels (highest to lowest priority): `device` → `room-device` → `room-account` → `account` → `room` → `config` → `default`.

### Internationalisation

All user-visible strings must use `_t("key")` or `_td("key")` (tagged for extraction). Strings live in `src/i18n/strings/en_EN.json` (nested JSON). After adding/modifying strings run:

```bash
pnpm i18n   # regenerates + sorts + lints the translation file
```

Never hardcode user-visible text.

### Compound Design System

UI components must use [Compound Web](https://compound.element.io) (`@vector-im/compound-web`) and Compound design tokens. `shared-components` wraps these into larger, reusable views.

### Module API

Customisations use the Module API (`@element-hq/element-web-module-api`). The old `customisations.json` override mechanism is deprecated – open an issue if the Module API doesn't cover your use-case.

## Code Conventions

- **TypeScript everywhere.** Convert JS to TS when touching a file. Enable exhaustive types (`noImplicitAny`).
- **Named exports only.** No default exports.
- **Prettier** (4-space indent, 120-char line limit, Unix newlines) – run `pnpm lint:js-fix` to auto-fix.
- Interface names have **no `I` prefix** (e.g. `RoomViewStore`, not `IRoomViewStore`).
- Prefer `readonly` members; use `const` / `let` (never `var`).
- Boolean variables must actually be `boolean` type (`!!x` or `Boolean(x)`, not bare `x && y`).
- `eslint-disable` / `@ts-ignore` must have an accompanying comment explaining why.

## Licensing

Every new file must begin with:

```
Copyright 20XX New Vector Ltd.
SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
```

## Dynamic Rooms

Dynamic Rooms is a custom feature that generates and renders custom room views using Claude Code. It follows the standard MVVM pattern.

### Architecture

- **Generation Server** (`bot-server/`) – A standalone Node.js/TypeScript HTTP API server. It receives prompts from Element Web via `POST /generate`, runs Claude Code to produce an HTML bundle, and returns `{ bundleUrl }`. No Matrix credentials needed.
- **Data model** – `apps/web/src/dynamic-rooms/constants.ts` and `schema.ts` define the room schema, event type constants, and the generation API URL.
- **Store** – `apps/web/src/stores/DynamicRoomStore.ts` (extends `AsyncStoreWithClient`) manages dynamic room state. On prompt submit, it calls the generation server HTTP API, then posts the `io.element.custom_renderer` state event into the room using the existing MatrixClient.
- **ViewModel** – `apps/web/src/viewmodels/dynamic-room/DynamicRoomViewModel.ts` exposes state to the view layer.
- **View** – `packages/shared-components/src/dynamic-room/DynamicRoomView.tsx` + `DynamicRoomBridge.tsx` render the dynamic room UI. CSS is in `DynamicRoomView.module.css`.
- **Integration** – `apps/web/src/components/structures/RoomView.tsx` wires the Dynamic Room view in. The dispatcher action `Action.SubmitDynamicRoomPrompt` (payload: `SubmitDynamicRoomPromptPayload`) triggers generation.

### Running Locally

```bash
./dev.sh   # starts Element Web (HMR) + generation server with live reload
```

Or with Docker:

```bash
docker-compose up --build   # starts Element Web + generation server together
```

See `bot-server/README.md` and `bot-server/component-contract.md` for the server's API and Claude Code system prompt.

## Key Files & Docs

- `docs/settings.md` – full settings API reference
- `docs/feature-flags.md` – feature flag workflow
- `docs/MVVM.md` – MVVM pattern guide
- `docs/monorepo.md` – branch/release strategy
- `apps/web/src/dispatcher/actions.ts` – all dispatcher actions
- `packages/shared-components/` – develop views here, use Storybook
- `bot-server/README.md` – generation server setup and API reference
- `bot-server/component-contract.md` – Claude Code system prompt for bundle generation
- `apps/web/src/dynamic-rooms/` – Dynamic Rooms constants and schema
- `apps/web/src/stores/DynamicRoomStore.ts` – Dynamic Rooms flux store
