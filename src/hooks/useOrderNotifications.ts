import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import websocketService from '@/lib/services/websocketService';

interface OrderEvent {
  type: string;
  data: any;
}

export function useOrderNotifications() {
  // Use a ref to track processed messages and prevent duplicates
  const processedMessages = useRef<Map<string, number>>(new Map());
  const cleanupTimerRef = useRef<NodeJS.Timeout | null>(null);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: price < 1 ? 8 : 2,
    }).format(price);
  };

  const formatQuantity = (qty: number) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: qty < 1 ? 8 : 3,
    }).format(qty);
  };

  const formatPnL = (pnl: number | undefined) => {
    if (pnl === undefined || pnl === null || isNaN(pnl)) {
      return '';
    }
    const formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(Math.abs(pnl));
    return pnl >= 0 ? `+${formatted}` : `-${formatted.replace('-', '')}`;
  };

  useEffect(() => {
    // Store ref value to avoid stale closure in cleanup
    const messagesMap = processedMessages.current;

    // Clean up old processed messages periodically
    const startCleanupTimer = () => {
      cleanupTimerRef.current = setInterval(() => {
        const now = Date.now();
        const expiredKeys: string[] = [];
        messagesMap.forEach((timestamp, key) => {
          // Remove messages older than 5 seconds
          if (now - timestamp > 5000) {
            expiredKeys.push(key);
          }
        });
        expiredKeys.forEach(key => messagesMap.delete(key));
      }, 10000); // Clean up every 10 seconds
    };

    startCleanupTimer();

    // Add WebSocket message handler
    const cleanup = websocketService.addMessageHandler((message: OrderEvent) => {
      try {
        // Only process order-related messages
        if (!message.type || typeof message.type !== 'string') {
          return;
        }

        // Create a unique key for deduplication
        const shortKey = `${message.type}-${message.data?.symbol || ''}-${message.data?.orderId || ''}`;

        // Check if we've recently processed this message
        if (processedMessages.current.has(shortKey)) {
          const lastProcessed = processedMessages.current.get(shortKey) || 0;
          if (Date.now() - lastProcessed < 1000) { // Skip if processed within last second
            return;
          }
        }

        // Mark as processed
        processedMessages.current.set(shortKey, Date.now());

        switch (message.type) {
            case 'order_placed': {
              const { symbol, side, orderType, quantity, price } = message.data;
              const priceStr = price ? ` at $${formatPrice(price)}` : '';
              const orderTypeStr = orderType === 'MARKET' ? 'Market' : 'Limit';

              toast.info(
                `📊 ${side} ${orderTypeStr} order placed for ${symbol}`,
                {
                  description: `${formatQuantity(quantity)} units${priceStr}`,
                  duration: 4000,
                }
              );
              break;
            }

            case 'order_filled': {
              const { symbol, side, executedQty, price, orderType, pnl } = message.data;
              const priceStr = price ? ` at $${formatPrice(price)}` : '';
              const formattedPnl = formatPnL(pnl);
              const pnlStr = formattedPnl ? ` • PnL: ${formattedPnl}` : '';

              if (orderType === 'STOP_MARKET' || orderType === 'STOP') {
                toast.warning(
                  `🛑 Stop loss triggered for ${symbol}`,
                  {
                    description: `${formatQuantity(executedQty)} units${priceStr}${pnlStr}`,
                    duration: 5000,
                  }
                );
              } else if (orderType === 'TAKE_PROFIT_MARKET' || orderType === 'TAKE_PROFIT') {
                const toastType = pnl && pnl > 0 ? 'success' : pnl && pnl < 0 ? 'warning' : 'success';
                toast[toastType](
                  `🎯 Take profit hit for ${symbol}`,
                  {
                    description: `${formatQuantity(executedQty)} units${priceStr}${pnlStr}`,
                    duration: 5000,
                  }
                );
              } else {
                toast.success(
                  `✅ ${side} order filled for ${symbol}`,
                  {
                    description: `${formatQuantity(executedQty)} units${priceStr}`,
                    duration: 4000,
                  }
                );
              }
              break;
            }

            case 'sl_placed': {
              const { symbol, price, quantity } = message.data;
              toast.info(
                `🛡️ Stop loss set for ${symbol}`,
                {
                  description: `${formatQuantity(quantity)} units at $${formatPrice(price)}`,
                  duration: 3000,
                }
              );
              break;
            }

            case 'tp_placed': {
              const { symbol, price, quantity } = message.data;
              toast.info(
                `🎯 Take profit set for ${symbol}`,
                {
                  description: `${formatQuantity(quantity)} units at $${formatPrice(price)}`,
                  duration: 3000,
                }
              );
              break;
            }

            case 'position_closed': {
              const { symbol, side, quantity, pnl } = message.data;
              const formattedPnl = formatPnL(pnl);
              const pnlStr = formattedPnl ? ` • PnL: ${formattedPnl}` : '';
              const variant = pnl && pnl >= 0 ? 'success' : pnl && pnl < 0 ? 'warning' : 'success';

              toast[variant](
                `💰 Position closed: ${symbol}`,
                {
                  description: `${side} ${formatQuantity(quantity)} units${pnlStr}`,
                  duration: 6000,
                }
              );
              break;
            }

            case 'order_cancelled': {
              const { symbol, side, orderType, reason } = message.data;
              toast.warning(
                `❌ Order cancelled for ${symbol}`,
                {
                  description: reason || `${side} ${orderType} order cancelled`,
                  duration: 3000,
                }
              );
              break;
            }

            case 'order_failed': {
              const { symbol, side, reason } = message.data;
              toast.error(
                `⚠️ Order failed for ${symbol}`,
                {
                  description: reason || `Failed to place ${side} order`,
                  duration: 5000,
                }
              );
              break;
            }

            case 'trade_opportunity': {
              const { symbol, side, reason, confidence } = message.data;
              if (confidence > 80) {
                toast.info(
                  `🎯 High confidence opportunity: ${symbol}`,
                  {
                    description: `${side} signal - ${reason}`,
                    duration: 3000,
                  }
                );
              }
              break;
            }

            case 'trade_blocked': {
              const { side, reason, blockType } = message.data;
              const description = blockType === 'VWAP_FILTER'
                ? reason
                : `${side} trade blocked - ${reason}`;

              toast.warning(
                `🚫 VWAP Protection Active`,
                {
                  description: description,
                  duration: 4000,
                  style: {
                    background: 'rgb(251 146 60)', // orange-400
                    color: 'white',
                    border: '1px solid rgb(254 215 170)' // orange-200
                  }
                }
              );
              break;
            }

          default:
            break;
        }
      } catch (error) {
        console.error('Failed to process order notification:', error);
      }
    });

    return () => {
      // Clean up message handler
      cleanup();

      // Clear cleanup timer
      if (cleanupTimerRef.current) {
        clearInterval(cleanupTimerRef.current);
        cleanupTimerRef.current = null;
      }

      // Clear processed messages using the stored reference
      messagesMap.clear();
    };
  }, []); // No dependencies needed since websocketService is a singleton
}