/**
 * Hook to handle rate limit toast notifications from WebSocket
 */

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import websocketService from '@/lib/services/websocketService';

interface RateLimitToast {
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  duration?: number;
}

interface ToastMessage {
  type: string;
  data: RateLimitToast;
}

export function useRateLimitToasts() {
  const processedToasts = useRef<Map<string, number>>(new Map());
  const cleanupTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Store ref value to avoid stale closure in cleanup
    const toastsMap = processedToasts.current;

    // Clean up old processed toasts periodically
    const startCleanupTimer = () => {
      cleanupTimerRef.current = setInterval(() => {
        const now = Date.now();
        const expiredKeys: string[] = [];
        toastsMap.forEach((timestamp, key) => {
          // Remove toasts older than 5 seconds
          if (now - timestamp > 5000) {
            expiredKeys.push(key);
          }
        });
        expiredKeys.forEach(key => toastsMap.delete(key));
      }, 10000); // Clean up every 10 seconds
    };

    startCleanupTimer();

    const handleMessage = (message: ToastMessage) => {
      if (message.type === 'toast' && message.data) {
        const toastData = message.data;

        // Create a unique key for this toast to avoid duplicates
        const toastKey = `${toastData.type}-${toastData.title}-${toastData.message}`;

        // Check if we've recently processed this toast
        if (processedToasts.current.has(toastKey)) {
          const lastProcessed = processedToasts.current.get(toastKey) || 0;
          if (Date.now() - lastProcessed < 2000) { // Skip if processed within last 2 seconds
            return;
          }
        }

        // Mark as processed
        processedToasts.current.set(toastKey, Date.now());

        // Display the toast based on type
        switch (toastData.type) {
          case 'success':
            toast.success(toastData.title, {
              description: toastData.message,
              duration: toastData.duration || 4000,
            });
            break;

          case 'error':
            toast.error(toastData.title, {
              description: toastData.message,
              duration: toastData.duration || 10000,
            });
            break;

          case 'warning':
            toast.warning(toastData.title, {
              description: toastData.message,
              duration: toastData.duration || 8000,
            });
            break;

          case 'info':
          default:
            toast.info(toastData.title, {
              description: toastData.message,
              duration: toastData.duration || 5000,
            });
            break;
        }
      }
    };

    // Add WebSocket message handler
    const cleanup = websocketService.addMessageHandler(handleMessage);

    return () => {
      // Clean up message handler
      cleanup();

      // Clear cleanup timer
      if (cleanupTimerRef.current) {
        clearInterval(cleanupTimerRef.current);
        cleanupTimerRef.current = null;
      }

      // Clear processed toasts using the stored reference
      toastsMap.clear();
    };
  }, []);

  return null;
}

/**
 * Component to initialize rate limit toast listener
 * Add this to your main layout or dashboard
 */
export function RateLimitToastListener() {
  useRateLimitToasts();
  return null;
}