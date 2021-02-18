const fs = require("fs");
const cron = require("node-cron");

var Decimal = require("decimal.js");
require("dotenv").config();
const Binance = require("node-binance-api");
const client = new Binance().options({
  APIKEY: process.env.BINANCE_API_KEY,
  APISECRET: process.env.BINANCE_SECRET_KEY,
});

const binanceKeys = process.env.BINANCE_ACCOUNT_APIS.split(",");
const binanceSecrets = process.env.BINANCE_ACCOUNT_SECRETS.split(",");

const binanceAccountClients = binanceKeys.map((_, index) => {
  return new Binance().options({
    APIKEY: binanceKeys[index],
    APISECRET: binanceSecrets[index],
  });
});

const minimumsJson = fs.readFileSync("minimums.json");
const exchangeInfo = JSON.parse(minimumsJson);

const SYMBOLS_MAP = {
  SOLUSDT: {},
  ICXUSDT: {},
  MATICUSDT: {},
  COMPUSDT: {},
  RENUSDT: {},
  QTUMUSDT: {},
  BZRXUSDT: {},
  ANKRUSDT: {},
  FLMUSDT: {},
  CVCUSDT: {},
  FTMUSDT: {},
  TRBUSDT: {},
  OCEANUSDT: {},
  BATUSDT: {},
  RUNEUSDT: {},
  KNCUSDT: {},
  CHZUSDT: {},
  NEARUSDT: {},
  ZRXUSDT: {},
  AKROUSDT: {},
  TOMOUSDT: {},
  CTKUSDT: {},
  SKLUSDT: {},
  BELUSDT: {},
  SRMUSDT: {},
  AXSUSDT: {},
  STORJUSDT: {},
  RLCUSDT: {},
  BALUSDT: {},
  HNTUSDT: {},
  BLZUSDT: {},
  LRCUSDT: {},
  ENJUSDT: {},
  ZENUSDT: {},
  BTSUSDT: {},
  SANDUSDT: {},
};

const currentSpikeCoin = async (occurAt) => {
  var symbolMap = { ...SYMBOLS_MAP };

  await Promise.all(
    Object.keys(symbolMap).map((s) => {
      return new Promise(async (resolve, reject) => {
        d = await client.futuresCandles(s, "1m", {
          startTime: occurAt - 15 * 60 * 1000,
          endTime: occurAt,
          limit: 1000,
          enableRateLimit: true,
        });
        symbolMap[s].candles = d.map((e) => ({
          openTimeString: new Date(e[0]),
          openTime: e[0],
          open: e[1],
          high: e[2],
          low: e[3],
          close: e[4],
          volume: e[5],
          closeTime: e[6],
          quoteAssetVolume: e[7],
          numberOfTrades: e[8],
          "Taker buy base asset volume": e[9],
          "Taker buy quote asset volume": e[10],
          change: ((Number(e[4]) - Number(e[1])) / Number(e[1])) * 100,
        }));
        symbolMap[s].symbol = s;
        symbolMap[s].firstCandle = symbolMap[s].candles[0];
        symbolMap[s].lastCandle =
          symbolMap[s].candles[symbolMap[s].candles.length - 1];

        symbolMap[s].changePercent =
          ((Number(symbolMap[s].lastCandle.open) -
            Number(symbolMap[s].firstCandle.open)) /
            Number(symbolMap[s].firstCandle.open)) *
          100;
        symbolMap[s].highestChangePercentCandle = Math.max(
          ...symbolMap[s].candles.map((c) => c.change)
        );
        resolve();
      });
    })
  );
  var r = Object.values(symbolMap).sort(
    (a, b) => b.changePercent - a.changePercent
  );
  return r;
};

const parseMesage = function (msg) {
  try {
    var side = "";
    var position = "";
    var symbol = "";
    var levs = [];
    var entries = [];
    var targets = [];
    var stops = [];

    // Side is Buy
    // Position is Long

    side_str = /(buy|sell) ?\/ ?(long|short)/gi.exec(msg);
    if (!side_str) {
      throw new Error("not good message");
    }
    side = side_str[0].split("/")[0];
    position = side_str[0].split("/")[1];

    console.log(side, position);

    symbol = /#([0-9A-Z])\w+/g.exec(msg)[0];
    // Symbol is #BTCUSDT, remove # if needed
    symbol = symbol.split("#")[1] + "USDT";

    console.log("SYMBOL:", symbol);
    // Find substring in parentheses and find x5 x10 substring
    lev_str = /\(.*futures ?\)/gi.exec(msg)[0];
    levs = lev_str.match(/x\d+/g);
    // Leverage is x10 x20, remove "x" if needed
    // lev = lev.split("x")[1];
    console.log(levs);

    return {
      side: "Buy",
      position: "Long",
      symbol: symbol,
      levs: levs,
    };
  } catch (error) {
    throw error;
  }
};

const executeTrade = async (symbol, binanceClient) => {
  console.log("executeTrade", symbol);
  const existedPositions = (await binanceClient.futuresPositionRisk()).filter(
    (x) => x.positionAmt > 0
  );
  for (const position of existedPositions) {
    if (position.symbol != symbol) {
      await binanceClient.futuresMarketSell(
        position.symbol,
        position.positionAmt,
        { reduceOnly: true }
      );
      console.log(
        "close position: ",
        position.symbol,
        "size:",
        position.positionAmt
      );
    } else {
      console.log("existed position:", symbol)
      return;
    }
  }
  const openOrders = await binanceClient.futuresOpenOrders();
  for (const order of openOrders) {
    if (order.symbol != symbol) {
      console.log("close order: ", order.symbol);
      await binanceClient.futuresCancelAll(order.symbol);
    }
  }

  const currencyInfo = exchangeInfo[`${symbol}`];
  const currentPrice = (await binanceClient.futuresMarkPrice(`${symbol}`))
    .markPrice;

  let balancePerTrade;
  if (process.env.IS_ALLIN == "true") {
    const accountBalance = await binanceClient.futuresBalance();
    balancePerTrade =
      Number(accountBalance[0].balance) > 1000
        ? new Decimal(1000).mul(process.env.LEVERAGE_DEFAULT)
        : new Decimal(accountBalance[0].balance)
            .mul(0.93)
            .mul(process.env.LEVERAGE_DEFAULT);
  } else {
    balancePerTrade = new Decimal(process.env.USD_PER_TRADE).mul(
      process.env.LEVERAGE_DEFAULT
    );
  }

  const quantity = balancePerTrade
    .div(currentPrice)
    .toFixed(currencyInfo.quantityPrecision);

  // console.log("await binanceClient.futuresBalance()", await binanceClient.futuresBalance())
  // console.log("await binanceClient.futuresCancelAll()", await binanceClient.futuresBalance())

  try {
    const buyOrder = await binanceClient.futuresMarketBuy(
      `${symbol}`,
      quantity.toString()
    );
    console.log(buyOrder);
    if (buyOrder.msg) {
      throw Error(buyOrder.msg);
    }
    let entryPrice;
    let position_data = await binanceClient.futuresPositionRisk();
    const positionData = position_data.filter(
      (p) => p.symbol == `${symbol}`
    )[0];
    entryPrice = positionData.entryPrice;

    const activationPrice = new Decimal(entryPrice)
      .mul(1 + Number(process.env.TRAILING_ACTIVATION_PRICE))
      .toFixed(currencyInfo.pricePrecision)
      .toString();

    let trailProfit = await binanceClient.futuresOrder(
      "SELL",
      `${symbol}`,
      quantity.toString(),
      false,
      {
        activationPrice,
        type: "TRAILING_STOP_MARKET",
        callbackRate: Number(process.env.TRAILING_CALLBACK_RATE),
        reduceOnly: true,
      }
    );
    console.log(trailProfit);

    const stopPrice = new Decimal(entryPrice)
      .mul(1 - Number(process.env.STOPLOSS_PERCENT))
      .toFixed(currencyInfo.pricePrecision)
      .toString();

    let stopOrder = await binanceClient.futuresOrder(
      "SELL",
      `${symbol}`,
      quantity.toString(),
      false,
      {
        stopPrice,
        type: "STOP_MARKET",
        closePosition: true,
      }
    );
    console.info(stopOrder);

    console.log("entry:", entryPrice);
    console.log("stoploss:", stopPrice);
    console.log("takeProfit trailing activation price:", activationPrice);
  } catch (error) {
    console.log(error);
  }
  return;
};

const cancelAllOrdersAndPositions = async (binanceClient) => {
  const existedPositions = (await binanceClient.futuresPositionRisk()).filter(
    (x) => x.positionAmt > 0
  );
  for (const position of existedPositions) {
    await binanceClient.futuresMarketSell(
      position.symbol,
      position.positionAmt,
      { reduceOnly: true }
    );
  }
  const openOrders = await binanceClient.futuresOpenOrders();
  for (const order of openOrders) {
    await binanceClient.futuresCancelAll(order.symbol);
    console.log("close order: ", order.symbol);
  }
  return;
};

cron.schedule(process.env.CRONJOB, async function () {
  const date = Date.now();
  const results = await currentSpikeCoin(date);
  console.log(
    date,
    results[0].symbol,
    results[1].symbol,
    results[0].changePercent - results[1].changePercent
  );
  if (results[0].changePercent - results[1].changePercent > 0.5) {
    if (process.env.IS_MULTIPLE_CLIENTS == "true") {
      console.log("executeTrade:", results[0].symbol, results[0].changePercent);
      for (const binanceClient of binanceAccountClients) {
        await executeTrade(results[0].symbol, binanceClient);
      }
    } else {
      await executeTrade(results[0].symbol, client);
    }
  }
  console.log("running a task every 10 minute");
});
