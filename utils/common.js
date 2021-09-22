/* eslint-disable curly */
'use strict';

const constant = require('../utils/constant');
const _ = require('lodash');
const loggerCommon = require('./logger.js');
const logger = loggerCommon.getLogger('db');
const promClient = require('prom-client');
const collectDefaultMetrics = promClient.collectDefaultMetrics;
const register = promClient.register;
collectDefaultMetrics();


// const NodeCache = require("node-cache");
// const utxosCache = new NodeCache();
// const batchCache = new NodeCache();

const mergeUtxoCumulative = function (arr, item) {
  let index = _.findIndex(arr, { 'walletId': item.walletId, 'tokenId': item.tokenId });
  if (index < 0) {
    arr.push(item);
  } else {
    let newO = arr[index];
    newO.amount = _.toString(_.toNumber(arr[index].amount) + _.toNumber(item.amount));
    arr.splice(index, 1, newO);
  }
  return arr;
}

const mergeUtxoReplace = function (arr, item) {
  let index = _.findIndex(arr, { 'walletId': item.walletId, 'tokenId': item.tokenId });
  if (index < 0) {
    arr.push(item);
  } else {
    arr[index] = item;
  }
  return arr;
}

const mergeUnique = function (arr1, arr2) {
  return arr1.concat(arr2.filter(function (item) {
    return arr1.indexOf(item) === -1;
  }));
}

const mergeCumulative = function (arr1, arr2) {

  return arr1.concat(arr2.filter(function (item) {
    return arr1.indexOf(item) === -1;
  }));
}

const setTxState = function (tx, status, actualSTMatched, actualATMatched, reason) {
  tx.ActualSTMatched = actualSTMatched;
  tx.ActualATMatched = actualATMatched;
  tx.Status = status;
  tx.Reason = reason;

  if (status == constant.REJECTED || status == constant.OC_REJECTED){
    // increase counter
    errorRequestCounter.inc();
  }

  return true;
}

const rest = async timeRest => {
  logger.info("rest", timeRest / 1000, "s");
  return new Promise((resolve) => {
    setTimeout(() => {
      logger.info("rest done!");
      resolve("rest");
    }, timeRest);
  });
};

/**
 * Declare prometheus' Histograms and Counters to measure duration metrics when sending the request.
 */
const
  requestCounter = new promClient.Counter({
    name: 'TxService_redis_request_count',
    help: 'Counter of requests'
  }),
  handleTxBatchHistogram = new promClient.Histogram({
    name: 'TxService_handle_tx_batch_duration',
    help: 'Histogram of handle transaction batch total duration',
    labelNames: ['function', 'totalTx']
  }),
  callOnchainHistogram = new promClient.Histogram({
    name: 'TxService_call_onchain_duration',
    help: 'Histogram of call onchain function total duration',
    labelNames: ['channel', 'chaincode', 'function']
  }),
  errorRequestCounter = new promClient.Counter({
    name: 'TxService_reject_request_count',
    help: 'Counter of reject requests'
  });

module.exports = {
  mergeUnique,
  mergeUtxoCumulative,
  mergeUtxoReplace,
  setTxState,
  rest,
  requestCounter,
  handleTxBatchHistogram,
  callOnchainHistogram,
  errorRequestCounter,
  register,
  // utxosCache,
  // batchCache,
};