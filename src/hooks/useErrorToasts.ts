import { useEffect, useRef } from 'react';
import {
  showWebSocketError,
  showApiError,
  showTradingError,
  showConfigError,
  showErrorToast,
  ErrorDetails
} from '@/lib/utils/errorToast';
import websocketService from '@/lib/services/websocketService';

interface ErrorEvent {
  type: string;
  data: {
    title: string;
    message: string;
    details?: ErrorDetails;
  };
}

export function useErrorToasts() {
  // Use a ref to track processed messages and prevent duplicates
  const processedErrors = useRef<Map<string, number>>(new Map());
  const cleanupTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Store ref value to avoid stale closure in cleanup
    const errorsMap = processedErrors.current;

    // Clean up old processed errors periodically
    const startCleanupTimer = () => {
      cleanupTimerRef.current = setInterval(() => {
        const now = Date.now();
        const expiredKeys: string[] = [];
        errorsMap.forEach((timestamp, key) => {
          // Remove errors older than 10 seconds
          if (now - timestamp > 10000) {
            expiredKeys.push(key);
          }
        });
        expiredKeys.forEach(key => errorsMap.delete(key));
      }, 15000); // Clean up every 15 seconds
    };

    startCleanupTimer();

    // Add WebSocket message handler
    const cleanup = websocketService.addMessageHandler((message: ErrorEvent) => {
      try {
        // Only process error messages
        if (!message.type || !message.type.endsWith('_error')) {
          return;
        }

        const { title, message: errorMessage, details } = message.data || {};

        // Create a unique key for deduplication
        const errorKey = `${message.type}-${title}-${errorMessage}`;

        // Check if we've recently processed this error
        if (processedErrors.current.has(errorKey)) {
          const lastProcessed = processedErrors.current.get(errorKey) || 0;
          if (Date.now() - lastProcessed < 2000) { // Skip if processed within last 2 seconds
            return;
          }
        }

        // Mark as processed
        processedErrors.current.set(errorKey, Date.now());

        // Handle error events based on type
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
      } catch (error) {
        console.error('Failed to process error notification:', error);
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

      // Clear processed errors using the stored reference
      errorsMap.clear();
    };
  }, []); // No dependencies needed since websocketService is a singleton
}