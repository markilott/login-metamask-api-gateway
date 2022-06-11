// eslint-disable-next-line import/no-extraneous-dependencies
const AWS = require('aws-sdk');
const jwt = require('jsonwebtoken');
const base64url = require('base64url');
const cookie = require('cookie');
const moment = require('moment');
const { ValidationError } = require('./errors');

const kms = new AWS.KMS();

const refreshTime = Number(process.env.REFRESH_TOKEN_TIME);
const authTime = Number(process.env.AUTH_TOKEN_TIME);
const iss = process.env.ISSUER;
const KeyId = process.env.KEY_ID;
let pubKey = '';

/**
 * Create timestamp for expiry time.
 * @param {number} mins - minutes in the future to set the expiry.
 * @returns {number} Unix timestamp
 */
const expTime = (mins) => Number(moment().add(mins, 'm').format('X'));

/**
 * Expired token error object
 */
class TokenExpiredError extends Error {
    constructor(...params) {
        super(...params);
        this.name = 'TokenExpiredError';
        this.message = 'Authentication token has expired';
        this.statusCode = 400;
    }
}

/**
 * Get and set the public key from KMS
 * @returns {Promise<boolean}
 */
async function getPubKey() {
    try {
        if (pubKey) { return true; }
        const rawKey = (await kms.getPublicKey({ KeyId }).promise()).PublicKey;
        pubKey = `
-----BEGIN PUBLIC KEY-----
${rawKey.toString('base64')}
-----END PUBLIC KEY-----`;
        console.log('Retrieved the public key from KMS', pubKey);
        return true;
    } catch (err) {
        err.message = (err.message) || 'Internal getPubKey error';
        throw err;
    }
}

/**
 * Sign a message using KMS Key
 * @param {string} msg
 * @returns {Promise<string>} signed message string
 */
async function signMsg(msg) {
    try {
        const rawSig = (await kms.sign({
            KeyId,
            Message: Buffer.from(msg),
            MessageType: 'RAW',
            SigningAlgorithm: 'RSASSA_PSS_SHA_256',
        }).promise()).Signature;
        const result = rawSig.toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
        console.log('Sig result: ', result);
        return result;
    } catch (err) {
        err.message = (err.message) || 'Internal signMsg error';
        throw err;
    }
}

/**
 * JWT Token Data
 * @typedef {Object} JwtData
 * @property {string} iss - Issuer.
 * @property {string} sub - UserId.
 * @property {boolean} admin - is admin user flag.
 * @property {boolean} refresh - is refresh token flag.
 * @property {[string]} aud - audience
 * @property {number} iat - issued at (Unix timestamp)
 * @property {number} exp - expiry (Unix timestamp)
 */

/**
 * Verify the JWT and return data
 * @param {object} params
 * @param {string} params.token
 * @returns {Promise<{
 * success: boolean,
 * data: JwtData}>} success result and data
 * @throws {TokenExpiredError} on expired token
 * @throws {ValidationError} on invalid token
 */
async function verifyJwt({ token }) {
    try {
        let data = {};
        await getPubKey();
        jwt.verify(token, pubKey, { algorithms: ['PS256'] }, (err, decoded) => {
            if (err) { throw err; }
            console.log('Decode result: ', JSON.stringify(decoded));
            data = { ...decoded };
        });
        return {
            success: true,
            data,
        };
    } catch (err) {
        console.log('verifyJwt err: ', err);
        if (err.name === 'TokenExpiredError') { throw new TokenExpiredError(); }
        if (err.name === 'JsonWebTokenError') { throw new ValidationError(err.message); }
        err.message = (err.message) || 'Internal verifyJwt error';
        throw err;
    }
}

/**
 * Verify the JWT token and check it is not a refresh token. Returns token data.
 * @param {object} params
 * @param {string} params.token
 * @returns {Promise<{
 * success: boolean,
 * data: JwtData}>} success result and data
 * @throws {TokenExpiredError} on expired token
 * @throws {ValidationError} on invalid token
 */
async function validateAuthToken({ token }) {
    try {
        const { data } = await verifyJwt({ token });
        const { refresh } = data;
        if (refresh) { throw new ValidationError('Invalid Auth token'); }
        return {
            success: true,
            data,
        };
    } catch (err) {
        console.log('validateAuthToken err: ', err);
        err.message = (err.message) || 'Internal validateAuthToken error';
        throw err;
    }
}

/**
 * Create a new JWT
 * @param {object} params
 * @param {string} params.userId
 * @param {boolean} [params.isAdmin=false]
 * @param {boolean} [params.isRefresh=false]
 * @returns {Promise<string>} JWT
 */
async function createJwt(params) {
    const { userId = '', isAdmin = false, isRefresh = false } = params;
    try {
        const headers = {
            alg: 'PS256',
            typ: 'JWT',
        };
        const payload = {
            iss,
            sub: userId,
            admin: isAdmin,
            refresh: isRefresh,
            aud: ['nrg'],
            iat: Number(moment().format('X')),
            exp: (isRefresh) ? expTime(refreshTime) : expTime(authTime),
        };
        console.log('Payload: ', JSON.stringify(payload));

        const headerStr = base64url(JSON.stringify(headers));
        const payloadStr = base64url(JSON.stringify(payload));

        const message = Buffer.from(`${headerStr}.${payloadStr}`);
        const signature = await signMsg(message);
        const result = `${headerStr}.${payloadStr}.${signature}`;
        console.log('JWT result: ', result);
        return result;
    } catch (err) {
        err.message = (err.message) || 'Internal createJwt error';
        throw err;
    }
}

/**
 * Create new JWT Refresh token for user
 * @param {object} params
 * @param {string} params.userId
 * @returns {Promise<string>} JWT
 */
async function createRefreshToken({ userId }) {
    try {
        if (!userId) { throw new Error('Missing userId parameter'); }
        return createJwt({ userId, isRefresh: true });
    } catch (err) {
        err.message = (err.message) || 'Internal createRefreshToken error';
        throw err;
    }
}

/**
 * Create new JWT auth token for user
 * @param {object} params
 * @param {string} params.userId
 * @param {boolean} [params.isAdmin = false]
 * @returns {Promise<string>} JWT
 */
async function createAuthToken({
    userId, isAdmin = false,
}) {
    try {
        if (!userId) { throw new Error('Missing userId parameter'); }
        return createJwt({ userId, isAdmin });
    } catch (err) {
        err.message = (err.message) || 'Internal createAuthToken error';
        throw err;
    }
}

/**
 * Create new refresh Cookie for user
 * @param {object} params
 * @param {string} params.userId
 * @returns {Promise<string>} cookie
 */
async function createRefreshCookie({ userId }) {
    try {
        const refreshToken = await createRefreshToken({ userId });
        const cookieStr = cookie.serialize('token', refreshToken, {
            httpOnly: true,
            sameSite: true,
            domain: iss,
            maxAge: refreshTime * 60,
            secure: true,
            path: '/',
        });
        return cookieStr;
    } catch (err) {
        err.message = (err.message) || 'Internal createRefreshCookie error';
        throw err;
    }
}

/**
 * Create new logout Cookie for user
 * @returns {Promise<string>} expired cookie
 */
async function createLogoutCookie() {
    try {
        const cookieStr = cookie.serialize('token', 'logout', {
            httpOnly: true,
            sameSite: true,
            domain: iss,
            maxAge: 0,
            secure: true,
            path: '/',
        });
        return cookieStr;
    } catch (err) {
        err.message = (err.message) || 'Internal createLogoutCookie error';
        throw err;
    }
}

/**
 * Validate the refresh cookie and return userId
 * @param {string} cookieStr
 * @returns {Promise<{
 * success: boolean,
 * userId: string}>} success result and userId
 * @throws {ValidationError} if the cookie is invalid
 * @throws {TokenExpiredError} on expired cookie
 */
async function validateRefreshCookie(cookieStr) {
    try {
        const { token } = cookie.parse(cookieStr);
        if (!token) { throw new ValidationError('Not our cookie'); }
        const { data } = await verifyJwt({ token });
        const { sub: userId, refresh } = data;
        if (!refresh) { throw new ValidationError('Invalid refresh token'); }

        return {
            success: true,
            userId,
        };
    } catch (err) {
        err.message = (err.message) || 'Internal validateRefreshCookie error';
        throw err;
    }
}

module.exports = {
    createAuthToken,
    createRefreshCookie,
    validateRefreshCookie,
    validateAuthToken,
    createLogoutCookie,
};
