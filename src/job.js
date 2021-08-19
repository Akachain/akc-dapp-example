"use strict";
require("dotenv").config();

const async = require("async");
const redis = require("redis");
const db = require('./db');
const utxo = require('./utxo');
const { promisify } = require("util");

const sdk = require("./chaincode");
/**
 * Redis Config
 */
const redisClient = redis.createClient({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  no_ready_check: true,
  auth_pass: process.env.REDIS_PASSWORD,
});

//promisify redis client function
const xrangeAsync = promisify(redisClient.xrange).bind(redisClient);

// package request & send to onchain
async function packageAndCommit(messages) {
  const requests = [];
  const listRequestId = [];
  const mintRequest = [];
  const txRequest = [];
  messages.forEach(function (message) {
    // convert the message into a JSON Object
    const id = message[0];
    const values = message[1];

    const msgObject = { reqId: id };
    for (let i = 0; i < values.length; i = i + 2) {
      //validate
      if (
        [
          "FromWallet",
          "ToWallet",
          "FromTokenId",
          "ToTokenId",
          "FromTokenAmount",
          "ToTokenAmount",
          "TxType",
          "Status"
          // "BlockChainId",
          // "Note",
          // "CreatedAt",
          // "UpdatedAt"
        ].includes(values[i])
      ) {
        // create object
        msgObject[values[i]] = values[i + 1];
        switch (msgObject.TxType) {
          case "Mint":
            mintRequest.push(msgObject);
          default:
            txRequest.push(msgObject);
        }
        listRequestId.push(id);
      // } else {
      //   redisClient.xack(
      //     process.env.STREAMS_KEY,
      //     process.env.APPLICATION_ID,
      //     id
      //   );
      }
    }
    await utxo.handleTx(txRequest);
    requests.push(msgObject);
  });

  try {
    const result = await sdk.processRequestChainCode(
      "BuyAssetToken",
      { requests: requests },
      true
    );
    if (result.Result.Status == 200) {
      // XACK those request from PEL
      await redisClient.xack(
        process.env.STREAMS_KEY,
        process.env.APPLICATION_ID,
        ...listRequestId
      );
    }
  } catch (error) {
    console.error(error);
  }
}

// create the group
redisClient.xgroup(
  "CREATE",
  process.env.STREAMS_KEY,
  process.env.APPLICATION_ID,
  "$",
  "MKSTREAM",
  function (err) {
    if (err) {
      if (err.code == "BUSYGROUP") {
        console.log(`Group ${process.env.APPLICATION_ID} already exists`);
      } else {
        console.log(err);
        process.exit();
      }
    }
  }
);

async.forever(
  function (next) {
    // check PEL & process
    redisClient.xpending(
      process.env.STREAMS_KEY,
      process.env.APPLICATION_ID,
      "-",
      "+",
      process.env.REDIS_COUNT,
      async function (errPEL, PEL) {
        if (errPEL) {
          console.error(errPEL);
          next(errPEL);
        }
        if (PEL !== null && PEL.length > 0) {
          // get list Id PEL
          // let pelRecords = [];
          const pelRecords = await async.times(PEL.length, (n, nextPEL) => {
            try {
              console.log(`${Date.now()} PEL[${n}]`);
              console.log(PEL[n]);
              xrangeAsync(process.env.STREAMS_KEY, PEL[n][0], PEL[n][0])
                .then((record) => {
                  console.log(`${Date.now()} record`);
                  console.log(record);
                  if (record.length > 0) {
                    // pelIds.push(e[0]);
                    // pelRecords.push(record[0]);
                    nextPEL("", record[0]);
                  } else {
                    nextPEL("", null);
                  }
                })
                .catch((errRec) => {
                  console.error(errRec);
                  next(errRec);
                });
            } catch (errorAsyncTimes) {
              console.log(errorAsyncTimes);
              next(errorAsyncTimes);
            }
          });
          // async (errIPel, pelRecords) => {
          //   if (errIPel) {
          //     console.error(errIPel);
          //     throw errIPel;
          //   }
          // };
          console.log(`${Date.now()} pelRecords`);
          console.log(pelRecords);
          if (pelRecords.length > 0) {
            await packageAndCommit(pelRecords);
          }
          // PEL.forEach(async (e) => {
          //   console.log(`${Date.now()} e in PEL`);
          //   console.log(e);
          //   await xrangeAsync(process.env.STREAMS_KEY, e[0], e[0])
          //     .then((record) => {
          //       console.log(`${Date.now()} record`);
          //       console.log(record);
          //       if (record.length > 0) {
          //         // pelIds.push(e[0]);
          //         pelRecords.push(record[0]);
          //       }
          //     })
          //     .catch((errRec) => {
          //       console.error(errRec);
          //       next(errRec);
          //     });
          // });

          next();
        } else {
          // if PEL.length = 0 => read next messages
          redisClient.xreadgroup(
            "GROUP",
            process.env.APPLICATION_ID,
            process.env.CONSUMER_ID,
            "COUNT",
            process.env.REDIS_COUNT,
            "STREAMS",
            process.env.STREAMS_KEY,
            ">",
            async function (err, stream) {
              if (err) {
                console.error(err);
                next(err);
              }

              if (stream) {
                await packageAndCommit(stream[0][1]);
              }
              next();
            }
          );
        }
      }
    );
  },
  function (err) {
    console.log(" ERROR " + err);
    process.exit();
  }
);
