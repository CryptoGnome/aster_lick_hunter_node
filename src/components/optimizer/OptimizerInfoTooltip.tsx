'use client';

import React from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { InfoIcon } from 'lucide-react';

/**
 * OptimizerInfoTooltip Component
 * 
 * Educational tooltip explaining how the optimizer works
 */
export function OptimizerInfoTooltip() {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <InfoIcon className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-md" side="bottom" align="end">
          <div className="space-y-3">
            <h4 className="font-semibold text-sm">How the Optimizer Works</h4>
            
            <ul className="text-xs space-y-1.5 text-muted-foreground">
              <li className="flex gap-2">
                <span className="text-primary">•</span>
                <span>Analyzes 7 days of liquidation cascade data</span>
              </li>
              <li className="flex gap-2">
                <span className="text-primary">•</span>
                <span>Backtests thousands of parameter combinations per symbol</span>
              </li>
              <li className="flex gap-2">
                <span className="text-primary">•</span>
                <span>Tests volume thresholds, TP/SL, leverage, and trade sizes</span>
              </li>
              <li className="flex gap-2">
                <span className="text-primary">•</span>
                <span>Scores strategies using weighted metrics (PnL, Sharpe, Drawdown)</span>
              </li>
              <li className="flex gap-2">
                <span className="text-primary">•</span>
                <span>Optimizes capital allocation across symbols</span>
              </li>
              <li className="flex gap-2">
                <span className="text-primary">•</span>
                <span>Validates with realistic slippage & commission models</span>
              </li>
            </ul>

            <div className="pt-2 border-t text-xs space-y-1">
              <p className="text-muted-foreground">
                ⏱️ Typically takes 10-30 minutes to complete
              </p>
              <p className="text-yellow-600 dark:text-yellow-400">
                ⚠️ Keep this page open during optimization
              </p>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

