'use client';

import React from 'react';
import { GitBranch, RefreshCw, CheckCircle, AlertCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useVersionCheck } from '@/hooks/useVersionCheck';

export function VersionChecker() {
  const { versionInfo, isLoading, error, checkForUpdates } = useVersionCheck();

  const getStatusIcon = () => {
    if (isLoading) return <RefreshCw className="h-3 w-3 animate-spin" />;
    if (error) return <XCircle className="h-3 w-3 text-red-500" />;
    if (versionInfo?.isUpToDate) return <CheckCircle className="h-3 w-3 text-green-500" />;
    return <AlertCircle className="h-3 w-3 text-yellow-500" />;
  };

  const getStatusText = () => {
    if (error) return 'Error';
    if (versionInfo?.isUpToDate) return 'Latest';
    if (versionInfo?.commitsBehind) return `${versionInfo.commitsBehind} behind`;
    return 'Unknown';
  };

  const getStatusColor = () => {
    if (error) return 'text-red-500';
    if (versionInfo?.isUpToDate) return 'text-green-500';
    return 'text-yellow-500';
  };

  return (
    <div className="px-2 py-1.5 text-xs text-muted-foreground">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <GitBranch className="h-3 w-3" />
          {versionInfo && (
            <>
              <span className="font-medium">{versionInfo.currentBranch}</span>
              <span className="font-mono text-muted-foreground/70">
                {versionInfo.currentCommitShort}
              </span>
            </>
          )}
          {!versionInfo && <span>Version</span>}
        </div>
        <div className="flex items-center gap-1">
          {isLoading ? (
            <span className="font-medium text-muted-foreground">Checking...</span>
          ) : (
            <>
              {getStatusIcon()}
              <span className={`font-medium ${getStatusColor()}`}>
                {getStatusText()}
              </span>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-4 w-4 p-0 hover:bg-muted/50"
            onClick={checkForUpdates}
            disabled={isLoading}
            title="Refresh version status"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}