import { findArbitrage } from "../algorithms";

const abPrice = "7050.0000";
const abBb = {
  middle: 7052.6395,
  upper: 7131.631825317084,
  lower: 6973.647174682917,
  pb: 0.40258863795802236,
};
const abBook = {
  ask: { price: "7051.000000", quantity: "2.39642500" },
  bid: { price: "7049.000000", quantity: "4.00000000" },
};

const acPrice = "7070.000";
const acBb = {
  middle: 7062.5725,
  upper: 7143.950735388831,
  lower: 6981.194264611169,
  pb: 0.3976845595113157,
};
const acBook = {
  ask: { price: "7071.000000", quantity: "2.04049700" },
  bid: { price: "7069.000000", quantity: "2.06322200" },
};

const cbPrice = "0.99900000";
const cbBb = {
  middle: 0.9986099999999999,
  upper: 0.999087074417675,
  lower: 0.9981329255823248,
  pb: 0.9087412629466609,
};
const cbBook = {
  ask: { price: "0.99910000", quantity: "118432.71000000" },
  bid: { price: "0.99890000", quantity: "63697.92000000" },
};

describe("findArbitrage", () => {
  describe("ref pair is AB", () => {
    it("should return the result", async () => {
      const balances = [1.5, 5000, 6000];
      const bollingerBands = [abBb, acBb, cbBb];
      const orderBooks = [
        { ask: Number(abBook.ask.price), bid: Number(abBook.bid.price) },
        { ask: Number(acBook.ask.price), bid: Number(acBook.bid.price) },
        { ask: Number(cbBook.ask.price), bid: Number(cbBook.bid.price) },
      ];
      const prices = [Number(abPrice), Number(acPrice), Number(cbPrice)];
      const refSymbolIndex = 2;

      const { abBidAmount, acAskAmount, cbAskAmount, result }  = findArbitrage({
        balances,
        bollingerBands,
        orderBooks,
        prices,
        refSymbolIndex,
      });
      

      expect(abBidAmount).toBe(0.7092);
      expect(acAskAmount).toBe(0.7092);
      expect(cbAskAmount).toBe(5014.5);
      // And more...
      //expect(result).toBeTruthy();
    });
  });
});
