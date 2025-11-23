#!/usr/bin/env node

import { Hunter } from '../lib/bot/hunter';
import { PositionManager } from '../lib/bot/positionManager';
import { Config } from '../lib/types';
import { StatusBroadcaster } from './websocketServer';
import { initializeBalanceService, stopBalanceService, getBalanceService } from '../lib/services/balanceService';
import { initializePriceService, stopPriceService, getPriceService } from '../lib/services/priceService';
import { vwapStreamer } from '../lib/services/vwapStreamer';
import { getPositionMode, setPositionMode } from '../lib/api/positionMode';
import { execSync } from 'child_process';
import { db } from '../lib/db/database';
import { configManager } from '../lib/services/configManager';
import pnlService from '../lib/services/pnlService';
import { getRateLimitManager } from '../lib/api/rateLimitManager';
import { startRateLimitLogging } from '../lib/api/rateLimitMonitor';
import { initializeRateLimitToasts } from '../lib/api/rateLimitToasts';
import { thresholdMonitor } from '../lib/services/thresholdMonitor';
import { logWithTimestamp, logErrorWithTimestamp, logWarnWithTimestamp } from '../lib/utils/timestamp';

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
  private tradeSizeWarnings: any[] = [];
  private cleanupScheduler: any = null;

  constructor() {
    // Will be initialized with config port
    this.statusBroadcaster = null as any;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
logWithTimestamp('Bot is already running');
      return;
    }

    try {
      logWithTimestamp('🚀 Starting Aster Liquidation Hunter Bot...');

      // Initialize database first (ensures schema is created)
      await db.initialize();
      logWithTimestamp('✅ Database initialized');

      // Initialize config manager and load configuration
      this.config = await configManager.initialize();
      logWithTimestamp('✅ Configuration loaded');

      // Validate trade sizes against exchange minimums
      const { validateAllTradeSizes } = await import('../lib/validation/tradeSizeValidator');
      const validationResult = await validateAllTradeSizes(this.config);

      if (!validationResult.valid) {
logErrorWithTimestamp('❌ CONFIGURATION ERROR: Trade sizes below exchange minimums detected!');
logErrorWithTimestamp('The following symbols have insufficient trade sizes:');

        validationResult.warnings.forEach(warning => {
logErrorWithTimestamp(`  ${warning.symbol}: ${warning.reason}`);
logErrorWithTimestamp(`    Current price: $${warning.currentPrice.toFixed(2)}`);
logErrorWithTimestamp(`    Leverage: ${warning.leverage}x`);
logErrorWithTimestamp(`    MINIMUM REQUIRED: ${warning.minimumRequired.toFixed(2)} USDT`);
        });

logErrorWithTimestamp('\n⚠️  Please update your configuration at http://localhost:3000/config');
logErrorWithTimestamp('The bot will continue but trades for these symbols will be rejected.\n');

        // Store warnings to broadcast to UI
        this.tradeSizeWarnings = validationResult.warnings;
      }

      // Security warnings
      const dashboardPassword = this.config.global.server?.dashboardPassword;
      if (!dashboardPassword || dashboardPassword === 'admin') {
logWarnWithTimestamp('⚠️  WARNING: Using default "admin" dashboard password!');
logWarnWithTimestamp('   Please change it at http://localhost:3000/config for better security');
      } else if (dashboardPassword.length < 8) {
logWarnWithTimestamp('⚠️  WARNING: Dashboard password is less than 8 characters');
logWarnWithTimestamp('   Consider using a stronger password for better security');
      }

      // Check if exposing to network with weak password
      const websocketHost = this.config.global.server?.websocketHost;
      const isRemoteAccess = this.config.global.server?.useRemoteWebSocket || websocketHost;
      if (isRemoteAccess && (!dashboardPassword || dashboardPassword === 'admin' || dashboardPassword.length < 8)) {
logWarnWithTimestamp('🔴 SECURITY RISK: Remote access enabled with weak/default password!');
logWarnWithTimestamp('   This could allow unauthorized access to your bot controls');
logWarnWithTimestamp('   Please set a strong password immediately at /config');
      }

      // Initialize threshold monitor with actual config
      thresholdMonitor.updateConfig(this.config);
      logWithTimestamp(`✅ Threshold monitor initialized with ${Object.keys(this.config.symbols).length} symbols`);

      // Initialize Rate Limit Manager with config
      const rateLimitConfig = this.config.global.rateLimit || {};
      const _rateLimitManager = getRateLimitManager(rateLimitConfig);
      logWithTimestamp('✅ Rate limit manager initialized');
      logWithTimestamp(`  Max weight: ${rateLimitConfig.maxRequestWeight || 2400}/min`);
      logWithTimestamp(`  Max orders: ${rateLimitConfig.maxOrderCount || 1200}/min`);
      logWithTimestamp(`  Reserve: ${rateLimitConfig.reservePercent || 30}% for critical operations`);

      // Initialize WebSocket server with configured port
      const wsPort = this.config.global.server?.websocketPort || 8080;
      this.statusBroadcaster = new StatusBroadcaster(wsPort);
      await this.statusBroadcaster.start();
logWithTimestamp(`✅ WebSocket status server started on port ${wsPort}`);

      // Start rate limit monitoring with toast notifications
      startRateLimitLogging(60000); // Log status every minute
      initializeRateLimitToasts(this.statusBroadcaster); // Enable toast notifications
logWithTimestamp('✅ Rate limit monitoring started with toast notifications');
logWithTimestamp(`📝 Paper Mode: ${this.config.global.paperMode ? 'ENABLED' : 'DISABLED'}`);
logWithTimestamp(`💰 Risk Percent: ${this.config.global.riskPercent}%`);
logWithTimestamp(`📊 Symbols configured: ${Object.keys(this.config.symbols).join(', ')}`);

      // Update status broadcaster with config info
      this.statusBroadcaster.updateStatus({
        paperMode: this.config.global.paperMode,
        symbols: Object.keys(this.config.symbols),
      });

      // Broadcast trade size warnings if any
      if (this.tradeSizeWarnings.length > 0) {
        this.statusBroadcaster.broadcastTradeSizeWarnings(this.tradeSizeWarnings);
      }

      // Listen for config updates
      configManager.on('config:updated', (newConfig) => {
        this.handleConfigUpdate(newConfig);
      });

      configManager.on('config:error', (error) => {
logErrorWithTimestamp('❌ Config error:', error.message);
        this.statusBroadcaster.broadcastConfigError(
          'Configuration Error',
          error.message,
          {
            component: 'AsterBot',
            rawError: error,
          }
        );
        this.statusBroadcaster.addError(`Config: ${error.message}`);
      });

      // Check API keys
      const hasValidApiKeys = this.config.api.apiKey && this.config.api.secretKey &&
                              this.config.api.apiKey.length > 0 && this.config.api.secretKey.length > 0;

      if (!hasValidApiKeys) {
logWithTimestamp('⚠️  WARNING: No API keys configured. Running in PAPER MODE only.');
logWithTimestamp('   Please configure your API keys via the web interface at http://localhost:3000/config');
        if (!this.config.global.paperMode) {
logErrorWithTimestamp('❌ Cannot run in LIVE mode without API keys!');
          this.statusBroadcaster.broadcastConfigError(
            'Invalid Configuration',
            'Cannot run in LIVE mode without API keys. Please configure your API keys or enable paper mode.',
            {
              component: 'AsterBot',
            }
          );
          throw new Error('API keys required for live trading');
        }
      }

      if (hasValidApiKeys) {
        // Initialize balance service and set up WebSocket broadcasting
        try {
logWithTimestamp('Initializing balance service...');
          await initializeBalanceService(this.config.api);

          // Connect balance service to status broadcaster
          const balanceService = getBalanceService();
          if (balanceService) {
            balanceService.on('balanceUpdate', (balanceData) => {
logWithTimestamp('[Bot] Broadcasting balance update via WebSocket');
              this.statusBroadcaster.broadcast('balance_update', balanceData);
            });
          }
logWithTimestamp('✅ Balance service initialized and connected to WebSocket broadcaster');
        } catch (error) {
logErrorWithTimestamp('Failed to initialize balance service:', error);
          this.statusBroadcaster.broadcastApiError(
            'Balance Service Initialization Failed',
            'Failed to connect to balance service. Some features may be unavailable.',
            {
              component: 'AsterBot',
              rawError: error,
            }
          );
          // Continue anyway - bot can work without balance service
        }

        // Check and set position mode
        try {
          this.isHedgeMode = await getPositionMode(this.config.api);
logWithTimestamp(`📊 Position Mode: ${this.isHedgeMode ? 'HEDGE MODE' : 'ONE-WAY MODE'}`);

          // If config specifies a position mode and it differs from current, automatically set it
          if (this.config.global.positionMode) {
            const wantHedgeMode = this.config.global.positionMode === 'HEDGE';
            if (wantHedgeMode !== this.isHedgeMode) {
logWithTimestamp(`⚠️  Config specifies ${this.config.global.positionMode} mode but account is in ${this.isHedgeMode ? 'HEDGE' : 'ONE-WAY'} mode`);
logWithTimestamp(`🔄 Automatically changing position mode to match config...`);

              try {
                await setPositionMode(wantHedgeMode, this.config.api);
                this.isHedgeMode = wantHedgeMode;
logWithTimestamp(`✅ Position mode successfully changed to ${this.config.global.positionMode}`);
              } catch (error: any) {
                // Check if error is because of open positions
                if (error?.response?.data?.code === -5021) {
logWithTimestamp(`⚠️  Cannot change position mode: Open positions exist`);
logWithTimestamp(`📊 Using current exchange position mode: ${this.isHedgeMode ? 'HEDGE' : 'ONE-WAY'}`);
                } else if (error?.response?.data?.code === -5020) {
logWithTimestamp(`⚠️  Cannot change position mode: Open orders exist`);
logWithTimestamp(`📊 Using current exchange position mode: ${this.isHedgeMode ? 'HEDGE' : 'ONE-WAY'}`);
                } else {
                  const errorMsg = error?.response?.data?.msg || error?.message || 'Unknown error';
logErrorWithTimestamp('❌ Failed to change position mode:', error?.response?.data || error);
                  this.statusBroadcaster.broadcastConfigError(
                    'Position Mode Change Failed',
                    `Failed to change position mode: ${errorMsg}`,
                    {
                      component: 'AsterBot',
                      errorCode: error?.response?.data?.code,
                      rawError: error?.response?.data || error,
                    }
                  );
logWithTimestamp(`📊 Using current exchange position mode: ${this.isHedgeMode ? 'HEDGE' : 'ONE-WAY'}`);
                }
              }
            }
          }
        } catch (error) {
logErrorWithTimestamp('⚠️  Failed to check position mode, assuming ONE-WAY mode:', error);
          this.statusBroadcaster.broadcastApiError(
            'Position Mode Check Failed',
            'Failed to check position mode from exchange. Assuming ONE-WAY mode.',
            {
              component: 'AsterBot',
              rawError: error,
            }
          );
          this.isHedgeMode = false;
        }

        // Initialize PnL tracking service with balance data
        try {
          const balanceService = getBalanceService();
          if (balanceService) {
            const status = balanceService.getConnectionStatus();
            const currentBalance = balanceService.getCurrentBalance();

            if (status.connected) {
logWithTimestamp('✅ Real-time balance service connected');
logWithTimestamp('[Bot] Balance service status:', {
                connected: status.connected,
                lastUpdate: status.lastUpdate ? new Date(status.lastUpdate).toISOString() : 'never',
                balance: currentBalance
              });
            } else {
logWarnWithTimestamp('⚠️ Balance service initialized but not fully connected:', status.error);
            }

            // Initialize PnL tracking service
            if (currentBalance && currentBalance.totalBalance > 0) {
              pnlService.resetSession(currentBalance.totalBalance);
logWithTimestamp('✅ PnL tracking service initialized with balance:', currentBalance.totalBalance);
            } else {
logWarnWithTimestamp('⚠️ PnL tracking not initialized - no balance data available');
            }
          }
        } catch (error: any) {
logErrorWithTimestamp('⚠️  Balance service failed to start:', error instanceof Error ? error.message : error);
logErrorWithTimestamp('[Bot] Balance service error stack:', error instanceof Error ? error.stack : 'No stack trace');
          this.statusBroadcaster.addError(`Balance Service: ${error instanceof Error ? error.message : 'Unknown error'}`);
          // Continue running bot even if balance service fails
logWithTimestamp('[Bot] Bot will continue without real-time balance updates');
        }

        // Initialize Price Service for real-time mark prices
        try {
          await initializePriceService();
logWithTimestamp('✅ Real-time price service started');

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
logErrorWithTimestamp('⚠️  Price service failed to start:', error.message);
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

logWithTimestamp('✅ VWAP streaming service started');
        } catch (error: any) {
logErrorWithTimestamp('⚠️  VWAP streamer failed to start:', error.message);
          this.statusBroadcaster.addError(`VWAP Streamer: ${error.message}`);
        }
      }

      // Initialize Position Manager
      this.positionManager = new PositionManager(this.config, this.isHedgeMode);

      // Inject status broadcaster for real-time position updates
      this.positionManager.setStatusBroadcaster(this.statusBroadcaster);

      try {
        await this.positionManager.start();
logWithTimestamp('✅ Position Manager started');

        // Subscribe to price updates for all open positions
        const priceService = getPriceService();
        if (priceService && this.positionManager) {
          const positions = this.positionManager.getPositions();
          const positionSymbols = [...new Set(positions.map(p => p.symbol))];

          if (positionSymbols.length > 0) {
            priceService.subscribeToSymbols(positionSymbols);
logWithTimestamp(`📊 Price streaming enabled for open positions: ${positionSymbols.join(', ')}`);
          }
        }
      } catch (error: any) {
logErrorWithTimestamp('⚠️  Position Manager failed to start:', error.message);
        this.statusBroadcaster.addError(`Position Manager: ${error.message}`);
        // Continue running in paper mode without position manager
        if (!this.config.global.paperMode) {
          throw new Error('Cannot run in LIVE mode without Position Manager');
        }
      }

      // Initialize Tranche Manager (if enabled for any symbol)
      const trancheEnabledSymbols = Object.entries(this.config.symbols).filter(
        ([_symbol, config]) => config.enableTrancheManagement
      );

      if (trancheEnabledSymbols.length > 0) {
        try {
          const { initializeTrancheManager } = await import('../lib/services/trancheManager');
          const trancheManager = initializeTrancheManager(this.config);
          await trancheManager.initialize();

          // Connect tranche events to status broadcaster
          trancheManager.on('trancheCreated', (tranche) => {
            this.statusBroadcaster.broadcastTrancheCreated({
              trancheId: tranche.id,
              symbol: tranche.symbol,
              side: tranche.side,
              entryPrice: tranche.entryPrice,
              quantity: tranche.quantity,
              marginUsed: tranche.marginUsed,
              leverage: tranche.leverage,
              tpPrice: tranche.tpPrice,
              slPrice: tranche.slPrice,
            });
            logWithTimestamp(`📊 Tranche created: ${tranche.id.substring(0, 8)} for ${tranche.symbol} ${tranche.side}`);
          });

          trancheManager.on('trancheIsolated', (tranche) => {
            const symbolConfig = this.config?.symbols[tranche.symbol];
            const currentPrice = tranche.isolationPrice || 0;
            const pnlPercent = tranche.side === 'LONG'
              ? ((currentPrice - tranche.entryPrice) / tranche.entryPrice) * 100
              : ((tranche.entryPrice - currentPrice) / tranche.entryPrice) * 100;

            this.statusBroadcaster.broadcastTrancheIsolated({
              trancheId: tranche.id,
              symbol: tranche.symbol,
              side: tranche.side,
              entryPrice: tranche.entryPrice,
              currentPrice,
              unrealizedPnl: tranche.unrealizedPnl,
              pnlPercent,
              isolationThreshold: symbolConfig?.trancheIsolationThreshold || 5,
            });
            logWithTimestamp(`⚠️  Tranche isolated: ${tranche.id.substring(0, 8)} for ${tranche.symbol} (${pnlPercent.toFixed(2)}% loss)`);
          });

          trancheManager.on('trancheClosed', (tranche) => {
            this.statusBroadcaster.broadcastTrancheClosed({
              trancheId: tranche.id,
              symbol: tranche.symbol,
              side: tranche.side,
              entryPrice: tranche.entryPrice,
              exitPrice: tranche.exitPrice || 0,
              quantity: tranche.quantity,
              realizedPnl: tranche.realizedPnl,
              closedFully: tranche.status === 'closed',
              orderId: tranche.exitOrderId,
            });
            logWithTimestamp(`💰 Tranche closed: ${tranche.id.substring(0, 8)} for ${tranche.symbol} (PnL: $${tranche.realizedPnl.toFixed(2)})`);
          });

          trancheManager.on('tranchePartialClose', (tranche) => {
            this.statusBroadcaster.broadcastTrancheClosed({
              trancheId: tranche.id,
              symbol: tranche.symbol,
              side: tranche.side,
              entryPrice: tranche.entryPrice,
              exitPrice: 0, // Partial close - exit price varies
              quantity: tranche.quantity,
              realizedPnl: tranche.realizedPnl,
              closedFully: false,
            });
            logWithTimestamp(`📉 Tranche partially closed: ${tranche.id.substring(0, 8)} for ${tranche.symbol}`);
          });

          // Start periodic isolation monitoring
          trancheManager.startIsolationMonitoring(10000); // Check every 10 seconds

          logWithTimestamp(`✅ Tranche Manager initialized for ${trancheEnabledSymbols.length} symbol(s): ${trancheEnabledSymbols.map(([s]) => s).join(', ')}`);
        } catch (error: any) {
          logErrorWithTimestamp('⚠️  Tranche Manager failed to start:', error.message);
          this.statusBroadcaster.addError(`Tranche Manager: ${error.message}`);
          // Continue without tranche management
        }
      } else {
        logWithTimestamp('ℹ️  Tranche Management disabled for all symbols');
      }

      // Initialize Protective Order Service (if enabled for any symbol)
      const protectiveEnabledSymbols = Object.entries(this.config.symbols).filter(
        ([_symbol, config]) => config.enableProtectiveOrders
      );

      if (protectiveEnabledSymbols.length > 0) {
        try {
          const { initializeProtectiveOrderService } = await import('../lib/services/protectiveOrderService');
          const protectiveOrderService = initializeProtectiveOrderService(this.config);
          protectiveOrderService.start();

          logWithTimestamp(`✅ Protective Order Service initialized for ${protectiveEnabledSymbols.length} symbol(s): ${protectiveEnabledSymbols.map(([s]) => s).join(', ')}`);
        } catch (error: any) {
          logErrorWithTimestamp('⚠️  Protective Order Service failed to start:', error.message);
          this.statusBroadcaster.addError(`Protective Order Service: ${error.message}`);
          // Continue without protective orders
        }
      } else {
        logWithTimestamp('ℹ️  Protective Orders disabled for all symbols');
      }

      // Initialize Hunter (or reuse existing instance to prevent duplicate listeners)
      if (!this.hunter) {
        this.hunter = new Hunter(this.config, this.isHedgeMode);
      } else {
        // Remove all old listeners before re-attaching to prevent duplicates
        this.hunter.removeAllListeners();
        console.log('[Bot] Removed all old hunter event listeners to prevent duplicates');
      }

      // Inject status broadcaster for order events
      this.hunter.setStatusBroadcaster(this.statusBroadcaster);

      // Inject position tracker for position limit checks
      if (this.positionManager) {
        this.hunter.setPositionTracker(this.positionManager);
      }

      // Connect hunter events to position manager and status broadcaster
      this.hunter.on('liquidationDetected', (liquidationEvent: any) => {
        console.log(`[Bot] liquidationDetected event received for ${liquidationEvent.symbol}`);
        // Broadcast to UI and log activity (don't log to console - already logged in hunter.ts)
        this.statusBroadcaster.broadcastLiquidation(liquidationEvent);
        this.statusBroadcaster.logActivity(`Liquidation: ${liquidationEvent.symbol} ${liquidationEvent.side} ${liquidationEvent.quantity}`);
      });

      this.hunter.on('tradeOpportunity', (data: any) => {
        logWithTimestamp(`🎯 Trade opportunity: ${data.symbol} ${data.side} (${data.reason})`);
        this.statusBroadcaster.broadcastTradeOpportunity(data);
        this.statusBroadcaster.logActivity(`Opportunity: ${data.symbol} ${data.side} - ${data.reason}`);
      });

      this.hunter.on('tradeBlocked', (data: any) => {
        logWithTimestamp(`🚫 Trade blocked: ${data.symbol} ${data.side} - ${data.reason}`);
        this.statusBroadcaster.broadcastTradeBlocked(data);
        this.statusBroadcaster.logActivity(`Blocked: ${data.symbol} ${data.side} - ${data.blockType}`);
      });

      // Remove old threshold monitor listeners to prevent duplicates
      thresholdMonitor.removeAllListeners('thresholdUpdate');
      
      // Listen for threshold updates and broadcast to UI
      thresholdMonitor.on('thresholdUpdate', (thresholdUpdate: any) => {
        this.statusBroadcaster.broadcastThresholdUpdate(thresholdUpdate);
      });

      this.hunter.on('positionOpened', (data: any) => {
        logWithTimestamp(`📈 Position opened: ${data.symbol} ${data.side} qty=${data.quantity}`);
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
logWithTimestamp(`📊 Added price streaming for new position: ${data.symbol}`);
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
logErrorWithTimestamp('❌ Hunter error:', error);
        this.statusBroadcaster.addError(error.toString());
      });

      await this.hunter.start();
logWithTimestamp('✅ Liquidation Hunter started');

      // Start the cleanup scheduler for liquidation database
      const dbConfig = this.config.global.liquidationDatabase;
      const retentionDays = dbConfig?.retentionDays ?? 90;
      const cleanupHours = dbConfig?.cleanupIntervalHours ?? 24;
      
      // Create a new scheduler instance with config values
      const { CleanupScheduler } = await import('../lib/services/cleanupScheduler');
      this.cleanupScheduler = new CleanupScheduler(cleanupHours, retentionDays);
      this.cleanupScheduler.start();
      
      if (retentionDays > 0) {
        logWithTimestamp(`✅ Database cleanup scheduler started (${retentionDays}-day retention, runs every ${cleanupHours}h)`);
      } else {
        logWithTimestamp('✅ Database cleanup scheduler started (retention disabled)');
      }

      this.isRunning = true;
      this.statusBroadcaster.setRunning(true);
logWithTimestamp('🟢 Bot is now running. Press Ctrl+C to stop.');

      // Handle graceful shutdown with enhanced signal handling
      const shutdownHandler = async (signal: string) => {
logWithTimestamp(`\n📡 Received ${signal}`);
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
logWithTimestamp(`Process exiting with code ${code}`);
        // Synchronous cleanup only
        killAllProcesses();
      });

      // Handle uncaught errors
      process.on('uncaughtException', (error) => {
logErrorWithTimestamp('❌ Uncaught exception:', error);
        this.stop().catch(console.error);
      });

      process.on('unhandledRejection', (reason, promise) => {
logErrorWithTimestamp('❌ Unhandled rejection at:', promise, 'reason:', reason);
        this.stop().catch(console.error);
      });

    } catch (error) {
logErrorWithTimestamp('❌ Failed to start bot:', error);
      process.exit(1);
    }
  }

  private async handleConfigUpdate(newConfig: Config): Promise<void> {
logWithTimestamp('🔄 Applying config update...');

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
logWithTimestamp(`⚠️  Paper Mode changed: ${oldConfig.global.paperMode} → ${newConfig.global.paperMode}`);
        this.statusBroadcaster.logActivity(`Config: Paper Mode ${newConfig.global.paperMode ? 'ENABLED' : 'DISABLED'}`);
      }

      // Update Hunter with new config
      if (this.hunter) {
        this.hunter.updateConfig(newConfig);
logWithTimestamp('✅ Hunter config updated');
      }

      // Update threshold monitor with new config
      thresholdMonitor.updateConfig(newConfig);
logWithTimestamp('✅ Threshold monitor config updated');

      // Update PositionManager with new config
      if (this.positionManager) {
        this.positionManager.updateConfig(newConfig);
logWithTimestamp('✅ Position Manager config updated');
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
logWithTimestamp('✅ VWAP symbols updated');
        }
      }

      // Broadcast config update to web UI
      this.statusBroadcaster.broadcast('config_updated', {
        timestamp: new Date(),
        config: newConfig,
      });

logWithTimestamp('✅ Config update applied successfully');
      this.statusBroadcaster.logActivity('Config reloaded from file');
    } catch (error) {
logErrorWithTimestamp('❌ Failed to apply config update:', error);
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

logWithTimestamp('\n🛑 Stopping bot...');
    this.isRunning = false;
    this.statusBroadcaster.setRunning(false);

    // Create a timeout to force exit if graceful shutdown takes too long
    const forceExitTimeout = setTimeout(() => {
logErrorWithTimestamp('⚠️  Graceful shutdown timeout, forcing exit...');
      process.exit(1);
    }, 5000); // 5 second timeout

    try {
      if (this.hunter) {
        this.hunter.stop();
logWithTimestamp('✅ Hunter stopped');
      }

      if (this.positionManager) {
        this.positionManager.stop();
logWithTimestamp('✅ Position Manager stopped');
      }

      // Stop other services
      vwapStreamer.stop();
logWithTimestamp('✅ VWAP streamer stopped');

      await stopBalanceService().catch(err =>
logErrorWithTimestamp('⚠️  Balance service stop error:', err)
      );
logWithTimestamp('✅ Balance service stopped');

      stopPriceService();
logWithTimestamp('✅ Price service stopped');

      if (this.cleanupScheduler) {
        this.cleanupScheduler.stop();
      }
logWithTimestamp('✅ Cleanup scheduler stopped');

      configManager.stop();
logWithTimestamp('✅ Config manager stopped');

      this.statusBroadcaster.stop();
logWithTimestamp('✅ WebSocket server stopped');

      clearTimeout(forceExitTimeout);
logWithTimestamp('👋 Bot stopped successfully');
      process.exit(0);
    } catch (error) {
      clearTimeout(forceExitTimeout);
logErrorWithTimestamp('❌ Error while stopping:', error);
      process.exit(1);
    }
  }

  async status(): Promise<void> {
    if (!this.isRunning) {
logWithTimestamp('⚠️  Bot is not running');
      return;
    }

logWithTimestamp('🟢 Bot Status:');
logWithTimestamp(`  Running: ${this.isRunning}`);
logWithTimestamp(`  Paper Mode: ${this.config?.global.paperMode}`);
logWithTimestamp(`  Symbols: ${this.config ? Object.keys(this.config.symbols).join(', ') : 'N/A'}`);
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
logWithTimestamp('Usage: node src/bot/index.js [start|status]');
logWithTimestamp('  start  - Start the bot');
logWithTimestamp('  status - Show bot status');
      process.exit(1);
  }
}

// Run if this is the main module
if (require.main === module) {
  main().catch((error) => {
logErrorWithTimestamp('Fatal error:', error);
    process.exit(1);
  });
}

export { AsterBot };
