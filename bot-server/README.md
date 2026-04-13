# Dynamic Room Bot Server

A Matrix bot that generates custom room renderers using Claude Code and LLM-generated HTML components.

## Quick Start

### Prerequisites

- **Claude Code** installed and available in `$PATH` on the bot server machine
- **Node.js** 18+ (for development) or **Docker** (for containerized deployment)

### Local Development

```bash
cd bot-server

# Copy the example env file and fill in your credentials
cp .env.example .env

# Install dependencies
npm install

# Run in development mode
npm run dev
```

### Docker Deployment

#### Build the image

```bash
docker build -t element-dynamic-room-bot:latest -f bot-server/Dockerfile .
```

#### Run with docker-compose (includes Matrix homeserver)

```bash
# Copy the example env file
cp .env.example .env

# Fill in MATRIX_BOT_TOKEN and MATRIX_BOT_USER_ID
nano .env

# Start the services
docker-compose up -d
```

The bot server will be available at `http://localhost:3001` and Matrix at `http://localhost:8008`.

#### Run the container standalone

```bash
docker run -d \
  --name dynamic-room-bot \
  -p 3001:3001 \
  -e MATRIX_HOMESERVER_URL=http://matrix.example.com:8008 \
  -e MATRIX_BOT_TOKEN=your_bot_token_here \
  -e MATRIX_BOT_USER_ID=@renderer-bot:example.com \
  -e BUNDLE_BASE_URL=https://bundles.example.com \
  -v bot-bundles:/app/public/bundles \
  element-dynamic-room-bot:latest
```

## Environment Variables

| Variable                | Required | Default                 | Description                                           |
| ----------------------- | -------- | ----------------------- | ----------------------------------------------------- |
| `MATRIX_HOMESERVER_URL` | Yes      | `http://localhost:8008` | Matrix homeserver URL                                 |
| `MATRIX_BOT_TOKEN`      | Yes      | (none)                  | Bot access token from the homeserver                  |
| `MATRIX_BOT_USER_ID`    | Yes      | (none)                  | Bot's Matrix user ID, e.g. `@renderer-bot:matrix.org` |
| `BUNDLE_PORT`           | No       | `3001`                  | Port to serve bundles on                              |
| `BUNDLE_BASE_URL`       | No       | `http://localhost:3001` | Public URL for bundles (used in state events)         |

## Claude Code Installation

The Dockerfile assumes Claude Code is available as an npm package. If not, you may need to:

1. **Install Claude Code locally:**

    ```bash
    npm install -g @anthropic-ai/claude-code
    # or
    curl -sSL https://install.anthropic.com/claude-code | bash
    ```

2. **Update the Dockerfile** with the correct installation method for your environment.

3. **Ensure it's in the PATH** so the bot can invoke it via `exec("claude", ...)`.

## Getting a Bot Token

1. **Create a bot user on your Matrix homeserver:**

    ```bash
    register_new_matrix_user -u renderer-bot -p your_password http://localhost:8008
    ```

2. **Login to get the access token:**

    ```bash
    curl -X POST http://localhost:8008/_matrix/client/r0/login \
      -H "Content-Type: application/json" \
      -d '{"type":"m.login.password", "user":"renderer-bot", "password":"your_password"}'
    ```

3. **Copy the `access_token` from the response into `.env`**

## Architecture

```
User submits prompt in app- room
    ↓ Matrix event
Bot receives io.element.renderer_prompt
    ↓
Bot invokes Claude Code (subprocess)
    ↓ Claude Code generates HTML
Bot writes src/index.html → dist/index.html
    ↓
Bot serves bundle on BUNDLE_BASE_URL
    ↓
Bot posts io.element.custom_renderer state event
    ↓ Element UI updates
Element renders iframe with bundle
```

## Monitoring

### Health Check

```bash
curl http://localhost:3001/health
```

### Docker Logs

```bash
docker logs dynamic-room-bot
```

### Bot Status

The bot logs generation progress and errors to stdout. Check the logs for:

- `[bot] Received prompt for <roomId>`
- `[bot] Claude Code finished for <roomId>`
- `[bot] Bundle ready at <url>`
- `[bot] Generation failed for <roomId>`

## Troubleshooting

### Claude Code not found

**Error:** `ENOENT: no such file or directory, spawn 'claude'`

**Solution:** Install Claude Code and ensure it's in `$PATH`:

```bash
which claude  # Should return the path to Claude Code
```

### Bundles not loading in Element

**Error:** CORS error when iframe tries to load bundle

**Solution:** Ensure `BUNDLE_BASE_URL` is accessible from the browser and matches the Element instance's origin.

### Bot not picking up prompts

**Error:** No `[bot] Received prompt` in logs

**Solution:**

1. Verify the bot token is valid
2. Check that the bot is joined to the room
3. Ensure the event type is exactly `io.element.renderer_prompt`

## Security Notes

- The bot doesn't require special permissions; it reads and writes room state events like any other Matrix user.
- Bundles are served over HTTP in development; use HTTPS and a CDN (S3, Cloudflare R2) in production.
- Claude Code subprocess has access to the filesystem; ensure the bot runs in a restricted container/VM.

## Production Checklist

- [ ] Use HTTPS for `BUNDLE_BASE_URL`
- [ ] Store bundles on a CDN (S3, Cloudflare R2, etc)
- [ ] Run bot in a restricted container with limited filesystem access
- [ ] Set resource limits on the Claude Code process (timeout, memory)
- [ ] Configure log aggregation (ELK, Datadog, etc)
- [ ] Set up monitoring and alerting for bot health
- [ ] Regular backups of generated bundles
- [ ] Use a dedicated Matrix user for the bot account
