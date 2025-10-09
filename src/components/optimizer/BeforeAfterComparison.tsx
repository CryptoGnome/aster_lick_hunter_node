'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowUp, ArrowDown, TrendingUp, Award, AlertTriangle } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: string | number;
  change?: number;
  isGoodChange?: boolean;
}

function MetricCard({ label, value, change, isGoodChange }: MetricCardProps) {
  const hasChange = change !== undefined && change !== null && !isNaN(change);
  const isPositive = hasChange && change > 0;
  const isImprovement = hasChange && ((isGoodChange && isPositive) || (!isGoodChange && !isPositive));

  return (
    <div className="space-y-1">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="flex items-baseline gap-2">
        <p className="text-2xl font-bold">{value}</p>
        {hasChange && (
          <div className={`flex items-center gap-1 text-sm font-medium ${
            isImprovement ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
          }`}>
            {isPositive ? (
              <ArrowUp className="h-4 w-4" />
            ) : (
              <ArrowDown className="h-4 w-4" />
            )}
            <span>{Math.abs(change).toFixed(1)}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

interface BeforeAfterComparisonProps {
  results: {
    summary: {
      currentDailyPnl: number;
      optimizedDailyPnl: number;
      dailyImprovement: number;
      monthlyImprovement: number;
      improvementPercent: number | null;
    };
    recommendations?: any[];
  };
}

export function BeforeAfterComparison({ results }: BeforeAfterComparisonProps) {
  const { summary } = results;

  // Calculate aggregate metrics from recommendations if available
  const aggregateMetrics = results.recommendations?.reduce(
    (acc, rec) => {
      const current = rec.performance?.current || {};
      const optimized = rec.performance?.optimized || {};

      return {
        currentSharpe: acc.currentSharpe + (current.sharpeRatio || 0),
        optimizedSharpe: acc.optimizedSharpe + (optimized.sharpeRatio || 0),
        currentDrawdown: Math.max(acc.currentDrawdown, current.maxDrawdown || 0),
        optimizedDrawdown: Math.max(acc.optimizedDrawdown, optimized.maxDrawdown || 0),
        currentWinRate: acc.currentWinRate + (current.winRate || 0),
        optimizedWinRate: acc.optimizedWinRate + (optimized.winRate || 0),
        count: acc.count + 1,
      };
    },
    {
      currentSharpe: 0,
      optimizedSharpe: 0,
      currentDrawdown: 0,
      optimizedDrawdown: 0,
      currentWinRate: 0,
      optimizedWinRate: 0,
      count: 0,
    }
  ) || { count: 0 };

  const avgCurrentSharpe = aggregateMetrics.count > 0 ? aggregateMetrics.currentSharpe / aggregateMetrics.count : 0;
  const avgOptimizedSharpe = aggregateMetrics.count > 0 ? aggregateMetrics.optimizedSharpe / aggregateMetrics.count : 0;
  const avgCurrentWinRate = aggregateMetrics.count > 0 ? aggregateMetrics.currentWinRate / aggregateMetrics.count : 0;
  const avgOptimizedWinRate = aggregateMetrics.count > 0 ? aggregateMetrics.optimizedWinRate / aggregateMetrics.count : 0;

  const sharpeChange = avgCurrentSharpe > 0 ? ((avgOptimizedSharpe - avgCurrentSharpe) / avgCurrentSharpe) * 100 : 0;
  const drawdownChange = aggregateMetrics.currentDrawdown > 0
    ? ((aggregateMetrics.optimizedDrawdown - aggregateMetrics.currentDrawdown) / aggregateMetrics.currentDrawdown) * 100
    : 0;
  const winRateChange = avgCurrentWinRate > 0 ? ((avgOptimizedWinRate - avgCurrentWinRate) / avgCurrentWinRate) * 100 : 0;

  const improvementPercent = summary.improvementPercent ?? 0;
  const isPositiveImprovement = improvementPercent > 0;

  return (
    <div className="space-y-6">
      {/* Overall Improvement Banner */}
      <div className={`rounded-lg border-2 p-4 ${
        isPositiveImprovement
          ? 'border-green-500 bg-green-50 dark:bg-green-950/20'
          : 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20'
      }`}>
        <div className="flex items-center gap-3">
          {isPositiveImprovement ? (
            <Award className="h-8 w-8 text-green-600 dark:text-green-400" />
          ) : (
            <AlertTriangle className="h-8 w-8 text-yellow-600 dark:text-yellow-400" />
          )}
          <div>
            <h3 className="text-lg font-semibold">
              {isPositiveImprovement ? 'Optimization Successful!' : 'Current Configuration is Competitive'}
            </h3>
            <p className="text-sm text-muted-foreground">
              {isPositiveImprovement
                ? `Projected improvement of ${improvementPercent.toFixed(1)}% in daily PnL`
                : 'Your current settings are already well-optimized. Consider the small adjustments below.'
              }
            </p>
          </div>
        </div>
      </div>

      {/* Before/After Comparison Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Before (Current) */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Current Configuration</CardTitle>
              <Badge variant="outline">Before</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <MetricCard
              label="Daily PnL"
              value={`$${summary.currentDailyPnl.toFixed(2)}`}
            />
            <MetricCard
              label="Sharpe Ratio"
              value={avgCurrentSharpe.toFixed(2)}
            />
            <MetricCard
              label="Max Drawdown"
              value={`$${aggregateMetrics.currentDrawdown.toFixed(2)}`}
            />
            <MetricCard
              label="Win Rate"
              value={`${avgCurrentWinRate.toFixed(1)}%`}
            />
          </CardContent>
        </Card>

        {/* After (Optimized) */}
        <Card className="border-primary/50 bg-primary/5">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Optimized Configuration</CardTitle>
              <Badge className="bg-primary">After</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <MetricCard
              label="Daily PnL"
              value={`$${summary.optimizedDailyPnl.toFixed(2)}`}
              change={improvementPercent}
              isGoodChange={true}
            />
            <MetricCard
              label="Sharpe Ratio"
              value={avgOptimizedSharpe.toFixed(2)}
              change={sharpeChange}
              isGoodChange={true}
            />
            <MetricCard
              label="Max Drawdown"
              value={`$${aggregateMetrics.optimizedDrawdown.toFixed(2)}`}
              change={drawdownChange}
              isGoodChange={false}
            />
            <MetricCard
              label="Win Rate"
              value={`${avgOptimizedWinRate.toFixed(1)}%`}
              change={winRateChange}
              isGoodChange={true}
            />
          </CardContent>
        </Card>
      </div>

      {/* Projected Monthly Improvement */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <TrendingUp className="h-6 w-6 text-primary" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Projected Monthly Improvement</p>
                <p className="text-2xl font-bold">${summary.monthlyImprovement.toFixed(2)}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Annual Projection</p>
              <p className="text-xl font-semibold">${(summary.monthlyImprovement * 12).toFixed(2)}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
