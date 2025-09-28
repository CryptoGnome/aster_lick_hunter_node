import { useState, useEffect, useRef, useCallback } from 'react';
import { useWebSocketConfig } from '@/providers/WebSocketProvider';

export interface BotStatus {
  isRunning: boolean;
  paperMode: boolean;
  uptime: number;
  startTime: Date | null;
  lastActivity: Date | null;
  symbols: string[];
  positionsOpen: number;
  totalPnL: number;
  errors: string[];
}

export interface UseBotStatusReturn {
  status: BotStatus | null;
  isConnected: boolean;
  lastMessage: string | null;
  reconnect: () => void;
}

export function useBotStatus(customUrl?: string): UseBotStatusReturn {
  const { wsUrl } = useWebSocketConfig();
  const url = customUrl || wsUrl;
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);

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
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);

        // Setup ping interval for keep-alive
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 30000); // Ping every 30 seconds
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          switch (message.type) {
            case 'status':
              setStatus(message.data);
              break;
            case 'activity':
              setLastMessage(message.data.message);
              setStatus(prev => prev ? {
                ...prev,
                lastActivity: new Date(message.data.timestamp),
              } : null);
              break;
            case 'mark_price_update':
            case 'balance_update':
            case 'position_update':
            case 'liquidation':
            case 'trade_opportunity':
              // These messages are handled by other components, ignore silently
              break;
            default:
              // Only log truly unknown message types, not common ones
              if (!['ping', 'pong'].includes(message.type)) {
                console.log('Unknown message type:', message.type);
              }
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      ws.onclose = () => {
        console.log('Disconnected from bot WebSocket');
        setIsConnected(false);
        setStatus(null);
        wsRef.current = null;

        // Clear ping interval
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }

        // Only attempt to reconnect if component is still mounted
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
          console.log('Bot WebSocket: Connection failed');
        }
        setIsConnected(false);
      };

    } catch (error) {
      console.error('Failed to connect to bot WebSocket:', error);
      setIsConnected(false);

      // Retry connection after 3 seconds if still mounted
      if (!reconnectTimeoutRef.current) {
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          connect();
        }, 3000);
      }
    }
  }, [url]);

  const reconnect = useCallback(() => {
    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
    }
    // Small delay to ensure cleanup
    setTimeout(() => {
      connect();
    }, 100);
  }, [connect]);

  useEffect(() => {
    // Small delay to prevent race conditions during navigation
    const connectTimeout = setTimeout(() => {
      connect();
    }, 100);

    // Cleanup on unmount
    return () => {
      clearTimeout(connectTimeout);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      if (wsRef.current) {
        const ws = wsRef.current;
        wsRef.current = null;
        ws.close();
      }
    };
  }, [url]);  

  return {
    status,
    isConnected,
    lastMessage,
    reconnect,
  };
}

// Utility function to format uptime
export function formatUptime(ms: number): string {
  if (ms === 0) return 'N/A';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}