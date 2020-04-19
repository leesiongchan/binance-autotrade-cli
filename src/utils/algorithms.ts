import { BollingerBandsOutput } from "technicalindicators/declarations/volatility/BollingerBands";

import { PRICE_GAP, BB_MODIFIER, PROFIT_MARGIN } from "../constants";

const getPrice = (ask: number, bid: number) => (ask + bid) / 2;

export function findArbitrage({
  bollingerBands,
  balances,
  orderBooks,
  prices,
  refSymbolIndex,
}: {
  balances: number[];
  bollingerBands: BollingerBandsOutput[];
  orderBooks: { ask: number; bid: number }[];
  prices: number[];
  refSymbolIndex: number;
}) {
  const {
    currentAbAskPrice,
    currentAbBidPrice,
    currentAcAskPrice,
    currentAcBidPrice,
    currentCbAskPrice,
    currentCbBidPrice,
    abPrice,
    acPrice,
    cbPrice,
    priceA,
    priceB,
    scenarioA,
    scenarioB,
  } = collectDataForArbitrageCalculation({ orderBooks, prices });

  // dimension check:
  if (abPrice/acPrice/cbPrice > 1.5 || abPrice/acPrice/cbPrice < 0.95)
    throw new Error(" Wrong pairs or pair sequence inserted. please check pairs dimensions.");
    

  const [unitA, unitB, unitC] = balances;

  // check ref symbol > check bollinger % > modify profit ratio > check trade conditions
  const profitRatio = calcProfitRatio([abPrice, acPrice, cbPrice], bollingerBands);

  let abAskAmount: number | null = null;
  let abAskPrice: number | null = null;
  let acAskAmount: number | null = null;
  let acAskPrice: number | null = null;
  let cbAskAmount: number | null = null;
  let cbAskPrice: number | null = null;
  let abBidAmount: number | null = null;
  let abBidPrice: number | null = null;
  let acBidAmount: number | null = null;
  let acBidPrice: number | null = null;
  let cbBidAmount: number | null = null;
  let cbBidPrice: number | null = null;

  let result = true;
  //console.log(scenarioA);
  //console.log(scenarioB);
  //console.log(1+profitRatio);

  console.log(currentAbBidPrice);
  console.log(currentAbAskPrice);

  if (scenarioA < 1 - profitRatio) {
    if (refSymbolIndex === 2) {
      if (unitB / abPrice > unitA) {
        abBidAmount = unitA;
        abBidPrice = (1 - PRICE_GAP / 100) * currentAbBidPrice;
        acAskAmount = unitA;
        acAskPrice = (1 + PRICE_GAP / 100) * currentAcAskPrice;
        cbAskAmount = unitA * acPrice;
        cbAskPrice = (1 + PRICE_GAP / 100) * currentCbAskPrice;
      } else if (unitB / abPrice < unitA) {
        abBidAmount = unitB / abPrice;
        abBidPrice = (1 - PRICE_GAP / 100) * currentAbBidPrice;
        acAskAmount = unitB / abPrice;
        acAskPrice = (1 + PRICE_GAP / 100) * currentAcAskPrice;
        cbAskAmount = (unitB / abPrice) * acPrice;
        cbAskPrice = (1 + PRICE_GAP / 100) * currentCbAskPrice;
      }
    } else if (refSymbolIndex === 1) {
      if (unitB < unitC * cbPrice) {
        abBidAmount = unitB / abPrice;
        abBidPrice = (1 - PRICE_GAP / 100) * currentAbBidPrice;
        cbAskAmount = unitA * acPrice;
        cbAskPrice = (1 + PRICE_GAP / 100) * currentCbAskPrice;
        acAskAmount = unitB / abPrice;
        acAskPrice = (1 + PRICE_GAP / 100) * currentAcAskPrice;
      } else if (unitB > unitC * cbPrice) {
        abBidAmount = (unitC * cbPrice) / abPrice;
        abBidPrice = (1 - PRICE_GAP / 100) * currentAbBidPrice;
        cbAskAmount = unitC;
        cbAskPrice = (1 + PRICE_GAP / 100) * currentCbAskPrice;
        acAskAmount = (unitC * cbPrice) / abPrice;
        acAskPrice = (1 + PRICE_GAP / 100) * currentAcAskPrice;
      }
    } else if (refSymbolIndex === 0) {
      if (unitA * acPrice > unitC) {
        acAskAmount = unitC / acPrice;
        acAskPrice = (1 + PRICE_GAP / 100) * currentAcAskPrice;
        cbAskAmount = unitC;
        cbAskPrice = (1 + PRICE_GAP / 100) * currentCbAskPrice;
        abBidAmount = (unitC * cbPrice) / abPrice;
        abBidPrice = (1 - PRICE_GAP / 100) * currentAbBidPrice;
      } else if (unitA * acPrice < unitC) {
        acAskAmount = unitA;
        acAskPrice = (1 + PRICE_GAP / 100) * currentAcAskPrice;
        cbAskAmount = unitA * acPrice;
        cbAskPrice = (1 + PRICE_GAP / 100) * currentCbAskPrice;
        abBidAmount = unitA;
        abBidPrice = (1 - PRICE_GAP / 100) * currentAbBidPrice;
      }
    }
  } else if (scenarioB > 1 + profitRatio) {
    if (refSymbolIndex === 2) {
      if (unitA > unitC / acPrice) {
        abAskAmount = unitC / acPrice;
        abAskPrice = (1 + PRICE_GAP / 100) * currentAbAskPrice;
        acBidAmount = unitC / acPrice;
        acBidPrice = (1 - PRICE_GAP / 100) * currentAcBidPrice;
        cbBidAmount = unitC;
        cbBidPrice = (1 - PRICE_GAP / 100) * currentCbBidPrice;
      } else if (unitC / acPrice > unitA) {
        abAskAmount = unitA;
        abAskPrice = (1 + PRICE_GAP / 100) * currentAbAskPrice;
        acBidAmount = unitA;
        acBidPrice = (1 - PRICE_GAP / 100) * currentAcBidPrice;
        cbBidAmount = unitA * acPrice;
        cbBidPrice = (1 - PRICE_GAP / 100) * currentCbBidPrice;
      }
    } else if (refSymbolIndex === 1) {
      if (unitB > unitA * abPrice) {
        abAskAmount = unitA;
        abAskPrice = (1 + PRICE_GAP / 100) * currentAbAskPrice;
        cbBidAmount = (unitA * abPrice) / cbPrice;
        cbBidPrice = (1 - PRICE_GAP / 100) * currentCbBidPrice;
        acBidAmount = unitA;
        acBidPrice = (1 - PRICE_GAP / 100) * currentAcBidPrice;
      } else if (unitB < unitA * abPrice) {
        abAskAmount = unitB / abPrice;
        abAskPrice = (1 + PRICE_GAP / 100) * currentAbAskPrice;
        cbBidAmount = unitB / cbPrice;
        cbBidPrice = (1 - PRICE_GAP / 100) * currentCbBidPrice;
        acBidAmount = unitB / abPrice;
        acBidPrice = (1 - PRICE_GAP / 100) * currentAcBidPrice;
      }
    } else if (refSymbolIndex === 0) {
      if (unitC > unitA * acPrice) {
        acBidAmount = unitA;
        acBidPrice = (1 - PRICE_GAP / 100) * currentAcBidPrice;
        cbBidAmount = unitA * acPrice;
        cbBidPrice = (1 - PRICE_GAP / 100) * currentCbBidPrice;
        abAskAmount = unitA;
        abAskPrice = (1 + PRICE_GAP / 100) * currentAbAskPrice;
      } else if (unitC < unitA * acPrice) {
        acBidAmount = unitC / acPrice;
        acBidPrice = (1 - PRICE_GAP / 100) * currentAcBidPrice;
        cbBidAmount = unitC;
        cbBidPrice = (1 - PRICE_GAP / 100) * currentCbBidPrice;
        abAskAmount = unitC / abPrice;
        abAskPrice = (1 + PRICE_GAP / 100) * currentAbAskPrice;
      }
    }
  } else {
    result = false;
  }


  console.log(abAskAmount);

  console.log(acBidAmount);

  console.log(cbBidAmount);

  //console.log(acAskPrice);
  //console.log(cbAskAmount);
  //console.log(cbAskPrice);
  return {
    abAskAmount,
    abAskPrice,
    acAskAmount,
    acAskPrice,
    cbAskAmount,
    cbAskPrice,
    abBidAmount,
    abBidPrice,
    acBidAmount,
    acBidPrice,
    cbBidAmount,
    cbBidPrice,
    result,
  };
}


export function calcBollingerBandsModifier(price: number, bb: BollingerBandsOutput) {
  return 1 + 2 * Math.abs((price - bb.lower) / (bb.upper - bb.lower) - 0.5);
}

export function calcProfitRatio(prices: number[], bollingerBands: BollingerBandsOutput[]) {
  const bbModifier = findBollingerBandsModifier(prices, bollingerBands);
  return (PROFIT_MARGIN / 100) * bbModifier;
}

export function collectDataForArbitrageCalculation({
  orderBooks,
  prices,
}: {
  orderBooks: { ask: number; bid: number }[];
  prices: number[];
}) {
  const currentAbAskPrice = orderBooks[0].ask;
  const currentAbBidPrice = orderBooks[0].bid;
  const currentAcAskPrice = orderBooks[1].ask;
  const currentAcBidPrice = orderBooks[1].bid;
  const currentCbAskPrice = orderBooks[2].ask;
  const currentCbBidPrice = orderBooks[2].bid;

  // const abPrice = getPrice(currentAbAskPrice, currentAbBidPrice);
  // const acPrice = getPrice(currentAcAskPrice, currentAcBidPrice);
  // const cbPrice = getPrice(currentCbAskPrice, currentCbBidPrice);
  const [abPrice, acPrice, cbPrice] = prices;

  const priceA = abPrice;
  const priceB = acPrice * cbPrice;

  const scenarioA = currentAbBidPrice / currentAcAskPrice / currentCbAskPrice;
  const scenarioB = currentAbAskPrice / currentAcBidPrice / currentCbBidPrice;

  return {
    currentAbAskPrice,
    currentAbBidPrice,
    currentAcAskPrice,
    currentAcBidPrice,
    currentCbAskPrice,
    currentCbBidPrice,
    abPrice,
    acPrice,
    cbPrice,
    priceA,
    priceB,
    scenarioA,
    scenarioB,
  };
}

export function findBollingerBandsModifier(
  prices: number[],
  bollingerBands: BollingerBandsOutput[],
) {
  let bbModifier = BB_MODIFIER;
  const abBbModifier = calcBollingerBandsModifier(prices[0], bollingerBands[0]);
  const acBbModifier = calcBollingerBandsModifier(prices[1], bollingerBands[1]);
  const cbBbModifier = calcBollingerBandsModifier(prices[2], bollingerBands[2]);

  if (abBbModifier > acBbModifier && abBbModifier > cbBbModifier) {
    bbModifier = abBbModifier;
  } else if (acBbModifier > abBbModifier && acBbModifier > cbBbModifier) {
    bbModifier = acBbModifier;
  } else if (cbBbModifier > abBbModifier && cbBbModifier > acBbModifier) {
    bbModifier = cbBbModifier;
  } else {
    throw new Error("Bollinger Bands Modifier calculation is invalid.");
  }

  return bbModifier;
}

export function findReferenceSymbol(
  ab: { roc: number; symbol: string },
  bc: { roc: number; symbol: string },
  ca: { roc: number; symbol: string },
): string {
  if (ab.roc < bc.roc && ab.roc < ca.roc) {
    return ab.symbol;
  } else if (bc.roc < ab.roc && bc.roc < ca.roc) {
    return bc.symbol;
  } else if (ca.roc < ab.roc && ca.roc < bc.roc) {
    return ca.symbol;
  }
  throw new Error("Reference symbol cannot be found");
}




