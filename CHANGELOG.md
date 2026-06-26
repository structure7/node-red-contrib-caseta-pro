# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- GitHub Actions CI: lint + test on push/PR across Node 18/20/22.
- Pure `caseta/protocol.js` module (line parsing, command building, topic) with a
  unit test suite — extracted from the node files so the protocol logic is testable
  without a live bridge.
- `npm test` (mocha + node-red-node-test-helper) and `npm run lint` (ESLint) scripts.
- Packaging metadata for npm publication: `homepage`, `bugs`, `files` allow-list.

## [0.1.3] - 2026-06-26

### Added
- `caseta-in` now sets `msg.topic` to `caseta/<type>/<id>` for routing.

## [0.1.2] - 2026-06-26

### Changed
- Custom node icon (`caseta-button.png`).

## [0.1.1] - 2026-06-13

### Added
- Initial three-node implementation: `caseta-bridge`, `caseta-in`, `caseta-out`.
