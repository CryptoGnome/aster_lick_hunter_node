import { useState, useEffect, useCallback } from 'react';

interface VersionInfo {
  currentCommit: string;
  currentCommitShort: string;
  currentBranch: string;
  isUpToDate: boolean;
  commitsBehind: number;
  latestCommit: string;
  latestCommitShort: string;
  pendingCommits: Array<{
    hash: string;
    shortHash: string;
    message: string;
    author: string;
    date: string;
  }>;
  error?: string;
}

interface UseVersionCheckReturn {
  versionInfo: VersionInfo | null;
  isLoading: boolean;
  error: string | null;
  checkForUpdates: () => Promise<void>;
  lastChecked: Date | null;
}

export function useVersionCheck(): UseVersionCheckReturn {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const checkForUpdates = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/version-check');

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      setVersionInfo(data);
      setLastChecked(new Date());
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to check for updates';
      setError(errorMessage);
      console.error('Version check failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Auto-check on mount (but don't show loading state)
  useEffect(() => {
    checkForUpdates();
  }, [checkForUpdates]);

  return {
    versionInfo,
    isLoading,
    error,
    checkForUpdates,
    lastChecked
  };
}
