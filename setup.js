const fs = require("fs");
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

const setupFutures = async function (symbols, binanceClient) {
  for (let symbol of symbols) {
    console.log("setup symbol", symbol);
    try {
      console.log(
        await binanceClient.futuresLeverage(
          symbol,
          Number(process.env.LEVERAGE_DEFAULT)
        )
      );
    } catch (error) {
      console.log(error);
    }
    try {
      await binanceClient.futuresMarginType(symbol, "ISOLATED");
    } catch (error) {
      console.log(error);
    }
  }
  return;
};

const main = async function () {
  if (process.env.IS_MULTIPLE_CLIENTS == "true") {
    for (const binanceClient of binanceAccountClients) {
      await setupFutures(Object.keys(exchangeInfo), binanceClient);
    }
  } else {
    await setupFutures(Object.keys(exchangeInfo), client);
  }
};

main();
