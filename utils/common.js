/* eslint-disable curly */
'use strict';

const loggerCommon = require('./logger.js');
const logger = loggerCommon.getLogger('db');

const mergeUnique = function(arr1, arr2){
    return arr1.concat(arr2.filter(function (item) {
        return arr1.indexOf(item) === -1;
    }));
}

module.exports = {
    mergeUnique,
};