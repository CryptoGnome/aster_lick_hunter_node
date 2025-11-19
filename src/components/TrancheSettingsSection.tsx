'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface TrancheSettingsSectionProps {
  symbol: string;
  config: any;
  onChange: (field: string, value: any) => void;
}

export function TrancheSettingsSection({ symbol, config, onChange }: TrancheSettingsSectionProps) {
  const enabled = config.enableTrancheManagement ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Multi-Tranche Position Management</CardTitle>
        <CardDescription>
          Track multiple position entries to isolate underwater positions and continue trading
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Enable/Disable Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor={`${symbol}-enable-tranche`}>Enable Tranche Management</Label>
            <p className="text-sm text-muted-foreground">
              Track multiple virtual position entries for better margin utilization
            </p>
          </div>
          <Switch
            id={`${symbol}-enable-tranche`}
            checked={enabled}
            onCheckedChange={(checked) => onChange('enableTrancheManagement', checked)}
          />
        </div>

        {enabled && (
          <>
            <Separator />

            {/* Isolation Threshold */}
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <Label htmlFor={`${symbol}-isolation-threshold`}>
                  Isolation Threshold (%)
                </Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">
                        Tranches with unrealized loss exceeding this percentage will be isolated.
                        New trades won&apos;t add to isolated tranches.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Input
                id={`${symbol}-isolation-threshold`}
                type="number"
                min="1"
                max="50"
                step="0.5"
                value={config.trancheIsolationThreshold ?? 5}
                onChange={(e) => onChange('trancheIsolationThreshold', parseFloat(e.target.value) || 5)}
                placeholder="5"
              />
              <p className="text-xs text-muted-foreground">
                Default: 5% loss. Typical range: 3-10%
              </p>
            </div>

            {/* Max Tranches */}
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <Label htmlFor={`${symbol}-max-tranches`}>
                  Max Active Tranches
                </Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">
                        Maximum number of active (non-isolated) tranches allowed per symbol.
                        Prevents over-exposure to a single asset.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Input
                id={`${symbol}-max-tranches`}
                type="number"
                min="1"
                max="10"
                step="1"
                value={config.maxTranches ?? 3}
                onChange={(e) => onChange('maxTranches', parseInt(e.target.value) || 3)}
                placeholder="3"
              />
              <p className="text-xs text-muted-foreground">
                Default: 3. Typical range: 2-5
              </p>
            </div>

            {/* Max Isolated Tranches */}
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <Label htmlFor={`${symbol}-max-isolated-tranches`}>
                  Max Isolated Tranches
                </Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">
                        Maximum number of isolated (underwater) tranches allowed before blocking new trades.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Input
                id={`${symbol}-max-isolated-tranches`}
                type="number"
                min="1"
                max="5"
                step="1"
                value={config.maxIsolatedTranches ?? 2}
                onChange={(e) => onChange('maxIsolatedTranches', parseInt(e.target.value) || 2)}
                placeholder="2"
              />
              <p className="text-xs text-muted-foreground">
                Default: 2. Typical range: 1-3
              </p>
            </div>

            <Separator />

            {/* Strategy Info */}
            <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
              <h4 className="font-medium text-sm">Tranche Strategies (Auto-configured)</h4>
              <div className="space-y-1 text-sm text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground">Closing Strategy:</span> LIFO (Last In, First Out)
                  <br />
                  <span className="text-xs">→ Closes newest tranches first for quick profit-taking</span>
                </p>
                <p>
                  <span className="font-medium text-foreground">SL/TP Strategy:</span> Best Entry Price
                  <br />
                  <span className="text-xs">→ Protects your most favorable entry price</span>
                </p>
              </div>
            </div>

            <Separator />

            {/* Advanced Options */}
            <div className="space-y-4">
              <h4 className="font-medium text-sm">Advanced Options</h4>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor={`${symbol}-allow-while-isolated`}>
                    Allow New Tranches While Isolated
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Continue opening new tranches even when isolated tranches exist
                  </p>
                </div>
                <Switch
                  id={`${symbol}-allow-while-isolated`}
                  checked={config.allowTrancheWhileIsolated ?? true}
                  onCheckedChange={(checked) => onChange('allowTrancheWhileIsolated', checked)}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor={`${symbol}-auto-close-isolated`}>
                    Auto-Close Isolated Tranches
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically close isolated tranches when they recover
                  </p>
                </div>
                <Switch
                  id={`${symbol}-auto-close-isolated`}
                  checked={config.trancheAutoCloseIsolated ?? false}
                  onCheckedChange={(checked) => onChange('trancheAutoCloseIsolated', checked)}
                />
              </div>

              {config.trancheAutoCloseIsolated && (
                <div className="grid gap-2 ml-6 pl-4 border-l-2 border-muted">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`${symbol}-recovery-threshold`}>
                      Recovery Threshold (%)
                    </Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger>
                          <Info className="h-4 w-4 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-xs">
                            Isolated tranches will auto-close when unrealized profit exceeds this percentage.
                            Example: 0.5% means close at +0.5% profit (just above breakeven).
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <Input
                    id={`${symbol}-recovery-threshold`}
                    type="number"
                    min="0"
                    max="5"
                    step="0.1"
                    value={config.trancheRecoveryThreshold ?? 0.5}
                    onChange={(e) => onChange('trancheRecoveryThreshold', parseFloat(e.target.value) || 0.5)}
                    placeholder="0.5"
                  />
                  <p className="text-xs text-muted-foreground">
                    Default: 0.5% profit. Typical range: 0-2%
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
