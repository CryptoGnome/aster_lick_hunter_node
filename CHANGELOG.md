# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Added quantity validation to prevent "Quantity greater than max quantity" errors
- Implemented exchange limit handling for max/min quantities and minimum notional values
- Added comprehensive logging for quantity adjustments and validation warnings
- Created CHANGELOG.md to track project changes

### Changed
- Updated `SymbolPrecisionManager` to handle exchange limits
- Enhanced `placeOrder` function to validate quantities before sending to exchange
- Improved error handling for order placement

### Fixed
- Fixed issue #29: "Quantity greater than max quantity" error when placing orders
- Fixed TypeScript type issues in mark price handling

## [1.0.0] - 2025-10-02
### Added
- Initial release of Aster Lick Hunter Bot
- Core trading functionality with liquidation hunting
- Web dashboard for monitoring and configuration
- Paper trading mode for testing
- Risk management features including stop-loss and take-profit

### Changed
- Optimized performance for real-time trading
- Improved error handling and recovery

### Fixed
- Various bug fixes and stability improvements

---
*Note: See [GitHub Releases](https://github.com/yourusername/aster_lick_hunter_node/releases) for detailed release notes.*
