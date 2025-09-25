import { useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';

interface OrderEvent {
  type: string;
  data: any;
}

export function useOrderNotifications(wsUrl: string = 'ws://localhost:8081') {
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

  const formatPnL = (pnl: number) => {
    const formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(Math.abs(pnl));
    return pnl >= 0 ? `+${formatted}` : `-${formatted.replace('-', '')}`;
  };

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
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
              const { symbol, side, executedQty, price, orderType } = message.data;
              const priceStr = price ? ` at $${formatPrice(price)}` : '';

              if (orderType === 'STOP_MARKET' || orderType === 'STOP') {
                toast.warning(
                  `🛑 Stop loss triggered for ${symbol}`,
                  {
                    description: `${formatQuantity(executedQty)} units${priceStr}`,
                    duration: 5000,
                  }
                );
              } else if (orderType === 'TAKE_PROFIT_MARKET' || orderType === 'TAKE_PROFIT') {
                toast.success(
                  `🎯 Take profit hit for ${symbol}`,
                  {
                    description: `${formatQuantity(executedQty)} units${priceStr}`,
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
              const pnlStr = pnl !== undefined ? ` • PnL: ${formatPnL(pnl)}` : '';
              const variant = pnl >= 0 ? 'success' : 'warning';

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

            default:
              break;
          }
        } catch (error) {
          console.error('Failed to parse order notification:', error);
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 3000);
      };

      ws.onerror = (error) => {
        console.error('Order notifications WebSocket error:', error);
      };

    } catch (error) {
      console.error('Failed to connect order notifications:', error);
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 3000);
    }
  }, [wsUrl]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [wsUrl]); // eslint-disable-line react-hooks/exhaustive-deps
}