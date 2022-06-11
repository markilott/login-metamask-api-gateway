const { ethers } = require('ethers');
const { recoverPersonalSignature } = require('@metamask/eth-sig-util');
const { getSecretByArn } = require('./awsUtils');

// Infura API Setup
const infuraSecretArn = process.env.INFURA_SECRET_ARN;
let projectId = '';
let projectSecret = '';
let skipValidation = false;

// Ether utils ==================================================================================

/**
 * Get the Infura secret and setup provider.
 * @returns {Promise<boolean>} true if the secret was set
 */
async function ethersSetup() {
    try {
        if (projectId && projectSecret) { return true; }

        const { data } = await getSecretByArn(infuraSecretArn);
        projectSecret = data.PROJECT_SECRET;
        projectId = data.PROJECT_ID;

        if (!projectId || !projectSecret) { throw new Error('Secret data is missing'); }

        // Skip if we don't have an Infura API key
        skipValidation = (projectId === 'SKIP_VALIDATION');
        if (skipValidation) { return true; }

        ethers.getDefaultProvider('homestead', { infura: { projectId, projectSecret } });
        return true;
    } catch (err) {
        err.message = (err.message) || 'Error getting secret';
        throw err;
    }
}

/**
 * Validate an Ethereum wallet adress.
 * Always returns true if we do not have an Infura API key.
 * @param {string} walletId
 * @returns {Promise<boolean>}
 */
async function isValidEthAddress(walletId) {
    try {
        await ethersSetup();
        if (skipValidation) { return true; }

        return ethers.utils.isAddress(walletId);
    } catch (err) {
        err.message = (err.message) || 'Internal isValidEthAddress error';
        throw err;
    }
}

/**
 * Validate a signature against a wallet
 * @param {string} walletId
 * @param {string} message
 * @param {string} signature
 * @returns {boolean}
 */
function isValidEthSignature({ walletId, message, signature }) {
    try {
        const data = `0x${Buffer.from(message, 'utf8').toString('hex')}`;
        const address = recoverPersonalSignature({
            data,
            signature,
        });
        const result = (address === walletId);
        if (!result) {
            console.log('Invalid signature =============');
            console.log('Signature: ', signature);
            console.log('Message: ', message);
            console.log('Submitted walletId: ', walletId);
            console.log('Signature walletId: ', address);
        }
        return result;
    } catch (err) {
        err.message = (err.message) || 'Internal isValidSignature error';
        throw err;
    }
}

module.exports = {
    isValidEthAddress,
    isValidEthSignature,
};
