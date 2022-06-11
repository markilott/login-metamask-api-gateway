const { getUserByWalletId } = require('metamask-auth-utils').authUtils;
const { ValidationError, ApiError } = require('metamask-auth-utils').errors;

/**
 * Get a user and return the userId if user exists.
 * @param {object} params
 * @param {string} params.walletId
 * @param {object} context
 * @param {string} [context.requestId]
 *
 */
exports.handler = async (event) => {
    console.log('Event: ', JSON.stringify(event));
    const { params = {}, context = {} } = event;
    const { requestId = '' } = context;

    try {
        const { walletId = '' } = params;
        if (!walletId) { throw new ValidationError('Missing walletId'); }

        // Get the user from Db
        const { UserId = '', Verified = false } = await getUserByWalletId(walletId);

        // Return the User details
        return {
            success: true,
            walletId,
            userId: UserId,
            requestId,
            verified: Verified,
        };
    } catch (err) {
        const { message = 'Internal handler Error', statusCode = 500 } = err;
        console.log('Error caught: ', err);
        throw new ApiError(message, statusCode, requestId);
    }
};
