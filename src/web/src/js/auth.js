/* eslint-disable max-classes-per-file */

import { Buffer } from 'buffer/index.js';
import MetaMaskOnboarding from '@metamask/onboarding';
import { ValidationError, AuthError } from './errors';

const apiDomain = process.env.API_DOMAIN;
const apiBaseUrl = `https://${apiDomain}/auth`;

const haveMetaMask = (typeof window.ethereum !== 'undefined' && window.ethereum.isMetaMask);

export const { isMetaMaskInstalled } = MetaMaskOnboarding;
export const InstallMetaMask = MetaMaskOnboarding;

/**
 * User
 * @typedef {Object} User
 * @property {string} userId
 * @property {string} walletId
 * @property {string} nonce - the current nonce for the user
 * @property {boolean} verified - walletId has been verified
 * @property {string} [createdTime] - ISO 8601 Time user was created
 * @property {string} [lastLogin] - ISO 8601 Time - last time user nonce was updated
 * @property {number} [expiryTime] - expiry (Unix timestamp)
 */

/**
 * Fetch error handling
 * @param {object} response - a fetch response object
 * @returns {Promise<object>} response data
 */
export async function evalResponse(response) {
    try {
        const { status } = response;
        const data = await response.json();
        if (response.ok) { return data; }
        const message = data.errorMessage || data.message || response.statusText || 'Unknown error from API';
        if (status === 401 || status === 403) { throw new AuthError(message); }
        if (status === 400) { throw new ValidationError(message); }
        throw new Error(message);
    } catch (err) {
        err.message = (err.message) || 'Internal error';
        console.error(err);
        throw err;
    }
}

/**
 * Connect MetaMask wallet
 * @returns {Promise<string>} walletId
 */
export async function connectWallet() {
    try {
        if (!haveMetaMask) { throw new ValidationError('Metamask is not installed'); }
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        const [walletId] = accounts;
        if (!walletId) { throw new Error('Unknwon error connecting Metamask'); }
        window.sessionStorage.setItem('walletId', walletId);
        return walletId;
    } catch (err) {
        console.error(err);
        // Did user reject the message?
        if (err.code === 4001) { throw new ValidationError('Approve the wallet connection in MetaMask to continue'); }
        throw err;
    }
}

/**
 * Get the current nonce for signing for the current walletId
 * @param {boolean} [isLogin = false] - default is verify nonce
 * @returns {Promise<string>} nonce
 */
async function getNonce({ isLogin = false } = {}) {
    try {
        const walletId = await connectWallet();
        const url = (isLogin) ? `${apiBaseUrl}/get-nonce/${walletId}?login=true` : `${apiBaseUrl}/get-nonce/${walletId}`;
        const response = await fetch(url);
        const data = await evalResponse(response);
        if (!data.success) { throw new Error((data.errorMessage || 'Unknown error')); }
        return data.nonce;
    } catch (err) {
        console.error(err);
        throw err;
    }
}

/**
 * Get the UserId for the wallet
 * @param {string} walletId
 * @returns {Promise<{userId: string, verified: boolean}>}
 */
export async function getUserId({ walletId }) {
    try {
        // Using the get-nonce method as it does not require auth
        const url = `${apiBaseUrl}/get-nonce/${walletId}`;
        const response = await fetch(url);
        const { userId, verified, errorMessage = '' } = await evalResponse(response);
        if (!userId) { throw new Error((errorMessage || 'Nonce API returned invalid data')); }
        return {
            userId,
            verified,
        };
    } catch (err) {
        console.error(err);
        throw err;
    }
}

/**
 * Sign a login or verify message.
 * Will get the nonce for the current walletId if not supplied.
 * @param {boolean} [isLogin = false] - is this a login message? Default is verification message
 * @param {string} [walletId = ''] - get from local storage if not supplied
 * @param {string} [nonce = '']  - get from API if not supplied
 * @returns {Promise<string>} signature
 */
export async function signMsg({
    isLogin = false,
    walletId = '',
    nonce = '',
} = {}) {
    try {
        const from = (walletId) || window.sessionStorage.getItem('walletId');
        if (!from) { throw new ValidationError('Wallet is not connected'); }
        const msgNonce = (nonce) || await getNonce({ isLogin });
        const msg = `0x${Buffer.from(msgNonce, 'utf8').toString('hex')}`;
        const signature = await window.ethereum.request({
            method: 'personal_sign',
            params: [msg, from], // Don't need the password param
        });
        return signature;
    } catch (err) {
        console.error(err);
        throw err;
    }
}

/**
 * Create a new User from the current walletId
 * @returns {Promise<User>} User
 */
export async function createUser() {
    try {
        const walletId = window.sessionStorage.getItem('walletId');
        if (!walletId) { throw new ValidationError('Wallet is not connected'); }
        const url = `${apiBaseUrl}/create-user/${walletId}`;
        const response = await fetch(url, {
            method: 'POST',
            mode: 'cors',
            credentials: 'omit',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
        });
        const data = await evalResponse(response);
        if (!data.success) { throw new Error((data.errorMessage || 'Unknown error')); }
        return data;
    } catch (err) {
        console.error(err);
        throw err;
    }
}

/**
 * Verify the currently connected user
 * @param {string} [nonce] - get from API if not supplied
 * @returns {Promise<User>} User
 */
export async function verifyUser({
    nonce = '',
}) {
    try {
        const walletId = window.sessionStorage.getItem('walletId');
        if (!walletId) { throw new ValidationError('Wallet is not connected'); }

        const message = (nonce) || await getNonce({ isLogin: false });
        const signature = await signMsg({ walletId, message });

        const url = `${apiBaseUrl}/create-user/${walletId}`;
        const response = await fetch(url, {
            method: 'POST',
            mode: 'cors',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                verify: true,
                message,
                signature,
            }),
        });
        const data = await evalResponse(response);
        if (!data.success) { throw new Error((data.errorMessage || 'Unknown error')); }
        return data;
    } catch (err) {
        console.error(err);
        throw err;
    }
}

/**
 * Set auth token in storage
 * @param {string} token
 */
function setAuthToken(token) {
    window.sessionStorage.setItem('authToken', token);
}
/**
 * Clear user params from storage
 */
function clearStorage() {
    window.sessionStorage.removeItem('authToken');
    window.sessionStorage.removeItem('userId');
    window.sessionStorage.removeItem('walletId');
}

/**
 * Login using the currently connected wallet
 * @returns {Promise<boolean>}
 */
export async function login() {
    try {
        clearStorage();
        const walletId = await connectWallet();
        const sig = await signMsg({ isLogin: true });
        const response = await fetch(`${apiBaseUrl}/login/${walletId}`, {
            method: 'POST',
            mode: 'cors',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                signature: sig,
            }),
        });
        const data = await evalResponse(response);
        if (!data.success) { throw new Error((data.errorMessage || 'Unknown error')); }
        const authToken = data.authToken || '';
        const userId = data.userId || '';
        if (!authToken || !userId) { throw new Error('Missing login data'); }
        window.sessionStorage.setItem('userId', userId);
        setAuthToken(authToken);
        return true;
    } catch (err) {
        clearStorage();
        console.error(err);
        throw err;
    }
}

/**
 * Refresh token with cookie.
 * By default will not prompt for login on refresh fail.
 * @param {boolean} [tryLogin = false] - prompt for login if refresh fails
 * @returns {Promise<boolean>}
 */
export async function refreshToken({
    tryLogin = false,
} = {}) {
    try {
        const response = await fetch(`${apiBaseUrl}/refresh-token`, {
            method: 'GET',
            mode: 'cors',
            credentials: 'include',
        });
        try {
            const data = await evalResponse(response);
            if (!data.success) { throw new Error((data.errorMessage || 'Unknown error')); }
            const authToken = data.authToken || 'Token missing';
            setAuthToken(authToken);
            return true;
        } catch (err) {
            if (err instanceof AuthError) {
                if (!tryLogin) {
                    clearStorage();
                    return false;
                }
                return await login();
            }
            throw err;
        }
    } catch (err) {
        console.error(err);
        throw err;
    }
}

/**
 * Logout the currently logged in user.
 * This sets invalid cookie locally and deletes user params from local storage.
 * @returns {Promise<boolean>}
 */
export async function logout() {
    try {
        // We need to be logged in to be able to logout
        const isLoggedIn = await refreshToken();
        if (!isLoggedIn) {
            clearStorage();
            window.location.href = './index.html?from-logout=true';
            return true;
        }
        // Logout
        const response = await fetch(`${apiBaseUrl}/logout`, {
            method: 'GET',
            mode: 'cors',
            credentials: 'include',
        });
        const data = await evalResponse(response);
        if (!data.success) { throw new Error((data.errorMessage || 'Unknown error')); }
        clearStorage();
        window.location.href = './index.html?from-logout=true';
        return true;
    } catch (err) {
        console.error(err);
        throw err;
    }
}
