/* eslint-disable curly */
'use strict';

const loggerCommon = require('./logger.js');
const logger = loggerCommon.getLogger('db');

// const NodeCache = require("node-cache");
// const utxosCache = new NodeCache();
// const batchCache = new NodeCache();

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
    logger.debug("rest", timeRest / 1000, "s");
    return new Promise((resolve) => {
      setTimeout(() => {
        logger.debug("rest done!");
        resolve("rest");
      }, timeRest);
    });
  };

module.exports = {
    mergeUnique,
    setTxState,
    rest,
    // utxosCache,
    // batchCache,
};