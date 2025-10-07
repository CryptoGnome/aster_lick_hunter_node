'use client';

import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, DollarSign, Target } from 'lucide-react';

interface OptimizerResultsProps {
  results: any; // Will be typed from optimizerService
}

/**
 * OptimizerResults Component
 *
 * Displays before/after comparison of optimization results
 * Shows summary cards and detailed per-symbol comparison table
 */
export function OptimizerResults({ results }: OptimizerResultsProps) {
  const { summary, recommendations } = results;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatNumber = (value: number, decimals: number = 2) => {
    return value.toFixed(decimals);
  };

  const formatPercent = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
  };

  const getChangeColor = (value: number) => {
    if (value > 0) return 'text-green-600 dark:text-green-400';
    if (value < 0) return 'text-red-600 dark:text-red-400';
    return 'text-muted-foreground';
  };

  const computePercentChange = (optimized: number, current: number) => {
    if (!Number.isFinite(current) || Math.abs(current) < 1e-6) {
      return 0;
    }
    return ((optimized - current) / current) * 100;
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Current Daily P&L
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCurrency(summary.currentDailyPnl)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Optimized Daily P&L
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">
              {formatCurrency(summary.optimizedDailyPnl)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Daily Improvement
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold ${getChangeColor(summary.dailyImprovement)}`}>
              {formatCurrency(summary.dailyImprovement)}
            </p>
            {summary.improvementPercent !== null && (
              <p className="text-xs text-muted-foreground mt-1">
                {formatPercent(summary.improvementPercent)}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Target className="h-4 w-4" />
              Monthly Projection
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold ${getChangeColor(summary.monthlyImprovement)}`}>
              {formatCurrency(summary.monthlyImprovement)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Per-Symbol Comparison Table */}
      <Card>
        <CardHeader>
          <CardTitle>Per-Symbol Optimization Details</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <div className="rounded-md border max-h-[420px] overflow-y-auto">
            <Table className="min-w-[960px]">
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Metric</TableHead>
                  <TableHead className="text-right">Current</TableHead>
                  <TableHead className="text-right">Optimized</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recommendations.map((rec: any) => {
                  const currentWindowMs = rec.settings.current.thresholdTimeWindow ?? 60000;
                  const optimizedWindowMs = rec.settings.optimized.thresholdTimeWindow ?? rec.settings.current.thresholdTimeWindow ?? 60000;
                  const currentCooldownMs = rec.settings.current.thresholdCooldown ?? 0;
                  const optimizedCooldownMs = rec.settings.optimized.thresholdCooldown ?? rec.settings.current.thresholdCooldown ?? 0;

                  const currentWindowSec = currentWindowMs / 1000;
                  const optimizedWindowSec = optimizedWindowMs / 1000;
                  const currentCooldownSec = currentCooldownMs / 1000;
                  const optimizedCooldownSec = optimizedCooldownMs / 1000;

                  const longThresholdDelta = rec.thresholds.optimized.long - rec.thresholds.current.long;
                  const shortThresholdDelta = rec.thresholds.optimized.short - rec.thresholds.current.short;
                  const tradeSizeDelta = rec.settings.optimized.tradeSize - rec.settings.current.tradeSize;
                  const leverageDelta = rec.settings.optimized.leverage - rec.settings.current.leverage;

                  const longThresholdPercent = computePercentChange(rec.thresholds.optimized.long, rec.thresholds.current.long);
                  const shortThresholdPercent = computePercentChange(rec.thresholds.optimized.short, rec.thresholds.current.short);
                  const tradeSizePercent = computePercentChange(rec.settings.optimized.tradeSize, rec.settings.current.tradeSize);
                  const leveragePercent = computePercentChange(rec.settings.optimized.leverage, rec.settings.current.leverage);
                  const windowPercent = computePercentChange(optimizedWindowSec, currentWindowSec);
                  const cooldownPercent = computePercentChange(optimizedCooldownSec, currentCooldownSec);

                  return (
                    <React.Fragment key={rec.symbol}>
                      <TableRow className="bg-muted/50">
                        <TableCell rowSpan={8} className="font-medium align-top">
                          {rec.symbol}
                          {rec.improvement.total > 0 && (
                            <Badge variant="secondary" className="ml-2">
                              +{formatCurrency(rec.improvement.total)}/day
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">Long Threshold</TableCell>
                        <TableCell className="text-right">{formatNumber(rec.thresholds.current.long, 0)}</TableCell>
                        <TableCell className="text-right">{formatNumber(rec.thresholds.optimized.long, 0)}</TableCell>
                        <TableCell className={`text-right ${getChangeColor(longThresholdDelta)}`}>
                          {formatPercent(longThresholdPercent)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-muted-foreground">Short Threshold</TableCell>
                        <TableCell className="text-right">{formatNumber(rec.thresholds.current.short, 0)}</TableCell>
                        <TableCell className="text-right">{formatNumber(rec.thresholds.optimized.short, 0)}</TableCell>
                        <TableCell className={`text-right ${getChangeColor(shortThresholdDelta)}`}>
                          {formatPercent(shortThresholdPercent)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-muted-foreground">Trade Size</TableCell>
                        <TableCell className="text-right">{formatNumber(rec.settings.current.tradeSize)}</TableCell>
                        <TableCell className="text-right">{formatNumber(rec.settings.optimized.tradeSize)}</TableCell>
                        <TableCell className={`text-right ${getChangeColor(tradeSizeDelta)}`}>
                          {formatPercent(tradeSizePercent)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-muted-foreground">Leverage</TableCell>
                        <TableCell className="text-right">{rec.settings.current.leverage}x</TableCell>
                        <TableCell className="text-right">{rec.settings.optimized.leverage}x</TableCell>
                        <TableCell className={`text-right ${getChangeColor(leverageDelta)}`}>
                          {formatPercent(leveragePercent)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-muted-foreground">Time Window</TableCell>
                        <TableCell className="text-right">{formatNumber(currentWindowSec, 0)}s</TableCell>
                        <TableCell className="text-right">{formatNumber(optimizedWindowSec, 0)}s</TableCell>
                        <TableCell className={`text-right ${getChangeColor(windowPercent)}`}>
                          {formatPercent(windowPercent)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-muted-foreground">Cooldown</TableCell>
                        <TableCell className="text-right">{formatNumber(currentCooldownSec, 0)}s</TableCell>
                        <TableCell className="text-right">{formatNumber(optimizedCooldownSec, 0)}s</TableCell>
                        <TableCell className={`text-right ${getChangeColor(cooldownPercent)}`}>
                          {formatPercent(cooldownPercent)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-muted-foreground">TP / SL</TableCell>
                        <TableCell className="text-right">
                          {rec.settings.current.tpPercent}% / {rec.settings.current.slPercent}%
                        </TableCell>
                        <TableCell className="text-right">
                          {rec.settings.optimized.tpPercent}% / {rec.settings.optimized.slPercent}%
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">-</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-muted-foreground">Daily PnL</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(rec.settings.current.tradeSize * 0.01)}
                        </TableCell>
                        <TableCell className={`text-right ${getChangeColor(rec.improvement.total)}`}>
                          {formatCurrency(rec.improvement.total + rec.settings.current.tradeSize * 0.01)}
                        </TableCell>
                        <TableCell className={`text-right ${getChangeColor(rec.improvement.total)}`}>
                          {formatCurrency(rec.improvement.total)}
                        </TableCell>
                      </TableRow>
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
