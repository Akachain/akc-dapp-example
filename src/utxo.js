// var utils = require('./utils')
const { result } = require('lodash');
const _ = require('lodash');
const loggerCommon = require('../utils/logger.js');
const logger = loggerCommon.getLogger('db');
const common = require('../utils/common.js');
const message = require('../utils/message.js');
const NodeCache = require("node-cache");
const utxosCache = new NodeCache();
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
        WalletId: utxos[0].WalletId,
        TokenId: utxos[0].TokenId,
        Amount: _.toString(remainAmount),
    };

    //do while did not reach the target 
    while (amount < target) {
        let input = utxos[0];
        var inputValue = _.toNumber(input.Amount);
        amount += inputValue;
        inputs.push(input);
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

// get total utxo amount
async function remainingUtxoAmount(tx) {
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

async function handleTx(txList) {
    logger.info("handleTx");
    let inputs = [];
    let outputs = [];
    // save remain token amount from utxo in.
    let remainUtxos = [];
    for (const txs of txList) {
        let outwardTx = txs.Transfer[0];
        let returnTx = (txs.Transfer[1]) ? txs.Transfer[1] : null;

        // Check outwardTx condition
        if (await remainingUtxoAmount(outwardTx) < outwardTx.Amount) {
            // Reject Tx.
            txs.Status = constant.REJECTED;
            txs.ActualSTMatched = 0;
            txs.ActualATMatched = 0;
            txs.Reason = message.M1.Message;
            continue;
        }

        // Check returnTx condition
        if (txs.Transaction_Type == constant.EXCHANGE) {
            let remainATAmount = await remainingUtxoAmount(returnTx);

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
                WalletId: tx.To,
                TokenId: tx.TokenId,
                Amount: tx.ActualMatched.toString(),
            }
            outputs.push(utxoOut);

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
                inputs = common.mergeUnique(inputs, rsUtxo.inputs);

                // calculate total utxo token amount base on utxos list.
                let totalUtxo = (utxos) ? _.sumBy(utxos.utxoList, function (o) { return _.toNumber(o.Amount); }) : 0;

                // caching utxo's info
                let cache = {
                    utxoList: utxos.utxoList,
                    totalUtxo
                }
                utxosCache.set(key, cache);
            }

        }));
    }

    //merge output with remainUtxos
    outputs = outputs.concat(_.filter(remainUtxos, function (o) { return o.Amount != 0; }));

    // transform to onchain's API input.
    let resultOutputs = _.groupBy(outputs, 'TokenId');
    let resultInputs = _.mapValues(_.groupBy(inputs, 'TokenId'),
        inputs => inputs.map(inp => _.values(_.pick(inp, 'Id'))));
    let result = { pairs: [] };
    for (const token in resultInputs) {
        resultInputs[token] = _.flatten(resultInputs[token]);
        let pair = {
            tokenId: token,
            inputs: resultInputs[token],
            outputs: resultOutputs[token],

        }
        result.pairs.push(pair);
    }
    result.metadata = JSON.stringify(txList);

    // console.log("resultInputs", resultInputs);
    // console.log("resultOutputs", resultOutputs);
    return result;
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

    const rs = _.forEach(groupRq, async (item) => {
        let rsHandle = await handleTx(item);
        console.log("rsHandle", rsHandle);
        console.log("txList", item);
    });
    return groupRq;
}
module.exports = {
    utxoCalculator,
    handleTx,
    groupRequest,
};