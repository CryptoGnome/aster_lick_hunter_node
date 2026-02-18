'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  Gauge,
  ArrowUpDown,
  Filter,
  Info,
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
  blockType?: 'QUALITY_FILTER' | 'VWAP_FILTER' | 'CASCADE_PROTECTION';
  timestamp: number;
  signalPrice?: number;
}

interface FTAExitSignal {
  symbol: string;
  side: 'BUY' | 'SELL';
  exitType: 'FTA_PRICE' | 'TIME_INVALIDATION' | 'ABNORMAL_MAE';
  reason: string;
  confidence: number;
  timestamp: number;
}

type SignalFilter = 'ALL' | 'TAKEN' | 'SKIPPED';

export default function TradeQualityPanel({ className, isPassiveMode = false }: { className?: string; isPassiveMode?: boolean }) {
  const [recentOpportunities, setRecentOpportunities] = useState<TradeOpportunity[]>([]);
  const [ftaAlerts, setFtaAlerts] = useState<FTAExitSignal[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedSignal, setExpandedSignal] = useState<number | null>(null);
  const [filter, setFilter] = useState<SignalFilter>('ALL');

  const handleMessage = useCallback((message: any) => {
    if (message.type === 'trade_opportunity') {
      const opportunity: TradeOpportunity = {
        ...message.data,
        timestamp: Date.now()
      };
      setRecentOpportunities(prev => [opportunity, ...prev].slice(0, 50));
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
      const blockType = message.data?.blockType;
      if (blockType === 'QUALITY_FILTER' || blockType === 'VWAP_FILTER' || blockType === 'CASCADE_PROTECTION') {
        const blockedOpp: TradeOpportunity = {
          symbol: message.data.symbol,
          side: message.data.side,
          reason: message.data.reason,
          liquidationVolume: message.data.liquidationVolume || 0,
          priceImpact: 0,
          confidence: 0,
          qualityScore: message.data.qualityScore,
          qualityRecommendation: blockType === 'VWAP_FILTER' ? 'VWAP' : blockType === 'CASCADE_PROTECTION' ? 'CASCADE' : 'SKIP',
          blockType: blockType,
          timestamp: Date.now(),
          signalPrice: message.data.signalPrice
        };
        setRecentOpportunities(prev => [blockedOpp, ...prev].slice(0, 50));
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
        const signalsRes = await fetch('/api/trade-quality?limit=50');
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
              qualityRecommendation: s.blockReason === 'VWAP_FILTER' ? 'VWAP' : s.blockReason === 'CASCADE_PROTECTION' ? 'CASCADE' : s.recommendation,
              blockType: s.blockReason === 'VWAP_FILTER' ? 'VWAP_FILTER' : s.blockReason === 'CASCADE_PROTECTION' ? 'CASCADE_PROTECTION' : (s.wasBlocked ? 'QUALITY_FILTER' : undefined),
              timestamp: s.timestamp,
              signalPrice: s.signalPrice
            }));
            setRecentOpportunities(opportunities);
          }
        }

        const ftaRes = await fetch('/api/trade-quality?type=fta&limit=5');
        if (ftaRes.ok) {
          const data = await ftaRes.json();
          if (data.success && data.signals?.length > 0) {
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

  const formatTime = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  };

  const getOutcome = (opp: TradeOpportunity): { label: string; color: string; icon: React.ReactNode } => {
    if (opp.blockType === 'CASCADE_PROTECTION') {
      return { label: 'CASCADE', color: 'text-purple-400 bg-purple-500/15 border-purple-500/30', icon: <AlertTriangle className="h-3 w-3" /> };
    }
    if (opp.blockType === 'VWAP_FILTER') {
      return { label: 'VWAP', color: 'text-orange-400 bg-orange-500/15 border-orange-500/30', icon: <ArrowUpDown className="h-3 w-3" /> };
    }
    if (opp.blockType === 'QUALITY_FILTER') {
      return { label: 'SKIP', color: 'text-red-400 bg-red-500/15 border-red-500/30', icon: <XCircle className="h-3 w-3" /> };
    }
    // Taken trades — show quality recommendation
    if (opp.qualityRecommendation === 'STRONG') {
      return { label: 'STRONG', color: 'text-green-400 bg-green-500/15 border-green-500/30', icon: <CheckCircle2 className="h-3 w-3" /> };
    }
    if (opp.qualityRecommendation === 'WEAK') {
      return { label: 'WEAK', color: 'text-yellow-400 bg-yellow-500/15 border-yellow-500/30', icon: <AlertTriangle className="h-3 w-3" /> };
    }
    if (opp.qualityRecommendation === 'SKIP') {
      // In passive mode, SKIP recommendation still got taken — show as WEAK/TAKEN not SKIP
      return { label: 'LOW-Q', color: 'text-yellow-400 bg-yellow-500/15 border-yellow-500/30', icon: <AlertTriangle className="h-3 w-3" /> };
    }
    return { label: 'NORMAL', color: 'text-blue-400 bg-blue-500/15 border-blue-500/30', icon: <CheckCircle2 className="h-3 w-3" /> };
  };

  // Only count as blocked if there's an actual blockType (not just a low quality recommendation)
  const isBlocked = (opp: TradeOpportunity) =>
    opp.blockType === 'VWAP_FILTER' || opp.blockType === 'QUALITY_FILTER' || opp.blockType === 'CASCADE_PROTECTION';

  // Compute stats
  const taken = recentOpportunities.filter(o => !isBlocked(o));
  const skipped = recentOpportunities.filter(o => isBlocked(o));
  const avgScore = recentOpportunities.length > 0
    ? (recentOpportunities.reduce((sum, o) => sum + (o.qualityScore?.totalScore || 0), 0) / recentOpportunities.length)
    : 0;

  // Filter the displayed list
  const filteredOpportunities = filter === 'ALL'
    ? recentOpportunities
    : filter === 'TAKEN'
    ? taken
    : skipped;

  const formatPrice = (price: number) => {
    if (price < 0.01) return price.toFixed(6);
    if (price < 1) return price.toFixed(4);
    if (price < 100) return price.toFixed(2);
    return price.toLocaleString('en-US', { maximumFractionDigits: 2 });
  };

  return (
    <Card className={cn("bg-card/50 backdrop-blur-sm border-border/50", className)}>
      <CardHeader className="pb-2">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center justify-between w-full hover:opacity-80 transition-opacity"
        >
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Gauge className="h-4 w-4 text-primary" />
            Signal Feed
            <Badge variant="secondary" className="h-5 text-xs px-1.5">
              {recentOpportunities.length}
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            {/* Compact stats always visible */}
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-green-400 font-medium">{taken.length}&#x2713;</span>
              <span className="text-muted-foreground">/</span>
              <span className="text-red-400 font-medium">{skipped.length}&#x2717;</span>
              {avgScore > 0 && (
                <>
                  <span className="text-muted-foreground">&middot;</span>
                  <span className={cn(
                    "font-medium",
                    avgScore >= 2 ? "text-green-400" : avgScore >= 1 ? "text-blue-400" : "text-yellow-400"
                  )}>
                    Q{avgScore.toFixed(1)}
                  </span>
                </>
              )}
            </div>
            <Badge
              variant={isConnected ? (isPassiveMode ? "outline" : "default") : "secondary"}
              className={cn(
                "text-[10px] h-4",
                isPassiveMode && isConnected && "border-yellow-500 text-yellow-500"
              )}
            >
              {isConnected ? (isPassiveMode ? 'Passive' : 'Live') : 'Off'}
            </Badge>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform text-muted-foreground", !isExpanded && '-rotate-90')} />
          </div>
        </button>
      </CardHeader>

      {isExpanded && (
        <CardContent className="pt-0 space-y-3">
          {/* FTA Alerts - Always visible when present */}
          {ftaAlerts.length > 0 && (
            <div className="p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
              <div className="flex items-center gap-2 text-yellow-400 mb-1">
                <AlertTriangle className="h-3 w-3 animate-pulse" />
                <span className="text-xs font-medium">Early Exit Signals</span>
              </div>
              {ftaAlerts.map((alert, idx) => (
                <div key={`fta-${alert.timestamp}-${idx}`} className="text-xs flex items-center justify-between">
                  <span><span className="font-medium">{alert.symbol}</span> &mdash; {alert.reason}</span>
                  <span className="text-muted-foreground ml-2">{formatTime(alert.timestamp)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Filter tabs */}
          <div className="flex items-center gap-1">
            {(['ALL', 'TAKEN', 'SKIPPED'] as SignalFilter[]).map(f => (
              <Button
                key={f}
                variant={filter === f ? 'default' : 'ghost'}
                size="sm"
                className={cn("h-6 text-[10px] px-2", filter === f && f === 'TAKEN' && 'bg-green-600 hover:bg-green-700', filter === f && f === 'SKIPPED' && 'bg-red-600 hover:bg-red-700')}
                onClick={() => setFilter(f)}
              >
                <Filter className="h-2.5 w-2.5 mr-1" />
                {f} {f === 'TAKEN' ? `(${taken.length})` : f === 'SKIPPED' ? `(${skipped.length})` : `(${recentOpportunities.length})`}
              </Button>
            ))}
          </div>

          {/* Signal Feed */}
          <div className="max-h-[320px] overflow-y-auto space-y-1">
            {filteredOpportunities.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">
                {filter === 'ALL' ? 'Waiting for signals...' : `No ${filter.toLowerCase()} signals`}
              </p>
            ) : (
              filteredOpportunities.map((opp, idx) => {
                const outcome = getOutcome(opp);
                const blocked = isBlocked(opp);
                const isOpen = expandedSignal === idx;
                const qs = opp.qualityScore;

                return (
                  <div
                    key={`${opp.symbol}-${opp.timestamp}-${idx}`}
                    className={cn(
                      "rounded-lg border transition-all cursor-pointer",
                      blocked ? "border-border/30 opacity-75" : "border-border/50"
                    )}
                    onClick={() => setExpandedSignal(isOpen ? null : idx)}
                  >
                    {/* Compact row - always visible */}
                    <div className="flex items-center gap-2 px-2.5 py-1.5">
                      {/* Direction */}
                      {opp.side === 'BUY' ? (
                        <TrendingUp className="h-3 w-3 text-green-400 shrink-0" />
                      ) : (
                        <TrendingDown className="h-3 w-3 text-red-400 shrink-0" />
                      )}

                      {/* Symbol + Price */}
                      <span className="text-sm font-medium min-w-[80px]">{opp.symbol}</span>
                      {opp.signalPrice && (
                        <span className="text-[10px] text-muted-foreground font-mono">
                          ${formatPrice(opp.signalPrice)}
                        </span>
                      )}

                      {/* Spacer */}
                      <div className="flex-1" />

                      {/* Quality score pill */}
                      {qs && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={cn(
                              "text-[10px] font-mono px-1.5 rounded cursor-help",
                              qs.totalScore >= 2 ? "text-green-400 bg-green-500/10" :
                              qs.totalScore === 1 ? "text-yellow-400 bg-yellow-500/10" :
                              "text-red-400 bg-red-500/10"
                            )}>
                              {qs.spikeScore}/{qs.volumeTrendScore}/{qs.regimeScore}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-[280px] text-left leading-relaxed">
                            <p className="font-semibold mb-1">Quality Score: {qs.totalScore}/3 (S/V/R)</p>
                            <p><strong>S</strong>pike: {qs.spikeScore === 1 ? '✅' : '❌'} Fast price crash/pump into level</p>
                            <p><strong>V</strong>olume: {qs.volumeTrendScore === 1 ? '✅' : '❌'} Liq volume is decreasing/flat</p>
                            <p><strong>R</strong>egime: {qs.regimeScore === 1 ? '✅' : '❌'} Choppy range (≥3 VWAP crosses/hr)</p>
                            <p className="mt-1 text-[10px] opacity-80">3/3 = STRONG (1.5× size) · 2/3 = NORMAL · 1/3 = WEAK (0.5×) · 0/3 = SKIP</p>
                          </TooltipContent>
                        </Tooltip>
                      )}

                      {/* Outcome badge */}
                      <Badge variant="outline" className={cn("text-[10px] h-4 px-1.5 border", outcome.color)}>
                        {outcome.icon}
                        <span className="ml-0.5">{outcome.label}</span>
                      </Badge>

                      {/* Time ago */}
                      <span className="text-[10px] text-muted-foreground min-w-[24px] text-right">{formatTime(opp.timestamp)}</span>
                    </div>

                    {/* Expanded detail - shown on click */}
                    {isOpen && (
                      <div className="px-2.5 pb-2 space-y-1.5 border-t border-border/30 pt-1.5">
                        {/* Block reason - prominent */}
                        {blocked && opp.reason && (
                          <div className={cn(
                            "text-xs px-2 py-1 rounded flex items-start gap-1.5",
                            opp.blockType === 'CASCADE_PROTECTION'
                              ? "bg-purple-500/10 text-purple-300"
                              : opp.blockType === 'VWAP_FILTER'
                              ? "bg-orange-500/10 text-orange-300"
                              : "bg-red-500/10 text-red-300"
                          )}>
                            {opp.blockType === 'CASCADE_PROTECTION' ? (
                              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                            ) : opp.blockType === 'VWAP_FILTER' ? (
                              <ArrowUpDown className="h-3 w-3 shrink-0 mt-0.5" />
                            ) : (
                              <XCircle className="h-3 w-3 shrink-0 mt-0.5" />
                            )}
                            <span>{opp.reason}</span>
                          </div>
                        )}

                        {/* Metrics grid */}
                        {qs?.metrics && (
                          <div className="grid grid-cols-4 gap-1 text-[10px]">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="px-1.5 py-1 rounded bg-muted/30 cursor-help">
                                  <span className="text-muted-foreground flex items-center gap-0.5">Move <Info className="h-2.5 w-2.5 opacity-50" /></span>
                                  <span className={qs.metrics.priceChangePercent > 0 ? 'text-green-400' : 'text-red-400'}>
                                    {qs.metrics.priceChangePercent.toFixed(2)}%
                                  </span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="max-w-[260px] text-left leading-relaxed">
                                <p className="font-semibold">Price Move</p>
                                <p>The % price moved during the detected spike. For BUY entries, this is the crash size. For SELL, the pump size.</p>
                                <p className="mt-1"><span className="text-green-400">≥0.5%</span> = significant move (scores 1 for spike). <span className="text-yellow-400">&lt;0.5%</span> = minor move (needs high velocity to score).</p>
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="px-1.5 py-1 rounded bg-muted/30 cursor-help">
                                  <span className="text-muted-foreground flex items-center gap-0.5">Spike <Info className="h-2.5 w-2.5 opacity-50" /></span>
                                  <span className={qs.metrics.spikeTimeSeconds > 0 && qs.metrics.spikeTimeSeconds < 30 ? 'text-green-400' : qs.metrics.spikeTimeSeconds === 0 ? 'text-muted-foreground' : 'text-yellow-400'}>
                                    {qs.metrics.spikeTimeSeconds === 0 ? 'none' : `${qs.metrics.spikeTimeSeconds.toFixed(1)}s`}
                                  </span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="max-w-[260px] text-left leading-relaxed">
                                <p className="font-semibold">Spike Duration</p>
                                <p>How quickly the price move happened. Measures from where the rapid move started to now within a 2-min window.</p>
                                <p className="mt-1"><span className="text-green-400">&lt;30s</span> = fast spike, likely to bounce. <span className="text-yellow-400">&gt;60s</span> = slow grind, may continue. <span className="text-muted-foreground">none</span> = no qualifying move in expected direction.</p>
                                <p className="mt-1 text-[10px] opacity-80">Velocity (move÷time) &gt;0.1%/s scores as fast spike regardless of duration.</p>
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="px-1.5 py-1 rounded bg-muted/30 cursor-help">
                                  <span className="text-muted-foreground flex items-center gap-0.5">Vol <Info className="h-2.5 w-2.5 opacity-50" /></span>
                                  <span className={qs.metrics.recentVolumeRatio <= 1.1 ? 'text-green-400' : 'text-yellow-400'}>
                                    {qs.metrics.recentVolumeRatio.toFixed(2)}&times;
                                  </span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="max-w-[260px] text-left leading-relaxed">
                                <p className="font-semibold">Liquidation Volume Trend</p>
                                <p>Ratio of recent liq volume vs older liq volume. Compares the 2nd half of the volume window to the 1st half.</p>
                                <p className="mt-1"><span className="text-green-400">≤1.1×</span> = flat/decreasing volume (exhaustion — good for reversal, scores 1). <span className="text-yellow-400">&gt;1.1×</span> = increasing volume (momentum building — risky).</p>
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="px-1.5 py-1 rounded bg-muted/30 cursor-help">
                                  <span className="text-muted-foreground flex items-center gap-0.5">VWAP <Info className="h-2.5 w-2.5 opacity-50" /></span>
                                  <span>{qs.metrics.vwapDistance.toFixed(2)}%</span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="max-w-[260px] text-left leading-relaxed">
                                <p className="font-semibold">VWAP Distance & Regime</p>
                                <p>Current price distance from 1hr VWAP. Used for regime detection: how many times price crossed VWAP in the last hour.</p>
                                <p className="mt-1"><span className="text-green-400">≥3 crosses/hr</span> = choppy (range-bound — ideal for mean reversion, scores 1). <span className="text-yellow-400">1-2 crosses</span> = neutral. <span className="text-red-400">≤1 cross</span> = trending (scores 0).</p>
                                <p className="mt-1 text-[10px] opacity-80">Currently {qs.metrics.vwapCrossesPerHour} crosses/hr · {qs.metrics.isChoppyRegime ? 'Choppy ✅' : qs.metrics.isTrendingRegime ? 'Trending ❌' : 'Neutral ⚠️'}</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        )}

                        {/* Quality reasons */}
                        {qs?.reasons && qs.reasons.length > 0 && (
                          <div className="space-y-0.5">
                            {qs.reasons.map((reason, ridx) => (
                              <p key={ridx} className="text-[10px] text-muted-foreground pl-1">
                                &bull; {reason}
                              </p>
                            ))}
                          </div>
                        )}

                        {/* Position size adjustment */}
                        {qs && qs.positionSizeMultiplier !== 1 && (
                          <div className="text-[10px] flex items-center gap-1">
                            <span className="text-muted-foreground">Size adj:</span>
                            <span className={qs.positionSizeMultiplier > 1 ? 'text-green-400 font-medium' : 'text-yellow-400 font-medium'}>
                              {qs.positionSizeMultiplier}&times;
                            </span>
                          </div>
                        )}

                        {/* Liq volume if available */}
                        {opp.liquidationVolume > 0 && (
                          <div className="text-[10px] flex items-center gap-1">
                            <span className="text-muted-foreground">Liq vol:</span>
                            <span className="font-mono">${opp.liquidationVolume.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
