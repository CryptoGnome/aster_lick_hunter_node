'use client';

import React, { useState } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import SymbolConfigForm from '@/components/SymbolConfigForm';
import ShareConfigModal from '@/components/ShareConfigModal';
import { useConfig } from '@/components/ConfigProvider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle2, Settings, Share2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';

export default function ConfigPage() {
  const { config, loading, updateConfig } = useConfig();
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [shareModalOpen, setShareModalOpen] = useState(false);

  const handleSave = async (newConfig: any) => {
    setSaveStatus('saving');
    try {
      const hasApiKeyChanges = config && (
        newConfig.api.apiKey !== config.api.apiKey ||
        newConfig.api.secretKey !== config.api.secretKey
      );

      await updateConfig(newConfig);
      setSaveStatus('saved');
      toast.success('Configuration saved successfully');

      // Force refresh if API keys were changed to repull dashboard data
      if (hasApiKeyChanges) {
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } else {
        setTimeout(() => setSaveStatus('idle'), 3000);
      }
    } catch (error) {
      console.error('Failed to save config:', error);
      setSaveStatus('error');
      toast.error('Failed to save configuration');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="p-6 space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-48" />
            </CardHeader>
            <CardContent className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-3 md:p-6 space-y-4 md:space-y-6">
        {/* Page Header */}
        <div className="space-y-2">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <div>
              <h1 className="text-xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
                <Settings className="h-6 w-6 md:h-8 md:w-8" />
                Bot Configuration
              </h1>
              <p className="text-xs md:text-sm text-muted-foreground">
                Configure your API credentials and trading parameters for each symbol
              </p>
            </div>
            <div className="flex items-center gap-2">
              {saveStatus === 'saved' && (
                <Badge variant="default" className="flex items-center gap-1 h-6 text-xs shrink-0">
                  <CheckCircle2 className="h-3 w-3" />
                  Saved
                </Badge>
              )}
              <Button
                onClick={() => setShareModalOpen(true)}
                variant="outline"
                size="sm"
                className="shrink-0"
              >
                <Share2 className="h-4 w-4 mr-2" />
                Share Settings
              </Button>
            </div>
          </div>
        </div>

        {/* Status Alert */}
        {config?.global?.paperMode && (
          <Alert>
            <AlertCircle className="h-3.5 w-3.5 md:h-4 md:w-4" />
            <AlertDescription className="text-xs md:text-sm">
              <strong>Paper Mode Active:</strong> The bot is currently in simulation mode.
              No real trades will be executed. Disable paper mode in the settings below to start live trading.
            </AlertDescription>
          </Alert>
        )}

        {/* Configuration Form */}
        {config && (
          <SymbolConfigForm
            onSave={handleSave}
            currentConfig={config}
          />
        )}

        {/* Important Notes */}
        <Card className="border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950/20">
          <CardHeader className="pb-3 md:pb-6">
            <CardTitle className="flex items-center gap-2 text-sm md:text-base text-yellow-800 dark:text-yellow-400">
              <AlertCircle className="h-4 w-4 md:h-5 md:w-5" />
              Important Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc list-inside text-xs md:text-sm text-yellow-700 dark:text-yellow-500 space-y-1.5 md:space-y-2">
              <li>Keep your API credentials secure and never share them with anyone</li>
              <li>Always start with Paper Mode enabled to test your configuration</li>
              <li>Use conservative stop-loss percentages to limit risk (recommended: 1-2%)</li>
              <li>Monitor your positions regularly when running in live mode</li>
              <li>The bot must be running locally (npm run bot) for trading to occur</li>
              <li>Ensure you have sufficient balance before enabling live trading</li>
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Share Config Modal */}
      {config && (
        <ShareConfigModal
          isOpen={shareModalOpen}
          onClose={() => setShareModalOpen(false)}
          config={config}
        />
      )}
    </DashboardLayout>
  );
}