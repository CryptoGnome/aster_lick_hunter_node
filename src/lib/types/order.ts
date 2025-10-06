export enum OrderStatus {
  NEW = 'NEW',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  FILLED = 'FILLED',
  CANCELED = 'CANCELED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  NEW_INSURANCE = 'NEW_INSURANCE', // Liquidation with Insurance Fund
  NEW_ADL = 'NEW_ADL', // Counterparty Liquidation
}

export enum OrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  STOP = 'STOP',
  STOP_MARKET = 'STOP_MARKET',
  TAKE_PROFIT = 'TAKE_PROFIT',
  TAKE_PROFIT_MARKET = 'TAKE_PROFIT_MARKET',
  TRAILING_STOP_MARKET = 'TRAILING_STOP_MARKET',
  LIQUIDATION = 'LIQUIDATION',
}

export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum TimeInForce {
  GTC = 'GTC', // Good Till Cancel
  IOC = 'IOC', // Immediate or Cancel
  FOK = 'FOK', // Fill or Kill
  GTX = 'GTX', // Good Till Crossing (Post Only)
  HIDDEN = 'HIDDEN',
}

export enum ExecutionType {
  NEW = 'NEW',
  CANCELED = 'CANCELED',
  CALCULATED = 'CALCULATED', // Liquidation Execution
  EXPIRED = 'EXPIRED',
  TRADE = 'TRADE',
  AMENDMENT = 'AMENDMENT',
}

export enum PositionSide {
  BOTH = 'BOTH',
  LONG = 'LONG',
  SHORT = 'SHORT',
}

export interface Order {
  symbol: string;
  orderId: number;
  clientOrderId?: string;
  price: string;
  origQty: string;
  executedQty: string;
  cumulativeQuoteQty?: string;
  status: OrderStatus;
  timeInForce: TimeInForce;
  type: OrderType;
  side: OrderSide;
  stopPrice?: string;
  icebergQty?: string;
  time: number;
  updateTime: number;
  isWorking?: boolean;
  workingTime?: number;
  origQuoteOrderQty?: string;
  positionSide?: PositionSide;
  closePosition?: boolean;
  activatePrice?: string; // For TRAILING_STOP_MARKET
  priceRate?: string; // Callback rate for TRAILING_STOP_MARKET
  reduceOnly?: boolean;
  priceProtect?: boolean;
  avgPrice?: string;
  origType?: OrderType;
  // Additional fields from ORDER_TRADE_UPDATE events
  realizedProfit?: string;
  commission?: string;
  commissionAsset?: string;
  isMaker?: boolean;
  lastFilledQty?: string;
  lastFilledPrice?: string;
  tradeId?: number;
}

export interface OrderFilter {
  status?: OrderStatus | OrderStatus[];
  symbol?: string;
  side?: OrderSide;
  type?: OrderType | OrderType[];
  startTime?: number;
  endTime?: number;
  limit?: number;
}

export interface OrderUpdate {
  eventType: 'ORDER_TRADE_UPDATE';
  eventTime: number;
  transactionTime: number;
  order: {
    symbol: string;
    clientOrderId: string;
    side: OrderSide;
    orderType: OrderType;
    timeInForce: TimeInForce;
    originalQuantity: string;
    originalPrice: string;
    averagePrice: string;
    stopPrice: string;
    executionType: ExecutionType;
    orderStatus: OrderStatus;
    orderId: number;
    orderLastFilledQuantity: string;
    orderFilledAccumulatedQuantity: string;
    lastFilledPrice: string;
    commissionAsset?: string;
    commission?: string;
    orderTradeTime: number;
    tradeId: number;
    bidsNotional: string;
    askNotional: string;
    isMakerSide: boolean;
    isReduceOnly: boolean;
    workingType: string;
    originalOrderType: OrderType;
    positionSide: PositionSide;
    closePosition: boolean;
    activationPrice?: string;
    callbackRate?: string;
    realizedProfit: string;
  };
}

export interface Trade {
  buyer: boolean;
  commission: string;
  commissionAsset: string;
  id: number;
  maker: boolean;
  orderId: number;
  price: string;
  qty: string;
  quoteQty: string;
  realizedPnl: string;
  side: OrderSide;
  positionSide: PositionSide;
  symbol: string;
  time: number;
}