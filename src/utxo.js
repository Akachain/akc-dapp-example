const _ = require('lodash');
const loggerCommon = require('../utils/logger.js');
const logger = loggerCommon.getLogger('db');
const common = require('../utils/common.js');
const message = require('../utils/message.js');
const constant = require('../utils/constant');
const db = require('./db');

function utxoCalculator(utxos, remainUtxos, target) {
    // logger.info(`utxoCalculator - WalletId: ${utxos[0].WalletId}, TokenId: ${utxos[0].TokenId}, Target: ${target}`);
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
                remainUtxo.amount = _.toString(amount - target);
            } else {
                //remove utxo
                utxos.splice(0, 1);
            }
            break;
        }

        //remove utxo
        utxos.splice(0, 1);
    }

    // let remainIndex = _.findIndex(remainUtxos, { 'walletId': remainUtxo.walletId, 'tokenId': remainUtxo.tokenId });
    // if (remainIndex < 0) {
    //     remainUtxos.push(remainUtxo);
    // } else {
    //     remainUtxos[remainIndex] = remainUtxo;
    // }
    remainUtxos = common.mergeUtxoReplace(remainUtxos, remainUtxo);

    return {
        inputs: inputs,
    }
}

// get total utxo amount
async function remainingUtxoAmount(tx) {
    // logger.info(`remainingUtxoAmount - WalletId: ${tx.From}, TokenId: ${tx.TokenId}`);

    //get utxo list
    let key = tx.From + '_' + tx.TokenId;

    //check if utxo is existed in cache
    let utxos = global.utxosCache.get(key);
    if (utxos == undefined) {
        //get utxo list from database
        let utxoList = await db.queryUTXOs(tx.From, tx.TokenId);
        await _.remove(utxoList, function (utxo) {
            return global.usedUtxosIdCache.get(utxo._id) == true;
        });
        let totalUtxo = (utxoList) ? _.sumBy(utxoList, function (o) { return _.toNumber(o.Amount); }) : 0;

        //caching utxos information
        let cache = {
            utxoList,
            totalUtxo
        }
        global.utxosCache.set(key, cache);
        return totalUtxo;
    } else {
        return utxos.totalUtxo;
    }
}

function reCalculationTransfer(outwardTx, returnTx, remainATAmount) {
    // logger.info("reCalculationTransfer");

    //Rate Calculation
    returnTx.ActualMatched = remainATAmount;
    outwardTx.ActualMatched = remainATAmount * (outwardTx.Amount / returnTx.Amount);
    return true;
}

// handle Transaction to utxo's input and output
// transform to onchain's API input.

async function handleTx(txList) {
    // logger.info("handleTx");
    // let inputs = [];
    // let outputs = [];
    let remainUtxos = [];
    let inputs = new Map();
    let outputs = new Map();
    // let remainUtxos = new Map();
    // save remain token amount from utxo in.
    for (const txs of txList) {
        // console.log("txs", txs);

        logger.info("Check Utxo",txs.RequestId," Start");
        if (txs.TransactionType == constant.EXCHANGE || txs.TransactionType == constant.IAO) {
            let outwardTx = txs.Transfer[0];

            // Check outwardTx condition
            if (await remainingUtxoAmount(outwardTx) < outwardTx.Amount) {
                // Reject Tx.
                common.setTxState(txs, constant.REJECTED, 0, 0, message.M1.Message);
                continue;
            }

            // Check returnTx condition
            let returnTx = (txs.Transfer[1]) ? txs.Transfer[1] : null;
            let remainATAmount = await remainingUtxoAmount(returnTx);
            if (remainATAmount <= 0) {
                // Reject Tx.
                common.setTxState(txs, constant.REJECTED, 0, 0, message.M2.Message);
                continue;
            }
            // check if AT amount enough for exchange
            if (remainATAmount < returnTx.Amount) {
                // Re-calculation Transfer.
                await reCalculationTransfer(outwardTx, returnTx, remainATAmount);
                // Tx Partial-Matched - update tx's state
                common.setTxState(txs, constant.PARTIALLY_MATCHED, outwardTx.ActualMatched, returnTx.ActualMatched, message.M0.Message);
            } else {
                // Tx Matched - update tx's state
                outwardTx.ActualMatched = outwardTx.Amount;
                returnTx.ActualMatched = returnTx.Amount;
                common.setTxState(txs, constant.MATCHED, outwardTx.ActualMatched, returnTx.ActualMatched, message.M0.Message);
            }
        } else {
            let transferList = txs.Transfer;
            let isTokenEnough = true;
            for (const tfr of transferList) {
                // Check outwardTx condition
                if (await remainingUtxoAmount(tfr) < tfr.Amount) {
                    // Reject Tx.
                    isTokenEnough = false;
                    break;
                }
            }
            // Tx Matched - update tx's state
            if (isTokenEnough) {
                common.setTxState(txs, constant.MATCHED, 0, 0, message.M0.Message);
            } else {
                common.setTxState(txs, constant.REJECTED, 0, 0, message.M1.Message);
                continue;
            }
        }
        logger.info("Check Utxo",txs.RequestId," End");
        //Handle transaction outward and return
        // await Promise.all(txs.Transfer.map(async (tx) => {

        logger.info("Calculate Utxo",txs.RequestId," Start");
        for (const tx of txs.Transfer) {
            let actualMatched = tx.ActualMatched ? tx.ActualMatched : tx.Amount;
            //create utxo output
            let utxoOut = {
                walletId: tx.To,
                tokenId: tx.TokenId,
                amount: actualMatched.toString(),
            }
            // outputs.push(utxoOut);
            if (outputs[tx.TokenId]) {
                outputs[tx.TokenId] = common.mergeUtxoCumulative(outputs[tx.TokenId], utxoOut);
                // outputs[tx.TokenId].push(utxoOut);
            } else {
                outputs[tx.TokenId] = [utxoOut];
            }

            //get utxo info 
            let key = tx.From + '_' + tx.TokenId;
            let utxos = global.utxosCache.get(key);
            if (utxos == undefined) {
                logger.error("cant not find utxos");

                //Reject tx
                common.setTxState(txs, constant.REJECTED, 0, 0, message.M1.Message);
                return;
            }
            if (utxos && utxos.totalUtxo > 0) {
                //calculate and collect utxos input
                logger.info("utxoCalculator",tx," Start");
                let rsUtxo = await utxoCalculator(utxos.utxoList, remainUtxos, actualMatched);
                logger.info("utxoCalculator",tx," End");

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
                global.utxosCache.set(key, cache);
                let batchExcute = global.batchCache.get(txs.Batch);
                if (!batchExcute || batchExcute == undefined) {
                    global.batchCache.set(txs.Batch, true);
                }
            }

        };
        logger.info("Calculate Utxo",txs.RequestId," End");
    }

    // split Remain Utxos into group by TokenId
    remainUtxos = _.groupBy(_.filter(remainUtxos, function (o) { return _.toNumber(o.amount) > 0; }), "tokenId");
    // console.log("remainUtxos", remainUtxos);

    //transform to Onchain API
    let ocInput = { pairs: [] };
    let inputList = [];
    for (const token in inputs) {
        let pair = {
            tokenId: token,
            inputs: inputs[token],
            //merge output with remainUtxos
            outputs: (remainUtxos[token] && _.toNumber(remainUtxos[token][0].amount) > 0) ? outputs[token].concat(remainUtxos[token]) : outputs[token],
        }
        ocInput.pairs.push(pair);
        inputList = inputList.concat(inputs[token]);
    }
    ocInput.metadata = JSON.stringify(txList);

    // console.log("inputs", inputs);
    // console.log("outputs", outputs);
    // console.log("ocInput", ocInput.pairs[0]);
    // console.log("inputList", inputList);
    return { ocInput, inputList };
}

// handle Mint Transaction to utxo's output
async function handleTxMint(tx) {
    // logger.info("handleTxMint");
    let txMint = tx.Transfer[0];

    //create utxo output
    let mintTx = {
        walletId: txMint.To,
        tokenId: txMint.TokenId,
        amount: txMint.Amount.toString(),
        metadata: JSON.stringify(tx),
    }
    switch (tx.TransactionType) {
        case constant.MINT:
            common.setTxState(tx, constant.MATCHED, txMint.Amount, 0, message.M0.Message);
            break;
        case constant.ISSUE:
            common.setTxState(tx, constant.MATCHED, 0, txMint.Amount, message.M0.Message);
            break;
        default:
            common.setTxState(tx, constant.REJECTED, 0, 0, message.M3.Message);
    }
    tx.Checked = true;
    return mintTx;
}

module.exports = {
    utxoCalculator,
    handleTx,
    handleTxMint,
};