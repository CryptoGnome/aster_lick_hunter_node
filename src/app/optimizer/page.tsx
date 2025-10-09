'use client';

import React, { useState } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Target, TrendingUp, Zap } from 'lucide-react';
import { OptimizerConfigPanel } from '@/components/optimizer/OptimizerConfigPanel';
import { OptimizerProgressBar } from '@/components/optimizer/OptimizerProgressBar';
import { BeforeAfterComparison } from '@/components/optimizer/BeforeAfterComparison';
import { SymbolRecommendationsTable } from '@/components/optimizer/SymbolRecommendationsTable';
import { Button } from '@/components/ui/button';
import { Download, CheckCircle, RotateCcw } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from 'sonner';

export default function OptimizerPage() {
  const [activeSection, setActiveSection] = useState<'config' | 'progress' | 'results'>('config');
  const [jobId, setJobId] = useState<string | null>(null);
  const [results, setResults] = useState<any | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  // Weight configuration
  const [pnlWeight, setPnlWeight] = useState(50);
  const [sharpeWeight, setSharpeWeight] = useState(30);
  const [drawdownWeight, setDrawdownWeight] = useState(20);

  const handleWeightsChange = (pnl: number, sharpe: number, drawdown: number) => {
    setPnlWeight(pnl);
    setSharpeWeight(sharpe);
    setDrawdownWeight(drawdown);
  };

  const handleStartOptimization = async (selectedSymbols: string[]) => {
    setIsStarting(true);

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
          symbols: selectedSymbols,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to start optimization');
      }

      setJobId(data.jobId);
      setActiveSection('progress');
      toast.success('Optimization started!', {
        description: `Analyzing ${selectedSymbols.length} symbol(s)...`,
      });
    } catch (error: any) {
      console.error('Failed to start optimization:', error);
      toast.error('Failed to start optimization', {
        description: error.message,
      });
    } finally {
      setIsStarting(false);
    }
  };

  const handleOptimizationComplete = (improvementPercent: number) => {
    setActiveSection('results');
    toast.success('Optimization complete!', {
      description: `Found ${improvementPercent > 0 ? `+${improvementPercent}%` : `${improvementPercent}%`} improvement`,
    });
  };

  const handleOptimizationCancel = () => {
    setJobId(null);
    setActiveSection('config');
    toast.info('Optimization cancelled');
  };

  const [showApplyDialog, setShowApplyDialog] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const handleApplyConfiguration = async () => {
    if (!jobId) return;

    setIsApplying(true);
    try {
      const response = await fetch('/api/optimizer/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to apply configuration');
      }

      toast.success('Configuration applied successfully!', {
        description: `Backup saved to: ${data.backupPath}`,
      });

      // Reload page after short delay to refresh config
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (error: any) {
      console.error('Failed to apply configuration:', error);
      toast.error('Failed to apply configuration', {
        description: error.message,
      });
    } finally {
      setIsApplying(false);
      setShowApplyDialog(false);
    }
  };

  const handleExportResults = () => {
    if (!results) return;

    setIsExporting(true);
    try {
      const dataStr = JSON.stringify(results, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `optimizer-results-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success('Results exported successfully');
    } catch (error: any) {
      console.error('Failed to export results:', error);
      toast.error('Failed to export results');
    } finally {
      setIsExporting(false);
    }
  };

  const handleRunAnother = () => {
    setJobId(null);
    setResults(null);
    setActiveSection('config');
  };

  return (
    <DashboardLayout>
      <div className="flex h-full flex-col overflow-hidden">
        {/* Page Header */}
        <div className="border-b bg-background px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Target className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Strategy Optimizer</h1>
              <p className="text-sm text-muted-foreground">
                Analyze historical data and optimize your trading parameters for maximum performance
              </p>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-7xl space-y-6">
            {/* Configuration Section */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-primary" />
                  <CardTitle>Configuration</CardTitle>
                </div>
                <CardDescription>
                  Set optimization weights and select symbols to analyze
                </CardDescription>
              </CardHeader>
              <CardContent>
                <OptimizerConfigPanel
                  pnlWeight={pnlWeight}
                  sharpeWeight={sharpeWeight}
                  drawdownWeight={drawdownWeight}
                  onWeightsChange={handleWeightsChange}
                  onStartOptimization={handleStartOptimization}
                  isStarting={isStarting}
                />
              </CardContent>
            </Card>

            {/* Progress Section */}
            {jobId && activeSection === 'progress' && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-primary" />
                    <CardTitle>Optimization Progress</CardTitle>
                  </div>
                  <CardDescription>
                    Analyzing historical data and testing parameter combinations
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <OptimizerProgressBar
                    jobId={jobId}
                    onComplete={(data) => {
                      setResults(data);
                      // Calculate improvement percent from results
                      const improvementPercent = data.summary?.improvementPercent || 0;
                      handleOptimizationComplete(improvementPercent);
                    }}
                    onCancel={handleOptimizationCancel}
                    onError={(error) => {
                      console.error('Optimization error:', error);
                    }}
                  />
                </CardContent>
              </Card>
            )}

            {/* Results Section */}
            {results && activeSection === 'results' && (
              <>
                {/* Before/After Comparison */}
                <Card>
                  <CardHeader>
                    <CardTitle>Optimization Results</CardTitle>
                    <CardDescription>
                      Compare current configuration with optimized parameters
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <BeforeAfterComparison results={results} />
                  </CardContent>
                </Card>

                {/* Symbol Recommendations */}
                {results.recommendations && results.recommendations.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Per-Symbol Recommendations</CardTitle>
                      <CardDescription>
                        Detailed parameter changes and performance improvements for each symbol
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <SymbolRecommendationsTable recommendations={results.recommendations} />
                    </CardContent>
                  </Card>
                )}

                {/* Action Buttons */}
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        size="lg"
                        onClick={() => setShowApplyDialog(true)}
                        disabled={isApplying}
                        className="flex-1 min-w-[200px]"
                      >
                        {isApplying ? (
                          <>
                            <RotateCcw className="mr-2 h-5 w-5 animate-spin" />
                            Applying...
                          </>
                        ) : (
                          <>
                            <CheckCircle className="mr-2 h-5 w-5" />
                            Apply Configuration
                          </>
                        )}
                      </Button>
                      <Button
                        size="lg"
                        variant="outline"
                        onClick={handleExportResults}
                        disabled={isExporting}
                        className="flex-1 min-w-[200px]"
                      >
                        <Download className="mr-2 h-5 w-5" />
                        Export Results
                      </Button>
                      <Button
                        size="lg"
                        variant="secondary"
                        onClick={handleRunAnother}
                        className="flex-1 min-w-[200px]"
                      >
                        <RotateCcw className="mr-2 h-5 w-5" />
                        Run Another Optimization
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>

        {/* Apply Configuration Confirmation Dialog */}
        <AlertDialog open={showApplyDialog} onOpenChange={setShowApplyDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Apply Optimized Configuration?</AlertDialogTitle>
              <AlertDialogDescription>
                This will update your trading configuration with the optimized parameters. Your current
                configuration will be backed up automatically.
                <div className="mt-4 rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-950/30">
                  <p className="text-sm font-medium text-yellow-900 dark:text-yellow-200">
                    ⚠️ Important: The bot will need to be restarted for changes to take effect.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isApplying}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleApplyConfiguration}
                disabled={isApplying}
                className="bg-primary"
              >
                {isApplying ? 'Applying...' : 'Apply Changes'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}
