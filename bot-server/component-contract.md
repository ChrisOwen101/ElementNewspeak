# Component Contract

You are building a self-contained HTML component that runs inside a sandboxed
iframe within Element Web (a Matrix chat client).

The component's **application state lives entirely in Matrix room events**. The
room is the database. Every piece of data the user creates, updates, or deletes
must be stored as a Matrix event so it is persistent, shared with other room
members, and synced in real-time.

## File Structure

Write a SINGLE `index.html` file with inline CSS and JS. No external
dependencies, no npm packages, no build tools beyond what's provided.

## Data Bridge — Reading Data

You receive room data from the parent via postMessage. This fires once on load
and again whenever the room's timeline updates (new events arrive):

```js
window.addEventListener("message", (event) => {
    if (event.data.type === "ROOM_DATA") {
        const { messages, roomState } = event.data;
        // messages: Array<{ eventId, type, sender, senderDisplayName, content, timestamp }>
        //   — all timeline events in the room, including your custom ones
        // roomState: { roomName, members: Array<{ userId, displayName }> }
        render(messages, roomState);
    }
});
```

### Deriving app state from events

Filter `messages` by your custom event types to build application state.
For example, a kanban board should:

```js
function getCards(messages) {
    return messages
        .filter(m => m.type === "io.element.kanban.card")
        .map(m => ({
            id: m.eventId,
            title: m.content.title,
            column: m.content.column,
            author: m.senderDisplayName,
            createdAt: m.timestamp,
        }));
}
```

**Important:** Treat the messages array as the single source of truth. Re-derive
your full UI state on every `ROOM_DATA` message. Do NOT maintain local state
that diverges from the event stream.

## Data Bridge — Writing Data

To persist data, send events through the bridge. The parent (Element Web)
will post them as real Matrix events into the room:

```js
// Send a custom event
parent.postMessage({
    type: "ACTION_SEND_EVENT",
    eventType: "io.element.kanban.card",
    content: { title: "New task", column: "todo" }
}, "*");

// Send a regular chat message
parent.postMessage({
    type: "ACTION_SEND_EVENT",
    eventType: "m.room.message",
    content: { msgtype: "m.text", body: "Hello from the component" }
}, "*");
```

### Event type naming

Use a unique namespace prefix for your custom events. Convention:
`io.element.<appname>.<entity>`, e.g.:
- `io.element.kanban.card` — a kanban card
- `io.element.kanban.card_move` — moving a card between columns
- `io.element.todo.item` — a to-do item
- `io.element.poll.vote` — a poll vote

### Patterns for common operations

**Create:** Send a new event with the data:
```js
parent.postMessage({
    type: "ACTION_SEND_EVENT",
    eventType: "io.element.todo.item",
    content: { title: "Buy milk", done: false }
}, "*");
```

**Update:** Send a new event that references the original by eventId:
```js
parent.postMessage({
    type: "ACTION_SEND_EVENT",
    eventType: "io.element.todo.item_update",
    content: { targetEventId: "original_event_id", done: true }
}, "*");
```

**Derive final state:** Process events in timestamp order, applying updates:
```js
function getTodos(messages) {
    const items = new Map();
    for (const m of messages) {
        if (m.type === "io.element.todo.item") {
            items.set(m.eventId, { ...m.content, id: m.eventId, author: m.senderDisplayName });
        } else if (m.type === "io.element.todo.item_update") {
            const existing = items.get(m.content.targetEventId);
            if (existing) items.set(m.content.targetEventId, { ...existing, ...m.content });
        }
    }
    return [...items.values()];
}
```

## Rules

- Render into `<div id="app"></div>`
- Include `<meta charset="utf-8">` and `<meta name="viewport" content="width=device-width, initial-scale=1">`
- Use modern CSS (flexbox/grid). Inline all styles in a `<style>` tag.
- Handle empty state (no data events yet — show a helpful prompt or empty state)
- Handle live updates (re-render fully on every ROOM_DATA message)
- NO access to: parent DOM, localStorage, cookies, external URLs
- No local-only state for data that should persist. Use Matrix events for everything.
- The component should look polished and professional
- Use a dark theme by default (background: #15191E, text: #F4F4F5)
  to match Element's dark mode
- Use the system font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- Show the sender's display name on user-created content

## Output

Write ONLY the `index.html` file to the path specified in the task.
Then ensure it is copied to the dist/ directory.
Verify the output exists before finishing.
