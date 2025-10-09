'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { OptimizerWeightSliders } from './OptimizerWeightSliders';
import { Loader2, Play, ChevronDown, ChevronUp } from 'lucide-react';
import { useConfig } from '@/components/ConfigProvider';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface OptimizerConfigPanelProps {
  pnlWeight: number;
  sharpeWeight: number;
  drawdownWeight: number;
  onWeightsChange: (pnl: number, sharpe: number, drawdown: number) => void;
  onStartOptimization: (selectedSymbols: string[]) => void;
  isStarting: boolean;
}

export function OptimizerConfigPanel({
  pnlWeight,
  sharpeWeight,
  drawdownWeight,
  onWeightsChange,
  onStartOptimization,
  isStarting,
}: OptimizerConfigPanelProps) {
  const { config } = useConfig();
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(
    Object.keys(config?.symbols || {})
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  const availableSymbols = Object.keys(config?.symbols || {});
  const allSelected = selectedSymbols.length === availableSymbols.length;
  const someSelected = selectedSymbols.length > 0 && !allSelected;

  const handleToggleAll = () => {
    if (allSelected) {
      setSelectedSymbols([]);
    } else {
      setSelectedSymbols(availableSymbols);
    }
  };

  const handleToggleSymbol = (symbol: string) => {
    setSelectedSymbols(prev =>
      prev.includes(symbol)
        ? prev.filter(s => s !== symbol)
        : [...prev, symbol]
    );
  };

  const handleStart = () => {
    if (selectedSymbols.length === 0) {
      return;
    }
    onStartOptimization(selectedSymbols);
  };

  return (
    <div className="space-y-6">
      {/* Weight Sliders */}
      <div>
        <div className="mb-4 flex items-center gap-2">
          <Label className="text-base font-semibold">Optimization Weights</Label>
        </div>
        <OptimizerWeightSliders
          pnlWeight={pnlWeight}
          sharpeWeight={sharpeWeight}
          drawdownWeight={drawdownWeight}
          onPnlWeightChange={(val) => onWeightsChange(val, sharpeWeight, drawdownWeight)}
          onSharpeWeightChange={(val) => onWeightsChange(pnlWeight, val, drawdownWeight)}
          onDrawdownWeightChange={(val) => onWeightsChange(pnlWeight, sharpeWeight, val)}
        />
      </div>

      {/* Symbol Selection */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Label className="text-base font-semibold">Symbols to Optimize</Label>
        </div>
        <div className="rounded-lg border bg-card p-4">
          {/* Select All */}
          <div className="mb-3 flex items-center space-x-2 border-b pb-3">
            <Checkbox
              id="select-all"
              checked={allSelected}
              onCheckedChange={handleToggleAll}
              className={someSelected ? 'data-[state=checked]:bg-primary/50' : ''}
            />
            <label
              htmlFor="select-all"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              {allSelected ? 'Deselect All' : 'Select All'} ({selectedSymbols.length}/{availableSymbols.length})
            </label>
          </div>

          {/* Individual Symbols */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {availableSymbols.map(symbol => (
              <div key={symbol} className="flex items-center space-x-2">
                <Checkbox
                  id={`symbol-${symbol}`}
                  checked={selectedSymbols.includes(symbol)}
                  onCheckedChange={() => handleToggleSymbol(symbol)}
                />
                <label
                  htmlFor={`symbol-${symbol}`}
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  {symbol}
                </label>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Advanced Options (Collapsible) */}
      <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between">
            <span className="text-sm font-medium">Advanced Options</span>
            {showAdvanced ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 space-y-4 rounded-lg border bg-muted/30 p-4">
          <p className="text-xs text-muted-foreground">
            Advanced optimization options coming soon:
          </p>
          <ul className="text-xs text-muted-foreground space-y-1 pl-4">
            <li>• Train/Test split configuration</li>
            <li>• Walk-forward analysis</li>
            <li>• Custom time windows</li>
            <li>• Parameter ranges</li>
          </ul>
        </CollapsibleContent>
      </Collapsible>

      {/* Start Button */}
      <div className="flex items-center gap-3 pt-2">
        <Button
          onClick={handleStart}
          disabled={isStarting || selectedSymbols.length === 0}
          className="flex-1"
          size="lg"
        >
          {isStarting ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Starting Optimization...
            </>
          ) : (
            <>
              <Play className="mr-2 h-5 w-5" />
              Start Optimization
            </>
          )}
        </Button>
        {selectedSymbols.length === 0 && (
          <p className="text-sm text-destructive">
            Select at least one symbol
          </p>
        )}
      </div>

      {/* Info Text */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/30">
        <p className="text-xs text-blue-900 dark:text-blue-200">
          💡 <strong>Tip:</strong> Optimization typically takes 2-5 minutes per symbol.
          The optimizer will test thousands of parameter combinations to find the best configuration.
        </p>
      </div>
    </div>
  );
}
