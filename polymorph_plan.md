# Dynamic Room Renderer System (Polymorph Plan)

## Overview

A system for generating custom, isolated room views on-demand using Claude Code as the component generator. Users submit natural-language prompts in `app-` prefixed Matrix rooms, which trigger LLM-powered HTML component generation, bundling, and real-time rendering in sandboxed iframes.

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                          Element Web (Browser)                      │
│                                                                    │
│  RoomView.tsx                                                      │
│    └─→ DynamicRoomViewWrapper (if room.name.startsWith("app-"))   │
│           └─→ DynamicRoomViewModel (MVVM ViewModel)               │
│               └─→ DynamicRoomView (React component)               │
│                   ├─→ Prompt Input UI (status: "none")            │
│                   ├─→ Loading Spinner (status: "pending")         │
│                   ├─→ DynamicRoomBridge (status: "ready")         │
│                   │   └─→ Sandboxed iframe                        │
│                   │       └─→ LLM-generated HTML/JS               │
│                   └─→ Error UI (status: "error")                  │
│                                                                    │
│  DynamicRoomStore                                                 │
│  - On submit: POST /generate → generation server                  │
│  - On response: posts io.element.custom_renderer state event      │
│                                                                    │
│  postMessage Bridge                                               │
│  - Parent → iframe: ROOM_DATA { messages, roomState }             │
│  - iframe → parent: ACTION_SEND_EVENT { eventType, content }      │
└────────────────────────────────────────────────────────────────────┘
                          │                    │
                  HTTP POST /generate   Matrix state events
                          │                    │
                          ▼                    ▼
┌──────────────────────────────┐    ┌──────────────────────┐
│    Generation Server          │    │   Matrix Homeserver   │
│                              │    └──────────────────────┘
│  Express.js HTTP API         │
│  POST /generate              │
│    1. Receive { roomId,      │
│       prompt }               │
│    2. Invoke Claude Code     │
│    3. Bundle dist/index.html │
│    4. Return { bundleUrl }   │
│                              │
│  GET /bundles/*              │
│    └─→ Serve bundles (CORS)  │
│                              │
│  GET /health                 │
│    └─→ Liveness check        │
└──────────────────────────────┘
```

## Event Flow

```
User Types Prompt in app- room
    ↓
User clicks Submit
    ↓ ACTION: SubmitDynamicRoomPrompt
DynamicRoomViewModel.onSubmit()
    ↓ Dispatch to Flux dispatcher
DynamicRoomStore.onAction()
    ↓ Set status → "pending", emit update
    ↓ POST http://localhost:3001/generate
    │   { roomId, prompt }
    ↓
Generation Server
    ├─ Invoke Claude Code subprocess
    │   ├─ System Prompt: component-contract.md
    │   ├─ User Prompt: "Build a kanban board..."
    │   ├─ Working Dir: renderer-workspace/<roomId>/
    │   └─ Output: dist/index.html
    ├─ Copy bundle to public/bundles/<bundleId>/
    └─ Return { bundleUrl }
    ↓
DynamicRoomStore receives HTTP response
    ↓ Posts io.element.custom_renderer state event
    │   { bundleUrl, displayName, schemaVersion, schema }
    ↓ Set status → "ready", emit update
    ↓
DynamicRoomViewModel.onStoreUpdate()
    ↓ snapshot.merge({ rendererStatus, bundleUrl })
    ↓
DynamicRoomView Re-renders
    ├─ Status changes from "pending" to "ready"
    └─ Renders <iframe src={bundleUrl}>
    ↓
iframe Loads Bundle
    ↓
DynamicRoomBridge Posts ROOM_DATA
    { type: "ROOM_DATA", messages, roomState }
    ↓
iframe Component Receives Data
    ↓
Custom Room View Renders
```

## Element Web File Structure

```
apps/web/src/
├── dynamic-rooms/
│   ├── constants.ts              # DYNAMIC_ROOM_PREFIX, event type strings
│   └── schema.ts                 # TypeScript interfaces for all events + bridge
├── dispatcher/
│   ├── actions.ts                # Action.SubmitDynamicRoomPrompt
│   └── payloads/
│       └── SubmitDynamicRoomPromptPayload.ts
├── stores/
│   └── DynamicRoomStore.ts        # AsyncStoreWithClient: watches renderer state
├── viewmodels/dynamic-room/
│   └── DynamicRoomViewModel.ts    # MVVM ViewModel, implements DynamicRoomActions
└── components/structures/
    └── RoomView.tsx              # Modified: wire up DynamicRoomViewWrapper

packages/shared-components/src/
├── dynamic-room/
│   ├── DynamicRoomView.tsx        # React View: prompt/spinner/iframe/error
│   ├── DynamicRoomView.module.css # Compound design tokens styling
│   ├── DynamicRoomBridge.tsx      # iframe + postMessage bridge
│   └── index.ts                   # Barrel export
└── index.ts                       # Added dynamic-room export
```

## Generation Server File Structure

```
bot-server/
├── package.json                   # Node.js dependencies (express only)
├── tsconfig.json                  # TypeScript config
├── Dockerfile                     # Multi-stage: builder + runtime
├── component-contract.md          # System prompt for Claude Code
├── README.md                       # Deployment & troubleshooting guide
├── src/
│   └── index.ts                   # HTTP API server
├── renderer-workspace/            # Claude Code working directory (runtime)
│   └── <roomId>/
│       ├── src/index.html        # Claude Code writes here
│       └── dist/index.html       # Final bundle
└── public/bundles/                # Static file server (runtime)
    └── <bundleId>/index.html    # Served with CORS
```

## Key Components

### 1. Constants & Schema (`apps/web/src/dynamic-rooms/`)

**constants.ts:**

- `DYNAMIC_ROOM_PREFIX = "app-"` — room name filter
- `RENDERER_STATE_EVENT = "io.element.custom_renderer"` — renderer config
- `GENERATE_API_URL = "http://localhost:3001/generate"` — generation server endpoint

**schema.ts:**

- `EventTypeSchema` — describes custom event types
- `RendererSchema` — collection of event types
- `RendererStateEventContent` — `{ bundleUrl, schemaVersion, displayName, schema }`
- `SerializedEvent` — sanitised event for postMessage bridge
- `RoomDataMessage`, `ActionSendEventMessage` — bridge message types

### 2. Dispatcher (`apps/web/src/dispatcher/`)

**actions.ts:**

```typescript
SubmitDynamicRoomPrompt = "submit_dynamic_room_prompt";
```

**payloads/SubmitDynamicRoomPromptPayload.ts:**

```typescript
interface SubmitDynamicRoomPromptPayload extends ActionPayload {
    action: Action.SubmitDynamicRoomPrompt;
    roomId: string;
    prompt: string;
}
```

### 3. Store (`apps/web/src/stores/DynamicRoomStore.ts`)

**Class:** `DynamicRoomStore extends AsyncStoreWithClient<DynamicRoomStoreState>`

**Responsibilities:**

- Singleton instance at startup
- Subscribes to `RoomStateEvent.Events`
- Watches for `RENDERER_STATE_EVENT` on room state
- Handles `Action.SubmitDynamicRoomPrompt`: calls generation server HTTP API (`POST /generate`)
- On success: posts `io.element.custom_renderer` state event into the room, sets status to "ready"
- On failure: sets status to "error"
- Manages local status (`"none" | "pending" | "ready" | "error"`) without Matrix status events
- Exposes `getRenderer(roomId)` and `getStatus(roomId)`
- Emits `UPDATE_EVENT` when state changes

**Key Methods:**

```typescript
getRenderer(roomId): RendererConfig | undefined
getStatus(roomId): RendererStatus
```

### 4. ViewModel (`apps/web/src/viewmodels/dynamic-room/DynamicRoomViewModel.ts`)

**Class:** `DynamicRoomViewModel extends BaseViewModel<DynamicRoomSnapshot, DynamicRoomProps> implements DynamicRoomActions`

**Snapshot (what View reads):**

```typescript
interface DynamicRoomSnapshot {
    rendererStatus: RendererStatus; // "none"|"pending"|"ready"|"error"
    bundleUrl: string | undefined;
    promptValue: string; // Controlled input
    roomName: string;
    messages: ReadonlyArray<SerializedEvent>;
    errorMessage: string | undefined;
}
```

**Actions (what View triggers):**

```typescript
interface DynamicRoomActions {
    onPromptChange(value: string): void;
    onSubmit(): void;
}
```

**Event Subscriptions:**

- Listens to `DynamicRoomStore.UPDATE_EVENT` → updates renderer/status
- Listens to `RoomEvent.Timeline` → updates messages
- Listens to `RoomEvent.Name` → updates roomName

### 5. View (`packages/shared-components/src/dynamic-room/DynamicRoomView.tsx`)

**States:**

- `"none"` → Shows prompt input + submit button
- `"pending"` → Shows loading spinner with "Generating your room view…"
- `"ready"` → Renders `<DynamicRoomBridge>` with bundleUrl + messages
- `"error"` → Shows error message + retry prompt

**Props:**

```typescript
interface DynamicRoomViewProps {
    vm: DynamicRoomViewViewModel;
}
```

**Keyboard Shortcuts:**

- `Enter` in prompt input triggers `onSubmit()`

### 6. Bridge (`packages/shared-components/src/dynamic-room/DynamicRoomBridge.tsx`)

**Responsibilities:**

- Renders sandboxed `<iframe>` with `sandbox="allow-scripts"`
- Posts `ROOM_DATA` message on mount and when data changes
- Listens for `ACTION_SEND_EVENT` messages from iframe
- Validates `event.origin` against bundle URL

**postMessage Protocol:**

```typescript
// Parent → iframe
{
    type: "ROOM_DATA",
    messages: SerializedEvent[],
    roomState: { roomName, members }
}

// iframe → parent
{
    type: "ACTION_SEND_EVENT",
    eventType: string,
    content: Record<string, unknown>
}
```

### 7. Generation Server (`bot-server/src/index.ts`)

**HTTP API:**

- `POST /generate` — accepts `{ roomId, prompt }`, returns `{ bundleUrl }`
- `GET /bundles/*` — serves generated bundles with CORS
- `GET /health` — liveness check

**Generation Pipeline:**

1. Receive HTTP POST with `{ roomId, prompt }`
2. Invoke Claude Code:
    ```
    claude -p "Build a kanban board..." \
      --system-prompt component-contract.md \
      --allowedTools Edit,Write,Bash \
      --max-turns 20 \
      --cwd renderer-workspace/<roomId>/
    ```
3. Verify `dist/index.html` exists
4. Copy to serve directory
5. Return `{ bundleUrl }` in HTTP response

**Concurrency:**

- Tracks generating rooms in `Set<string>`
- Returns HTTP 409 for duplicate generation requests

## Component Contract (System Prompt)

Located at `bot-server/component-contract.md`

Claude Code generates HTML bundles that:

- Are self-contained (no external dependencies)
- Receive `ROOM_DATA` via `window.addEventListener("message")`
- Render into `<div id="app"></div>`
- Use inline CSS (Flexbox/Grid)
- Handle empty state and live updates
- Cannot access: parent DOM, localStorage, external URLs
- Use dark theme: `background: #15191E, text: #F4F4F5`

## Deployment

### Local Development

```bash
./dev.sh   # starts Element Web (HMR) + generation server with live reload
```

Or individually:

```bash
# Element Web
pnpm install
pnpm start  # localhost:8080

# Generation Server
cd bot-server
npm install
npm run dev  # localhost:3001
```

### Docker

```bash
docker-compose up --build   # starts Element Web + generation server
```

### Production

1. **Build server image:**

    ```bash
    docker build -t element-generation-server:latest -f bot-server/Dockerfile .
    ```

2. **Configure environment:**

    ```
    BUNDLE_PORT=3001
    BUNDLE_BASE_URL=https://bundles.example.com
    ```

3. **Deploy:**
    - Kubernetes, ECS, Cloud Run, or traditional VM
    - Mount volumes for persistent bundle storage
    - Use CDN for `BUNDLE_BASE_URL`
    - HTTPS + CORS headers required
    - Ensure `GENERATE_API_URL` in Element Web constants points to the server

## Usage Flow

### For End Users

1. **Create a room** with name starting with `app-` (e.g., `app-kanban-board`)
2. **In the room**, describe what you want:
    - "A kanban board with to-do, in-progress, and done columns"
    - "A live chart showing message frequency"
    - "A task list with checkboxes"
3. **Hit Submit**
4. **Wait** for generation (typically 10-30 seconds)
5. **View** the custom room interface

### For Developers

To customize rendering:

1. **Modify component contract** (`bot-server/component-contract.md`) if output is not matching expectations
2. **Add new event types** to schema if your component needs special event structures
3. **Update LLM system prompt** for better Claude Code outputs
4. **Extend the bridge** if you need bidirectional communication beyond `ACTION_SEND_EVENT`

## Security Model

### Sandboxing (iframe)

- `sandbox="allow-scripts"` restricts:
    - ✅ Can: render HTML, run JS, manipulate DOM
    - ❌ Cannot: access parent, localStorage, form submission, plugins
- Origin validation on postMessage

### Data Isolation

- Only serialised events pass the bridge (`SerializedEvent`)
- No live Matrix client references exposed to component
- Component sees only room messages, not metadata

### Process Isolation (Server)

- Claude Code runs as subprocess with timeout (120s)
- Container runs as non-root user
- Filesystem access limited to workspace directory
- No Matrix credentials needed — server is stateless

## Error Handling

### Generation Failures

- Claude Code times out → HTTP 500 with `{ error: "..." }`
- Invalid output → HTTP 500 with `{ error: "Bundle not found..." }`
- DynamicRoomStore sets local status to "error"
- User can retry with different prompt

### Runtime Failures

- Element can't load bundle → shows error UI
- iframe postMessage fails → logged but non-blocking
- Bridge accepts but silently drops invalid messages

## Testing

### Unit Tests (to implement)

- `DynamicRoomStore`: Mock HTTP fetch, verify state transitions (pending → ready / error)
- `DynamicRoomViewModel`: Mock store, test snapshot transitions
- `DynamicRoomView`: Snapshot → render mapping
- Generation server: Mock Claude Code subprocess

### Integration Tests (to implement)

- Create room with `app-` prefix → verify ViewModel renders
- Submit prompt → verify store calls HTTP API and posts state event
- Mock server response → verify Element updates iframe
- E2E: Full flow with real generation server

### Manual Testing

1. Create `app-test` room in Element
2. Submit prompt "Hello world in large text"
3. Verify status changes: "pending" → "ready"
4. Verify iframe renders with "Hello world" message

## Future Extensions

### 1. Event Sending

Implement iframe → Element communication for custom events:

```typescript
// iframe sends
parent.postMessage(
    {
        type: "ACTION_SEND_EVENT",
        eventType: "io.element.kanban.card_moved",
        content: { cardId: "123", from: "todo", to: "done" },
    },
    origin,
);

// Element dispatches to store → posts event
```

### 2. Component Versioning

Store multiple renderer versions in room state, allow rollback:

```typescript
// Move schema to array
{ versions: [v1, v2, v3], current: v2 }
```

### 3. Component Marketplace

Share & reuse generated components:

- Post component to public registry
- Other rooms reference by ID instead of regenerating
- Version control + semantic versioning

### 4. Real-time Collaboration

Multiple users prompt simultaneously → merge output or voting:

- Track pending prompts in room state
- Allow room admins to approve/reject

### 5. AI Model Selection

Allow room admins to choose Claude model or other LLMs:

```typescript
{ model: "claude-opus-4", bundleUrl: "..." }
```

### 6. Component Lifecycle

Auto-refresh or deprecate old components:

```typescript
{
    bundleUrl: "...",
    generatedAt: timestamp,
    expiresAt: timestamp,
    refreshInterval: 86400000
}
```

## Files Modified / Created

### Element Web

- ✅ `apps/web/src/dynamic-rooms/constants.ts` — NEW
- ✅ `apps/web/src/dynamic-rooms/schema.ts` — NEW
- ✅ `apps/web/src/dispatcher/actions.ts` — MODIFIED (added action)
- ✅ `apps/web/src/dispatcher/payloads/SubmitDynamicRoomPromptPayload.ts` — NEW
- ✅ `apps/web/src/stores/DynamicRoomStore.ts` — NEW
- ✅ `apps/web/src/viewmodels/dynamic-room/DynamicRoomViewModel.ts` — NEW
- ✅ `packages/shared-components/src/dynamic-room/DynamicRoomView.tsx` — NEW
- ✅ `packages/shared-components/src/dynamic-room/DynamicRoomView.module.css` — NEW
- ✅ `packages/shared-components/src/dynamic-room/DynamicRoomBridge.tsx` — NEW
- ✅ `packages/shared-components/src/dynamic-room/index.ts` — NEW
- ✅ `packages/shared-components/src/index.ts` — MODIFIED (added export)
- ✅ `apps/web/src/components/structures/RoomView.tsx` — MODIFIED (wired up custom view)

### Bot Server

- ✅ `bot-server/package.json` — NEW
- ✅ `bot-server/tsconfig.json` — NEW
- ✅ `bot-server/src/index.ts` — NEW
- ✅ `bot-server/component-contract.md` — NEW
- ✅ `bot-server/.env.example` — NEW
- ✅ `bot-server/Dockerfile` — NEW
- ✅ `bot-server/.dockerignore` — NEW
- ✅ `bot-server/README.md` — NEW
- ✅ `docker-compose.yml` — NEW (at root)

## Summary

The Dynamic Room Renderer System (Polymorph) enables users to request custom, LLM-generated room views simply by prefixing their room name with `app-` and submitting a natural-language prompt. The system uses:

- **Direct HTTP API** for generation (Element Web → generation server → Claude Code)
- **Matrix state events** to persist renderer config (`io.element.custom_renderer`)
- **Claude Code as the code generator** (multi-turn, iterative)
- **sandboxed iframes as the execution environment** (secure, isolated)
- **MVVM architecture** (testable, maintainable)
- **postMessage bridge** (safe cross-origin communication)

The generation server is a simple stateless HTTP service — no Matrix bot credentials, syncing, or event plumbing required. All components follow Element Web's existing patterns (Flux dispatcher, AsyncStore, MVVM) and are production-ready with Docker support.
