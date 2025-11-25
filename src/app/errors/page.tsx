'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
// Removed unused imports: Tabs, TabsContent, TabsList, TabsTrigger
import {
  AlertCircle,
  Download,
  Trash2,
  RefreshCw,
  Copy,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Info,
  Search,
  Github,
  Bot,
  ArrowLeft
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import ErrorIssueGenerator from '@/components/ErrorIssueGenerator';
import { useRouter } from 'next/navigation';

interface ErrorLog {
  id: number;
  timestamp: string;
  error_type: 'websocket' | 'api' | 'trading' | 'config' | 'general' | 'system';
  error_code?: string;
  message: string;
  details?: any;
  stack_trace?: string;
  component?: string;
  symbol?: string;
  user_action?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  session_id: string;
  resolved: boolean;
  notes?: string;
  created_at: string;
}

interface ErrorStats {
  total: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
  recentCount: number;
  topErrors: Array<{ message: string; count: number }>;
}

export default function ErrorsPage() {
  const router = useRouter();
  const [errors, setErrors] = useState<ErrorLog[]>([]);
  const [stats, setStats] = useState<ErrorStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedError, setSelectedError] = useState<ErrorLog | null>(null);
  const [filters, setFilters] = useState({
    type: '',
    severity: '',
    hours: '24'
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [issueGeneratorError, setIssueGeneratorError] = useState<ErrorLog | null>(null);
  const [systemInfo, setSystemInfo] = useState<any>(null);
  const [similarErrors, setSimilarErrors] = useState<Map<string, ErrorLog[]>>(new Map());

  useEffect(() => {
    const fetchErrors = async () => {
      try {
        const params = new URLSearchParams();
        if (filters.type) params.append('type', filters.type);
        if (filters.severity) params.append('severity', filters.severity);

        const response = await fetch(`/api/errors?${params}`);
        const data = await response.json();
        setErrors(data.errors || []);

        // Group similar errors
        groupSimilarErrors(data.errors || []);
      } catch (_error) {
        console.error('Failed to fetch errors:', _error);
      } finally {
        setLoading(false);
      }
    };

    const fetchStats = async () => {
      try {
        const response = await fetch(`/api/errors/stats?hours=${filters.hours}`);
        const data = await response.json();
        setStats(data.stats);
      } catch (_error) {
        console.error('Failed to fetch stats:', _error);
      }
    };

    const fetchSystemInfo = async () => {
      try {
        const response = await fetch('/api/errors/export?format=json&hours=0');
        const data = await response.json();
        setSystemInfo(data.systemInfo);
      } catch (_error) {
        console.error('Failed to fetch system info:', _error);
      }
    };

    fetchErrors();
    fetchStats();
    fetchSystemInfo();

    const interval = setInterval(() => {
      fetchErrors();
      fetchStats();
    }, 10000);

    return () => clearInterval(interval);
  }, [filters]);

  const groupSimilarErrors = (errorList: ErrorLog[]) => {
    const grouped = new Map<string, ErrorLog[]>();

    errorList.forEach(error => {
      // Create a fingerprint for the error based on type, code, and component
      const fingerprint = `${error.error_type}-${error.error_code || 'NO_CODE'}-${error.component || 'NO_COMP'}`;

      if (!grouped.has(fingerprint)) {
        grouped.set(fingerprint, []);
      }
      grouped.get(fingerprint)?.push(error);
    });

    setSimilarErrors(grouped);
  };

  const findSimilarErrors = (targetError: ErrorLog): ErrorLog[] => {
    const fingerprint = `${targetError.error_type}-${targetError.error_code || 'NO_CODE'}-${targetError.component || 'NO_COMP'}`;
    return similarErrors.get(fingerprint)?.filter(e => e.id !== targetError.id) || [];
  };

  const handleExport = async (format: 'json' | 'markdown') => {
    try {
      const response = await fetch(`/api/errors/export?format=${format}&hours=${filters.hours}`);

      if (format === 'markdown') {
        const text = await response.text();
        const blob = new Blob([text], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bug-report-${new Date().toISOString().split('T')[0]}.md`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const data = await response.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `errors-export-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }

      toast.success('Export downloaded successfully');
    } catch (_error) {
      toast.error('Failed to export errors');
    }
  };

  const handleClearOld = async () => {
    try {
      const response = await fetch('/api/errors?daysToKeep=7', { method: 'DELETE' });
      const data = await response.json();
      toast.success(data.message);
      // Trigger re-fetch by updating filters
      setFilters(prev => ({ ...prev }));
    } catch (_error) {
      toast.error('Failed to clear old errors');
    }
  };

  const handleClearAll = async () => {
    if (!confirm('Are you sure you want to delete ALL error logs? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch('/api/errors?daysToKeep=0&clearAll=true', { method: 'DELETE' });
      const data = await response.json();
      toast.success(`Deleted ${data.deletedCount || 0} error logs`);
      // Trigger re-fetch by updating filters
      setFilters(prev => ({ ...prev }));
    } catch (_error) {
      toast.error('Failed to clear all errors');
    }
  };

  const handleMarkResolved = async (id: number) => {
    try {
      const response = await fetch(`/api/errors/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved: true })
      });

      if (response.ok) {
        toast.success('Error marked as resolved');
        // Trigger re-fetch by updating filters
        setFilters(prev => ({ ...prev }));
      }
    } catch (_error) {
      toast.error('Failed to mark error as resolved');
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        toast.success('Copied to clipboard');
      } else {
        // Fallback for older browsers or insecure contexts
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();
        try {
          document.execCommand('copy');
          toast.success('Copied to clipboard');
        } catch (_err) {
          toast.error('Failed to copy to clipboard');
        }
        document.body.removeChild(textArea);
      }
    } catch (_err) {
      toast.error('Failed to copy to clipboard');
    }
  };

  const generateAIDebugInfo = (error: ErrorLog) => {
    const similar = findSimilarErrors(error);
    let debugInfo = `## Error Debug Information\n\n`;
    debugInfo += `### Error Details\n`;
    debugInfo += `- Type: ${error.error_type}\n`;
    debugInfo += `- Severity: ${error.severity}\n`;
    debugInfo += `- Code: ${error.error_code || 'N/A'}\n`;
    debugInfo += `- Component: ${error.component || 'Unknown'}\n`;
    debugInfo += `- Symbol: ${error.symbol || 'N/A'}\n`;
    debugInfo += `- Timestamp: ${error.timestamp}\n`;
    debugInfo += `- Session: ${error.session_id}\n\n`;

    debugInfo += `### Error Message\n\`\`\`\n${error.message}\n\`\`\`\n\n`;

    if (error.details) {
      debugInfo += `### Additional Context\n\`\`\`json\n`;
      debugInfo += JSON.stringify(
        typeof error.details === 'string' ? JSON.parse(error.details) : error.details,
        null,
        2
      );
      debugInfo += `\n\`\`\`\n\n`;
    }

    if (error.stack_trace) {
      debugInfo += `### Stack Trace\n\`\`\`\n${error.stack_trace}\n\`\`\`\n\n`;
    }

    if (similar.length > 0) {
      debugInfo += `### Pattern: Found ${similar.length} similar errors\n`;
      similar.slice(0, 3).forEach((simError, idx) => {
        debugInfo += `${idx + 1}. ${new Date(simError.timestamp).toLocaleString()}: ${simError.message.substring(0, 100)}\n`;
      });
    }

    return debugInfo;
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <XCircle className="w-4 h-4 text-red-600" />;
      case 'high':
        return <AlertCircle className="w-4 h-4 text-orange-600" />;
      case 'medium':
        return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
      case 'low':
        return <Info className="w-4 h-4 text-blue-600" />;
      default:
        return null;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-100 text-red-800';
      case 'high':
        return 'bg-orange-100 text-orange-800';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800';
      case 'low':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const filteredErrors = errors.filter(error => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        error.message.toLowerCase().includes(query) ||
        error.component?.toLowerCase().includes(query) ||
        error.symbol?.toLowerCase().includes(query)
      );
    }
    return true;
  });

  return (
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
          <h1 className="text-3xl font-bold">Error Logs</h1>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => handleExport('markdown')} variant="outline">
            <Download className="w-4 h-4 mr-2" />
            Bug Report
          </Button>
          <Button onClick={() => handleExport('json')} variant="outline">
            <Download className="w-4 h-4 mr-2" />
            Export JSON
          </Button>
          <Button onClick={handleClearOld} variant="outline">
            <Trash2 className="w-4 h-4 mr-2" />
            Clear Old
          </Button>
          <Button onClick={handleClearAll} variant="outline" className="hover:bg-red-500 hover:text-white">
            <XCircle className="w-4 h-4 mr-2" />
            Clear All
          </Button>
          <Button onClick={() => setFilters(prev => ({ ...prev }))} variant="outline">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total Errors</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
              <p className="text-xs text-muted-foreground">
                {stats.recentCount} in last {filters.hours}h
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Critical/High</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">
                {(stats.bySeverity.critical || 0) + (stats.bySeverity.high || 0)}
              </div>
              <p className="text-xs text-muted-foreground">Require attention</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Top Error Type</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-bold">
                {Object.entries(stats.byType).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A'}
              </div>
              <p className="text-xs text-muted-foreground">
                {Object.entries(stats.byType).sort((a, b) => b[1] - a[1])[0]?.[1] || 0} occurrences
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Most Frequent</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm truncate" title={stats.topErrors[0]?.message}>
                {stats.topErrors[0]?.message || 'N/A'}
              </div>
              <p className="text-xs text-muted-foreground">
                {stats.topErrors[0]?.count || 0} occurrences
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex gap-2 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search errors..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={filters.type || "all"} onValueChange={(value) => setFilters({...filters, type: value === "all" ? "" : value})}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="websocket">WebSocket</SelectItem>
            <SelectItem value="api">API</SelectItem>
            <SelectItem value="trading">Trading</SelectItem>
            <SelectItem value="config">Config</SelectItem>
            <SelectItem value="system">System</SelectItem>
            <SelectItem value="general">General</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filters.severity || "all"} onValueChange={(value) => setFilters({...filters, severity: value === "all" ? "" : value})}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Severities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filters.hours} onValueChange={(value) => setFilters({...filters, hours: value})}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Last Hour</SelectItem>
            <SelectItem value="6">Last 6 Hours</SelectItem>
            <SelectItem value="24">Last 24 Hours</SelectItem>
            <SelectItem value="168">Last Week</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Error List</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">Loading errors...</div>
            ) : filteredErrors.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No errors found</div>
            ) : (
              filteredErrors.map((error) => (
                <div
                  key={error.id}
                  className="border rounded-lg p-4 hover:bg-gray-500/10 dark:hover:bg-gray-400/10 cursor-pointer transition-colors"
                  onClick={() => setSelectedError(error)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        {getSeverityIcon(error.severity)}
                        <Badge className={getSeverityColor(error.severity)}>
                          {error.severity}
                        </Badge>
                        <Badge variant="outline">{error.error_type}</Badge>
                        {error.component && (
                          <Badge variant="secondary">{error.component}</Badge>
                        )}
                        {error.symbol && (
                          <Badge variant="secondary">{error.symbol}</Badge>
                        )}
                        {error.resolved && (
                          <Badge className="bg-green-100 text-green-800">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Resolved
                          </Badge>
                        )}
                        {(() => {
                          const similar = findSimilarErrors(error);
                          return similar.length > 0 ? (
                            <Badge variant="outline" className="bg-purple-50 dark:bg-purple-900/20">
                              {similar.length + 1} similar
                            </Badge>
                          ) : null;
                        })()}
                      </div>
                      <div className="font-mono text-sm mb-1">{error.message}</div>
                      <div className="text-xs text-muted-foreground flex flex-col sm:flex-row sm:gap-1">
                        <span className="whitespace-nowrap">{new Date(error.timestamp).toLocaleTimeString()}</span>
                        <span className="hidden sm:inline">•</span>
                        <span className="whitespace-nowrap">{new Date(error.timestamp).toLocaleDateString()}</span>
                        {error.error_code && <><span className="hidden sm:inline">•</span><span>Code: {error.error_code}</span></>}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIssueGeneratorError(error);
                        }}
                        title="Create GitHub Issue"
                      >
                        <Github className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          const debugInfo = generateAIDebugInfo(error);
                          copyToClipboard(debugInfo);
                        }}
                        title="Copy AI Debug Info"
                      >
                        <Bot className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(JSON.stringify(error, null, 2));
                        }}
                        title="Copy Raw JSON"
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                      {!error.resolved && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMarkResolved(error.id);
                          }}
                          title="Mark as Resolved"
                        >
                          <CheckCircle className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {selectedError && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <Card className="max-w-3xl max-h-[80vh] overflow-auto">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Error Details
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedError(null)}
                >
                  ×
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <strong>Message:</strong>
                <pre className="mt-1 p-2 bg-gray-100 dark:bg-gray-800 rounded text-sm overflow-x-auto text-gray-900 dark:text-gray-100">
                  {selectedError.message}
                </pre>
              </div>

              {selectedError.stack_trace && (
                <div>
                  <strong>Stack Trace:</strong>
                  <pre className="mt-1 p-2 bg-gray-100 dark:bg-gray-800 rounded text-xs overflow-x-auto max-h-60 text-gray-900 dark:text-gray-100">
                    {selectedError.stack_trace}
                  </pre>
                </div>
              )}

              {selectedError.details && (
                <div>
                  <strong>Details:</strong>
                  <pre className="mt-1 p-2 bg-gray-100 dark:bg-gray-800 rounded text-sm overflow-x-auto text-gray-900 dark:text-gray-100">
                    {JSON.stringify(
                      typeof selectedError.details === 'string'
                        ? JSON.parse(selectedError.details)
                        : selectedError.details,
                      null,
                      2
                    )}
                  </pre>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <strong>Type:</strong> {selectedError.error_type}
                </div>
                <div>
                  <strong>Severity:</strong> {selectedError.severity}
                </div>
                {selectedError.component && (
                  <div>
                    <strong>Component:</strong> {selectedError.component}
                  </div>
                )}
                {selectedError.symbol && (
                  <div>
                    <strong>Symbol:</strong> {selectedError.symbol}
                  </div>
                )}
                {selectedError.user_action && (
                  <div className="col-span-2">
                    <strong>User Action:</strong> {selectedError.user_action}
                  </div>
                )}
                <div className="col-span-2">
                  <strong>Session ID:</strong> <code>{selectedError.session_id}</code>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    copyToClipboard(JSON.stringify(selectedError, null, 2));
                  }}
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Copy Full Error
                </Button>
                {!selectedError.resolved && (
                  <Button
                    onClick={() => {
                      handleMarkResolved(selectedError.id);
                      setSelectedError(null);
                    }}
                    variant="outline"
                  >
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Mark Resolved
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {issueGeneratorError && (
        <ErrorIssueGenerator
          error={issueGeneratorError}
          systemInfo={systemInfo}
          similarErrors={findSimilarErrors(issueGeneratorError)}
          isOpen={!!issueGeneratorError}
          onClose={() => setIssueGeneratorError(null)}
        />
      )}
    </div>
  );
}