import Binance from "binance-api-node";

if (!process.env.API_KEY || !process.env.API_SECRET) {
  throw new Error("Kindly provide your API_KEY and API_SECRET in order to continue.");
}

const client = Binance({
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET,
});

export default client;
