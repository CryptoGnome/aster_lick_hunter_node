'use client';

import { useState } from 'react';
import { TrancheBreakdownCard } from '@/components/TrancheBreakdownCard';
import { TrancheTimeline } from '@/components/TrancheTimeline';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Layers, TrendingUp, AlertTriangle, Info } from 'lucide-react';

export default function TranchesPage() {
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT');
  const [selectedSide, setSelectedSide] = useState<'LONG' | 'SHORT'>('LONG');

  // Common trading symbols
  const symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Layers className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">Multi-Tranche Management</h1>
            <p className="text-muted-foreground">
              Track multiple position entries for better margin utilization
            </p>
          </div>
        </div>

        {/* Info Card */}
        <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900">
          <CardContent className="pt-6">
            <div className="flex gap-3">
              <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="space-y-2 text-sm text-blue-900 dark:text-blue-100">
                <p className="font-semibold">What are Tranches?</p>
                <p>
                  Tranches are virtual position entries that allow you to track multiple trades on the same symbol independently.
                  When a position goes underwater (&gt;5% loss), it gets <strong>isolated</strong> - allowing you to open fresh
                  tranches without adding to the losing position.
                </p>
                <div className="flex gap-4 mt-3">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-green-600" />
                    <span>Active: Trading normally</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-yellow-600" />
                    <span>Isolated: Holding for recovery</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Symbol/Side Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">View Tranches</CardTitle>
          <CardDescription>Select a symbol and position side to view tranches</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Symbol</Label>
              <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {symbols.map((symbol) => (
                    <SelectItem key={symbol} value={symbol}>
                      {symbol}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Position Side</Label>
              <Select
                value={selectedSide}
                onValueChange={(value) => setSelectedSide(value as 'LONG' | 'SHORT')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LONG">
                    <div className="flex items-center gap-2">
                      <Badge variant="default">LONG</Badge>
                      <span className="text-sm text-muted-foreground">Buy positions</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="SHORT">
                    <div className="flex items-center gap-2">
                      <Badge variant="destructive">SHORT</Badge>
                      <span className="text-sm text-muted-foreground">Sell positions</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Content Tabs */}
      <Tabs defaultValue="breakdown" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="breakdown">Tranche Breakdown</TabsTrigger>
          <TabsTrigger value="timeline">Activity Timeline</TabsTrigger>
        </TabsList>

        <TabsContent value="breakdown" className="space-y-4">
          <TrancheBreakdownCard symbol={selectedSymbol} side={selectedSide} />
        </TabsContent>

        <TabsContent value="timeline" className="space-y-4">
          <TrancheTimeline />
        </TabsContent>
      </Tabs>

      {/* How It Works */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How Multi-Tranche Management Works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="space-y-2">
            <h4 className="font-semibold">1. Entry</h4>
            <p className="text-muted-foreground">
              When you open a position, a tranche is created to track entry price, quantity, and P&L.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold">2. Isolation (Optional)</h4>
            <p className="text-muted-foreground">
              If a tranche goes &gt;5% underwater (configurable), it gets automatically isolated. This means new trades
              won&apos;t add to this position - you can continue trading while waiting for recovery.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold">3. Continue Trading</h4>
            <p className="text-muted-foreground">
              With isolated tranches, you can open fresh positions on the same symbol without adding to losers.
              The bot tracks everything locally while the exchange sees one combined position.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold">4. Exit</h4>
            <p className="text-muted-foreground">
              When SL/TP is hit, tranches are closed using your chosen strategy (FIFO, LIFO, etc.). P&L is tracked
              per tranche and aggregated for total performance.
            </p>
          </div>

          <div className="mt-4 p-3 bg-muted rounded-lg">
            <p className="text-xs text-muted-foreground">
              <strong>Note:</strong> Tranche management is a local tracking system. The exchange still sees a single
              position per symbol+side. Configure settings in the <strong>Configuration</strong> page.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
