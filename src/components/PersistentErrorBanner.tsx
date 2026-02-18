'use client';

import { useEffect, useState } from 'react';
import { X, AlertTriangle, WifiOff, ServerCrash, XCircle } from 'lucide-react';
import websocketService from '@/lib/services/websocketService';
import { ErrorType } from '@/lib/utils/errorToast';

interface SystemicError {
  type: ErrorType;
  title: string;
  message: string;
  timestamp: number;
  count: number;
}

const ERROR_ICONS = {
  websocket: WifiOff,
  api: ServerCrash,
  trading: XCircle,
  config: AlertTriangle,
  general: AlertTriangle,
};

const ERROR_COLORS = {
  websocket: 'bg-red-500/90 border-red-400',
  api: 'bg-red-500/90 border-red-400',
  trading: 'bg-red-600/90 border-red-500',
  config: 'bg-orange-500/90 border-orange-400',
  general: 'bg-red-600/90 border-red-500',
};

export function PersistentErrorBanner() {
  const [systemicErrors, setSystemicErrors] = useState<Map<string, SystemicError>>(new Map());
  const [hasShownInitialConnection, setHasShownInitialConnection] = useState(false);

  useEffect(() => {
    // Wait 5 seconds before allowing websocket errors to be shown
    // This prevents the banner from flashing on initial page load
    const initialDelay = setTimeout(() => {
      setHasShownInitialConnection(true);
    }, 5000);

    const cleanup = websocketService.addMessageHandler((message: any) => {
      if (!message.type || !message.type.endsWith('_error')) {
        return;
      }

      const { title, message: errorMessage } = message.data || {};

      // Check if this is a systemic error that should be shown in the banner
      const isSystemicError =
        title?.toLowerCase().includes('insufficient balance') ||
        title?.toLowerCase().includes('rate limit') ||
        message.type === 'websocket_error';

      if (!isSystemicError) {
        return;
      }

      // Skip websocket errors during initial 5 second grace period
      if (message.type === 'websocket_error' && !hasShownInitialConnection) {
        return;
      }

      // Determine error type
      let errorType: ErrorType = 'general';
      if (message.type === 'websocket_error') errorType = 'websocket';
      else if (message.type === 'api_error') errorType = 'api';
      else if (message.type === 'trading_error') errorType = 'trading';
      else if (message.type === 'config_error') errorType = 'config';

      // Create unique key for error type
      const errorKey = title?.toLowerCase().includes('insufficient balance')
        ? 'insufficient-balance'
        : title?.toLowerCase().includes('rate limit')
        ? 'rate-limit'
        : message.type;

      setSystemicErrors(prev => {
        const newMap = new Map(prev);
        const existing = newMap.get(errorKey);

        if (existing) {
          // Update count and timestamp
          newMap.set(errorKey, {
            ...existing,
            timestamp: Date.now(),
            count: existing.count + 1,
          });
        } else {
          // Add new systemic error
          newMap.set(errorKey, {
            type: errorType,
            title,
            message: errorMessage,
            timestamp: Date.now(),
            count: 1,
          });
        }

        return newMap;
      });
    });

    // Auto-clear errors after 2 minutes of inactivity
    const interval = setInterval(() => {
      const now = Date.now();
      setSystemicErrors(prev => {
        const newMap = new Map(prev);
        let hasChanges = false;

        newMap.forEach((error, key) => {
          if (now - error.timestamp > 120000) { // 2 minutes
            newMap.delete(key);
            hasChanges = true;
          }
        });

        return hasChanges ? newMap : prev;
      });
    }, 10000); // Check every 10 seconds

    return () => {
      clearTimeout(initialDelay);
      cleanup();
      clearInterval(interval);
    };
  }, [hasShownInitialConnection]);

  const dismissError = (key: string) => {
    setSystemicErrors(prev => {
      const newMap = new Map(prev);
      newMap.delete(key);
      return newMap;
    });
  };

  if (systemicErrors.size === 0) {
    return null;
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 pointer-events-none">
      <div className="max-w-7xl mx-auto px-4 pt-4 space-y-2 pointer-events-auto">
        {Array.from(systemicErrors.entries()).map(([key, error]) => {
          const Icon = ERROR_ICONS[error.type];
          const colorClass = ERROR_COLORS[error.type];

          return (
            <div
              key={key}
              className={`${colorClass} border text-white px-4 py-3 rounded-lg shadow-lg flex items-start justify-between transition-all duration-300 ease-out`}
            >
              <div className="flex items-start gap-3 flex-1">
                <Icon className="h-5 w-5 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold flex items-center gap-2">
                    {error.title}
                    {error.count > 1 && (
                      <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">
                        {error.count}x
                      </span>
                    )}
                  </div>
                  <div className="text-sm mt-1 opacity-90">
                    {error.message}
                  </div>
                </div>
              </div>
              <button
                onClick={() => dismissError(key)}
                className="ml-4 p-1 hover:bg-white/20 rounded transition-colors flex-shrink-0"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
