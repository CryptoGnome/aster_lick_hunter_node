'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Shield, Plus, Trash2, Info, AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface ScaleOutModalProps {
  isOpen: boolean;
  onClose: () => void;
  position: {
    symbol: string;
    side: 'LONG' | 'SHORT';
    quantity: number;
    entryPrice: number;
    markPrice: number;
  } | null;
  onConfirm: (settings: ScaleOutSettings) => Promise<void>;
}

export interface ScaleOutSettings {
  enableBreakeven: boolean;
  breakevenTrimPercent?: number;
  trimLevels: Array<{
    profitPercent: number;
    trimPercent: number;
  }>;
  enableTrailingTakeProfit: boolean;
  trailingTakeProfitPercent?: number;
  trailingActivationPercent?: number;
  enableDCAOnDrop?: boolean;
  disableDefaultTPSL?: boolean;
}

export function ScaleOutModal({ isOpen, onClose, position, onConfirm }: ScaleOutModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [breakevenEnabled, setBreakevenEnabled] = useState(false);
  const [breakevenTrim, setBreakevenTrim] = useState(50);
  const [trimLevels, setTrimLevels] = useState<Array<{ profitPercent: number; trimPercent: number }>>([]);
  const [trailingTakeProfitEnabled, setTrailingTakeProfitEnabled] = useState(false);
  const [trailingTakeProfitPercent, setTrailingTakeProfitPercent] = useState(2);
  const [trailingActivationPercent, setTrailingActivationPercent] = useState(1);
  const [enableDCAOnDrop, setEnableDCAOnDrop] = useState(false); // Activate when position is 1% profitable
  const [disableDefaultTPSL, setDisableDefaultTPSL] = useState(false);

  // Check if any orders would trigger immediately
  const getImmediateExecutionWarnings = (): string[] => {
    if (!position) return [];
    
    const warnings: string[] = [];
    const currentPnlPercent = ((position.markPrice - position.entryPrice) / position.entryPrice) * 100;
    const isLong = position.side === 'LONG';
    
    // Adjust for SHORT positions (negative PnL when price goes up)
    const effectivePnl = isLong ? currentPnlPercent : -currentPnlPercent;
    
    // Check if breakeven would trigger immediately
    if (breakevenEnabled && effectivePnl >= 0) {
      warnings.push(`⚠️ Breakeven order will execute immediately (position is ${effectivePnl.toFixed(2)}% profitable)`);
    }
    
    // Check if any trim levels would trigger immediately
    trimLevels.forEach((level, idx) => {
      if (effectivePnl >= level.profitPercent) {
        warnings.push(`⚠️ Trim level #${idx + 1} (${level.profitPercent}%) will execute immediately`);
      }
    });
    
    return warnings;
  };

  const immediateWarnings = getImmediateExecutionWarnings();

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
    // Check if there's any full position exit method enabled
    const hasFullExit = 
      (breakevenEnabled && breakevenTrim === 100) ||
      trimLevels.some(level => level.trimPercent === 100);
    
    // Check if only trailing TP is enabled (acts like no stop loss)
    const onlyTrailingTP = !breakevenEnabled && trimLevels.length === 0 && trailingTakeProfitEnabled;
    
    // Validate: if disabling default TP/SL, must have full position exit OR understand the risk
    if (disableDefaultTPSL) {
      if (!breakevenEnabled && trimLevels.length === 0 && !trailingTakeProfitEnabled) {
        alert('⚠️ You must enable at least one exit method (Breakeven, Trim Levels, or Trailing TP) when disabling default TP/SL. Otherwise your position has no exit protection.');
        return;
      }
      
      if (onlyTrailingTP) {
        const confirmed = confirm(
          '⚠️ Warning: Only Trailing TP enabled with no Stop Loss\n\n' +
          'Your position will have NO downside protection. If price moves against you, the position will remain open until liquidation.\n\n' +
          'Trailing TP only closes positions when profitable. Are you sure you want to continue?'
        );
        if (!confirmed) return;
      } else if (!hasFullExit) {
        const confirmed = confirm(
          '⚠️ Warning: Partial exit only, no full position close\n\n' +
          'Your scale out settings will only reduce the position size. The remaining position will have no exit protection and could remain open indefinitely.\n\n' +
          'Consider setting at least one trim level to 100% or enabling Breakeven with 100% trim. Continue anyway?'
        );
        if (!confirmed) return;
      }
    }

    setIsSubmitting(true);
    try {
      await onConfirm({
        enableBreakeven: breakevenEnabled,
        breakevenTrimPercent: breakevenTrim,
        trimLevels,
        enableTrailingTakeProfit: trailingTakeProfitEnabled,
        trailingTakeProfitPercent: trailingTakeProfitPercent,
        trailingActivationPercent: trailingActivationPercent,
        enableDCAOnDrop: enableDCAOnDrop,
        disableDefaultTPSL: disableDefaultTPSL,
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
            Scale Out Strategy - {position.symbol}
          </DialogTitle>
          <DialogDescription>
            Configure automated partial exits to reduce position size at specific profit levels
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

          {/* Immediate Execution Warning */}
          {immediateWarnings.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <div className="font-semibold mb-1">Orders will execute immediately:</div>
                <ul className="list-disc list-inside space-y-1">
                  {immediateWarnings.map((warning, idx) => (
                    <li key={idx} className="text-sm">{warning}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

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

          <Separator />

          {/* Trailing Take Profit */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base">Trailing Take Profit</Label>
                <p className="text-sm text-muted-foreground">Captures upside while protecting profits (exit never falls below break-even)</p>
              </div>
              <Switch checked={trailingTakeProfitEnabled} onCheckedChange={setTrailingTakeProfitEnabled} />
            </div>

            {trailingTakeProfitEnabled && (
              <div className="pl-6 space-y-4">
                <div className="space-y-2">
                  <Label className="text-sm">Activate When Profitable (%)</Label>
                  <Input
                    type="number"
                    min="0.5"
                    max="20"
                    step="0.5"
                    value={trailingActivationPercent}
                    onChange={(e) => setTrailingActivationPercent(parseFloat(e.target.value) || 1)}
                    placeholder="1"
                  />
                  <p className="text-xs text-muted-foreground">
                    Trailing activates when position reaches {trailingActivationPercent}% profit
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">Take Profit Trail Distance (%)</Label>
                  <Input
                    type="number"
                    min="0.1"
                    max="10"
                    step="0.1"
                    value={trailingTakeProfitPercent}
                    onChange={(e) => setTrailingTakeProfitPercent(parseFloat(e.target.value) || 2)}
                    placeholder="2"
                  />
                  <p className="text-xs text-muted-foreground">
                    TP will be placed {trailingTakeProfitPercent}% {position.side === 'LONG' ? 'below' : 'above'} highest profitable price (never below entry)
                  </p>
                </div>
                <div className="flex items-center justify-between pt-2 border-t">
                  <div>
                    <Label className="text-sm">DCA on Drop Below Entry</Label>
                    <p className="text-xs text-muted-foreground">Continue adding to position if liquidations meet threshold</p>
                  </div>
                  <Switch checked={enableDCAOnDrop} onCheckedChange={setEnableDCAOnDrop} />
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Disable Default TP/SL */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base">Disable Default TP/SL</Label>
                <p className="text-sm text-muted-foreground">Remove bot&apos;s automatic stop loss and take profit orders for this position</p>
              </div>
              <Switch checked={disableDefaultTPSL} onCheckedChange={setDisableDefaultTPSL} />
            </div>
            
            {disableDefaultTPSL && (
              <>
                {(() => {
                  const hasFullExit = 
                    (breakevenEnabled && breakevenTrim === 100) ||
                    trimLevels.some(level => level.trimPercent === 100);
                  
                  const onlyTrailingTP = !breakevenEnabled && trimLevels.length === 0 && trailingTakeProfitEnabled;
                  const noExitMethods = !breakevenEnabled && trimLevels.length === 0 && !trailingTakeProfitEnabled;

                  if (hasFullExit) {
                    // Full exit configured - no warning needed
                    return null;
                  }

                  if (noExitMethods) {
                    return (
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription className="text-sm">
                          <div className="font-semibold mb-1">⚠️ Warning: No exit protection</div>
                          <p className="text-xs">
                            You must enable at least one scale out method (breakeven, trim levels, or trailing TP).
                            Otherwise, your position will remain open indefinitely or until liquidation.
                          </p>
                        </AlertDescription>
                      </Alert>
                    );
                  }

                  if (onlyTrailingTP) {
                    return (
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription className="text-sm">
                          <div className="font-semibold mb-1">⚠️ Warning: No stop loss protection</div>
                          <p className="text-xs">
                            Trailing TP only closes positions when profitable. If price moves against you, 
                            there will be no downside protection and the position could remain open until liquidation.
                          </p>
                        </AlertDescription>
                      </Alert>
                    );
                  }

                  // Partial exits only
                  return (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription className="text-sm">
                        <div className="font-semibold mb-1">⚠️ Warning: Partial exit only</div>
                        <p className="text-xs">
                          Your scale out settings will only reduce position size. The remaining position will have no exit protection.
                          Consider setting at least one trim level to 100% for full position close.
                        </p>
                      </AlertDescription>
                    </Alert>
                  );
                })()}
              </>
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
            {isSubmitting ? 'Activating...' : 'Activate Scale Out'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
