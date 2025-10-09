'use client';

import React, { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, ArrowUpDown, TrendingUp, TrendingDown } from 'lucide-react';

interface SymbolRecommendation {
  symbol: string;
  thresholds: {
    current: { long: number; short: number };
    optimized: { long: number; short: number };
  };
  settings: {
    current: any;
    optimized: any;
  };
  improvement: {
    long: number;
    short: number;
    total: number;
  };
  performance?: any;
  scoring?: any;
}

interface SymbolRecommendationsTableProps {
  recommendations: SymbolRecommendation[];
}

export function SymbolRecommendationsTable({ recommendations }: SymbolRecommendationsTableProps) {
  const [sortBy, setSortBy] = useState<'symbol' | 'improvement'>('improvement');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleSort = (column: 'symbol' | 'improvement') => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
  };

  const toggleRow = (symbol: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(symbol)) {
      newExpanded.delete(symbol);
    } else {
      newExpanded.add(symbol);
    }
    setExpandedRows(newExpanded);
  };

  const sortedRecommendations = [...recommendations].sort((a, b) => {
    if (sortBy === 'symbol') {
      return sortOrder === 'asc'
        ? a.symbol.localeCompare(b.symbol)
        : b.symbol.localeCompare(a.symbol);
    } else {
      const aImprovement = a.improvement?.total || 0;
      const bImprovement = b.improvement?.total || 0;
      return sortOrder === 'asc'
        ? aImprovement - bImprovement
        : bImprovement - aImprovement;
    }
  });

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[50px]"></TableHead>
            <TableHead>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggleSort('symbol')}
                className="h-8 px-2 lg:px-3"
              >
                Symbol
                <ArrowUpDown className="ml-2 h-4 w-4" />
              </Button>
            </TableHead>
            <TableHead>Current TP/SL</TableHead>
            <TableHead>Optimized TP/SL</TableHead>
            <TableHead>Leverage</TableHead>
            <TableHead>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggleSort('improvement')}
                className="h-8 px-2 lg:px-3"
              >
                Improvement
                <ArrowUpDown className="ml-2 h-4 w-4" />
              </Button>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedRecommendations.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No recommendations available
              </TableCell>
            </TableRow>
          ) : (
            sortedRecommendations.map((rec) => {
              const isExpanded = expandedRows.has(rec.symbol);
              const improvement = rec.improvement?.total || 0;
              const isPositive = improvement > 0;

              return (
                <React.Fragment key={rec.symbol}>
                  <TableRow className="cursor-pointer hover:bg-muted/50">
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleRow(rec.symbol)}
                        className="h-8 w-8 p-0"
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>
                    </TableCell>
                    <TableCell className="font-medium">{rec.symbol}</TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <span className="text-muted-foreground">TP:</span> {rec.settings?.current?.tpPercent || 0}%
                        <span className="mx-1">/</span>
                        <span className="text-muted-foreground">SL:</span> {rec.settings?.current?.slPercent || 0}%
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">
                        <span className="text-muted-foreground">TP:</span> {rec.settings?.optimized?.tpPercent || 0}%
                        <span className="mx-1">/</span>
                        <span className="text-muted-foreground">SL:</span> {rec.settings?.optimized?.slPercent || 0}%
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">{rec.settings?.current?.leverage || 0}x</span>
                        <span>→</span>
                        <span className="text-sm font-medium">{rec.settings?.optimized?.leverage || 0}x</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {isPositive ? (
                          <TrendingUp className="h-4 w-4 text-green-600" />
                        ) : (
                          <TrendingDown className="h-4 w-4 text-red-600" />
                        )}
                        <Badge
                          variant={isPositive ? "default" : "secondary"}
                          className={isPositive ? "bg-green-600" : ""}
                        >
                          {isPositive ? '+' : ''}{improvement.toFixed(1)}%
                        </Badge>
                      </div>
                    </TableCell>
                  </TableRow>

                  {/* Expanded Details Row */}
                  {isExpanded && (
                    <TableRow>
                      <TableCell colSpan={6} className="bg-muted/30 p-6">
                        <div className="space-y-4">
                          <h4 className="font-semibold text-sm">Detailed Metrics</h4>
                          <div className="grid gap-4 md:grid-cols-3">
                            {/* Thresholds */}
                            <div className="space-y-2">
                              <p className="text-sm font-medium text-muted-foreground">Volume Thresholds</p>
                              <div className="space-y-1 text-sm">
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Long (Current):</span>
                                  <span>${rec.thresholds?.current?.long?.toFixed(0) || 0}</span>
                                </div>
                                <div className="flex justify-between font-medium">
                                  <span className="text-muted-foreground">Long (Optimized):</span>
                                  <span>${rec.thresholds?.optimized?.long?.toFixed(0) || 0}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Short (Current):</span>
                                  <span>${rec.thresholds?.current?.short?.toFixed(0) || 0}</span>
                                </div>
                                <div className="flex justify-between font-medium">
                                  <span className="text-muted-foreground">Short (Optimized):</span>
                                  <span>${rec.thresholds?.optimized?.short?.toFixed(0) || 0}</span>
                                </div>
                              </div>
                            </div>

                            {/* Trade Size */}
                            <div className="space-y-2">
                              <p className="text-sm font-medium text-muted-foreground">Trade Size</p>
                              <div className="space-y-1 text-sm">
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Current:</span>
                                  <span>${rec.settings?.current?.tradeSize?.toFixed(2) || 0}</span>
                                </div>
                                <div className="flex justify-between font-medium">
                                  <span className="text-muted-foreground">Optimized:</span>
                                  <span>${rec.settings?.optimized?.tradeSize?.toFixed(2) || 0}</span>
                                </div>
                              </div>
                            </div>

                            {/* Performance */}
                            {rec.performance && (
                              <div className="space-y-2">
                                <p className="text-sm font-medium text-muted-foreground">Performance</p>
                                <div className="space-y-1 text-sm">
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">Win Rate:</span>
                                    <span>{rec.performance?.optimized?.winRate?.toFixed(1) || 0}%</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">Sharpe:</span>
                                    <span>{rec.performance?.optimized?.sharpeRatio?.toFixed(2) || 0}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">Max DD:</span>
                                    <span>${rec.performance?.optimized?.maxDrawdown?.toFixed(2) || 0}</span>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
