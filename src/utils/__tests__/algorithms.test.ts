import { findArbitrage } from "../algorithms";

const abPrice = "7037.25000000";
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

const acPrice = "7045.92000000";
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

const cbPrice = "0.99900000";
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
      const prices = [Number(abPrice), Number(acPrice), Number(cbPrice)];
      const refSymbolIndex = 0;

      const { abAskAmount, result } = findArbitrage({
        balances,
        bollingerBands,
        orderBooks,
        prices,
        refSymbolIndex,
      });

      expect(abAskAmount).toBe(1234);
      // And more...
      expect(result).toBeTruthy();
    });
  });
});
