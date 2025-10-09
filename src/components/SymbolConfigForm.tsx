'use client';

import React, { useState, useEffect } from 'react';
import { Config, SymbolConfig } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Plus,
  Trash2,
  Save,
  Key,
  Eye,
  EyeOff,
  Shield,
  TrendingUp,
  AlertCircle,
  Settings2,
  BarChart3,
} from 'lucide-react';
import { toast } from 'sonner';

interface SymbolConfigFormProps {
  onSave: (config: Config) => void;
  currentConfig?: Config;
}

export default function SymbolConfigForm({ onSave, currentConfig }: SymbolConfigFormProps) {
  // Ensure we have a properly initialized config with all required fields
  const getInitialConfig = (): Config => {
    if (currentConfig) {
      // Ensure api object exists
      if (!currentConfig.api) {
        currentConfig.api = { apiKey: '', secretKey: '' };
      }
      
      // Ensure global object exists with all required fields
      if (!currentConfig.global) {
        currentConfig.global = {
          riskPercent: 2,
          paperMode: true,
          positionMode: 'HEDGE',
          maxOpenPositions: 10,
          useThresholdSystem: false,
          server: {
            dashboardPassword: '',
            dashboardPort: 3000,
            websocketPort: 8080,
            useRemoteWebSocket: false,
            websocketHost: null
          },
          rateLimit: {
            maxRequestWeight: 2400,
            maxOrderCount: 1200,
            reservePercent: 30,
            enableBatching: true,
            queueTimeout: 30000,
            enableDeduplication: true,
            deduplicationWindowMs: 1000,
            parallelProcessing: true,
            maxConcurrentRequests: 3
          }
        };
      }
      
      // Ensure symbols object exists
      if (!currentConfig.symbols) {
        currentConfig.symbols = {};
      }
      
      return { ...currentConfig };
    }
    
    // Default config if none provided
    return {
      api: {
        apiKey: '',
        secretKey: ''
      },
      global: {
        riskPercent: 2,
        paperMode: true,
        positionMode: 'HEDGE',
        maxOpenPositions: 10,
        useThresholdSystem: false,
        server: {
          dashboardPassword: 'admin',
          dashboardPort: 3000,
          websocketPort: 8080,
          useRemoteWebSocket: false,
          websocketHost: null
        },
        rateLimit: {
          maxRequestWeight: 2400,
          maxOrderCount: 1200,
          reservePercent: 30,
          enableBatching: true,
          queueTimeout: 30000,
          parallelProcessing: true,
          maxConcurrentRequests: 3
        }
      },
      symbols: {},
      version: '1.1.0'
    };
  };

  const [config, setConfig] = useState<Config>(getInitialConfig());

  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [newSymbol, setNewSymbol] = useState<string>('');
  const [showApiSecret, setShowApiSecret] = useState(false);
  const [availableSymbols, setAvailableSymbols] = useState<any[]>([]);
  const [symbolDetails, setSymbolDetails] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [loadingSymbols, setLoadingSymbols] = useState(false);
  const [symbolSearch, setSymbolSearch] = useState('');
  const [showSymbolPicker, setShowSymbolPicker] = useState(false);
  const [useSeparateTradeSizes, setUseSeparateTradeSizes] = useState<Record<string, boolean>>({});
  const [longTradeSizeInput, setLongTradeSizeInput] = useState<string>('');
  const [shortTradeSizeInput, setShortTradeSizeInput] = useState<string>('');

  // Function to generate default config
  const getDefaultSymbolConfig = (): SymbolConfig => {
    return {
      longVolumeThresholdUSDT: 10000,  // For long positions (buy on sell liquidations)
      shortVolumeThresholdUSDT: 10000, // For short positions (sell on buy liquidations)
      leverage: 10,
      tradeSize: 100,
      maxPositionMarginUSDT: 10000,
      slPercent: 2,
      tpPercent: 3,
      priceOffsetBps: 5,      // 5 basis points offset for limit orders
      maxSlippageBps: 50,     // 50 basis points max slippage
      orderType: 'LIMIT' as const,
      vwapProtection: false,  // VWAP protection disabled by default
      vwapTimeframe: '1m',    // Default to 1 minute timeframe
      vwapLookback: 100,      // Default to 100 candles
    };
  };

  const handleGlobalChange = (field: string, value: any) => {
    setConfig({
      ...config,
      global: {
        ...config.global,
        [field]: value,
      },
    });
  };

  const handleApiChange = (field: string, value: string) => {
    setConfig({
      ...config,
      api: {
        ...config.api,
        [field]: value,
      },
    });
  };

  const handleSymbolChange = (symbol: string, field: string, value: any) => {
    setConfig({
      ...config,
      symbols: {
        ...config.symbols,
        [symbol]: {
          ...config.symbols[symbol],
          [field]: value,
        },
      },
    });
  };

  // Fetch available symbols when the symbols tab is clicked
  const fetchAvailableSymbols = async () => {
    if (availableSymbols.length > 0) return; // Already loaded

    setLoadingSymbols(true);
    try {
      const response = await fetch('/api/symbols');
      if (!response.ok) {
        throw new Error('Failed to fetch symbols');
      }
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Invalid response type');
      }
      const data = await response.json();
      if (data.symbols) {
        setAvailableSymbols(data.symbols);
      }
    } catch (error) {
      console.error('Failed to fetch symbols:', error);
      toast.error('Failed to load available symbols');
    } finally {
      setLoadingSymbols(false);
    }
  };

  const addSymbol = (symbolToAdd?: string) => {
    const symbol = symbolToAdd || newSymbol;
    if (symbol && !config.symbols[symbol]) {
      const defaultConfig = getDefaultSymbolConfig();
      setConfig({
        ...config,
        symbols: {
          ...config.symbols,
          [symbol]: defaultConfig,
        },
      });
      setSelectedSymbol(symbol);
      setNewSymbol('');
      setShowSymbolPicker(false);
      setSymbolSearch('');
      toast.success(`Added ${symbol} to configuration`);
    }
  };

  const removeSymbol = (symbol: string) => {
    const { [symbol]: _, ...rest } = config.symbols;
    setConfig({
      ...config,
      symbols: rest,
    });
    if (selectedSymbol === symbol) {
      setSelectedSymbol('');
    }
    toast.success(`Removed ${symbol} from configuration`);
  };

  const handleSave = () => {
    // Validate dashboard password if set
    const dashboardPassword = config.global.server?.dashboardPassword;
    if (dashboardPassword && dashboardPassword.length > 0 && dashboardPassword.length < 4) {
      alert('Dashboard password must be at least 4 characters');
      return;
    }

    onSave(config);
  };

  // Fetch symbol details when selecting a symbol
  const fetchSymbolDetails = async (symbol: string) => {
    setLoadingDetails(true);
    try {
      const response = await fetch(`/api/symbol-details/${symbol}`);
      if (!response.ok) {
        throw new Error('Failed to fetch symbol details');
      }
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Invalid response type');
      }
      const data = await response.json();
      setSymbolDetails(data);
    } catch (error) {
      console.error('Failed to fetch symbol details:', error);
      setSymbolDetails(null);
    } finally {
      setLoadingDetails(false);
    }
  };

  // Effect to fetch details when selected symbol changes
  useEffect(() => {
    if (selectedSymbol && config.symbols[selectedSymbol]) {
      fetchSymbolDetails(selectedSymbol);
      // Sync input states with config values
      const symbolConfig = config.symbols[selectedSymbol];
      const hasLongSize = symbolConfig.longTradeSize !== undefined;
      const hasShortSize = symbolConfig.shortTradeSize !== undefined;

      // Update the toggle state for this symbol
      setUseSeparateTradeSizes(prev => ({
        ...prev,
        [selectedSymbol]: hasLongSize || hasShortSize
      }));

      setLongTradeSizeInput((hasLongSize && symbolConfig.longTradeSize !== undefined ? symbolConfig.longTradeSize : symbolConfig.tradeSize).toString());
      setShortTradeSizeInput((hasShortSize && symbolConfig.shortTradeSize !== undefined ? symbolConfig.shortTradeSize : symbolConfig.tradeSize).toString());
    } else {
      setSymbolDetails(null);
    }
  }, [selectedSymbol, config.symbols]);

  // Initialize separate trade sizes state based on existing config
  useEffect(() => {
    const separateSizes: Record<string, boolean> = {};
    Object.keys(config.symbols).forEach(symbol => {
      const symbolConfig = config.symbols[symbol];
      // Set to true if either longTradeSize or shortTradeSize are explicitly defined
      const hasLongSize = symbolConfig.longTradeSize !== undefined;
      const hasShortSize = symbolConfig.shortTradeSize !== undefined;
      separateSizes[symbol] = hasLongSize || hasShortSize;
    });
    setUseSeparateTradeSizes(separateSizes);
  }, [config.symbols]);

  // Calculate minimum margin based on leverage (with 30% buffer for safety)
  const getMinimumMargin = () => {
    if (!symbolDetails || !selectedSymbol || !config.symbols[selectedSymbol]) {
      return null;
    }
    const leverage = config.symbols[selectedSymbol].leverage || 1;

    // Calculate minimum from notional requirement
    const minFromNotional = symbolDetails.minNotional / leverage;

    // Calculate minimum from quantity requirement
    // minQty * currentPrice = notional needed, then divide by leverage for margin
    const minFromQuantity = (symbolDetails.minQty * symbolDetails.currentPrice) / leverage;

    // Use the larger of the two requirements
    const rawMinimum = Math.max(minFromNotional, minFromQuantity);

    // Add 30% buffer to avoid rejection due to price movements
    return rawMinimum * 1.3;
  };

  // Get raw minimum without buffer (for display purposes)
  const getRawMinimum = () => {
    if (!symbolDetails || !selectedSymbol || !config.symbols[selectedSymbol]) {
      return null;
    }
    const leverage = config.symbols[selectedSymbol].leverage || 1;

    // Calculate both minimums and return the larger one
    const minFromNotional = symbolDetails.minNotional / leverage;
    const minFromQuantity = (symbolDetails.minQty * symbolDetails.currentPrice) / leverage;

    return Math.max(minFromNotional, minFromQuantity);
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="api" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="api" className="flex items-center gap-2">
            <Key className="h-4 w-4" />
            API Keys
          </TabsTrigger>
          <TabsTrigger value="global" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Global Settings
          </TabsTrigger>
          <TabsTrigger value="symbols" className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Symbols
          </TabsTrigger>
        </TabsList>

        <TabsContent value="api" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>API Configuration</CardTitle>
              <CardDescription>
                Connect your exchange API for live trading or leave empty for paper mode
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="apiKey">API Key</Label>
                <Input
                  id="apiKey"
                  type="text"
                  value={config.api?.apiKey || ''} 
                  onChange={(e) => handleApiChange('apiKey', e.target.value)}
                  placeholder="Enter your API key (optional for paper mode)"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Your API key for exchange authentication
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="secretKey">Secret Key</Label>
                <div className="relative">
                  <Input
                    id="secretKey"
                    type={showApiSecret ? 'text' : 'password'}
                    value={config.api?.secretKey || ''} 
                    onChange={(e) => handleApiChange('secretKey', e.target.value)}
                    placeholder="Enter your secret key (optional for paper mode)"
                    className="font-mono pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => setShowApiSecret(!showApiSecret)}
                  >
                    {showApiSecret ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Your secret key is encrypted and never shared
                </p>
              </div>

              {!config.api.apiKey && !config.api.secretKey && (
                <div className="rounded-lg bg-muted p-4">
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    No API keys configured - Bot will run in paper mode only
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="global" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Global Settings</CardTitle>
              <CardDescription>
                Risk management and trading mode configuration
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="riskPercent">Risk Percentage</Label>
                <div className="flex items-center space-x-4">
                  <Input
                    id="riskPercent"
                    type="number"
                    value={config.global.riskPercent || 0}
                    onChange={(e) => {
                      const value = parseFloat(e.target.value);
                      handleGlobalChange('riskPercent', isNaN(value) ? 0 : value);
                    }}
                    className="w-24"
                    min="0.1"
                    max="100"
                    step="0.1"
                  />
                  <span className="text-sm text-muted-foreground">
                    % of account balance at risk
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Maximum percentage of your account to risk across all positions
                </p>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="paperMode">Paper Mode</Label>
                  <p className="text-xs text-muted-foreground">
                    Enable simulation mode for risk-free testing
                  </p>
                </div>
                <Switch
                  id="paperMode"
                  checked={config.global.paperMode}
                  onCheckedChange={(checked) => handleGlobalChange('paperMode', checked)}
                />
              </div>

              {config.global.paperMode && (
                <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 p-4">
                  <p className="text-sm text-blue-700 dark:text-blue-400 flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Paper mode is enabled - No real trades will be executed
                  </p>
                </div>
              )}

              <Separator />

              <div className="space-y-2">
                <Label htmlFor="positionMode">Position Mode</Label>
                <select
                  id="positionMode"
                  value={config.global.positionMode || 'ONE_WAY'}
                  onChange={(e) => handleGlobalChange('positionMode', e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="ONE_WAY">One-way Mode (BOTH)</option>
                  <option value="HEDGE">Hedge Mode (LONG/SHORT)</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  One-way: All positions use BOTH | Hedge: Separate LONG and SHORT positions
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="maxOpenPositions">Max Open Positions</Label>
                <div className="flex items-center space-x-4">
                  <Input
                    id="maxOpenPositions"
                    type="number"
                    value={config.global.maxOpenPositions || 10}
                    onChange={(e) => {
                      const value = parseInt(e.target.value);
                      handleGlobalChange('maxOpenPositions', isNaN(value) ? 10 : value);
                    }}
                    className="w-24"
                    min="1"
                    max="50"
                    step="1"
                  />
                  <span className="text-sm text-muted-foreground">
                    Maximum concurrent positions (hedged pairs count as one)
                  </span>
                </div>
              </div>

              <Separator />

              {/* Threshold System Setting */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" />
                      60-Second Volume Threshold System
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Accumulate liquidation volume over 60-second windows
                    </p>
                  </div>
                  <Switch
                    checked={config.global.useThresholdSystem || false}
                    onCheckedChange={(checked) =>
                      handleGlobalChange('useThresholdSystem', checked)
                    }
                  />
                </div>
                {config.global.useThresholdSystem && (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      When enabled, trades will only trigger when cumulative liquidation volume in a 60-second window meets the threshold. Configure per-symbol settings in the symbols tab.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Server Settings Card */}
          <Card>
            <CardHeader>
              <CardTitle>Server Settings</CardTitle>
              <CardDescription>
                Dashboard security and network configuration
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="dashboardPassword">Dashboard Password</Label>
                <Input
                  id="dashboardPassword"
                  type="password"
                  value={config.global.server?.dashboardPassword || ''}
                  onChange={(e) => handleGlobalChange('server', {
                    ...config.global.server,
                    dashboardPassword: e.target.value
                  })}
                  placeholder="Enter dashboard password (min 4 characters)"
                  minLength={4}
                />
                <p className="text-xs text-muted-foreground">
                  Set a password to protect your dashboard when exposing it to external networks
                </p>
                {config.global.server?.dashboardPassword && config.global.server.dashboardPassword.length > 0 && config.global.server.dashboardPassword.length < 4 && (
                  <p className="text-xs text-destructive">
                    Password must be at least 4 characters
                  </p>
                )}
              </div>

              <Separator />

              <div className="space-y-2">
                <Label htmlFor="dashboardPort">Dashboard Port</Label>
                <div className="flex items-center space-x-4">
                  <Input
                    id="dashboardPort"
                    type="number"
                    value={config.global.server?.dashboardPort || 3000}
                    onChange={(e) => {
                      const value = parseInt(e.target.value);
                      handleGlobalChange('server', {
                        ...config.global.server,
                        dashboardPort: isNaN(value) ? 3000 : value
                      });
                    }}
                    className="w-24"
                    min="1024"
                    max="65535"
                  />
                  <span className="text-sm text-muted-foreground">
                    Port for the web dashboard (default: 3000)
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="websocketPort">WebSocket Port</Label>
                <div className="flex items-center space-x-4">
                  <Input
                    id="websocketPort"
                    type="number"
                    value={config.global.server?.websocketPort || 8080}
                    onChange={(e) => {
                      const value = parseInt(e.target.value);
                      handleGlobalChange('server', {
                        ...config.global.server,
                        websocketPort: isNaN(value) ? 8080 : value
                      });
                    }}
                    className="w-24"
                    min="1024"
                    max="65535"
                  />
                  <span className="text-sm text-muted-foreground">
                    Port for WebSocket server communication (default: 8080)
                  </span>
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="useRemoteWebSocket"
                    checked={config.global.server?.useRemoteWebSocket || false}
                    onCheckedChange={(checked) => {
                      handleGlobalChange('server', {
                        ...config.global.server,
                        useRemoteWebSocket: checked
                      });
                    }}
                  />
                  <Label htmlFor="useRemoteWebSocket" className="cursor-pointer">
                    Enable Remote WebSocket Access
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Allow the dashboard to connect to the bot from remote machines. When enabled, the WebSocket will automatically use the browser&apos;s hostname instead of localhost.
                </p>

                {config.global.server?.useRemoteWebSocket && (
                  <div className="space-y-2 pl-6">
                    <Label htmlFor="websocketHost">WebSocket Host (Optional)</Label>
                    <Input
                      id="websocketHost"
                      type="text"
                      value={config.global.server?.websocketHost || ''}
                      onChange={(e) => {
                        handleGlobalChange('server', {
                          ...config.global.server,
                          websocketHost: e.target.value || null
                        });
                      }}
                      placeholder="Auto-detect from browser (recommended)"
                    />
                    <p className="text-xs text-muted-foreground">
                      Leave empty to auto-detect the host from your browser&apos;s location. Only set this if you need a specific hostname or IP address.
                    </p>
                  </div>
                )}
              </div>

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Note:</strong> After changing ports, you&apos;ll need to restart the application and access it at the new port.
                  {config.global.server?.dashboardPassword && " Password protection is active - you'll need to login to access the dashboard."}
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="symbols" className="space-y-4" onFocus={fetchAvailableSymbols}>
          <Card>
            <CardHeader>
              <CardTitle>Symbol Configuration</CardTitle>
              <CardDescription>
                Configure trading parameters for each symbol
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={newSymbol}
                  onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                  placeholder="Enter symbol manually (e.g., BTCUSDT)"
                  onKeyPress={(e) => e.key === 'Enter' && addSymbol()}
                />
                <Button onClick={() => addSymbol()} className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Add Manual
                </Button>
                <Button
                  onClick={() => {
                    fetchAvailableSymbols();
                    setShowSymbolPicker(!showSymbolPicker);
                  }}
                  variant="outline"
                  className="flex items-center gap-2"
                >
                  <Settings2 className="h-4 w-4" />
                  Browse Symbols
                </Button>
              </div>

              {/* Symbol Picker */}
              {showSymbolPicker && (
                <Card className="border-2">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">Available Symbols</CardTitle>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowSymbolPicker(false)}
                      >
                        ✕
                      </Button>
                    </div>
                    <Input
                      type="text"
                      value={symbolSearch}
                      onChange={(e) => setSymbolSearch(e.target.value.toUpperCase())}
                      placeholder="Search symbols..."
                      className="mt-2"
                    />
                  </CardHeader>
                  <CardContent className="max-h-96 overflow-y-auto">
                    {loadingSymbols ? (
                      <div className="text-center py-4 text-muted-foreground">
                        Loading available symbols...
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {availableSymbols
                          .filter(s =>
                            !config.symbols[s.symbol] && // Not already added
                            (!symbolSearch || s.symbol.includes(symbolSearch))
                          )
                          .slice(0, 50) // Show max 50 results
                          .map((symbolInfo) => (
                            <div
                              key={symbolInfo.symbol}
                              className="flex items-center justify-between p-2 rounded hover:bg-accent cursor-pointer"
                              onClick={() => addSymbol(symbolInfo.symbol)}
                            >
                              <div className="flex items-center gap-3">
                                <span className="font-medium">{symbolInfo.symbol}</span>
                              </div>
                              <Button size="sm" variant="ghost">
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                        {symbolSearch && availableSymbols.filter(s =>
                          !config.symbols[s.symbol] && s.symbol.includes(symbolSearch)
                        ).length === 0 && (
                          <div className="text-center py-4 text-muted-foreground">
                            No matching symbols found
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {Object.keys(config.symbols).length > 0 && (
                <>
                  <div className="flex gap-2 flex-wrap">
                    {Object.keys(config.symbols).map((symbol) => (
                      <Badge
                        key={symbol}
                        variant={selectedSymbol === symbol ? "default" : "outline"}
                        className="cursor-pointer py-1.5 px-3"
                        onClick={() => setSelectedSymbol(symbol)}
                      >
                        {symbol}
                      </Badge>
                    ))}
                  </div>

                  {selectedSymbol && config.symbols[selectedSymbol] && (
                    <Card>
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-lg">{selectedSymbol} Settings</CardTitle>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => removeSymbol(selectedSymbol)}
                            className="flex items-center gap-1"
                          >
                            <Trash2 className="h-4 w-4" />
                            Remove
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Long Volume Threshold (USDT)</Label>
                          <Input
                            type="number"
                            value={config.symbols[selectedSymbol].longVolumeThresholdUSDT || config.symbols[selectedSymbol].volumeThresholdUSDT || 0}
                            onChange={(e) => {
                              const value = parseFloat(e.target.value);
                              handleSymbolChange(selectedSymbol, 'longVolumeThresholdUSDT', isNaN(value) ? 0 : value);
                            }}
                            min="0"
                          />
                          <p className="text-xs text-muted-foreground">
                            Min liquidation volume for longs (buy on sell liquidations)
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label>Short Volume Threshold (USDT)</Label>
                          <Input
                            type="number"
                            value={config.symbols[selectedSymbol].shortVolumeThresholdUSDT || config.symbols[selectedSymbol].volumeThresholdUSDT || 0}
                            onChange={(e) => {
                              const value = parseFloat(e.target.value);
                              handleSymbolChange(selectedSymbol, 'shortVolumeThresholdUSDT', isNaN(value) ? 0 : value);
                            }}
                            min="0"
                          />
                          <p className="text-xs text-muted-foreground">
                            Min liquidation volume for shorts (sell on buy liquidations)
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label>Leverage</Label>
                          <Input
                            type="number"
                            value={config.symbols[selectedSymbol].leverage || 1}
                            onChange={(e) => {
                              const value = parseInt(e.target.value);
                              handleSymbolChange(selectedSymbol, 'leverage', isNaN(value) ? 1 : value);
                            }}
                            min="1"
                            max="125"
                          />
                          <p className="text-xs text-muted-foreground">
                            Trading leverage (1-125x)
                          </p>
                        </div>

                        {/* Trade Size Configuration */}
                        <div className="col-span-2 space-y-4">
                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <Label className="text-base">Trade Size Configuration</Label>
                              <p className="text-sm text-muted-foreground">
                                Use different sizes for long and short positions
                              </p>
                            </div>
                            <Switch
                              checked={useSeparateTradeSizes[selectedSymbol] || false}
                              onCheckedChange={(checked) => {
                                setUseSeparateTradeSizes({
                                  ...useSeparateTradeSizes,
                                  [selectedSymbol]: checked,
                                });
                                if (checked) {
                                  // Initialize separate values with current tradeSize when toggling on
                                  const currentTradeSize = config.symbols[selectedSymbol].tradeSize;
                                  const existingLongSize = config.symbols[selectedSymbol].longTradeSize;
                                  const existingShortSize = config.symbols[selectedSymbol].shortTradeSize;

                                  // Use existing values if they exist, otherwise use tradeSize
                                  const longSize = existingLongSize !== undefined ? existingLongSize : currentTradeSize;
                                  const shortSize = existingShortSize !== undefined ? existingShortSize : currentTradeSize;

                                  handleSymbolChange(selectedSymbol, 'longTradeSize', longSize);
                                  handleSymbolChange(selectedSymbol, 'shortTradeSize', shortSize);
                                  setLongTradeSizeInput(longSize.toString());
                                  setShortTradeSizeInput(shortSize.toString());
                                } else {
                                  // Remove separate values when toggling off
                                  const { longTradeSize: _longTradeSize, shortTradeSize: _shortTradeSize, ...restConfig } = config.symbols[selectedSymbol];
                                  setConfig({
                                    ...config,
                                    symbols: {
                                      ...config.symbols,
                                      [selectedSymbol]: restConfig,
                                    },
                                  });
                                  // Reset input fields to tradeSize
                                  const currentTradeSize = config.symbols[selectedSymbol].tradeSize;
                                  setLongTradeSizeInput(currentTradeSize.toString());
                                  setShortTradeSizeInput(currentTradeSize.toString());
                                }
                              }}
                            />
                          </div>

                          {!useSeparateTradeSizes[selectedSymbol] ? (
                            <div className="space-y-2">
                              <Label>Trade Size (USDT)</Label>
                              <Input
                                type="number"
                                value={config.symbols[selectedSymbol].tradeSize || 0}
                                onChange={(e) => {
                                  const value = parseFloat(e.target.value);
                                  handleSymbolChange(selectedSymbol, 'tradeSize', isNaN(value) ? 0 : value);
                                }}
                                min="0"
                                step="0.01"
                              />
                              <div className="space-y-1">
                                <p className="text-xs text-muted-foreground">
                                  Position size in USDT (used for both long and short)
                                </p>
                                {symbolDetails && !loadingDetails && getMinimumMargin() && (
                                  <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-2">
                                      <Badge
                                        variant={config.symbols[selectedSymbol].tradeSize >= getMinimumMargin()! ? "default" : "destructive"}
                                        className="text-xs"
                                      >
                                        Recommended: ${getMinimumMargin()!.toFixed(2)} USDT
                                      </Badge>
                                      {config.symbols[selectedSymbol].tradeSize < getMinimumMargin()! && (
                                        <Badge variant="destructive" className="text-xs">
                                          Too low - may be rejected!
                                        </Badge>
                                      )}
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                      Exchange min: ${getRawMinimum()!.toFixed(2)} @ {config.symbols[selectedSymbol].leverage}x (30% buffer added)
                                    </p>
                                  </div>
                                )}
                                {loadingDetails && (
                                  <p className="text-xs text-muted-foreground">
                                    Loading minimum requirements...
                                  </p>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label className="flex items-center gap-2">
                                  Long Trade Size (USDT)
                                  <Badge variant="outline" className="text-xs">BUY</Badge>
                                </Label>
                                <Input
                                  type="number"
                                  value={longTradeSizeInput}
                                  onChange={(e) => {
                                    setLongTradeSizeInput(e.target.value);
                                    if (e.target.value !== '') {
                                      const value = parseFloat(e.target.value);
                                      if (!isNaN(value)) {
                                        handleSymbolChange(selectedSymbol, 'longTradeSize', value);
                                      }
                                    }
                                  }}
                                  onBlur={(e) => {
                                    // On blur, if empty, reset to tradeSize
                                    if (e.target.value === '') {
                                      const fallbackValue = config.symbols[selectedSymbol].tradeSize;
                                      setLongTradeSizeInput(fallbackValue.toString());
                                      handleSymbolChange(selectedSymbol, 'longTradeSize', fallbackValue);
                                    }
                                  }}
                                  min="0"
                                  step="0.01"
                                />
                                <div className="space-y-1">
                                  <p className="text-xs text-muted-foreground">
                                    Margin used for long positions (buy on sell liquidations)
                                  </p>
                                  {symbolDetails && !loadingDetails && getMinimumMargin() && (
                                    <div className="flex flex-col gap-1">
                                      <div className="flex items-center gap-2">
                                        <Badge
                                          variant={(config.symbols[selectedSymbol].longTradeSize || config.symbols[selectedSymbol].tradeSize) >= getMinimumMargin()! ? "default" : "destructive"}
                                          className="text-xs"
                                        >
                                          Recommended: ${getMinimumMargin()!.toFixed(2)}
                                        </Badge>
                                        {(config.symbols[selectedSymbol].longTradeSize || config.symbols[selectedSymbol].tradeSize) < getMinimumMargin()! && (
                                          <Badge variant="destructive" className="text-xs">
                                            Too low!
                                          </Badge>
                                        )}
                                      </div>
                                      <p className="text-xs text-muted-foreground">
                                        Min: ${getRawMinimum()!.toFixed(2)} + 30% buffer
                                      </p>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="space-y-2">
                                <Label className="flex items-center gap-2">
                                  Short Trade Size (USDT)
                                  <Badge variant="outline" className="text-xs">SELL</Badge>
                                </Label>
                                <Input
                                  type="number"
                                  value={shortTradeSizeInput}
                                  onChange={(e) => {
                                    setShortTradeSizeInput(e.target.value);
                                    if (e.target.value !== '') {
                                      const value = parseFloat(e.target.value);
                                      if (!isNaN(value)) {
                                        handleSymbolChange(selectedSymbol, 'shortTradeSize', value);
                                      }
                                    }
                                  }}
                                  onBlur={(e) => {
                                    // On blur, if empty, reset to tradeSize
                                    if (e.target.value === '') {
                                      const fallbackValue = config.symbols[selectedSymbol].tradeSize;
                                      setShortTradeSizeInput(fallbackValue.toString());
                                      handleSymbolChange(selectedSymbol, 'shortTradeSize', fallbackValue);
                                    }
                                  }}
                                  min="0"
                                  step="0.01"
                                />
                                <div className="space-y-1">
                                  <p className="text-xs text-muted-foreground">
                                    Margin used for short positions (sell on buy liquidations)
                                  </p>
                                  {symbolDetails && !loadingDetails && getMinimumMargin() && (
                                    <div className="flex flex-col gap-1">
                                      <div className="flex items-center gap-2">
                                        <Badge
                                          variant={(config.symbols[selectedSymbol].shortTradeSize || config.symbols[selectedSymbol].tradeSize) >= getMinimumMargin()! ? "default" : "destructive"}
                                          className="text-xs"
                                        >
                                          Recommended: ${getMinimumMargin()!.toFixed(2)}
                                        </Badge>
                                        {(config.symbols[selectedSymbol].shortTradeSize || config.symbols[selectedSymbol].tradeSize) < getMinimumMargin()! && (
                                          <Badge variant="destructive" className="text-xs">
                                            Too low!
                                          </Badge>
                                        )}
                                      </div>
                                      <p className="text-xs text-muted-foreground">
                                        Min: ${getRawMinimum()!.toFixed(2)} + 30% buffer
                                      </p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="space-y-2">
                          <Label>Max Position Margin (USDT)</Label>
                          <Input
                            type="number"
                            value={config.symbols[selectedSymbol].maxPositionMarginUSDT || 0}
                            onChange={(e) => {
                              const value = parseFloat(e.target.value);
                              handleSymbolChange(selectedSymbol, 'maxPositionMarginUSDT', isNaN(value) ? 0 : value);
                            }}
                            min="0"
                          />
                          <p className="text-xs text-muted-foreground">
                            Max total margin exposure for this symbol
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label>Stop Loss (%)</Label>
                          <Input
                            type="number"
                            value={config.symbols[selectedSymbol].slPercent || 0}
                            onChange={(e) => {
                              const value = parseFloat(e.target.value);
                              handleSymbolChange(selectedSymbol, 'slPercent', isNaN(value) ? 0 : value);
                            }}
                            min="0.1"
                            step="0.1"
                          />
                          <p className="text-xs text-muted-foreground">
                            Stop loss percentage
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label>Take Profit (%)</Label>
                          <Input
                            type="number"
                            value={config.symbols[selectedSymbol].tpPercent || 0}
                            onChange={(e) => {
                              const value = parseFloat(e.target.value);
                              handleSymbolChange(selectedSymbol, 'tpPercent', isNaN(value) ? 0 : value);
                            }}
                            min="0.1"
                            step="0.1"
                          />
                          <p className="text-xs text-muted-foreground">
                            Take profit percentage
                          </p>
                        </div>

                        {/* VWAP Protection Settings */}
                        <div className="col-span-2">
                          <Separator className="my-4" />
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <div className="space-y-0.5">
                                <Label className="flex items-center gap-2">
                                  <BarChart3 className="h-4 w-4" />
                                  VWAP Protection
                                </Label>
                                <p className="text-sm text-muted-foreground">
                                  Block entries against VWAP trend
                                </p>
                              </div>
                              <Switch
                                checked={config.symbols[selectedSymbol].vwapProtection || false}
                                onCheckedChange={(checked) =>
                                  handleSymbolChange(selectedSymbol, 'vwapProtection', checked)
                                }
                              />
                            </div>

                            {config.symbols[selectedSymbol].vwapProtection && (
                              <div className="grid grid-cols-2 gap-4 pt-2">
                                <div className="space-y-2">
                                  <Label>VWAP Timeframe</Label>
                                  <Select
                                    value={config.symbols[selectedSymbol].vwapTimeframe || '1m'}
                                    onValueChange={(value) =>
                                      handleSymbolChange(selectedSymbol, 'vwapTimeframe', value)
                                    }
                                  >
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="1m">1 minute</SelectItem>
                                      <SelectItem value="5m">5 minutes</SelectItem>
                                      <SelectItem value="15m">15 minutes</SelectItem>
                                      <SelectItem value="30m">30 minutes</SelectItem>
                                      <SelectItem value="1h">1 hour</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <p className="text-xs text-muted-foreground">
                                    Candle timeframe for VWAP calculation
                                  </p>
                                </div>

                                <div className="space-y-2">
                                  <Label>Lookback Period</Label>
                                  <Input
                                    type="number"
                                    value={config.symbols[selectedSymbol].vwapLookback || 100}
                                    onChange={(e) => {
                                      const value = parseInt(e.target.value);
                                      handleSymbolChange(
                                        selectedSymbol,
                                        'vwapLookback',
                                        isNaN(value) ? 100 : value
                                      );
                                    }}
                                    min="10"
                                    max="500"
                                  />
                                  <p className="text-xs text-muted-foreground">
                                    Number of candles for VWAP (10-500)
                                  </p>
                                </div>
                              </div>
                            )}

                            {config.symbols[selectedSymbol].vwapProtection && (
                              <Alert>
                                <AlertCircle className="h-4 w-4" />
                                <AlertDescription className="text-xs">
                                  <strong>VWAP Protection Active:</strong> Long positions will only open when price is below VWAP.
                                  Short positions will only open when price is above VWAP. This helps avoid entering against the trend.
                                </AlertDescription>
                              </Alert>
                            )}
                          </div>
                        </div>

                        {/* Threshold System Settings - Only show if global threshold is enabled */}
                        {config.global.useThresholdSystem && (
                          <div className="col-span-2">
                            <Separator className="my-4" />
                            <div className="space-y-4">
                              <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                  <Label className="flex items-center gap-2">
                                    <TrendingUp className="h-4 w-4" />
                                    Enable Threshold System for {selectedSymbol}
                                  </Label>
                                  <p className="text-sm text-muted-foreground">
                                    Use 60-second cumulative volume thresholds
                                  </p>
                                </div>
                                <Switch
                                  checked={config.symbols[selectedSymbol].useThreshold || false}
                                  onCheckedChange={(checked) =>
                                    handleSymbolChange(selectedSymbol, 'useThreshold', checked)
                                  }
                                />
                              </div>

                              {config.symbols[selectedSymbol].useThreshold && (
                                <div className="space-y-4 pt-2">
                                  <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                      <Label>Time Window (seconds)</Label>
                                      <Input
                                        type="number"
                                        value={(config.symbols[selectedSymbol].thresholdTimeWindow || 60000) / 1000}
                                        onChange={(e) => {
                                          const seconds = parseFloat(e.target.value);
                                          const ms = isNaN(seconds) ? 60000 : seconds * 1000;
                                          handleSymbolChange(selectedSymbol, 'thresholdTimeWindow', ms);
                                        }}
                                        min="10"
                                        max="300"
                                        step="10"
                                      />
                                      <p className="text-xs text-muted-foreground">
                                        Window for accumulating volume (default: 60s)
                                      </p>
                                    </div>

                                    <div className="space-y-2">
                                      <Label>Cooldown Period (seconds)</Label>
                                      <Input
                                        type="number"
                                        value={(config.symbols[selectedSymbol].thresholdCooldown || 30000) / 1000}
                                        onChange={(e) => {
                                          const seconds = parseFloat(e.target.value);
                                          const ms = isNaN(seconds) ? 30000 : seconds * 1000;
                                          handleSymbolChange(selectedSymbol, 'thresholdCooldown', ms);
                                        }}
                                        min="10"
                                        max="300"
                                        step="10"
                                      />
                                      <p className="text-xs text-muted-foreground">
                                        Cooldown between triggers (default: 30s)
                                      </p>
                                    </div>
                                  </div>

                                  <Alert>
                                    <AlertCircle className="h-4 w-4" />
                                    <AlertDescription>
                                      With threshold enabled, trades will only trigger when cumulative liquidation volume
                                      within the time window meets the Long/Short Volume Thresholds configured above.
                                    </AlertDescription>
                                  </Alert>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </>
              )}

              {Object.keys(config.symbols).length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <Settings2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No symbols configured yet</p>
                  <p className="text-sm">Add a symbol above to get started</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end">
        <Button onClick={handleSave} size="lg" className="flex items-center gap-2">
          <Save className="h-4 w-4" />
          Save Configuration
        </Button>
      </div>
    </div>
  );
}