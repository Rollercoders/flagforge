# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2025-04-03

### Added

- Initial release of FlagForge feature flagging platform
- SQLite and JSON storage backends
- Multi-environment support (dev, staging, production, custom)
- Targeting rules by user ID and attributes
- Percentage rollout with consistent hashing
- REST API with Bearer token authentication
- Web UI with admin authentication
- Projects and environments management UI
- API key embedded in environment configuration
- `POST /api/evaluate/all` endpoint for batch evaluation
- `/admin/flags` and `/admin/evaluate` routes for UI session auth
- CI workflow with GitHub Actions
