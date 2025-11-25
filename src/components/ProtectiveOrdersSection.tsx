'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Info, Plus, Trash2, Shield } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface ProtectiveOrdersSectionProps {
  symbol: string;
  config: any;
  onChange: (field: string, value: any) => void;
}

export function ProtectiveOrdersSection({ symbol, config, onChange }: ProtectiveOrdersSectionProps) {
  const enabled = config.enableProtectiveOrders ?? false;
  const breakeven = config.protectiveBreakeven ?? { enabled: false, triggerOffset: 0, trimPercent: 50 };
  const trimLevels = config.protectiveTrimLevels ?? [];

  const handleBreakevenChange = (field: string, value: any) => {
    onChange('protectiveBreakeven', {
      ...breakeven,
      [field]: value,
    });
  };

  const addTrimLevel = () => {
    const newLevel = { triggerPercent: 2, trimPercent: 25 };
    onChange('protectiveTrimLevels', [...trimLevels, newLevel]);
  };

  const removeTrimLevel = (index: number) => {
    const updated = trimLevels.filter((_: any, i: number) => i !== index);
    onChange('protectiveTrimLevels', updated);
  };

  const updateTrimLevel = (index: number, field: string, value: number) => {
    const updated = [...trimLevels];
    updated[index] = { ...updated[index], [field]: value };
    onChange('protectiveTrimLevels', updated);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Shield className="h-4 w-4" />
          Protective Orders
        </CardTitle>
        <CardDescription>
          Automatically trim portions of positions at specific price levels before TP/SL
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Enable/Disable Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor={`${symbol}-enable-protective`}>Enable Protective Orders</Label>
            <p className="text-sm text-muted-foreground">
              Place LIMIT orders to trim position size at breakeven or profit levels
            </p>
          </div>
          <Switch
            id={`${symbol}-enable-protective`}
            checked={enabled}
            onCheckedChange={(checked) => onChange('enableProtectiveOrders', checked)}
          />
        </div>

        {enabled && (
          <>
            <Separator />

            {/* Breakeven Protection */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor={`${symbol}-breakeven-enabled`}>Breakeven Trim</Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically trim position when price returns near entry
                  </p>
                </div>
                <Switch
                  id={`${symbol}-breakeven-enabled`}
                  checked={breakeven.enabled}
                  onCheckedChange={(checked) => handleBreakevenChange('enabled', checked)}
                />
              </div>

              {breakeven.enabled && (
                <div className="grid grid-cols-2 gap-4 pl-6">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`${symbol}-breakeven-offset`}>
                        Trigger Offset (%)
                      </Label>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <Info className="h-4 w-4 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-xs">
                              0 = exact breakeven, 1 = 1% profit, -1 = 1% loss from entry
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <Input
                      id={`${symbol}-breakeven-offset`}
                      type="number"
                      step="0.1"
                      value={breakeven.triggerOffset}
                      onChange={(e) => handleBreakevenChange('triggerOffset', parseFloat(e.target.value) || 0)}
                      placeholder="0"
                    />
                    <p className="text-xs text-muted-foreground">
                      Default: 0% (exact breakeven)
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`${symbol}-breakeven-trim`}>
                      Trim Amount (%)
                    </Label>
                    <Input
                      id={`${symbol}-breakeven-trim`}
                      type="number"
                      min="1"
                      max="100"
                      step="5"
                      value={breakeven.trimPercent}
                      onChange={(e) => handleBreakevenChange('trimPercent', parseFloat(e.target.value) || 50)}
                      placeholder="50"
                    />
                    <p className="text-xs text-muted-foreground">
                      % of position to close (1-100%)
                    </p>
                  </div>
                </div>
              )}
            </div>

            <Separator />

            {/* Multi-Level Trims */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Additional Trim Levels</Label>
                  <p className="text-sm text-muted-foreground">
                    Set multiple profit/loss levels for position trimming
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addTrimLevel}
                  className="flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add Level
                </Button>
              </div>

              {trimLevels.length > 0 && (
                <div className="space-y-3">
                  {trimLevels.map((level: any, index: number) => (
                    <div key={index} className="flex items-center gap-3 p-3 border rounded-lg">
                      <div className="flex-1 grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Trigger P&L (%)</Label>
                          <Input
                            type="number"
                            step="0.5"
                            value={level.triggerPercent}
                            onChange={(e) => updateTrimLevel(index, 'triggerPercent', parseFloat(e.target.value) || 0)}
                            placeholder="2"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Trim (%)</Label>
                          <Input
                            type="number"
                            min="1"
                            max="100"
                            step="5"
                            value={level.trimPercent}
                            onChange={(e) => updateTrimLevel(index, 'trimPercent', parseFloat(e.target.value) || 25)}
                            placeholder="25"
                          />
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeTrimLevel(index)}
                        className="flex-shrink-0"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>How it works:</strong> Protective orders use LIMIT orders with the <code>po_</code> prefix.
                They won&apos;t interfere with your main TP/SL orders. These are complementary safety measures that
                execute before your main exit targets.
              </AlertDescription>
            </Alert>
          </>
        )}
      </CardContent>
    </Card>
  );
}
