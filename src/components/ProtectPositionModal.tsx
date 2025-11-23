'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Shield, Plus, Trash2, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface ProtectPositionModalProps {
  isOpen: boolean;
  onClose: () => void;
  position: {
    symbol: string;
    side: 'LONG' | 'SHORT';
    quantity: number;
    entryPrice: number;
    markPrice: number;
  } | null;
  onConfirm: (settings: ProtectiveSettings) => Promise<void>;
}

export interface ProtectiveSettings {
  enableBreakeven: boolean;
  breakevenTrimPercent?: number;
  trimLevels: Array<{
    profitPercent: number;
    trimPercent: number;
  }>;
}

export function ProtectPositionModal({ isOpen, onClose, position, onConfirm }: ProtectPositionModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [breakevenEnabled, setBreakevenEnabled] = useState(true);
  const [breakevenTrim, setBreakevenTrim] = useState(50);
  const [trimLevels, setTrimLevels] = useState<Array<{ profitPercent: number; trimPercent: number }>>([]);

  const handleAddTrimLevel = () => {
    setTrimLevels([...trimLevels, { profitPercent: 2, trimPercent: 25 }]);
  };

  const handleRemoveTrimLevel = (index: number) => {
    setTrimLevels(trimLevels.filter((_, i) => i !== index));
  };

  const handleUpdateTrimLevel = (index: number, field: 'profitPercent' | 'trimPercent', value: number) => {
    const updated = [...trimLevels];
    updated[index][field] = value;
    setTrimLevels(updated);
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await onConfirm({
        enableBreakeven: breakevenEnabled,
        breakevenTrimPercent: breakevenTrim,
        trimLevels,
      });
      onClose();
    } catch (error) {
      console.error('Failed to activate protection:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!position) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-500" />
            Protect Position - {position.symbol}
          </DialogTitle>
          <DialogDescription>
            Set protective trim levels to automatically reduce position size at specific price points
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Position Info */}
          <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg text-sm">
            <div>
              <span className="text-muted-foreground">Side:</span>
              <span className="ml-2 font-semibold">{position.side}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Quantity:</span>
              <span className="ml-2 font-mono">{position.quantity}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Entry:</span>
              <span className="ml-2 font-mono">${position.entryPrice.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Current:</span>
              <span className="ml-2 font-mono">${position.markPrice.toFixed(2)}</span>
            </div>
          </div>

          <Separator />

          {/* Breakeven Protection */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base">Breakeven Protection</Label>
                <p className="text-sm text-muted-foreground">Trim position when price returns near entry</p>
              </div>
              <Switch checked={breakevenEnabled} onCheckedChange={setBreakevenEnabled} />
            </div>

            {breakevenEnabled && (
              <div className="pl-6">
                <div className="space-y-2">
                  <Label className="text-sm">Trim Amount (%)</Label>
                  <Input
                    type="number"
                    min="1"
                    max="100"
                    step="5"
                    value={breakevenTrim}
                    onChange={(e) => setBreakevenTrim(parseFloat(e.target.value) || 50)}
                    placeholder="50"
                  />
                  <p className="text-xs text-muted-foreground">% of position to close</p>
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Additional Trim Levels */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base">Additional Trim Levels</Label>
                <p className="text-sm text-muted-foreground">Set multiple profit/loss targets</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={handleAddTrimLevel}>
                <Plus className="h-4 w-4 mr-1" />
                Add Level
              </Button>
            </div>

            {trimLevels.length > 0 && (
              <div className="space-y-3">
                {trimLevels.map((level, index) => (
                  <div key={index} className="flex items-center gap-3 p-3 border rounded-lg">
                    <div className="flex-1 grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Profit Trigger (%)</Label>
                        <Input
                          type="number"
                          step="0.5"
                          value={level.profitPercent}
                          onChange={(e) => handleUpdateTrimLevel(index, 'profitPercent', parseFloat(e.target.value) || 0)}
                          placeholder="2"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Trim (%)</Label>
                        <Input
                          type="number"
                          min="1"
                          max="100"
                          step="5"
                          value={level.trimPercent}
                          onChange={(e) => handleUpdateTrimLevel(index, 'trimPercent', parseFloat(e.target.value) || 25)}
                          placeholder="25"
                        />
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveTrimLevel(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Protective orders will be placed as LIMIT orders that execute when price hits your targets.
              They won&apos;t interfere with your existing TP/SL orders.
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? 'Activating...' : 'Activate Protection'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
