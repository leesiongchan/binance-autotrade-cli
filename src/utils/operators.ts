import { bollingerbands as findBollingerBands, roc as findRoc } from "technicalindicators";
import { map, scan } from "rxjs/operators";
import { pipe } from "rxjs";

import { TradingCandle } from "../interface";
import { BB_PERIOD, ROC_PERIOD } from "../constants";

export const bollingerBands = () =>
  pipe(
    scan<TradingCandle, TradingCandle[]>((candles, candle) => candles.concat(candle), []),
    map((candles) => candles.slice(-BB_PERIOD * 5)),
    map((candles) =>
      findBollingerBands({
        values: candles.map((c) => Number(c.close)),
        period: BB_PERIOD,
        stdDev: 2,
      }),
    ),
  );

export const roc = () =>
  pipe(
    scan<TradingCandle, TradingCandle[]>((candles, candle) => candles.concat(candle), []),
    map((candles) => candles.slice(-ROC_PERIOD * 5)),
    map((candles) => findRoc({ values: candles.map((c) => Number(c.close)), period: ROC_PERIOD })),
  );
