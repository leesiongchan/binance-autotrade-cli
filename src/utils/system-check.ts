import { TradeResult, Symbol } from "binance-api-node";

import { TRADE_SIZE, TICKTIME_THRESHOLD } from "../constants";

export function checkAvailability(
  symbol: string,
  { exchangeSymbols }: { exchangeSymbols: Symbol[] },
) {
  const tradingSymbolIndex = exchangeSymbols.findIndex(
    (ts) => ts.status === "TRADING" && ts.symbol === symbol,
  );
  if (tradingSymbolIndex === -1) {
    throw new Error(`${symbol} is not currently available for trading.`);
  }
  return true;
}

export function checkLiquidity(symbol: string, { trades }: { trades: TradeResult[] }) {
  const ticktimes = [];
  if (trades.length < TRADE_SIZE) {
    console.warn(`${symbol} has lesser trades (${TRADE_SIZE}) than expected.`);
  }
  let numTimeout = 0;
  for (let i = 0; i < trades.length; i++) {
    const trade = trades[i];
    const prevTrade = trades[i + 1];
    if (!prevTrade) break;
    const ticktime =
      new Date(trade.time).getMilliseconds() - new Date(prevTrade.time).getMilliseconds();
    ticktimes.push(ticktime);
    if (ticktime > TICKTIME_THRESHOLD) {
      numTimeout++;
    }
  }
  if (numTimeout >= 5) {
    throw new Error(`${symbol} does not meet the minimum liquidity requirments.`);
  }
  console.log(`${symbol} Ticktimes ->`, ticktimes.map((tt) => `${tt}ms`).join(", "));
  return true;
}
