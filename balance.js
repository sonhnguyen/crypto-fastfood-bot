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

const main = async function () {
  if (process.env.IS_MULTIPLE_CLIENTS == "true") {
    for (const binanceClient of binanceAccountClients) {
      console.log(await binanceClient.futuresBalance());
    }
  } else {
    console.log(await client.futuresBalance());
  }
};

main();
