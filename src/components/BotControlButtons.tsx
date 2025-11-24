'use client';

import { useState } from 'react';
import { useBotStatus } from '@/hooks/useBotStatus';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Pause, Play, Square, Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function BotControlButtons() {
  const { status, isConnected } = useBotStatus();
  const [isLoading, setIsLoading] = useState(false);
  const [showStopDialog, setShowStopDialog] = useState(false);

  const botState = (status as any)?.botState || 'stopped';
  const isRunning = botState === 'running';
  const isPaused = botState === 'paused';
  const isStopped = botState === 'stopped';

  const sendControlCommand = async (action: 'pause' | 'resume' | 'stop') => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/bot/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Failed to ${action} bot`);
      }

      toast.success(`Bot ${action === 'stop' ? 'stopped' : action === 'pause' ? 'paused' : 'resumed'} successfully`, {
        description: action === 'stop'
          ? 'All positions are being closed'
          : action === 'pause'
          ? 'No new trades will be placed, positions will continue to be monitored'
          : 'Trading has resumed'
      });
    } catch (error: any) {
      console.error(`Failed to ${action} bot:`, error);
      toast.error(`Failed to ${action} bot`, {
        description: error.message || 'An error occurred'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handlePause = () => sendControlCommand('pause');
  const handleResume = () => sendControlCommand('resume');
  const handleStop = () => {
    setShowStopDialog(true);
  };

  const confirmStop = () => {
    setShowStopDialog(false);
    sendControlCommand('stop');
  };

  if (!isConnected || isStopped) {
    return null;
  }

  return (
    <>
      <div className="flex items-center gap-2">
        {isRunning && (
          <Button
            onClick={handlePause}
            disabled={isLoading}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Pause className="h-4 w-4" />
            )}
            Pause Bot
          </Button>
        )}

        {isPaused && (
          <Button
            onClick={handleResume}
            disabled={isLoading}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Resume Bot
          </Button>
        )}

        <Button
          onClick={handleStop}
          disabled={isLoading}
          variant="destructive"
          size="sm"
          className="gap-2"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Square className="h-4 w-4" />
          )}
          Stop & Close All
        </Button>
      </div>

      <AlertDialog open={showStopDialog} onOpenChange={setShowStopDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop Bot & Close All Positions?</AlertDialogTitle>
            <AlertDialogDescription>
              This will:
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Stop monitoring for new liquidations</li>
                <li>Close all open positions at market price</li>
                <li>Cancel all open orders</li>
                <li>Stop the bot completely</li>
              </ul>
              <p className="mt-3 font-semibold text-foreground">
                This action cannot be undone. Are you sure?
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmStop}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Stop & Close All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
