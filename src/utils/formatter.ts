import { Symbol } from "binance-api-node";
import { format } from "date-fns/fp";

export const formatSymbol = (s: Symbol) => `${s.baseAsset}/${s.quoteAsset}`;
export const formatDate = (t: number) => format("yyyyMMddHH")(t);
export const formatNumber = (n: number | string) =>
  (typeof n === "number" ? n.toString() : n).slice(0, 7);
