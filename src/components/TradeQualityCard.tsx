'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  TrendingUp, 
  TrendingDown, 
  Activity, 
  Zap, 
  BarChart3, 
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Target
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

interface MarketRegimeInfo {
  symbol: string;
  vwapCrossCount: number;
  isChoppyRegime: boolean;
  isTrendingRegime: boolean;
}

export default function TradeQualityCard() {
  const [recentOpportunities, setRecentOpportunities] = useState<TradeOpportunity[]>([]);
  const [ftaAlerts, setFtaAlerts] = useState<FTAExitSignal[]>([]);
  const [marketRegimes, setMarketRegimes] = useState<Map<string, MarketRegimeInfo>>(new Map());
  const [isConnected, setIsConnected] = useState(false);

  const handleMessage = useCallback((message: any) => {
    if (message.type === 'trade_opportunity') {
      const opportunity: TradeOpportunity = {
        ...message.data,
        timestamp: Date.now()
      };
      
      setRecentOpportunities(prev => {
        // Keep only last 5 opportunities
        const updated = [opportunity, ...prev].slice(0, 5);
        return updated;
      });

      // Extract regime info if available
      if (opportunity.qualityScore?.metrics) {
        const metrics = opportunity.qualityScore.metrics;
        setMarketRegimes(prev => {
          const updated = new Map(prev);
          updated.set(opportunity.symbol, {
            symbol: opportunity.symbol,
            vwapCrossCount: metrics.vwapCrossCount,
            isChoppyRegime: metrics.isChoppyRegime,
            isTrendingRegime: metrics.isTrendingRegime
          });
          return updated;
        });
      }
    } else if (message.type === 'fta_exit_signal') {
      const alert: FTAExitSignal = {
        ...message.data,
        timestamp: Date.now()
      };
      
      setFtaAlerts(prev => {
        // Keep only last 3 alerts
        const updated = [alert, ...prev].slice(0, 3);
        return updated;
      });

      // Auto-dismiss alerts after 30 seconds
      setTimeout(() => {
        setFtaAlerts(prev => prev.filter(a => a.timestamp !== alert.timestamp));
      }, 30000);
    } else if (message.type === 'trade_blocked') {
      // Handle blocked trades (quality too low)
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
        
        setRecentOpportunities(prev => {
          const updated = [blockedOpp, ...prev].slice(0, 5);
          return updated;
        });
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

  const getQualityColor = (score: number | undefined) => {
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

  const getRegimeBadge = (regime: MarketRegimeInfo) => {
    if (regime.isChoppyRegime) {
      return (
        <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30 text-xs">
          <Activity className="h-3 w-3 mr-1" />
          Choppy ({regime.vwapCrossCount}/hr)
        </Badge>
      );
    } else if (regime.isTrendingRegime) {
      return (
        <Badge variant="outline" className="bg-orange-500/10 text-orange-400 border-orange-500/30 text-xs">
          <TrendingUp className="h-3 w-3 mr-1" />
          Trending ({regime.vwapCrossCount}/hr)
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-gray-500/10 text-gray-400 border-gray-500/30 text-xs">
        Neutral ({regime.vwapCrossCount}/hr)
      </Badge>
    );
  };

  const formatTime = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
  };

  return (
    <Card className="bg-card/50 backdrop-blur-sm border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            Trade Quality Monitor
          </CardTitle>
          <Badge variant={isConnected ? "default" : "secondary"} className="text-xs">
            {isConnected ? 'Live' : 'Offline'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* FTA Exit Alerts */}
        {ftaAlerts.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 text-yellow-500" />
              Early Exit Alerts
            </h4>
            {ftaAlerts.map((alert, idx) => (
              <div
                key={`${alert.symbol}-${alert.timestamp}-${idx}`}
                className="p-2 rounded-md bg-yellow-500/10 border border-yellow-500/30 animate-pulse"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={cn(
                      "text-xs",
                      alert.side === 'BUY' ? 'text-green-400' : 'text-red-400'
                    )}>
                      {alert.symbol}
                    </Badge>
                    <span className="text-xs text-yellow-400">
                      {alert.exitType.replace('_', ' ')}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatTime(alert.timestamp)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{alert.reason}</p>
              </div>
            ))}
          </div>
        )}

        {/* Market Regime Overview */}
        {marketRegimes.size > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground">Market Regimes</h4>
            <div className="flex flex-wrap gap-2">
              {Array.from(marketRegimes.values()).slice(0, 4).map((regime) => (
                <div key={regime.symbol} className="flex items-center gap-1">
                  <span className="text-xs font-mono">{regime.symbol.replace('USDT', '')}</span>
                  {getRegimeBadge(regime)}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Trade Opportunities */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Zap className="h-3 w-3" />
            Recent Opportunities
          </h4>
          
          {recentOpportunities.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              Waiting for trade signals...
            </p>
          ) : (
            <div className="space-y-2">
              {recentOpportunities.map((opp, idx) => (
                <div
                  key={`${opp.symbol}-${opp.timestamp}-${idx}`}
                  className={cn(
                    "p-2 rounded-md border transition-all",
                    opp.qualityRecommendation === 'SKIP' 
                      ? 'bg-red-500/5 border-red-500/20 opacity-60'
                      : 'bg-card border-border/50'
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      {opp.side === 'BUY' ? (
                        <TrendingUp className="h-3 w-3 text-green-400" />
                      ) : (
                        <TrendingDown className="h-3 w-3 text-red-400" />
                      )}
                      <span className="text-sm font-medium">{opp.symbol}</span>
                      <Badge 
                        variant="outline" 
                        className={cn("text-xs border", getQualityColor(opp.qualityScore?.totalScore))}
                      >
                        Q{opp.qualityScore?.totalScore ?? '?'}/3
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      {getRecommendationIcon(opp.qualityRecommendation)}
                      <span className="text-xs text-muted-foreground">
                        {formatTime(opp.timestamp)}
                      </span>
                    </div>
                  </div>
                  
                  {opp.qualityScore && (
                    <div className="grid grid-cols-3 gap-1 mt-2">
                      <div className="text-center">
                        <div className="text-[10px] text-muted-foreground">Spike</div>
                        <Progress 
                          value={opp.qualityScore.spikeScore * 100} 
                          className="h-1 mt-0.5"
                        />
                      </div>
                      <div className="text-center">
                        <div className="text-[10px] text-muted-foreground">Volume</div>
                        <Progress 
                          value={opp.qualityScore.volumeTrendScore * 100} 
                          className="h-1 mt-0.5"
                        />
                      </div>
                      <div className="text-center">
                        <div className="text-[10px] text-muted-foreground">Regime</div>
                        <Progress 
                          value={opp.qualityScore.regimeScore * 100} 
                          className="h-1 mt-0.5"
                        />
                      </div>
                    </div>
                  )}

                  {opp.qualityRecommendation === 'SKIP' && (
                    <p className="text-[10px] text-red-400 mt-1">
                      Trade skipped: {opp.reason}
                    </p>
                  )}

                  {opp.qualityScore?.positionSizeMultiplier && opp.qualityScore.positionSizeMultiplier !== 1 && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Position size: {opp.qualityScore.positionSizeMultiplier}x
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
