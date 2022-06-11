// eslint-disable-next-line import/no-extraneous-dependencies
const AWS = require('aws-sdk');
const { ValidationError } = require('./errors');

const currentRegion = process.env.AWS_REGION;
const regionEndpoint = `https://secretsmanager.${currentRegion}.amazonaws.com`;

const secClient = new AWS.SecretsManager({
    endpoint: regionEndpoint,
    region: currentRegion,
});

/**
 * Wrapper for SecretsManager API
 * @param {string} secretArn - the name or the ARN of the secret
 * @returns {object} - JSON secret data
 */
async function getSecretByArn(secretArn) {
    const result = {
        success: true,
        message: '',
        data: {},
    };

    try {
        const data = await secClient.getSecretValue({ SecretId: secretArn }).promise();
        const { SecretString = '' } = data;
        if (!SecretString) {
            result.message = 'The password is blank or binary - we only handle strings here';
            throw new ValidationError(result.message);
        }
        result.data = JSON.parse(SecretString);
        return result;
    } catch (err) {
        err.message = (err.message) || 'Internal getSecret Error';
        console.log('Retrieve secret error: ', JSON.stringify(err));
        throw err;
    }
}

module.exports = {
    getSecretByArn,
};
