/**
 * Simulate read requests.
 * Authorised by API Gateway only.
 * @param {object} context
 * @param {string} [context.requestId]
 *
 */
exports.handler = async (event) => {
    console.log('Event: ', JSON.stringify(event));
    const { context = {} } = event;
    const { requestId = '' } = context;
    return {
        success: true,
        message: 'Succesful read request',
        requestId,
    };
};
