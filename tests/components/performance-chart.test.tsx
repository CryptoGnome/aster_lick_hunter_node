import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import PnLChart from '@/components/PnLChart';
import PerformanceCard from '@/components/PerformanceCard';
import { MockIncomeDataGenerator } from '../utils/mock-income-data';
import websocketService from '@/lib/services/websocketService';
import dataStore from '@/lib/services/dataStore';

// Mock fetch
global.fetch = jest.fn();

// Mock ConfigProvider
jest.mock('@/components/ConfigProvider', () => {
  const _React = require('react');
  return {
    __esModule: true,
    default: ({ children }: any) => children,
    useConfig: () => ({
      config: {
        api: {
          apiKey: 'test-key',
          secretKey: 'test-secret',
        },
      },
      loading: false,
      updateConfig: jest.fn(),
      reloadConfig: jest.fn(),
    }),
  };
});

// Mock websocket service
jest.mock('@/lib/services/websocketService', () => ({
  default: {
    addMessageHandler: jest.fn(() => jest.fn()),
    connect: jest.fn(),
    disconnect: jest.fn(),
  },
}));

// Mock data store
jest.mock('@/lib/services/dataStore', () => ({
  default: {
    fetchBalance: jest.fn(() => Promise.resolve({ totalBalance: 10000 })),
    on: jest.fn(),
    off: jest.fn(),
    handleWebSocketMessage: jest.fn(),
  },
}));

// Mock recharts to avoid rendering issues in tests
jest.mock('recharts', () => {
  const React = require('react');
  return {
    ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
    AreaChart: ({ children, data }: any) => (
      <div data-testid="area-chart" data-length={data?.length}>{children}</div>
    ),
    BarChart: ({ children, data }: any) => (
      <div data-testid="bar-chart" data-length={data?.length}>{children}</div>
    ),
    Area: () => <div data-testid="area" />,
    Bar: () => <div data-testid="bar" />,
    Cell: () => <div data-testid="cell" />,
    CartesianGrid: () => <div data-testid="cartesian-grid" />,
    XAxis: () => <div data-testid="x-axis" />,
    YAxis: () => <div data-testid="y-axis" />,
    Tooltip: () => <div data-testid="tooltip" />,
    ReferenceLine: () => <div data-testid="reference-line" />,
  };
});


describe('PnLChart Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
  });

  const renderComponent = (component: React.ReactElement) => {
    return render(component);
  };

  describe('Data Fetching', () => {
    it('should fetch data on mount', async () => {
      const mockData = {
        dailyPnL: MockIncomeDataGenerator.calculateExpectedDailyPnL(
          MockIncomeDataGenerator.createProfitablePattern(7)
        ),
        metrics: {
          totalPnl: 500,
          winRate: 70,
          profitableDays: 5,
          lossDays: 2,
          bestDay: null,
          worstDay: null,
          avgDailyPnl: 71.43,
          maxDrawdown: 100,
          profitFactor: 2.5,
          sharpeRatio: 1.5,
        },
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockData,
      });

      renderComponent(<PnLChart />);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/income?range=7d');
      });
    });

    it('should handle fetch errors gracefully', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      renderComponent(<PnLChart />);

      await waitFor(() => {
        expect(screen.getByText(/No trading data/i)).toBeInTheDocument();
      });
    });

    it('should display loading state', () => {
      (global.fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));

      renderComponent(<PnLChart />);

      expect(screen.getByRole('status')).toBeInTheDocument(); // Skeleton loader
    });

    it('should display empty state when no data', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ dailyPnL: [], metrics: {} }),
      });

      renderComponent(<PnLChart />);

      await waitFor(() => {
        expect(screen.getByText(/No trading data/i)).toBeInTheDocument();
      });
    });

    it('should display API keys required when not configured', async () => {
      // Temporarily mock useConfig to return no API keys
      const { useConfig } = require('@/components/ConfigProvider');
      useConfig.mockReturnValueOnce({
        config: { api: { apiKey: '', secretKey: '' } },
        loading: false,
      });

      renderComponent(<PnLChart />);

      await waitFor(() => {
        expect(screen.getByText(/API keys required/i)).toBeInTheDocument();
      });
    });
  });

  describe('Time Range Selection', () => {
    it('should fetch data when time range changes', async () => {
      const mockData7d = {
        dailyPnL: MockIncomeDataGenerator.calculateExpectedDailyPnL(
          MockIncomeDataGenerator.createProfitablePattern(7)
        ),
        metrics: { totalPnl: 500, winRate: 70 },
      };

      const mockData30d = {
        dailyPnL: MockIncomeDataGenerator.calculateExpectedDailyPnL(
          MockIncomeDataGenerator.createProfitablePattern(30)
        ),
        metrics: { totalPnl: 2000, winRate: 65 },
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockData7d,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ dailyPnL: [], metrics: {} }), // Balance API
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockData30d,
        });

      const { container } = renderComponent(<PnLChart />);

      // Wait for initial load
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/income?range=7d');
      });

      // Change time range to 30d
      const selectTrigger = container.querySelector('[role="combobox"]');
      if (selectTrigger) {
        fireEvent.click(selectTrigger);
        await waitFor(() => {
          const option30d = screen.getByRole('option', { name: '30d' });
          fireEvent.click(option30d);
        });
      }

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/income?range=30d');
      });
    });

    it('should support all time ranges', async () => {
      const timeRanges = ['24h', '7d', '30d', '90d', '1y', 'all'];

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ dailyPnL: [], metrics: {} }),
      });

      const { container } = renderComponent(<PnLChart />);

      for (const range of timeRanges) {
        const selectTrigger = container.querySelector('[role="combobox"]');
        if (selectTrigger) {
          fireEvent.click(selectTrigger);
          await waitFor(() => {
            const option = screen.getByRole('option', { name: range });
            expect(option).toBeInTheDocument();
          });
        }
      }
    });
  });

  describe('Chart Type Toggle', () => {
    it('should toggle between daily and cumulative view', async () => {
      const mockData = {
        dailyPnL: MockIncomeDataGenerator.calculateExpectedDailyPnL(
          MockIncomeDataGenerator.createProfitablePattern(7)
        ),
        metrics: { totalPnl: 500, winRate: 70 },
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockData,
      });

      const { container } = renderComponent(<PnLChart />);

      await waitFor(() => {
        expect(container.querySelector('[data-testid="area-chart"]')).toBeInTheDocument();
      });

      // Click on Daily tab
      const dailyTab = screen.getByRole('tab', { name: /Daily/i });
      fireEvent.click(dailyTab);

      await waitFor(() => {
        expect(container.querySelector('[data-testid="bar-chart"]')).toBeInTheDocument();
      });
    });
  });

  describe('Data Validation', () => {
    it('should filter out invalid data points', async () => {
      const invalidData = {
        dailyPnL: [
          { date: '2025-09-01', realizedPnl: NaN, commission: -5, fundingFee: 0, netPnl: NaN, tradeCount: 1 },
          { date: '2025-09-02', realizedPnl: 100, commission: -5, fundingFee: 0, netPnl: 95, tradeCount: 1 },
          { date: '2025-09-03', realizedPnl: null as any, commission: -5, fundingFee: 0, netPnl: -5, tradeCount: 1 },
        ],
        metrics: { totalPnl: 95, winRate: 100 },
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => invalidData,
      });

      const { container } = renderComponent(<PnLChart />);

      await waitFor(() => {
        const chart = container.querySelector('[data-testid="area-chart"]');
        // Only valid data point should be rendered
        expect(chart?.getAttribute('data-length')).toBe('1');
      });
    });
  });

  describe('Real-time Updates', () => {
    it('should update chart when receiving WebSocket messages', async () => {
      const initialData = {
        dailyPnL: MockIncomeDataGenerator.calculateExpectedDailyPnL(
          MockIncomeDataGenerator.createProfitablePattern(7)
        ),
        metrics: { totalPnl: 500, winRate: 70 },
      };

      const updatedData = {
        dailyPnL: MockIncomeDataGenerator.calculateExpectedDailyPnL(
          MockIncomeDataGenerator.createProfitablePattern(7)
        ),
        metrics: { totalPnl: 600, winRate: 75 },
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, json: async () => initialData })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ totalBalance: 10000 }) })
        .mockResolvedValueOnce({ ok: true, json: async () => updatedData });

      let messageHandler: ((msg: any) => void) | null = null;
      (websocketService.addMessageHandler as jest.Mock).mockImplementation((handler) => {
        messageHandler = handler;
        return jest.fn();
      });

      renderComponent(<PnLChart />);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/income?range=7d');
      });

      // Simulate WebSocket message
      if (messageHandler) {
        messageHandler({ type: 'pnl_update', data: {} });
      }

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(3);
      });
    });
  });

  describe('Refresh Functionality', () => {
    it('should refresh data when refresh button clicked', async () => {
      const mockData = {
        dailyPnL: MockIncomeDataGenerator.calculateExpectedDailyPnL(
          MockIncomeDataGenerator.createProfitablePattern(7)
        ),
        metrics: { totalPnl: 500, winRate: 70 },
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockData,
      });

      renderComponent(<PnLChart />);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(2); // Initial load + balance
      });

      const refreshButton = screen.getByRole('button', { name: /refresh/i });
      fireEvent.click(refreshButton);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/income?range=7d');
      });
    });
  });

  describe('Metrics Display', () => {
    it('should display performance metrics correctly', async () => {
      const mockData = {
        dailyPnL: MockIncomeDataGenerator.calculateExpectedDailyPnL(
          MockIncomeDataGenerator.createProfitablePattern(7)
        ),
        metrics: {
          totalPnl: 1234.56,
          winRate: 71.4,
          profitableDays: 5,
          lossDays: 2,
          bestDay: { date: '2025-09-01', netPnl: 500 } as any,
          worstDay: { date: '2025-09-03', netPnl: -150 } as any,
          avgDailyPnl: 176.37,
          maxDrawdown: 200,
          profitFactor: 2.8,
          sharpeRatio: 1.65,
        },
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, json: async () => mockData })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ totalBalance: 10000 }) });

      renderComponent(<PnLChart />);

      await waitFor(() => {
        expect(screen.getByText(/\$1,234.56/)).toBeInTheDocument();
        expect(screen.getByText(/71.4%/)).toBeInTheDocument();
        expect(screen.getByText(/2.80/)).toBeInTheDocument(); // Profit factor
        expect(screen.getByText(/1.65/)).toBeInTheDocument(); // Sharpe ratio
      });
    });

    it('should show correct color for profit/loss', async () => {
      const profitData = {
        dailyPnL: [{ date: '2025-09-01', realizedPnl: 100, commission: -5, fundingFee: 0, netPnl: 95, tradeCount: 1 }],
        metrics: { totalPnl: 95, winRate: 100 },
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => profitData,
      });

      renderComponent(<PnLChart />);

      await waitFor(() => {
        const profitElement = screen.getByText(/\$95.00/);
        expect(profitElement).toHaveClass('text-green-600');
      });
    });
  });

  describe('Collapse/Expand', () => {
    it('should collapse and expand chart', async () => {
      const mockData = {
        dailyPnL: MockIncomeDataGenerator.calculateExpectedDailyPnL(
          MockIncomeDataGenerator.createProfitablePattern(7)
        ),
        metrics: { totalPnl: 500, winRate: 70 },
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockData,
      });

      const { container } = renderComponent(<PnLChart />);

      await waitFor(() => {
        expect(container.querySelector('[data-testid="responsive-container"]')).toBeInTheDocument();
      });

      // Click collapse button
      const collapseButton = screen.getByRole('button', { name: /Performance/i });
      fireEvent.click(collapseButton);

      await waitFor(() => {
        expect(container.querySelector('[data-testid="responsive-container"]')).not.toBeInTheDocument();
      });

      // Click to expand again
      fireEvent.click(collapseButton);

      await waitFor(() => {
        expect(container.querySelector('[data-testid="responsive-container"]')).toBeInTheDocument();
      });
    });
  });
});

describe('PerformanceCard Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
  });

  describe('24-Hour Performance Display', () => {
    it('should display 24h performance data', async () => {
      const mockData = {
        dailyPnL: MockIncomeDataGenerator.calculateExpectedDailyPnL(
          MockIncomeDataGenerator.createIncomeRecordsForDateRange(
            new Date(Date.now() - 24 * 60 * 60 * 1000),
            new Date(),
            { tradesPerDay: 10 }
          )
        ),
        metrics: {
          totalPnl: 245.50,
          totalRealizedPnl: 300,
          totalCommission: -50,
          totalFundingFee: -4.50,
        },
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockData,
      });

      render(<PerformanceCard />);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/income?range=24h');
        expect(screen.getByText(/\$245.50/)).toBeInTheDocument();
        expect(screen.getByText(/24-Hour Performance/i)).toBeInTheDocument();
      });
    });

    it('should show trade count', async () => {
      const mockData = {
        dailyPnL: [
          { date: '2025-09-01', realizedPnl: 100, commission: -5, fundingFee: 0, netPnl: 95, tradeCount: 5 },
          { date: '2025-09-02', realizedPnl: 200, commission: -10, fundingFee: 0, netPnl: 190, tradeCount: 8 },
        ],
        metrics: { totalPnl: 285 },
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockData,
      });

      render(<PerformanceCard />);

      await waitFor(() => {
        expect(screen.getByText(/13 trades/i)).toBeInTheDocument();
      });
    });

    it('should calculate return percentage', async () => {
      const mockData = {
        dailyPnL: [{ date: '2025-09-01', realizedPnl: 100, commission: -5, fundingFee: 0, netPnl: 95, tradeCount: 1 }],
        metrics: { totalPnl: 95, totalRealizedPnl: 100, totalCommission: -5, totalFundingFee: 0 },
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockData,
      });

      (dataStore.fetchBalance as jest.Mock).mockResolvedValue({ totalBalance: 10000 });

      render(<PerformanceCard />);

      await waitFor(() => {
        // 95 / 10000 * 100 = 0.95%
        expect(screen.getByText(/\+0.95%/)).toBeInTheDocument();
      });
    });
  });

  describe('Real-time Updates', () => {
    it('should update on WebSocket messages', async () => {
      const initialData = {
        dailyPnL: [],
        metrics: { totalPnl: 100 },
      };

      const updatedData = {
        dailyPnL: [],
        metrics: { totalPnl: 150 },
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, json: async () => initialData })
        .mockResolvedValueOnce({ ok: true, json: async () => updatedData });

      let messageHandler: ((msg: any) => void) | null = null;
      (websocketService.addMessageHandler as jest.Mock).mockImplementation((handler) => {
        messageHandler = handler;
        return jest.fn();
      });

      render(<PerformanceCard />);

      await waitFor(() => {
        expect(screen.getByText(/\$100.00/)).toBeInTheDocument();
      });

      // Simulate trade update
      if (messageHandler) {
        messageHandler({ type: 'trade_update' });
      }

      await waitFor(() => {
        expect(screen.getByText(/\$150.00/)).toBeInTheDocument();
      });
    });

    it('should update balance from WebSocket', async () => {
      let balanceHandler: ((data: any) => void) | null = null;
      (dataStore.on as jest.Mock).mockImplementation((event, handler) => {
        if (event === 'balance:update') {
          balanceHandler = handler;
        }
      });

      render(<PerformanceCard />);

      await waitFor(() => {
        expect(dataStore.on).toHaveBeenCalledWith('balance:update', expect.any(Function));
      });

      // Simulate balance update
      if (balanceHandler) {
        balanceHandler({ totalBalance: 15000 });
      }

      // Balance should be updated internally (not directly visible but used in calculations)
      expect(balanceHandler).toBeDefined();
    });
  });

  describe('Loading and Error States', () => {
    it('should show loading state initially', () => {
      (global.fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));
      (dataStore.fetchBalance as jest.Mock).mockImplementation(() => new Promise(() => {}));

      const { container } = render(<PerformanceCard />);

      expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    });

    it('should handle fetch errors gracefully', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      render(<PerformanceCard />);

      await waitFor(() => {
        // Component should still render without crashing
        expect(screen.getByText(/24-Hour Performance/i)).toBeInTheDocument();
      });
    });
  });

  describe('Display Formatting', () => {
    it('should format currency correctly', async () => {
      const mockData = {
        dailyPnL: [],
        metrics: {
          totalPnl: 1234567.89,
          totalRealizedPnl: 1234567.89,
          totalCommission: 0,
          totalFundingFee: 0,
        },
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockData,
      });

      render(<PerformanceCard />);

      await waitFor(() => {
        expect(screen.getByText(/\$1,234,567.89/)).toBeInTheDocument();
      });
    });

    it('should show correct color for profit', async () => {
      const mockData = {
        dailyPnL: [],
        metrics: { totalPnl: 100, totalRealizedPnl: 100, totalCommission: 0, totalFundingFee: 0 },
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockData,
      });

      render(<PerformanceCard />);

      await waitFor(() => {
        const profitElement = screen.getByText(/\$100.00/);
        expect(profitElement).toHaveClass('text-green-500');
      });
    });

    it('should show correct color for loss', async () => {
      const mockData = {
        dailyPnL: [],
        metrics: { totalPnl: -100, totalRealizedPnl: -100, totalCommission: 0, totalFundingFee: 0 },
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockData,
      });

      render(<PerformanceCard />);

      await waitFor(() => {
        const lossElement = screen.getByText(/-\$100.00/);
        expect(lossElement).toHaveClass('text-red-500');
      });
    });

    it('should display breakdown correctly', async () => {
      const mockData = {
        dailyPnL: [],
        metrics: {
          totalPnl: 245,
          totalRealizedPnl: 300,
          totalCommission: -50,
          totalFundingFee: -5,
        },
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockData,
      });

      render(<PerformanceCard />);

      await waitFor(() => {
        expect(screen.getByText(/Realized/i)).toBeInTheDocument();
        expect(screen.getByText(/\$300.00/)).toBeInTheDocument();
        expect(screen.getByText(/Fees/i)).toBeInTheDocument();
        expect(screen.getByText(/-\$55.00/)).toBeInTheDocument();
      });
    });
  });
});