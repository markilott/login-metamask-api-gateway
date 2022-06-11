const { getUserByWalletId } = require('metamask-auth-utils').authUtils;
const { ValidationError, ApiError } = require('metamask-auth-utils').errors;

const signPrefix = process.env.SIGN_PREFIX;
const loginPrefix = process.env.LOGIN_PREFIX;

/**
 * Get a user and return the nonce if user exists.
 * Returns a nonce with a prefix based on the type requested - login or signature.
 * @param {object} params
 * @param {string} params.walletId
 * @param {string} [params.login = 'false'] - default is a sign request
 * @param {object} context
 * @param {string} [context.requestId]
 * @param {object} params
 */
exports.handler = async (event) => {
    console.log('Event: ', JSON.stringify(event));
    const { params = {}, context = {} } = event;
    const { requestId = '' } = context;

    try {
        const { walletId = '', login = '' } = params;
        const isLogin = (login === 'true');
        if (!walletId) { throw new ValidationError('Missing walletId'); }

        // Get the User from Db
        const user = await getUserByWalletId(walletId);
        const { Nonce, UserId, Verified } = user;

        // Return nonce with relevant detail
        return {
            success: true,
            isLogin,
            nonce: (isLogin) ? `${loginPrefix}${Nonce}` : `${signPrefix}${Nonce}`,
            userId: UserId,
            verified: Verified,
        };
    } catch (err) {
        const { message = 'Internal handler Error', statusCode = 500 } = err;
        console.log('Error caught: ', err);
        throw new ApiError(message, statusCode, requestId);
    }
};
