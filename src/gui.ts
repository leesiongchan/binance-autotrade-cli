import * as blessed from "blessed";
import * as chalk from "chalk";
import * as contrib from "blessed-contrib";
import { BollingerBandsOutput } from "technicalindicators/declarations/volatility/BollingerBands";
import { ExchangeInfo, Symbol } from "binance-api-node";
import { Observable, combineLatest } from "rxjs";
import { first as _first, last as _last } from "lodash/fp";
import { map, throttleTime, filter, pairwise, bufferTime, shareReplay } from "rxjs/operators";

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
  calcProfitRatio,
  collectDataForArbitrageCalculation,
  findArbitrage,
  findBollingerBandsModifier,
  findReferenceSymbol,
} from "./utils/algorithms";
import { formatNumber, formatSymbol } from "./utils/formatter";

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
  candle$: Observable<TradingCandle>;
  exchangeInfo$: Observable<ExchangeInfo>;
  order$: Observable<TradingOrder>;
  orderBook$: Observable<TradingOrderBook>;
  prices$: Observable<{ [i: string]: string }>;
  symbols: string[];
  trade$: Observable<TradingTrade>;
  tradingAssets$: Observable<string[]>;
  tradingSymbols$: Observable<Symbol[]>;
}

function renderPriceLcds(gui: GUIItems, options: GUIOptions) {
  const { priceLcds } = gui;
  const { candle$, tradingSymbols$, symbols } = options;

  const mainSubscription = combineLatest(
    combineLatest(
      symbols.map((s) =>
        candle$.pipe(
          filter((c) => c.symbol === s),
          map((c) => c.close),
          pairwise(),
        ),
      ),
    ),
    tradingSymbols$,
  )
    .pipe(throttleTime(1000))
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
    .pipe(throttleTime(1000))
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

  const mainSubscription = combineLatest(order$.pipe(bufferTime(1000)))
    .pipe(throttleTime(1000))
    .subscribe(([orders]) => {
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
    combineLatest(
      ...symbols.map((symbol) => {
        const symbolOrderBook$ = orderBook$.pipe(filter((b) => b.symbol === symbol));
        const symbolCandle$ = candle$.pipe(filter((c) => c.symbol === symbol));
        return combineLatest(
          symbolOrderBook$.pipe(
            map((b) => _first(b.asks.map((b) => b.price))),
            filter(Boolean),
            pairwise(),
          ),
          symbolOrderBook$.pipe(
            map((b) => _first(b.bids.map((b) => b.price))),
            filter(Boolean),
            pairwise(),
          ),
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
    combineLatest(tradingAssets$, tradingSymbols$),
  )
    .pipe(throttleTime(1000))
    .subscribe(
      ([tradingInfos, [tradingAssets, tradingSymbols]]: [
        [[string, string], [string, string], BollingerBandsOutput, number][],
        [string[], Symbol[]],
      ]) => {
        const priceInfo = tradingInfos.map(([[prevAsk, ask], [prevBid, bid], bb, roc], i) => {
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
Triangle : ${tradingAssets.join("-")}
===

${priceInfo.join("\n")}
`);
      },
    );

  return [mainSubscription];
}

function renderCalcResultMarkdown(gui: GUIItems, options: GUIOptions) {
  const { calcResultMarkdown, serverLog } = gui;
  const { accountInfo$, candle$, orderBook$, tradingAssets$, tradingSymbols$, symbols } = options;

  const mainSubscription = combineLatest(
    combineLatest(
      ...symbols.map((symbol) => {
        const symbolOrderBook$ = orderBook$.pipe(filter((b) => b.symbol === symbol));
        const symbolCandle$ = candle$.pipe(filter((c) => c.symbol === symbol));
        return combineLatest(
          symbolOrderBook$.pipe(
            map((b) => _first(b.asks.map((b) => b.price))),
            filter(Boolean),
          ),
          symbolOrderBook$.pipe(
            map((b) => _first(b.bids.map((b) => b.price))),
            filter(Boolean),
          ),
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
    combineLatest(accountInfo$, tradingAssets$, tradingSymbols$),
  )
    .pipe(throttleTime(1000))
    .subscribe(
      ([tradingInfos, [accountInfo, tradingAssets, tradingSymbols]]: [
        [string, string, BollingerBandsOutput, number][],
        [TradingAccount, string[], Symbol[]],
      ]) => {
        const rocs = tradingInfos.map(([, , , roc], i) => ({ symbol: symbols[i], roc }));
        const refSymbolStr = findReferenceSymbol(rocs[0], rocs[1], rocs[2]);
        const refSymbolIndex = tradingSymbols.findIndex((ts) => ts.symbol === refSymbolStr);
        const refSymbol = tradingSymbols[refSymbolIndex];

        const bollingerBands = [tradingInfos[0][2], tradingInfos[1][2], tradingInfos[2][2]];
        const orderBooks = [
          { ask: Number(tradingInfos[0][0]), bid: Number(tradingInfos[0][1]) },
          { ask: Number(tradingInfos[1][0]), bid: Number(tradingInfos[1][1]) },
          { ask: Number(tradingInfos[2][0]), bid: Number(tradingInfos[2][1]) },
        ];
        const { abPrice, acPrice, cbPrice, priceA, priceB } = collectDataForArbitrageCalculation(
          orderBooks,
        );
        const prices = [abPrice, acPrice, cbPrice];
        const bbModifier = findBollingerBandsModifier(prices, bollingerBands);
        const profitRatio = calcProfitRatio(prices, bollingerBands);

        const {
          abAskAmount,
          abAskPrice,
          acAskAmount,
          acAskPrice,
          cbAskAmount,
          cbAskPrice,
          abBidAmount,
          abBidPrice,
          acBidAmount,
          acBidPrice,
          cbBidAmount,
          cbBidPrice,
          result: hasResult,
        } = findArbitrage({
          balances: [
            Number(accountInfo.balances.find((b) => b.asset === tradingAssets[0])!.free),
            Number(accountInfo.balances.find((b) => b.asset === tradingAssets[1])!.free),
            Number(accountInfo.balances.find((b) => b.asset === tradingAssets[2])!.free),
          ],
          bollingerBands,
          orderBooks,
          refSymbolIndex,
        });

        const resultText = hasResult
          ? chalk.greenBright("Yay! Let's all-in now!")
          : chalk.redBright("No luck, I will try again later!");

        serverLog.log(resultText);

        calcResultMarkdown.setMarkdown(`
Ref Pair: ${formatSymbol(refSymbol)}
===
AB Price: ${formatNumber(abPrice)}
AC Price: ${formatNumber(acPrice)}
CB Price: ${formatNumber(cbPrice)}

Price A     : ${formatNumber(priceA)}
Price B     : ${formatNumber(priceB)}
BB Modifier : ${formatNumber(bbModifier)}
Profit Ratio: ${formatNumber(profitRatio)}

AB Amount: ${formatNumber(abAskAmount || "N/A")} | ${formatNumber(abBidAmount || "N/A")}
AB Price : ${formatNumber(abAskPrice || "N/A")} | ${formatNumber(abBidPrice || "N/A")}

AC Amount: ${formatNumber(acAskAmount || "N/A")} | ${formatNumber(acBidAmount || "N/A")}
AC Price : ${formatNumber(acAskPrice || "N/A")} | ${formatNumber(acBidPrice || "N/A")}

CB Amount: ${formatNumber(cbAskAmount || "N/A")} | ${formatNumber(cbBidAmount || "N/A")}
CB Price : ${formatNumber(cbAskPrice || "N/A")} | ${formatNumber(cbBidPrice || "N/A")}

${resultText}
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
  const balanceTable = grid.set(4, 0, 7, 3, contrib.table, {
    ...tableOptions,
    label: "My Balances",
    fg: "white",
    interactive: false,
    columnWidth: [6, 15],
  });
  const orderTable = grid.set(4, 3, 7, 3, contrib.table, {
    label: "My Orders",
    fg: "white",
    interactive: false,
    columnWidth: [10, 8, 8, 24, 6],
  });
  const tradingInfoMarkdown = grid.set(4, 6, 14, 3, contrib.markdown, {
    label: "Trading Information",
    padding: { left: 2, right: 2 },
  }) as contrib.Widgets.MarkdownElement;
  const calcResultMarkdown = grid.set(4, 9, 14, 3, contrib.markdown, {
    label: "Calculation Result",
    padding: { left: 2, right: 2 },
  } as contrib.Widgets.MarkdownOptions) as contrib.Widgets.MarkdownElement;
  const serverLog: contrib.Widgets.LogElement = grid.set(11, 0, 7, 6, contrib.log, {
    label: "Server Log",
    fg: "green",
    interactive: false,
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
  const orderTableSubscriptions = renderOrderTable(guiItems, options);
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
    orderTableSubscriptions.forEach((subscription) => {
      subscription.unsubscribe();
    });
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
}

export default loadGui;
