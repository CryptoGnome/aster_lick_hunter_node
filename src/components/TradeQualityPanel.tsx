'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  TrendingUp, 
  TrendingDown, 
  Activity, 
  Zap, 
  BarChart3, 
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Target,
  ChevronDown,
  ChevronUp,
  LineChart,
  Gauge,
  Clock,
  ArrowUpDown,
  Percent,
  Volume2
} from 'lucide-react';
import websocketService from '@/lib/services/websocketService';
import { cn } from '@/lib/utils';

interface TradeQualityScore {
  symbol: string;
  side: 'BUY' | 'SELL';
  totalScore: number;
  spikeScore: number;
  volumeTrendScore: number;
  regimeScore: number;
  metrics: {
    priceChangePercent: number;
    spikeTimeSeconds: number;
    spikeVelocity: number;
    recentVolumeRatio: number;
    vwapCrossCount: number;
    vwapCrossesPerHour: number;
    isChoppyRegime: boolean;
    isTrendingRegime: boolean;
    vwapDistance: number;
    isAboveVwap: boolean;
  };
  recommendation: 'STRONG' | 'NORMAL' | 'WEAK' | 'SKIP';
  positionSizeMultiplier: number;
  targetMultiplier: number;
  reasons: string[];
}

interface TradeOpportunity {
  symbol: string;
  side: 'BUY' | 'SELL';
  reason: string;
  liquidationVolume: number;
  priceImpact: number;
  confidence: number;
  qualityScore?: TradeQualityScore;
  qualityRecommendation?: string;
  timestamp: number;
}

interface FTAExitSignal {
  symbol: string;
  side: 'BUY' | 'SELL';
  exitType: 'FTA_PRICE' | 'TIME_INVALIDATION' | 'ABNORMAL_MAE';
  reason: string;
  confidence: number;
  timestamp: number;
}

interface SymbolMetrics {
  symbol: string;
  vwapCrossCount: number;
  vwapCrossesPerHour: number;
  isChoppyRegime: boolean;
  isTrendingRegime: boolean;
  lastPriceChange: number;
  lastVolumeRatio: number;
  recentScores: number[];
  lastUpdate: number;
}

// Mini bar chart for visualizing scores
function MiniBarChart({ values, maxValue = 3, color = 'blue' }: { values: number[], maxValue?: number, color?: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    red: 'bg-red-500',
    purple: 'bg-purple-500'
  };
  
  return (
    <div className="flex items-end gap-0.5 h-8">
      {values.slice(-10).map((val, idx) => (
        <div
          key={idx}
          className={cn("w-2 rounded-t transition-all", colors[color] || colors.blue)}
          style={{ 
            height: `${Math.min((val / maxValue) * 100, 100)}%`,
            opacity: 0.3 + (idx / 10) * 0.7
          }}
        />
      ))}
    </div>
  );
}

// Circular gauge for displaying scores
function ScoreGauge({ score, maxScore = 3, label, size = 'sm' }: { score: number, maxScore?: number, label: string, size?: 'sm' | 'md' }) {
  const percentage = (score / maxScore) * 100;
  const radius = size === 'sm' ? 20 : 28;
  const strokeWidth = size === 'sm' ? 4 : 5;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;
  
  const getColor = () => {
    if (percentage >= 80) return 'text-green-500 stroke-green-500';
    if (percentage >= 50) return 'text-blue-500 stroke-blue-500';
    if (percentage >= 30) return 'text-yellow-500 stroke-yellow-500';
    return 'text-red-500 stroke-red-500';
  };

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: (radius + strokeWidth) * 2, height: (radius + strokeWidth) * 2 }}>
        <svg className="transform -rotate-90" width="100%" height="100%">
          <circle
            cx={radius + strokeWidth}
            cy={radius + strokeWidth}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-muted/20"
          />
          <circle
            cx={radius + strokeWidth}
            cy={radius + strokeWidth}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className={cn("transition-all duration-500", getColor())}
          />
        </svg>
        <div className={cn("absolute inset-0 flex items-center justify-center font-bold", getColor(), size === 'sm' ? 'text-sm' : 'text-lg')}>
          {score}
        </div>
      </div>
      <span className="text-[10px] text-muted-foreground mt-1">{label}</span>
    </div>
  );
}

// VWAP Cross Indicator
function VWAPCrossIndicator({ crossCount, isChoppy, isTrending }: { crossCount: number, isChoppy: boolean, isTrending: boolean }) {
  const dots = Array.from({ length: 10 }, (_, i) => i < Math.min(crossCount, 10));
  
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">VWAP Crosses/hr</span>
        <span className={cn(
          "text-sm font-bold",
          isChoppy ? "text-red-400" : isTrending ? "text-green-400" : "text-blue-400"
        )}>
          {crossCount}
        </span>
      </div>
      <div className="flex gap-0.5">
        {dots.map((active, idx) => (
          <div
            key={idx}
            className={cn(
              "flex-1 h-2 rounded-full transition-all",
              active 
                ? idx < 3 ? "bg-green-500" : idx < 6 ? "bg-yellow-500" : "bg-red-500"
                : "bg-muted/30"
            )}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>Trending</span>
        <span>Neutral</span>
        <span>Choppy</span>
      </div>
    </div>
  );
}

export default function TradeQualityPanel({ className, isPassiveMode = false }: { className?: string; isPassiveMode?: boolean }) {
  const [recentOpportunities, setRecentOpportunities] = useState<TradeOpportunity[]>([]);
  const [ftaAlerts, setFtaAlerts] = useState<FTAExitSignal[]>([]);
  const [symbolMetrics, setSymbolMetrics] = useState<Map<string, SymbolMetrics>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  const handleMessage = useCallback((message: any) => {
    if (message.type === 'trade_opportunity') {
      const opportunity: TradeOpportunity = {
        ...message.data,
        timestamp: Date.now()
      };
      
      setRecentOpportunities(prev => {
        const updated = [opportunity, ...prev].slice(0, 10);
        return updated;
      });

      // Update symbol metrics
      if (opportunity.qualityScore?.metrics) {
        const metrics = opportunity.qualityScore.metrics;
        const score = opportunity.qualityScore;
        
        setSymbolMetrics(prev => {
          const updated = new Map(prev);
          const existing = updated.get(opportunity.symbol);
          
          updated.set(opportunity.symbol, {
            symbol: opportunity.symbol,
            vwapCrossCount: metrics.vwapCrossCount,
            vwapCrossesPerHour: metrics.vwapCrossesPerHour,
            isChoppyRegime: metrics.isChoppyRegime,
            isTrendingRegime: metrics.isTrendingRegime,
            lastPriceChange: metrics.priceChangePercent,
            lastVolumeRatio: metrics.recentVolumeRatio,
            recentScores: [...(existing?.recentScores || []), score.totalScore].slice(-10),
            lastUpdate: Date.now()
          });
          return updated;
        });
      }
    } else if (message.type === 'fta_exit_signal') {
      const alert: FTAExitSignal = {
        ...message.data,
        timestamp: Date.now()
      };
      
      setFtaAlerts(prev => [alert, ...prev].slice(0, 5));

      setTimeout(() => {
        setFtaAlerts(prev => prev.filter(a => a.timestamp !== alert.timestamp));
      }, 30000);
    } else if (message.type === 'trade_blocked') {
      if (message.data?.blockType === 'QUALITY_FILTER') {
        const blockedOpp: TradeOpportunity = {
          symbol: message.data.symbol,
          side: message.data.side,
          reason: message.data.reason,
          liquidationVolume: 0,
          priceImpact: 0,
          confidence: 0,
          qualityScore: message.data.qualityScore,
          qualityRecommendation: 'SKIP',
          timestamp: Date.now()
        };
        
        setRecentOpportunities(prev => [blockedOpp, ...prev].slice(0, 10));
      }
    }
  }, []);

  useEffect(() => {
    const cleanupMessageHandler = websocketService.addMessageHandler(handleMessage);
    const cleanupConnectionListener = websocketService.addConnectionListener(setIsConnected);

    return () => {
      cleanupMessageHandler();
      cleanupConnectionListener();
    };
  }, [handleMessage]);

  // Load persisted data from database on mount
  useEffect(() => {
    const loadPersistedData = async () => {
      try {
        // Load recent trade signals from database
        const signalsRes = await fetch('/api/trade-quality?limit=20');
        if (signalsRes.ok) {
          const data = await signalsRes.json();
          if (data.success && data.signals?.length > 0) {
            const opportunities: TradeOpportunity[] = data.signals.map((s: any) => ({
              symbol: s.symbol,
              side: s.side,
              reason: s.reason,
              liquidationVolume: s.liquidationVolume,
              priceImpact: s.priceImpact,
              confidence: s.confidence,
              qualityScore: {
                symbol: s.symbol,
                side: s.side,
                totalScore: s.totalScore,
                spikeScore: s.spikeScore,
                volumeTrendScore: s.volumeTrendScore,
                regimeScore: s.regimeScore,
                positionSizeMultiplier: s.positionSizeMultiplier,
                targetMultiplier: 1,
                metrics: {
                  priceChangePercent: s.priceChangePercent,
                  spikeTimeSeconds: s.spikeTimeSeconds,
                  spikeVelocity: s.spikeVelocity,
                  recentVolumeRatio: s.recentVolumeRatio,
                  vwapCrossCount: s.vwapCrossCount,
                  vwapCrossesPerHour: s.vwapCrossesPerHour,
                  isChoppyRegime: s.isChoppyRegime,
                  isTrendingRegime: s.isTrendingRegime,
                  vwapDistance: s.vwapDistance,
                  isAboveVwap: s.isAboveVwap
                },
                recommendation: s.recommendation,
                reasons: s.reasons || []
              },
              qualityRecommendation: s.recommendation,
              timestamp: s.timestamp
            }));
            setRecentOpportunities(opportunities);
            
            // Build symbol metrics from loaded data
            const metricsMap = new Map<string, SymbolMetrics>();
            for (const opp of opportunities) {
              if (opp.qualityScore?.metrics) {
                const existing = metricsMap.get(opp.symbol);
                metricsMap.set(opp.symbol, {
                  symbol: opp.symbol,
                  vwapCrossCount: opp.qualityScore.metrics.vwapCrossCount,
                  vwapCrossesPerHour: opp.qualityScore.metrics.vwapCrossesPerHour,
                  isChoppyRegime: opp.qualityScore.metrics.isChoppyRegime,
                  isTrendingRegime: opp.qualityScore.metrics.isTrendingRegime,
                  lastPriceChange: opp.qualityScore.metrics.priceChangePercent,
                  lastVolumeRatio: opp.qualityScore.metrics.recentVolumeRatio,
                  recentScores: [...(existing?.recentScores || []), opp.qualityScore.totalScore].slice(-10),
                  lastUpdate: opp.timestamp
                });
              }
            }
            setSymbolMetrics(metricsMap);
          }
        }

        // Load recent FTA signals
        const ftaRes = await fetch('/api/trade-quality?type=fta&limit=5');
        if (ftaRes.ok) {
          const data = await ftaRes.json();
          if (data.success && data.signals?.length > 0) {
            // Only show FTA alerts from last 30 seconds
            const recentAlerts = data.signals.filter((s: any) => 
              Date.now() - s.timestamp < 30000
            ).map((s: any) => ({
              symbol: s.symbol,
              side: s.side,
              exitType: s.exitType,
              reason: s.reason,
              confidence: s.confidence,
              timestamp: s.timestamp
            }));
            setFtaAlerts(recentAlerts);
          }
        }
      } catch (error) {
        console.error('Failed to load persisted trade quality data:', error);
      }
    };

    loadPersistedData();
  }, []);

  const getQualityBadgeStyle = (score: number | undefined) => {
    if (score === undefined) return 'bg-gray-500/20 text-gray-400';
    if (score >= 3) return 'bg-green-500/20 text-green-400 border-green-500/50';
    if (score === 2) return 'bg-blue-500/20 text-blue-400 border-blue-500/50';
    if (score === 1) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50';
    return 'bg-red-500/20 text-red-400 border-red-500/50';
  };

  const getRecommendationIcon = (rec: string | undefined) => {
    switch (rec) {
      case 'STRONG': return <CheckCircle2 className="h-4 w-4 text-green-400" />;
      case 'NORMAL': return <Target className="h-4 w-4 text-blue-400" />;
      case 'WEAK': return <AlertTriangle className="h-4 w-4 text-yellow-400" />;
      case 'SKIP': return <XCircle className="h-4 w-4 text-red-400" />;
      default: return null;
    }
  };

  const formatTime = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h`;
  };

  // Get aggregated stats
  const stats = {
    totalOpportunities: recentOpportunities.length,
    strongSignals: recentOpportunities.filter(o => o.qualityRecommendation === 'STRONG').length,
    skippedTrades: recentOpportunities.filter(o => o.qualityRecommendation === 'SKIP').length,
    avgQuality: recentOpportunities.length > 0 
      ? (recentOpportunities.reduce((sum, o) => sum + (o.qualityScore?.totalScore || 0), 0) / recentOpportunities.length).toFixed(1)
      : '0.0'
  };

  return (
    <Card className={cn("bg-card/50 backdrop-blur-sm border-border/50", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Gauge className="h-4 w-4 text-primary" />
            Trade Quality Analysis
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge 
              variant={isConnected ? (isPassiveMode ? "outline" : "default") : "secondary"} 
              className={cn(
                "text-xs",
                isPassiveMode && isConnected && "border-yellow-500 text-yellow-500"
              )}
            >
              {isConnected ? (isPassiveMode ? 'Passive' : 'Live') : 'Offline'}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      
      {isExpanded && (
        <CardContent className="space-y-4">
          {/* FTA Alerts - Always visible when present */}
          {ftaAlerts.length > 0 && (
            <div className="p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30 space-y-2">
              <div className="flex items-center gap-2 text-yellow-400">
                <AlertTriangle className="h-4 w-4 animate-pulse" />
                <span className="text-xs font-medium">Early Exit Signals</span>
              </div>
              {ftaAlerts.map((alert, idx) => (
                <div key={`${alert.symbol}-${alert.timestamp}-${idx}`} className="text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{alert.symbol}</span>
                    <span className="text-muted-foreground">{formatTime(alert.timestamp)}</span>
                  </div>
                  <p className="text-muted-foreground">{alert.reason}</p>
                </div>
              ))}
            </div>
          )}

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3 h-8">
              <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
              <TabsTrigger value="signals" className="text-xs">Signals</TabsTrigger>
              <TabsTrigger value="symbols" className="text-xs">Symbols</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-3 space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-4 gap-2">
                <div className="text-center p-2 rounded-lg bg-muted/30">
                  <div className="text-lg font-bold">{stats.totalOpportunities}</div>
                  <div className="text-[10px] text-muted-foreground">Signals</div>
                </div>
                <div className="text-center p-2 rounded-lg bg-green-500/10">
                  <div className="text-lg font-bold text-green-400">{stats.strongSignals}</div>
                  <div className="text-[10px] text-muted-foreground">Strong</div>
                </div>
                <div className="text-center p-2 rounded-lg bg-red-500/10">
                  <div className="text-lg font-bold text-red-400">{stats.skippedTrades}</div>
                  <div className="text-[10px] text-muted-foreground">Skipped</div>
                </div>
                <div className="text-center p-2 rounded-lg bg-blue-500/10">
                  <div className="text-lg font-bold text-blue-400">{stats.avgQuality}</div>
                  <div className="text-[10px] text-muted-foreground">Avg Q</div>
                </div>
              </div>

              {/* Latest Signal Details */}
              {recentOpportunities[0] && (
                <div className="p-3 rounded-lg bg-muted/20 border border-border/50">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {recentOpportunities[0].side === 'BUY' ? (
                        <TrendingUp className="h-4 w-4 text-green-400" />
                      ) : (
                        <TrendingDown className="h-4 w-4 text-red-400" />
                      )}
                      <span className="font-medium">{recentOpportunities[0].symbol}</span>
                      <Badge variant="outline" className={cn("text-xs", getQualityBadgeStyle(recentOpportunities[0].qualityScore?.totalScore))}>
                        Q{recentOpportunities[0].qualityScore?.totalScore ?? '?'}/3
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      {getRecommendationIcon(recentOpportunities[0].qualityRecommendation)}
                      <span className="text-xs font-medium">{recentOpportunities[0].qualityRecommendation}</span>
                    </div>
                  </div>

                  {recentOpportunities[0].qualityScore && (
                    <>
                      {/* Score Gauges */}
                      <div className="flex justify-around mb-3">
                        <ScoreGauge score={recentOpportunities[0].qualityScore.spikeScore} maxScore={1} label="Spike" />
                        <ScoreGauge score={recentOpportunities[0].qualityScore.volumeTrendScore} maxScore={1} label="Volume" />
                        <ScoreGauge score={recentOpportunities[0].qualityScore.regimeScore} maxScore={1} label="Regime" />
                        <ScoreGauge score={recentOpportunities[0].qualityScore.totalScore} maxScore={3} label="Total" size="md" />
                      </div>

                      {/* Detailed Metrics */}
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="flex items-center justify-between p-1.5 rounded bg-muted/30">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Zap className="h-3 w-3" /> Price Move
                          </span>
                          <span className={recentOpportunities[0].qualityScore.metrics.priceChangePercent > 0 ? 'text-green-400' : 'text-red-400'}>
                            {recentOpportunities[0].qualityScore.metrics.priceChangePercent.toFixed(2)}%
                          </span>
                        </div>
                        <div className="flex items-center justify-between p-1.5 rounded bg-muted/30">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" /> Spike Time
                          </span>
                          <span>{recentOpportunities[0].qualityScore.metrics.spikeTimeSeconds.toFixed(1)}s</span>
                        </div>
                        <div className="flex items-center justify-between p-1.5 rounded bg-muted/30">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Volume2 className="h-3 w-3" /> Vol Ratio
                          </span>
                          <span className={recentOpportunities[0].qualityScore.metrics.recentVolumeRatio < 1 ? 'text-green-400' : 'text-yellow-400'}>
                            {recentOpportunities[0].qualityScore.metrics.recentVolumeRatio.toFixed(2)}x
                          </span>
                        </div>
                        <div className="flex items-center justify-between p-1.5 rounded bg-muted/30">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <ArrowUpDown className="h-3 w-3" /> VWAP Dist
                          </span>
                          <span>{recentOpportunities[0].qualityScore.metrics.vwapDistance.toFixed(2)}%</span>
                        </div>
                      </div>

                      {/* VWAP Cross Indicator */}
                      <div className="mt-3">
                        <VWAPCrossIndicator 
                          crossCount={recentOpportunities[0].qualityScore.metrics.vwapCrossCount}
                          isChoppy={recentOpportunities[0].qualityScore.metrics.isChoppyRegime}
                          isTrending={recentOpportunities[0].qualityScore.metrics.isTrendingRegime}
                        />
                      </div>

                      {/* Position Size Adjustment */}
                      {recentOpportunities[0].qualityScore.positionSizeMultiplier !== 1 && (
                        <div className="mt-2 p-2 rounded bg-muted/30 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Position Size Adjustment</span>
                            <span className={cn(
                              "font-bold",
                              recentOpportunities[0].qualityScore.positionSizeMultiplier > 1 ? 'text-green-400' : 'text-yellow-400'
                            )}>
                              {recentOpportunities[0].qualityScore.positionSizeMultiplier}x
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Reasons */}
                      {recentOpportunities[0].qualityScore.reasons.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {recentOpportunities[0].qualityScore.reasons.slice(0, 3).map((reason, idx) => (
                            <p key={idx} className="text-[10px] text-muted-foreground">{reason}</p>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="signals" className="mt-3">
              <div className="h-[280px] overflow-y-auto">
                <div className="space-y-2">
                  {recentOpportunities.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-8">
                      Waiting for trade signals...
                    </p>
                  ) : (
                    recentOpportunities.map((opp, idx) => (
                      <div
                        key={`${opp.symbol}-${opp.timestamp}-${idx}`}
                        className={cn(
                          "p-2 rounded-lg border transition-all",
                          opp.qualityRecommendation === 'SKIP' 
                            ? 'bg-red-500/5 border-red-500/20 opacity-70'
                            : opp.qualityRecommendation === 'STRONG'
                            ? 'bg-green-500/5 border-green-500/20'
                            : 'bg-card border-border/50'
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {opp.side === 'BUY' ? (
                              <TrendingUp className="h-3 w-3 text-green-400" />
                            ) : (
                              <TrendingDown className="h-3 w-3 text-red-400" />
                            )}
                            <span className="text-sm font-medium">{opp.symbol}</span>
                            <Badge variant="outline" className={cn("text-[10px]", getQualityBadgeStyle(opp.qualityScore?.totalScore))}>
                              {opp.qualityRecommendation}
                            </Badge>
                          </div>
                          <span className="text-[10px] text-muted-foreground">{formatTime(opp.timestamp)}</span>
                        </div>
                        
                        {opp.qualityScore && (
                          <div className="mt-1.5 flex items-center gap-3 text-[10px]">
                            <span className="text-muted-foreground">
                              S:{opp.qualityScore.spikeScore} V:{opp.qualityScore.volumeTrendScore} R:{opp.qualityScore.regimeScore}
                            </span>
                            {opp.qualityScore.positionSizeMultiplier !== 1 && (
                              <span className="text-blue-400">{opp.qualityScore.positionSizeMultiplier}x size</span>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="symbols" className="mt-3">
              <div className="h-[280px] overflow-y-auto">
                <div className="space-y-3">
                  {symbolMetrics.size === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-8">
                      No symbol data yet...
                    </p>
                  ) : (
                    Array.from(symbolMetrics.values()).map((metrics) => (
                      <div key={metrics.symbol} className="p-2 rounded-lg bg-muted/20 border border-border/50">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium text-sm">{metrics.symbol}</span>
                          <Badge variant="outline" className={cn(
                            "text-[10px]",
                            metrics.isChoppyRegime 
                              ? "text-red-400 border-red-400/50" 
                              : metrics.isTrendingRegime 
                              ? "text-green-400 border-green-400/50" 
                              : "text-blue-400 border-blue-400/50"
                          )}>
                            {metrics.isChoppyRegime ? 'Choppy' : metrics.isTrendingRegime ? 'Trending' : 'Neutral'}
                          </Badge>
                        </div>
                        
                        <VWAPCrossIndicator 
                          crossCount={metrics.vwapCrossCount}
                          isChoppy={metrics.isChoppyRegime}
                          isTrending={metrics.isTrendingRegime}
                        />
                        
                        {metrics.recentScores.length > 0 && (
                          <div className="mt-2">
                            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                              <span>Recent Scores</span>
                              <span>Avg: {(metrics.recentScores.reduce((a, b) => a + b, 0) / metrics.recentScores.length).toFixed(1)}</span>
                            </div>
                            <MiniBarChart values={metrics.recentScores} color="blue" />
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      )}
    </Card>
  );
}
