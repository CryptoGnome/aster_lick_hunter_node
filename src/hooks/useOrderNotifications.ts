import { useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { useWebSocketConfig } from '@/providers/WebSocketProvider';

interface OrderEvent {
  type: string;
  data: any;
}

export function useOrderNotifications(customWsUrl?: string) {
  const { wsUrl: defaultWsUrl } = useWebSocketConfig();
  const wsUrl = customWsUrl || defaultWsUrl;
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

  const connect = useCallback(() => {
    // Prevent multiple connection attempts
    if (wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    // Clear any existing reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const message: OrderEvent = JSON.parse(event.data);

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
          console.error('Failed to parse order notification:', error);
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        // Only reconnect if the component is still mounted
        if (!reconnectTimeoutRef.current) {
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null;
            connect();
          }, 3000);
        }
      };

      ws.onerror = () => {
        // WebSocket errors don't provide useful information, just log connection issue
        if (ws.readyState === WebSocket.CONNECTING) {
          console.log('Order notifications WebSocket: Connection failed');
        }
      };

    } catch (error) {
      console.error('Failed to connect order notifications:', error);
      // Only reconnect if component is still mounted
      if (!reconnectTimeoutRef.current) {
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          connect();
        }, 3000);
      }
    }
  }, [wsUrl]);

  useEffect(() => {
    // Small delay to prevent race conditions during navigation
    const connectTimeout = setTimeout(() => {
      connect();
    }, 100);

    return () => {
      clearTimeout(connectTimeout);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        const ws = wsRef.current;
        wsRef.current = null;
        ws.close();
      }
    };
  }, [wsUrl]);  
}