import { Symbol } from "binance-api-node";
import { format } from "date-fns/fp";

export const formatSymbol = (s: Symbol) => `${s.baseAsset}/${s.quoteAsset}`;
export const formatDate = (t: number) => format("yyyyMMddHH")(t);
export const formatNumber = (n: number | string) =>
  (typeof n === "number" ? n.toString() : n).slice(0, 7);
export const formatArbitrageItem = (
  item: {
    ask: { quantity: number | null; price: number | null };
    bid: { quantity: number | null; price: number | null };
  },
  type: "quantity" | "price",
) => `${formatNumber(item.ask[type] ?? "N/A")} | ${formatNumber(item.bid[type] || "N/A")}`;
