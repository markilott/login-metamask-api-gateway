const { createUser } = require('metamask-auth-utils').authUtils;
const { isValidEthAddress } = require('metamask-auth-utils').web3Utils;
const { ValidationError, ApiError } = require('metamask-auth-utils').errors;

const signPrefix = process.env.SIGN_PREFIX;

/**
 * Create new user.
 * Used for initial creation and to follow up with Signature to verify the user owns the wallet.
 * @param {object} context
 * @param {string} [context.requestId]
 * @param {object} params
 * @param {string} params.walletId
 * @param {object} params.body
 * @param {boolean} [params.body.verify = false] - verify with the signature
 * @param {string} [params.body.signature = ''] - required to update the user as verified
 */
exports.handler = async (event) => {
    console.log('Event: ', JSON.stringify(event));
    const { params = {}, context = {} } = event;
    const { requestId = '' } = context;

    try {
        const { walletId = '', body } = params;
        const { verify = false, signature = '' } = body;
        if (!walletId) { throw new ValidationError('Missing walletId'); }

        // Validate wallet
        const validAddress = await isValidEthAddress(walletId);
        if (!validAddress) { throw new ValidationError('Invalid wallet Id'); }

        // Create the user and walletId
        const user = await createUser({
            walletId,
            verify, // False on initial creation, True when we receive a Signature
            signature,
            signPrefix,
        });
        console.log('User created: ', JSON.stringify(user));
        return {
            success: true,
            ...user,
            nonce: `${signPrefix}${user.nonce}`, // Included so we can sign and verify the user after creation
            requestId,
        };
    } catch (err) {
        const { message = 'Internal handler Error', statusCode = 500 } = err;
        console.log('Error caught: ', err);
        throw new ApiError(message, statusCode, requestId);
    }
};
