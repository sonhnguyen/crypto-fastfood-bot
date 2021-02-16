const fs = require("fs");
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

const express = require("express");
const bodyParser = require("body-parser");
const router = express.Router();
const app = express();
var cors = require("cors");

app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(router);

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

const minimumsJson = fs.readFileSync("minimums.json");
const exchangeInfo = JSON.parse(minimumsJson);

const currentSpikeCoin = async (occurAt) => {
  var symbolMap = { ...SYMBOLS_MAP };

  await Promise.all(
    Object.keys(symbolMap).map((s) => {
      return new Promise(async (resolve, reject) => {
        d = await client.futuresCandles(s, "1m", {
          startTime: occurAt - 15 * 60 * 1000,
          endTime: occurAt,
          limit: 1000,
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

    // Find entry subtring and find entry price
    entry_str = /entry(.*)\n?target/gi.exec(msg)[0];
    entries = entry_str.match(/\d+\.?(\d+)?/g);
    console.log(entries);

    // Find target subtring and find target percentage
    target_str = /target(.*)\n?stop/gi.exec(msg)[0];
    targets = target_str.match(/\d+\.?(\d+)?/g);
    console.log(targets);

    // Find stoploss substrt and find stop percentage
    stop_str = /stoploss:.*\n?-/gi.exec(msg)[0];
    stops = stop_str.match(/\d+\.?(\d+)?/g);
    console.log(stops);

    return {
      side: "Buy",
      position: "Long",
      symbol: symbol,
      levs: levs,
      entries: entries,
      targets: targets,
      stops: stops,
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
      await binanceClient.futuresCancelAll(position.symbol);
      console.log(
        "close position: ",
        position.symbol,
        "size:",
        position.positionAmt
      );
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

    // const takeProfitPrice = new Decimal(entryPrice).mul(
    //   1 + Number(process.env.TAKEPROFIT_PERCENT)
    // );
    // console.log(
    //   await binanceClient.futuresSell(
    //     `${symbol}`,
    //     quantity.toString(),
    //     takeProfitPrice.toFixed(currencyInfo.pricePrecision).toString(),
    //     {
    //       stopPrice: takeProfitPrice
    //         .toFixed(currencyInfo.pricePrecision)
    //         .toString(),
    //       type: "TAKE_PROFIT",
    //     }
    //   )
    // );
    // console.log(
    //   await binanceClient.futuresSell(
    //     `${symbol}`,
    //     quantity.toString(),
    //     stoplossPrice.toFixed(currencyInfo.pricePrecision).toString(),
    //     {
    //       stopPrice: stoplossPrice
    //         .toFixed(currencyInfo.pricePrecision)
    //         .toString(),
    //       type: "STOP",
    //     }
    //   )
    // );
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

router.post("/future-order", async (req, res) => {
  console.log("req.body.message", req.body.message);
  let message;
  if (req.body.message.toLowerCase().includes("are you ready")) {
    const queryTopPossibles = await currentSpikeCoin(Date.now());
    console.log(
      "queryTopPossibles",
      queryTopPossibles.map((e) => `${e.symbol} ${e.changePercent}%`)
    );
    message = {
      symbol: queryTopPossibles[0].symbol,
    };
    console.log(
      "process.env.IS_MULTIPLE_CLIENTS",
      process.env.IS_MULTIPLE_CLIENTS
    );
    if (process.env.IS_MULTIPLE_CLIENTS == "true") {
      for (const binanceClient of binanceAccountClients) {
        await executeTrade(message.symbol, binanceClient);
      }
    } else {
      await executeTrade(message.symbol, client);
    }
  } else if (req.body.message.toLowerCase().includes("cancel all")) {
    if (process.env.IS_MULTIPLE_CLIENTS == "true") {
      for (const binanceClient of binanceAccountClients) {
        await cancelAllOrdersAndPositions(binanceClient);
      }
    } else {
      await cancelAllOrdersAndPositions(client);
    }
  } else if (req.body.message.toLowerCase().includes("buy / long:")) {
    message = parseMesage(req.body.message);
    console.log(
      "process.env.IS_MULTIPLE_CLIENTS",
      process.env.IS_MULTIPLE_CLIENTS
    );
    if (process.env.IS_MULTIPLE_CLIENTS == "true") {
      for (const binanceClient of binanceAccountClients) {
        await executeTrade(message.symbol, binanceClient);
      }
    } else {
      await executeTrade(message.symbol, client);
    }
  } else {
    console.log("unsupported command:", req.body.message);
    res.end("no");
    return;
  }

  res.end("yes");
});

router.post("/ready-msg", async (req, res) => {
  // var occurAt = Number(new Date(2021, 1, 16, 17, 56))
  // var occurAt = Date.now();
  const result = await currentSpikeCoin(occurAt);
  res.json(result.map((e) => `${e.symbol} ${e.changePercent}%`));
});

app.listen(Number(process.env.PORT), async () => {
  // const result = await currentSpikeCoin(Number(new Date(2021, 1, 16, 17, 56)));
  // console.log(result[0].symbol);

  console.log("current spike:", (await currentSpikeCoin(Date.now()))[0].symbol);
  console.log(`Started on PORT ${Number(process.env.PORT)}`);
});
