#!/usr/bin/env node

import { Hunter } from '../lib/bot/hunter';
import { PositionManager } from '../lib/bot/positionManager';
import { Config } from '../lib/types';
import { StatusBroadcaster } from './websocketServer';
import { initializeBalanceService, stopBalanceService, getBalanceService } from '../lib/services/balanceService';
import { initializePriceService, stopPriceService, getPriceService } from '../lib/services/priceService';
import { vwapStreamer } from '../lib/services/vwapStreamer';
import { getPositionMode } from '../lib/api/positionMode';
import { execSync } from 'child_process';
import { cleanupScheduler } from '../lib/services/cleanupScheduler';
import { db } from '../lib/db/database';
import { configManager } from '../lib/services/configManager';
import pnlService from '../lib/services/pnlService';

// Helper function to kill all child processes (synchronous for exit handler)
function killAllProcesses() {
  try {
    if (process.platform === 'win32') {
      // On Windows, kill the entire process tree
      execSync(`taskkill /F /T /PID ${process.pid}`, { stdio: 'ignore' });
    } else {
      // On Unix-like systems, kill the process group
      process.kill(-process.pid, 'SIGKILL');
    }
  } catch (_e) {
    // Ignore errors, process might already be dead
  }
}

class AsterBot {
  private hunter: Hunter | null = null;
  private positionManager: PositionManager | null = null;
  private config: Config | null = null;
  private isRunning = false;
  private statusBroadcaster: StatusBroadcaster;
  private isHedgeMode: boolean = false;

  constructor() {
    // Will be initialized with config port
    this.statusBroadcaster = null as any;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Bot is already running');
      return;
    }

    try {
      console.log('🚀 Starting Aster Liquidation Hunter Bot...');

      // Initialize database first (ensures schema is created)
      await db.initialize();
      console.log('✅ Database initialized');

      // Initialize config manager and load configuration
      this.config = await configManager.initialize();
      console.log('✅ Configuration loaded');

      // Initialize WebSocket server with configured port
      const wsPort = this.config.global.server?.websocketPort || 8080;
      this.statusBroadcaster = new StatusBroadcaster(wsPort);
      await this.statusBroadcaster.start();
      console.log(`✅ WebSocket status server started on port ${wsPort}`);
      console.log(`📝 Paper Mode: ${this.config.global.paperMode ? 'ENABLED' : 'DISABLED'}`);
      console.log(`💰 Risk Percent: ${this.config.global.riskPercent}%`);
      console.log(`📊 Symbols configured: ${Object.keys(this.config.symbols).join(', ')}`);

      // Update status broadcaster with config info
      this.statusBroadcaster.updateStatus({
        paperMode: this.config.global.paperMode,
        symbols: Object.keys(this.config.symbols),
      });

      // Listen for config updates
      configManager.on('config:updated', (newConfig) => {
        this.handleConfigUpdate(newConfig);
      });

      configManager.on('config:error', (error) => {
        console.error('❌ Config error:', error.message);
        this.statusBroadcaster.addError(`Config: ${error.message}`);
      });

      // Check API keys
      const hasValidApiKeys = this.config.api.apiKey && this.config.api.secretKey &&
                              this.config.api.apiKey.length > 0 && this.config.api.secretKey.length > 0;

      if (!hasValidApiKeys) {
        console.log('⚠️  WARNING: No API keys configured. Running in PAPER MODE only.');
        console.log('   Please configure your API keys via the web interface at http://localhost:3000/config');
        if (!this.config.global.paperMode) {
          console.error('❌ Cannot run in LIVE mode without API keys!');
          throw new Error('API keys required for live trading');
        }
      }

      if (hasValidApiKeys) {
        // Initialize balance service and set up WebSocket broadcasting
        try {
          console.log('Initializing balance service...');
          await initializeBalanceService(this.config.api);

          // Connect balance service to status broadcaster
          const balanceService = getBalanceService();
          if (balanceService) {
            balanceService.on('balanceUpdate', (balanceData) => {
              console.log('[Bot] Broadcasting balance update via WebSocket');
              this.statusBroadcaster.broadcast('balance_update', balanceData);
            });
          }
          console.log('✅ Balance service initialized and connected to WebSocket broadcaster');
        } catch (error) {
          console.error('Failed to initialize balance service:', error);
          // Continue anyway - bot can work without balance service
        }

        // Check and set position mode
        try {
          this.isHedgeMode = await getPositionMode(this.config.api);
          console.log(`📊 Position Mode: ${this.isHedgeMode ? 'HEDGE MODE' : 'ONE-WAY MODE'}`);

          // If config specifies a position mode and it differs from current, optionally set it
          if (this.config.global.positionMode) {
            const wantHedgeMode = this.config.global.positionMode === 'HEDGE';
            if (wantHedgeMode !== this.isHedgeMode) {
              console.log(`⚠️  Config specifies ${this.config.global.positionMode} mode but account is in ${this.isHedgeMode ? 'HEDGE' : 'ONE-WAY'} mode`);
              // Uncomment the next lines to automatically change position mode
              // await setPositionMode(wantHedgeMode, this.config.api);
              // this.isHedgeMode = wantHedgeMode;
              // console.log(`✅ Position mode changed to ${this.config.global.positionMode}`);
            }
          }
        } catch (error) {
          console.error('⚠️  Failed to check position mode, assuming ONE-WAY mode:', error);
          this.isHedgeMode = false;
        }

        // Initialize PnL tracking service with balance data
        try {
          const balanceService = getBalanceService();
          if (balanceService) {
            const status = balanceService.getConnectionStatus();
            const currentBalance = balanceService.getCurrentBalance();

            if (status.connected) {
              console.log('✅ Real-time balance service connected');
              console.log('[Bot] Balance service status:', {
                connected: status.connected,
                lastUpdate: status.lastUpdate ? new Date(status.lastUpdate).toISOString() : 'never',
                balance: currentBalance
              });
            } else {
              console.warn('⚠️ Balance service initialized but not fully connected:', status.error);
            }

            // Initialize PnL tracking service
            if (currentBalance && currentBalance.totalBalance > 0) {
              pnlService.resetSession(currentBalance.totalBalance);
              console.log('✅ PnL tracking service initialized with balance:', currentBalance.totalBalance);
            } else {
              console.warn('⚠️ PnL tracking not initialized - no balance data available');
            }
          }
        } catch (error: any) {
          console.error('⚠️  Balance service failed to start:', error instanceof Error ? error.message : error);
          console.error('[Bot] Balance service error stack:', error instanceof Error ? error.stack : 'No stack trace');
          this.statusBroadcaster.addError(`Balance Service: ${error instanceof Error ? error.message : 'Unknown error'}`);
          // Continue running bot even if balance service fails
          console.log('[Bot] Bot will continue without real-time balance updates');
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

            // Note: We'll subscribe to position symbols after position manager starts
          }
        } catch (error: any) {
          console.error('⚠️  Price service failed to start:', error.message);
          this.statusBroadcaster.addError(`Price Service: ${error.message}`);
        }

        // Initialize VWAP Streamer for real-time VWAP calculations
        try {
          await vwapStreamer.start(this.config);

          // Listen for VWAP updates and broadcast to web UI
          vwapStreamer.on('vwap', (vwapData) => {
            this.statusBroadcaster.broadcast('vwap_update', vwapData);
          });

          // Also broadcast all VWAP values periodically
          setInterval(() => {
            const allVwap = vwapStreamer.getAllVWAP();
            if (allVwap.size > 0) {
              const vwapArray = Array.from(allVwap.values());
              this.statusBroadcaster.broadcast('vwap_bulk', vwapArray);
            }
          }, 2000);

          console.log('✅ VWAP streaming service started');
        } catch (error: any) {
          console.error('⚠️  VWAP streamer failed to start:', error.message);
          this.statusBroadcaster.addError(`VWAP Streamer: ${error.message}`);
        }
      }

      // Initialize Position Manager
      this.positionManager = new PositionManager(this.config, this.isHedgeMode);

      // Inject status broadcaster for real-time position updates
      this.positionManager.setStatusBroadcaster(this.statusBroadcaster);

      try {
        await this.positionManager.start();
        console.log('✅ Position Manager started');

        // Subscribe to price updates for all open positions
        const priceService = getPriceService();
        if (priceService && this.positionManager) {
          const positions = this.positionManager.getPositions();
          const positionSymbols = [...new Set(positions.map(p => p.symbol))];

          if (positionSymbols.length > 0) {
            priceService.subscribeToSymbols(positionSymbols);
            console.log(`📊 Price streaming enabled for open positions: ${positionSymbols.join(', ')}`);
          }
        }
      } catch (error: any) {
        console.error('⚠️  Position Manager failed to start:', error.message);
        this.statusBroadcaster.addError(`Position Manager: ${error.message}`);
        // Continue running in paper mode without position manager
        if (!this.config.global.paperMode) {
          throw new Error('Cannot run in LIVE mode without Position Manager');
        }
      }

      // Initialize Hunter
      this.hunter = new Hunter(this.config, this.isHedgeMode);

      // Inject status broadcaster for order events
      this.hunter.setStatusBroadcaster(this.statusBroadcaster);

      // Inject position tracker for position limit checks
      if (this.positionManager) {
        this.hunter.setPositionTracker(this.positionManager);
      }

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

      this.hunter.on('tradeBlocked', (data: any) => {
        console.log(`🚫 Trade blocked: ${data.symbol} ${data.side} - ${data.reason}`);
        this.statusBroadcaster.broadcastTradeBlocked(data);
        this.statusBroadcaster.logActivity(`Blocked: ${data.symbol} ${data.side} - ${data.blockType}`);
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

        // Subscribe to price updates for the new position's symbol
        const priceService = getPriceService();
        if (priceService && data.symbol) {
          priceService.subscribeToSymbols([data.symbol]);
          console.log(`📊 Added price streaming for new position: ${data.symbol}`);
        }

        // Trigger balance refresh after position open
        const balanceService = getBalanceService();
        if (balanceService && balanceService.isInitialized()) {
          setTimeout(() => {
            // Small delay to ensure exchange has processed the order
            const currentBalance = balanceService.getCurrentBalance();
            this.statusBroadcaster.broadcastBalance({
              totalBalance: currentBalance.totalBalance,
              availableBalance: currentBalance.availableBalance,
              totalPositionValue: currentBalance.totalPositionValue,
              totalPnL: currentBalance.totalPnL,
            });
          }, 1000);
        }
      });

      this.hunter.on('error', (error: any) => {
        console.error('❌ Hunter error:', error);
        this.statusBroadcaster.addError(error.toString());
      });

      await this.hunter.start();
      console.log('✅ Liquidation Hunter started');

      // Start the cleanup scheduler for liquidation database
      cleanupScheduler.start();
      console.log('✅ Database cleanup scheduler started (7-day retention)');

      this.isRunning = true;
      this.statusBroadcaster.setRunning(true);
      console.log('🟢 Bot is now running. Press Ctrl+C to stop.');

      // Handle graceful shutdown with enhanced signal handling
      const shutdownHandler = async (signal: string) => {
        console.log(`\n📡 Received ${signal}`);
        await this.stop();
      };

      // Register multiple signal handlers for cross-platform compatibility
      process.on('SIGINT', () => shutdownHandler('SIGINT'));
      process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
      process.on('SIGHUP', () => shutdownHandler('SIGHUP'));

      // Windows specific
      if (process.platform === 'win32') {
        process.on('SIGBREAK', () => shutdownHandler('SIGBREAK'));
      }

      // Handle process exit
      process.on('exit', (code) => {
        if (!this.isRunning) return;
        console.log(`Process exiting with code ${code}`);
        // Synchronous cleanup only
        killAllProcesses();
      });

      // Handle uncaught errors
      process.on('uncaughtException', (error) => {
        console.error('❌ Uncaught exception:', error);
        this.stop().catch(console.error);
      });

      process.on('unhandledRejection', (reason, promise) => {
        console.error('❌ Unhandled rejection at:', promise, 'reason:', reason);
        this.stop().catch(console.error);
      });

    } catch (error) {
      console.error('❌ Failed to start bot:', error);
      process.exit(1);
    }
  }

  private async handleConfigUpdate(newConfig: Config): Promise<void> {
    console.log('🔄 Applying config update...');

    const oldConfig = this.config;
    this.config = newConfig;

    try {
      // Update status broadcaster
      this.statusBroadcaster.updateStatus({
        paperMode: newConfig.global.paperMode,
        symbols: Object.keys(newConfig.symbols),
      });

      // Notify about critical changes
      if (oldConfig && oldConfig.global.paperMode !== newConfig.global.paperMode) {
        console.log(`⚠️  Paper Mode changed: ${oldConfig.global.paperMode} → ${newConfig.global.paperMode}`);
        this.statusBroadcaster.logActivity(`Config: Paper Mode ${newConfig.global.paperMode ? 'ENABLED' : 'DISABLED'}`);
      }

      // Update Hunter with new config
      if (this.hunter) {
        this.hunter.updateConfig(newConfig);
        console.log('✅ Hunter config updated');
      }

      // Update PositionManager with new config
      if (this.positionManager) {
        this.positionManager.updateConfig(newConfig);
        console.log('✅ Position Manager config updated');
      }

      // Update VWAP streamer with new symbols
      if (vwapStreamer) {
        const oldSymbols = new Set(Object.keys(oldConfig?.symbols || {}));
        const newSymbols = new Set(Object.keys(newConfig.symbols));

        // Check if symbols changed
        const symbolsChanged = oldSymbols.size !== newSymbols.size ||
          [...newSymbols].some(s => !oldSymbols.has(s));

        if (symbolsChanged) {
          await vwapStreamer.updateSymbols(newConfig);
          console.log('✅ VWAP symbols updated');
        }
      }

      // Broadcast config update to web UI
      this.statusBroadcaster.broadcast('config_updated', {
        timestamp: new Date(),
        config: newConfig,
      });

      console.log('✅ Config update applied successfully');
      this.statusBroadcaster.logActivity('Config reloaded from file');
    } catch (error) {
      console.error('❌ Failed to apply config update:', error);
      this.statusBroadcaster.addError(`Config update failed: ${error}`);

      // Rollback to old config on error
      if (oldConfig) {
        this.config = oldConfig;
        if (this.hunter) this.hunter.updateConfig(oldConfig);
        if (this.positionManager) this.positionManager.updateConfig(oldConfig);
      }
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log('\n🛑 Stopping bot...');
    this.isRunning = false;
    this.statusBroadcaster.setRunning(false);

    // Create a timeout to force exit if graceful shutdown takes too long
    const forceExitTimeout = setTimeout(() => {
      console.error('⚠️  Graceful shutdown timeout, forcing exit...');
      process.exit(1);
    }, 5000); // 5 second timeout

    try {
      if (this.hunter) {
        this.hunter.stop();
        console.log('✅ Hunter stopped');
      }

      if (this.positionManager) {
        this.positionManager.stop();
        console.log('✅ Position Manager stopped');
      }

      // Stop other services
      vwapStreamer.stop();
      console.log('✅ VWAP streamer stopped');

      await stopBalanceService().catch(err =>
        console.error('⚠️  Balance service stop error:', err)
      );
      console.log('✅ Balance service stopped');

      stopPriceService();
      console.log('✅ Price service stopped');

      cleanupScheduler.stop();
      console.log('✅ Cleanup scheduler stopped');

      configManager.stop();
      console.log('✅ Config manager stopped');

      this.statusBroadcaster.stop();
      console.log('✅ WebSocket server stopped');

      clearTimeout(forceExitTimeout);
      console.log('👋 Bot stopped successfully');
      process.exit(0);
    } catch (error) {
      clearTimeout(forceExitTimeout);
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