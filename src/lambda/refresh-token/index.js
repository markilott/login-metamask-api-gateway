const { validateRefreshCookie, createAuthToken, createRefreshCookie } = require('metamask-auth-utils').jwtUtils;
const { ValidationError, ApiError } = require('metamask-auth-utils').errors;

/**
 * Verify the refresh cookie and return new tokens.
 * If the refresh cookie is still valid we will return both a new
 * refresh token and a new auth token.
 * @param {object} context
 * @param {string} [context.requestId]
 * @param {object} params
 * @param {string} params.cookie
 */
exports.handler = async (event) => {
    console.log('Event: ', JSON.stringify(event));
    const { params = {}, context = {} } = event;
    const { requestId = '' } = context;

    try {
        const { cookie = '' } = params;
        if (!cookie) { throw new ValidationError('Missing cookie'); }

        // Verify the cookie
        const { userId } = await validateRefreshCookie(cookie);
        if (!userId) { throw new Error('Error getting userId from token'); }

        // Generate Auth Token
        const auth = await createAuthToken({ userId });

        // Generate Refresh Token
        const refresh = await createRefreshCookie({ userId });

        // Execute all updates
        const authData = await Promise.all([refresh, auth]);

        // Return new tokens. The cookie token is removed from the body and copied to the cookie header by API Gateway.
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
