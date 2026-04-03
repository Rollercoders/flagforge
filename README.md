# FlagForge

Open-source, on-premise feature flagging platform built for speed and simplicity.

## Features

- **Multiple Storage Backends**: SQLite or JSON file
- **Multi-Environment Support**: dev, staging, production, or custom environments
- **Targeting Rules**: Enable flags for specific users or attributes
- **Percentage Rollout**: Gradual rollout to a percentage of users
- **REST API**: Simple HTTP API for integration
- **No External Dependencies**: Runs entirely on-premise

## Quick Start

### Installation

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
  "key": "rf_xxxxxxxxxxxxxxxxxx",
  "name": "Production Key",
  "environment": "production",
  "createdAt": "2024-01-15T10:00:00.000Z"
}
```

Save the `key` value - you'll need it for authenticated requests.

### 2. Create a Feature Flag

```bash
curl -X POST http://localhost:3000/api/flags \
  -H "Authorization: Bearer rf_xxxxxxxxxxxxxxxxxx" \
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
  -H "Authorization: Bearer rf_xxxxxxxxxxxxxxxxxx" \
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
  -H "Authorization: Bearer rf_xxxxxxxxxxxxxxxxxx" \
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
  -H "Authorization: Bearer rf_xxxxxxxxxxxxxxxxxx" \
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
  -H "Authorization: Bearer rf_xxxxxxxxxxxxxxxxxx" \
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
  -H "Authorization: Bearer rf_xxxxxxxxxxxxxxxxxx" \
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
  -H "Authorization: Bearer rf_xxxxxxxxxxxxxxxxxx" \
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
  'rf_xxxxxxxxxxxxxxxxxx'
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
client = FlagForgeClient('http://localhost:3000', 'rf_xxxxxxxxxxxxxxxxxx')

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

- [ ] Web UI for flag management
- [ ] Webhooks for flag changes
- [ ] Audit log
- [ ] Metrics and analytics
- [ ] Official SDKs (JS, Python, Go)
- [ ] Docker image
- [ ] Flag scheduling (enable/disable at specific times)
