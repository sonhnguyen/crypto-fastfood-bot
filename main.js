const fs = require("fs");
var Decimal = require("decimal.js");
require("dotenv").config();
const Binance = require("node-binance-api");
const client = new Binance().options({
  APIKEY: process.env.BINANCE_API_KEY,
  APISECRET: process.env.BINANCE_SECRET_KEY,
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

var SYMBOLS = [];
var SYMBOLS_MAP = {};
const minimumsJson = fs.readFileSync("minimums.json");
const exchangeInfo = JSON.parse(minimumsJson);

const binanceImport = function (data) {
  let minimums = {};
  for (let obj of data.symbols) {
    let filters = {
      minNotional: 0.001,
      minQty: 1,
      maxQty: 10000000,
      stepSize: 1,
      minPrice: 0.00000001,
      maxPrice: 100000,
    };
    for (let filter of obj.filters) {
      if (filter.filterType == "MIN_NOTIONAL") {
        filters.minNotional = filter.minNotional;
      } else if (filter.filterType == "PRICE_FILTER") {
        filters.minPrice = filter.minPrice;
        filters.maxPrice = filter.maxPrice;
      } else if (filter.filterType == "LOT_SIZE") {
        filters.minQty = filter.minQty;
        filters.maxQty = filter.maxQty;
        filters.stepSize = filter.stepSize;
        filters.quantityPrecision = obj.quantityPrecision;
        filters.pricePrecision = obj.pricePrecision;
      }
    }
    minimums[obj.symbol] = filters;
  }
  fs.writeFile(
    "minimums.json",
    JSON.stringify(minimums, null, 4),
    function (err) { }
  );
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
    symbol = symbol.split("#")[1];

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

const setupFutures = async function (symbols) {
  for (let symbol of symbols) {
    console.log("setup symbol", symbol);
    try {
      console.log(
        await client.futuresLeverage(
          symbol,
          Number(process.env.LEVERAGE_DEFAULT)
        )
      );
    } catch (error) {
      console.log(error);
    }
    try {
      await client.futuresMarginType(symbol, "ISOLATED");
    } catch (error) {
      console.log(error);
    }
  }
  return;
};

router.post("/future-order", async (req, res) => {
  console.log("req.body.message", req.body);
  let message;
  try {
    message = parseMesage(req.body.message);
    console.log("message incomding:", message);
  } catch (error) {
    console.log("error", error);
    res.end("no");
    return;
  }

  if (!message) {
    res.end("no");
    return;
  }

  // await setupFutures(Object.keys(exchangeInfo));
  const currencyInfo = exchangeInfo[`${message.symbol}USDT`];
  const currentPrice = (await client.futuresMarkPrice(`${message.symbol}USDT`))
    .markPrice;

  const balancePerTrade = new Decimal(process.env.USD_PER_TRADE).mul(
    process.env.LEVERAGE_DEFAULT
  );

  const quantity = balancePerTrade
    .div(currentPrice)
    .toFixed(currencyInfo.quantityPrecision);

  try {
    console.log(
      await client.futuresMarketBuy(
        `${message.symbol}USDT`,
        quantity.toString()
      )
    );
    let entryPrice;
    let position_data = await client.futuresPositionRisk();
    const positionData = position_data.filter(
      (p) => p.symbol == `${message.symbol}USDT`
    )[0];

    const size = Number(positionData.positionAmt);
    if (size == 0) {
      console.log("no position found");
      res.end("yes");
      return;
    }
    entryPrice = positionData.entryPrice;

    const takeProfitPrice = new Decimal(entryPrice).mul(
      1 + Number(process.env.TAKEPROFIT_PERCENT)
    );
    const stoplossPrice = new Decimal(entryPrice).mul(
      1 - Number(process.env.STOPLOSS_PERCENT)
    );
    console.log(
      await client.futuresSell(
        `${message.symbol}USDT`,
        quantity.toString(),
        takeProfitPrice.toFixed(currencyInfo.pricePrecision).toString(),
        {
          stopPrice: takeProfitPrice
            .toFixed(currencyInfo.pricePrecision)
            .toString(),
          type: "TAKE_PROFIT",
        }
      )
    );
    console.log(
      await client.futuresSell(
        `${message.symbol}USDT`,
        quantity.toString(),
        stoplossPrice.toFixed(currencyInfo.pricePrecision).toString(),
        {
          stopPrice: stoplossPrice
            .toFixed(currencyInfo.pricePrecision)
            .toString(),
          type: "STOP",
        }
      )
    );
    console.log("entry:", entryPrice);
    console.log("stoploss:", stoplossPrice);
    console.log("takeProfit:", takeProfitPrice);
  } catch (error) {
    console.log(error);
  }
  res.end("yes");
});

router.post("/ready-msg", async (req, res) => {
  // var occurAt = Number(new Date(2021, 1, 13, 0, 18, 32))
  var occurAt = Date.now()
  var symbolMap = { ...SYMBOLS_MAP }

  await Promise.all(Object.keys(symbolMap).map(s => {

    return new Promise(async (resolve, reject) => {
      d = await client.futuresCandles(s, '1m', {
        startTime: occurAt - 15 * 60 * 1000,
        endTime: occurAt,
        limit: 1000
      });
      symbolMap[s].candles = d.map(e => ({
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
        change: (Number(e[4]) - Number(e[1])) / Number(e[1]) * 100
      }))
      symbolMap[s].symbol = s;
      symbolMap[s].firstCandle = symbolMap[s].candles[0]
      symbolMap[s].lastCandle = symbolMap[s].candles[symbolMap[s].candles.length - 1]

      symbolMap[s].changePercent = (Number(symbolMap[s].lastCandle.open) - Number(symbolMap[s].firstCandle.open)) / Number(symbolMap[s].firstCandle.open) * 100
      symbolMap[s].highestChangePercentCandle = Math.max(...symbolMap[s].candles.map(c => c.change))
      resolve();
    })
  }))
  var r = Object.values(symbolMap).sort((a, b) => b.changePercent - a.changePercent);
  res.json(r)
  res.json(r.map(e => `${e.symbol} ${e.changePercent}%`))
})
app.listen(Number(process.env.PORT), async () => {
  SYMBOLS = (await client.futuresExchangeInfo()).symbols;
  SYMBOLS.forEach(s => {
    SYMBOLS_MAP[s.symbol] = {}
  })
  console.log(`Started on PORT ${Number(process.env.PORT)}`);
});
