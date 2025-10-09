export interface ScenarioOutcome {
  name: string;
  totalPnl: number;
  maxDrawdown: number;
  sharpeRatio: number;
}

export interface RiskProfile {
  current: {
    volatilityPenalty?: number | null;
    cvarPenalty?: number | null;
    cvar?: number | null;
    payoffRatio?: number | null;
  };
  optimized: {
    volatilityPenalty?: number | null;
    cvarPenalty?: number | null;
    scenarioPenalty?: number | null;
    cvar?: number | null;
    payoffRatio?: number | null;
  };
  scenarios?: ScenarioOutcome[];
}

export interface DiagnosticsSummary {
  candidateCounts?: Record<string, number>;
  rejections?: Record<string, number>;
  backtests?: {
    executed?: number;
    cacheHits?: number;
  };
  combinationsEvaluated?: number;
  combinationsAccepted?: number;
  scenariosEvaluated?: number;
  durationMs?: number | null;
  tierAdjustments?: number;
}

export interface SymbolSettingsSnapshot {
  tradeSize: number;
  longTradeSize: number;
  shortTradeSize: number;
  maxPositionMarginUSDT?: number;
  margin?: number;
  leverage: number;
  tpPercent: number;
  slPercent: number;
  maxPositionsLong?: number;
  maxPositionsShort?: number;
  thresholdTimeWindow?: number;
  thresholdCooldown?: number;
  vwapProtection?: boolean;
}

export interface PerformanceLeg {
  trades: number;
  winRate: number;
  pnl: number;
  sharpe: number;
  maxDrawdown: number;
}

export interface PerformanceSnapshot {
  long: PerformanceLeg;
  short: PerformanceLeg;
}

export interface ScoringSummary {
  finalScore?: number;
  sharpeRatio?: number;
  drawdownScore?: number;
  weights?: {
    pnl: number;
    sharpe: number;
    drawdown: number;
  };
  weightPercent?: {
    pnl: number;
    sharpe: number;
    drawdown: number;
  };
}

export interface SymbolRecommendation {
  symbol: string;
  tierWarning?: {
    hasWarning: boolean;
    maxLongPositions?: number;
    wantedLongPositions?: number;
    maxShortPositions?: number;
    wantedShortPositions?: number;
    message?: string;
  };
  thresholds: {
    current: { long: number; short: number };
    optimized: { long: number; short: number };
  };
  settings: {
    current: SymbolSettingsSnapshot;
    optimized: SymbolSettingsSnapshot;
  };
  risk?: RiskProfile;
  diagnostics?: DiagnosticsSummary | null;
  improvement: {
    long: number;
    short: number;
    total: number;
  };
  performance: {
    current: PerformanceSnapshot;
    optimized: PerformanceSnapshot;
  };
  scoring: ScoringSummary;
}

export interface OptimizationResults {
  timestamp: string;
  summary: {
    currentDailyPnl: number;
    optimizedDailyPnl: number;
    dailyImprovement: number;
    monthlyImprovement: number;
    improvementPercent: number | null;
    recommendedMaxOpenPositions: number;
  };
  recommendations: SymbolRecommendation[];
  capitalAllocation: any;
  optimizedConfig: any;
}
