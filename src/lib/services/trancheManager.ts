import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { Config, Tranche, TrancheGroup } from '../types';
import { getMarkPrice } from '../api/market';
import { logWithTimestamp, logWarnWithTimestamp, logErrorWithTimestamp } from '../utils/timestamp';
import {
  createTranche as dbCreateTranche,
  getTranche,
  getActiveTranches,
  updateTranche,
  updateTrancheUnrealizedPnl,
  isolateTranche as dbIsolateTranche,
  closeTranche as dbCloseTranche,
  logTrancheEvent,
} from '../db/trancheDb';

// Exchange position interface (from positionManager)
interface ExchangePosition {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  markPrice: string;
  unRealizedProfit: string;
  liquidationPrice: string;
  leverage: string;
  marginType: string;
  isolatedMargin: string;
  isAutoAddMargin: string;
  positionSide: string;
  updateTime: number;
}

export class TrancheManagerService extends EventEmitter {
  private trancheGroups: Map<string, TrancheGroup> = new Map(); // key: "BTCUSDT_LONG"
  private config: Config;
  private priceService: any; // For real-time price updates
  private isolationCheckInterval?: NodeJS.Timeout;
  private isInitialized = false;

  constructor(config: Config) {
    super();
    this.config = config;
  }

  // Initialize from database on startup
  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    logWithTimestamp('TrancheManager: Initializing...');

    try {
      // Load all active tranches from database
      const symbols = Object.keys(this.config.symbols);

      for (const symbol of symbols) {
        const symbolConfig = this.config.symbols[symbol];
        if (!symbolConfig.enableTrancheManagement) continue;

        // Load LONG tranches
        const longTranches = await getActiveTranches(symbol, 'LONG');
        if (longTranches.length > 0) {
          const groupKey = this.getGroupKey(symbol, 'LONG');
          const group = this.createTrancheGroup(symbol, 'LONG', longTranches[0].positionSide);
          group.tranches = longTranches;
          group.activeTranches = longTranches.filter(t => !t.isolated);
          group.isolatedTranches = longTranches.filter(t => t.isolated);
          this.recalculateGroupMetrics(group);
          this.trancheGroups.set(groupKey, group);
          logWithTimestamp(`TrancheManager: Loaded ${longTranches.length} LONG tranches for ${symbol}`);
        }

        // Load SHORT tranches
        const shortTranches = await getActiveTranches(symbol, 'SHORT');
        if (shortTranches.length > 0) {
          const groupKey = this.getGroupKey(symbol, 'SHORT');
          const group = this.createTrancheGroup(symbol, 'SHORT', shortTranches[0].positionSide);
          group.tranches = shortTranches;
          group.activeTranches = shortTranches.filter(t => !t.isolated);
          group.isolatedTranches = shortTranches.filter(t => t.isolated);
          this.recalculateGroupMetrics(group);
          this.trancheGroups.set(groupKey, group);
          logWithTimestamp(`TrancheManager: Loaded ${shortTranches.length} SHORT tranches for ${symbol}`);
        }
      }

      this.isInitialized = true;
      logWithTimestamp(`TrancheManager: Initialized with ${this.trancheGroups.size} tranche groups`);
    } catch (error) {
      logErrorWithTimestamp('TrancheManager: Initialization failed:', error);
      throw error;
    }
  }

  // Check if tranche management is enabled for a symbol
  public isEnabled(symbol: string): boolean {
    return this.config.symbols[symbol]?.enableTrancheManagement === true;
  }

  // Update configuration
  public updateConfig(newConfig: Config): void {
    this.config = newConfig;
  }

  // Create a new tranche when opening a position
  public async createTranche(params: {
    symbol: string;
    side: 'BUY' | 'SELL'; // Order side
    positionSide: 'LONG' | 'SHORT' | 'BOTH';
    entryPrice: number;
    quantity: number;
    marginUsed: number;
    leverage: number;
    orderId?: string;
  }): Promise<Tranche> {
    const symbolConfig = this.config.symbols[params.symbol];
    if (!symbolConfig) {
      throw new Error(`Symbol ${params.symbol} not found in config`);
    }

    const trancheSide = params.side === 'BUY' ? 'LONG' : 'SHORT';

    // Calculate TP/SL prices
    const tpPrice = this.calculateTpPrice(params.entryPrice, symbolConfig.tpPercent, trancheSide);
    const slPrice = this.calculateSlPrice(params.entryPrice, symbolConfig.slPercent, trancheSide);

    const tranche: Tranche = {
      id: uuidv4(),
      symbol: params.symbol,
      side: trancheSide,
      positionSide: params.positionSide,
      entryPrice: params.entryPrice,
      quantity: params.quantity,
      marginUsed: params.marginUsed,
      leverage: params.leverage,
      entryTime: Date.now(),
      entryOrderId: params.orderId,
      unrealizedPnl: 0,
      realizedPnl: 0,
      tpPercent: symbolConfig.tpPercent,
      slPercent: symbolConfig.slPercent,
      tpPrice,
      slPrice,
      status: 'active',
      isolated: false,
    };

    // Save to database
    await dbCreateTranche(tranche);

    // Add to in-memory tracking
    const groupKey = this.getGroupKey(params.symbol, trancheSide);
    let group = this.trancheGroups.get(groupKey);
    if (!group) {
      group = this.createTrancheGroup(params.symbol, trancheSide, params.positionSide);
      this.trancheGroups.set(groupKey, group);
    }

    group.tranches.push(tranche);
    group.activeTranches.push(tranche);
    this.recalculateGroupMetrics(group);

    // Log event
    await logTrancheEvent(tranche.id, 'created', {
      price: params.entryPrice,
      quantity: params.quantity,
      trigger: params.orderId,
    });

    // Emit event
    this.emit('trancheCreated', tranche);

    logWithTimestamp(`TrancheManager: Created tranche ${tranche.id.substring(0, 8)} for ${params.symbol} ${trancheSide} @ ${params.entryPrice}`);

    return tranche;
  }

  // Check if a tranche should be isolated (P&L < threshold)
  public shouldIsolateTranche(tranche: Tranche, currentPrice: number): boolean {
    if (tranche.isolated || tranche.status !== 'active') {
      return false;
    }

    const symbolConfig = this.config.symbols[tranche.symbol];
    if (!symbolConfig) return false;

    const threshold = symbolConfig.trancheIsolationThreshold || 5;

    // Calculate unrealized P&L %
    const pnlPercent = this.calculatePnlPercent(
      tranche.entryPrice,
      currentPrice,
      tranche.side
    );

    return pnlPercent <= -threshold; // Negative = loss
  }

  // Isolate a tranche (mark as underwater)
  public async isolateTranche(trancheId: string, currentPrice?: number): Promise<void> {
    const tranche = await getTranche(trancheId);
    if (!tranche || tranche.isolated) return;

    const price = currentPrice || (await this.getCurrentPrice(tranche.symbol));

    await dbIsolateTranche(trancheId, price);

    // Update in-memory
    tranche.isolated = true;
    tranche.isolationTime = Date.now();
    tranche.isolationPrice = price;

    const groupKey = this.getGroupKey(tranche.symbol, tranche.side);
    const group = this.trancheGroups.get(groupKey);
    if (group) {
      // Move from active to isolated
      group.activeTranches = group.activeTranches.filter((t) => t.id !== trancheId);
      group.isolatedTranches.push(tranche);
      this.recalculateGroupMetrics(group);
    }

    // Log event
    await logTrancheEvent(trancheId, 'isolated', {
      price,
      pnl: tranche.unrealizedPnl,
      trigger: 'isolation_threshold',
    });

    // Emit event
    this.emit('trancheIsolated', tranche);

    const pnlPercent = this.calculatePnlPercent(tranche.entryPrice, price, tranche.side);
    logWithTimestamp(
      `TrancheManager: Isolated tranche ${trancheId.substring(0, 8)} for ${tranche.symbol} at ${price} (${pnlPercent.toFixed(2)}% P&L)`
    );
  }

  // Monitor all active tranches and isolate if needed
  public async checkIsolationConditions(): Promise<void> {
    for (const [_key, group] of this.trancheGroups) {
      if (group.activeTranches.length === 0) continue;

      try {
        const currentPrice = await this.getCurrentPrice(group.symbol);

        for (const tranche of group.activeTranches) {
          if (this.shouldIsolateTranche(tranche, currentPrice)) {
            await this.isolateTranche(tranche.id, currentPrice);
          }
        }
      } catch (error) {
        logErrorWithTimestamp(`TrancheManager: Failed to check isolation for ${group.symbol}:`, error);
      }
    }
  }

  // Check if an isolated tranche has recovered (P&L > recovery threshold)
  public shouldRecoverTranche(tranche: Tranche, currentPrice: number): boolean {
    if (!tranche.isolated || tranche.status !== 'active') {
      return false;
    }

    const symbolConfig = this.config.symbols[tranche.symbol];
    if (!symbolConfig || !symbolConfig.trancheAutoCloseIsolated) {
      return false;
    }

    const recoveryThreshold = symbolConfig.trancheRecoveryThreshold ?? 0.5;

    // Calculate unrealized P&L %
    const pnlPercent = this.calculatePnlPercent(
      tranche.entryPrice,
      currentPrice,
      tranche.side
    );

    // Recovered if P&L is positive and exceeds recovery threshold
    return pnlPercent >= recoveryThreshold;
  }

  // Monitor all isolated tranches and auto-close if recovered
  public async checkRecoveryConditions(): Promise<void> {
    for (const [_key, group] of this.trancheGroups) {
      if (group.isolatedTranches.length === 0) continue;

      try {
        const currentPrice = await this.getCurrentPrice(group.symbol);
        const symbolConfig = this.config.symbols[group.symbol];

        // Skip if auto-close is not enabled
        if (!symbolConfig?.trancheAutoCloseIsolated) {
          continue;
        }

        for (const tranche of group.isolatedTranches) {
          if (this.shouldRecoverTranche(tranche, currentPrice)) {
            await this.autoCloseRecoveredTranche(tranche.id, currentPrice);
          }
        }
      } catch (error) {
        logErrorWithTimestamp(`TrancheManager: Failed to check recovery for ${group.symbol}:`, error);
      }
    }
  }

  // Auto-close a recovered isolated tranche
  private async autoCloseRecoveredTranche(trancheId: string, currentPrice: number): Promise<void> {
    const tranche = await getTranche(trancheId);
    if (!tranche || !tranche.isolated) return;

    const pnlPercent = this.calculatePnlPercent(tranche.entryPrice, currentPrice, tranche.side);
    const realizedPnl = this.calculateUnrealizedPnl(
      tranche.entryPrice,
      currentPrice,
      tranche.quantity,
      tranche.side
    );

    logWithTimestamp(
      `TrancheManager: Auto-closing recovered isolated tranche ${trancheId.substring(0, 8)} for ${tranche.symbol} at ${currentPrice} (${pnlPercent.toFixed(2)}% P&L, +${realizedPnl.toFixed(2)} USDT)`
    );

    // Close the tranche
    await this.closeTranche({
      trancheId,
      exitPrice: currentPrice,
      realizedPnl,
      orderId: `auto_recovery_${Date.now()}`,
    });

    // Log event
    await logTrancheEvent(trancheId, 'closed', {
      price: currentPrice,
      quantity: tranche.quantity,
      pnl: realizedPnl,
      trigger: 'auto_close_recovery',
    });

    // Emit event
    this.emit('trancheAutoClosedRecovery', {
      tranche,
      exitPrice: currentPrice,
      pnlPercent,
      realizedPnl,
    });

    logWithTimestamp(
      `TrancheManager: Successfully auto-closed recovered tranche ${trancheId.substring(0, 8)} - freed ${tranche.marginUsed.toFixed(2)} USDT margin`
    );
  }

  // Select which tranche(s) to close based on LIFO strategy (newest first)
  public selectTranchesToClose(
    symbol: string,
    side: 'LONG' | 'SHORT',
    quantityToClose: number
  ): Tranche[] {
    const groupKey = this.getGroupKey(symbol, side);
    const group = this.trancheGroups.get(groupKey);
    if (!group) return [];

    const tranchesToClose: Tranche[] = [];
    let remainingQty = quantityToClose;

    // LIFO: Sort tranches by entry time (newest first)
    const sortedTranches = [...group.activeTranches].sort((a, b) => b.entryTime - a.entryTime);

    // Select tranches until we have enough quantity
    for (const tranche of sortedTranches) {
      if (remainingQty <= 0) break;

      tranchesToClose.push(tranche);
      remainingQty -= tranche.quantity;
    }

    return tranchesToClose;
  }

  // Close a tranche (fully or partially)
  public async closeTranche(params: {
    trancheId: string;
    exitPrice: number;
    quantityClosed?: number; // If partial close
    realizedPnl: number;
    orderId?: string;
  }): Promise<void> {
    const tranche = await getTranche(params.trancheId);
    if (!tranche) return;

    const isFullClose = !params.quantityClosed || params.quantityClosed >= tranche.quantity;

    if (isFullClose) {
      // Full close
      await dbCloseTranche(params.trancheId, params.exitPrice, params.realizedPnl, params.orderId);

      // Update in-memory
      tranche.status = 'closed';
      tranche.exitPrice = params.exitPrice;
      tranche.exitTime = Date.now();
      tranche.exitOrderId = params.orderId;
      tranche.realizedPnl = params.realizedPnl;

      const groupKey = this.getGroupKey(tranche.symbol, tranche.side);
      const group = this.trancheGroups.get(groupKey);
      if (group) {
        group.activeTranches = group.activeTranches.filter((t) => t.id !== params.trancheId);
        group.isolatedTranches = group.isolatedTranches.filter((t) => t.id !== params.trancheId);
        this.recalculateGroupMetrics(group);
      }

      await logTrancheEvent(params.trancheId, 'closed', {
        price: params.exitPrice,
        quantity: tranche.quantity,
        pnl: params.realizedPnl,
        trigger: params.orderId,
      });

      this.emit('trancheClosed', tranche);

      logWithTimestamp(
        `TrancheManager: Closed tranche ${params.trancheId.substring(0, 8)} for ${tranche.symbol} at ${params.exitPrice} (P&L: ${params.realizedPnl.toFixed(2)} USDT)`
      );
    } else {
      // Partial close - reduce quantity
      const qtyToClose = params.quantityClosed!; // TypeScript: we know it's defined here
      const newQuantity = tranche.quantity - qtyToClose;
      const proportionalPnl = params.realizedPnl * (qtyToClose / tranche.quantity);

      await updateTranche(params.trancheId, {
        quantity: newQuantity,
        realizedPnl: tranche.realizedPnl + proportionalPnl,
      });

      // Update in-memory
      tranche.quantity = newQuantity;
      tranche.realizedPnl += proportionalPnl;

      const groupKey = this.getGroupKey(tranche.symbol, tranche.side);
      const group = this.trancheGroups.get(groupKey);
      if (group) {
        this.recalculateGroupMetrics(group);
      }

      await logTrancheEvent(params.trancheId, 'updated', {
        price: params.exitPrice,
        quantity: qtyToClose,
        pnl: proportionalPnl,
        trigger: 'partial_close',
      });

      this.emit('tranchePartialClose', tranche);

      logWithTimestamp(
        `TrancheManager: Partially closed tranche ${params.trancheId.substring(0, 8)} - ${qtyToClose} of ${tranche.quantity + qtyToClose} (P&L: ${proportionalPnl.toFixed(2)} USDT)`
      );
    }
  }

  // Process order fill and close appropriate tranches
  public async processOrderFill(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    positionSide: 'LONG' | 'SHORT' | 'BOTH';
    quantityFilled: number;
    fillPrice: number;
    realizedPnl: number;
    orderId: string;
  }): Promise<void> {
    const trancheSide = params.side === 'BUY' ? 'SHORT' : 'LONG'; // Closing side is opposite

    const tranchesToClose = this.selectTranchesToClose(params.symbol, trancheSide, params.quantityFilled);

    let remainingQty = params.quantityFilled;
    let remainingPnl = params.realizedPnl;

    for (const tranche of tranchesToClose) {
      const qtyToClose = Math.min(remainingQty, tranche.quantity);
      const proportionalPnl = remainingPnl * (qtyToClose / params.quantityFilled);

      await this.closeTranche({
        trancheId: tranche.id,
        exitPrice: params.fillPrice,
        quantityClosed: qtyToClose,
        realizedPnl: proportionalPnl,
        orderId: params.orderId,
      });

      remainingQty -= qtyToClose;
      remainingPnl -= proportionalPnl;

      if (remainingQty <= 0) break;
    }
  }

  // Sync local tranches with exchange position
  public async syncWithExchange(
    symbol: string,
    side: 'LONG' | 'SHORT',
    exchangePosition: ExchangePosition
  ): Promise<void> {
    const groupKey = this.getGroupKey(symbol, side);
    const group = this.trancheGroups.get(groupKey);

    const exchangeQty = Math.abs(parseFloat(exchangePosition.positionAmt));

    if (!group) {
      if (exchangeQty > 0) {
        // Exchange has position but we have no tranches - create "unknown" tranche
        logWarnWithTimestamp(
          `TrancheManager: Found untracked position ${symbol} ${side}, creating recovery tranche`
        );
        await this.createTranche({
          symbol,
          side: side === 'LONG' ? 'BUY' : 'SELL',
          positionSide: exchangePosition.positionSide as any,
          entryPrice: parseFloat(exchangePosition.entryPrice),
          quantity: exchangeQty,
          marginUsed:
            (exchangeQty * parseFloat(exchangePosition.entryPrice)) /
            parseFloat(exchangePosition.leverage),
          leverage: parseFloat(exchangePosition.leverage),
        });
      }
      return;
    }

    // Compare quantities
    const localQty = group.totalQuantity;
    const drift = Math.abs(localQty - exchangeQty);
    const driftPercent = (drift / Math.max(exchangeQty, 0.00001)) * 100;

    if (driftPercent > 1) {
      // More than 1% drift
      logWarnWithTimestamp(
        `TrancheManager: Quantity drift detected for ${symbol} ${side} - Local: ${localQty.toFixed(6)}, Exchange: ${exchangeQty.toFixed(6)} (${driftPercent.toFixed(2)}% drift)`
      );
      group.syncStatus = 'drift';

      if (exchangeQty === 0 && localQty > 0) {
        // Exchange position closed but we still have tranches - close all
        logWarnWithTimestamp(`TrancheManager: Exchange position closed, closing all local tranches`);
        for (const tranche of group.activeTranches) {
          await this.closeTranche({
            trancheId: tranche.id,
            exitPrice: parseFloat(exchangePosition.markPrice),
            realizedPnl: 0, // Unknown - already realized on exchange
          });
        }
      } else if (exchangeQty > 0 && localQty === 0) {
        // Exchange has position but we have no tranches
        logWarnWithTimestamp(`TrancheManager: Creating recovery tranche for untracked position`);
        await this.createTranche({
          symbol,
          side: side === 'LONG' ? 'BUY' : 'SELL',
          positionSide: exchangePosition.positionSide as any,
          entryPrice: parseFloat(exchangePosition.entryPrice),
          quantity: exchangeQty,
          marginUsed:
            (exchangeQty * parseFloat(exchangePosition.entryPrice)) /
            parseFloat(exchangePosition.leverage),
          leverage: parseFloat(exchangePosition.leverage),
        });
      } else if (exchangeQty < localQty) {
        // Partial close on exchange - close oldest tranches to match
        const qtyToClose = localQty - exchangeQty;
        const tranchesToClose = this.selectTranchesToClose(symbol, side, qtyToClose);

        for (const tranche of tranchesToClose) {
          await this.closeTranche({
            trancheId: tranche.id,
            exitPrice: parseFloat(exchangePosition.markPrice),
            quantityClosed: Math.min(tranche.quantity, qtyToClose),
            realizedPnl: 0, // Unknown
          });
        }
      }
    } else {
      group.syncStatus = 'synced';
    }

    group.lastExchangeQuantity = exchangeQty;
    group.lastExchangeSync = Date.now();
  }

  // Check if we can open a new tranche
  public canOpenNewTranche(
    symbol: string,
    side: 'LONG' | 'SHORT'
  ): {
    allowed: boolean;
    reason?: string;
  } {
    const symbolConfig = this.config.symbols[symbol];
    if (!symbolConfig?.enableTrancheManagement) {
      return { allowed: true }; // Not using tranche system
    }

    const groupKey = this.getGroupKey(symbol, side);
    const group = this.trancheGroups.get(groupKey);

    if (!group) {
      return { allowed: true }; // First tranche
    }

    // Check max active tranches
    const maxTranches = symbolConfig.maxTranches || 3;
    if (group.activeTranches.length >= maxTranches) {
      return {
        allowed: false,
        reason: `Max active tranches (${maxTranches}) reached for ${symbol}`,
      };
    }

    // Check max isolated tranches
    const maxIsolated = symbolConfig.maxIsolatedTranches || 2;
    if (group.isolatedTranches.length >= maxIsolated) {
      if (!symbolConfig.allowTrancheWhileIsolated) {
        return {
          allowed: false,
          reason: `Max isolated tranches (${maxIsolated}) reached for ${symbol}`,
        };
      }
    }

    return { allowed: true };
  }

  // Update unrealized P&L for all active tranches
  public async updateUnrealizedPnl(symbol: string, currentPrice: number): Promise<void> {
    const groups = [
      this.trancheGroups.get(this.getGroupKey(symbol, 'LONG')),
      this.trancheGroups.get(this.getGroupKey(symbol, 'SHORT')),
    ];

    for (const group of groups) {
      if (!group) continue;

      for (const tranche of group.activeTranches) {
        const pnl = this.calculateUnrealizedPnl(
          tranche.entryPrice,
          currentPrice,
          tranche.quantity,
          tranche.side
        );

        tranche.unrealizedPnl = pnl;

        // Update in DB (batch update for performance)
        await updateTrancheUnrealizedPnl(tranche.id, pnl);
      }

      this.recalculateGroupMetrics(group);
    }

    // Check isolation and recovery conditions after P&L update
    await this.checkIsolationConditions();
    await this.checkRecoveryConditions();
  }

  // Calculate unrealized P&L for a tranche
  private calculateUnrealizedPnl(
    entryPrice: number,
    currentPrice: number,
    quantity: number,
    side: 'LONG' | 'SHORT'
  ): number {
    if (side === 'LONG') {
      return (currentPrice - entryPrice) * quantity;
    } else {
      return (entryPrice - currentPrice) * quantity;
    }
  }

  // Calculate P&L percentage
  private calculatePnlPercent(
    entryPrice: number,
    currentPrice: number,
    side: 'LONG' | 'SHORT'
  ): number {
    if (side === 'LONG') {
      return ((currentPrice - entryPrice) / entryPrice) * 100;
    } else {
      return ((entryPrice - currentPrice) / entryPrice) * 100;
    }
  }

  // Start isolation and recovery monitoring
  public startIsolationMonitoring(intervalMs: number = 10000): void {
    this.stopIsolationMonitoring();

    this.isolationCheckInterval = setInterval(async () => {
      try {
        await this.checkIsolationConditions();
        await this.checkRecoveryConditions();
      } catch (error) {
        logErrorWithTimestamp('TrancheManager: Isolation/Recovery check failed:', error);
      }
    }, intervalMs);

    logWithTimestamp(`TrancheManager: Started isolation and recovery monitoring (every ${intervalMs / 1000}s)`);
  }

  public stopIsolationMonitoring(): void {
    if (this.isolationCheckInterval) {
      clearInterval(this.isolationCheckInterval);
      this.isolationCheckInterval = undefined;
      logWithTimestamp('TrancheManager: Stopped isolation monitoring');
    }
  }

  // Helper methods
  private getGroupKey(symbol: string, side: 'LONG' | 'SHORT'): string {
    return `${symbol}_${side}`;
  }

  private createTrancheGroup(
    symbol: string,
    side: 'LONG' | 'SHORT',
    positionSide: 'LONG' | 'SHORT' | 'BOTH'
  ): TrancheGroup {
    return {
      symbol,
      side,
      positionSide,
      tranches: [],
      activeTranches: [],
      isolatedTranches: [],
      totalQuantity: 0,
      totalMarginUsed: 0,
      weightedAvgEntry: 0,
      totalUnrealizedPnl: 0,
      lastExchangeQuantity: 0,
      lastExchangeSync: Date.now(),
      syncStatus: 'synced',
    };
  }

  private recalculateGroupMetrics(group: TrancheGroup): void {
    // Sum quantities and margins
    let totalQty = 0;
    let totalMargin = 0;
    let weightedEntry = 0;
    let totalPnl = 0;

    for (const tranche of group.activeTranches) {
      totalQty += tranche.quantity;
      totalMargin += tranche.marginUsed;
      weightedEntry += tranche.entryPrice * tranche.quantity;
      totalPnl += tranche.unrealizedPnl;
    }

    group.totalQuantity = totalQty;
    group.totalMarginUsed = totalMargin;
    group.weightedAvgEntry = totalQty > 0 ? weightedEntry / totalQty : 0;
    group.totalUnrealizedPnl = totalPnl;
  }

  private async getCurrentPrice(symbol: string): Promise<number> {
    if (this.priceService) {
      const price = this.priceService.getPrice(symbol);
      if (price) return price;
    }

    // Fallback to API
    const markPriceData = await getMarkPrice(symbol);
    return parseFloat(
      Array.isArray(markPriceData) ? markPriceData[0].markPrice : markPriceData.markPrice
    );
  }

  private calculateTpPrice(entryPrice: number, tpPercent: number, side: 'LONG' | 'SHORT'): number {
    if (side === 'LONG') {
      return entryPrice * (1 + tpPercent / 100);
    } else {
      return entryPrice * (1 - tpPercent / 100);
    }
  }

  private calculateSlPrice(entryPrice: number, slPercent: number, side: 'LONG' | 'SHORT'): number {
    if (side === 'LONG') {
      return entryPrice * (1 - slPercent / 100);
    } else {
      return entryPrice * (1 + slPercent / 100);
    }
  }

  // Public getters
  public getTranches(symbol: string, side: 'LONG' | 'SHORT'): Tranche[] {
    const groupKey = this.getGroupKey(symbol, side);
    return this.trancheGroups.get(groupKey)?.activeTranches || [];
  }

  public getTrancheGroup(symbol: string, side: 'LONG' | 'SHORT'): TrancheGroup | undefined {
    const groupKey = this.getGroupKey(symbol, side);
    return this.trancheGroups.get(groupKey);
  }

  public getAllTrancheGroups(): TrancheGroup[] {
    return Array.from(this.trancheGroups.values());
  }

  // Get the tranche with the best entry price (BEST_ENTRY strategy)
  // For LONG: lowest entry price, For SHORT: highest entry price
  public getBestEntryTranche(symbol: string, side: 'LONG' | 'SHORT'): Tranche | null {
    const groupKey = this.getGroupKey(symbol, side);
    const group = this.trancheGroups.get(groupKey);

    if (!group || group.activeTranches.length === 0) {
      return null;
    }

    // Find tranche with best entry
    let bestTranche = group.activeTranches[0];
    for (const tranche of group.activeTranches) {
      if (side === 'LONG') {
        // For LONG: lower entry price is better
        if (tranche.entryPrice < bestTranche.entryPrice) {
          bestTranche = tranche;
        }
      } else {
        // For SHORT: higher entry price is better
        if (tranche.entryPrice > bestTranche.entryPrice) {
          bestTranche = tranche;
        }
      }
    }

    return bestTranche;
  }
}

// Singleton instance
let trancheManager: TrancheManagerService | null = null;

export function initializeTrancheManager(config: Config): TrancheManagerService {
  trancheManager = new TrancheManagerService(config);
  return trancheManager;
}

export function getTrancheManager(): TrancheManagerService {
  if (!trancheManager) {
    throw new Error('TrancheManager not initialized. Call initializeTrancheManager() first.');
  }
  return trancheManager;
}
