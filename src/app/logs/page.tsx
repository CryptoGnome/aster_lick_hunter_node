'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft,
  Trash2,
  RefreshCw,
  Search,
  Info,
  AlertTriangle,
  XCircle,
  Pause,
  Play,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { DashboardLayout } from '@/components/dashboard-layout';

interface LogEntry {
  id: string;
  timestamp: number;
  timestampFormatted: string;
  level: 'info' | 'warn' | 'error';
  component: string;
  message: string;
  data?: any;
}

export default function LogsPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [components, setComponents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    component: '',
    level: '',
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const lastTimestamp = useRef<number>(0);

  const fetchLogs = async (since?: number) => {
    try {
      const params = new URLSearchParams();
      if (filters.component) params.append('component', filters.component);
      if (filters.level) params.append('level', filters.level);
      if (since) params.append('since', since.toString());
      
      const response = await fetch(`/api/logs?${params}`);
      const data = await response.json();

      if (data.success) {
        if (since) {
          // Append new logs to the end (newest at bottom)
          setLogs(prev => {
            const combined = [...prev, ...data.logs];
            // Keep max 1000 logs, trim from the top (oldest)
            return combined.length > 1000 ? combined.slice(-1000) : combined;
          });
        } else {
          // Full refresh - reverse so newest is at bottom
          setLogs(data.logs);
        }
        setComponents(data.components);
        
        // Update last timestamp
        if (data.logs.length > 0) {
          lastTimestamp.current = Math.max(...data.logs.map((l: LogEntry) => l.timestamp));
        }
      }
    } catch (error) {
      console.error('Failed to fetch logs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [filters]);

  useEffect(() => {
    if (isPaused) return;

    // Poll for new logs every 2 seconds
    const interval = setInterval(() => {
      if (lastTimestamp.current > 0) {
        fetchLogs(lastTimestamp.current);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isPaused, filters]);

  useEffect(() => {
    if (autoScroll && !isPaused) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll, isPaused]);

  const handleClearLogs = async () => {
    if (!confirm('Are you sure you want to clear all logs?')) return;

    try {
      const response = await fetch('/api/logs', { method: 'DELETE' });
      const data = await response.json();

      if (data.success) {
        setLogs([]);
        lastTimestamp.current = 0;
        toast.success('Logs cleared');
      }
    } catch (error) {
      console.error('Failed to clear logs:', error);
      toast.error('Failed to clear logs');
    }
  };

  const handleRefresh = () => {
    lastTimestamp.current = 0;
    setLoading(true);
    fetchLogs();
  };

  const getLevelIcon = (level: string) => {
    switch (level) {
      case 'error':
        return <XCircle className="w-4 h-4 text-red-600" />;
      case 'warn':
        return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
      case 'info':
      default:
        return <Info className="w-4 h-4 text-blue-600" />;
    }
  };

  const getLevelBadgeVariant = (level: string) => {
    switch (level) {
      case 'error':
        return 'destructive';
      case 'warn':
        return 'outline';
      case 'info':
      default:
        return 'secondary';
    }
  };

  const filteredLogs = logs.filter(log => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        log.message.toLowerCase().includes(query) ||
        log.component.toLowerCase().includes(query)
      );
    }
    return true;
  });

  return (
    <DashboardLayout>
      <div className="container mx-auto p-4 space-y-4">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-4">
            <Button
              onClick={() => router.back()}
              variant="ghost"
              size="sm"
              className="hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <h1 className="text-3xl font-bold">System Logs</h1>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => setIsPaused(!isPaused)}
              variant={isPaused ? 'default' : 'outline'}
              size="sm"
            >
              {isPaused ? (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Resume
                </>
              ) : (
                <>
                  <Pause className="w-4 h-4 mr-2" />
                  Pause
                </>
              )}
            </Button>
            <Button onClick={handleRefresh} variant="outline" size="sm">
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Button onClick={handleClearLogs} variant="outline" size="sm">
              <Trash2 className="w-4 h-4 mr-2" />
              Clear
            </Button>
          </div>
        </div>

        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          
          <Select
            value={filters.component || 'all'}
            onValueChange={(value) =>
              setFilters({ ...filters, component: value === 'all' ? '' : value })
            }
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All Components" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Components</SelectItem>
              {components.map(comp => (
                <SelectItem key={comp} value={comp}>
                  {comp}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.level || 'all'}
            onValueChange={(value) =>
              setFilters({ ...filters, level: value === 'all' ? '' : value })
            }
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="All Levels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Levels</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warn">Warning</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="autoscroll"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="cursor-pointer"
            />
            <label htmlFor="autoscroll" className="text-sm cursor-pointer">
              Auto-scroll
            </label>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex justify-between items-center">
              <span>Logs ({filteredLogs.length})</span>
              {isPaused && (
                <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                  Paused
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-black text-gray-100 rounded-lg p-4 h-[600px] overflow-y-auto font-mono text-xs">
              {loading && logs.length === 0 ? (
                <div className="text-center text-gray-400 py-8">Loading logs...</div>
              ) : filteredLogs.length === 0 ? (
                <div className="text-center text-gray-400 py-8">
                  No logs found. {searchQuery && 'Try adjusting your search.'}
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredLogs.map((log) => (
                    <div
                      key={log.id}
                      className={`py-1 px-2 rounded hover:bg-gray-800 ${
                        log.level === 'error'
                          ? 'bg-red-950/30'
                          : log.level === 'warn'
                          ? 'bg-yellow-950/30'
                          : ''
                      }`}
                    >
                      {/* Mobile: Stack vertically */}
                      <div className="flex flex-col gap-1 sm:hidden">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 text-[10px]">
                            {log.timestampFormatted}
                          </span>
                          <span className="shrink-0">{getLevelIcon(log.level)}</span>
                          <Badge
                            variant={getLevelBadgeVariant(log.level)}
                            className="shrink-0 text-[10px] px-1.5 py-0"
                          >
                            {log.component}
                          </Badge>
                        </div>
                        <div className="text-[11px] break-words pl-1">
                          {log.message}
                        </div>
                        {log.data && (
                          <details className="text-gray-400 text-[10px] pl-1">
                            <summary className="cursor-pointer">data</summary>
                            <pre className="mt-1 p-2 bg-gray-900 rounded overflow-x-auto">
                              {JSON.stringify(log.data, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                      
                      {/* Desktop: Horizontal layout */}
                      <div className="hidden sm:flex gap-2 items-start">
                        <span className="text-gray-500 shrink-0">
                          {log.timestampFormatted}
                        </span>
                        <span className="shrink-0">{getLevelIcon(log.level)}</span>
                        <Badge
                          variant={getLevelBadgeVariant(log.level)}
                          className="shrink-0 text-[10px] px-1.5 py-0"
                        >
                          {log.component}
                        </Badge>
                        <span className="flex-1 break-words">{log.message}</span>
                        {log.data && (
                          <details className="text-gray-400 text-[10px] shrink-0">
                            <summary className="cursor-pointer">data</summary>
                            <pre className="mt-1 p-2 bg-gray-900 rounded max-w-md overflow-x-auto">
                              {JSON.stringify(log.data, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
