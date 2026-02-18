'use client';

import React, { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Scissors, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface ReducePositionModalProps {
  isOpen: boolean;
  onClose: () => void;
  symbol: string;
  side: 'LONG' | 'SHORT';
  quantity: number;
  entryPrice: number;
  markPrice: number;
  pnl: number;
  pnlPercent: number;
  formatQuantity: (symbol: string, qty: number) => string;
  onConfirm: (percent: number) => Promise<void>;
}

const PRESET_PERCENTS = [25, 50, 75, 100];

export function ReducePositionModal({
  isOpen,
  onClose,
  symbol,
  side,
  quantity,
  entryPrice,
  markPrice,
  pnl,
  pnlPercent,
  formatQuantity,
  onConfirm,
}: ReducePositionModalProps) {
  const [selectedPercent, setSelectedPercent] = useState<number | null>(null);
  const [customPercent, setCustomPercent] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const activePercent = selectedPercent ?? (customPercent ? parseFloat(customPercent) : null);
  const reduceQty = activePercent && activePercent > 0 ? quantity * (activePercent / 100) : 0;
  const remainingQty = quantity - reduceQty;

  const handlePresetClick = useCallback((percent: number) => {
    setSelectedPercent(percent);
    setCustomPercent('');
  }, []);

  const handleCustomChange = useCallback((value: string) => {
    setCustomPercent(value);
    setSelectedPercent(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!activePercent || activePercent <= 0 || activePercent > 100) return;
    
    setIsSubmitting(true);
    try {
      await onConfirm(activePercent);
      // Reset state
      setSelectedPercent(null);
      setCustomPercent('');
    } finally {
      setIsSubmitting(false);
    }
  }, [activePercent, onConfirm]);

  const handleClose = useCallback(() => {
    setSelectedPercent(null);
    setCustomPercent('');
    onClose();
  }, [onClose]);

  // Estimate PnL for the reduced portion
  const reducePnl = activePercent ? pnl * (activePercent / 100) : 0;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="h-5 w-5 text-orange-500" />
            Reduce Position
          </DialogTitle>
          <DialogDescription>
            Immediately close a portion of your {symbol} {side} position at market price
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Position Summary */}
          <div className="grid grid-cols-2 gap-3 p-3 bg-muted rounded-lg text-sm">
            <div>
              <span className="text-muted-foreground">Symbol:</span>
              <span className="ml-2 font-semibold">{symbol}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Side:</span>
              <Badge
                variant={side === 'LONG' ? 'outline' : 'destructive'}
                className={`ml-2 h-5 text-xs ${side === 'LONG' ? 'border-green-600 text-green-600' : ''}`}
              >
                {side === 'LONG' ? <TrendingUp className="h-3 w-3 mr-0.5" /> : <TrendingDown className="h-3 w-3 mr-0.5" />}
                {side}
              </Badge>
            </div>
            <div>
              <span className="text-muted-foreground">Size:</span>
              <span className="ml-2 font-mono">{formatQuantity(symbol, quantity)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">PnL:</span>
              <span className={`ml-2 font-semibold ${pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {pnl >= 0 ? '+' : ''}${Math.abs(pnl).toFixed(2)} ({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(1)}%)
              </span>
            </div>
          </div>

          {/* Quick Percentage Buttons */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Reduce by</Label>
            <div className="grid grid-cols-4 gap-2">
              {PRESET_PERCENTS.map((pct) => (
                <Button
                  key={pct}
                  type="button"
                  variant={selectedPercent === pct ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handlePresetClick(pct)}
                  className={`h-10 text-sm font-semibold ${
                    selectedPercent === pct
                      ? pct === 100
                        ? 'bg-red-600 hover:bg-red-700'
                        : 'bg-orange-600 hover:bg-orange-700'
                      : ''
                  }`}
                >
                  {pct}%
                </Button>
              ))}
            </div>
          </div>

          {/* Custom Percentage Input */}
          <div className="space-y-2">
            <Label htmlFor="customPercent" className="text-sm">Custom percentage</Label>
            <div className="flex items-center gap-2">
              <Input
                id="customPercent"
                type="number"
                min="1"
                max="100"
                step="1"
                value={customPercent}
                onChange={(e) => handleCustomChange(e.target.value)}
                placeholder="e.g. 33"
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </div>

          {/* Preview */}
          {activePercent && activePercent > 0 && (
            <div className="p-3 border rounded-lg space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Closing:</span>
                <span className="font-mono font-semibold">{formatQuantity(symbol, reduceQty)} ({activePercent}%)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Remaining:</span>
                <span className="font-mono">{activePercent === 100 ? '0' : formatQuantity(symbol, remainingQty)} ({Math.max(0, 100 - activePercent).toFixed(0)}%)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Est. realized PnL:</span>
                <span className={`font-semibold ${reducePnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {reducePnl >= 0 ? '+' : ''}${Math.abs(reducePnl).toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {/* Warning for 100% */}
          {activePercent === 100 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                This will close your entire position. Use the Close button for full closes.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={isSubmitting || !activePercent || activePercent <= 0 || activePercent > 100}
            className="bg-orange-600 hover:bg-orange-700"
          >
            {isSubmitting
              ? 'Reducing...'
              : activePercent
              ? `Reduce ${activePercent}% at Market`
              : 'Select amount'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
