'use strict';
const file_path = './tx-handle-Logs/';
const log4js = require('log4js');

log4js.configure({
    appenders: {
        everything: { type: 'dateFile', filename: file_path + 'akc-all.log', pattern: '.yyyy-MM-dd', compress: true },
        emergencies: { type: 'dateFile', filename: file_path + 'akc-error.log', pattern: '.yyyy-MM-dd', compress: true },
        information: { type: 'dateFile', filename: file_path + 'akc-info.log', pattern: '.yyyy-MM-dd', compress: true },
        error: { type: 'logLevelFilter', appender: 'emergencies', level: 'error' },
        info: { type: 'logLevelFilter', appender: 'information', level: 'info' },
        stdout: { type: 'stdout' }/*,
        alerts: {
            type: '@log4js-node/slack',
            token: 'x',
            channel_id: config.SLACK_CHANNEL,
            username: 'anntv',
            level: 'error'
	    }*/
    },
    categories: {
        default: { appenders: ['error', 'info', 'everything', 'stdout'], level: 'debug'},
	    //slack: {   appenders: ['error', 'info', 'everything', 'stdout', 'alerts'], level: 'error'}
    }
});

//const loggerSlack = log4js.getLogger('slack');
//loggerSlack.level = 'error';

const getLogger = function (moduleName) {
    const logger = log4js.getLogger(moduleName);
    logger.level = 'info';
    /*logger.error = (errorLog) => {
        loggerSlack.error(errorLog);
    }*/
    return logger;
};


exports.getLogger = getLogger;
