const { validateAuthToken } = require('metamask-auth-utils').jwtUtils;

const Resource = process.env.API_RESOURCE; // The ARN string we are granting access to

/**
 * Lambda Custom Authorizer
 * Returns an IAM Policy to API Gateway
 * Returns an Effect: Allow on success
 * Or Effect: Deny on failure
 * @param {string} authorizationToken
 * @param {string} methodArn
 */
exports.handler = async (event) => {
    console.log('Event: ', JSON.stringify(event));

    try {
        const { authorizationToken: token } = event;

        let allow = false;
        let isAdmin = false;
        let userId = 'Unknown';
        try {
            const { data } = await validateAuthToken({ token });
            isAdmin = (data.admin) || false;
            userId = data.sub;
            console.log('Token validation successful, returning Allow policy');
            allow = true;
        } catch (err) {
            console.log('Token validation failed, returning Deny policy');
            allow = false;
        }

        // Return IAM Policy in the format expected by API Gateway
        return {
            principalId: userId,
            policyDocument: {
                Version: '2012-10-17',
                Statement: [{
                    Action: 'execute-api:Invoke',
                    Effect: (allow) ? 'Allow' : 'Deny',
                    Resource,
                }],
            },
            context: {
                isAdmin,
            },
        };
    } catch (err) {
        console.log('Error caught: ', err);
        throw err;
    }
};
