import { DiscordConfig } from '../types';

export interface DiscordNotification {
  type: 'position_opened' | 'position_closed';
  symbol: string;
  side: 'LONG' | 'SHORT';
  quantity: number;
  price: number;
  pnl?: number;
  reason?: string;
  timestamp: Date;
}

export class DiscordService {
  private config: DiscordConfig | undefined;
  private isEnabled: boolean = false;

  constructor() {
    // Service will be initialized when config is loaded
  }

  initialize(config: DiscordConfig | undefined): void {
    this.config = config;

    // Check if webhook URL is provided and valid
    const webhookUrl = config?.webhookUrl?.trim();
    this.isEnabled = !!(webhookUrl && webhookUrl !== '');

    if (this.isEnabled) {
      // Validate URL format
      try {
        new URL(webhookUrl!);
        console.log('🔔 Discord notifications enabled');
      } catch (_error) {
        console.log('🔕 Discord notifications disabled (invalid webhook URL)');
        this.isEnabled = false;
      }
    } else {
      console.log('🔕 Discord notifications disabled (no webhook URL)');
    }
  }

  private async sendWebhook(message: string): Promise<void> {
    if (!this.isEnabled || !this.config?.webhookUrl) {
      return;
    }

    try {
      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: message,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unable to read error response');
        console.error('Discord webhook failed:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });
        throw new Error(`Discord webhook failed: ${response.status} ${response.statusText} - ${errorText}`);
      }
    } catch (error) {
      console.error('Failed to send Discord notification:', error instanceof Error ? error.message : String(error));
      // Don't throw - we don't want Discord failures to break the bot
    }
  }

  private createPositionOpenedMessage(notification: DiscordNotification): string {
    const { symbol, side, quantity, price } = notification;
    // LONG positions (buying) = green, SHORT positions (selling) = red
    const colorEmoji = side === 'LONG' ? '🟢' : '🔴';

    return `[OPEN]  ${colorEmoji} ${symbol} ${side} | Qty: ${quantity} | Entry: $${price.toFixed(4)}`;
  }

  private createPositionClosedMessage(notification: DiscordNotification): string {
    const { symbol, side, quantity, price, pnl } = notification;
    const colorEmoji = pnl && pnl > 0 ? '✅' : pnl && pnl < 0 ? '❌' : '⚪';

    let message = `[CLOSE] ${colorEmoji} ${symbol} ${side} | Qty: ${quantity} | Exit: $${price.toFixed(4)}`;

    if (pnl !== undefined) {
      const pnlSign = pnl >= 0 ? '+' : '';
      message += ` | PnL: ${pnlSign}$${pnl.toFixed(2)}`;
    }

    return message;
  }

  // Méthode publique pour créer des messages de test
  static createTestMessage(type: 'open' | 'close'): string {
    if (type === 'open') {
      return `[OPEN]  🟢 BTCUSDT LONG | Qty: 0.001 | Entry: $45,000.00`;
    } else {
      return `[CLOSE] ✅ BTCUSDT LONG | Qty: 0.001 | Exit: $46,500.00 | PnL: +$1.50`;
    }
  }

  async notifyPositionOpened(data: {
    symbol: string;
    side: 'LONG' | 'SHORT';
    quantity: number;
    price: number;
  }): Promise<void> {
    if (!this.config?.notifyOnPositionOpen) {
      return;
    }

    // Validation des données requises
    if (!data.symbol || !data.side || data.quantity === undefined || data.price === undefined) {
      console.error('Discord notification skipped: missing required data for position opened', data);
      return;
    }

    const notification: DiscordNotification = {
      type: 'position_opened',
      symbol: data.symbol,
      side: data.side,
      quantity: data.quantity,
      price: data.price,
      timestamp: new Date(),
    };

    const message = this.createPositionOpenedMessage(notification);
    await this.sendWebhook(message);
  }

  async notifyPositionClosed(data: {
    symbol: string;
    side: 'LONG' | 'SHORT';
    quantity: number;
    price: number;
    pnl?: number;
    reason?: string;
  }): Promise<void> {
    if (!this.config?.notifyOnPositionClose) {
      return;
    }

    // Validation des données requises
    if (!data.symbol || !data.side || data.quantity === undefined || data.price === undefined) {
      console.error('Discord notification skipped: missing required data for position closed', data);
      return;
    }

    // Skip notifications with zero PnL to avoid noise
    if (data.pnl !== undefined && data.pnl === 0) {
      console.log(`Discord notification skipped: PnL is zero for ${data.symbol} ${data.side} (likely noise)`);
      return;
    }

    const notification: DiscordNotification = {
      type: 'position_closed',
      symbol: data.symbol,
      side: data.side,
      quantity: data.quantity,
      price: data.price,
      pnl: data.pnl,
      reason: data.reason,
      timestamp: new Date(),
    };

    const message = this.createPositionClosedMessage(notification);
    await this.sendWebhook(message);
  }

  isNotificationEnabled(type: 'position_opened' | 'position_closed'): boolean {
    if (!this.isEnabled || !this.config) {
      return false;
    }

    return type === 'position_opened'
      ? !!this.config.notifyOnPositionOpen
      : !!this.config.notifyOnPositionClose;
  }
}

// Global singleton instance
export const discordService = new DiscordService();
