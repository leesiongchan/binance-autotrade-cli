import BlessedContrib from "blessed-contrib";
import chalk from "chalk";
import deepEqual from "fast-deep-equal";
import {
  Account,
  Candle,
  CandleChartInterval,
  Depth,
  ExecutionReport,
  NewOrder,
  Order,
  OrderBook,
  OutboundAccountInfo,
  SymbolLotSizeFilter,
  SymbolPriceFilter,
  Trade,
  PartialDepth,
} from "binance-api-node";
import { BollingerBandsOutput } from "technicalindicators/declarations/volatility/BollingerBands";
import { Observable, concat, from, interval, combineLatest, merge, BehaviorSubject } from "rxjs";
import { isEmpty as _isEmpty, last as _last, uniq as _uniq } from "lodash/fp";
import { format as formatDate } from "date-fns/fp";
import {
  concatMap,
  distinctUntilChanged,
  filter,
  map,
  mergeMap,
  mergeMapTo,
  pairwise,
  retry,
  scan,
  shareReplay,
  tap,
  withLatestFrom,
} from "rxjs/operators";
import { prompt } from "enquirer";

import client from "./utils/api-client";
import loadGui from "./gui";
import logger from "./utils/logger";
import { TRADE_SIZE, CANDLE_SIZE, ENABLE_GUI, ACCOUNT_TYPE, TEST_MODE } from "./constants";
import {
  TradingAccount,
  TradingCandle,
  TradingOrder,
  TradingOrderBook,
  TradingTrade,
} from "./interface";
import { bollingerBands, roc } from "./utils/operators";
import { findArbitrage, findReferenceSymbol, calcDustless } from "./utils/algorithms";
import { formatSymbol } from "./utils/formatter";

const TICKER_LIST = {
  "BTC-USDT-BUSD": ["BTCUSDT", "BTCBUSD", "BUSDUSDT"],
  "ETH-USDT-BUSD": ["ETHUSDT", "ETHBUSD", "BUSDUSDT"],
  "LTC-USDT-BUSD": ["LTCUSDT", "LTCBUSD", "BUSDUSDT"],
  "XRP-USDT-BUSD": ["XRPUSDT", "XRPBUSD", "BUSDUSDT"],
  "BCH-USDT-BUSD": ["BCHUSDT", "BCHBUSD", "BUSDUSDT"],
};

async function run() {
  const questions = [
    {
      type: "select",
      name: "symbols",
      message: "Select your triangle pair",
      initial: 0,
      choices: Object.entries(TICKER_LIST).map(([key, val]) => ({
        message: key,
        name: val,
      })),
    },
  ];

  const response: any = await prompt(questions);
  const symbols: string[] = response.symbols;

  let accountReq = client.accountInfo;
  let accountWs = client.ws.user;
  let allOrdersReq = client.allOrders;
  let orderReq = client.order;
  if (ACCOUNT_TYPE === "MARGIN") {
    accountReq = client.marginAccountInfo;
    accountWs = client.ws.marginUser;
    allOrdersReq = client.marginAllOrders;
    orderReq = client.marginOrder;
  }

  const accountInfo$ = concat(
    // Initial
    from(
      accountReq().then((a: any) => ({
        ...a,
        balances: ACCOUNT_TYPE === "MARGIN" ? a.userAssets : a.balances,
      })),
    ).pipe(map<Account, TradingAccount>((ai) => ai)),
    // WS
    new Observable<OutboundAccountInfo>((subscriber) => {
      const ws = accountWs((msg) => {
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
    from(symbols.map((symbol) => allOrdersReq({ symbol }))).pipe(
      mergeMap((orders) => orders),
      mergeMap((orders) => orders as TradingOrder[]),
    ),
    // WS
    new Observable<ExecutionReport>((subscriber) => {
      const ws = accountWs((msg) => {
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

  const orderBookPartial$ = new Observable<PartialDepth>((subscriber) => {
    // WS
    const ws = client.ws.partialDepth(
      symbols.map((symbol) => ({ symbol, level: 5 })),
      (depth) => {
        subscriber.next(depth);
      },
    );
    return () => {
      ws();
    };
  }).pipe(
    map<PartialDepth, TradingOrderBook>((book) => ({
      asks: book.asks,
      bids: book.bids,
      symbol: book.symbol,
    })),
  );
  // ref: https://binance-docs.github.io/apidocs/spot/en/#how-to-manage-a-local-order-book-correctly
  const orderBookFull$ = merge(
    ...symbols.map((symbol) =>
      new Observable<Depth>((subscriber) => {
        const ws = client.ws.depth(symbol, (depth) => {
          subscriber.next(depth);
        });
        return () => {
          ws();
        };
      }).pipe(
        pairwise(),
        filter(
          ([prevOrderBook, orderBook]) =>
            prevOrderBook.finalUpdateId + 1 === orderBook.firstUpdateId,
        ),
        map(([, orderBook]) => ({
          ...orderBook,
          askDepth: orderBook.askDepth.filter((ask) => Number(ask.quantity) > 0),
          bidDepth: orderBook.bidDepth.filter((bid) => Number(bid.quantity) > 0),
        })),
        withLatestFrom(from(client.book({ symbol, limit: 5 }))),
        filter(([obEv, ob]) => obEv.finalUpdateId > ob.lastUpdateId),
        map<[Depth, OrderBook], TradingOrderBook>(([book]) => ({
          asks: book.askDepth,
          bids: book.bidDepth,
          symbol: book.symbol,
        })),
      ),
    ),
  );
  const orderBook$ = orderBookFull$.pipe(shareReplay(1));

  const candle$ = concat(
    // Initial
    from(
      symbols.map((symbol) =>
        client.candles({ symbol, limit: CANDLE_SIZE, interval: CandleChartInterval.ONE_MINUTE }),
      ),
    ).pipe(
      concatMap((candles) => candles),
      mergeMap((candles, i) => candles.map<TradingCandle>((c) => ({ ...c, symbol: symbols[i] }))),
    ),
    // WS
    new Observable<Candle>((subscriber) => {
      const ws = client.ws.candles(symbols, CandleChartInterval.ONE_MINUTE, (candle) => {
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
      concatMap((trades) => trades),
      mergeMap((trades) =>
        trades.map<TradingTrade>((trade, i) => ({
          id: trade.id,
          price: trade.price,
          quantity: trade.qty,
          symbol: symbols[i],
          time: trade.time,
        })),
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

  const tradingSymbols$ = exchangeInfo$.pipe(
    map((ei) => ei.symbols.filter((s) => symbols.includes(s.symbol))),
    shareReplay(1),
  );
  const tradingAssets$ = tradingSymbols$.pipe(
    map((ts) => _uniq(ts.flatMap((s) => [s.baseAsset, s.quoteAsset]))),
    shareReplay(1),
  );
  const tradingInfos$ = combineLatest<[string, string, string, BollingerBandsOutput, number][]>(
    ...symbols.map((symbol) => {
      const symbolOrderBook$ = orderBook$.pipe(filter((b) => b.symbol === symbol));
      const symbolCandle$ = candle$.pipe(filter((c) => c.symbol === symbol));
      return combineLatest(
        symbolOrderBook$.pipe(
          map((b) => b.asks[0]?.price),
          filter((b) => !!b),
        ),
        symbolOrderBook$.pipe(
          map((b) => b.bids[0]?.price),
          filter((b) => !!b),
        ),
        symbolCandle$.pipe(map((c) => c.close)),
        symbolCandle$.pipe(
          bollingerBands(),
          map((bb) => _last(bb)),
          filter((b) => !!b),
        ),
        symbolCandle$.pipe(
          roc(),
          map((roc) => _last(roc)),
          filter((b) => !!b),
        ),
      );
    }),
  ).pipe(shareReplay(1));

  const isOrderInProgress$ = new BehaviorSubject(false);
  const arbitrage$ = tradingInfos$.pipe(
    withLatestFrom(
      accountInfo$,
      tradingAssets$,
      tradingSymbols$,
      isOrderInProgress$.pipe(distinctUntilChanged((x, y) => x === y)),
    ),
    filter(([, , , , b]) => b === false),
    map(([tradingInfos, accountInfo, tradingAssets, tradingSymbols]) => {
      const rocs = tradingInfos.map((info, i) => ({ symbol: symbols[i], roc: info[4] }));
      const refSymbolStr = findReferenceSymbol(rocs[0], rocs[1], rocs[2]);
      const refSymbolIndex = tradingSymbols.findIndex((ts) => ts.symbol === refSymbolStr);

      const balances = tradingAssets.map((asset) => {
        const balance = accountInfo.balances.find((b) => b.asset === asset)!;
        return Number(balance.free) - Number(balance.locked);
      });
      const bollingerBands = tradingInfos.map((info) => info[3]);
      const orderBooks = tradingInfos.map((info) => ({
        ask: Number(info[0]),
        bid: Number(info[1]),
      }));
      const prices = tradingInfos.map((info) => Number(info[2]));

      return findArbitrage({
        balances,
        prices,
        bollingerBands,
        orderBooks,
        refSymbolIndex,
      });
    }),
    distinctUntilChanged((x, y) => deepEqual(x, y)),
    // shareReplay(1),
  );
  const newOrders$ = arbitrage$.pipe(
    filter((ar) => ar !== null),
    withLatestFrom(tradingSymbols$),
    map(([ar, tradingSymbols]) => {
      if (!ar) {
        throw new Error("No arbitrage info for whatever reason. (index.ts L339)");
      }
      const newOrders: NewOrder[] = tradingSymbols.map((ts, i) => {
        const priceFilter = ts.filters.find(
          (f) => f.filterType === "PRICE_FILTER",
        ) as SymbolPriceFilter;
        const lotSizeFilter = ts.filters.find(
          (f) => f.filterType === "LOT_SIZE",
        ) as SymbolLotSizeFilter;
        const priceDustDecimals = priceFilter.tickSize.indexOf("1") - 1;
        const qtyDustDecimals = lotSizeFilter.stepSize.indexOf("1") - 1;

        const side = ar[i].bid.quantity ? "BUY" : "SELL";
        let price = side === "SELL" ? ar[i].ask.price : ar[i].bid.price;
        price = price ? calcDustless(price, priceDustDecimals) : 0;
        let quantity = side === "SELL" ? ar[i].ask.quantity : ar[i].bid.quantity;
        quantity = quantity ? calcDustless(quantity, qtyDustDecimals) : 0;

        return {
          price: price.toFixed(ts.quotePrecision),
          quantity: quantity.toString(),
          side,
          symbol: ts.symbol,
          type: "LIMIT",
        };
      });
      if (newOrders.some((o) => !o.price || Number(o.price) <= 0 || Number(o.quantity) <= 0)) {
        throw new Error("You do not have enough amount to trade.");
      }
      return newOrders;
    }),
    // Don't make the same order twice!
    // distinctUntilChanged((x, y) => deepEqual(x, y)),
  );
  const executeOrder$ = newOrders$.pipe(
    concatMap(async (newOrders) => {
      let orders: Order[];
      isOrderInProgress$.next(true);
      try {
        orders = await Promise.all(
          newOrders.map(async (newOrder) => {
            const order = {
              clientOrderId: newOrder.newClientOrderId,
              executedQty: newOrder.quantity,
              icebergQty: newOrder.icebergQty,
              price: newOrder.price,
              side: newOrder.side,
              status: "NEW",
              symbol: newOrder.symbol,
              timeInForce: newOrder.timeInForce,
              type: newOrder.type,
            } as Order;
            if (TEST_MODE) {
              await client.orderTest(newOrder);
            }
            return order;
          }),
        );
      } finally {
        isOrderInProgress$.next(false);
      }
      return orders;
    }),
  );

  const serverLog$ = merge(
    arbitrage$.pipe(
      map((arbitrageResult) => {
        const logColor = !!arbitrageResult ? chalk.greenBright : chalk.redBright;
        return logColor(
          !!arbitrageResult
            ? "Yay! Let's all-in now!"
            : "No luck, I will keep trying in the background!",
        );
      }),
    ),
    executeOrder$.pipe(
      withLatestFrom(tradingSymbols$),
      mergeMap(([orders, tradingSymbols]) =>
        orders.map((o) => {
          const sideColor = o.side === "SELL" ? chalk.redBright : chalk.greenBright;
          const symbol = `<${formatSymbol(
            tradingSymbols.find((ts) => ts.symbol === o.symbol)!,
          )}>`.padStart(11);
          const side = sideColor(`[${o.side}]`.padStart(6));
          return `${side} ${symbol} P: ${o.price.padStart(13)} | Q: ${o.executedQty}`;
        }),
      ),
    ),
  );

  let serverLogger: BlessedContrib.Widgets.LogElement | undefined;
  if (ENABLE_GUI) {
    const { serverLog } = loadGui({
      accountInfo$,
      arbitrage$,
      candle$,
      exchangeInfo$,
      order$,
      orderBook$,
      prices$,
      symbols,
      trade$,
      tradingAssets$,
      tradingInfos$,
      tradingSymbols$,
    });
    serverLogger = serverLog;
  }

  serverLog$
    .pipe(
      tap(
        (msg: string) => {
          logger.info(msg);
          serverLogger?.log(`${chalk.grey(`${formatDate("HH:mm:ss")(new Date())}:`)} ${msg}`);
        },
        (err: string) => {
          logger.error(err);
          serverLogger?.log(
            `${chalk.grey(`${formatDate("HH:mm:ss")(new Date())}:`)} ${chalk.redBright(err)}`,
          );
        },
      ),
      retry(10),
    )
    .subscribe(
      () => {},
      (err) => {
        logger.error(err);
      },
    );
}

run();
