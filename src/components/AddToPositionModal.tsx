'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Plus, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface AddToPositionModalProps {
  isOpen: boolean;
  onClose: () => void;
  symbol: string;
  side: 'LONG' | 'SHORT';
  currentQuantity: number;
  currentPrice: number;
  entryPrice: number;
  leverage: number;
}

export function AddToPositionModal({
  isOpen,
  onClose,
  symbol,
  side,
  currentQuantity,
  currentPrice,
  entryPrice,
  leverage,
}: AddToPositionModalProps) {
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [quantity, setQuantity] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notionalValue, setNotionalValue] = useState(0);
  const [marginRequired, setMarginRequired] = useState(0);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setOrderType('MARKET');
      setQuantity('');
      setLimitPrice(currentPrice.toFixed(getPricePrecision(symbol)));
      setIsSubmitting(false);
    }
  }, [isOpen, currentPrice, symbol]);

  // Calculate notional value and margin required
  useEffect(() => {
    const qty = parseFloat(quantity) || 0;
    const price = orderType === 'MARKET' ? currentPrice : (parseFloat(limitPrice) || currentPrice);
    const notional = qty * price;
    setNotionalValue(notional);
    setMarginRequired(leverage > 0 ? notional / leverage : notional);
  }, [quantity, limitPrice, orderType, currentPrice, leverage]);

  const getPricePrecision = (sym: string): number => {
    // Common price precisions
    if (sym.includes('BTC')) return 1;
    if (sym.includes('ETH')) return 2;
    return 4;
  };

  const getQuantityPrecision = (sym: string): number => {
    if (sym.includes('BTC')) return 3;
    if (sym.includes('ETH')) return 3;
    return 2;
  };

  const handleSubmit = async () => {
    const qty = parseFloat(quantity);
    if (!qty || qty <= 0) {
      toast.error('Please enter a valid quantity');
      return;
    }

    if (orderType === 'LIMIT') {
      const price = parseFloat(limitPrice);
      if (!price || price <= 0) {
        toast.error('Please enter a valid limit price');
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/positions/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          side,
          orderType,
          quantity: qty,
          price: orderType === 'LIMIT' ? parseFloat(limitPrice) : undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to place order');
      }

      toast.success(`${orderType} order placed`, {
        description: `Added ${qty} ${symbol} to ${side} position`,
      });

      onClose();
    } catch (error: any) {
      console.error('Failed to place order:', error);
      toast.error('Failed to place order', {
        description: error.message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100 * (side === 'LONG' ? 1 : -1);
  const isInProfit = pnlPercent > 0;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Add to {symbol} {side}
          </DialogTitle>
          <DialogDescription>
            Add more to your existing position
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Current Position Info */}
          <div className="bg-muted/50 rounded-lg p-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Current Size:</span>
              <span className="font-mono">{currentQuantity.toFixed(getQuantityPrecision(symbol))}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Entry Price:</span>
              <span className="font-mono">${entryPrice.toFixed(getPricePrecision(symbol))}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Current Price:</span>
              <span className="font-mono">${currentPrice.toFixed(getPricePrecision(symbol))}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Position P&L:</span>
              <span className={`font-mono ${isInProfit ? 'text-green-500' : 'text-red-500'}`}>
                {pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
              </span>
            </div>
          </div>

          {/* Warning if adding at a loss */}
          {!isInProfit && (
            <div className="flex items-center gap-2 text-yellow-500 text-sm bg-yellow-500/10 p-2 rounded">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span>Position is currently at a loss. Adding will average your entry price.</span>
            </div>
          )}

          {/* Order Type */}
          <div className="space-y-2">
            <Label>Order Type</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={orderType === 'MARKET' ? 'default' : 'outline'}
                size="sm"
                className="flex-1"
                onClick={() => setOrderType('MARKET')}
              >
                Market
              </Button>
              <Button
                type="button"
                variant={orderType === 'LIMIT' ? 'default' : 'outline'}
                size="sm"
                className="flex-1"
                onClick={() => setOrderType('LIMIT')}
              >
                Limit
              </Button>
            </div>
          </div>

          {/* Quantity */}
          <div className="space-y-2">
            <Label htmlFor="quantity">Quantity</Label>
            <Input
              id="quantity"
              type="number"
              step="any"
              placeholder={`e.g., ${(currentQuantity * 0.5).toFixed(getQuantityPrecision(symbol))}`}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => setQuantity((currentQuantity * 0.25).toFixed(getQuantityPrecision(symbol)))}
              >
                25%
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => setQuantity((currentQuantity * 0.5).toFixed(getQuantityPrecision(symbol)))}
              >
                50%
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => setQuantity((currentQuantity * 1.0).toFixed(getQuantityPrecision(symbol)))}
              >
                100%
              </Button>
            </div>
          </div>

          {/* Limit Price (if limit order) */}
          {orderType === 'LIMIT' && (
            <div className="space-y-2">
              <Label htmlFor="limitPrice">Limit Price</Label>
              <Input
                id="limitPrice"
                type="number"
                step="any"
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
              />
            </div>
          )}

          {/* Estimated Costs */}
          {notionalValue > 0 && (
            <div className="space-y-1 pt-2 border-t">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Notional Value:</span>
                <span className="font-mono">${notionalValue.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Margin Required ({leverage}x):</span>
                <span className="font-mono font-semibold">${marginRequired.toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !quantity}
            className="flex-1"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Placing...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                Add to Position
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
