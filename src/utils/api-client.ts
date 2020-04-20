import Binance, { Binance as BinanceType } from "binance-api-node";

if (!process.env.API_KEY || !process.env.API_SECRET) {
  throw new Error("Kindly provide your API_KEY and API_SECRET in order to continue.");
}

interface ExtendedBinance extends BinanceType {
  marginAccountInfo: BinanceType["accountInfo"];
  marginAllOrders: BinanceType["allOrders"];
  marginOrder: BinanceType["order"];
}

const client = Binance({
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET,
}) as ExtendedBinance;

export default client;
