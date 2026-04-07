# Contributing to FlagForge

Thanks for your interest in contributing to FlagForge! This guide will help you get started.

## Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/<your-username>/flagforge.git
   cd flagforge
   ```
3. Install dependencies:
   ```bash
   yarn install
   ```
4. Copy the environment file:
   ```bash
   cp .env.example .env
   ```

## Development Workflow

### Branch Naming

Create a branch from `develop` using one of these prefixes:

- `feature/` — new functionality
- `fix/` — bug fixes
- `docs/` — documentation changes
- `refactor/` — code refactoring
- `test/` — adding or updating tests

```bash
git checkout develop
git pull origin develop
git checkout -b feature/my-feature
```

### Running the Project

```bash
# Development server with hot reload
yarn dev

# Build for production
yarn build

# Run production server
yarn start
```

### Testing

All changes must include tests where applicable.

```bash
yarn test              # Run all tests
yarn test:watch        # Watch mode
yarn test:coverage     # Coverage report
```

### Linting

```bash
yarn lint              # Check issues
yarn lint:fix          # Auto-fix issues
```

Ensure `yarn lint` passes before submitting a PR.

## Pull Requests

1. Never commit directly to `develop` or `main`.
2. Open a PR against `develop`.
3. Write a clear title and description of what changed and why.
4. Ensure all tests pass and linting is clean.
5. Keep PRs focused — one feature or fix per PR.

### Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/) format:

```
feat: add percentage rollout support
fix: correct targeting evaluation for empty attributes
docs: update API examples in README
test: add storage edge case tests
refactor: simplify flag evaluation logic
```

## Architecture Notes

- **ES Modules** — use `import/export`, not `require/module.exports`
- **Storage layer** — if your change affects flags, update both `SqliteStorage` and `JsonStorage`
- **Evaluator** — flag evaluation logic lives in `src/evaluator.ts`
- **Routes** — use the factory pattern (`createMyRouter(storage)`)
- **Tests** — integration tests use real storage, not mocks

See [CLAUDE.md](CLAUDE.md) for detailed architecture documentation.

## Reporting Issues

Open an issue on GitHub with:

- A clear description of the problem or suggestion
- Steps to reproduce (for bugs)
- Expected vs actual behavior
- Environment details (Node.js version, OS)

## License

By contributing, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).
