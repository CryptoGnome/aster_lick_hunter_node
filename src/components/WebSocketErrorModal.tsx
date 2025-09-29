'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AlertCircle, Copy, CheckCircle } from 'lucide-react';
import websocketService from '@/lib/services/websocketService';

export function WebSocketErrorModal() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [hasShownError, setHasShownError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [connectionFailed, setConnectionFailed] = useState(false);

  // Pages that don't need WebSocket connection
  const wsExcludedPaths = ['/errors', '/config', '/auth', '/wiki', '/login'];
  const shouldConnectWebSocket = !wsExcludedPaths.some(path => pathname?.startsWith(path));

  useEffect(() => {
    // Don't register WebSocket listener on excluded pages
    if (!shouldConnectWebSocket) {
      return;
    }

    // Add connection listener to detect failures
    const unsubscribe = websocketService.addConnectionListener((connected) => {
      if (!connected && !hasShownError) {
        // Check if this was an intentional disconnect (bot stopping)
        if (websocketService.isIntentionallyDisconnected()) {
          console.log('WebSocket disconnected intentionally (bot stopped)');
          return;
        }

        // Give it a moment to try reconnecting
        setTimeout(() => {
          const stillDisconnected = !websocketService.getConnectionStatus();
          const intentionalDisconnect = websocketService.isIntentionallyDisconnected();

          // Only show modal if still disconnected and not intentional
          if (stillDisconnected && !intentionalDisconnect) {
            setConnectionFailed(true);
            setOpen(true);
            setHasShownError(true);
          }
        }, 3000); // Wait 3 seconds before showing modal
      } else if (connected && hasShownError) {
        // Reset if connection succeeds
        setConnectionFailed(false);
        setOpen(false);
        setHasShownError(false);
      }
    });

    return unsubscribe;
  }, [hasShownError, shouldConnectWebSocket]);

  const handleCopyEnvConfig = () => {
    const envConfig = `# WebSocket Configuration (Optional)
# =====================================
# Override the WebSocket host for remote access
# By default, the WebSocket will use localhost or auto-detect from browser location
# Only set this if you need to force a specific hostname or IP address

# NEXT_PUBLIC_WS_HOST=192.168.1.100
# NEXT_PUBLIC_WS_HOST=your-server-hostname.com`;

    navigator.clipboard.writeText(envConfig).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!connectionFailed) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-yellow-500" />
            <DialogTitle>WebSocket Connection Failed</DialogTitle>
          </div>
          <DialogDescription asChild>
            <div className="mt-4 space-y-4 text-muted-foreground text-sm">
              <p>
                The WebSocket connection to the bot service failed. This usually means the bot is not running or is configured for a different host.
              </p>

              <div className="bg-muted p-4 rounded-lg space-y-3">
                <h4 className="font-semibold text-sm text-foreground">To fix this issue:</h4>

                <div className="space-y-2 text-sm">
                  <div>
                    <span className="font-medium text-foreground">1. Check if the bot is running:</span>
                    <p className="text-muted-foreground ml-4">Run <code className="bg-background px-1 py-0.5 rounded">npm run dev</code> to start both the web UI and bot service.</p>
                  </div>

                  <div>
                    <span className="font-medium text-foreground">2. For remote access:</span>
                    <p className="text-muted-foreground ml-4">Create a <code className="bg-background px-1 py-0.5 rounded">.env.local</code> file in the project root with:</p>
                  </div>
                </div>

                <div className="relative">
                  <pre className="bg-background p-3 rounded text-xs overflow-x-auto">
{`# WebSocket Configuration (Optional)
# Override the WebSocket host for remote access
# By default, the WebSocket will use localhost
# Only set this if you need a specific hostname or IP

NEXT_PUBLIC_WS_HOST=192.168.1.100
# Or use your server hostname:
# NEXT_PUBLIC_WS_HOST=your-server-hostname.com`}
                  </pre>
                  <button
                    onClick={handleCopyEnvConfig}
                    className="absolute top-2 right-2 p-1.5 bg-background rounded hover:bg-muted transition-colors"
                    title="Copy configuration"
                  >
                    {copied ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                </div>

                <div className="text-sm">
                  <span className="font-medium text-foreground">3. Restart the application:</span>
                  <p className="text-muted-foreground ml-4">After updating the configuration, restart with <code className="bg-background px-1 py-0.5 rounded">npm run dev</code></p>
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                <p>
                  The bot will continue to work independently even if the WebSocket is disconnected.
                  This only affects the real-time UI updates.
                </p>
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}