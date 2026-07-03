<p align="center">
  <img src="ui/public/logo.png" alt="FlagForge" height="80" />
</p>

# FlagForge

[![Tests](https://github.com/rollercoders/flagforge/actions/workflows/ci.yml/badge.svg)](https://github.com/rollercoders/flagforge/actions/workflows/ci.yml)

Open-source, on-premise feature flagging platform built for speed and simplicity.

## Features

- **Multiple Storage Backends**: SQLite or JSON file
- **Multi-Environment Support**: dev, staging, production, or custom environments
- **Targeting Rules**: Enable flags for specific users or attributes
- **Percentage Rollout**: Gradual rollout to a percentage of users
- **REST API**: Simple HTTP API for integration
- **No External Dependencies**: Runs entirely on-premise

## Quick Start

### Fastest: 1-click installer

```bash
npx flagforge init
```

An interactive wizard asks for the port, storage backend and admin password,
creates `.env` and `data/` in the current directory, and starts the server right
away. To restart later without reconfiguring:

```bash
flagforge start
```

### From source (development)

```bash
yarn install
cp .env.example .env
```

### Configuration

Edit `.env`:

```env
PORT=3000
STORAGE_TYPE=sqlite # or "json"
STORAGE_PATH=./data/flagforge.db
```

### Running

```bash
# Development
yarn dev

# Production
yarn build
yarn start
```

### Testing

```bash
# Run all tests
yarn test

# Run tests in watch mode
yarn test:watch

# Run tests with coverage
yarn test:coverage
```

### Linting

```bash
# Run ESLint
yarn lint

# Auto-fix linting issues
yarn lint:fix
```

## Web App

FlagForge includes a built-in web interface available at `http://localhost:3000` (or whichever port you configure). No separate installation is required — the UI is served directly by the same Node.js process.

### Authentication

The web app is protected by a password set via the `ADMIN_PASSWORD` environment variable. On first access you'll be prompted to sign in.

### Projects

After login, the **Projects** page is your home screen. A project groups feature flags by application (e.g. `mobile-app`, `backend`, `website`).

- **Create a project** — type a name and press Enter or click "Create project"
- **Delete a project** — click Delete on the project row and confirm

### Environments

Each project can have multiple environments (e.g. `production`, `staging`, `development`). Environments are fully isolated: flags in `production` are invisible to `staging` API keys.

From the Projects page, each project row shows its environments. For each environment you can:

- **Copy the API key** (`ff_…`) — click "Copy" to copy it to the clipboard
- **Regenerate the API key** — invalidates the old key and generates a new one (confirmation required)
- **Rename the environment** — click the pencil icon
- **Delete the environment** — confirmation required
- **Navigate to flags** — click the environment name to open its flag list

### Feature Flags

Clicking an environment name opens the **Flags** page for that project + environment combination.

Each flag in the list shows:
- Its **key** (e.g. `new-checkout-flow`)
- Its **name** (human-readable label)
- Optional badges: **Targeting** (if user/attribute rules are set) and **Rollout X%** (if a percentage rollout is active)
- A **toggle** to enable or disable the flag without opening it

Click any flag row to open the edit drawer. Click **+ New Flag** to create one.

#### Flag editor

The drawer on the right lets you configure:

| Field | Description |
|-------|-------------|
| **Name** | Human-readable label (auto-generates the key on creation) |
| **Key** | Immutable identifier used in API calls (e.g. `dark-mode`) |
| **Description** | Optional free-text note |
| **Enabled** | Master on/off switch (new flags start disabled) |
| **Targeting — User IDs** | Comma-tag input; the flag returns `true` only for listed user IDs |
| **Targeting — Attributes** | Key/value rules (e.g. `plan = premium, enterprise`) |
| **Rollout percentage** | Enables the flag for N% of users via consistent hashing |

**Evaluation order:** User IDs → Attributes → Rollout percentage → Enabled value

#### Live preview

At the bottom of the editor there's a **"Test this flag"** panel. Enter a `userId` and optional attributes to see in real time whether the current configuration would return `true` or `false` for that context — without making any API call.

## Usage

### 1. Create an API Key

First, create an API key for your environment:

```bash
curl -X POST http://localhost:3000/admin/api-keys \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production Key",
    "environment": "production"
  }'
```

Response:
```json
{
  "id": "abc123",
  "key": "ff_xxxxxxxxxxxxxxxxxx",
  "name": "Production Key",
  "environment": "production",
  "createdAt": "2024-01-15T10:00:00.000Z"
}
```

Save the `key` value - you'll need it for authenticated requests.

### 2. Create a Feature Flag

```bash
curl -X POST http://localhost:3000/api/flags \
  -H "Authorization: Bearer ff_xxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "new-checkout-flow",
    "name": "New Checkout Flow",
    "description": "Redesigned checkout experience",
    "enabled": true
  }'
```

### 3. Evaluate a Flag

```bash
curl -X POST http://localhost:3000/api/evaluate/new-checkout-flow \
  -H "Authorization: Bearer ff_xxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-123"
  }'
```

Response:
```json
{
  "key": "new-checkout-flow",
  "enabled": true,
  "metadata": {
    "flagEnabled": true,
    "hasTargeting": false,
    "hasRollout": false
  }
}
```

## Advanced Features

### User Targeting

Enable a flag only for specific users:

```bash
curl -X PATCH http://localhost:3000/api/flags/new-checkout-flow \
  -H "Authorization: Bearer ff_xxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "targeting": {
      "userIds": ["user-123", "user-456"]
    }
  }'
```

### Attribute Targeting

Target users based on attributes:

```bash
curl -X PATCH http://localhost:3000/api/flags/premium-feature \
  -H "Authorization: Bearer ff_xxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "targeting": {
      "attributes": {
        "plan": ["premium", "enterprise"],
        "region": ["us-west"]
      }
    }
  }'
```

Evaluate with attributes:

```bash
curl -X POST http://localhost:3000/api/evaluate/premium-feature \
  -H "Authorization: Bearer ff_xxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-789",
    "attributes": {
      "plan": "premium",
      "region": "us-west"
    }
  }'
```

### Percentage Rollout

Gradually roll out to a percentage of users:

```bash
curl -X PATCH http://localhost:3000/api/flags/new-feature \
  -H "Authorization: Bearer ff_xxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "rollout": {
      "percentage": 25
    }
  }'
```

This will enable the flag for approximately 25% of users (based on consistent hashing of userId).

### Batch Evaluation

Evaluate multiple flags at once:

```bash
curl -X POST http://localhost:3000/api/evaluate \
  -H "Authorization: Bearer ff_xxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "flags": ["feature-a", "feature-b", "feature-c"],
    "context": {
      "userId": "user-123",
      "attributes": {
        "plan": "premium"
      }
    }
  }'
```

Response:
```json
{
  "feature-a": true,
  "feature-b": false,
  "feature-c": true
}
```

## API Reference

### Admin Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/admin/api-keys` | Create an API key |
| GET | `/admin/api-keys` | List all API keys |
| DELETE | `/admin/api-keys/:id` | Delete an API key |

### Flag Management (Requires Authentication)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/flags` | Create a flag |
| GET | `/api/flags` | List all flags |
| GET | `/api/flags/:key` | Get a specific flag |
| PATCH | `/api/flags/:key` | Update a flag |
| DELETE | `/api/flags/:key` | Delete a flag |

### Flag Evaluation (Requires Authentication)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/evaluate/:key` | Evaluate a single flag |
| POST | `/api/evaluate` | Batch evaluate multiple flags |

## MCP Server

FlagForge ships with an opt-in [Model Context Protocol](https://modelcontextprotocol.io) endpoint that lets AI agents (Claude, Cursor, etc.) manage your feature flags directly.

The endpoint is mounted at `/mcp` and is **disabled by default**. It is only mounted when an `MCP_TOKEN` is configured.

### Enabling it

Either:

- Answer "yes" to "Setup also FlagForge MCP server?" during `flagforge init` — a token is generated for you and saved to `.env`, and a ready-to-paste client config is printed.
- Or set `MCP_TOKEN` manually in `.env`:

```env
MCP_TOKEN=ff_mcp_your_token_here
```

Restart the server for the change to take effect.

### Available tools

| Tool | Description |
|------|-------------|
| `list_projects` | List all projects |
| `list_environments` | List environments for a project, identified **by name** |
| `list_flags` | List flags for a project + environment |
| `set_flag` | Create or update a flag (upsert) |
| `evaluate_flag` | Evaluate a flag for a given context; also returns a `reason` explaining the outcome (`disabled`, `targeting-miss`, `rollout-excluded`, `enabled`) |

There is intentionally **no delete tool** — flag deletion is only available through the web app or the admin API.

Environments are identified **by name**, not by id, across all of FlagForge. `list_environments` returns only `{ name }` for this reason — always pass that `name` as the `environment` argument to `list_flags`, `set_flag` and `evaluate_flag`. `set_flag` rejects unknown environment names with an error listing the valid ones instead of writing anything.

### Client configuration

Point your MCP-compatible client at the endpoint, sending the token as a bearer `Authorization` header:

```json
{
  "mcpServers": {
    "flagforge": {
      "url": "http://<host>:<port>/mcp",
      "headers": {
        "Authorization": "Bearer <your-mcp-token>"
      }
    }
  }
}
```

### Security note

The MCP endpoint is opt-in and the token grants **full read/write control over all flags** (across all projects and environments) — treat it like an admin credential. Do not share it or commit it to source control.

## Client Integration Example

### Node.js

```javascript
class FlagForgeClient {
  constructor(apiUrl, apiKey) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
  }

  async isEnabled(flagKey, context) {
    const response = await fetch(`${this.apiUrl}/api/evaluate/${flagKey}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(context)
    });

    const data = await response.json();
    return data.enabled;
  }

  async evaluateMany(flagKeys, context) {
    const response = await fetch(`${this.apiUrl}/api/evaluate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ flags: flagKeys, context })
    });

    return await response.json();
  }
}

// Usage
const client = new FlagForgeClient(
  'http://localhost:3000',
  'ff_xxxxxxxxxxxxxxxxxx'
);

const enabled = await client.isEnabled('new-checkout-flow', {
  userId: 'user-123',
  attributes: { plan: 'premium' }
});

if (enabled) {
  // Show new checkout flow
}
```

### Python

```python
import requests

class FlagForgeClient:
    def __init__(self, api_url, api_key):
        self.api_url = api_url
        self.api_key = api_key
        self.headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }

    def is_enabled(self, flag_key, context):
        response = requests.post(
            f'{self.api_url}/api/evaluate/{flag_key}',
            headers=self.headers,
            json=context
        )
        return response.json()['enabled']

# Usage
client = FlagForgeClient('http://localhost:3000', 'ff_xxxxxxxxxxxxxxxxxx')

enabled = client.is_enabled('new-checkout-flow', {
    'userId': 'user-123',
    'attributes': {'plan': 'premium'}
})

if enabled:
    # Show new checkout flow
    pass
```

## Storage Options

### SQLite (Default)

Best for most use cases. Provides ACID guarantees and good performance.

```env
STORAGE_TYPE=sqlite
STORAGE_PATH=./data/flagforge.db
```

### JSON File

Simple file-based storage. Good for development or low-traffic scenarios.

```env
STORAGE_TYPE=json
STORAGE_PATH=./data/flags.json
```

## Multi-Environment Setup

Create separate API keys for each environment:

```bash
# Development
curl -X POST http://localhost:3000/admin/api-keys \
  -H "Content-Type: application/json" \
  -d '{"name": "Dev Key", "environment": "development"}'

# Staging
curl -X POST http://localhost:3000/admin/api-keys \
  -H "Content-Type: application/json" \
  -d '{"name": "Staging Key", "environment": "staging"}'

# Production
curl -X POST http://localhost:3000/admin/api-keys \
  -H "Content-Type: application/json" \
  -d '{"name": "Prod Key", "environment": "production"}'
```

Flags are isolated per environment - each API key only sees flags in its environment.

## License

MIT

## Roadmap

- [ ] Webhooks for flag changes
- [ ] Audit log
- [ ] Metrics and analytics
- [ ] Official SDKs (JS, Python, Go)
- [ ] Docker image
- [ ] Flag scheduling (enable/disable at specific times)
