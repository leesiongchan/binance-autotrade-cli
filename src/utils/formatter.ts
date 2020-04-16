import { Symbol } from "binance-api-node";
import { addMinutes, format as formatDate } from "date-fns/fp";
import { pipe as _pipe } from "lodash/fp";

export const formatSymbol = (s: Symbol) => `${s.baseAsset}/${s.quoteAsset}`;
export const formatTime = (t: number) => _pipe(addMinutes(1), formatDate("HH:mm"))(t);
export const formatNumber = (n: number | string) =>
  (typeof n === "number" ? n.toString() : n).slice(0, 7);
