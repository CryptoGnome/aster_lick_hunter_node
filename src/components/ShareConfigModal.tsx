'use client';

import React, { useRef } from 'react';
import { Download, X } from 'lucide-react';
import { toPng } from 'html-to-image';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import type { Config } from '@/lib/config/types';

interface ShareConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: Config;
}

export default function ShareConfigModal({ isOpen, onClose, config }: ShareConfigModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  const handleExport = async () => {
    if (!contentRef.current) return;

    try {
      toast.info('Generating screenshot...');

      const dataUrl = await toPng(contentRef.current, {
        quality: 1.0,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
      });

      const link = document.createElement('a');
      link.download = `aster-config-${new Date().toISOString().split('T')[0]}.png`;
      link.href = dataUrl;
      link.click();

      toast.success('Configuration exported successfully!');
    } catch (error) {
      console.error('Failed to export configuration:', error);
      toast.error('Failed to export configuration');
    }
  };

  const symbols = Object.entries(config.symbols);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[95vh] overflow-y-auto p-0">
        <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center justify-between">
          <DialogHeader className="flex-1">
            <DialogTitle className="text-lg">Share Configuration</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Button onClick={handleExport} size="sm" variant="outline">
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Export
            </Button>
            <Button onClick={onClose} variant="ghost" size="icon" className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div ref={contentRef} className="p-6 space-y-4 bg-background">
          {symbols.map(([symbol, symbolConfig]) => (
            <div key={symbol} className="border rounded-lg overflow-hidden">
              {/* Symbol Header */}
              <div className="bg-muted/50 px-4 py-2.5 border-b flex items-center gap-3">
                <h3 className="text-lg font-bold">{symbol}</h3>
                <Badge variant="outline" className="text-xs px-2 py-0 h-5">
                  {symbolConfig.leverage}x
                </Badge>
                <Badge variant="secondary" className="text-xs px-2 py-0 h-5">
                  {symbolConfig.orderType || 'LIMIT'}
                </Badge>
              </div>

              {/* Settings Grid */}
              <div className="p-4">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-2.5 text-xs">
                  {/* Volume Thresholds */}
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Long Vol:</span>
                    <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 font-mono">
                      ${(symbolConfig.longVolumeThresholdUSDT || symbolConfig.volumeThresholdUSDT || 0).toLocaleString()}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Short Vol:</span>
                    <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 font-mono">
                      ${(symbolConfig.shortVolumeThresholdUSDT || symbolConfig.volumeThresholdUSDT || 0).toLocaleString()}
                    </Badge>
                  </div>

                  {/* Position Sizing */}
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Base Size:</span>
                    <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5 font-mono">
                      {symbolConfig.tradeSize}
                    </Badge>
                  </div>
                  {symbolConfig.longTradeSize !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Long Size:</span>
                      <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5 font-mono">
                        ${symbolConfig.longTradeSize}
                      </Badge>
                    </div>
                  )}
                  {symbolConfig.shortTradeSize !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Short Size:</span>
                      <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5 font-mono">
                        ${symbolConfig.shortTradeSize}
                      </Badge>
                    </div>
                  )}
                  {symbolConfig.maxPositionMarginUSDT !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Max Margin:</span>
                      <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5 font-mono">
                        ${symbolConfig.maxPositionMarginUSDT}
                      </Badge>
                    </div>
                  )}

                  {/* Risk Parameters */}
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Take Profit:</span>
                    <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 border-green-600 text-green-600 dark:border-green-500 dark:text-green-500">
                      {symbolConfig.tpPercent}%
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Stop Loss:</span>
                    <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 border-red-600 text-red-600 dark:border-red-500 dark:text-red-500">
                      {symbolConfig.slPercent}%
                    </Badge>
                  </div>

                  {/* Order Settings */}
                  {symbolConfig.priceOffsetBps !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Price Offset:</span>
                      <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5">
                        {symbolConfig.priceOffsetBps} bps
                      </Badge>
                    </div>
                  )}
                  {symbolConfig.maxSlippageBps !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Max Slippage:</span>
                      <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5">
                        {symbolConfig.maxSlippageBps} bps
                      </Badge>
                    </div>
                  )}
                  {symbolConfig.usePostOnly !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Post-Only:</span>
                      <Badge variant={symbolConfig.usePostOnly ? "default" : "outline"} className="text-xs px-1.5 py-0 h-5">
                        {symbolConfig.usePostOnly ? 'Yes' : 'No'}
                      </Badge>
                    </div>
                  )}
                  {symbolConfig.forceMarketEntry !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Force Market:</span>
                      <Badge variant={symbolConfig.forceMarketEntry ? "default" : "outline"} className="text-xs px-1.5 py-0 h-5">
                        {symbolConfig.forceMarketEntry ? 'Yes' : 'No'}
                      </Badge>
                    </div>
                  )}

                  {/* VWAP Protection */}
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">VWAP:</span>
                    <Badge variant={symbolConfig.vwapProtection ? "default" : "outline"} className="text-xs px-1.5 py-0 h-5">
                      {symbolConfig.vwapProtection ? 'On' : 'Off'}
                    </Badge>
                  </div>
                  {symbolConfig.vwapProtection && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Timeframe:</span>
                        <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5">
                          {symbolConfig.vwapTimeframe || '5m'}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Lookback:</span>
                        <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5">
                          {symbolConfig.vwapLookback || 200}
                        </Badge>
                      </div>
                    </>
                  )}

                  {/* Threshold System */}
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Threshold:</span>
                    <Badge variant={symbolConfig.useThreshold ? "default" : "outline"} className="text-xs px-1.5 py-0 h-5">
                      {symbolConfig.useThreshold ? 'On' : 'Off'}
                    </Badge>
                  </div>
                  {symbolConfig.useThreshold && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Window:</span>
                        <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5">
                          {((symbolConfig.thresholdTimeWindow || 60000) / 1000).toFixed(0)}s
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Cooldown:</span>
                        <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5">
                          {((symbolConfig.thresholdCooldown || 30000) / 1000).toFixed(0)}s
                        </Badge>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
