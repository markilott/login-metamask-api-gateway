// eslint-disable-next-line import/no-extraneous-dependencies
const AWS = require('aws-sdk');
const moment = require('moment');
const crypto = require('crypto');
const { customAlphabet } = require('nanoid/async'); // Used to create random UserId
const { isValidEthSignature } = require('./web3Utils');
const { ValidationError } = require('./errors');

const docClient = new AWS.DynamoDB.DocumentClient({
    region: process.env.AWS_REGION,
});

const userTbl = process.env.USER_TABLE;
const walletIdx = process.env.WALLET_ID_IDX;

// Users will be deleted on expiry to keep our test table clean. Set to 100yrs by default.
const userExpiry = (Number(process.env.EXPIRE_USERS_IN_DAYS)) || 36500;

// Auth/User Functions ===============================================================================================

/**
 * User Definition
 * @typedef {Object} User
 * @property {string} UserId
 * @property {string} WalletId
 * @property {string} Nonce - the current nonce for the user
 * @property {string} CreatedTime - ISO 8601 Time user was created
 * @property {string} LastLogin - ISO 8601 Time - last time user nonce was updated
 * @property {boolean} Verified - walletId has been verified
 * @property {number} ExpiryTime - expiry (Unix timestamp)
 */

/**
 * Create a cryptographically random nonce for a wallet signature.
 * (Do not use math.random in secure applications)
 * @returns {string} random nonce
 */
function createNonce() {
    const buffer = crypto.randomBytes(16);
    return buffer.toString('hex');
}

/**
 * Create a random UserId
 * @returns {Promise<string>} userId
 */
async function createUserId() {
    const nanoid = await customAlphabet('1234567890ABCDEF', 14);
    return nanoid();
}

/**
 * Get User by UserId
 * @param {string} userId
 * @returns {Promise<User>} User
 */
async function getUserByUserId(userId) {
    try {
        const params = {
            TableName: userTbl,
            KeyConditionExpression: 'UserId = :id',
            ExpressionAttributeValues: {
                ':id': userId,
            },
        };
        const users = (await docClient.query(params).promise()).Items;
        if (!Array.isArray(users) || !users.length) { throw new ValidationError('UserId not found'); }

        return users[0];
    } catch (err) {
        err.message = (err.message) || 'Internal getUserByUserId error';
        throw err;
    }
}

/**
 * Check if UserId exists
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function userIdExists(userId) {
    try {
        await getUserByUserId(userId);
        return true;
    } catch (err) {
        if (err instanceof ValidationError) { return false; }
        err.message = (err.message) || 'Internal userIdExists error';
        throw err;
    }
}

/**
 * Get user from user table by WalletId
 * @param {string} walletId
 * @returns {Promise<User>} User
 */
async function getUserByWalletId(walletId) {
    try {
        const params = {
            TableName: userTbl,
            IndexName: walletIdx,
            KeyConditionExpression: 'WalletId = :id',
            ExpressionAttributeValues: {
                ':id': walletId.toLowerCase(),
            },
        };
        const users = (await docClient.query(params).promise()).Items;
        if (!Array.isArray(users) || !users.length) { throw new ValidationError('We could not find that walletId. Please create a new user.'); }
        if (users.length > 1) { throw new Error('More than one UserId exists for the walletId.'); }

        return users[0];
    } catch (err) {
        err.message = (err.message) || 'Internal getUserByWalletId error';
        throw err;
    }
}

/**
 * Check if user exists by WalletId
 * @param {string} walletId
 * @returns {Promise<boolean>}
 */
async function userExistsByWalletId(walletId) {
    try {
        await getUserByWalletId(walletId);
        return true;
    } catch (err) {
        if (err instanceof ValidationError) { return false; }
        err.message = (err.message) || 'Internal userExistsByWalletId error';
        throw err;
    }
}

/**
 * Get user from user table and return userId
 * @param {string} walletId
 * @returns {Promise<string>} UserId
 */
async function getUserIdByWalletId(walletId) {
    try {
        const { UserId } = await getUserByWalletId(walletId);
        return UserId;
    } catch (err) {
        err.message = (err.message) || 'Internal getUserIdByWalletId error';
        throw err;
    }
}

/**
 * Get user nonce from user table for login
 * @param {string} walletId
 * @returns {Promise<string>} nonce
 */
async function getUserNonceByWalletId(walletId) {
    try {
        const { Nonce } = await getUserByWalletId(walletId);
        return Nonce;
    } catch (err) {
        err.message = (err.message) || 'Internal getUserNonceByWalletId error';
        throw err;
    }
}

/**
 * Update nonce and loginTime after login
 * @param {string} walletId
 * @returns {Promise<{loginTime, nonce}>}
 */
async function updateLoginByWalletId(walletId) {
    try {
        // Get the user by WalletId
        const userId = await getUserIdByWalletId(walletId);

        // Update the nonce and login time
        const nonce = createNonce();
        const loginTime = moment().format();

        // Update the record
        const params = {
            TableName: userTbl,
            Key: { UserId: userId },
            UpdateExpression: 'set LastLogin = :t, Nonce = :n',
            ExpressionAttributeValues: {
                ':t': loginTime,
                ':n': nonce,
            },
            ReturnValues: 'UPDATED_NEW',
        };

        const response = await docClient.update(params).promise();
        const { errorMessage = '' } = response;
        if (errorMessage) { throw new Error(errorMessage); }
        return {
            success: true,
            loginTime,
            nonce,
        };
    } catch (err) {
        err.message = (err.message) || 'Internal updateLoginByWalletId error';
        console.log('updateLoginByWalletId error', err);
        throw err;
    }
}

/**
 * Create user/walletId in table.
 * Will overwrite an existing user if verify signature is included and valid.
 * @param {string} walletId
 * @param {boolean} [verify = false] - verify with the signature
 * @param {string} [signature = ''] - required to update the user as verified
 * @param {string} [signPrefix = ''] - the message prefix used to create the signature
 * @returns {Promise<User>} User
 */
async function createUser({
    walletId, verify = false, signature = '', signPrefix = '',
} = {}) {
    try {
        if (!walletId) { throw new Error('Missing walletId'); }
        if (verify && (!signature || !signPrefix)) { throw new ValidationError('Signature and signPrefix are required to verify a user'); }
        const userExists = await userExistsByWalletId(walletId);
        if (userExists && !verify) { throw new ValidationError('WalletId belongs to an existing user'); }
        if (verify && !userExists) { throw new ValidationError('User does not exist to verify'); }

        // Verify the signature if required
        const message = (verify) ? `${signPrefix}${await getUserNonceByWalletId(walletId)}` : '';
        const verified = (verify && isValidEthSignature({
            walletId,
            signature,
            message,
        }));
        if (verify && !verified) { throw new ValidationError('Signature is not valid - verification failed'); }

        // Set user expiry time = 1 day if user is not verified
        const expiryTime = (verified) ? Number(moment().add(userExpiry, 'd').format('X')) : Number(moment().add(1, 'd').format('X'));

        const nonce = createNonce();
        const userId = (userExists) ? await getUserIdByWalletId(walletId) : await createUserId();
        const params = {
            TableName: userTbl,
            Item: {
                UserId: userId,
                WalletId: walletId.toLowerCase(),
                Verified: verified,
                Nonce: nonce,
                CreatedTime: moment().toISOString(),
                LastLogin: moment().toISOString(),
                ExpiryTime: expiryTime,
            },
        };

        const response = await docClient.put(params).promise();
        const { errorMessage = '' } = response;
        if (errorMessage) { throw new Error(errorMessage); }
        return {
            success: true,
            userId,
            walletId: walletId.toLowerCase(),
            nonce,
        };
    } catch (err) {
        err.message = (err.message) || 'Internal createUser error';
        console.log('createUser error', err);
        throw err;
    }
}

module.exports = {
    createUser,
    getUserByWalletId,
    getUserByUserId,
    getUserIdByWalletId,
    getUserNonceByWalletId,
    updateLoginByWalletId,
    userIdExists,
    userExistsByWalletId,
};
