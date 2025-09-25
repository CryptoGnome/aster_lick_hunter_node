#!/usr/bin/env node

import { Hunter } from '../lib/bot/hunter';
import { PositionManager } from '../lib/bot/positionManager';
import { loadConfig } from '../lib/bot/config';
import { Config } from '../lib/types';
import { StatusBroadcaster } from './websocketServer';
import { initializeBalanceService, stopBalanceService, getBalanceService } from '../lib/services/balanceService';
import { initializePriceService, stopPriceService, getPriceService } from '../lib/services/priceService';

class AsterBot {
  private hunter: Hunter | null = null;
  private positionManager: PositionManager | null = null;
  private config: Config | null = null;
  private isRunning = false;
  private statusBroadcaster: StatusBroadcaster;

  constructor() {
    this.statusBroadcaster = new StatusBroadcaster();
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Bot is already running');
      return;
    }

    try {
      console.log('🚀 Starting Aster Liquidation Hunter Bot...');

      // Start WebSocket server for status broadcasting
      await this.statusBroadcaster.start();
      console.log('✅ WebSocket status server started');

      // Load configuration
      this.config = await loadConfig();
      console.log('✅ Configuration loaded');
      console.log(`📝 Paper Mode: ${this.config.global.paperMode ? 'ENABLED' : 'DISABLED'}`);
      console.log(`💰 Risk Percent: ${this.config.global.riskPercent}%`);
      console.log(`📊 Symbols configured: ${Object.keys(this.config.symbols).join(', ')}`);

      // Update status broadcaster with config info
      this.statusBroadcaster.updateStatus({
        paperMode: this.config.global.paperMode,
        symbols: Object.keys(this.config.symbols),
      });

      // Check API keys
      if (!this.config.api.apiKey || !this.config.api.secretKey) {
        console.log('⚠️  WARNING: No API keys configured. Running in PAPER MODE only.');
        console.log('   Please configure your API keys via the web interface at http://localhost:3000/config');
        if (!this.config.global.paperMode) {
          console.error('❌ Cannot run in LIVE mode without API keys!');
          throw new Error('API keys required for live trading');
        }
      } else {
        // Initialize real-time balance service if API keys are available
        try {
          await initializeBalanceService(this.config.api);
          console.log('✅ Real-time balance service started');

          // Listen for balance updates and broadcast to web UI
          const balanceService = getBalanceService();
          if (balanceService) {
            balanceService.on('balanceUpdate', (balanceData) => {
              this.statusBroadcaster.broadcastBalance({
                totalBalance: balanceData.totalBalance,
                availableBalance: balanceData.availableBalance,
                totalPositionValue: balanceData.totalPositionValue,
                totalPnL: balanceData.totalPnL,
              });
            });
            console.log('✅ Balance broadcasting to web UI enabled');
          }
        } catch (error: any) {
          console.error('⚠️  Balance service failed to start:', error.message);
          this.statusBroadcaster.addError(`Balance Service: ${error.message}`);
        }

        // Initialize Price Service for real-time mark prices
        try {
          await initializePriceService();
          console.log('✅ Real-time price service started');

          // Listen for mark price updates and broadcast to web UI
          const priceService = getPriceService();
          if (priceService) {
            priceService.on('markPriceUpdate', (priceUpdates) => {
              // Broadcast price updates to web UI for live PnL calculation
              this.statusBroadcaster.broadcast('mark_price_update', priceUpdates);
            });

            // Subscribe to symbols we're trading
            const symbols = Object.keys(this.config.symbols);
            priceService.subscribeToSymbols(symbols);
            console.log('✅ Price streaming enabled for configured symbols');
          }
        } catch (error: any) {
          console.error('⚠️  Price service failed to start:', error.message);
          this.statusBroadcaster.addError(`Price Service: ${error.message}`);
        }
      }

      // Initialize Position Manager
      this.positionManager = new PositionManager(this.config);

      // Inject status broadcaster for real-time position updates
      this.positionManager.setStatusBroadcaster(this.statusBroadcaster);

      try {
        await this.positionManager.start();
        console.log('✅ Position Manager started');
      } catch (error: any) {
        console.error('⚠️  Position Manager failed to start:', error.message);
        this.statusBroadcaster.addError(`Position Manager: ${error.message}`);
        // Continue running in paper mode without position manager
        if (!this.config.global.paperMode) {
          throw new Error('Cannot run in LIVE mode without Position Manager');
        }
      }

      // Initialize Hunter
      this.hunter = new Hunter(this.config);

      // Connect hunter events to position manager and status broadcaster
      this.hunter.on('liquidationDetected', (liquidationEvent: any) => {
        console.log(`💥 Liquidation: ${liquidationEvent.symbol} ${liquidationEvent.side} ${liquidationEvent.quantity}`);
        this.statusBroadcaster.broadcastLiquidation(liquidationEvent);
        this.statusBroadcaster.logActivity(`Liquidation: ${liquidationEvent.symbol} ${liquidationEvent.side} ${liquidationEvent.quantity}`);
      });

      this.hunter.on('tradeOpportunity', (data: any) => {
        console.log(`🎯 Trade opportunity: ${data.symbol} ${data.side} (${data.reason})`);
        this.statusBroadcaster.broadcastTradeOpportunity(data);
        this.statusBroadcaster.logActivity(`Opportunity: ${data.symbol} ${data.side} - ${data.reason}`);
      });

      this.hunter.on('positionOpened', (data: any) => {
        console.log(`📈 Position opened: ${data.symbol} ${data.side} qty=${data.quantity}`);
        this.positionManager?.onNewPosition(data);
        this.statusBroadcaster.broadcastPositionUpdate({
          symbol: data.symbol,
          side: data.side,
          quantity: data.quantity,
          price: data.price,
          type: 'opened'
        });
        this.statusBroadcaster.logActivity(`Position opened: ${data.symbol} ${data.side}`);
        this.statusBroadcaster.updateStatus({
          positionsOpen: (this.statusBroadcaster as any).status.positionsOpen + 1,
        });
      });

      this.hunter.on('error', (error: any) => {
        console.error('❌ Hunter error:', error);
        this.statusBroadcaster.addError(error.toString());
      });

      await this.hunter.start();
      console.log('✅ Liquidation Hunter started');

      this.isRunning = true;
      this.statusBroadcaster.setRunning(true);
      console.log('🟢 Bot is now running. Press Ctrl+C to stop.');

      // Handle graceful shutdown
      process.on('SIGINT', () => this.stop());
      process.on('SIGTERM', () => this.stop());

    } catch (error) {
      console.error('❌ Failed to start bot:', error);
      process.exit(1);
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log('\n🛑 Stopping bot...');
    this.isRunning = false;
    this.statusBroadcaster.setRunning(false);

    try {
      if (this.hunter) {
        await this.hunter.stop();
        console.log('✅ Hunter stopped');
      }

      if (this.positionManager) {
        await this.positionManager.stop();
        console.log('✅ Position Manager stopped');
      }

      await stopBalanceService();
      console.log('✅ Balance service stopped');

      stopPriceService();
      console.log('✅ Price service stopped');

      this.statusBroadcaster.stop();
      console.log('✅ WebSocket server stopped');

      console.log('👋 Bot stopped successfully');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error while stopping:', error);
      process.exit(1);
    }
  }

  async status(): Promise<void> {
    if (!this.isRunning) {
      console.log('⚠️  Bot is not running');
      return;
    }

    console.log('🟢 Bot Status:');
    console.log(`  Running: ${this.isRunning}`);
    console.log(`  Paper Mode: ${this.config?.global.paperMode}`);
    console.log(`  Symbols: ${this.config ? Object.keys(this.config.symbols).join(', ') : 'N/A'}`);
  }
}

// Main execution
async function main() {
  const bot = new AsterBot();

  const args = process.argv.slice(2);
  const command = args[0] || 'start';

  switch (command) {
    case 'start':
      await bot.start();
      break;
    case 'status':
      await bot.status();
      break;
    default:
      console.log('Usage: node src/bot/index.js [start|status]');
      console.log('  start  - Start the bot');
      console.log('  status - Show bot status');
      process.exit(1);
  }
}

// Run if this is the main module
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { AsterBot };