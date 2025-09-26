'use client';

import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export function TestToasts() {
  const triggerTestToasts = () => {
    console.log('Testing toast stacking with multiple notifications...');

    // Simulate various trading notifications
    setTimeout(() => {
      toast.success('✅ Order Filled: BTCUSDT', {
        description: 'Long 0.001 BTC @ $43,250.00',
        duration: 6000
      });
    }, 100);

    setTimeout(() => {
      toast.info('📊 Liquidation Detected', {
        description: 'ETHUSDT: $15,000 liquidated @ $2,350.00',
        duration: 6000
      });
    }, 500);

    setTimeout(() => {
      toast.warning('⚠️ VWAP Protection Active', {
        description: 'BTCUSDT: Price movement exceeds threshold',
        duration: 6000
      });
    }, 1000);

    setTimeout(() => {
      toast.success('💰 Take Profit Set', {
        description: 'BTCUSDT: TP @ $44,000 (1.73% gain)',
        duration: 6000
      });
    }, 1500);

    setTimeout(() => {
      toast.error('❌ Order Failed', {
        description: 'SOLUSDT: Insufficient balance',
        duration: 6000
      });
    }, 2000);

    setTimeout(() => {
      toast.info('📈 Position Opened', {
        description: 'ETHUSDT: Long 0.5 ETH @ $2,345.00',
        duration: 6000
      });
    }, 2500);

    setTimeout(() => {
      toast.success('🎯 Stop Loss Set', {
        description: 'ETHUSDT: SL @ $2,300.00 (-1.92%)',
        duration: 6000
      });
    }, 3000);
  };

  return (
    <Button
      onClick={triggerTestToasts}
      variant="outline"
      size="sm"
    >
      Test Toast Stacking
    </Button>
  );
}