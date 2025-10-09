'use client';

import React, { useEffect, useState } from 'react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Loader2, X } from 'lucide-react';

interface OptimizerProgressBarProps {
  jobId: string;
  onComplete: (results: any) => void;
  onCancel: () => void;
  onError: (error: string) => void;
  variant?: 'full' | 'inline';
  onProgressUpdate?: (progress: number) => void;
}

/**
 * OptimizerProgressBar Component
 *
 * Real-time progress tracking with 5-second polling
 * Shows elapsed time, estimated remaining time, and current stage
 */
export function OptimizerProgressBar({
  jobId,
  onComplete,
  onCancel,
  onError,
  variant = 'full',
  onProgressUpdate,
}: OptimizerProgressBarProps) {
  const [progress, setProgress] = useState(0);
  const [currentStage, setCurrentStage] = useState('Initializing...');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<number | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isErrored, setIsErrored] = useState(false);

  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    let stopped = false;

    const stopPolling = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      stopped = true;
    };

    const pollStatus = async () => {
      if (stopped) return;

      try {
        setIsErrored(false);

        const response = await fetch(`/api/optimizer/status?jobId=${jobId}`);

        if (!response.ok) {
          if (response.status === 404) {
            console.warn(`[optimizer] status 404 for ${jobId}; stopping polling`);
            stopPolling();
            return;
          }

          throw new Error('Failed to fetch status');
        }

        const data = await response.json();
        if (!data.success) {
          throw new Error(data.error || 'Unknown error');
        }

        const job = data.job;

        setProgress(job.progress);
        setCurrentStage(job.currentStage);
        setElapsedTime(job.elapsedTime);
        setEstimatedTimeRemaining(job.estimatedTimeRemaining);

        // Notify parent of progress update
        if (onProgressUpdate) {
          onProgressUpdate(job.progress);
        }

        if (job.status === 'completed') {
          stopPolling();
          onComplete(job.results);
        } else if (job.status === 'failed') {
          stopPolling();
          setIsErrored(true);
          onError(job.error || 'Optimization failed');
        } else if (job.status === 'cancelled') {
          stopPolling();
          onCancel();
        }
      } catch (error) {
        if (stopped) return;

        console.error('Error polling optimization status:', error);
        stopPolling();
        setIsErrored(true);
        onError(error instanceof Error ? error.message : 'Failed to check status');
      }
    };

    pollStatus();
    intervalId = setInterval(pollStatus, 5000);

    return () => {
      stopPolling();
    };
  }, [jobId, onComplete, onCancel, onError, onProgressUpdate]);

  const handleCancel = async () => {
    setIsCancelling(true);

    try {
      const response = await fetch(`/api/optimizer/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });

      if (!response.ok) {
        throw new Error('Failed to cancel optimization');
      }
    } catch (error) {
      console.error('Error cancelling optimization:', error);
      setIsCancelling(false);
      setIsErrored(true);
      onError(error instanceof Error ? error.message : 'Failed to cancel');
    }
  };

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  };

  if (variant === 'inline') {
    return (
      <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs shadow-sm">
        <div className="flex items-center justify-between font-medium">
          <span className="flex items-center gap-1.5">
            {isErrored ? (
              <>
                <X className="h-3.5 w-3.5 text-destructive" />
                <span>Optimization unavailable</span>
              </>
            ) : progress >= 100 ? (
              <>
                <Loader2 className="h-3.5 w-3.5 text-primary" />
                <span>Optimization complete</span>
              </>
            ) : (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                <span>Optimization running...</span>
              </>
            )}
          </span>
          <span>{progress.toFixed(0)}%</span>
        </div>
        <Progress value={progress} className="mt-2 h-1.5" />
        <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="truncate pr-2">{currentStage}</span>
          <span>
            {`Elapsed ${formatTime(elapsedTime)}`}
            {estimatedTimeRemaining !== null && estimatedTimeRemaining > 0
              ? ` | ETA ${formatTime(estimatedTimeRemaining)}`
              : progress >= 100
              ? ' | Ready to review'
              : ''}
          </span>
        </div>
        {!isErrored && progress < 100 && (
          <div className="mt-2 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              disabled={isCancelling}
              className="gap-1 text-xs"
            >
              {isCancelling ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Cancelling...</span>
                </>
              ) : (
                <>
                  <X className="h-3 w-3" />
                  <span>Cancel</span>
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overall Progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Overall Progress</span>
          <span className="text-muted-foreground">{progress.toFixed(0)}%</span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      {/* Current Stage */}
      <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-4">
        <Loader2 className={`h-5 w-5 ${progress < 100 && !isErrored ? 'animate-spin text-primary' : 'text-muted-foreground'}`} />
        <div className="flex-1">
          <p className="text-sm font-medium">{currentStage}</p>
          {isErrored && (
            <p className="text-xs text-destructive mt-1">Optimization status unavailable.</p>
          )}
        </div>
      </div>

      {/* Time Information */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="space-y-1">
          <p className="text-muted-foreground">Elapsed Time</p>
          <p className="font-medium">{formatTime(elapsedTime)}</p>
        </div>
        {estimatedTimeRemaining !== null && estimatedTimeRemaining > 0 && (
          <div className="space-y-1">
            <p className="text-muted-foreground">Est. Remaining</p>
            <p className="font-medium">{formatTime(estimatedTimeRemaining)}</p>
          </div>
        )}
      </div>

      {/* Cancel Button */}
      {!isErrored && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCancel}
            disabled={isCancelling}
            className="gap-2"
          >
            {isCancelling ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Cancelling...</span>
              </>
            ) : (
              <>
                <X className="h-4 w-4" />
                <span>Cancel Optimization</span>
              </>
            )}
          </Button>
        </div>
      )}

      {/* Warning */}
      <div className="text-center text-xs text-muted-foreground">
        Keep this page open during optimization
      </div>
    </div>
  );
}
