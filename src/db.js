/* eslint-disable curly */
'use strict';

const { reject } = require('async');
const mysql = require('mysql');
const format = require('pg-format');
const loggerCommon = require('../utils/logger.js');
const logger = loggerCommon.getLogger('db');

require("dotenv").config();
const connectionPool = mysql.createPool({
    connectionLimit: 1,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
});

const getConnection = async function () {

    connectionPool.query('SELECT 1 + 1 AS solution', function (error, results, fields) {
        if (error) throw error;
        logger.info('connection pool is ok, ', results[0].solution);
    });

};

const queryUTXOs = async (walletId, tokenId) => {
    try {
        let query = format(`SELECT * FROM OC_Utxo WHERE WalletId = '%s' and TokenId = '%s' and Status = 0 ORDER BY CreatedAt;`, walletId, tokenId);
        // logger.info('queryUTXO ', query);
        // return connectionPool.query(query).promise();

        return new Promise((resolve, reject) => {
            connectionPool.query(query, function (error, results, fields) {
                if (error) return reject(error);
                var string = JSON.stringify(results);
                var json = JSON.parse(string);
                return resolve(json);
            });
        })

    } catch (err) {
        logger.error(err);
    }
}

const getConnectionPool = function () {
    return connectionPool;
}

module.exports = {
    getConnection,
    getConnectionPool,
    queryUTXOs,
};