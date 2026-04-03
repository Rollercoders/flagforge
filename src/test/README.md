# FlagForge Test Suite

Comprehensive test suite for FlagForge feature flagging platform.

## Test Coverage

### Unit Tests

#### `evaluator.test.ts`
Tests for the flag evaluation logic:
- Basic flag enabled/disabled evaluation
- User ID targeting
- Attribute-based targeting
- Percentage rollout with consistent hashing
- Combined targeting and rollout rules

#### `storage-sqlite.test.ts`
Tests for SQLite storage implementation:
- Flag CRUD operations
- API key management
- Data persistence
- Environment isolation
- Unique constraints

#### `storage-json.test.ts`
Tests for JSON file storage implementation:
- Flag CRUD operations
- API key management
- File persistence
- Data reloading
- Environment isolation

#### `middleware-auth.test.ts`
Tests for authentication middleware:
- Bearer token validation
- API key verification
- Error handling
- Request context enrichment

### Integration Tests

#### `routes-flags.test.ts`
Tests for flag management endpoints:
- `POST /api/flags` - Create flags
- `GET /api/flags` - List flags
- `GET /api/flags/:key` - Get specific flag
- `PATCH /api/flags/:key` - Update flag
- `DELETE /api/flags/:key` - Delete flag
- Environment isolation
- Authentication requirements

#### `routes-evaluate.test.ts`
Tests for flag evaluation endpoints:
- `POST /api/evaluate/:key` - Single flag evaluation
- `POST /api/evaluate` - Batch evaluation
- Targeting rules evaluation
- Rollout percentage evaluation
- Context handling

#### `routes-admin.test.ts`
Tests for admin endpoints:
- `POST /admin/api-keys` - Create API keys
- `GET /admin/api-keys` - List API keys
- `DELETE /admin/api-keys/:id` - Delete API key
- Key format validation
- Multi-environment support

## Running Tests

```bash
# Run all tests once
yarn test

# Run tests in watch mode (auto-rerun on changes)
yarn test:watch

# Run tests with coverage report
yarn test:coverage
```

## Test Structure

```
src/test/
├── README.md                  # This file
├── evaluator.test.ts          # Evaluator unit tests
├── storage-sqlite.test.ts     # SQLite storage tests
├── storage-json.test.ts       # JSON storage tests
├── middleware-auth.test.ts    # Auth middleware tests
├── routes-flags.test.ts       # Flags API integration tests
├── routes-evaluate.test.ts    # Evaluate API integration tests
└── routes-admin.test.ts       # Admin API integration tests
```

## Test Data

Test databases and files are created in `test-data/` directory and automatically cleaned up after each test run.

## Writing New Tests

When adding new features, follow this pattern:

1. **Unit Tests**: Test individual functions/classes in isolation
2. **Integration Tests**: Test API endpoints with real storage
3. **Use beforeEach/afterEach**: Set up and tear down test data
4. **Clean up**: Always remove test files/databases in afterEach
5. **Descriptive names**: Use clear test descriptions

Example:

```typescript
describe('MyFeature', () => {
  beforeEach(async () => {
    // Setup
  });

  afterEach(() => {
    // Cleanup
  });

  it('should do something specific', async () => {
    // Arrange
    // Act
    // Assert
  });
});
```

## Coverage Goals

- **Overall**: >80%
- **Critical paths**: 100% (evaluator, auth, storage)
- **Routes**: >90%

## CI/CD

Tests run automatically on:
- Every commit (via GitHub Actions, if configured)
- Pull requests
- Before deployment

## Troubleshooting

### Tests hanging
- Check for unclosed database connections
- Ensure afterEach cleanup is running

### File system errors
- Make sure `test-data/` directory is in `.gitignore`
- Check file permissions

### Flaky tests
- Avoid timing-dependent tests
- Use consistent test data
- Isolate test environments
