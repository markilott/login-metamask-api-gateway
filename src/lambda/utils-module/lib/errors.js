/* eslint-disable max-classes-per-file */

/**
 * Error object to return to API Gateway
 * @param {string} message
 * @param {integer} [code = 500]
 * @param {string} [requestId]
 * @param {object} [props] - Additional properties if required
 */
class ApiError extends Error {
    constructor(message, code = 500, requestId = 'Error', props = {}) {
        super(message);
        this.name = this.constructor.name;
        const msgObj = {
            success: false,
            statusCode: code,
            message,
            requestId,
            ...props,
        };
        this.message = JSON.stringify(msgObj);
    }
}

/**
 * Validation error object
 * @param {string} message
 */
class ValidationError extends Error {
    constructor(message, ...params) {
        super(...params);
        this.name = 'ValidationError';
        this.message = `Validation Error: ${message}`;
        this.statusCode = 400;
    }
}

module.exports = { ApiError, ValidationError };
