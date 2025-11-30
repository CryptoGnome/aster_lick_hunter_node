/**
 * Position Sizing Calculator
 * 
 * Calculates dynamic position sizes based on account balance and risk parameters.
 * Includes risk assessment and "time to ruin" calculations for martingale strategies.
 */

import { loadConfig, saveConfig } from '../bot/config';
import { getAccountInfo } from '../api/market';
import logger from './logger';

export interface PositionSizingConfig {
  mode: 'FIXED' | 'PERCENTAGE';
  fixedSize: number;
  percentageOfBalance?: number;
  minPositionSize?: number;
  maxPositionSize?: number;
}

export interface RiskAssessment {
  positionSize: number;
  percentageOfBalance: number;
  maxPyramidSize: number; // If scaling in maxEntries times
  maxPyramidPercentage: number;
  riskLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME';
  warnings: string[];
}

export interface TimeToRuinEstimate {
  consecutiveLosses: number; // Number of max-size losses to blow account
  probabilityOfRuin: number; // Based on win rate
  estimatedDaysToRuin: number; // Based on trade frequency
  warnings: string[];
}

/**
 * Calculate position size based on mode and parameters
 */
export function calculatePositionSize(
  balance: number,
  config: PositionSizingConfig
): number {
  let size: number;

  if (config.mode === 'PERCENTAGE') {
    const percentage = config.percentageOfBalance || 1.0;
    size = (balance * percentage) / 100;
  } else {
    size = config.fixedSize;
  }

  // Apply min/max bounds
  if (config.minPositionSize !== undefined) {
    size = Math.max(size, config.minPositionSize);
  }
  if (config.maxPositionSize !== undefined) {
    size = Math.min(size, config.maxPositionSize);
  }

  return Number(size.toFixed(2));
}

/**
 * Assess risk level based on position size and pyramiding potential
 */
export function assessRisk(
  balance: number,
  positionSize: number,
  maxEntries: number = 10,
  leverage: number = 1
): RiskAssessment {
  const percentageOfBalance = (positionSize / balance) * 100;
  const maxPyramidSize = positionSize * maxEntries;
  const maxPyramidPercentage = (maxPyramidSize / balance) * 100;
  
  const warnings: string[] = [];
  let riskLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME' = 'LOW';

  // Risk level assessment for martingale strategies
  if (maxPyramidPercentage < 10) {
    riskLevel = 'LOW';
  } else if (maxPyramidPercentage < 30) {
    riskLevel = 'MODERATE';
    warnings.push('Moderate risk: Position can grow to 10-30% of balance');
  } else if (maxPyramidPercentage < 60) {
    riskLevel = 'HIGH';
    warnings.push('High risk: Position can grow to 30-60% of balance');
    warnings.push('Ensure sufficient margin buffer for volatility spikes');
  } else {
    riskLevel = 'EXTREME';
    warnings.push('⚠️ EXTREME RISK: Position can exceed 60% of balance');
    warnings.push('⚠️ Very high probability of liquidation during volatile moves');
    warnings.push('⚠️ Consider reducing position size or maxEntries');
  }

  // Leverage warnings
  if (leverage > 10 && maxPyramidPercentage > 30) {
    warnings.push(`⚠️ High leverage (${leverage}x) with large positions increases liquidation risk`);
  }

  // Small account warnings
  if (balance < 500 && maxPyramidPercentage > 40) {
    warnings.push('⚠️ Small account size makes recovery from drawdowns difficult');
  }

  return {
    positionSize,
    percentageOfBalance,
    maxPyramidSize,
    maxPyramidPercentage,
    riskLevel,
    warnings,
  };
}

/**
 * Calculate time to ruin for martingale/averaging strategies
 * 
 * Estimates how long before account is depleted based on:
 * - Position size
 * - Max pyramid size (scaling in)
 * - Win rate
 * - Average trades per day
 */
export function calculateTimeToRuin(
  balance: number,
  positionSize: number,
  maxEntries: number = 10,
  winRate: number = 0.65, // Default: 65% win rate
  tradesPerDay: number = 10,
  leverage: number = 1
): TimeToRuinEstimate {
  const warnings: string[] = [];
  const maxPyramidSize = positionSize * maxEntries;
  const maxLossPerPosition = maxPyramidSize; // Worst case: full pyramid loss
  
  // Calculate consecutive losses needed to blow account
  const consecutiveLosses = Math.floor(balance / maxLossPerPosition);
  
  // Probability of N consecutive losses
  const loseRate = 1 - winRate;
  const probabilityOfRuin = Math.pow(loseRate, consecutiveLosses);
  
  // Expected days to ruin (simplified Kelly-style calculation)
  // This is a rough estimate assuming uniform distribution
  const expectedLossesPerDay = tradesPerDay * loseRate;
  const expectedDaysToConsecutiveLosses = consecutiveLosses / expectedLossesPerDay;
  
  // Adjust for win rate (Kelly criterion perspective)
  // If edge exists, time to ruin is much longer
  const edge = winRate - 0.5;
  const adjustmentFactor = edge > 0 ? (1 + edge * 2) : 0.5;
  const estimatedDaysToRuin = Math.floor(expectedDaysToConsecutiveLosses * adjustmentFactor);

  // Generate warnings
  if (consecutiveLosses <= 3) {
    warnings.push('⚠️ CRITICAL: Only 3 or fewer max losses until account depletion');
    warnings.push('⚠️ Position size is too large relative to balance');
  } else if (consecutiveLosses <= 5) {
    warnings.push('⚠️ WARNING: Only 5 or fewer max losses until account depletion');
    warnings.push('Consider reducing position size for better survival');
  } else if (consecutiveLosses <= 10) {
    warnings.push('Moderate buffer: 6-10 max losses until account depletion');
  }

  if (estimatedDaysToRuin < 7) {
    warnings.push('⚠️ EXTREME RISK: Expected time to ruin is less than 1 week');
  } else if (estimatedDaysToRuin < 30) {
    warnings.push('⚠️ HIGH RISK: Expected time to ruin is less than 1 month');
  } else if (estimatedDaysToRuin < 90) {
    warnings.push('MODERATE RISK: Expected time to ruin is 1-3 months');
  }

  if (probabilityOfRuin > 0.01) {
    warnings.push(`Probability of ruin: ${(probabilityOfRuin * 100).toFixed(2)}%`);
  }

  // Leverage impact
  if (leverage > 10) {
    warnings.push(`High leverage (${leverage}x) significantly increases liquidation risk`);
    warnings.push('A single adverse move can liquidate entire position');
  }

  return {
    consecutiveLosses,
    probabilityOfRuin,
    estimatedDaysToRuin: Math.max(1, estimatedDaysToRuin), // At least 1 day
    warnings,
  };
}

/**
 * Get recommended position size based on account balance
 * Returns conservative recommendations for martingale strategies
 */
export function getRecommendedPositionSize(
  balance: number,
  maxEntries: number = 10,
  riskTolerance: 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE' = 'MODERATE'
): { positionSize: number; percentageOfBalance: number; rationale: string } {
  let targetPyramidPercentage: number;
  let rationale: string;

  switch (riskTolerance) {
    case 'CONSERVATIVE':
      targetPyramidPercentage = 15; // Max 15% of balance in full pyramid
      rationale = 'Conservative: Allows 6+ full pyramids before account depletion';
      break;
    case 'MODERATE':
      targetPyramidPercentage = 25; // Max 25% of balance in full pyramid
      rationale = 'Moderate: Allows 4 full pyramids before account depletion';
      break;
    case 'AGGRESSIVE':
      targetPyramidPercentage = 40; // Max 40% of balance in full pyramid
      rationale = 'Aggressive: Allows 2-3 full pyramids before account depletion';
      break;
  }

  const positionSize = (balance * targetPyramidPercentage) / (100 * maxEntries);
  const percentageOfBalance = (positionSize / balance) * 100;

  return {
    positionSize: Number(positionSize.toFixed(2)),
    percentageOfBalance: Number(percentageOfBalance.toFixed(2)),
    rationale,
  };
}

/**
 * Format risk assessment for display
 */
export function formatRiskAssessment(assessment: RiskAssessment): string {
  return `
Risk Level: ${assessment.riskLevel}
Position Size: $${assessment.positionSize.toFixed(2)} (${assessment.percentageOfBalance.toFixed(2)}% of balance)
Max Pyramid: $${assessment.maxPyramidSize.toFixed(2)} (${assessment.maxPyramidPercentage.toFixed(2)}% of balance)

${assessment.warnings.length > 0 ? 'Warnings:\n' + assessment.warnings.join('\n') : 'No warnings'}
  `.trim();
}

/**
 * Format time to ruin estimate for display
 */
export function formatTimeToRuin(estimate: TimeToRuinEstimate): string {
  const days = estimate.estimatedDaysToRuin;
  const timeString = days < 30 
    ? `${days} day${days !== 1 ? 's' : ''}`
    : `${Math.floor(days / 30)} month${Math.floor(days / 30) !== 1 ? 's' : ''}`;

  return `
Time to Ruin Estimate:
- Consecutive max losses to blow account: ${estimate.consecutiveLosses}
- Estimated time to ruin: ${timeString}
- Probability of ruin: ${(estimate.probabilityOfRuin * 100).toFixed(4)}%

${estimate.warnings.length > 0 ? 'Warnings:\n' + estimate.warnings.join('\n') : 'No warnings'}
  `.trim();
}

/**
 * Update dynamic position sizes for all symbols configured with PERCENTAGE mode
 * Should be called periodically (e.g., every 5 minutes) by the bot
 */
export async function updateDynamicPositionSizes(): Promise<void> {
  try {
    const config = await loadConfig();
    
    // Check if any symbols use percentage mode
    const symbolsUsingPercentage = Object.keys(config.symbols).filter(
      symbol => config.symbols[symbol].positionSizingMode === 'PERCENTAGE'
    );

    if (symbolsUsingPercentage.length === 0) {
      return; // No symbols using dynamic sizing
    }

    logger.info(`[PositionSizing] Updating dynamic position sizes for ${symbolsUsingPercentage.length} symbol(s)...`);

    // Fetch current account balance
    const accountInfo = await getAccountInfo({
      apiKey: config.api.apiKey,
      secretKey: config.api.secretKey,
    });

    const totalBalance = parseFloat(accountInfo.totalWalletBalance || '0');
    const availableBalance = parseFloat(accountInfo.availableBalance || '0');

    if (totalBalance === 0) {
      logger.warn('[PositionSizing] Account balance is 0, skipping position size update');
      return;
    }

    logger.info(`[PositionSizing] Current balance: $${totalBalance.toFixed(2)} (Available: $${availableBalance.toFixed(2)})`);

    let updatedCount = 0;

    // Update each symbol
    for (const symbol of symbolsUsingPercentage) {
      const symbolConfig = config.symbols[symbol];
      const percentageOfBalance = symbolConfig.percentageOfBalance || 1.0;
      
      // Calculate new position size
      const calculatedSize = (totalBalance * percentageOfBalance) / 100;
      
      // Apply min/max bounds
      let newTradeSize = calculatedSize;
      if (symbolConfig.minPositionSize !== undefined) {
        newTradeSize = Math.max(newTradeSize, symbolConfig.minPositionSize);
      }
      if (symbolConfig.maxPositionSize !== undefined) {
        newTradeSize = Math.min(newTradeSize, symbolConfig.maxPositionSize);
      }
      
      // Round to 2 decimals
      newTradeSize = Number(newTradeSize.toFixed(2));

      // Only update if changed by more than $0.01 to avoid unnecessary writes
      const currentSize = symbolConfig.tradeSize || 0;
      if (Math.abs(newTradeSize - currentSize) > 0.01) {
        logger.info(
          `[PositionSizing] ${symbol}: Updating trade size from $${currentSize.toFixed(2)} to $${newTradeSize.toFixed(2)} ` +
          `(${percentageOfBalance}% of $${totalBalance.toFixed(2)})`
        );

        // Update tradeSize
        config.symbols[symbol].tradeSize = newTradeSize;

        // If using separate long/short sizes, update those too
        if (symbolConfig.longTradeSize !== undefined) {
          config.symbols[symbol].longTradeSize = newTradeSize;
        }
        if (symbolConfig.shortTradeSize !== undefined) {
          config.symbols[symbol].shortTradeSize = newTradeSize;
        }

        updatedCount++;
      }
    }

    // Save config if any updates were made
    if (updatedCount > 0) {
      await saveConfig(config);
      logger.info(`[PositionSizing] Updated ${updatedCount} symbol(s) and saved configuration`);
    } else {
      logger.info('[PositionSizing] No position size changes needed (variation < $0.01)');
    }

  } catch (error) {
    logger.error('[PositionSizing] Failed to update dynamic position sizes:', error);
  }
}
