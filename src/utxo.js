// var utils = require('./utils')
const _ = require('lodash');
const loggerCommon = require('../utils/logger.js');
const logger = loggerCommon.getLogger('db');
const common = require('../utils/common.js');
const message = require('../utils/message.js');
// const batchCache = require('../utils/globalCache.js');
const constant = require('../utils/constant');
const db = require('./db');

function utxoCalculator(utxos, remainUtxos, target) {
    logger.info(`utxoCalculator - WalletId: ${utxos[0].WalletId}, TokenId: ${utxos[0].TokenId}, Target: ${target}`);
    let amount = 0;
    let remainAmount = 0;
    let inputs = [];
    // let outputs = [];

    // save utxo's state
    let remainUtxo = {
        walletId: utxos[0].WalletId,
        tokenId: utxos[0].TokenId,
        amount: _.toString(remainAmount),
    };

    //do while did not reach the target 
    while (amount < target) {
        let input = utxos[0];
        var inputValue = _.toNumber(input.Amount);
        amount += inputValue;
        inputs.push(input._id);
        // inputs.push(input);
        // go again?
        if (amount >= target) {
            if (amount > target) {
                input.Amount = _.toString(amount - target);
                remainUtxo.Amount = _.toString(amount - target);
            } else {
                //remove utxo
                utxos.splice(0, 1);
            }
            break;
        }

        //remove utxo
        utxos.splice(0, 1);
    }

    let remainIndex = _.findIndex(remainUtxos, { 'WalletId': remainUtxo.WalletId, 'TokenId': remainUtxo.TokenId });
    if (remainIndex < 0) {
        remainUtxos.push(remainUtxo);
    } else {
        remainUtxos[remainIndex] = remainUtxo;
    }

    return {
        inputs: inputs,
    }
}

// get total utxo amount
async function remainingUtxoAmount(tx, utxosCache) {
    logger.info(`remainingUtxoAmount - WalletId: ${tx.From}, TokenId: ${tx.TokenId}`);

    //get utxo list
    let key = tx.From + '_' + tx.TokenId;

    //check if utxo is existed in cache
    let utxos = utxosCache.get(key);
    if (utxos == undefined) {
        //get utxo list from database
        let utxoList = await db.queryUTXOs(tx.From, tx.TokenId);
        let totalUtxo = (utxoList) ? _.sumBy(utxoList, function (o) { return _.toNumber(o.Amount); }) : 0;

        //caching utxos information
        let cache = {
            utxoList,
            totalUtxo
        }
        utxosCache.set(key, cache);
        return totalUtxo;
    } else {
        return utxos.totalUtxo;
    }
}

function reCalculationTransfer(outwardTx, returnTx, remainATAmount) {
    logger.info("reCalculationTransfer");

    //Rate Calculation
    returnTx.ActualMatched = remainATAmount;
    outwardTx.ActualMatched = remainATAmount * (outwardTx.Amount / returnTx.Amount);
    return true;
}

// handle Transaction to utxo's input and output
// transform to onchain's API input.

async function handleTx(txList, utxosCache, batchCache) {
    logger.info("handleTx");
    // let inputs = [];
    // let outputs = [];
    let remainUtxos = [];
    let inputs = new Map();
    let outputs = new Map();
    // let remainUtxos = new Map();
    // save remain token amount from utxo in.
    for (const txs of txList) {
        // console.log("txs", txs);
        let outwardTx = txs.Transfer[0];
        let returnTx = (txs.Transfer[1]) ? txs.Transfer[1] : null;

        // Check outwardTx condition
        if (await remainingUtxoAmount(outwardTx, utxosCache) < outwardTx.Amount) {
            // Reject Tx.
            txs.Status = constant.REJECTED;
            txs.ActualSTMatched = 0;
            txs.ActualATMatched = 0;
            txs.Reason = message.M1.Message;
            continue;
        }

        // Check returnTx condition
        if (txs.TransactionType == constant.EXCHANGE) {
            let remainATAmount = await remainingUtxoAmount(returnTx, utxosCache);
            if (remainATAmount <= 0) {
                // Reject Tx.
                txs.Status = constant.REJECTED;
                txs.ActualSTMatched = 0;
                txs.ActualATMatched = 0;
                txs.Reason = message.M2.Message;
                continue;
            }
            // check if AT amount enough for exchange
            if (remainATAmount < returnTx.Amount) {
                // Re-calculation Transfer.
                await reCalculationTransfer(outwardTx, returnTx, remainATAmount);

                // Tx Partial-Matched - update tx's state
                txs.Status = constant.PARTIALLY_MATCHED;
                txs.ActualSTMatched = outwardTx.ActualMatched;
                txs.ActualATMatched = returnTx.ActualMatched;
                txs.Reason = message.M0.Message;
            } else {
                // Tx Matched - update tx's state
                txs.ActualSTMatched = outwardTx.Amount;
                txs.ActualATMatched = returnTx.Amount;
                outwardTx.ActualMatched = outwardTx.Amount;
                returnTx.ActualMatched = returnTx.Amount;
                txs.Status = constant.MATCHED;
                txs.Reason = message.M0.Message;
            }
        } else {
            // Tx Matched - update tx's state
            txs.ActualSTMatched = outwardTx.Amount;
            txs.ActualATMatched = 0;
            outwardTx.ActualMatched = outwardTx.Amount;
            txs.Status = constant.MATCHED;
            txs.Reason = message.M0.Message;
        }

        //Handle transaction outward and return
        await Promise.all(txs.Transfer.map(async (tx, index) => {
            //create utxo output
            let utxoOut = {
                walletId: tx.To,
                tokenId: tx.TokenId,
                amount: tx.ActualMatched.toString(),
            }
            // outputs.push(utxoOut);
            if (outputs[tx.TokenId]) {
                outputs[tx.TokenId].push(utxoOut);
            } else {
                outputs[tx.TokenId] = [utxoOut];
            }

            //get utxo info 
            let key = tx.From + '_' + tx.TokenId;
            let utxos = utxosCache.get(key);
            if (utxos == undefined) {
                logger.error("cant not find utxos");

                //Reject tx
                txs.Status = constant.REJECTED;
                txs.Reason = message.M1.Message;
                return;
            }
            if (utxos && utxos.totalUtxo > 0) {
                //calculate and collect utxos input
                let rsUtxo = await utxoCalculator(utxos.utxoList, remainUtxos, tx.ActualMatched);

                //merge collection, deduplicate result
                if (inputs[tx.TokenId]) {
                    inputs[tx.TokenId] = common.mergeUnique(inputs[tx.TokenId], rsUtxo.inputs);
                } else {
                    inputs[tx.TokenId] = rsUtxo.inputs;
                }

                // calculate total utxo token amount base on utxos list.
                let totalUtxo = (utxos) ? _.sumBy(utxos.utxoList, function (o) { return _.toNumber(o.Amount); }) : 0;

                // caching utxo's info
                let cache = {
                    utxoList: utxos.utxoList,
                    totalUtxo
                }
                utxosCache.set(key, cache);
                let batchExcute = batchCache.get(txs.Batch);
                if (!batchExcute || batchExcute == undefined) {
                    batchCache.set(txs.Batch, true);
                }
            }

        }));
    }

    // split Remain Utxos into group by TokenId
    remainUtxos = _.groupBy(remainUtxos, "TokenId");

    //transform to Onchain API
    let result = { pairs: [] };
    for (const token in inputs) {
        let pair = {
            tokenId: token,
            inputs: inputs[token],
            //merge output with remainUtxos
            outputs: outputs[token].concat(remainUtxos[token]),
        }
        result.pairs.push(pair);
    }
    result.metadata = JSON.stringify(txList);

    // console.log("inputs", inputs);
    // console.log("outputs", outputs);
    // console.log("result", result);
    return result;
}

// handle Mint Transaction to utxo's output
async function handleTxMint(tx) {
    logger.info("handleTxMint");
    let txMint = tx.Transfer[0];

    //create utxo output
    let mintTx = {
        walletId: txMint.To,
        tokenId: txMint.TokenId,
        amount: txMint.Amount.toString(),
        metadata: JSON.stringify(tx),
    }
    tx.ActualATMatched = tx.Amount;
    tx.Status = constant.MATCHED;
    tx.Checked = true;
    tx.Reason = 'NA';
    return mintTx;
}

module.exports = {
    utxoCalculator,
    handleTx,
    handleTxMint,
};