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
import { TrendingUp, DollarSign, Target, Layers, Shield, BarChart3 } from 'lucide-react';
import type { OptimizationResults, SymbolRecommendation } from '@/types/optimizer';

interface OptimizerResultsProps {
  results: OptimizationResults;
}

/**
 * OptimizerResults Component
 *
 * Displays before/after comparison of optimization results
 * Shows summary cards and detailed per-symbol comparison table
 */
export function OptimizerResults({ results }: OptimizerResultsProps) {
  const { summary, recommendations } = results;

  const formatCurrency = (value: number | null | undefined) => {
    if (!Number.isFinite(value ?? NaN)) {
      return '—';
    }
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value as number);
  };

  const formatNumber = (value: number | null | undefined, decimals: number = 2) => {
    if (!Number.isFinite(value ?? NaN)) {
      return '—';
    }
    return (value as number).toFixed(decimals);
  };

  const formatPercent = (value: number | null | undefined) => {
    if (!Number.isFinite(value ?? NaN)) {
      return '—';
    }
    const numeric = value as number;
    return `${numeric >= 0 ? '+' : ''}${numeric.toFixed(1)}%`;
  };

  const getChangeColor = (value: number | null | undefined) => {
    if (!Number.isFinite(value ?? NaN)) {
      return 'text-muted-foreground';
    }
    if ((value as number) > 0) return 'text-green-600 dark:text-green-400';
    if ((value as number) < 0) return 'text-red-600 dark:text-red-400';
    return 'text-muted-foreground';
  };

  const computePercentChange = (optimized: number | null | undefined, current: number | null | undefined) => {
    if (!Number.isFinite(optimized ?? NaN) || !Number.isFinite(current ?? NaN) || Math.abs(current as number) < 1e-6) {
      return null;
    }
    return (((optimized as number) - (current as number)) / (current as number)) * 100;
  };

  const formatInteger = (value: number | null | undefined) => {
    if (!Number.isFinite(value ?? NaN)) {
      return '—';
    }
    return Math.round(value as number).toLocaleString();
  };

  const formatDuration = (ms?: number | null) => {
    if (!Number.isFinite(ms ?? NaN) || (ms ?? 0) <= 0) {
      return 'n/a';
    }
    if ((ms as number) >= 1000) {
      return `${((ms as number) / 1000).toFixed(2)}s`;
    }
    return `${Math.round(ms as number)}ms`;
  };

  const formatLabel = (raw: string) =>
    raw
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Layers className="h-4 w-4" />
              Recommended Max Positions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatNumber(summary.recommendedMaxOpenPositions, 0)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Per-Symbol Comparison Table */}
      <Card>
        <CardHeader>
          <CardTitle>Per-Symbol Optimization Details</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <div className="rounded-md border max-h-[600px] overflow-y-auto">
            <Table className="min-w-[1200px]">
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
                {recommendations.map((rec: SymbolRecommendation) => {
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
                  const marginCurrent = rec.settings.current.maxPositionMarginUSDT ?? rec.settings.current.margin ?? 0;
                  const marginOptimized = rec.settings.optimized.maxPositionMarginUSDT ?? rec.settings.optimized.margin ?? marginCurrent;
                  const marginDelta = marginOptimized - marginCurrent;
                  const leverageDelta = rec.settings.optimized.leverage - rec.settings.current.leverage;

                  const longThresholdPercent = computePercentChange(rec.thresholds.optimized.long, rec.thresholds.current.long);
                  const shortThresholdPercent = computePercentChange(rec.thresholds.optimized.short, rec.thresholds.current.short);
                  const tradeSizePercent = computePercentChange(rec.settings.optimized.tradeSize, rec.settings.current.tradeSize);
                  const marginPercent = computePercentChange(marginOptimized, marginCurrent);
                  const leveragePercent = computePercentChange(rec.settings.optimized.leverage, rec.settings.current.leverage);
                  const windowPercent = computePercentChange(optimizedWindowSec, currentWindowSec);
                  const cooldownPercent = computePercentChange(optimizedCooldownSec, currentCooldownSec);

                  const risk = rec.risk;
                  const diagnostics = rec.diagnostics;
                  const scenarioCount = risk?.scenarios?.length ?? 0;
                  const summaryParts: string[] = [];
                  if (scenarioCount > 0) {
                    summaryParts.push(`${scenarioCount} scenario${scenarioCount === 1 ? '' : 's'}`);
                  }
                  if (Number.isFinite(diagnostics?.combinationsEvaluated ?? NaN)) {
                    summaryParts.push(`${formatInteger(diagnostics?.combinationsEvaluated)} combos`);
                  }
                  if (Number.isFinite(diagnostics?.durationMs ?? NaN) && (diagnostics?.durationMs ?? 0) > 0) {
                    summaryParts.push(`runtime ${formatDuration(diagnostics?.durationMs)}`);
                  }
                  const summaryMeta = summaryParts.join(' • ');

                  return (
                    <React.Fragment key={rec.symbol}>
                      <TableRow className="bg-muted/50">
                        <TableCell rowSpan={rec.tierWarning?.hasWarning ? 11 : 10} className="font-medium align-top">
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
                        <TableCell className="text-muted-foreground">Margin / Side</TableCell>
                        <TableCell className="text-right">{formatNumber(marginCurrent)}</TableCell>
                        <TableCell className="text-right">{formatNumber(marginOptimized)}</TableCell>
                        <TableCell className={`text-right ${getChangeColor(marginDelta)}`}>
                          {marginCurrent > 0 ? formatPercent(marginPercent) : 'n/a'}
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
                      {rec.tierWarning?.hasWarning && (
                        <TableRow className="bg-yellow-50 dark:bg-yellow-950/20">
                          <TableCell className="text-yellow-700 dark:text-yellow-400" colSpan={4}>
                            <div className="flex items-start gap-2">
                              <span className="text-lg">⚠️</span>
                              <div className="flex-1">
                                <div className="font-medium">Leverage Tier Limit Restriction</div>
                                <div className="text-sm mt-1">
                                  Max DCA positions: <strong>{rec.tierWarning.maxLongPositions}L / {rec.tierWarning.maxShortPositions}S</strong>
                                  {' '}(wanted {rec.tierWarning.wantedLongPositions}L / {rec.tierWarning.wantedShortPositions}S)
                                </div>
                                <div className="text-xs text-muted-foreground mt-1">
                                  Consider reducing leverage or trade size for more DCA room
                                </div>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
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

                      <TableRow>
                        <TableCell colSpan={4} className="p-0">
                          <details className="border-t border-muted/40 bg-background/80">
                            <summary className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                              <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                <Shield className="h-4 w-4" /> {rec.symbol} Risk & Diagnostics
                              </span>
                              <span className="text-xs text-muted-foreground md:text-right">
                                {summaryMeta || 'Expand for scenario outcomes & candidate funnel'}
                              </span>
                            </summary>
                            <div className="px-3 pb-4 pt-2 space-y-4">
                              {risk && (
                                <div className="grid gap-4 md:grid-cols-2">
                                  <div className="rounded-md border p-4">
                                    <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                                      <Shield className="h-3.5 w-3.5" /> Current Risk
                                    </h4>
                                    <dl className="space-y-2 text-sm">
                                      <div className="flex items-center justify-between">
                                        <dt className="text-muted-foreground">Volatility Penalty</dt>
                                        <dd className="font-medium">{formatNumber(risk.current.volatilityPenalty)}</dd>
                                      </div>
                                      <div className="flex items-center justify-between">
                                        <dt className="text-muted-foreground">CVaR Penalty</dt>
                                        <dd className="font-medium">{formatNumber(risk.current.cvarPenalty)}</dd>
                                      </div>
                                      <div className="flex items-center justify-between">
                                        <dt className="text-muted-foreground">Tail Loss (CVaR)</dt>
                                        <dd className="font-medium">{formatCurrency(risk.current.cvar)}</dd>
                                      </div>
                                      <div className="flex items-center justify-between">
                                        <dt className="text-muted-foreground">Scenario Penalty</dt>
                                        <dd className="font-medium">—</dd>
                                      </div>
                                      <div className="flex items-center justify-between">
                                        <dt className="text-muted-foreground">Payoff Ratio</dt>
                                        <dd className="font-medium">{formatNumber(risk.current.payoffRatio)}</dd>
                                      </div>
                                    </dl>
                                  </div>
                                  <div className="rounded-md border p-4">
                                    <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                                      <Shield className="h-3.5 w-3.5" /> Optimized Risk
                                    </h4>
                                    <dl className="space-y-2 text-sm">
                                      <div className="flex items-center justify-between">
                                        <dt className="text-muted-foreground">Volatility Penalty</dt>
                                        <dd className="font-medium">{formatNumber(risk.optimized.volatilityPenalty)}</dd>
                                      </div>
                                      <div className="flex items-center justify-between">
                                        <dt className="text-muted-foreground">CVaR Penalty</dt>
                                        <dd className="font-medium">{formatNumber(risk.optimized.cvarPenalty)}</dd>
                                      </div>
                                      <div className="flex items-center justify-between">
                                        <dt className="text-muted-foreground">Scenario Penalty</dt>
                                        <dd className="font-medium">{formatNumber(risk.optimized.scenarioPenalty)}</dd>
                                      </div>
                                      <div className="flex items-center justify-between">
                                        <dt className="text-muted-foreground">Tail Loss (CVaR)</dt>
                                        <dd className="font-medium">{formatCurrency(risk.optimized.cvar)}</dd>
                                      </div>
                                      <div className="flex items-center justify-between">
                                        <dt className="text-muted-foreground">Payoff Ratio</dt>
                                        <dd className="font-medium">{formatNumber(risk.optimized.payoffRatio)}</dd>
                                      </div>
                                    </dl>
                                  </div>
                                </div>
                              )}

                              {risk?.scenarios && risk.scenarios.length > 0 && (
                                <div className="rounded-md border p-4">
                                  <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                                    <BarChart3 className="h-3.5 w-3.5" /> Scenario Outcomes
                                  </h4>
                                  <div className="overflow-x-auto">
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead>Scenario</TableHead>
                                          <TableHead className="text-right">Total PnL</TableHead>
                                          <TableHead className="text-right">Max Drawdown</TableHead>
                                          <TableHead className="text-right">Sharpe</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {risk.scenarios.map((scenario) => (
                                          <TableRow key={`${rec.symbol}-${scenario.name}`}>
                                            <TableCell className="font-medium uppercase">{scenario.name}</TableCell>
                                            <TableCell className="text-right">{formatCurrency(scenario.totalPnl)}</TableCell>
                                            <TableCell className="text-right">{formatCurrency(scenario.maxDrawdown)}</TableCell>
                                            <TableCell className="text-right">{formatNumber(scenario.sharpeRatio)}</TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </div>
                                </div>
                              )}

                              {diagnostics && (
                                <div className="grid gap-4 md:grid-cols-2">
                                  <div className="rounded-md border p-4">
                                    <h4 className="text-sm font-semibold mb-3">Candidate Funnel</h4>
                                    {diagnostics.candidateCounts && Object.keys(diagnostics.candidateCounts).length > 0 ? (
                                      <div className="space-y-2 text-sm">
                                        {Object.entries(diagnostics.candidateCounts)
                                          .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                                          .map(([key, value]) => (
                                            <div className="flex items-center justify-between" key={key}>
                                              <span className="text-muted-foreground">{formatLabel(key)}</span>
                                              <span className="font-medium">{formatInteger(value)}</span>
                                            </div>
                                          ))}
                                      </div>
                                    ) : (
                                      <p className="text-sm text-muted-foreground">No candidate counts recorded.</p>
                                    )}
                                    <div className="mt-3 space-y-1 text-sm">
                                      <div className="flex items-center justify-between">
                                        <span className="text-muted-foreground">Combos Evaluated</span>
                                        <span className="font-medium">{formatInteger(diagnostics.combinationsEvaluated)}</span>
                                      </div>
                                      <div className="flex items-center justify-between">
                                        <span className="text-muted-foreground">Combos Accepted</span>
                                        <span className="font-medium">{formatInteger(diagnostics.combinationsAccepted)}</span>
                                      </div>
                                      {Number.isFinite(diagnostics.tierAdjustments ?? NaN) && diagnostics.tierAdjustments ? (
                                        <div className="flex items-center justify-between">
                                          <span className="text-muted-foreground">Tier Adjustments</span>
                                          <span className="font-medium">{formatInteger(diagnostics.tierAdjustments)}</span>
                                        </div>
                                      ) : null}
                                      <div className="flex items-center justify-between">
                                        <span className="text-muted-foreground">Scenarios Evaluated</span>
                                        <span className="font-medium">{formatInteger(diagnostics.scenariosEvaluated)}</span>
                                      </div>
                                      <div className="flex items-center justify-between">
                                        <span className="text-muted-foreground">Runtime</span>
                                        <span className="font-medium">{formatDuration(diagnostics.durationMs)}</span>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="rounded-md border p-4">
                                    <h4 className="text-sm font-semibold mb-3">Rejection Breakdown</h4>
                                    {diagnostics.rejections && Object.values(diagnostics.rejections).some((value) => value > 0) ? (
                                      <ul className="space-y-1 text-sm">
                                        {Object.entries(diagnostics.rejections)
                                          .filter(([, value]) => (value ?? 0) > 0)
                                          .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                                          .slice(0, 8)
                                          .map(([key, value]) => (
                                            <li className="flex items-center justify-between" key={key}>
                                              <span className="text-muted-foreground">{formatLabel(key)}</span>
                                              <span className="font-medium">{formatInteger(value)}</span>
                                            </li>
                                          ))}
                                      </ul>
                                    ) : (
                                      <p className="text-sm text-muted-foreground">No rejection categories triggered.</p>
                                    )}
                                    <div className="mt-3 space-y-1 text-sm">
                                      <div className="flex items-center justify-between">
                                        <span className="text-muted-foreground">Backtests Executed</span>
                                        <span className="font-medium">{formatInteger(diagnostics.backtests?.executed)}</span>
                                      </div>
                                      <div className="flex items-center justify-between">
                                        <span className="text-muted-foreground">Cache Hits</span>
                                        <span className="font-medium">{formatInteger(diagnostics.backtests?.cacheHits)}</span>
                                      </div>
                                      {(() => {
                                        const executed = diagnostics.backtests?.executed ?? 0;
                                        const cacheHits = diagnostics.backtests?.cacheHits ?? 0;
                                        const total = executed + cacheHits;
                                        const hitRate = total > 0 ? (cacheHits / total) * 100 : null;
                                        return (
                                          <div className="flex items-center justify-between">
                                            <span className="text-muted-foreground">Cache Hit Rate</span>
                                            <span className="font-medium">{formatPercent(hitRate)}</span>
                                          </div>
                                        );
                                      })()}
                                    </div>
                                  </div>
                                </div>
                              )}
                              {!risk && !diagnostics && (
                                <p className="text-sm text-muted-foreground">
                                  No additional diagnostics were captured for this symbol. Enable the diagnostics toggle before running a thorough sweep to record candidate funnels and rejection breakdowns.
                                </p>
                              )}
                            </div>
                          </details>
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
