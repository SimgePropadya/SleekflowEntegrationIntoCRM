// Merkezi logging utility

const { NODE_ENV } = require('../config/constants');

const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
};

const CURRENT_LOG_LEVEL = NODE_ENV === 'production' ? LOG_LEVELS.INFO : LOG_LEVELS.DEBUG;

function log(level, message, data = null) {
    if (level < CURRENT_LOG_LEVEL) return;
    
    const timestamp = new Date().toISOString();
    const prefix = {
        [LOG_LEVELS.DEBUG]: '🔍',
        [LOG_LEVELS.INFO]: 'ℹ️',
        [LOG_LEVELS.WARN]: '⚠️',
        [LOG_LEVELS.ERROR]: '❌'
    }[level] || '📝';
    
    console.log(`${prefix} [${timestamp}] ${message}`);
    if (data) {
        console.log('   Data:', typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
    }
}

const logger = {
    debug: (message, data) => log(LOG_LEVELS.DEBUG, message, data),
    info: (message, data) => log(LOG_LEVELS.INFO, message, data),
    warn: (message, data) => log(LOG_LEVELS.WARN, message, data),
    error: (message, data) => log(LOG_LEVELS.ERROR, message, data)
};

module.exports = logger;

