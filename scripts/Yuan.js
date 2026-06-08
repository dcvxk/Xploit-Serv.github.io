const BOT_TOKEN = "8762418416:AAH02l_pssUwIM1uzyD2VmdK6NZ3tvPo398";
const REPO_OWNER = "dcvxk";
const REPO_NAME = "Yuan24-7.github.io";
const FILE_PATH = "productos.json";

const STORAGE_TOKEN_KEY = 'github_token_yuanbot';

let GITHUB_TOKEN = null;
let botActive = false;
let lastUpdateId = 0;
let productosCache = null;
let cacheTimestamp = 0;
let userSessions = {};

const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;
const RAW_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/${FILE_PATH}`;
const GITHUB_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`;

// Función para guardar el token en localStorage
function saveGitHubToken(token) {
    try {
        localStorage.setItem(STORAGE_TOKEN_KEY, token);
        context.log('[*] GitHub token saved to localStorage');
    } catch (e) {
        context.error('Could not save token:', e.message);
    }
}

// Función para cargar el token desde localStorage
function loadGitHubToken() {
    try {
        const token = localStorage.getItem(STORAGE_TOKEN_KEY);
        if (token && (token.startsWith('ghp_') || token.startsWith('github_pat_'))) {
            GITHUB_TOKEN = token;
            context.log('[*] GitHub token loaded from localStorage');
            return true;
        }
    } catch (e) {
        context.error('Could not load token:', e.message);
    }
    return false;
}

// Función para solicitar el token al usuario
function requestGitHubToken() {
    return new Promise((resolve) => {
        const token = prompt(
            'Enter your GitHub Personal Access Token:\n\n' +
            'Required for write access to repository.\n' +
            'Leave empty for read-only mode.',
            ''
        );
        
        if (token && (token.startsWith('ghp_') || token.startsWith('github_pat_'))) {
            GITHUB_TOKEN = token;
            saveGitHubToken(token);
            context.log('[*] GitHub token configured successfully');
            resolve(true);
        } else if (token) {
            context.error('Invalid token format. Must start with ghp_ or github_pat_');
            resolve(false);
        } else {
            context.log('[!] Read-only mode activated (no token)');
            GITHUB_TOKEN = null;
            resolve(false);
        }
    });
}

async function testToken() {
    if (!GITHUB_TOKEN) return false;
    try {
        context.log('[*] Testing GitHub authentication...');
        const response = await fetch('https://api.github.com/user', {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            signal: context.signal
        });
        if (response.ok) {
            const user = await response.json();
            context.log(`[*] Authenticated as: ${user.login}`);
            return true;
        } else {
            context.error('Authentication failed - invalid token');
            GITHUB_TOKEN = null;
            try { localStorage.removeItem(STORAGE_TOKEN_KEY); } catch(e) {}
            return false;
        }
    } catch (error) {
        if (error.name === 'AbortError') throw error;
        context.error(`Connection error: ${error.message}`);
        return false;
    }
}

async function obtenerProductos(forceRefresh = false) {
    const now = Date.now() / 1000;
    if (!forceRefresh && productosCache && (now - cacheTimestamp) < 30) {
        return productosCache;
    }
    try {
        context.log('[*] Fetching products from GitHub...');
        const response = await fetch(RAW_URL, { signal: context.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data && data.products) {
            productosCache = data.products;
            cacheTimestamp = now;
            context.log(`[*] Loaded ${productosCache.length} products`);
            return productosCache;
        }
        return [];
    } catch (error) {
        if (error.name === 'AbortError') throw error;
        context.error(`Error loading products: ${error.message}`);
        return productosCache || [];
    }
}

async function actualizarGitHub(productos) {
    if (!GITHUB_TOKEN) {
        context.log('[!] Read-only mode - changes not saved');
        return false;
    }
    try {
        context.log('[*] Saving changes to GitHub...');
        const getResponse = await fetch(GITHUB_API_URL, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            signal: context.signal
        });
        let sha = null;
        if (getResponse.ok) {
            const data = await getResponse.json();
            sha = data.sha;
        }
        const dataToUpload = { products: productos };
        const contenidoJson = JSON.stringify(dataToUpload, null, 2);
        const contenidoBase64 = btoa(unescape(encodeURIComponent(contenidoJson)));
        const putData = {
            message: `Updated by bot - ${new Date().toLocaleString()}`,
            content: contenidoBase64,
            branch: "main"
        };
        if (sha) putData.sha = sha;
        const putResponse = await fetch(GITHUB_API_URL, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(putData),
            signal: context.signal
        });
        if (putResponse.ok) {
            cacheTimestamp = 0;
            context.log('[*] Changes saved successfully');
            return true;
        } else {
            const error = await putResponse.json();
            context.error(`GitHub error: ${error.message}`);
            return false;
        }
    } catch (error) {
        if (error.name === 'AbortError') throw error;
        context.error(`Save error: ${error.message}`);
        return false;
    }
}

// Telegram functions
async function sendMessage(chatId, text, replyMarkup = null) {
    const payload = { chat_id: chatId, text: text, parse_mode: 'HTML' };
    if (replyMarkup) payload.reply_markup = JSON.stringify(replyMarkup);
    try {
        await fetch(`${API_URL}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: context.signal
        });
    } catch (error) {
        if (error.name === 'AbortError') throw error;
        context.error(`Send error: ${error.message}`);
    }
}

async function sendMainMenu(chatId) {
    const keyboard = {
        inline_keyboard: [
            [{ text: "VIEW PRODUCTS", callback_data: "list_products" }],
            [{ text: "MODIFY PRODUCT", callback_data: "modify_product_start" }],
            [{ text: "STATISTICS", callback_data: "stats" }],
            [{ text: "REFRESH DATA", callback_data: "refresh" }],
            [{ text: "HELP", callback_data: "help" }]
        ]
    };
    const productos = await obtenerProductos();
    const total = productos ? productos.length : 0;
    const message = `<b>YUAN BOT - PRODUCT MANAGEMENT</b>\n\n` +
                   `Products: ${total}\n` +
                   `GitHub: ${GITHUB_TOKEN ? "READY" : "READ ONLY"}\n` +
                   `Time: ${new Date().toLocaleTimeString()}\n\n` +
                   `Select an option:`;
    await sendMessage(chatId, message, keyboard);
}

// ... (mantén todas las demás funciones igual: listProducts, showStats, modifyProductSelection, etc.)
// Solo asegúrate de que usen context.signal en los fetch y context.log/context.error

async function pollTelegram() {
    while (botActive && !context.signal.aborted) {
        try {
            const url = `${API_URL}/getUpdates?timeout=30&offset=${lastUpdateId + 1}`;
            const response = await fetch(url, { signal: context.signal });
            const data = await response.json();
            if (data.ok && data.result) {
                for (const update of data.result) {
                    if (update.update_id > lastUpdateId) {
                        lastUpdateId = update.update_id;
                        if (update.message) await handleMessage(update.message);
                        if (update.callback_query) await handleCallback(update.callback_query);
                    }
                }
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                context.log('Bot polling stopped.');
                break;
            }
            context.error(`Polling error: ${error.message}`);
            await context.sleep(5000);
        }
    }
}

async function handleMessage(message) {
    const chatId = message.chat.id;
    const text = message.text;
    if (!text) return;
    if (text === '/start') await sendMainMenu(chatId);
    else if (text === '/list') await listProducts(chatId, 0);
    else if (text === '/stats') await showStats(chatId);
    // ... resto de comandos
}

// Inicialización
(async function init() {
    context.log('[*] YuanBot System v1.0');
    context.log('[*] Initializing modules...');
    
    // Intentar cargar token guardado
    const hasToken = loadGitHubToken();
    
    if (!hasToken) {
        context.log('[!] GitHub token required for write access');
        const tokenProvided = await requestGitHubToken();
        if (tokenProvided) {
            await testToken();
        }
    } else {
        context.log('[*] Using stored GitHub token');
        const valid = await testToken();
        if (!valid) {
            context.log('[!] Stored token invalid, requesting new one...');
            const tokenProvided = await requestGitHubToken();
            if (tokenProvided) await testToken();
        }
    }
    
    await obtenerProductos();
    context.log('[*] System ready. Starting bot...');
    
    botActive = true;
    pollTelegram(); // Inicia el polling sin setInterval
    
    // Limpieza al detener
    context.signal.addEventListener('abort', () => {
        botActive = false;
        context.log('[!] Bot stopped');
    });
})();
