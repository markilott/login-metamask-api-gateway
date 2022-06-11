import {
    logout, refreshToken, signMsg, evalResponse,
} from './auth';

const apiDomain = process.env.API_DOMAIN;
const apiBaseUrl = `https://${apiDomain}/test`;

const params = new URLSearchParams(window.location.search);

const showUserId = document.getElementById('showUserId');
const showWalletId = document.getElementById('showWalletId');
const logoutButton = document.getElementById('logoutButton');

const readButton = document.getElementById('readButton');
const writeButton = document.getElementById('writeButton');

const errorBlock = document.getElementById('errorBlock');
const showError = document.getElementById('showError');

const successBlock = document.getElementById('successBlock');
const showSuccess = document.getElementById('showSuccess');

/**
 * Logout button handler
 */
logoutButton.onclick = async () => {
    try {
        errorBlock.style.display = 'none';
        await logout();
        return true;
    } catch (err) {
        err.message = (err.message) || 'Internal error on logout';
        errorBlock.style.display = 'block';
        showError.textContent = err.message;
        throw err;
    }
};

/**
 * Read button handler
 */
readButton.onclick = async () => {
    try {
        errorBlock.style.display = 'none';
        successBlock.style.display = 'none';

        // Check if we are logged in
        const isLoggedIn = await refreshToken({ tryLogin: true });
        if (!isLoggedIn) {
            await logout();
            return false;
        }

        // Get a response from the API
        const url = `${apiBaseUrl}/read`;
        const response = await fetch(url, {
            method: 'GET',
            mode: 'cors',
            headers: {
                Authorization: window.sessionStorage.getItem('authToken'),
            },
        });
        const { message = 'Invalid response from API' } = await evalResponse(response);

        successBlock.style.display = 'block';
        showSuccess.textContent = message;

        return true;
    } catch (err) {
        err.message = (err.message) || 'Internal error on logout';
        errorBlock.style.display = 'block';
        showError.textContent = err.message;
        throw err;
    }
};

/**
 * Write button handler
 */
writeButton.onclick = async () => {
    try {
        errorBlock.style.display = 'none';
        successBlock.style.display = 'none';

        // Check if we are logged in
        const isLoggedIn = await refreshToken({ tryLogin: true });
        if (!isLoggedIn) {
            await logout();
            return false;
        }

        // Get the current nonce and sign a message
        const walletId = window.sessionStorage.getItem('walletId');
        const signature = await signMsg({ walletId });

        // Get a response from the API
        const url = `${apiBaseUrl}/write`;
        const response = await fetch(url, {
            method: 'POST',
            mode: 'cors',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: window.sessionStorage.getItem('authToken'),
            },
            body: JSON.stringify({
                signature,
                walletId,
            }),
        });
        const { message = 'Invalid response from API' } = await evalResponse(response);

        successBlock.style.display = 'block';
        showSuccess.textContent = message;

        return true;
    } catch (err) {
        err.message = (err.message) || 'Internal error on logout';
        errorBlock.style.display = 'block';
        showError.textContent = err.message;
        throw err;
    }
};

/**
 * Setup page on load
 */
window.onload = async function loadPage() {
    try {
        if (!params.has('from-login')) {
            if (!await refreshToken({ tryLogin: true })) { throw new Error('New login required'); }
        }
    } catch (err) {
        window.location.href = './index.html?from-logout=true';
        return false;
    }
    try {
        errorBlock.style.display = 'none';
        const walletId = window.sessionStorage.getItem('walletId');
        const userId = window.sessionStorage.getItem('userId');
        if (!walletId || !userId) { throw new Error('Cannot get userId or walletId, you will need to login again'); }
        showWalletId.textContent = walletId;
        showUserId.textContent = userId;
        return true;
    } catch (err) {
        errorBlock.style.display = 'block';
        showError.textContent = err.message;
        return false;
    }
};
