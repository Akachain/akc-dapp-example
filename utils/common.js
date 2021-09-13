/* eslint-disable curly */
'use strict';

const _ = require('lodash');
const loggerCommon = require('./logger.js');
const logger = loggerCommon.getLogger('db');

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

const setTxState = function (tx, status, actualSTMatched, actualATMatched, reason) {
  tx.ActualSTMatched = actualSTMatched;
  tx.ActualATMatched = actualATMatched;
  tx.Status = status;
  tx.Reason = reason;
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

module.exports = {
  mergeUnique,
  mergeUtxoCumulative,
  mergeUtxoReplace,
  setTxState,
  rest,
  // utxosCache,
  // batchCache,
};