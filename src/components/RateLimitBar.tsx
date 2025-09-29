'use client';

import React from 'react';
import { useRateLimits } from '@/hooks/useRateLimits';
import { AlertCircle, Activity, TrendingUp, Clock, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProgressBarProps {
  value: number;
  max: number;
  label: string;
  showPercentage?: boolean;
  showValues?: boolean;
  icon?: React.ReactNode;
}

function ProgressBar({ value, max, label, showPercentage = true, showValues = false, icon }: ProgressBarProps) {
  const percentage = Math.min((value / max) * 100, 100);

  // Color gradient based on usage
  const getColor = (percent: number) => {
    if (percent < 50) return 'bg-green-500';
    if (percent < 70) return 'bg-yellow-500';
    if (percent < 85) return 'bg-orange-500';
    return 'bg-red-500';
  };

  const getTextColor = (percent: number) => {
    if (percent < 50) return 'text-green-600';
    if (percent < 70) return 'text-yellow-600';
    if (percent < 85) return 'text-orange-600';
    return 'text-red-600';
  };

  const _getBgColor = (percent: number) => {
    if (percent < 50) return 'bg-green-500/10';
    if (percent < 70) return 'bg-yellow-500/10';
    if (percent < 85) return 'bg-orange-500/10';
    return 'bg-red-500/10';
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          {showValues && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {value.toLocaleString()} / {max.toLocaleString()}
            </span>
          )}
          {showPercentage && (
            <span className={cn("text-sm font-semibold", getTextColor(percentage))}>
              {percentage.toFixed(1)}%
            </span>
          )}
        </div>
      </div>
      <div className="relative w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={cn(
            "absolute inset-y-0 left-0 transition-all duration-500 ease-out rounded-full",
            getColor(percentage)
          )}
          style={{ width: `${percentage}%` }}
        >
          {/* Animated shimmer effect for active progress */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
        </div>
      </div>
    </div>
  );
}

interface QueueIndicatorProps {
  queue: {
    total: number;
    byPriority: {
      critical: number;
      high: number;
      medium: number;
      low: number;
    };
  };
}

function QueueIndicator({ queue }: QueueIndicatorProps) {
  if (queue.total === 0) return null;

  return (
    <div className="flex items-center gap-2 p-2 bg-yellow-500/10 rounded-lg">
      <Clock className="w-4 h-4 text-yellow-600" />
      <span className="text-xs font-medium text-yellow-600">
        {queue.total} requests queued
      </span>
      {queue.byPriority.critical > 0 && (
        <span className="px-2 py-0.5 text-xs bg-red-500/20 text-red-600 rounded-full">
          {queue.byPriority.critical} critical
        </span>
      )}
    </div>
  );
}

export function RateLimitBar() {
  const { data, loading, error } = useRateLimits(1000); // Refresh every second

  if (loading && !data) {
    return (
      <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm animate-pulse">
        <div className="space-y-3">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-500" />
          <span className="text-sm text-red-600 dark:text-red-400">
            Failed to load rate limits
          </span>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { usage, queue, capacity } = data;

  // Determine overall status
  const getStatusColor = () => {
    if (capacity.status === 'critical') return 'border-red-500 bg-red-50 dark:bg-red-900/20';
    if (capacity.status === 'moderate') return 'border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20';
    return 'border-green-500 bg-green-50 dark:bg-green-900/20';
  };

  const getStatusIcon = () => {
    if (capacity.status === 'critical') return <AlertCircle className="w-5 h-5 text-red-500" />;
    if (capacity.status === 'moderate') return <TrendingUp className="w-5 h-5 text-yellow-500" />;
    return <Activity className="w-5 h-5 text-green-500" />;
  };

  const getStatusText = () => {
    if (capacity.status === 'critical') return 'Critical';
    if (capacity.status === 'moderate') return 'Moderate';
    return 'Healthy';
  };

  return (
    <div className={cn(
      "p-4 rounded-lg border-2 transition-all duration-300",
      getStatusColor()
    )}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          <h3 className="font-semibold text-gray-900 dark:text-white">API Rate Limits</h3>
        </div>
        <div className="flex items-center gap-2">
          {getStatusIcon()}
          <span className="text-sm font-medium">{getStatusText()}</span>
        </div>
      </div>

      {/* Progress Bars */}
      <div className="space-y-4">
        <ProgressBar
          value={usage.weight}
          max={usage.weightLimit}
          label="Request Weight"
          showValues={true}
          icon={<Activity className="w-4 h-4 text-gray-500" />}
        />

        <ProgressBar
          value={usage.orders}
          max={usage.orderLimit}
          label="Order Count"
          showValues={true}
          icon={<TrendingUp className="w-4 h-4 text-gray-500" />}
        />

        {/* Queue Indicator */}
        {queue.total > 0 && <QueueIndicator queue={queue} />}

        {/* Capacity Indicator */}
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600 dark:text-gray-400">Available Capacity</span>
            <span className={cn(
              "font-semibold",
              capacity.capacityPercent > 50 ? "text-green-600" :
              capacity.capacityPercent > 20 ? "text-yellow-600" : "text-red-600"
            )}>
              {capacity.capacityPercent.toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Recommendations */}
        {data.recommendations && data.recommendations.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 space-y-2">
            {data.recommendations.map((rec, idx) => (
              <div key={idx} className={cn(
                "text-xs p-2 rounded",
                rec.level === 'warning' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' :
                'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
              )}>
                <div className="font-medium">{rec.message}</div>
                <div className="mt-1 opacity-80">{rec.suggestion}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Compact version for header/sidebar
export function RateLimitBarCompact() {
  const { data, loading } = useRateLimits(2000); // Refresh every 2 seconds

  if (loading || !data) {
    return (
      <div className="flex items-center gap-2">
        <div className="w-24 h-2 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
      </div>
    );
  }

  const percentage = data.usage.weightPercent;

  const getColor = (percent: number) => {
    if (percent < 50) return 'bg-green-500';
    if (percent < 70) return 'bg-yellow-500';
    if (percent < 85) return 'bg-orange-500';
    return 'bg-red-500';
  };

  return (
    <div className="flex items-center gap-3">
      <Zap className="w-4 h-4 text-gray-500" />
      <div className="flex items-center gap-2">
        <div className="relative w-24 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className={cn(
              "absolute inset-y-0 left-0 transition-all duration-500 ease-out rounded-full",
              getColor(percentage)
            )}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
        </div>
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
          {percentage.toFixed(0)}%
        </span>
      </div>
      {data.queue.total > 0 && (
        <span className="text-xs text-yellow-600 dark:text-yellow-400">
          ({data.queue.total} queued)
        </span>
      )}
    </div>
  );
}