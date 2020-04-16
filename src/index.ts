import {
  Account,
  Candle,
  CandleChartInterval,
  Depth,
  ExecutionReport,
  OrderBook,
  OutboundAccountInfo,
  Trade,
} from "binance-api-node";
import { Observable, concat, from, interval } from "rxjs";
import { map, mergeMap, mergeMapTo, scan, shareReplay, concatMap } from "rxjs/operators";
import { uniq } from "lodash/fp";

import client from "./utils/api-client";
import loadGui from "./gui";
import { TRADE_SIZE, CANDLE_SIZE } from "./constants";
import {
  TradingCandle,
  TradingAccount,
  TradingOrder,
  TradingOrderBook,
  TradingTrade,
} from "./interface";

const TICKER_LIST = [
  ["BTCUSDT", "BTCBUSD", "BUSDUSDT"],
  ["ETHUSDT", "ETHBUSD", "BUSDUSDT"],
  ["LTCUSDT", "LTCBUSD", "BUSDUSDT"],
  ["XRPUSDT", "XRPBUSD", "BUSDUSDT"],
  ["BCHUSDT", "BCHBUSD", "BUSDUSDT"],
];

function run() {
  const symbols = TICKER_LIST[0];

  const accountInfo$ = concat(
    // Initial
    from(client.accountInfo({ useServerTime: true })).pipe(
      map<Account, TradingAccount>((ai) => ai),
    ),
    // WS
    new Observable<OutboundAccountInfo>((subscriber) => {
      const ws = client.ws.user((msg) => {
        if (msg.eventType === "account") {
          subscriber.next(msg as OutboundAccountInfo);
        }
      });
      return () => {
        ws();
      };
    }).pipe(
      map<OutboundAccountInfo, TradingAccount>((ai) => ({
        ...ai,
        balances: Object.entries(ai.balances).map(([asset, balance]) => ({
          asset,
          free: balance.available,
          locked: balance.locked,
        })),
        updateTime: ai.lastAccountUpdate,
      })),
    ),
  ).pipe(
    scan((fai, ai) => ({ ...fai, ...ai })),
    shareReplay(1),
  );
  const order$ = concat(
    // Initial
    from(symbols.map((symbol) => client.allOrders({ symbol, useServerTime: true }))).pipe(
      mergeMap((orders) => orders),
      mergeMap((orders) => orders as TradingOrder[]),
    ),
    // WS
    new Observable<ExecutionReport>((subscriber) => {
      const ws = client.ws.user((msg) => {
        if (msg.eventType === "executionReport") {
          subscriber.next(msg as ExecutionReport);
        }
      });
      return () => {
        ws();
      };
    }).pipe(
      map<ExecutionReport, TradingOrder>((er) => ({
        clientOrderId: er.newClientOrderId,
        cummulativeQuoteQty: er.totalQuoteTradeQuantity,
        executedQty: er.totalTradeQuantity,
        icebergQty: er.icebergQuantity,
        isWorking: er.isOrderWorking,
        orderId: er.orderId,
        origQty: er.quantity,
        price: er.price,
        side: er.side,
        status: er.orderStatus,
        stopPrice: er.stopPrice,
        symbol: er.symbol,
        time: er.orderTime,
        timeInForce: er.timeInForce,
        type: er.orderType,
        updateTime: er.eventTime,
      })),
    ),
  ).pipe(shareReplay(100));
  const exchangeInfo$ = from(client.exchangeInfo()).pipe(shareReplay(1));

  const orderBook$ = concat(
    // Initial
    from(symbols.map((symbol) => client.book({ symbol, limit: 5 }))).pipe(
      concatMap((book) => book),
      map<OrderBook, TradingOrderBook>((book, i) => ({ ...book, symbol: symbols[i] })),
    ),
    // WS
    new Observable<Depth>((subscriber) => {
      const ws = client.ws.depth(symbols, (depth) => {
        subscriber.next(depth);
      });
      return () => {
        ws();
      };
    }).pipe(
      map<Depth, TradingOrderBook>((book) => ({
        asks: book.askDepth,
        bids: book.bidDepth,
        symbol: book.symbol,
      })),
    ),
  ).pipe(shareReplay(1));

  const candle$ = concat(
    // Initial
    from(
      symbols.map((symbol) =>
        client.candles({ symbol, limit: CANDLE_SIZE, interval: CandleChartInterval.ONE_HOUR }),
      ),
    ).pipe(
      concatMap((candles) => from(candles)),
      mergeMap((candles, i) =>
        from(
          candles.map<TradingCandle>((c) => ({ ...c, symbol: symbols[i] })),
        ),
      ),
    ),
    // WS
    new Observable<Candle>((subscriber) => {
      const ws = client.ws.candles(symbols, CandleChartInterval.ONE_HOUR, (candle) => {
        subscriber.next(candle);
      });
      return () => {
        ws();
      };
    }).pipe(
      map<Candle, TradingCandle>((candle) => ({
        close: candle.close,
        closeTime: candle.closeTime,
        high: candle.high,
        low: candle.low,
        open: candle.open,
        openTime: candle.startTime,
        symbol: candle.symbol,
        quoteVolume: candle.quoteVolume,
        trades: candle.trades,
        volume: candle.volume,
      })),
    ),
  ).pipe(shareReplay(200));

  const prices$ = concat(
    from(client.prices()),
    interval(60 * 1 * 1000).pipe(mergeMapTo(client.prices())),
  ).pipe(shareReplay(1));

  const trade$ = concat(
    // Initial
    from(symbols.map((symbol) => client.trades({ symbol, limit: TRADE_SIZE }))).pipe(
      concatMap((trades) => from(trades)),
      mergeMap((trades) =>
        from(
          trades.map<TradingTrade>((trade, i) => ({
            id: trade.id,
            price: trade.price,
            quantity: trade.qty,
            symbol: symbols[i],
            time: trade.time,
          })),
        ),
      ),
    ),
    // WS
    new Observable<Trade>((subscriber) => {
      const ws = client.ws.trades(symbols, (trade) => {
        subscriber.next(trade);
      });
      return () => {
        ws();
      };
    }).pipe(
      map<Trade, TradingTrade>((trade) => ({
        id: trade.tradeId,
        price: trade.price,
        quantity: trade.quantity,
        symbol: trade.symbol,
        time: trade.eventTime,
      })),
    ),
  ).pipe(shareReplay(1));

  const tradingSymbols$ = exchangeInfo$
    .pipe(map((ei) => ei.symbols.filter((s) => symbols.includes(s.symbol))))
    .pipe(shareReplay(1));
  const tradingAssets$ = tradingSymbols$
    .pipe(map((ts) => uniq(ts.flatMap((s) => [s.baseAsset, s.quoteAsset]))))
    .pipe(shareReplay(1));

  loadGui({
    accountInfo$,
    candle$,
    exchangeInfo$,
    order$,
    orderBook$,
    prices$,
    symbols,
    trade$,
    tradingAssets$,
    tradingSymbols$,
  });
}

run();
