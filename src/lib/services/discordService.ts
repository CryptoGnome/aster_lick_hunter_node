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
      } catch (error) {
        console.log('🔕 Discord notifications disabled (invalid webhook URL)');
        this.isEnabled = false;
      }
    } else {
      console.log('🔕 Discord notifications disabled (no webhook URL)');
    }
  }

  private async sendWebhook(embed: any): Promise<void> {
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
          embeds: [embed],
        }),
      });

      if (!response.ok) {
        throw new Error(`Discord webhook failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error('Failed to send Discord notification:', error);
      // Don't throw - we don't want Discord failures to break the bot
    }
  }

  private createPositionOpenedEmbed(notification: DiscordNotification): any {
    const { symbol, side, quantity, price, timestamp } = notification;
    const sideEmoji = side === 'LONG' ? '📈' : '📉';
    const sideColor = side === 'LONG' ? 0x00ff00 : 0xff0000; // Green for long, red for short

    return {
      title: `${sideEmoji} Position Opened`,
      color: sideColor,
      fields: [
        {
          name: 'Symbol',
          value: `\`${symbol}\``,
          inline: true,
        },
        {
          name: 'Side',
          value: `**${side}**`,
          inline: true,
        },
        {
          name: 'Quantity',
          value: `\`${quantity}\``,
          inline: true,
        },
        {
          name: 'Entry Price',
          value: `\`$${price.toFixed(4)}\``,
          inline: true,
        },
        {
          name: 'Time',
          value: `<t:${Math.floor(timestamp.getTime() / 1000)}:R>`,
          inline: true,
        },
      ],
      footer: {
        text: 'Aster Liquidation Hunter Bot',
      },
      timestamp: timestamp.toISOString(),
    };
  }

  private createPositionClosedEmbed(notification: DiscordNotification): any {
    const { symbol, side, quantity, price, pnl, reason, timestamp } = notification;
    const sideEmoji = side === 'LONG' ? '📈' : '📉';
    const pnlEmoji = pnl && pnl > 0 ? '💰' : pnl && pnl < 0 ? '💸' : '⚖️';
    const pnlColor = pnl && pnl > 0 ? 0x00ff00 : pnl && pnl < 0 ? 0xff0000 : 0x808080;

    const fields = [
      {
        name: 'Symbol',
        value: `\`${symbol}\``,
        inline: true,
      },
      {
        name: 'Side',
        value: `**${side}**`,
        inline: true,
      },
      {
        name: 'Quantity',
        value: `\`${quantity}\``,
        inline: true,
      },
      {
        name: 'Exit Price',
        value: `\`$${price.toFixed(4)}\``,
        inline: true,
      },
      {
        name: 'Time',
        value: `<t:${Math.floor(timestamp.getTime() / 1000)}:R>`,
        inline: true,
      },
    ];

    if (pnl !== undefined) {
      fields.push({
        name: 'PnL',
        value: `${pnlEmoji} \`$${pnl.toFixed(2)}\``,
        inline: true,
      });
    }

    if (reason) {
      fields.push({
        name: 'Reason',
        value: `\`${reason}\``,
        inline: false,
      });
    }

    return {
      title: `${sideEmoji} Position Closed`,
      color: pnlColor,
      fields,
      footer: {
        text: 'Aster Liquidation Hunter Bot',
      },
      timestamp: timestamp.toISOString(),
    };
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

    const notification: DiscordNotification = {
      type: 'position_opened',
      symbol: data.symbol,
      side: data.side,
      quantity: data.quantity,
      price: data.price,
      timestamp: new Date(),
    };

    const embed = this.createPositionOpenedEmbed(notification);
    await this.sendWebhook(embed);
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

    const embed = this.createPositionClosedEmbed(notification);
    await this.sendWebhook(embed);
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
