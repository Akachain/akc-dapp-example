"use strict";
require("dotenv").config();

const express = require("express");
const app = express();
const loggerCommon = require('../utils/logger.js');
const logger = loggerCommon.getLogger('db');
const async = require("async");
const redis = require("redis");
const db = require('./db');
const utxo = require('./utxo');
const NodeCache = require("node-cache");

global.utxosCache = new NodeCache();
global.usedUtxosIdCache = new NodeCache({ stdTTL: 120 });
global.batchCache = new NodeCache();
const { promisify } = require("util");
const _ = require('lodash');
const message = require('../utils/message.js');
const common = require('../utils/common.js');

const sdk = require("./chaincode");
const constant = require("../utils/constant");

/**
 * Express Server
 */
app.get("/metrics", async (req, res) => {
  try {
    res.set("Content-Type", common.register.contentType);
    res.end(await common.register.metrics());
  } catch (ex) {
    res.status(500).end(ex);
  }
});

app.get("/metrics/counter", async (req, res) => {
  try {
    res.set("Content-Type", common.register.contentType);
    res.end(await common.register.getSingleMetricAsString("test_counter"));
  } catch (ex) {
    res.status(500).end(ex);
  }
});

app.listen(process.env.PORT, () => {
  console.log(`App listening at port ${process.env.PORT}`);
});


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
  // rqSource.Transfer.every(itemSource => {
  for (const itemSource of rqSource.Transfer) {
    if (linked) { break; }
    // rqTarget.Transfer.every(itemTarget => {
    for (const itemTarget of rqTarget.Transfer) {
      if (linked) { break; }
      if ((itemSource.From == itemTarget.From) && (itemSource.TokenId == itemTarget.TokenId)) {
        linked = true;
        break;
      }
    }
  }
  //   });
  // });
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
        rqList[txIndex].Batch = batch;
        rqList[txIndex].Checked = true;
        searchQ.splice(0, 1);
        for (const index in rqList) {
          // check if merge is possible 
          if (!rqList[index].Checked && (searchQ.indexOf(index) < 0) && linked(rqList[txIndex], rqList[index])) {
            searchQ.push(index);
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
        // start timer send transaction
        let callOnchainHistogramTimer = common.callOnchainHistogram.startTimer();

        const result = await sdk.processRequestChainCode(
          constant.MINT,
          handledRequests,
          true
        );

        // end handle tx batch timer
        callOnchainHistogramTimer({
          channel: process.env.CHANNEL_NAME,
          chaincode: process.env.CHAINCODE_ID,
          function: constant.MINT
        });

        let status = (result && result.Result.Status) ? result.Result.Status : constant.NETWORK_PROBLEM;
        let returnMessage = (result && result.Message) ? result.Message : message.M999.Message;

        if (status !== constant.SUCCESS) {
          let reason = (status == constant.NETWORK_PROBLEM) ? message.M999.Message : returnMessage;

          common.setTxState(request, constant.OC_REJECTED, 0, 0, reason);

          if (status == constant.NETWORK_PROBLEM) {
            throw new Error(message.M999.Message);
          }
        }
      } catch (error) {
        throw error;
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
  logger.info("Group Request Start");
  let groupRq = await groupRequest(txRequests);
  let groupRqArr = Object.values(groupRq);
  logger.info("Group Request End");
  //flush all cache
  await global.utxosCache.flushAll();
  await global.batchCache.flushAll();
  logger.info("Handle Txs START");
  await Promise.all(groupRqArr.map(async (requests) => {
    let handledRequests = await utxo.handleTx(requests);
    let batchExcute = global.batchCache.get(requests[0].Batch);
    if (batchExcute) {
      logger.info("batchExcute ", requests[0].Batch);
      // console.log("handledRequests ", handledRequests);
      try {
        logger.info("Call OC START");
        // start timer send transaction
        let callOnchainHistogramTimer = common.callOnchainHistogram.startTimer();

        const result = await sdk.processRequestChainCode(
          constant.EXCHANGE,
          handledRequests.ocInput,
          true
        );

        // end handle tx batch timer
        callOnchainHistogramTimer({
          channel: process.env.CHANNEL_NAME,
          chaincode: process.env.CHAINCODE_ID,
          function: constant.EXCHANGE
        });

        let status = (result && result.Result.Status) ? result.Result.Status : constant.NETWORK_PROBLEM;
        let returnMessage = (result && result.Message) ? result.Message : message.M999.Message;

        if (status !== constant.SUCCESS) {
          let reason = (status == constant.NETWORK_PROBLEM) ? message.M999.Message : returnMessage;

          for (const rq of requests) {
            if (rq.Status != constant.REJECTED) {
              common.setTxState(rq, constant.OC_REJECTED, 0, 0, reason);
            }
          }

          if (status == constant.NETWORK_PROBLEM) {
            throw new Error(message.M999.Message);
          }
        } else {
          handledRequests.inputList.map(input => {
            global.usedUtxosIdCache.set(input, true);
          });
        }
        logger.info("Call OC END");
      } catch (error) {
        throw error;
      }
    }
  }));
  logger.info("Handle Txs END");

  // console.log("callTxOnchain-txRequests", txRequests);
  return true;
}

// package request & send to onchain
async function packageAndCommit(messages) {
  // start timer send transaction
  let handleTxBatchHistogramTimer = common.handleTxBatchHistogram.startTimer();

  logger.info(`Handle from redis START`);
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
          case constant.TOPUP:
          case constant.DEPOSIT:
          case constant.TRANSFER:
          case constant.EXCHANGE:
          case constant.IAO:
          case constant.SECONDARYTX:
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
  logger.info(`Handle from redis END`);

  logger.info(`Handle request START`);
  logger.info(`Request's amount`, listRequestId.length);

  await Promise.all([callMintOnchain(mintRequest), callTxOnchain(txRequest)]);

  logger.info(`Handle request END`);

  // console.log("mintRequest", mintRequest);
  // console.log("txRequest", txRequest);

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

  //
  //TODO------------------
  // Handle handledRequestList when Transaction-handle-service crash before xack request -> handle double request from redis. 
  //---------------------

  // XACK those request from PEL
  await redisClient.xack(
    process.env.STREAMS_KEY_SUB,
    process.env.APPLICATION_ID,
    ...listRequestId
  );

  // increase counter
  common.requestCounter.inc(listRequestId.length);
  common.requestGauge.dec(listRequestId.length);
  
  // end handle tx batch timer
  handleTxBatchHistogramTimer({
    function: "handleTxBatch",
    // totalTx: listRequestId.length
  });

  await common.rest(process.env.NORMRESTTIME);
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
              // console.log(`${Date.now()} PEL[${n}]`);
              // console.log(PEL[n]);
              xrangeAsync(process.env.STREAMS_KEY_SUB, PEL[n][0], PEL[n][0])
                .then((record) => {
                  // console.log(`${Date.now()} record`);
                  // console.log(record);
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
          // console.log(`${Date.now()} pelRecords`);
          // console.log(pelRecords);
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
                common.requestGauge.inc(Number(stream[0][1].length));
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
  callTxOnchain,
  callMintOnchain
};