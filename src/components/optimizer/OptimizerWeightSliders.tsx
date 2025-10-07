'use client';

import React, { useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';

interface OptimizerWeightSlidersProps {
  pnlWeight: number;
  sharpeWeight: number;
  drawdownWeight: number;
  onPnlWeightChange: (value: number) => void;
  onSharpeWeightChange: (value: number) => void;
  onDrawdownWeightChange: (value: number) => void;
}

/**
 * OptimizerWeightSliders Component
 * 
 * Customizable weight controls for PnL/Sharpe/Drawdown scoring
 * Auto-normalizes to ensure total equals 100%
 */
export function OptimizerWeightSliders({
  pnlWeight,
  sharpeWeight,
  drawdownWeight,
  onPnlWeightChange,
  onSharpeWeightChange,
  onDrawdownWeightChange,
}: OptimizerWeightSlidersProps) {
  const total = pnlWeight + sharpeWeight + drawdownWeight;
  const isValid = Math.abs(total - 100) < 0.1;

  // Auto-normalize when total deviates significantly
  useEffect(() => {
    if (!isValid && total > 0) {
      const normalizationFactor = 100 / total;
      onPnlWeightChange(Math.round(pnlWeight * normalizationFactor));
      onSharpeWeightChange(Math.round(sharpeWeight * normalizationFactor));
      onDrawdownWeightChange(Math.round(drawdownWeight * normalizationFactor));
    }
  }, [total, isValid, pnlWeight, sharpeWeight, drawdownWeight, onPnlWeightChange, onSharpeWeightChange, onDrawdownWeightChange]);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="pnl-weight">PnL Weight</Label>
          <span className="text-sm font-medium">{pnlWeight}%</span>
        </div>
        <Slider
          id="pnl-weight"
          min={0}
          max={100}
          step={5}
          value={[pnlWeight]}
          onValueChange={(value) => onPnlWeightChange(value[0])}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">
          Prioritize total profit generation
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="sharpe-weight">Sharpe Ratio Weight</Label>
          <span className="text-sm font-medium">{sharpeWeight}%</span>
        </div>
        <Slider
          id="sharpe-weight"
          min={0}
          max={100}
          step={5}
          value={[sharpeWeight]}
          onValueChange={(value) => onSharpeWeightChange(value[0])}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">
          Prioritize consistency & risk-adjusted returns
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="drawdown-weight">Drawdown Protection Weight</Label>
          <span className="text-sm font-medium">{drawdownWeight}%</span>
        </div>
        <Slider
          id="drawdown-weight"
          min={0}
          max={100}
          step={5}
          value={[drawdownWeight]}
          onValueChange={(value) => onDrawdownWeightChange(value[0])}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">
          Prioritize capital preservation
        </p>
      </div>

      <div className="pt-2 border-t">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Total:</span>
          <span className={`font-medium ${isValid ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
            {total.toFixed(1)}%
            {!isValid && ' (Must equal 100%)'}
          </span>
        </div>
      </div>
    </div>
  );
}

