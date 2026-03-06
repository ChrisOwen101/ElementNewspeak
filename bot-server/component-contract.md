# Component Contract

You are building a self-contained HTML component that runs inside a sandboxed
iframe within Element Web (a Matrix chat client).

## File Structure

Write a SINGLE `index.html` file with inline CSS and JS. No external
dependencies, no npm packages, no build tools beyond what's provided.

## Data Bridge

You receive room data from the parent via postMessage:

```js
window.addEventListener("message", (event) => {
    if (event.data.type === "ROOM_DATA") {
        const { messages, roomState } = event.data;
        // messages: Array<{ eventId, type, sender, senderDisplayName, content, timestamp }>
        // roomState: { roomName, members: Array<{ userId, displayName }> }
        render(messages, roomState);
    }
});
```

## To Send Events Back

```js
parent.postMessage({
    type: "ACTION_SEND_EVENT",
    eventType: "m.room.message",
    content: { msgtype: "m.text", body: "Hello from the component" }
}, "*");
```

## Rules

- Render into `<div id="app"></div>`
- Include `<meta charset="utf-8">` and `<meta name="viewport" content="width=device-width, initial-scale=1">`
- Use modern CSS (flexbox/grid). Inline all styles in a `<style>` tag.
- Handle empty state (no messages yet)
- Handle live updates (the ROOM_DATA message fires on every new event)
- NO access to: parent DOM, localStorage, cookies, external URLs
- The component should look polished and professional
- Use a dark theme by default (background: #15191E, text: #F4F4F5)
  to match Element's dark mode
- Use the system font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`

## Output

Write ONLY the `index.html` file to the path specified in the task.
Then ensure it is copied to the dist/ directory.
Verify the output exists before finishing.
