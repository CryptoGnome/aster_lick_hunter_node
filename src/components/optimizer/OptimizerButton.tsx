'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Zap, Loader2, AlertTriangle, RotateCcw } from 'lucide-react';
import { OptimizerDialog } from './OptimizerDialog';
import { OptimizerProgressBar } from './OptimizerProgressBar';

/**
 * OptimizerButton Component
 *
 * Main trigger button for the configuration optimizer
 * Placed in the top right of the dashboard, next to Active Symbols
 */
export function OptimizerButton() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<'running' | 'completed' | 'failed' | 'cancelled' | null>(null);
  const [results, setResults] = useState<any | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleOpenDialog = () => {
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
  };

  const handleOptimizationComplete = (_improvementPercent: number) => {
    setJobStatus('completed');
  };

  const handleOptimizationStart = () => {
    setJobStatus('running');
    setResults(null);
    setProgress(0);
    // Don't clear jobId here - it will be set by handleJobIdChange when the job starts
  };

  const handleOptimizationCancel = () => {
    setJobStatus(null);
    setJobId(null);
    setResults(null);
    setProgress(0);
  };

  const handleJobIdChange = (nextJobId: string | null) => {
    setJobId(nextJobId);
    if (nextJobId === null) {
      setJobStatus(null);
    } else {
      // When a new job starts, ensure status is set to running
      setJobStatus('running');
    }
  };

  const handleResultsChange = (nextResults: any | null) => {
    setResults(nextResults);
    if (nextResults) {
      setJobStatus('completed');
    } else {
      setJobStatus(null);
      setJobId(null);
    }
  };

  const handleOptimizationError = (message: string) => {
    setJobStatus('failed');
    setJobId(null);
    setResults(null);
    setProgress(0);
    if (!isDialogOpen) {
      toast.error('Optimization failed', {
        description: message,
      });
    }
  };

  const handleReset = async () => {
    setIsResetting(true);

    // Clear local state FIRST to unmount progress bar immediately
    setJobId(null);
    setJobStatus(null);
    setResults(null);
    setProgress(0);

    try {
      const response = await fetch('/api/optimizer/reset', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to reset optimizer');
      }

      toast.success('Optimizer reset', {
        description: 'All cached results cleared. Ready for a fresh optimization.',
      });
    } catch (error) {
      toast.error('Reset failed', {
        description: error instanceof Error ? error.message : 'Failed to reset optimizer state',
      });
    } finally {
      setIsResetting(false);
    }
  };

  const hasResults = Boolean(results);
  const isRunning = jobStatus === 'running';
  const hasError = jobStatus === 'failed';
  const improvement = typeof results?.summary?.improvementPercent === 'number'
    ? results.summary.improvementPercent
    : null;

  return (
    <>
      <div className="flex gap-2 items-center">
        <Button
          onClick={handleOpenDialog}
          variant={hasResults ? 'default' : hasError ? 'destructive' : 'outline'}
          size="sm"
          className="gap-2"
        >
          {isRunning ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Optimizing {progress > 0 ? `${progress.toFixed(0)}%` : '...'}</span>
            </>
          ) : hasError ? (
            <>
              <AlertTriangle className="h-4 w-4" />
              <span>Optimization Failed</span>
            </>
          ) : hasResults ? (
            <>
              <Zap className="h-4 w-4" />
              <span>View Results</span>
              {improvement !== null && improvement > 0 && (
                <Badge variant="secondary" className="ml-1">
                  +{improvement.toFixed(1)}%
                </Badge>
              )}
            </>
          ) : (
            <>
              <Zap className="h-4 w-4" />
              <span>Optimize Config</span>
            </>
          )}
        </Button>

        {(hasResults || hasError || isRunning) && (
          <Button
            onClick={handleReset}
            variant="ghost"
            size="sm"
            disabled={isResetting}
            className="gap-2"
            title="Clear cached results and start fresh"
          >
            {isResetting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
          </Button>
        )}
      </div>

      {jobId && isRunning && (
        <div className="mt-2 w-full max-w-sm">
          <OptimizerProgressBar
            jobId={jobId}
            variant="inline"
            onComplete={handleResultsChange}
            onCancel={handleOptimizationCancel}
            onError={handleOptimizationError}
            onProgressUpdate={setProgress}
          />
        </div>
      )}

      <OptimizerDialog
        isOpen={isDialogOpen}
        onClose={handleCloseDialog}
        onOptimizationComplete={handleOptimizationComplete}
        onOptimizationStart={handleOptimizationStart}
        onOptimizationCancel={handleOptimizationCancel}
        jobId={jobId}
        onJobIdChange={handleJobIdChange}
        results={results}
        onResultsChange={handleResultsChange}
      />
    </>
  );
}
