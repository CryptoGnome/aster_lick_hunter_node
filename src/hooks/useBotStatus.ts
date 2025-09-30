import { useState, useEffect, useCallback } from 'react';
import websocketService from '@/lib/services/websocketService';

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

export function useBotStatus(): UseBotStatusReturn {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  const reconnect = useCallback(() => {
    // The websocketService handles reconnection internally
    console.log('Manual reconnect requested');
  }, []);

  useEffect(() => {
    // Add message handler for bot status updates
    const cleanup = websocketService.addMessageHandler((message) => {
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
        case 'vwap_update':
        case 'vwap_bulk':
          // These messages are handled by other components, ignore silently
          break;
        default:
          // Only log truly unknown message types, not common ones
          if (!['ping', 'pong'].includes(message.type)) {
            console.log('Unknown message type:', message.type);
          }
      }
    });

    // Add connection listener to track connection state
    const connectionCleanup = websocketService.addConnectionListener((connected) => {
      setIsConnected(connected);
      if (!connected) {
        setStatus(null);
      }
    });

    return () => {
      cleanup();
      connectionCleanup();
    };
  }, []);

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