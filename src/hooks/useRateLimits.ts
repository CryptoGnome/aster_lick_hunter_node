import { useState, useEffect } from 'react';

export interface RateLimitData {
  usage: {
    weight: number;
    weightLimit: number;
    weightPercent: number;
    orders: number;
    orderLimit: number;
    orderPercent: number;
    queueLength: number;
  };
  queue: {
    total: number;
    byPriority: {
      critical: number;
      high: number;
      medium: number;
      low: number;
    };
    oldestWaitTime: number;
  };
  capacity: {
    availableWeight: number;
    availableOrders: number;
    capacityPercent: number;
    status: 'healthy' | 'moderate' | 'critical';
  };
  recommendations: Array<{
    level: string;
    message: string;
    suggestion: string;
  }>;
  timestamp: number;
}

export function useRateLimits(refreshInterval: number = 1000) {
  const [data, setData] = useState<RateLimitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRateLimits = async () => {
    try {
      const response = await fetch('/api/rate-limits');
      if (!response.ok) {
        throw new Error(`Failed to fetch rate limits: ${response.statusText}`);
      }
      const result = await response.json();
      setData(result);
      setError(null);
    } catch (err) {
      console.error('Error fetching rate limits:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch rate limits');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial fetch
    fetchRateLimits();

    // Set up polling
    const interval = setInterval(fetchRateLimits, refreshInterval);

    return () => clearInterval(interval);
  }, [refreshInterval]);

  return { data, loading, error, refetch: fetchRateLimits };
}