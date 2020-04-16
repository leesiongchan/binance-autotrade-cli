import { Bid, OrderSide, OrderStatus, TimeInForce } from "binance-api-node";

export interface TradingBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface TradingAccount {
  balances: TradingBalance[];
  buyerCommission?: number;
  canDeposit: boolean;
  canTrade: boolean;
  canWithdraw: boolean;
  makerCommission?: number;
  sellerCommission?: number;
  takerCommission?: number;
  updateTime: number;
}

export interface TradingCandle {
  close: string;
  closeTime: number;
  high: string;
  low: string;
  open: string;
  openTime: number;
  quoteVolume: string;
  symbol: string;
  trades: number;
  volume: string;
}

export interface TradingOrderBook {
  symbol: string;
  asks: Bid[];
  bids: Bid[];
}

export interface TradingOrder {
  clientOrderId: string;
  cummulativeQuoteQty: string;
  executedQty: string;
  icebergQty: string;
  isWorking: boolean;
  orderId: number;
  origQty: string;
  price: string;
  side: OrderSide;
  status: OrderStatus;
  stopPrice: string;
  symbol: string;
  time: number;
  timeInForce: TimeInForce;
  type: string;
  updateTime: number;
}

export interface TradingTrade {
  id: number;
  price: string;
  quantity: string;
  symbol: string;
  time: number;
}
