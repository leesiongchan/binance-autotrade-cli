import { bollingerbands as findBollingerBands, roc as findRoc } from "technicalindicators";
import { last as _last } from "lodash/fp";
import { map, scan } from "rxjs/operators";
import { pipe } from "rxjs";

import { TradingCandle } from "../interface";
import { BB_PERIOD, ROC_PERIOD } from "../constants";
import { formatDate } from "./formatter";

const updateValuesBasedOnTime = <T extends any>(arr: T[], val: T, keyToCompare: string): T[] => {
  // 1. empty array    -> append
  // 2. different hour -> append
  // 3. same hour      -> replace last value
  if (arr.length === 0 || formatDate(val[keyToCompare]) !== formatDate(_last(arr)![keyToCompare])) {
    arr.push(val);
  } else {
    arr[arr.length - 1] = val;
  }
  return arr;
};

export const bollingerBands = () =>
  pipe(
    scan<TradingCandle, TradingCandle[]>(
      (candles, candle) => updateValuesBasedOnTime(candles, candle, "closeTime"),
      [],
    ),
    map((candles) => candles.slice(-BB_PERIOD * 3)),
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
    scan<TradingCandle, TradingCandle[]>(
      (candles, candle) => updateValuesBasedOnTime(candles, candle, "closeTime"),
      [],
    ),
    map((candles) => candles.slice(-ROC_PERIOD * 3)),
    map((candles) => findRoc({ values: candles.map((c) => Number(c.close)), period: ROC_PERIOD })),
  );
