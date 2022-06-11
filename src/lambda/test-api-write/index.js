const { isValidEthSignature } = require('metamask-auth-utils').web3Utils;
const { getUserNonceByWalletId } = require('metamask-auth-utils').authUtils;
const { ValidationError, ApiError } = require('metamask-auth-utils').errors;

const signPrefix = process.env.SIGN_PREFIX;

/**
 * Simulate write requests.
 * Verify a signature before allowing the request.
 * @param {object} params
 * @param {string} params.walletId
 * @param {string} params.signature
 * @param {object} context
 * @param {string} [context.requestId]
 *
 */
exports.handler = async (event) => {
    console.log('Event: ', JSON.stringify(event));
    const { params = {}, context = {} } = event;
    const { requestId = '' } = context;

    try {
        const { body = {} } = params;
        const { walletId = '', signature = '' } = body;
        if (!walletId) { throw new ValidationError('Missing walletId'); }
        if (!signature) { throw new ValidationError('Missing signature'); }

        // Get the current nonce for the user
        const nonce = await getUserNonceByWalletId(walletId);

        // Verify the signature
        const result = await isValidEthSignature({
            walletId,
            signature,
            message: `${signPrefix}${nonce}`,
        });

        if (!result) { throw new ValidationError('Invalid signature'); }

        return {
            success: result,
            message: 'Succesful write request',
        };
    } catch (err) {
        const { message = 'Internal handler Error', statusCode = 500 } = err;
        console.log('Error caught: ', err);
        throw new ApiError(message, statusCode, requestId);
    }
};
