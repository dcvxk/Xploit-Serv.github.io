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

// ===== FUNCIONES DE GITHUB TOKEN =====
function saveGitHubToken(token) {
    try {
        localStorage.setItem(STORAGE_TOKEN_KEY, token);
        context.log('[*] GitHub token saved');
    } catch (e) {
        context.error('Could not save token:', e.message);
    }
}

function loadGitHubToken() {
    try {
        const token = localStorage.getItem(STORAGE_TOKEN_KEY);
        if (token && (token.startsWith('ghp_') || token.startsWith('github_pat_'))) {
            GITHUB_TOKEN = token;
            context.log('[*] GitHub token loaded from storage');
            return true;
        }
    } catch (e) {
        context.error('Could not load token:', e.message);
    }
    return false;
}

async function requestGitHubToken() {
    return new Promise((resolve) => {
        const token = prompt(
            'Enter your GitHub Personal Access Token:\n\n' +
            'Required for write access.\n' +
            'Leave empty for read-only mode.',
            ''
        );
        if (token && (token.startsWith('ghp_') || token.startsWith('github_pat_'))) {
            GITHUB_TOKEN = token;
            saveGitHubToken(token);
            context.log('[*] GitHub token configured');
            resolve(true);
        } else if (token) {
            context.error('Invalid token format (must start with ghp_ or github_pat_)');
            resolve(false);
        } else {
            context.log('[!] Read-only mode (no token)');
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
            context.error('Authentication failed');
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

// ===== FUNCIONES DE PRODUCTOS =====
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

// ===== FUNCIONES DE TELEGRAM =====
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

async function listProducts(chatId, page = 0) {
    const productos = await obtenerProductos();
    if (!productos || productos.length === 0) {
        await sendMessage(chatId, "No products available");
        return;
    }
    const itemsPerPage = 5;
    const totalPages = Math.ceil(productos.length / itemsPerPage);
    const startIdx = page * itemsPerPage;
    const endIdx = Math.min(startIdx + itemsPerPage, productos.length);
    let message = `<b>PRODUCT CATALOG</b>\n━━━━━━━━━━━━━━━━━━━━━\nPage ${page + 1} of ${totalPages}\nTotal: ${productos.length} products\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
    for (let i = startIdx; i < endIdx; i++) {
        const p = productos[i];
        message += `<b>${i+1}. ${p.name || 'N/A'}</b>\nID: ${p.ID || 'N/A'}\nPrice: ${p.price || 'N/A'}\nBrand: ${p.brand || 'N/A'}\nShipping: ${p.shipping || 'N/A'}\n\n`;
    }
    const keyboard = { inline_keyboard: [] };
    const navButtons = [];
    if (page > 0) navButtons.push({ text: "PREV", callback_data: `page_${page-1}` });
    if (page < totalPages - 1) navButtons.push({ text: "NEXT", callback_data: `page_${page+1}` });
    if (navButtons.length > 0) keyboard.inline_keyboard.push(navButtons);
    keyboard.inline_keyboard.push([{ text: "MAIN MENU", callback_data: "main_menu" }]);
    await sendMessage(chatId, message, keyboard);
}

async function showStats(chatId) {
    const productos = await obtenerProductos();
    if (!productos || productos.length === 0) {
        await sendMessage(chatId, "No data available");
        return;
    }
    const marcas = {};
    const precios = [];
    for (const p of productos) {
        const marca = p.brand || 'Unknown';
        marcas[marca] = (marcas[marca] || 0) + 1;
        const precio = parseFloat((p.price || '0').replace('$', ''));
        if (!isNaN(precio)) precios.push(precio);
    }
    const marcaTop = Object.keys(marcas).reduce((a, b) => marcas[a] > marcas[b] ? a : b, 'N/A');
    const precioMin = precios.length ? Math.min(...precios) : 0;
    const precioMax = precios.length ? Math.max(...precios) : 0;
    const precioProm = precios.length ? precios.reduce((a,b) => a+b, 0) / precios.length : 0;
    const message = `<b>SYSTEM STATISTICS</b>\n\nTotal products: ${productos.length}\nUnique brands: ${Object.keys(marcas).length}\nMost common brand: ${marcaTop}\n\nPRICES\nMin: $${precioMin.toFixed(2)}\nMax: $${precioMax.toFixed(2)}\nAvg: $${precioProm.toFixed(2)}`;
    const keyboard = { inline_keyboard: [[{ text: "MAIN MENU", callback_data: "main_menu" }]] };
    await sendMessage(chatId, message, keyboard);
}

async function modifyProductSelection(chatId) {
    const productos = await obtenerProductos();
    if (!productos || productos.length === 0) {
        await sendMessage(chatId, "No products available");
        return;
    }
    const keyboard = { inline_keyboard: [] };
    for (let i = 0; i < Math.min(productos.length, 10); i++) {
        keyboard.inline_keyboard.push([{
            text: `${productos[i].ID} - ${productos[i].name.substring(0, 30)}`,
            callback_data: `select_${productos[i].ID}`
        }]);
    }
    keyboard.inline_keyboard.push([{ text: "MAIN MENU", callback_data: "main_menu" }]);
    await sendMessage(chatId, "SELECT PRODUCT TO MODIFY", keyboard);
}

async function showModifyOptions(chatId, productId) {
    const productos = await obtenerProductos();
    const producto = productos.find(p => p.ID === productId);
    if (!producto) {
        await sendMessage(chatId, "Product not found");
        return;
    }
    userSessions[chatId] = { productId: productId };
    const message = `MODIFY: ${producto.name}\n\nPrice: ${producto.price}\nShipping: ${producto.shipping}\n\nWhat to modify?`;
    const keyboard = {
        inline_keyboard: [
            [{ text: "PRICE", callback_data: `modify_price_${productId}` }],
            [{ text: "SHIPPING", callback_data: `modify_shipping_${productId}` }],
            [{ text: "BACK", callback_data: "modify_product_start" }],
            [{ text: "MAIN MENU", callback_data: "main_menu" }]
        ]
    };
    await sendMessage(chatId, message, keyboard);
}

async function processPriceChange(chatId, productId, newPrice) {
    let priceStr = newPrice.replace('$', '');
    const priceNum = parseFloat(priceStr);
    if (isNaN(priceNum) || priceNum < 0) {
        await sendMessage(chatId, "Invalid price");
        return;
    }
    const formattedPrice = `$${priceNum.toFixed(2)}`;
    const productos = await obtenerProductos();
    const index = productos.findIndex(p => p.ID === productId);
    if (index === -1) {
        await sendMessage(chatId, `Product ${productId} not found`);
        return;
    }
    const oldPrice = productos[index].price;
    productos[index].price = formattedPrice;
    if (await actualizarGitHub(productos)) {
        await sendMessage(chatId, `PRICE UPDATED\n\nProduct: ${productos[index].name}\nBefore: ${oldPrice}\nNow: ${formattedPrice}`);
    } else {
        await sendMessage(chatId, "Error saving to GitHub");
    }
}

async function processShippingChange(chatId, productId, newShipping) {
    let shippingStr = newShipping.replace('$', '');
    const shippingNum = parseFloat(shippingStr);
    if (isNaN(shippingNum) || shippingNum < 0) {
        await sendMessage(chatId, "Invalid shipping cost");
        return;
    }
    const formattedShipping = `$${shippingNum.toFixed(2)}`;
    const productos = await obtenerProductos();
    const index = productos.findIndex(p => p.ID === productId);
    if (index === -1) {
        await sendMessage(chatId, `Product ${productId} not found`);
        return;
    }
    const oldShipping = productos[index].shipping;
    productos[index].shipping = formattedShipping;
    if (await actualizarGitHub(productos)) {
        await sendMessage(chatId, `SHIPPING UPDATED\n\nProduct: ${productos[index].name}\nBefore: ${oldShipping}\nNow: ${formattedShipping}`);
    } else {
        await sendMessage(chatId, "Error saving to GitHub");
    }
}

// ===== MANEJADORES DE MENSAJES Y CALLBACKS =====
async function handleCallback(callbackQuery) {
    const chatId = callbackQuery.message?.chat?.id;
    if (!chatId) return;
    const data = callbackQuery.data;
    try {
        await fetch(`${API_URL}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: callbackQuery.id }),
            signal: context.signal
        });
    } catch (e) {}
    
    if (data === "main_menu") await sendMainMenu(chatId);
    else if (data === "list_products") await listProducts(chatId, 0);
    else if (data === "modify_product_start") await modifyProductSelection(chatId);
    else if (data === "stats") await showStats(chatId);
    else if (data === "refresh") {
        await obtenerProductos(true);
        await sendMessage(chatId, "Data refreshed");
        await sendMainMenu(chatId);
    }
    else if (data === "help") {
        const helpMsg = `COMMANDS\n\n/start - Main menu\n/list - List products\n/stats - Statistics\n/change ID price - Change price\n/shipping ID cost - Change shipping`;
        await sendMessage(chatId, helpMsg);
    }
    else if (data.startsWith("page_")) {
        const page = parseInt(data.split("_")[1]);
        await listProducts(chatId, page);
    }
    else if (data.startsWith("select_")) {
        const productId = data.replace("select_", "");
        await showModifyOptions(chatId, productId);
    }
    else if (data.startsWith("modify_price_")) {
        const productId = data.replace("modify_price_", "");
        userSessions[chatId] = { action: 'waiting_price', productId: productId };
        await sendMessage(chatId, "Enter new price (example: 45.99):");
    }
    else if (data.startsWith("modify_shipping_")) {
        const productId = data.replace("modify_shipping_", "");
        userSessions[chatId] = { action: 'waiting_shipping', productId: productId };
        await sendMessage(chatId, "Enter new shipping cost (example: 5.99):");
    }
}

async function handleMessage(message) {
    const chatId = message.chat.id;
    const text = message.text;
    if (!text) return;
    
    if (text === '/start') await sendMainMenu(chatId);
    else if (text === '/list') await listProducts(chatId, 0);
    else if (text === '/stats') await showStats(chatId);
    else if (text === '/cancel') {
        delete userSessions[chatId];
        await sendMessage(chatId, "Operation cancelled");
        await sendMainMenu(chatId);
    }
    else if (text.startsWith('/change')) {
        const parts = text.split(' ');
        if (parts.length !== 3) await sendMessage(chatId, "Usage: /change ID price");
        else await processPriceChange(chatId, parts[1], parts[2]);
    }
    else if (text.startsWith('/shipping')) {
        const parts = text.split(' ');
        if (parts.length !== 3) await sendMessage(chatId, "Usage: /shipping ID cost");
        else await processShippingChange(chatId, parts[1], parts[2]);
    }
    else if (userSessions[chatId]) {
        const session = userSessions[chatId];
        if (session.action === 'waiting_price') {
            await processPriceChange(chatId, session.productId, text);
            delete userSessions[chatId];
        } else if (session.action === 'waiting_shipping') {
            await processShippingChange(chatId, session.productId, text);
            delete userSessions[chatId];
        }
    }
}

// ===== BUCLE PRINCIPAL DE POLLING =====
async function pollTelegram() {
    // Primero, obtener el último update_id para evitar procesar mensajes antiguos
    try {
        const response = await fetch(`${API_URL}/getUpdates?offset=-1`, { signal: context.signal });
        const data = await response.json();
        if (data.ok && data.result.length > 0) {
            lastUpdateId = data.result[data.result.length - 1].update_id;
            context.log(`[*] Skipping to update_id: ${lastUpdateId}`);
        }
    } catch (e) {
        if (e.name === 'AbortError') return;
    }

    context.log('[*] Bot polling started');
    
    while (botActive && !context.signal.aborted) {
        try {
            const url = `${API_URL}/getUpdates?timeout=30&offset=${lastUpdateId + 1}`;
            const response = await fetch(url, { signal: context.signal });
            
            if (response.status === 409) {
                context.error('[!] Error 409: Another bot instance is running. Stopping...');
                botActive = false;
                break;
            }
            
            const data = await response.json();
            
            if (data.ok && data.result) {
                for (const update of data.result) {
                    if (update.update_id > lastUpdateId) {
                        lastUpdateId = update.update_id;
                        if (update.message) await handleMessage(update.message);
                        if (update.callback_query) await handleCallback(update.callback_query);
                    }
                }
            } else if (!data.ok) {
                context.error(`Telegram API error: ${data.description}`);
                await context.sleep(5000);
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

// ===== INICIALIZACIÓN =====
(async function init() {
    context.log('[*] YuanBot System v1.0');
    context.log('[*] Initializing modules...');
    
    const hasToken = loadGitHubToken();
    if (!hasToken) {
        context.log('[!] GitHub token required for write access');
        const tokenProvided = await requestGitHubToken();
        if (tokenProvided) await testToken();
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
    pollTelegram();
    
    context.signal.addEventListener('abort', () => {
        botActive = false;
        context.log('[!] Bot stopped');
    });
})();
