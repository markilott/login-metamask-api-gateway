const { getUserByWalletId, updateLoginByWalletId } = require('metamask-auth-utils').authUtils;
const { isValidEthSignature } = require('metamask-auth-utils').web3Utils;
const { createAuthToken, createRefreshCookie } = require('metamask-auth-utils').jwtUtils;
const { ValidationError, ApiError } = require('metamask-auth-utils').errors;

const noncePrefix = process.env.LOGIN_PREFIX;

/**
 * Verify the user signature and return login status
 * @param {object} context
 * @param {string} [context.requestId]
 * @param {object} params
 * @param {string} params.walletId
 * @param {string} params.signature
 */
exports.handler = async (event) => {
    console.log('Event: ', JSON.stringify(event));
    const { params = {}, context = {} } = event;
    const { requestId = '' } = context;

    try {
        if (!noncePrefix) { throw new Error('Missing env variable'); }
        const { walletId = '', signature = '' } = params;
        if (!walletId) { throw new ValidationError('Missing walletId'); }
        if (!signature) { throw new ValidationError('Missing signature'); }

        // Get current nonce (verify walletId and user exist)
        const { UserId: userId, Nonce: nonce, Verified: verified = false } = await getUserByWalletId(walletId);
        if (!verified) { throw new ValidationError('User account is not verified'); }

        // Message string
        const message = `${noncePrefix}${nonce}`;

        // Validate signature
        const isValid = await isValidEthSignature({ walletId, message, signature });
        if (!isValid) { throw new ValidationError('Invalid signature, access denied'); }

        // Update current login (creates a fresh nonce for next login or signature request)
        const update = await updateLoginByWalletId(walletId);

        // Generate Auth Token JWT
        const auth = await createAuthToken({ userId });

        // Generate Refresh Token (JWT Cookie)
        const refresh = await createRefreshCookie({ userId });

        // Execute all updates
        const authData = await Promise.all([refresh, auth, update]);

        // Return auth tokens. The cookie token is removed from the body and copied to the cookie header by API Gateway.
        const result = {
            success: true,
            userId,
            authToken: authData[1],
            requestId,
            cookie: authData[0],
        };
        console.log('Returning: ', JSON.stringify(result));

        return result;
    } catch (err) {
        const { message = 'Internal handler Error', statusCode = 500 } = err;
        const returnCode = (statusCode === 400) ? 401 : statusCode;
        console.log('Error caught: ', err);
        throw new ApiError(message, returnCode, requestId);
    }
};
