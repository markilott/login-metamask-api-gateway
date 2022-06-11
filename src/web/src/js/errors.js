/* eslint-disable max-classes-per-file */

/**
 * Authorisation error object
 * @param {string} message
 */
export class AuthError extends Error {
    constructor(message, ...params) {
        super(...params);
        this.name = 'AuthError';
        this.message = `Authentication Error: ${message}`;
    }
}

/**
 * Request validation error object
 * @param {string} message
 */
export class ValidationError extends Error {
    constructor(message, ...params) {
        super(...params);
        this.name = 'ValidationError';
        this.message = message;
    }
}
