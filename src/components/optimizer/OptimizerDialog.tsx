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
import { Zap, Settings, BarChart3, CheckCircle2, Download, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { OptimizerWeightSliders } from './OptimizerWeightSliders';
import { OptimizerProgressBar } from './OptimizerProgressBar';
import { OptimizerResults } from './OptimizerResults';
import { OptimizerInfoTooltip } from './OptimizerInfoTooltip';
import { useConfig } from '@/components/ConfigProvider';

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
  const { reloadConfig } = useConfig();
  const [activeTab, setActiveTab] = useState<'config' | 'progress' | 'results'>('config');

  // Weight configuration
  const [pnlWeight, setPnlWeight] = useState(50);
  const [sharpeWeight, setSharpeWeight] = useState(30);
  const [drawdownWeight, setDrawdownWeight] = useState(20);

  const [isStarting, setIsStarting] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  // Reset to config tab when dialog opens
  useEffect(() => {
    if (isOpen && !jobId) {
      setActiveTab('config');
      onResultsChange(null);
    }
  }, [isOpen, jobId, onResultsChange]);

  useEffect(() => {
    if (isOpen && results) {
      setActiveTab('results');
    }
  }, [isOpen, results]);

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
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to start optimization');
      }

      onJobIdChange(data.jobId);
      setActiveTab('progress');

      toast.success('Optimization Started', {
        description: data.message || 'Your configuration is being optimized...',
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
  };

  const handleCancel = () => {
    onOptimizationCancel();
    onJobIdChange(null);
    onResultsChange(null);
    setActiveTab('config');
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
    Math.abs(pnlWeight + sharpeWeight + drawdownWeight - 100) < 0.1;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl w-[90vw] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              <DialogTitle>Configuration Optimizer</DialogTitle>
            </div>
            <OptimizerInfoTooltip />
          </div>
          <DialogDescription className="flex items-center justify-between">
            <span>Optimize your trading configuration using historical backtest analysis</span>
            <Link
              href="/optimizer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              onClick={onClose}
            >
              Open Full Page View
              <ExternalLink className="h-3 w-3" />
            </Link>
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
                  <div className="rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">
                    💡 <strong>Tip:</strong> You can safely close this dialog while the optimizer runs. Progress will continue to be visible next to the &ldquo;Optimize Config&rdquo; button on the main dashboard.
                  </div>
                  <OptimizerProgressBar
                    jobId={jobId}
                    onComplete={handleOptimizationComplete}
                    onCancel={handleCancel}
                    onError={handleOptimizationError}
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

