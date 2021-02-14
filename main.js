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

var parse_msg = function (msg) {
  var side = "";
  var position = "";
  var symbol = "";
  var levs = [];
  var entries = [];
  var targets = [];
  var stops = [];

  // Side is Buy
  // Position is Long
  side_str = /(buy|sell) ?\/ ?(long|short)/gi.exec(msg)[0];
  side = side_str.split("/")[0];
  position = side_str.split("/")[1];

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
};

router.post("/future-order", async (req, res) => {
  console.log("req.body.message", req.body);
  var message = parse_msg(req.body.message);
  console.log("message", message);
  try {
    await client.futuresLeverage({
      symbol: `${message.symbol}USDT`,
      leverage: Number(process.env.LEVERAGE_DEFAULT),
    });
  } catch (error) {
    console.log(error);
  }
  try {
    await client.futuresMarginType({
      symbol: `${message.symbol}USDT`,
      marginType: "ISOLATED",
    });
  } catch (error) {
    console.log(error);
  }

  const exchangeInfo = await client.futuresExchangeInfo(
    `${message.symbol}USDT`
  );
  const currencyInfo = exchangeInfo.symbols.filter(
    (x) => x.symbol === `${message.symbol}USDT`
  )[0];

  const currentPrice = (await client.futuresMarkPrice(`${message.symbol}USDT`))
    .markPrice;

  const balancePerTrade = new Decimal(process.env.USD_PER_TRADE).mul(
    process.env.LEVERAGE_DEFAULT
  );

  const quantity = balancePerTrade
    .div(currentPrice)
    .toFixed(currencyInfo.quantityPrecision);

  try {
    const marketBuyOrder = await client.futuresMarketBuy(
      `${message.symbol}USDT`,
      quantity.toString()
    );

    let entryPrice;
    let position_data = await client.futuresPositionRisk(),
      markets = Object.keys(position_data);
    for (let market of markets) {
      let obj = position_data[market],
        size = Number(obj.positionAmt);
      if (size == 0) continue;
      entryPrice = obj.entryPrice;
    }
    console.log(entryPrice);

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
  } catch (error) {
    console.log(error);
  }
  res.end("yes");
});

app.listen(Number(process.env.PORT), () => {
  console.log(`Started on PORT ${Number(process.env.PORT)}`);
});
