import { IncomeRecord, DailyPnL } from '@/lib/api/income';
// import { IncomeType } from '@/lib/api/income';

/**
 * Generate mock income records for testing
 */
export class MockIncomeDataGenerator {
  private static tranIdCounter = 1000000;
  private static tradeIdCounter = 2000000;

  /**
   * Generate a single income record
   */
  static createIncomeRecord(
    overrides: Partial<IncomeRecord> = {}
  ): IncomeRecord {
    return {
      symbol: 'BTCUSDT',
      incomeType: 'REALIZED_PNL',
      income: '10.50000000',
      asset: 'USDT',
      info: 'REALIZED_PNL',
      time: Date.now(),
      tranId: String(this.tranIdCounter++),
      tradeId: String(this.tradeIdCounter++),
      ...overrides,
    };
  }

  /**
   * Generate income records for a specific date range
   */
  static createIncomeRecordsForDateRange(
    startDate: Date,
    endDate: Date,
    options: {
      tradesPerDay?: number;
      winRate?: number;
      avgPnl?: number;
      avgCommission?: number;
      includeFunding?: boolean;
      symbol?: string;
    } = {}
  ): IncomeRecord[] {
    const {
      tradesPerDay = 5,
      winRate = 0.6,
      avgPnl = 50,
      avgCommission = -2,
      includeFunding = true,
      symbol = 'BTCUSDT',
    } = options;

    const records: IncomeRecord[] = [];
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      // Generate trades for this day
      for (let i = 0; i < tradesPerDay; i++) {
        const isWin = Math.random() < winRate;
        const pnlVariance = 0.5 + Math.random(); // 0.5x to 1.5x of avg
        const pnlAmount = isWin
          ? avgPnl * pnlVariance
          : -avgPnl * pnlVariance * 0.7; // Losses are typically smaller

        // Add realized PnL record
        records.push(this.createIncomeRecord({
          symbol,
          incomeType: 'REALIZED_PNL',
          income: pnlAmount.toFixed(8),
          time: currentDate.getTime() + i * 3600000, // Spread throughout the day
        }));

        // Add commission record
        records.push(this.createIncomeRecord({
          symbol,
          incomeType: 'COMMISSION',
          income: (avgCommission * (0.8 + Math.random() * 0.4)).toFixed(8),
          info: 'COMMISSION',
          time: currentDate.getTime() + i * 3600000 + 1000, // 1 second after trade
        }));
      }

      // Add funding fee records (every 8 hours)
      if (includeFunding) {
        const fundingHours = [0, 8, 16];
        for (const fundingHour of fundingHours) {
          const fundingTime = new Date(currentDate);
          fundingTime.setHours(fundingHour, 0, 0, 0);

          if (fundingTime <= endDate) {
            const fundingAmount = (Math.random() - 0.5) * 5; // -2.5 to 2.5 USDT
            records.push(this.createIncomeRecord({
              symbol,
              incomeType: 'FUNDING_FEE',
              income: fundingAmount.toFixed(8),
              info: 'FUNDING_FEE',
              time: fundingTime.getTime(),
            }));
          }
        }
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return records.sort((a, b) => a.time - b.time);
  }

  /**
   * Generate a profitable trading pattern
   */
  static createProfitablePattern(days: number = 7): IncomeRecord[] {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days + 1);

    return this.createIncomeRecordsForDateRange(startDate, endDate, {
      tradesPerDay: 8,
      winRate: 0.7,
      avgPnl: 100,
      avgCommission: -3,
      includeFunding: true,
    });
  }

  /**
   * Generate a losing trading pattern
   */
  static createLosingPattern(days: number = 7): IncomeRecord[] {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days + 1);

    return this.createIncomeRecordsForDateRange(startDate, endDate, {
      tradesPerDay: 10,
      winRate: 0.3,
      avgPnl: 80,
      avgCommission: -4,
      includeFunding: true,
    });
  }

  /**
   * Generate a break-even pattern
   */
  static createBreakEvenPattern(days: number = 7): IncomeRecord[] {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days + 1);

    return this.createIncomeRecordsForDateRange(startDate, endDate, {
      tradesPerDay: 6,
      winRate: 0.5,
      avgPnl: 50,
      avgCommission: -2.5,
      includeFunding: true,
    });
  }

  /**
   * Generate records with specific edge cases
   */
  static createEdgeCaseRecords(): {
    empty: IncomeRecord[];
    singleDay: IncomeRecord[];
    todayOnly: IncomeRecord[];
    missingToday: IncomeRecord[];
    largeDataset: IncomeRecord[];
    duplicateTimes: IncomeRecord[];
    mixedSymbols: IncomeRecord[];
    noTrades: IncomeRecord[];
  } {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);

    return {
      // Empty dataset
      empty: [],

      // Single day with minimal data
      singleDay: [
        this.createIncomeRecord({
          incomeType: 'REALIZED_PNL',
          income: '100.00000000',
          time: yesterday.getTime(),
        }),
        this.createIncomeRecord({
          incomeType: 'COMMISSION',
          income: '-2.00000000',
          time: yesterday.getTime() + 1000,
        }),
      ],

      // Only today's data
      todayOnly: this.createIncomeRecordsForDateRange(today, today, {
        tradesPerDay: 3,
      }),

      // Missing today's data (ends yesterday)
      missingToday: this.createIncomeRecordsForDateRange(lastWeek, yesterday, {
        tradesPerDay: 5,
      }),

      // Large dataset (>1000 records)
      largeDataset: this.createLargeDataset(),

      // Records with duplicate timestamps
      duplicateTimes: [
        this.createIncomeRecord({
          income: '50.00000000',
          time: today.getTime(),
        }),
        this.createIncomeRecord({
          income: '75.00000000',
          time: today.getTime(), // Same timestamp
        }),
        this.createIncomeRecord({
          incomeType: 'COMMISSION',
          income: '-3.00000000',
          time: today.getTime(), // Same timestamp
        }),
      ],

      // Mixed symbols
      mixedSymbols: [
        this.createIncomeRecord({
          symbol: 'BTCUSDT',
          income: '100.00000000',
        }),
        this.createIncomeRecord({
          symbol: 'ETHUSDT',
          income: '50.00000000',
        }),
        this.createIncomeRecord({
          symbol: 'BTCUSDT',
          income: '-25.00000000',
        }),
      ],

      // Only funding fees, no trades
      noTrades: [
        this.createIncomeRecord({
          incomeType: 'FUNDING_FEE',
          income: '1.50000000',
          time: today.getTime() - 8 * 3600000,
        }),
        this.createIncomeRecord({
          incomeType: 'FUNDING_FEE',
          income: '-0.75000000',
          time: today.getTime(),
        }),
      ],
    };
  }

  /**
   * Generate a large dataset for pagination testing
   */
  private static createLargeDataset(): IncomeRecord[] {
    const records: IncomeRecord[] = [];
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 60); // 60 days of data

    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      // Generate 20 trades per day = ~1200 records for 60 days
      for (let i = 0; i < 20; i++) {
        const pnl = (Math.random() - 0.5) * 200;
        records.push(this.createIncomeRecord({
          incomeType: 'REALIZED_PNL',
          income: pnl.toFixed(8),
          time: currentDate.getTime() + i * 3600000,
        }));

        records.push(this.createIncomeRecord({
          incomeType: 'COMMISSION',
          income: (-Math.abs(pnl) * 0.02).toFixed(8),
          time: currentDate.getTime() + i * 3600000 + 1000,
        }));
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return records;
  }

  /**
   * Generate expected daily PnL from income records
   */
  static calculateExpectedDailyPnL(records: IncomeRecord[]): DailyPnL[] {
    const dailyMap = new Map<string, DailyPnL>();

    records.forEach(record => {
      const date = new Date(record.time).toISOString().split('T')[0];
      const amount = parseFloat(record.income);

      if (!dailyMap.has(date)) {
        dailyMap.set(date, {
          date,
          realizedPnl: 0,
          commission: 0,
          fundingFee: 0,
          netPnl: 0,
          tradeCount: 0,
        });
      }

      const daily = dailyMap.get(date)!;

      switch (record.incomeType) {
        case 'REALIZED_PNL':
          daily.realizedPnl += amount;
          daily.tradeCount++;
          break;
        case 'COMMISSION':
          daily.commission += amount;
          break;
        case 'FUNDING_FEE':
          daily.fundingFee += amount;
          break;
      }
    });

    // Calculate net PnL for each day
    dailyMap.forEach(daily => {
      daily.netPnl = daily.realizedPnl + daily.commission + daily.fundingFee;
    });

    return Array.from(dailyMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );
  }

  /**
   * Create records that will stress test date parsing
   */
  static createDateParsingTestRecords(): IncomeRecord[] {
    const records: IncomeRecord[] = [];

    // Records at day boundaries
    const dates = [
      new Date('2025-09-26T00:00:00.000Z'), // Start of day UTC
      new Date('2025-09-26T23:59:59.999Z'), // End of day UTC
      new Date('2025-09-26T12:00:00.000Z'), // Noon UTC
      new Date('2025-09-27T00:00:00.000Z'), // Next day start
      new Date('2025-09-25T23:59:59.999Z'), // Previous day end
    ];

    dates.forEach((date, index) => {
      records.push(this.createIncomeRecord({
        incomeType: 'REALIZED_PNL',
        income: `${(index + 1) * 10}.00000000`,
        time: date.getTime(),
      }));
    });

    return records;
  }

  /**
   * Create records for testing specific time ranges
   */
  static createTimeRangeTestData(): {
    [key: string]: IncomeRecord[];
  } {
    const now = new Date();
    const result: { [key: string]: IncomeRecord[] } = {};

    // 24h data
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    result['24h'] = this.createIncomeRecordsForDateRange(yesterday, now, {
      tradesPerDay: 10,
    });

    // 7d data
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 6);
    result['7d'] = this.createIncomeRecordsForDateRange(weekAgo, now, {
      tradesPerDay: 8,
    });

    // 30d data
    const monthAgo = new Date(now);
    monthAgo.setDate(monthAgo.getDate() - 29);
    result['30d'] = this.createIncomeRecordsForDateRange(monthAgo, now, {
      tradesPerDay: 5,
    });

    // 90d data
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setDate(threeMonthsAgo.getDate() - 89);
    result['90d'] = this.createIncomeRecordsForDateRange(threeMonthsAgo, now, {
      tradesPerDay: 4,
    });

    // 1y data
    const yearAgo = new Date(now);
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    result['1y'] = this.createIncomeRecordsForDateRange(yearAgo, now, {
      tradesPerDay: 3,
    });

    // All data (2 years)
    const twoYearsAgo = new Date(now);
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    result['all'] = this.createIncomeRecordsForDateRange(twoYearsAgo, now, {
      tradesPerDay: 2,
    });

    return result;
  }
}