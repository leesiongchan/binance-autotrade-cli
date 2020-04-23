import blessed from "blessed";
import chalk from "chalk";
import contrib from "blessed-contrib";
import { BollingerBandsOutput } from "technicalindicators/declarations/volatility/BollingerBands";
import { ExchangeInfo, Symbol } from "binance-api-node";
import { Observable, combineLatest } from "rxjs";
import { last as _last } from "lodash/fp";
import { map, throttleTime, filter, pairwise, bufferTime, withLatestFrom } from "rxjs/operators";

import { SCREEN_UPDATE_INTERVAL } from "./constants";
import {
  TradingCandle,
  TradingAccount,
  TradingOrder,
  TradingOrderBook,
  TradingTrade,
} from "./interface";
import { bollingerBands, roc } from "./utils/operators";
import {
  ArbitrageResult,
  calcProfitRatio,
  collectDataForArbitrageCalculation,
  findBollingerBandsModifier,
  findReferenceSymbol,
} from "./utils/algorithms";
import { formatNumber, formatSymbol, formatArbitrageItem } from "./utils/formatter";

interface GUIItems {
  balanceTable: contrib.Widgets.TableElement;
  calcResultMarkdown: contrib.Widgets.MarkdownElement;
  priceLcds: contrib.Widgets.LcdElement[];
  screen: blessed.Widgets.Screen;
  serverLog: contrib.Widgets.LogElement;
  tradingInfoMarkdown: contrib.Widgets.MarkdownElement;
}

interface GUIOptions {
  accountInfo$: Observable<TradingAccount>;
  arbitrage$: Observable<ArbitrageResult>;
  candle$: Observable<TradingCandle>;
  exchangeInfo$: Observable<ExchangeInfo>;
  order$: Observable<TradingOrder>;
  orderBook$: Observable<TradingOrderBook>;
  prices$: Observable<{ [i: string]: string }>;
  symbols: string[];
  trade$: Observable<TradingTrade>;
  tradingAssets$: Observable<string[]>;
  tradingInfos$: Observable<[string, string, string, BollingerBandsOutput, number][]>;
  tradingSymbols$: Observable<Symbol[]>;
}

const throttleTimeInterval = SCREEN_UPDATE_INTERVAL - 100;

function renderPriceLcds(gui: GUIItems, options: GUIOptions) {
  const { priceLcds } = gui;
  const { candle$, tradingSymbols$, symbols } = options;

  const mainSubscription = combineLatest(
    symbols.map((s) =>
      candle$.pipe(
        filter((c) => c.symbol === s),
        map((c) => c.close),
        pairwise(),
      ),
    ),
  )
    .pipe(withLatestFrom(tradingSymbols$), throttleTime(throttleTimeInterval))
    .subscribe(([prices, tradingSymbols]) => {
      prices.forEach(([prevPrice, price], i) => {
        const priceColor = prevPrice > price ? chalk.redBright : chalk.greenBright;
        priceLcds[i].setOptions({ color: prevPrice > price ? "red" : "green" });
        priceLcds[i].setLabel(
          formatSymbol(tradingSymbols.find((ts) => ts.symbol === symbols[i])!) +
            priceColor(` (${formatNumber(Number(price) - Number(prevPrice))})`),
        );
        priceLcds[i].setDisplay(price);
      });
    });

  return [mainSubscription];
}

function renderBalanceTable(gui: GUIItems, options: GUIOptions) {
  const { balanceTable } = gui;
  const { accountInfo$, tradingAssets$ } = options;

  const mainSubscription = combineLatest(accountInfo$, tradingAssets$)
    .pipe(throttleTime(throttleTimeInterval))
    .subscribe(([accountInfo, tradingAssets]) => {
      balanceTable.setData({
        headers: [" Asset", " Quantity"],
        data: accountInfo.balances
          .filter((b) => tradingAssets.includes(b.asset))
          .map((b) => [b.asset, b.free]),
      });
    });

  return [mainSubscription];
}

function renderOrderTable(gui: GUIItems, options: GUIOptions) {
  const { balanceTable } = gui;
  const { order$ } = options;

  const mainSubscription = order$
    .pipe(
      bufferTime(1000),
      throttleTime(throttleTimeInterval),
      filter((orders) => orders.length > 0),
    )
    .subscribe((orders) => {
      balanceTable.setData({
        headers: [" Pair", " Price", " QTY", " Side"],
        data: orders.map((o) => [o.symbol, o.price, o.origQty, o.side]),
      });
    });

  return [mainSubscription];
}

function renderTradingInfoMarkdown(gui: GUIItems, options: GUIOptions) {
  const { tradingInfoMarkdown } = gui;
  const { candle$, orderBook$, tradingAssets$, tradingSymbols$, symbols } = options;

  const mainSubscription = combineLatest(
    symbols.map((symbol) => {
      const symbolOrderBook$ = orderBook$.pipe(filter((b) => b.symbol === symbol));
      const symbolCandle$ = candle$.pipe(filter((c) => c.symbol === symbol));
      return combineLatest(
        symbolOrderBook$.pipe(
          map((b) => b.asks[0]?.price),
          filter((b) => !!b),
          pairwise(),
        ),
        symbolOrderBook$.pipe(
          map((b) => b.bids[0]?.price),
          filter((b) => !!b),
          pairwise(),
        ),
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
  )
    .pipe(withLatestFrom(tradingAssets$, tradingSymbols$), throttleTime(throttleTimeInterval))
    .subscribe(([tradingInfos, tradingAssets, tradingSymbols]) => {
      const priceInfo = tradingInfos.map(([[prevAsk, ask], [prevBid, bid], bb, roc], i) => {
        if (!prevAsk || !ask || !prevBid || !bid || !bb || !roc) {
          throw new Error("Error for whatever reason. (gui.ts L150)");
        }
        const pair = tradingSymbols.find((ts) => ts.symbol === symbols[i])!;
        const askColor = prevAsk > ask ? chalk.redBright : chalk.greenBright;
        const bidColor = prevBid > bid ? chalk.redBright : chalk.greenBright;
        return `
_${formatSymbol(pair)}_
Ask: ${askColor(formatNumber(ask))} (${askColor(formatNumber(Number(ask) - Number(prevAsk)))})
Bid: ${bidColor(formatNumber(bid))} (${bidColor(formatNumber(Number(bid) - Number(prevBid)))})
BB : ${formatNumber(bb.lower)}/${formatNumber(bb.middle)}/${formatNumber(bb.upper)}
ROC: ${formatNumber(roc)}
`;
      });

      tradingInfoMarkdown.setMarkdown(`
Triangle: ${tradingAssets.join("-")}
===

${priceInfo.join("\n")}
`);
    });

  return [mainSubscription];
}

function renderCalcResultMarkdown(gui: GUIItems, options: GUIOptions) {
  const { calcResultMarkdown } = gui;
  const { arbitrage$, candle$, orderBook$, tradingSymbols$, symbols } = options;

  const mainSubscription = combineLatest(
    combineLatest(
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
          ),
          symbolCandle$.pipe(
            roc(),
            map((roc) => _last(roc)),
          ),
        );
      }),
    ),
    arbitrage$,
  )
    .pipe(withLatestFrom(tradingSymbols$), throttleTime(throttleTimeInterval))
    .subscribe(
      ([[tradingInfos, arbitrageResult], tradingSymbols]: [
        [[string, string, string, BollingerBandsOutput, number][], ArbitrageResult],
        Symbol[],
      ]) => {
        const rocs = tradingInfos.map(([, , , , roc], i) => ({ symbol: symbols[i], roc }));
        const refSymbolStr = findReferenceSymbol(rocs[0], rocs[1], rocs[2]);
        const refSymbolIndex = tradingSymbols.findIndex((ts) => ts.symbol === refSymbolStr);
        const refSymbol = tradingSymbols[refSymbolIndex];

        const bollingerBands = tradingInfos.map((info) => info[3]);
        const orderBooks = tradingInfos.map((info) => ({
          ask: Number(info[0]),
          bid: Number(info[1]),
        }));
        const prices = tradingInfos.map((info) => Number(info[2]));
        const {
          abPrice,
          acPrice,
          cbPrice,
          scenarioA,
          scenarioB,
        } = collectDataForArbitrageCalculation({
          orderBooks,
          prices,
        });
        const bbModifier = findBollingerBandsModifier(prices, bollingerBands);
        const profitRatio = calcProfitRatio(prices, bollingerBands);

        calcResultMarkdown.setMarkdown(`
Ref Pair: ${formatSymbol(refSymbol)}
===
AB Price: ${formatNumber(abPrice)}
AC Price: ${formatNumber(acPrice)}
CB Price: ${formatNumber(cbPrice)}

Scenario A  : ${formatNumber(scenarioA)}
Scenario B  : ${formatNumber(scenarioB)}
BB Modifier : ${formatNumber(bbModifier)}
Profit Ratio: ${formatNumber(profitRatio)}

AB Amount: ${!!arbitrageResult ? formatArbitrageItem(arbitrageResult[0], "quantity") : "N/A"}
AB Price : ${!!arbitrageResult ? formatArbitrageItem(arbitrageResult[0], "price") : "N/A"}

AC Amount: ${!!arbitrageResult ? formatArbitrageItem(arbitrageResult[1], "quantity") : "N/A"}
AC Price : ${!!arbitrageResult ? formatArbitrageItem(arbitrageResult[1], "price") : "N/A"}

CB Amount: ${!!arbitrageResult ? formatArbitrageItem(arbitrageResult[2], "quantity") : "N/A"}
CB Price : ${!!arbitrageResult ? formatArbitrageItem(arbitrageResult[2], "price") : "N/A"}
`);
      },
    );

  return [mainSubscription];
}

const lcdOptions: contrib.Widgets.LcdOptions = { elements: 7 };
const tableOptions: contrib.Widgets.TableOptions = { fg: "white" };

function loadGui(options: GUIOptions) {
  const screen = blessed.screen({ smartCSR: true });
  const grid = new contrib.grid({ rows: 18, cols: 12, screen });
  const priceLcds = [
    grid.set(0, 0, 4, 4, contrib.lcd, lcdOptions),
    grid.set(0, 4, 4, 4, contrib.lcd, lcdOptions),
    grid.set(0, 8, 4, 4, contrib.lcd, lcdOptions),
  ];
  const balanceTable = grid.set(4, 0, 6, 3, contrib.table, {
    ...tableOptions,
    label: "My Balances",
    fg: "white",
    interactive: false,
    columnWidth: [6, 15],
  });
  const orderTable = grid.set(4, 3, 6, 3, contrib.table, {
    label: "My Orders",
    fg: "white",
    interactive: false,
    columnWidth: [10, 8, 8, 24],
  });
  const tradingInfoMarkdown = grid.set(4, 6, 14, 3, contrib.markdown, {
    label: "Trading Information",
    padding: { left: 2, right: 2 },
  }) as contrib.Widgets.MarkdownElement;
  const calcResultMarkdown = grid.set(4, 9, 14, 3, contrib.markdown, {
    label: "Calculation Result",
    padding: { left: 2, right: 2 },
  } as contrib.Widgets.MarkdownOptions) as contrib.Widgets.MarkdownElement;
  const serverLog: contrib.Widgets.LogElement = grid.set(10, 0, 8, 6, contrib.log, {
    label: "Server Log",
    interactive: false,
    padding: { left: 2, right: 2 },
  } as contrib.Widgets.LogOptions);

  const guiItems = {
    balanceTable,
    calcResultMarkdown,
    orderTable,
    priceLcds,
    screen,
    serverLog,
    tradingInfoMarkdown,
  };

  const balanceTableSubscriptions = renderBalanceTable(guiItems, options);
  const calcResultMarkdownSubscriptions = renderCalcResultMarkdown(guiItems, options);
  // const orderTableSubscriptions = renderOrderTable(guiItems, options);
  const priceLcdSubscriptions = renderPriceLcds(guiItems, options);
  const tradingInfoMarkdownSubscriptions = renderTradingInfoMarkdown(guiItems, options);

  setInterval(() => {
    screen.render();
  }, SCREEN_UPDATE_INTERVAL);

  screen.key(["escape", "q", "C-c"], (ch, key) => {
    balanceTableSubscriptions.forEach((subscription) => {
      subscription.unsubscribe();
    });
    calcResultMarkdownSubscriptions.forEach((subscription) => {
      subscription.unsubscribe();
    });
    // orderTableSubscriptions.forEach((subscription) => {
    //   subscription.unsubscribe();
    // });
    priceLcdSubscriptions.forEach((subscription) => {
      subscription.unsubscribe();
    });
    tradingInfoMarkdownSubscriptions.forEach((subscription) => {
      subscription.unsubscribe();
    });
    return process.exit(0);
  });
  // ref: https://github.com/yaronn/blessed-contrib/issues/10
  screen.on("resize", () => {
    balanceTable.emit("attach");
    calcResultMarkdown.emit("attach");
    orderTable.emit("attach");
    priceLcds.forEach((item) => {
      item.emit("attach");
    });
    serverLog.emit("attach");
    tradingInfoMarkdown.emit("attach");
  });

  return guiItems;
}

export default loadGui;
