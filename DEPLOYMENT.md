# Deployment Guide

This guide explains how to set up the GitHub Actions deployment workflow to deploy Element Web to your Hetzner server.

## Prerequisites

1. **Hetzner Server** with Docker and docker-compose installed
2. **SSH Access** to the Hetzner server
3. **GitHub Repository** with access to configure Secrets

## Step 1: Generate SSH Deployment Key

Generate a new SSH key pair for GitHub Actions to use:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/element_deploy_key -C "github-actions-deploy" -N ""
```

Add the public key to your Hetzner server:

```bash
cat ~/.ssh/element_deploy_key.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

## Step 2: Configure GitHub Secrets

Go to your GitHub repository → Settings → Secrets and variables → Actions

Add the following **Repository Secrets** (Repository → Secrets):

### Required Secrets

| Secret Name             | Description                                             | Example                          |
| ----------------------- | ------------------------------------------------------- | -------------------------------- |
| `HETZNER_HOST`          | Your Hetzner server IP or hostname                      | `192.168.1.100` or `example.com` |
| `HETZNER_USER`          | SSH username                                            | `root` or `deploy`               |
| `HETZNER_SSH_KEY`       | Private SSH key (Contents of ~/.ssh/element_deploy_key) | `-----BEGIN PRIVATE KEY-----...` |
| `ANTHROPIC_API_KEY`     | Anthropic API key for Claude Code component generation  | From console.anthropic.com       |
| `MATRIX_HOMESERVER_URL` | Your Matrix homeserver URL                              | `https://matrix.example.com`     |
| `MATRIX_BOT_TOKEN`      | Bot user token for Matrix                               | From Element Admin               |
| `MATRIX_BOT_USER_ID`    | Bot user ID                                             | `@bot:example.com`               |

### Getting an ANTHROPIC_API_KEY

The `ANTHROPIC_API_KEY` is required for Claude Code to generate custom components.

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign in or create an account
3. Navigate to **API Keys**
4. Click **Create Key**
5. Copy the key and save it securely
6. Add it as a GitHub Secret: `ANTHROPIC_API_KEY`

**⚠️ Important:** Keep your API key private. It will be sent to the server and used by Claude Code to authenticate with Anthropic.

### Optional Secrets

| Secret Name        | Description         | Default                          |
| ------------------ | ------------------- | -------------------------------- |
| `HETZNER_PORT`     | SSH port            | `22`                             |
| `ELEMENT_WEB_PORT` | Element Web port    | `8080`                           |
| `BUNDLE_PORT`      | Bot server port     | `3001`                           |
| `BUNDLE_BASE_URL`  | Bot bundle base URL | `http://localhost:3001`          |
| `GENERATE_API_URL` | Generation API URL  | `http://localhost:3001/generate` |

### Optional: Docker Registry (for pre-built images)

If using a private Docker registry:

| Secret Name       | Description                                 |
| ----------------- | ------------------------------------------- |
| `DOCKER_REGISTRY` | Registry URL (e.g., `ghcr.io`, `docker.io`) |
| `DOCKER_USERNAME` | Registry username                           |
| `DOCKER_PASSWORD` | Registry password / token                   |

## Step 3: Prepare Hetzner Server

SSH into your Hetzner server and prepare the deployment directory:

```bash
# Create deployment directory
mkdir -p ~/element-web
cd ~/element-web

# Install Claude Code (required for component generation)
curl -fsSL https://install.anthropic.com/claude-cli | sh

# Verify Claude Code is installed
claude --version

# Ensure Docker and docker-compose are installed
docker --version
docker-compose --version

# Optional: Create initial .env file
cat > .env << 'EOF'
ELEMENT_WEB_PORT=8080
BUNDLE_PORT=3001
BUNDLE_BASE_URL=http://localhost:3001
GENERATE_API_URL=http://localhost:3001/generate
NODE_ENV=production
EOF
```

## Step 4: Trigger Deployment

The workflow automatically deploys on:

- **Push to `develop` branch** (recommended for testing)
- **Push to `main` branch** (for production)
- **Manual trigger** via GitHub Actions workflow_dispatch

Or manually trigger from GitHub Actions → Deploy to Hetzner → Run workflow

## Deployment Process

The workflow performs these steps safely:

1. ✓ Checks out your code
2. ✓ Builds Docker images locally
3. ✓ Connects to Hetzner via SSH using the deployment key
4. ✓ Backs up the current `.env` file
5. ✓ Updates `.env` with current secrets from GitHub
6. ✓ Gracefully stops only Element services (using `docker-compose down`)
7. ✓ Waits for services to fully stop
8. ✓ Starts services with `docker-compose up -d`
9. ✓ Performs health checks on both services
10. ✓ **On failure**: Automatically rolls back to the previous state

## Safety Features

- **Isolated Containers**: Only Element Web and Bot Server containers are managed
- **No Interference**: Other services on the server are untouched
- **Graceful Shutdown**: Uses `docker-compose down` with `--remove-orphans`
- **Health Checks**: Verifies services are responding after deployment
- **Automatic Rollback**: Restores previous `.env` and restarts on failure
- **Backup `.env`**: Creates timestamped backups before each deployment
- **Concurrency Control**: Prevents multiple deployments running simultaneously
- **Clean SSH Setup**: Fresh SSH connection for each deployment

## Troubleshooting

### Check Deployment Logs

View GitHub Actions logs at: GitHub → Actions → Deploy to Hetzner → (latest run)

### SSH Connection Issues

Test SSH connection manually:

```bash
ssh -i ~/.ssh/element_deploy_key -p 22 root@HETZNER_HOST
```

### Container Issues on Server

View container status:

```bash
cd ~/element-web
docker-compose ps
docker-compose logs element-web
docker-compose logs bot
```

### Manual Rollback

If auto-rollback doesn't work:

```bash
cd ~/element-web
docker-compose down
cp .env.backup.* .env  # Use the latest backup
docker-compose up -d
```

### View Deployment History

```bash
cat ~/element-web/deployment.log
```

## Environment Variables Reference

The workflow injects these during deployment:

```env
ELEMENT_WEB_PORT=8080              # Port for Element Web
BUNDLE_PORT=3001                   # Port for Bot Server
BUNDLE_BASE_URL=http://localhost:3001  # Bot bundle base URL
GENERATE_API_URL=http://localhost:3001/generate  # Claude generation endpoint
MATRIX_HOMESERVER_URL=...          # Matrix homeserver URL
MATRIX_BOT_TOKEN=...               # Bot authentication token
MATRIX_BOT_USER_ID=...             # Bot user ID
NODE_ENV=production                # Node environment
```

## Docker Compose Reference

The deployment uses `docker-compose.yml` in your repo root. Services:

- **element-web**: Element Web client (port 8080)
- **bot**: Dynamic Room Bot Server (port 3001)

Both services:

- Have built-in health checks
- Share a `dynamic-rooms` network
- Are stopped/started together with `docker-compose`

## Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Element Web Documentation](./README.md)
