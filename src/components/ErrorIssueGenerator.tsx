'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Copy, ExternalLink, Github, Bot, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

interface ErrorLog {
  id: number;
  timestamp: string;
  error_type: string;
  error_code?: string;
  message: string;
  details?: any;
  stack_trace?: string;
  component?: string;
  symbol?: string;
  user_action?: string;
  severity: string;
  session_id: string;
}

interface SystemInfo {
  platform: string;
  version: string;
  memory: {
    total: number;
    free: number;
    used: number;
  };
  uptime: number;
}

interface ErrorIssueGeneratorProps {
  error: ErrorLog;
  systemInfo?: SystemInfo;
  similarErrors?: ErrorLog[];
  isOpen: boolean;
  onClose: () => void;
}

export default function ErrorIssueGenerator({
  error,
  systemInfo,
  similarErrors,
  isOpen,
  onClose,
}: ErrorIssueGeneratorProps) {
  const [issueTitle, setIssueTitle] = useState('');
  const [issueBody, setIssueBody] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const getErrorSubCategory = (error: ErrorLog): string => {
    const message = error.message.toLowerCase();
    const code = error.error_code;

    if (error.error_type === 'api') {
      if (code === '-1003' || message.includes('rate limit')) return 'rate-limit';
      if (code === '-2015' || code === '-1022') return 'authentication';
      if (code?.startsWith('-4') || code?.startsWith('-1')) return 'validation';
      if (message.includes('500') || message.includes('502')) return 'server-error';
    }

    if (error.error_type === 'trading') {
      if (code === '-4164' || message.includes('notional')) return 'notional-error';
      if (code === '-2019' || message.includes('insufficient')) return 'insufficient-balance';
      if (code === '-1111' || message.includes('precision')) return 'price-precision';
      if (code === '-1013' || message.includes('quantity')) return 'quantity-precision';
      if (code === '-2010' || message.includes('rejected')) return 'order-rejection';
    }

    if (error.error_type === 'websocket') {
      if (message.includes('connect')) return 'connection-lost';
      if (message.includes('reconnect')) return 'reconnect-failed';
      if (message.includes('parse') || message.includes('json')) return 'message-parse';
    }

    if (error.error_type === 'system') {
      if (message.includes('memory')) return 'memory-leak';
      if (message.includes('crash') || message.includes('fatal')) return 'crash';
      if (message.includes('uncaught')) return 'uncaught-exception';
    }

    return 'general';
  };

  const getGitHubLabels = React.useCallback((error: ErrorLog): string[] => {
    const labels = ['bug'];

    // Add severity label
    if (error.severity === 'critical') labels.push('critical', 'urgent');
    if (error.severity === 'high') labels.push('high-priority');

    // Add type label
    labels.push(`type:${error.error_type}`);

    // Add sub-category label
    const subCategory = getErrorSubCategory(error);
    if (subCategory !== 'general') {
      labels.push(`error:${subCategory}`);
    }

    // Add component label if available
    if (error.component) {
      labels.push(`component:${error.component}`);
    }

    return labels;
  }, []);

  const generateAIDebugInfo = React.useCallback(() => {
    const subCategory = getErrorSubCategory(error);
    const _labels = getGitHubLabels(error);

    let debugInfo = `## AI Debug Information\n\n`;
    debugInfo += `This error report is formatted for AI assistance (Claude, ChatGPT, etc.)\n\n`;

    debugInfo += `### Error Classification\n`;
    debugInfo += `- **Type**: ${error.error_type}\n`;
    debugInfo += `- **Sub-category**: ${subCategory}\n`;
    debugInfo += `- **Severity**: ${error.severity}\n`;
    debugInfo += `- **Error Code**: ${error.error_code || 'N/A'}\n`;
    debugInfo += `- **Component**: ${error.component || 'Unknown'}\n`;
    debugInfo += `- **Symbol**: ${error.symbol || 'N/A'}\n\n`;

    debugInfo += `### Environment Context\n`;
    if (systemInfo) {
      debugInfo += `- **Platform**: ${systemInfo.platform}\n`;
      debugInfo += `- **Node Version**: ${systemInfo.version}\n`;
      debugInfo += `- **Memory Usage**: ${Math.round(systemInfo.memory.used / 1024 / 1024)}MB / ${Math.round(systemInfo.memory.total / 1024 / 1024)}MB\n`;
      debugInfo += `- **Process Uptime**: ${Math.round(systemInfo.uptime / 60)} minutes\n`;
    }
    debugInfo += `- **Session ID**: ${error.session_id}\n`;
    debugInfo += `- **Timestamp**: ${error.timestamp}\n\n`;

    debugInfo += `### Error Details\n`;
    debugInfo += `\`\`\`\n${error.message}\n\`\`\`\n\n`;

    if (error.details) {
      debugInfo += `### Additional Context\n`;
      debugInfo += `\`\`\`json\n${JSON.stringify(
        typeof error.details === 'string' ? JSON.parse(error.details) : error.details,
        null,
        2
      )}\n\`\`\`\n\n`;
    }

    if (error.user_action) {
      debugInfo += `### User Action That Triggered Error\n`;
      debugInfo += `${error.user_action}\n\n`;
    }

    if (error.stack_trace) {
      debugInfo += `### Stack Trace\n`;
      debugInfo += `<details>\n<summary>Click to expand stack trace</summary>\n\n`;
      debugInfo += `\`\`\`\n${error.stack_trace}\n\`\`\`\n`;
      debugInfo += `</details>\n\n`;
    }

    if (similarErrors && similarErrors.length > 0) {
      debugInfo += `### Similar Errors (Pattern Detection)\n`;
      debugInfo += `Found ${similarErrors.length} similar errors in the current session:\n\n`;
      similarErrors.slice(0, 5).forEach((simError, idx) => {
        debugInfo += `${idx + 1}. **${new Date(simError.timestamp).toLocaleString()}**: ${simError.message.substring(0, 100)}${simError.message.length > 100 ? '...' : ''}\n`;
      });
      debugInfo += `\n`;
    }

    debugInfo += `### Suggested Investigation Steps\n`;

    // Add specific suggestions based on error type
    if (error.error_type === 'api' && subCategory === 'rate-limit') {
      debugInfo += `1. Check rate limit configuration and current usage\n`;
      debugInfo += `2. Review request batching and throttling mechanisms\n`;
      debugInfo += `3. Verify exponential backoff implementation\n`;
    } else if (error.error_type === 'trading' && subCategory === 'notional-error') {
      debugInfo += `1. Review minimum notional requirements for ${error.symbol || 'the symbol'}\n`;
      debugInfo += `2. Check quantity and price calculations\n`;
      debugInfo += `3. Verify leverage settings and their impact on notional value\n`;
    } else if (error.error_type === 'websocket') {
      debugInfo += `1. Check WebSocket connection stability and reconnection logic\n`;
      debugInfo += `2. Review message parsing and error handling\n`;
      debugInfo += `3. Verify heartbeat/ping-pong mechanism\n`;
    } else {
      debugInfo += `1. Review the component where the error occurred: ${error.component || 'Unknown'}\n`;
      debugInfo += `2. Check input validation and error boundaries\n`;
      debugInfo += `3. Review recent changes that might have introduced this issue\n`;
    }

    debugInfo += `\n### Potential Fixes\n`;

    // Add specific fix suggestions based on error patterns
    if (error.error_code === '-4164') {
      debugInfo += `- Increase order size to meet minimum notional requirement\n`;
      debugInfo += `- Adjust leverage to increase effective notional value\n`;
      debugInfo += `- Implement dynamic quantity calculation based on current price\n`;
    } else if (error.error_code === '-1003') {
      debugInfo += `- Implement request queuing with rate limit awareness\n`;
      debugInfo += `- Add exponential backoff for retries\n`;
      debugInfo += `- Consider using weight-based rate limiting\n`;
    } else if (error.error_code === '-1111' || error.error_code === '-1013') {
      debugInfo += `- Round prices/quantities to exchange-required precision\n`;
      debugInfo += `- Fetch and cache symbol precision requirements\n`;
      debugInfo += `- Implement precision validation before order submission\n`;
    }

    debugInfo += `\n---\n`;
    debugInfo += `*This debug information was automatically generated for AI-assisted debugging.*\n`;

    return debugInfo;
  }, [error, systemInfo, similarErrors, getGitHubLabels]);

  const generateIssueContent = React.useCallback(() => {
    setIsGenerating(true);

    // Generate title
    const subCategory = getErrorSubCategory(error);
    const titlePrefix = error.severity === 'critical' ? '[CRITICAL] ' : error.severity === 'high' ? '[HIGH] ' : '';
    const errorType = error.error_type.charAt(0).toUpperCase() + error.error_type.slice(1);
    const title = `${titlePrefix}${errorType} Error: ${error.message.substring(0, 80)}${error.message.length > 80 ? '...' : ''}`;
    setIssueTitle(title);

    // Generate body
    let body = `## Bug Report\n\n`;
    body += `### Summary\n`;
    body += `${error.message}\n\n`;

    body += `### Error Information\n`;
    body += `- **Error Type**: ${error.error_type}\n`;
    body += `- **Sub-category**: ${subCategory}\n`;
    body += `- **Severity**: ${error.severity}\n`;
    body += `- **Error Code**: ${error.error_code || 'N/A'}\n`;
    body += `- **Component**: ${error.component || 'Unknown'}\n`;
    body += `- **Symbol**: ${error.symbol || 'N/A'}\n`;
    body += `- **Timestamp**: ${new Date(error.timestamp).toISOString()}\n`;
    body += `- **Session ID**: \`${error.session_id}\`\n\n`;

    body += generateAIDebugInfo();

    const issueLabels = getGitHubLabels(error);
    body += `### Labels\n`;
    body += issueLabels.map(label => `- ${label}`).join('\n');
    body += `\n\n`;

    body += `### Additional Notes\n`;
    body += `_Please add any additional context about what you were doing when this error occurred._\n`;

    setIssueBody(body);
    setIsGenerating(false);
  }, [error, generateAIDebugInfo, getGitHubLabels]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const openGitHubIssue = () => {
    const labels = getGitHubLabels(error).join(',');
    const encodedTitle = encodeURIComponent(issueTitle);
    const encodedBody = encodeURIComponent(issueBody);
    const url = `https://github.com/CryptoGnome/aster_lick_hunter_node/issues/new?title=${encodedTitle}&body=${encodedBody}&labels=${labels}`;
    window.open(url, '_blank');
  };

  React.useEffect(() => {
    if (isOpen && !issueTitle && !issueBody) {
      generateIssueContent();
    }
  }, [isOpen, issueTitle, issueBody, generateIssueContent]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Generate GitHub Issue</DialogTitle>
          <DialogDescription>
            Create a GitHub issue for this error with AI-optimized formatting
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge className={
              error.severity === 'critical' ? 'bg-red-100 text-red-800' :
              error.severity === 'high' ? 'bg-orange-100 text-orange-800' :
              error.severity === 'medium' ? 'bg-yellow-100 text-yellow-800' :
              'bg-blue-100 text-blue-800'
            }>
              {error.severity}
            </Badge>
            <Badge variant="outline">{error.error_type}</Badge>
            <Badge variant="secondary">{getErrorSubCategory(error)}</Badge>
            {error.error_code && (
              <Badge variant="outline">Code: {error.error_code}</Badge>
            )}
          </div>

          <div>
            <Label htmlFor="issue-title">Issue Title</Label>
            <Input
              id="issue-title"
              value={issueTitle}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIssueTitle(e.target.value)}
              placeholder="Enter issue title..."
              className="mt-1"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <Label htmlFor="issue-body">Issue Body (Markdown)</Label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => generateIssueContent()}
                  disabled={isGenerating}
                >
                  <Bot className="w-4 h-4 mr-2" />
                  Regenerate
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard(issueBody)}
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Copy
                </Button>
              </div>
            </div>
            <Textarea
              id="issue-body"
              value={issueBody}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setIssueBody(e.target.value)}
              className="min-h-[300px] font-mono text-sm"
            />
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-md">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5" />
              <div className="text-sm text-blue-800 dark:text-blue-300">
                <p className="font-semibold">AI-Optimized Format</p>
                <p>This issue is formatted for easy debugging with AI assistants like Claude or ChatGPT. The structured format includes all necessary context for quick resolution.</p>
              </div>
            </div>
          </div>

          <div>
            <Label>GitHub Labels</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {getGitHubLabels(error).map(label => (
                <Badge key={label} variant="secondary">
                  {label}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const debugInfo = generateAIDebugInfo();
              copyToClipboard(debugInfo);
              toast.success('AI debug info copied to clipboard');
            }}
          >
            <Bot className="w-4 h-4 mr-2" />
            Copy AI Debug Info
          </Button>
          <Button onClick={openGitHubIssue}>
            <Github className="w-4 h-4 mr-2" />
            Create Issue on GitHub
            <ExternalLink className="w-3 h-3 ml-1" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}