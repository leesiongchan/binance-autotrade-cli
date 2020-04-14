import Binance, {
  Bid,
  CandleChartInterval,
  CandleChartResult,
  Symbol,
  TradeResult,
} from "binance-api-node";
import { BollingerBands, ROC } from "technicalindicators";
import { BollingerBandsOutput } from "technicalindicators/declarations/volatility/BollingerBands";
import { Subject } from "rxjs";
import { first, last, uniq } from "lodash";

interface TradingSymbol extends Symbol {
  asks: Bid[];
  bids: Bid[];
  bollingerBands: BollingerBands;
  candlesticks: CandleChartResult[];
  currentAsk: Bid;
  currentBid: Bid;
  lastBollingerBands: BollingerBandsOutput;
  lastRoc: number;
  roc: ROC;
  trades: TradeResult[];
}

const client = Binance({
  apiKey: process.env.API_KEY!,
  apiSecret: process.env.API_SECRET!,
});

const TICKER_LIST = [
  ["BTCUSDT", "BTCBUSD", "BUSDUSDT"],
  ["ETHUSDT", "ETHBUSD", "BUSDUSDT"],
  ["LTCUSDT", "LTCBUSD", "BUSDUSDT"],
  ["XRPUSDT", "XRPBUSD", "BUSDUSDT"],
  ["BCHUSDT", "BCHBUSD", "BUSDUSDT"],
];

//>>> CONFIG
const BB_PERIOD = 20;
const ROC_PERIOD = 9;

const TICKTIME_THRESHOLD = 300;
const NUM_TRADES = 20;

const BOL_MODIFY = 1;
const PRICE_GAP = 0.01;
const PROFIT_MARGIN = 0.1;
const PROFIT_RATIO = (PROFIT_MARGIN / 100) * BOL_MODIFY;
//<<< CONFIG

function checkAvailability(symbol: string, { exchangeSymbols }: { exchangeSymbols: Symbol[] }) {
  const tradingSymbolIndex = exchangeSymbols.findIndex(
    (ts) => ts.status === "TRADING" && ts.symbol === symbol,
  );
  if (tradingSymbolIndex === -1) {
    throw new Error(`${symbol} is not currently available for trading.`);
  }
  return true;
}

function checkLiquidity(symbol: string, { trades }: { trades: TradeResult[] }) {
  const ticktimes = [];
  if (trades.length < NUM_TRADES) {
    console.warn(`${symbol} has lesser trades (${NUM_TRADES}) than expected.`);
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

function findReferenceSymbol(
  ab: { roc: number; symbol: string },
  bc: { roc: number; symbol: string },
  ca: { roc: number; symbol: string },
): string {
  if (ab.roc < bc.roc && ab.roc < ca.roc) {
    return ab.symbol;
  } else if (bc.roc < ab.roc && bc.roc < ca.roc) {
    return bc.symbol;
  } else if (ca.roc < ab.roc && ca.roc < bc.roc) {
    return ca.symbol;
  }
  throw new Error("Reference symbol cannot be found");
}

async function run() {
  const symbols = TICKER_LIST[0];

  let tradingSymbols: TradingSymbol[] = [];

  console.log("Fetching exchange informations...");
  console.log("------");
  const exchangeInfo = await client.exchangeInfo();
  const exchangeSymbols = exchangeInfo.symbols.filter(
    (ts) => ts.status === "TRADING" && symbols.includes(ts.symbol),
  );

  console.log(`Checking for symbols availability and liquidity...`);
  console.log("------");
  for (const symbol of symbols) {
    checkAvailability(symbol, { exchangeSymbols });
    const recentTrades = await client.trades({
      symbol,
      limit: NUM_TRADES,
    });
    checkLiquidity(symbol, { trades: recentTrades });
    const book = await client.book({
      symbol,
      limit: 5,
    });
    const candlesticks = await client.candles({
      symbol,
      interval: CandleChartInterval.ONE_HOUR,
      limit: 20,
    });
    const closingPrices = candlesticks.map((cs) => Number(cs.close));
    const bollingerBands = new BollingerBands({
      values: closingPrices,
      period: BB_PERIOD,
      stdDev: 2,
    });
    const roc = new ROC({ values: closingPrices, period: ROC_PERIOD });

    const tradingSymbol: TradingSymbol = {
      ...exchangeSymbols.find((es) => es.symbol === symbol)!,
      asks: book.asks,
      bids: book.bids,
      bollingerBands,
      candlesticks,
      roc,
      trades: recentTrades,
      get currentAsk() {
        return first(this.asks)!;
      },
      get currentBid() {
        return first(this.bids)!;
      },
      get lastBollingerBands() {
        return last(this.bollingerBands.result) as BollingerBandsOutput;
      },
      get lastRoc() {
        return Number(last(this.roc.result));
      },
    };

    tradingSymbols.push(tradingSymbol);

    console.log(`${symbol} Bollinger Bands ->`, JSON.stringify(tradingSymbol.lastBollingerBands));
    console.log(`${symbol} ROC ->`, tradingSymbol.lastRoc);
    console.log(`${symbol} Ask ->`, JSON.stringify(tradingSymbol.currentAsk));
    console.log(`${symbol} Bid ->`, JSON.stringify(tradingSymbol.currentBid));
    console.log("------");
  }

  const refSymbol = findReferenceSymbol(
    {
      symbol: tradingSymbols[0].symbol,
      roc: tradingSymbols[0].lastRoc,
    },
    {
      symbol: tradingSymbols[1].symbol,
      roc: tradingSymbols[1].lastRoc,
    },
    {
      symbol: tradingSymbols[2].symbol,
      roc: tradingSymbols[2].lastRoc,
    },
  );

  console.log("Reference Symbol ->", refSymbol);
  console.log("------");

  const accountInfo = await client.accountInfo({ useServerTime: true });
  const tradingAssets = uniq(tradingSymbols.flatMap((ts) => [ts.baseAsset, ts.quoteAsset]));
  const tradingBalances = accountInfo.balances.filter((b) => tradingAssets.includes(b.asset));

  console.log("Trading Symbols ->", tradingSymbols.map((ts) => ts.symbol).join(", "));
  console.log("Trading Assets ->", tradingAssets.join(", "));
  console.log(
    "Trading Balances ->",
    tradingBalances.map((tb) => `${tb.asset}: ${tb.free}`).join(", "),
  );
  console.log("======");

  const getPrice = (ask: Bid, bid: Bid) => (Number(ask.price) + Number(bid.price)) / 2;

  const abPrice = getPrice(tradingSymbols[0].currentAsk, tradingSymbols[0].currentBid);
  const bcPrice = getPrice(tradingSymbols[1].currentAsk, tradingSymbols[1].currentBid);
  const caPrice = getPrice(tradingSymbols[2].currentAsk, tradingSymbols[2].currentBid);

  const currentAbAskPrice = Number(tradingSymbols[0].currentAsk.price);
  const currentBcAskPrice = Number(tradingSymbols[1].currentAsk.price);
  const currentCaAskPrice = Number(tradingSymbols[2].currentAsk.price);
  const currentAbBidPrice = Number(tradingSymbols[0].currentBid.price);
  const currentBcBidPrice = Number(tradingSymbols[1].currentBid.price);
  const currentCaBidPrice = Number(tradingSymbols[2].currentBid.price);

  const priceA = abPrice;
  const priceB = bcPrice * caPrice;

  const unitA = Number(tradingBalances[0].free);
  const unitB = Number(tradingBalances[1].free);
  const unitC = Number(tradingBalances[2].free);

  console.log(`${tradingSymbols[0].symbol} Price ->`, abPrice);
  console.log(`${tradingSymbols[1].symbol} Price ->`, bcPrice);
  console.log(`${tradingSymbols[2].symbol} Price ->`, caPrice);

  console.log("Price A ->", priceA);
  console.log("Price B ->", priceB);
  console.log("------");

  const refSymbolIndex = tradingSymbols.findIndex((ts) => ts.symbol === refSymbol);

  let abAskAmount: number | null = null;
  let abAskPrice: number | null = null;
  let bcAskAmount: number | null = null;
  let bcAskPrice: number | null = null;
  let caAskAmount: number | null = null;
  let caAskPrice: number | null = null;
  let abBidAmount: number | null = null;
  let abBidPrice: number | null = null;
  let bcBidAmount: number | null = null;
  let bcBidPrice: number | null = null;
  let caBidAmount: number | null = null;
  let caBidPrice: number | null = null;

  if (priceA / priceB < 1 - PROFIT_RATIO) {
    if (refSymbolIndex === 2) {
      if (unitB / abPrice > unitA) {
        abBidAmount = unitA;
        abBidPrice = (1 - PRICE_GAP / 100) * currentAbBidPrice;
        bcAskAmount = unitA;
        bcAskPrice = (1 + PRICE_GAP / 100) * currentBcAskPrice;
        caBidAmount = unitA * bcPrice;
        caBidPrice = (1 - PRICE_GAP / 100) * currentCaBidPrice;
      } else if (unitB / abPrice < unitA) {
        abBidAmount = unitB / abPrice;
        abBidPrice = (1 - PRICE_GAP / 100) * currentAbBidPrice;
        bcAskAmount = unitB / abPrice;
        bcAskPrice = (1 + PRICE_GAP / 100) * currentBcAskPrice;
        caBidAmount = (unitB / abPrice) * bcPrice;
        caBidPrice = (1 - PRICE_GAP / 100) * currentCaBidPrice;
      }
    } else if (refSymbolIndex === 1) {
      if (unitB < unitC * caPrice) {
        abBidAmount = unitB / abPrice;
        abBidPrice = (1 - PRICE_GAP / 100) * currentAbBidPrice;
        bcBidAmount = unitB / abPrice;
        bcBidPrice = (1 - PRICE_GAP / 100) * currentBcBidPrice;
        caAskAmount = unitA * bcPrice;
        caAskPrice = (1 + PRICE_GAP / 100) * currentCaAskPrice;
      } else if (unitB > unitC * caPrice) {
        abBidAmount = (unitC * caPrice) / abPrice;
        abBidPrice = (1 - PRICE_GAP / 100) * currentAbBidPrice;
        bcBidAmount = (unitC * caPrice) / abPrice;
        bcBidPrice = (1 - PRICE_GAP / 100) * currentBcBidPrice;
        caAskAmount = unitC;
        caAskPrice = (1 + PRICE_GAP / 100) * currentCaAskPrice;
      }
    } else if (refSymbolIndex === 0) {
      if (unitA * bcPrice > unitC) {
        abBidAmount = (unitC * caPrice) / abPrice;
        abBidPrice = (1 - PRICE_GAP / 100) * currentAbBidPrice;
        bcAskAmount = unitC / bcPrice;
        bcAskPrice = (1 + PRICE_GAP / 100) * currentBcAskPrice;
        caAskAmount = unitC;
        caAskPrice = (1 + PRICE_GAP / 100) * currentCaAskPrice;
      } else if (unitA * bcPrice < unitC) {
        abBidAmount = unitA;
        abBidPrice = (1 - PRICE_GAP / 100) * currentAbBidPrice;
        bcAskAmount = unitA;
        bcAskPrice = (1 + PRICE_GAP / 100) * currentBcAskPrice;
        caAskAmount = unitA * bcPrice;
        caAskPrice = (1 + PRICE_GAP / 100) * currentCaAskPrice;
      }
    }
  } else if (priceA / priceB > 1 + PROFIT_RATIO) {
    if (refSymbolIndex === 2) {
      if (unitA > unitC / bcPrice) {
        abAskAmount = unitC / bcPrice;
        abAskPrice = (1 + PRICE_GAP / 100) * currentAbAskPrice;
        bcBidAmount = unitC / bcPrice;
        bcBidPrice = (1 - PRICE_GAP / 100) * currentBcBidPrice;
        caAskAmount = unitC;
        caAskPrice = (1 + PRICE_GAP / 100) * currentCaAskPrice;
      } else if (unitC / bcPrice > unitA) {
        abAskAmount = unitA;
        abAskPrice = (1 + PRICE_GAP / 100) * currentAbAskPrice;
        bcBidAmount = unitA;
        bcBidPrice = (1 - PRICE_GAP / 100) * currentBcBidPrice;
        caAskAmount = unitA * bcPrice;
        caAskPrice = (1 + PRICE_GAP / 100) * currentCaAskPrice;
      }
    } else if (refSymbolIndex === 1) {
      if (unitA > unitC / bcPrice) {
        abAskAmount = unitC / bcPrice;
        abAskPrice = (1 + PRICE_GAP / 100) * currentAbAskPrice;
        bcAskAmount = unitC / bcPrice;
        bcAskPrice = (1 + PRICE_GAP / 100) * currentBcAskPrice;
        caBidAmount = unitC;
        caBidPrice = (1 - PRICE_GAP / 100) * currentCaBidPrice;
      } else if (unitA < unitC / bcPrice) {
        abAskAmount = unitA;
        abAskPrice = (1 + PRICE_GAP / 100) * currentAbAskPrice;
        bcAskAmount = unitA;
        bcAskPrice = (1 + PRICE_GAP / 100) * currentBcAskPrice;
        caBidAmount = bcPrice * unitA;
        caBidPrice = (1 - PRICE_GAP / 100) * currentCaBidPrice;
      }
    } else if (refSymbolIndex === 0) {
      if (unitB > unitC * caPrice) {
        abAskAmount = (unitC * caPrice) / abPrice;
        abAskPrice = (1 + PRICE_GAP / 100) * currentAbAskPrice;
        bcBidAmount = (unitC * caPrice) / abPrice;
        bcBidPrice = (1 - PRICE_GAP / 100) * currentBcBidPrice;
        caBidAmount = unitC * caPrice;
        caBidPrice = (1 - PRICE_GAP / 100) * currentCaBidPrice;
      } else if (unitB < unitC * caPrice) {
        abAskAmount = unitB / abPrice;
        abAskPrice = (1 + PRICE_GAP / 100) * currentAbAskPrice;
        bcBidAmount = unitB / abPrice;
        bcBidPrice = (1 - PRICE_GAP / 100) * currentBcBidPrice;
        caBidAmount = unitB / caPrice;
        caBidPrice = (1 - PRICE_GAP / 100) * currentCaBidPrice;
      }
    }
  } else {
    console.log("No luck, please try again.");
  }

  console.log("======");
  console.log("abAskAmount", abAskAmount);
  console.log("abAskPrice", abAskPrice);
  console.log("bcAskAmount", bcAskAmount);
  console.log("bcAskPrice", bcAskPrice);
  console.log("caAskAmount", caAskAmount);
  console.log("caAskPrice", caAskPrice);
  console.log("abBidAmount", abBidAmount);
  console.log("abBidPrice", abBidPrice);
  console.log("bcBidAmount", bcBidAmount);
  console.log("bcBidPrice", bcBidPrice);
  console.log("caBidAmount", caBidAmount);
  console.log("caBidPrice", caBidPrice);
  console.log("======");

  // const bids$ = new Subject();
  // const asks$ = new Subject();

  // Connects WebSocket
  // client.ws.partialDepth(
  //   tradingSymbols.map((ts) => ({ symbol: ts.symbol, level: 5 })),
  //   (depth) => {
  //     console.log("depth", depth);
  //     console.log("-------");
  //   }
  // );
}

run().catch((err) => console.error(err));
