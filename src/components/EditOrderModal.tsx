'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Pencil, X, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Order, OrderStatus } from '@/lib/types/order';

interface EditOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order | null;
  onOrderUpdated?: () => void;
}

export function EditOrderModal({
  isOpen,
  onClose,
  order,
  onOrderUpdated,
}: EditOrderModalProps) {
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  // Reset form when modal opens with order data
  useEffect(() => {
    if (isOpen && order) {
      setQuantity(order.origQty || '');
      setPrice(order.price || '');
      setIsSubmitting(false);
      setIsCancelling(false);
    }
  }, [isOpen, order]);

  if (!order) return null;

  const isLimitOrder = order.type === 'LIMIT';
  const canEdit = order.status === OrderStatus.NEW || order.status === OrderStatus.PARTIALLY_FILLED;

  const handleCancel = async () => {
    if (!order) return;

    setIsCancelling(true);

    try {
      const response = await fetch('/api/orders/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: order.symbol,
          orderId: order.orderId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to cancel order');
      }

      toast.success('Order cancelled', {
        description: `${order.symbol} ${order.type} order cancelled`,
      });

      onOrderUpdated?.();
      onClose();
    } catch (error: any) {
      console.error('Failed to cancel order:', error);
      toast.error('Failed to cancel order', {
        description: error.message,
      });
    } finally {
      setIsCancelling(false);
    }
  };

  const handleModify = async () => {
    if (!order) return;

    const newQty = parseFloat(quantity);
    const newPrice = parseFloat(price);

    if (!newQty || newQty <= 0) {
      toast.error('Please enter a valid quantity');
      return;
    }

    if (isLimitOrder && (!newPrice || newPrice <= 0)) {
      toast.error('Please enter a valid price');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/orders/modify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: order.symbol,
          orderId: order.orderId,
          quantity: newQty,
          price: isLimitOrder ? newPrice : undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to modify order');
      }

      toast.success('Order modified', {
        description: `${order.symbol} order updated`,
      });

      onOrderUpdated?.();
      onClose();
    } catch (error: any) {
      console.error('Failed to modify order:', error);
      toast.error('Failed to modify order', {
        description: error.message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasChanges = () => {
    const qtyChanged = quantity !== order.origQty;
    const priceChanged = isLimitOrder && price !== order.price;
    return qtyChanged || priceChanged;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5" />
            Edit Order
          </DialogTitle>
          <DialogDescription>
            Modify or cancel your {order.type.toLowerCase()} order
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Order Info */}
          <div className="bg-muted/50 rounded-lg p-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Symbol:</span>
              <span className="font-mono font-semibold">{order.symbol}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Side:</span>
              <span className={`font-semibold ${order.side === 'BUY' ? 'text-green-500' : 'text-red-500'}`}>
                {order.side}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Type:</span>
              <span className="font-mono">{order.type}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Status:</span>
              <span className="font-mono">{order.status}</span>
            </div>
            {order.executedQty && parseFloat(order.executedQty) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Filled:</span>
                <span className="font-mono">{order.executedQty} / {order.origQty}</span>
              </div>
            )}
          </div>

          {!canEdit && (
            <div className="flex items-center gap-2 text-yellow-500 text-sm bg-yellow-500/10 p-2 rounded">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span>This order cannot be modified (status: {order.status})</span>
            </div>
          )}

          {canEdit && (
            <>
              {/* Quantity */}
              <div className="space-y-2">
                <Label htmlFor="quantity">Quantity</Label>
                <Input
                  id="quantity"
                  type="number"
                  step="any"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>

              {/* Price (for limit orders) */}
              {isLimitOrder && (
                <div className="space-y-2">
                  <Label htmlFor="price">Price</Label>
                  <Input
                    id="price"
                    type="number"
                    step="any"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex gap-2">
          <Button
            variant="destructive"
            onClick={handleCancel}
            disabled={isCancelling || isSubmitting || !canEdit}
            className="flex-1"
          >
            {isCancelling ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Cancelling...
              </>
            ) : (
              <>
                <X className="h-4 w-4 mr-2" />
                Cancel Order
              </>
            )}
          </Button>
          {canEdit && isLimitOrder && (
            <Button
              onClick={handleModify}
              disabled={isSubmitting || isCancelling || !hasChanges()}
              className="flex-1"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Modifying...
                </>
              ) : (
                <>
                  <Pencil className="h-4 w-4 mr-2" />
                  Modify Order
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
