'use client';

import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, TrendingUp, Settings } from 'lucide-react';
import { useRouter } from 'next/navigation';
import websocketService from '@/lib/services/websocketService';

interface TradeSizeWarning {
  symbol: string;
  currentTradeSize?: number;
  currentLongSize?: number;
  currentShortSize?: number;
  minimumRequired: number;
  reason: string;
  leverage: number;
  currentPrice: number;
}

interface TradeSizeWarningModalProps {
  onClose?: () => void;
}

export function TradeSizeWarningModal({ onClose }: TradeSizeWarningModalProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [warnings, setWarnings] = useState<TradeSizeWarning[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkTradeSizes();

    // Listen for WebSocket warnings using the websocket service
    const cleanup = websocketService.addMessageHandler((message) => {
      if (message.type === 'trade_size_warnings' && message.data.warnings.length > 0) {
        setWarnings(message.data.warnings);
        setIsOpen(true);
      }
    });

    return cleanup;
  }, []);

  const checkTradeSizes = async () => {
    try {
      const response = await fetch('/api/validate-trade-sizes');
      const data = await response.json();

      if (!data.valid && data.warnings && data.warnings.length > 0) {
        setWarnings(data.warnings);
        setIsOpen(true);
      }
    } catch (error) {
      console.error('Failed to check trade sizes:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGoToConfig = () => {
    router.push('/config');
    setIsOpen(false);
    onClose?.();
  };

  const handleDismiss = () => {
    setIsOpen(false);
    onClose?.();
  };

  if (loading || warnings.length === 0) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-5 w-5" />
            Trade Size Configuration Warning
          </DialogTitle>
          <DialogDescription>
            Some symbols have trade sizes below exchange minimums. These trades will be rejected.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 my-4">
          <Alert className="border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950/20">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Important:</strong> The exchange will reject any trades with insufficient size.
              Please update your configuration to avoid failed trades.
            </AlertDescription>
          </Alert>

          <div className="space-y-3">
            {warnings.map((warning, index) => (
              <div
                key={`${warning.symbol}-${index}`}
                className="rounded-lg border p-4 space-y-2 bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-lg">{warning.symbol}</span>
                    <Badge variant="destructive">Too Low</Badge>
                  </div>
                  <Badge variant="outline">
                    {warning.leverage}x leverage
                  </Badge>
                </div>

                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Current Price:</span>
                    <span className="font-mono">${warning.currentPrice.toFixed(2)}</span>
                  </div>

                  {warning.currentTradeSize !== undefined && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Current Trade Size:</span>
                      <span className="font-mono text-red-600">
                        ${warning.currentTradeSize.toFixed(2)} USDT
                      </span>
                    </div>
                  )}

                  {warning.currentLongSize !== undefined && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Long Trade Size:</span>
                      <span className="font-mono text-red-600">
                        ${warning.currentLongSize.toFixed(2)} USDT
                      </span>
                    </div>
                  )}

                  {warning.currentShortSize !== undefined && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Short Trade Size:</span>
                      <span className="font-mono text-red-600">
                        ${warning.currentShortSize.toFixed(2)} USDT
                      </span>
                    </div>
                  )}

                  <div className="flex justify-between pt-2 border-t">
                    <span className="text-muted-foreground font-semibold">
                      Minimum Required:
                    </span>
                    <span className="font-mono text-green-600 font-semibold">
                      ${warning.minimumRequired.toFixed(2)} USDT
                    </span>
                  </div>
                </div>

                <div className="bg-yellow-100 dark:bg-yellow-900/20 rounded p-2 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-yellow-600" />
                  <span className="text-xs text-yellow-800 dark:text-yellow-400">
                    Increase trade size to at least ${warning.minimumRequired.toFixed(2)} USDT to avoid rejection
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={handleDismiss}>
            Dismiss
          </Button>
          <Button onClick={handleGoToConfig} className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Go to Configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}