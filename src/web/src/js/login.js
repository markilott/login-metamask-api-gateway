import {
    connectWallet, login, refreshToken, isMetaMaskInstalled, InstallMetaMask, getUserId, createUser, verifyUser,
} from './auth';
import { ValidationError } from './errors';

const params = new URLSearchParams(window.location.search);

const metamaskConnectBlock = document.getElementById('metamaskConnectBlock');
const connectButton = document.getElementById('connectButton');
const metamaskInstallBlock = document.getElementById('metamaskInstallBlock');
const getMetamaskButton = document.getElementById('getMetamaskButton');
const reloadButton = document.getElementById('reloadButton');
const errorBlock = document.getElementById('errorBlock');
const showError = document.getElementById('showError');

const walletInfoBlock = document.getElementById('walletInfoBlock');
const showConnectedAccount = document.getElementById('showConnectedAccount');
const showUserId = document.getElementById('showUserId');

const loginBlock = document.getElementById('loginBlock');
const loginButton = document.getElementById('loginButton');
const createUserBlock = document.getElementById('createUserBlock');
const createUserButton = document.getElementById('createUserButton');
const verifyUserBlock = document.getElementById('verifyUserBlock');
const verifyUserButton = document.getElementById('verifyUserButton');

/**
 * Install MetaMask using MetaMask onboarding library
 */
function getMetaMask() {
    try {
        const onboarding = new InstallMetaMask();
        getMetamaskButton.innerText = 'Install in progress';
        getMetamaskButton.style.display = 'none';
        reloadButton.style.display = 'block';
        onboarding.startOnboarding();
    } catch (err) {
        err.message = (err.message) || 'Internal error on install MetaMask';
        errorBlock.style.display = 'block';
        showError.textContent = err.message;
        throw err;
    }
}
getMetamaskButton.onclick = async () => {
    try {
        errorBlock.style.display = 'none';
        getMetaMask();
        return true;
    } catch (err) {
        err.message = (err.message) || 'Internal error on install';
        errorBlock.style.display = 'block';
        showError.textContent = err.message;
        throw err;
    }
};
reloadButton.onclick = () => {
    window.location.reload();
};

/**
 * Connect MetaMask Wallet and Display result
 */
async function refreshDisplayBlocks() {
    try {
        // Check metamask install
        if (!isMetaMaskInstalled()) {
            metamaskInstallBlock.style.display = 'block';
            return false;
        }

        // Get the Wallet Id from MetaMask
        let walletId = '';
        try {
            walletId = await connectWallet();
            walletInfoBlock.style.display = 'block';
            showConnectedAccount.textContent = walletId;
        } catch (err) {
            metamaskConnectBlock.style.display = 'block';
            errorBlock.style.display = 'block';
            showError.textContent = (err instanceof ValidationError) ? err.message : `Error connecting wallet: ${err.message} Please try again`;
            return false;
        }

        // Get the UserId from the API
        try {
            const { userId, verified } = await getUserId({ walletId });
            showUserId.textContent = (verified) ? userId : `${userId} (Verify to continue)`;
            loginBlock.style.display = (verified) ? 'block' : 'none';
            verifyUserBlock.style.display = (verified) ? 'none' : 'block';
        } catch (err) {
            if (!(err instanceof ValidationError)) { throw err; }
            showUserId.textContent = 'Create a User to Continue';
            createUserBlock.style.display = 'block';
        }
        return true;
    } catch (err) {
        err.message = (err.message) || 'Internal error in refreshDisplayBlocks';
        console.error(err);
        throw err;
    }
}

/**
 * Connect MetaMask wallet Button Handler
 */
connectButton.onclick = async () => {
    try {
        errorBlock.style.display = 'none';
        return await refreshDisplayBlocks();
    } catch (err) {
        err.message = (err.message) || 'Internal error on login';
        errorBlock.style.display = 'block';
        showError.textContent = err.message;
        throw err;
    }
};

/**
 * Login Button Handler
 */
loginButton.onclick = async () => {
    try {
        errorBlock.style.display = 'none';
        const userId = await login();
        if (!userId) { throw new Error('Login error'); }
        window.location.href = './home.html?from-login=true';
        return true;
    } catch (err) {
        err.message = (err.message) || 'Internal error on login';
        errorBlock.style.display = 'block';
        showError.textContent = err.message;
        throw err;
    }
};

/**
 * Create User Button Handler
 */
createUserButton.onclick = async () => {
    try {
        errorBlock.style.display = 'none';

        // Create temp user to create nonce for verification
        const { nonce, walletId } = await createUser();
        if (!nonce || !walletId) { throw new Error('Invalid response from create-user API'); }
        createUserBlock.style.display = 'none';

        // Verify the new user with the nonce from create-user
        await verifyUser({
            nonce,
        });

        // Run refreshDisplayBlocks to refresh page
        return await refreshDisplayBlocks();
    } catch (err) {
        err.message = (err.message) || 'Internal error on create user';
        errorBlock.style.display = 'block';
        showError.textContent = err.message;
        throw err;
    }
};

/**
 * Verify User Button Handler
 */
verifyUserButton.onclick = async () => {
    try {
        errorBlock.style.display = 'none';

        // Verify the user with current walletId
        await verifyUser();

        // Run refreshDisplayBlocks to refresh page
        return await refreshDisplayBlocks();
    } catch (err) {
        err.message = (err.message) || 'Internal error on create user';
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
        errorBlock.style.display = 'none';

        // Stay here if sent from logout button
        if (params.has('from-logout')) {
            await refreshDisplayBlocks();
            return true;
        }

        // Try login using refresh token
        if (await refreshToken()) {
            window.location.href = './home.html?from-login=true';
            return true;
        }

        // Update status and display blocks
        return await refreshDisplayBlocks();
    } catch (err) {
        err.message = (err.message) || 'Internal error on page load';
        errorBlock.style.display = 'block';
        showError.textContent = err.message;
        return false;
    }
};
