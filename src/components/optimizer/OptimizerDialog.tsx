'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Zap, Settings, BarChart3, CheckCircle2, Download, Info } from 'lucide-react';
import { OptimizerWeightSliders } from './OptimizerWeightSliders';
import { OptimizerProgressBar } from './OptimizerProgressBar';
import { OptimizerResults } from './OptimizerResults';
import { OptimizerInfoTooltip } from './OptimizerInfoTooltip';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useConfig } from '@/components/ConfigProvider';
import { Switch } from '@/components/ui/switch';

interface OptimizerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onOptimizationComplete: (improvementPercent: number) => void;
  onOptimizationStart: () => void;
  onOptimizationCancel: () => void;
  jobId: string | null;
  onJobIdChange: (jobId: string | null) => void;
  results: any | null;
  onResultsChange: (results: any | null) => void;
}

/**
 * OptimizerDialog Component
 * 
 * Main modal with 3 tabs:
 * 1. Configuration - Set weights and parameters
 * 2. Progress - Real-time optimization progress
 * 3. Results - Before/After comparison and apply button
 */
export function OptimizerDialog({
  isOpen,
  onClose,
  onOptimizationComplete,
  onOptimizationStart,
  onOptimizationCancel,
  jobId,
  onJobIdChange,
  results,
  onResultsChange,
}: OptimizerDialogProps) {
  const { config, reloadConfig } = useConfig();
  const [activeTab, setActiveTab] = useState<'config' | 'progress' | 'results'>('config');

  // Weight configuration
  const [pnlWeight, setPnlWeight] = useState(50);
  const [sharpeWeight, setSharpeWeight] = useState(30);
  const [drawdownWeight, setDrawdownWeight] = useState(20);
  const [mode, setMode] = useState<'quick' | 'thorough'>('quick');
  const [enableDiagnostics, setEnableDiagnostics] = useState(false);
  const [availableSymbols, setAvailableSymbols] = useState<string[]>([]);
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [progressSymbols, setProgressSymbols] = useState<string[] | null>(null);

  const [isStarting, setIsStarting] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  // Reset to config tab when dialog opens
  useEffect(() => {
    if (isOpen && !jobId) {
      setActiveTab('config');
      onResultsChange(null);
      setProgressSymbols(null);
    }
  }, [isOpen, jobId, onResultsChange]);

  useEffect(() => {
    if (isOpen && results) {
      setActiveTab('results');
    }
  }, [isOpen, results]);

  useEffect(() => {
    if (!config?.symbols) {
      setAvailableSymbols([]);
      setSelectedSymbols([]);
      return;
    }

    const symbols = Object.keys(config.symbols);
    setAvailableSymbols(symbols);
    setSelectedSymbols((prev) => {
      if (prev.length === 0) {
        return symbols;
      }

      const filtered = prev.filter((symbol) => symbols.includes(symbol));
      return filtered.length > 0 ? filtered : symbols;
    });
  }, [config]);

  // Prevent closing during optimization
  useEffect(() => {
    if (jobId && activeTab === 'progress') {
      const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        e.preventDefault();
        e.returnValue = '';
      };
      
      window.addEventListener('beforeunload', handleBeforeUnload);
      return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }
  }, [jobId, activeTab]);

  const handleStartOptimization = async () => {
    setIsStarting(true);
    onOptimizationStart();

    try {
      const response = await fetch('/api/optimizer/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weights: {
            pnl: pnlWeight,
            sharpe: sharpeWeight,
            drawdown: drawdownWeight,
          },
          mode,
          diagnostics: enableDiagnostics,
          symbols: selectedSymbols,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to start optimization');
      }

      onJobIdChange(data.jobId);
      if (typeof data.mode === 'string') {
        setMode(data.mode === 'thorough' ? 'thorough' : 'quick');
      }
      const allSelected = selectedSymbols.length === availableSymbols.length;
      setProgressSymbols(allSelected ? null : selectedSymbols);
      setActiveTab('progress');

      toast.success('Optimization Started', {
        description:
          data.message ||
          `Your configuration is being optimized${enableDiagnostics ? ' with diagnostics enabled' : ''}...`,
      });
    } catch (error) {
      console.error('Error starting optimization:', error);
      toast.error('Failed to start optimization', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
      });
      onOptimizationCancel();
    } finally {
      setIsStarting(false);
    }
  };

  const handleOptimizationComplete = (optimizationResults: any) => {
    onResultsChange(optimizationResults);
    setActiveTab('results');
    setProgressSymbols(null);

    const improvementPercent = optimizationResults.summary.improvementPercent || 0;
    onOptimizationComplete(improvementPercent);

    toast.success('Optimization Complete!', {
      description: `Found ${optimizationResults.summary.dailyImprovement >= 0 ? '+' : ''}$${optimizationResults.summary.dailyImprovement.toFixed(2)}/day improvement`,
    });
  };

  const handleOptimizationError = (error: string) => {
    toast.error('Optimization Failed', {
      description: error,
    });
    onOptimizationCancel();
    onJobIdChange(null);
    onResultsChange(null);
    setActiveTab('config');
    setProgressSymbols(null);
  };

  const handleCancel = () => {
    onOptimizationCancel();
    onJobIdChange(null);
    onResultsChange(null);
    setActiveTab('config');
    setProgressSymbols(null);
  };

  const handleApplyChanges = async () => {
    if (!jobId) return;

    setIsApplying(true);

    try {
      const response = await fetch('/api/optimizer/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to apply configuration');
      }

      toast.success('Configuration Applied', {
        description: `${data.message}\nBackup saved: ${data.backupPath}`,
      });

      // Reload config to reflect changes in UI
      await reloadConfig();

      // Reset and close
      onJobIdChange(null);
      onResultsChange(null);
      onClose();
    } catch (error) {
      console.error('Error applying configuration:', error);
      toast.error('Failed to apply configuration', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
      });
    } finally {
      setIsApplying(false);
    }
  };

  const handleDownloadResults = () => {
    if (!results) return;

    const dataStr = JSON.stringify(results, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `optimization-results-${new Date().toISOString()}.json`;
    link.click();
    URL.revokeObjectURL(url);

    handleCancel();
  };

  const canStartOptimization = 
    Math.abs(pnlWeight + sharpeWeight + drawdownWeight - 100) < 0.1 &&
    selectedSymbols.length > 0;

  const symbolSelectionDisabled = isStarting || !!jobId;
  const allSymbolsSelected = selectedSymbols.length === availableSymbols.length && availableSymbols.length > 0;

  const selectionSummary = selectedSymbols.length === 0
    ? 'Select at least one symbol to start the optimizer.'
    : `${selectedSymbols.length} of ${availableSymbols.length} symbols selected${allSymbolsSelected ? ' (all)' : ''}.`;

  const progressSymbolLabel = progressSymbols && progressSymbols.length > 0
    ? (progressSymbols.length > 8
      ? `${progressSymbols.slice(0, 8).join(', ')}, …`
      : progressSymbols.join(', '))
    : 'All symbols';

  const handleSymbolSelectionChange = (symbol: string, checked: boolean) => {
    setSelectedSymbols((prev) => {
      const nextSet = new Set(prev);
      if (checked) {
        nextSet.add(symbol);
      } else {
        nextSet.delete(symbol);
      }
      const ordered = availableSymbols.filter((item) => nextSet.has(item));
      return ordered;
    });
  };

  const handleSelectAllSymbols = () => {
    if (symbolSelectionDisabled) return;
    setSelectedSymbols([...availableSymbols]);
  };

  const handleClearAllSymbols = () => {
    if (symbolSelectionDisabled) return;
    setSelectedSymbols([]);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[98vw] max-w-[98vw] sm:max-w-[1200px] lg:max-w-[1400px] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              <DialogTitle>Configuration Optimizer</DialogTitle>
            </div>
            <OptimizerInfoTooltip />
          </div>
          <DialogDescription>
            Optimize your trading configuration using historical backtest analysis
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="config" disabled={jobId !== null && !results && activeTab !== 'config'}>
              <Settings className="h-4 w-4 mr-2" />
              Configuration
            </TabsTrigger>
            <TabsTrigger value="progress" disabled={!jobId}>
              <BarChart3 className="h-4 w-4 mr-2" />
              Progress
            </TabsTrigger>
            <TabsTrigger value="results" disabled={!results}>
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Results
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto mt-4">
            <TabsContent value="config" className="space-y-6 mt-0">
              <div>
                <h3 className="text-lg font-semibold mb-4">Scoring Weights</h3>
                <OptimizerWeightSliders
                  pnlWeight={pnlWeight}
                  sharpeWeight={sharpeWeight}
                  drawdownWeight={drawdownWeight}
                  onPnlWeightChange={setPnlWeight}
                  onSharpeWeightChange={setSharpeWeight}
                  onDrawdownWeightChange={setDrawdownWeight}
                />
              </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold">Symbol Scope</h3>
                  <p className="text-sm text-muted-foreground">
                    Choose which symbols to include in this optimizer run.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleSelectAllSymbols}
                    disabled={symbolSelectionDisabled || availableSymbols.length === 0}
                  >
                    Select All
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleClearAllSymbols}
                    disabled={symbolSelectionDisabled || selectedSymbols.length === 0}
                  >
                    Clear
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border bg-muted/20 p-3 max-h-56 overflow-y-auto space-y-2">
                {availableSymbols.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No symbols configured.</p>
                ) : (
                  availableSymbols.map((symbol) => {
                    const checked = selectedSymbols.includes(symbol);
                    return (
                      <label
                        key={symbol}
                        className="flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm font-medium bg-background/40"
                      >
                        <span>{symbol}</span>
                        <Switch
                          checked={checked}
                          onCheckedChange={(state) => handleSymbolSelectionChange(symbol, state)}
                          disabled={symbolSelectionDisabled}
                          aria-label={`Toggle ${symbol}`}
                        />
                      </label>
                    );
                  })
                )}
              </div>

              <div className="text-sm text-muted-foreground">
                {selectionSummary}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold">Run Mode</h3>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground"
                        disabled={isStarting || !!jobId}
                      >
                        <Info className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <div className="max-w-xs space-y-1 text-left">
                        <p className="font-semibold">Quick</p>
                        <p className="text-muted-foreground">Trims the search grid for a fast 10–20 minute sweep. Ideal for daily tuning.</p>
                        <p className="font-semibold pt-2">Thorough</p>
                        <p className="text-muted-foreground">Runs the full search space with deeper combos (30–60 minutes) for exhaustive analysis.</p>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <span className="text-sm text-muted-foreground">
                  {mode === 'thorough' ? 'Best accuracy, longer runtime' : 'Balanced accuracy with fast runtime'}
                </span>
              </div>

              <div className="flex gap-3">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant={mode === 'quick' ? 'default' : 'outline'}
                      onClick={() => setMode('quick')}
                      disabled={isStarting || !!jobId}
                      className="flex-1"
                    >
                      Quick
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Use a trimmed candidate grid to finish in roughly 10–20 minutes.</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant={mode === 'thorough' ? 'default' : 'outline'}
                      onClick={() => setMode('thorough')}
                      disabled={isStarting || !!jobId}
                      className="flex-1"
                    >
                      Thorough
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Explore the full grid for maximum accuracy (30–60 minute runs).</TooltipContent>
                </Tooltip>
              </div>
            </div>

            <div className="rounded-lg border bg-muted/30 px-4 py-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h4 className="text-sm font-semibold">Capture Diagnostics</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    Enables per-symbol candidate funnels, rejection breakdowns, backtest cache metrics, and scenario counts in the results. Recommended for thorough runs.
                  </p>
                </div>
                <Switch
                  checked={enableDiagnostics}
                  onCheckedChange={setEnableDiagnostics}
                  disabled={isStarting || !!jobId}
                  aria-label="Enable optimizer diagnostics"
                />
              </div>
            </div>

              <div className="flex justify-end pt-4">
                <Button
                  onClick={handleStartOptimization}
                  disabled={!canStartOptimization || isStarting || !!jobId}
                  size="lg"
                  className="gap-2"
                >
                  {isStarting ? (
                    <>Loading...</>
                  ) : (
                    <>
                      <Zap className="h-4 w-4" />
                      Start Optimization
                    </>
                  )}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="progress" className="mt-0">
              {jobId && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                    <span className="font-medium">Run Mode</span>
                    <span className="text-muted-foreground">
                      {mode === 'thorough' ? 'Thorough • exhaustive search' : 'Quick • fast sweep'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                    <span className="font-medium">Diagnostics</span>
                    <span className="text-muted-foreground">
                      {enableDiagnostics ? 'Enabled — exporting rejection & scenario data' : 'Disabled'}
                    </span>
                  </div>
                  <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                    <span className="font-medium">Symbol Scope</span>
                    <div className="mt-1 text-muted-foreground">
                      {progressSymbolLabel}
                    </div>
                  </div>
                  <div className="rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">
                    💡 <strong>Tip:</strong> You can safely close this dialog while the optimizer runs. Progress will continue to be visible next to the &ldquo;Optimize Config&rdquo; button on the main dashboard.
                  </div>
                  <OptimizerProgressBar
                    jobId={jobId}
                    onComplete={handleOptimizationComplete}
                    onCancel={handleCancel}
                    onError={handleOptimizationError}
                    onModeUpdate={(jobMode) => setMode(jobMode)}
                    onDiagnosticsUpdate={(flag) => setEnableDiagnostics(flag)}
                    onSymbolsUpdate={(symbols) => setProgressSymbols(symbols && symbols.length ? symbols : null)}
                  />
                </div>
              )}
            </TabsContent>

            <TabsContent value="results" className="mt-0">
              {results && <OptimizerResults results={results} />}
              
              <div className="flex items-center justify-between gap-4 pt-6 border-t mt-6">
                <Button
                  variant="outline"
                  onClick={handleDownloadResults}
                  className="gap-2"
                >
                  <Download className="h-4 w-4" />
                  Download Results
                </Button>

                <div className="flex gap-2">
                  <Button variant="outline" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleApplyChanges}
                    disabled={isApplying}
                    className="gap-2"
                  >
                    {isApplying ? 'Applying...' : 'Apply Changes'}
                  </Button>
                </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

