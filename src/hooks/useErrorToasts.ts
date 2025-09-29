import { useEffect, useRef, useCallback } from 'react';
import {
  showWebSocketError,
  showApiError,
  showTradingError,
  showConfigError,
  showErrorToast,
  ErrorDetails
} from '@/lib/utils/errorToast';
import { useWebSocketConfig } from '@/providers/WebSocketProvider';

interface ErrorEvent {
  type: 'websocket_error' | 'api_error' | 'trading_error' | 'config_error' | 'general_error';
  data: {
    title: string;
    message: string;
    details?: ErrorDetails;
  };
}

export function useErrorToasts(customWsUrl?: string) {
  const { wsUrl: defaultWsUrl } = useWebSocketConfig();
  const wsUrl = customWsUrl || defaultWsUrl;
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasShownConnectionError = useRef(false);

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

      ws.onopen = () => {
        hasShownConnectionError.current = false;
      };

      ws.onmessage = (event) => {
        try {
          const message: ErrorEvent = JSON.parse(event.data);

          // Handle error events
          if (message.type.endsWith('_error')) {
            const { title, message: errorMessage, details } = message.data;

            switch (message.type) {
              case 'websocket_error':
                showWebSocketError(title, errorMessage, details);
                break;
              case 'api_error':
                showApiError(title, errorMessage, details);
                break;
              case 'trading_error':
                showTradingError(title, errorMessage, details);
                break;
              case 'config_error':
                showConfigError(title, errorMessage, details);
                break;
              case 'general_error':
                showErrorToast({
                  type: 'general',
                  title,
                  message: errorMessage,
                  details,
                });
                break;
            }
          }
        } catch (error) {
          console.error('Failed to parse error notification:', error);
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
        // Show connection error only once per connection attempt
        if (!hasShownConnectionError.current && ws.readyState === WebSocket.CONNECTING) {
          hasShownConnectionError.current = true;
          showWebSocketError(
            'Connection Failed',
            'Unable to connect to bot service. Make sure the bot is running.',
            {
              component: 'ErrorToastService',
              timestamp: new Date().toISOString(),
            }
          );
        }
      };

    } catch (error) {
      console.error('Failed to connect error toast service:', error);
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