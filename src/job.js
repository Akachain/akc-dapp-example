"use strict";
require("dotenv").config();

const loggerCommon = require('../utils/logger.js');
const logger = loggerCommon.getLogger('db');
const async = require("async");
const redis = require("redis");
const db = require('./db');
const utxo = require('./utxo');
const NodeCache = require("node-cache");
// const batchCache = require('../utils/globalCache.js');
const utxosCache = new NodeCache();
const batchCache = new NodeCache();
const { promisify } = require("util");
const _ = require('lodash');

const sdk = require("./chaincode");
const constant = require("../utils/constant");
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


//check if merge is possible 
function linked(rqSource, rqTarget) {
  let linked = false;
  rqSource.Transfer.forEach(itemSource => {
    rqTarget.Transfer.forEach(itemTarget => {
      if ((itemSource.From == itemTarget.From) && (itemSource.TokenId == itemTarget.TokenId)) {
        linked = true;
      }
    });
  });
  return linked;
}


// split requests into group
function groupRequest(rqList) {
  let batch = 0;
  let i = 0;

  // using BFS to split requests into batches
  // reference: https://en.wikipedia.org/wiki/Breadth-first_search
  while (i < rqList.length) {
    if (!rqList[i].Checked) {
      rqList[i].Batch = batch;
      rqList[i].Checked = true;
      var searchQ = [];
      searchQ.push(i);
      while (searchQ.length > 0) {
        let txIndex = searchQ[0];
        //dequeue
        searchQ.splice(0, 1);

        for (const index in rqList) {
          // check if merge is possible 
          if (!rqList[index].Checked && linked(rqList[txIndex], rqList[index])) {
            searchQ.push(index);
            rqList[txIndex].Batch = batch;
            rqList[txIndex].Checked = true;
          }
        }
      }
      batch++;
    }
    i++;
  }

  //Group request by batch handle
  let groupRq = _.groupBy(rqList, "Batch");
  return groupRq;
}

//send to onchain
async function callMintOnchain(mintRequests) {
  if (mintRequests.length == 0) {
    return true;
  }
  await Promise.all(mintRequests.map(async (request) => {
    let handledRequests = await utxo.handleTxMint(request);
    if (request.Status != constant.REJECTED) {
      try {
        const result = await sdk.processRequestChainCode(
          "Mint",
          handledRequests,
          true
        );
        if (result.Result.Status !== 200) {
          if (result.Result.Status == 500) {
            throw new Error("Onchain Crash!");
          }
          request.Status = constant.OC_REJECTED;
          request.Reason = result.Message;
        }
      } catch (error) {
        logger.error(error);
        throw new Error("Onchain Crash!");
      }
    }
    // console.log("callMintOnchain-handledRequests", request);
  }));
  return true;
}

//send to onchain
async function callTxOnchain(txRequests) {
  if (txRequests.length == 0) {
    return true;
  }
  let groupRq = await groupRequest(txRequests);
  let groupRqArr = Object.values(groupRq);
  //flush all cache
  await utxosCache.flushAll();;
  await batchCache.flushAll();
  await Promise.all(groupRqArr.map(async (requests) => {
    let handledRequests = await utxo.handleTx(requests, utxosCache, batchCache);
    let batchExcute = batchCache.get(requests[0].Batch);
    if (batchExcute) {
      console.log("batchExcute ", requests[0].Batch);
      try {
        const result = await sdk.processRequestChainCode(
          "Exchange",
          handledRequests,
          true
        );
        if (result.Result.Status !== 200) {
          if (result.Result.Status == 500) {
            throw new Error("Onchain Crash!");
          }
          for (const rq of requests) {
            if (rq.Status != constant.REJECTED) {
              rq.Status = constant.OC_REJECTED;
              rq.Reason = result.Message;
            }
          }
        }
      } catch (error) {
        console.error(error);
      }
    }
  }));

  // console.log("callTxOnchain-txRequests", txRequests);
  return true;
}

// package request & send to onchain
async function packageAndCommit(messages) {
  const listRequestId = [];
  const mintRequest = [];
  const txRequest = [];
  await Promise.all(messages.map(async (message) => {
    // convert the message into a JSON Object
    const id = message[0];
    const values = message[1];
    //validate
    if ("Transaction" == values[0]) {
      // create object
      try {

        let msgObject = JSON.parse(values[1]);
        msgObject.RequestId = id;
        msgObject.Batch = null;
        msgObject.Checked = false;
        msgObject.Status = null;
        msgObject.ActualSTMatched = 0;
        msgObject.ActualATMatched = 0;
        msgObject.Reason = null;

        switch (msgObject.TransactionType) {
          case constant.MINT:
          case constant.ISSUE:
            mintRequest.push(msgObject);
            break;
          case constant.BURN:
          case constant.DEPOSIT:
          case constant.TRANSFER:
          case constant.EXCHANGE:
          case constant.IAO:
            txRequest.push(msgObject);
            break;
          default:
            logger.error("TransactionType does note exist: ", msgObject);
            break;
        }
      } catch (err) {
        logger.error(err);
      }

    }
    listRequestId.push(id);
  }));

  await Promise.all([callMintOnchain(mintRequest), callTxOnchain(txRequest, utxosCache)]);

  console.log("mintRequest", mintRequest);
  console.log("txRequest", txRequest);

  let handledRequestList = mintRequest.concat(txRequest);
  await Promise.all(handledRequestList.map(async (request) => {
    let redisArgs = [];
    let valueJson = JSON.stringify(request);
    redisArgs.push("TransactionAfterOnchain");
    redisArgs.push(valueJson);

    // produce the message
    await redisClient.xadd(
      process.env.STREAMS_KEY_PUB,
      '*',
      ...redisArgs,
      (err) => {
        if (err) {
          logger.error(err);
        }
      },
    );
  }));
  // XACK those request from PEL
  await redisClient.xack(
    process.env.STREAMS_KEY_SUB,
    process.env.APPLICATION_ID,
    ...listRequestId
  );

}

// create the group
redisClient.xgroup(
  "CREATE",
  process.env.STREAMS_KEY_SUB,
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
      process.env.STREAMS_KEY_SUB,
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
              xrangeAsync(process.env.STREAMS_KEY_SUB, PEL[n][0], PEL[n][0])
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
            process.env.STREAMS_KEY_SUB,
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

module.exports = {
  callTxOnchain
};