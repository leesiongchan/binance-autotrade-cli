import { findArbitrage } from "../algorithms";

const abPrices = [
  "7023.99000000",
  "7057.38000000",
  "6982.39000000",
  "7021.97000000",
  "7045.51000000",
  "7004.61000000",
  "7003.11000000",
  "7009.23000000",
  "7070.79000000",
  "7047.53000000",
  "7062.97000000",
  "7152.93000000",
  "7101.94000000",
  "7062.16000000",
  "7107.74000000",
  "7062.30000000",
  "7086.18000000",
  "7045.83000000",
  "7066.98000000",
  "7037.25000000",
];
const abBb = {
  middle: 7052.6395,
  upper: 7131.631825317084,
  lower: 6973.647174682917,
  pb: 0.40258863795802236,
};
const abBook = {
  ask: { price: "7036.62000000", quantity: "2.39642500" },
  bid: { price: "7035.31000000", quantity: "4.00000000" },
};

const acPrices = [
  "7032.06000000",
  "7068.67000000",
  "6991.63000000",
  "7030.44000000",
  "7054.05000000",
  "7013.58000000",
  "7012.68000000",
  "7018.36000000",
  "7081.86000000",
  "7057.56000000",
  "7074.00000000",
  "7167.34000000",
  "7112.49000000",
  "7072.80000000",
  "7120.11000000",
  "7072.92000000",
  "7095.97000000",
  "7053.47000000",
  "7075.54000000",
  "7045.92000000",
];
const acBb = {
  middle: 7062.5725,
  upper: 7143.950735388831,
  lower: 6981.194264611169,
  pb: 0.3976845595113157,
};
const acBook = {
  ask: { price: "7044.47000000", quantity: "0.04049700" },
  bid: { price: "7042.50000000", quantity: "0.06322200" },
};

const cbPrices = [
  "0.99880000",
  "0.99840000",
  "0.99860000",
  "0.99870000",
  "0.99880000",
  "0.99870000",
  "0.99870000",
  "0.99870000",
  "0.99870000",
  "0.99860000",
  "0.99840000",
  "0.99790000",
  "0.99840000",
  "0.99840000",
  "0.99850000",
  "0.99850000",
  "0.99860000",
  "0.99890000",
  "0.99890000",
  "0.99900000",
];
const cbBb = {
  middle: 0.9986099999999999,
  upper: 0.999087074417675,
  lower: 0.9981329255823248,
  pb: 0.9087412629466609,
};
const cbBook = {
  ask: { price: "0.99940000", quantity: "118432.71000000" },
  bid: { price: "0.99850000", quantity: "63697.92000000" },
};

describe("findArbitrage", () => {
  describe("ref pair is AB", () => {
    it("should return the result", async () => {
      const balances = [1, 1, 1];
      const bollingerBands = [abBb, acBb, cbBb];
      const orderBooks = [
        { ask: Number(abBook.ask.price), bid: Number(abBook.ask.price) },
        { ask: Number(acBook.ask.price), bid: Number(acBook.ask.price) },
        { ask: Number(cbBook.ask.price), bid: Number(cbBook.ask.price) },
      ];
      const refSymbolIndex = 0;

      const { abAskAmount, result } = findArbitrage({
        balances,
        bollingerBands,
        orderBooks,
        refSymbolIndex,
      });

      expect(abAskAmount).toBe(1234);
      // And more...
      expect(result).toBeTruthy();
    });
  });
});
