const { validateRefreshCookie, createLogoutCookie } = require('metamask-auth-utils').jwtUtils;
const { ValidationError, ApiError } = require('metamask-auth-utils').errors;

/**
 * Revoke JWT token and return invalid cookie.
 * This will logout the current user session.
 *
 * TODO: We should be maintaining a revoked token table so that we can
 * invalidate all sessions the user may be using.
 *
 * @param {object} context
 * @param {string} [context.requestId]
 * @param {object} params
 * @param {string} params.cookie
 *
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

        // Get the invalid logout cookie
        const newCookie = await createLogoutCookie();

        // Return cookie. The cookie token is removed from the body and copied to the cookie header by API Gateway.
        const result = {
            success: true,
            userId,
            requestId,
            cookie: newCookie,
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
