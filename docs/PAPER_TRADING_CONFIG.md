# Paper Trading Configuration Guide

This guide explains how to configure the advanced simulation parameters for paper trading in Aster.

## Overview

The paper trading system now includes realistic market condition simulations to help you test your strategies under various scenarios. You can configure these settings through the UI or directly in your config file.

## Configuration Parameters

### Starting Balance
- **Field**: Starting Balance (USDT)
- **Default**: 1000 USDT
- **Range**: 100 - 1,000,000 USDT
- **Description**: The initial virtual balance for your paper trading account. This represents your starting capital.

### Slippage Simulation
- **Field**: Slippage (basis points)
- **Default**: 0 bps (disabled)
- **Range**: 0 - 500 bps (0% - 5%)
- **Description**: Simulates price slippage on order execution. 
  - 1 bps = 0.01%
  - 10 bps = 0.1%
  - 100 bps = 1%
  
**Example**: With 10 bps slippage:
- Buying at $1000: Actual fill price = $1001 (0.1% worse)
- Selling at $1000: Actual fill price = $999 (0.1% worse)

### Network Latency
- **Field**: Network Latency (ms)
- **Default**: 0 ms (disabled)
- **Range**: 0 - 5000 ms (0 - 5 seconds)
- **Description**: Simulates network delay before order execution. Useful for testing how your strategy performs with slow connections or high latency scenarios.

**Example**: With 200ms latency:
- Order submitted at 10:00:00.000
- Order executed at 10:00:00.200
- Price may have moved during this delay

### Partial Fills
- **Field**: Partial Fill Chance (%)
- **Default**: 0% (disabled)
- **Range**: 0 - 100%
- **Description**: Simulates orders being only partially filled, common in illiquid markets or large order sizes.

**Example**: With 30% partial fill chance:
- Order for 100 contracts might fill only 70 contracts
- Remaining 30 contracts would not execute
- Tests your strategy's handling of incomplete orders

### Order Rejection Rate
- **Field**: Order Rejection Rate (%)
- **Default**: 0% (disabled)
- **Range**: 0 - 100%
- **Description**: Simulates random order rejections from the exchange. Useful for testing error handling and retry logic.

**Example**: With 5% rejection rate:
- 5 out of 100 orders will be rejected
- Helps ensure your bot handles failures gracefully

### Realistic Fills Toggle
- **Field**: Enable Realistic Fills
- **Default**: false (disabled)
- **Description**: When enabled, combines all simulation features for a more realistic trading experience. Automatically applies reasonable defaults for each parameter.

## Configuration via UI

1. Navigate to the **Configuration** page
2. Scroll to the **Paper Trading Settings** section
3. Adjust the sliders and inputs to your desired values
4. Click **Save Configuration**
5. Restart the bot for changes to take effect

## Configuration via File

Edit your `config.user.json`:

```json
{
  "global": {
    "paperMode": true,
    "paperTrading": {
      "startingBalance": 10000,
      "slippageBps": 10,
      "latencyMs": 200,
      "partialFillPercent": 20,
      "rejectionRate": 5,
      "enableRealisticFills": true
    }
  }
}
```

## Use Cases

### Conservative Testing (Default)
```json
{
  "startingBalance": 1000,
  "slippageBps": 0,
  "latencyMs": 0,
  "partialFillPercent": 0,
  "rejectionRate": 0,
  "enableRealisticFills": false
}
```
- Perfect execution, no slippage
- Best case scenario for initial strategy testing

### Realistic Market Conditions
```json
{
  "startingBalance": 10000,
  "slippageBps": 5,
  "latencyMs": 100,
  "partialFillPercent": 10,
  "rejectionRate": 2,
  "enableRealisticFills": true
}
```
- Simulates typical market conditions
- Small slippage (0.05%)
- Minimal latency (100ms)
- Occasional partial fills and rejections

### Stress Testing
```json
{
  "startingBalance": 10000,
  "slippageBps": 50,
  "latencyMs": 1000,
  "partialFillPercent": 50,
  "rejectionRate": 10,
  "enableRealisticFills": true
}
```
- Extreme market conditions
- High slippage (0.5%)
- Significant latency (1 second)
- Frequent partial fills
- Higher rejection rate
- Tests strategy resilience

### Low Liquidity Testing
```json
{
  "startingBalance": 10000,
  "slippageBps": 100,
  "latencyMs": 500,
  "partialFillPercent": 80,
  "rejectionRate": 15,
  "enableRealisticFills": true
}
```
- Simulates illiquid markets
- Very high slippage (1%)
- Most orders partially filled
- Higher rejection rate
- Tests strategy in difficult conditions

## Monitoring Simulation Effects

When simulation features are enabled, you'll see additional information in the logs:

```
📄 Paper Trading: Slippage simulation enabled (10 bps = 0.10%)
📄 Paper Trading: Network latency simulation enabled (200ms)
📄 Paper Trading: Partial fill simulation enabled (20% chance)
📄 Paper Trading: Order rejection simulation enabled (5% chance)
📄 Paper Trading: ✅ MARKET order filled at 50125.50 (slippage: 10bps) 🔸 PARTIAL FILL: 0.018/0.020
📄 Paper Trading: ❌ Order rejected (simulated rejection)
```

## Best Practices

1. **Start Conservative**: Begin with default settings (no simulation) to validate your strategy logic
2. **Add Realism Gradually**: Enable one simulation feature at a time to understand its impact
3. **Match Your Target Market**: Configure parameters to match the liquidity and conditions of your target trading pairs
4. **Test Extremes**: Before going live, test with stress testing parameters to ensure your strategy is robust
5. **Monitor Performance**: Pay attention to how simulation parameters affect your win rate and profitability

## Technical Implementation

The simulation features are implemented in the `OrderSimulator` class:

- **Slippage**: Applied to execution price based on order side (always unfavorable)
- **Latency**: Adds delay using `setTimeout` before order execution
- **Partial Fills**: Uses random number generation to determine fill quantity
- **Rejections**: Randomly rejects orders based on configured probability
- **Realistic Fills**: Combines all features with sensible defaults

All simulations use real market prices from the Aster Finance API, so your paper trading results reflect actual market movements.

## Troubleshooting

### Configuration Not Applied
- Ensure you saved the configuration
- Restart the bot after changing settings
- Check the logs for confirmation messages

### Unrealistic Results
- Review your simulation parameters
- Compare with actual market conditions
- Adjust parameters to better match reality

### Too Many Rejections
- Lower the rejection rate
- Check if partial fill rate is also high
- Ensure starting balance is sufficient

## Next Steps

- Read the [Paper Trading Quick Start Guide](./PAPER_TRADING_QUICKSTART.md) for basic setup
- See [Paper Trading Documentation](./PAPER_TRADING.md) for technical details
- Test your strategy with various simulation settings before going live
