// ============================================================
// YUANBOT v3.0 - SIEMPRE ENCENDIDO (CHINESE)
// ============================================================
// Este bot está diseñado para funcionar 24/7 sin apagarse.
// Maneja errores 409 (múltiples instancias), errores de red,
// y cualquier otro problema sin detenerse.
// Solo se detiene si el usuario cierra la ventana o pulsa "Detener".
// ============================================================

const BOT_TOKEN = "8762418416:AAH02l_pssUwIM1uzyD2VmdK6NZ3tvPo398";
const REPO_OWNER = "dcvxk";
const REPO_NAME = "Yuan24-7.github.io";
const FILE_PATH = "productos.json";
const STORAGE_TOKEN_KEY = 'github_token_yuanbot';

let GITHUB_TOKEN = null;
let productosCache = null;
let cacheTimestamp = 0;
let userSessions = {};
let lastUpdateId = 0;

const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;
const RAW_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/${FILE_PATH}`;
const GITHUB_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`;

// ============================================================
// FUNCIONES DE GITHUB TOKEN (con persistencia en localStorage)
// ============================================================

function saveGitHubToken(token) {
    try { 
        localStorage.setItem(STORAGE_TOKEN_KEY, token); 
        context.log('[*] GitHub token saved'); 
    } catch(e) {}
}

function loadGitHubToken() {
    try {
        const token = localStorage.getItem(STORAGE_TOKEN_KEY);
        if (token && (token.startsWith('ghp_') || token.startsWith('github_pat_'))) {
            GITHUB_TOKEN = token;
            context.log('[*] GitHub token loaded from storage');
            return true;
        }
    } catch(e) {}
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
            context.log('[!] Read-only mode activated');
            GITHUB_TOKEN = null;
            resolve(false);
        }
    });
}

async function testToken() {
    if (!GITHUB_TOKEN) return false;
    try {
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
        }
        context.error('Authentication failed - invalid token');
        GITHUB_TOKEN = null;
        try { localStorage.removeItem(STORAGE_TOKEN_KEY); } catch(e) {}
        return false;
    } catch(e) {
        if (e.name === 'AbortError') throw e;
        context.error(`Connection error: ${e.message}`);
        return false;
    }
}

// ============================================================
// FUNCIONES DE PRODUCTOS (con cache de 30 segundos)
// ============================================================

async function obtenerProductos(forceRefresh = false) {
    const now = Date.now() / 1000;
    
    // Usar cache si es válido y no se fuerza refresh
    if (!forceRefresh && productosCache && (now - cacheTimestamp) < 30) {
        return productosCache;
    }
    
    try {
        const response = await fetch(RAW_URL, { signal: context.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        
        if (data && data.products) {
            productosCache = data.products;
            cacheTimestamp = now;
            return productosCache;
        }
        return [];
    } catch(e) {
        if (e.name === 'AbortError') throw e;
        context.error(`Error loading products: ${e.message}`);
        return productosCache || [];
    }
}

async function actualizarGitHub(productos) {
    if (!GITHUB_TOKEN) {
        context.log('[!] Read-only mode - changes not saved');
        return false;
    }
    
    try {
        // Obtener SHA del archivo actual
        const getRes = await fetch(GITHUB_API_URL, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            signal: context.signal
        });
        
        let sha = null;
        if (getRes.ok) {
            const data = await getRes.json();
            sha = data.sha;
        }
        
        // Preparar datos
        const json = JSON.stringify({ products: productos }, null, 2);
        const b64 = btoa(unescape(encodeURIComponent(json)));
        
        // Guardar cambios
        const putRes = await fetch(GITHUB_API_URL, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: `Updated by bot - ${new Date().toLocaleString('zh-CN')}`,
                content: b64,
                branch: "main",
                ...(sha && { sha })
            }),
            signal: context.signal
        });
        
        if (putRes.ok) {
            cacheTimestamp = 0; // Invalidar cache
            context.log('[*] Changes saved to GitHub');
            return true;
        } else {
            const err = await putRes.json();
            context.error(`GitHub error: ${err.message}`);
            return false;
        }
    } catch(e) {
        if (e.name === 'AbortError') throw e;
        context.error(`Save error: ${e.message}`);
        return false;
    }
}

// ============================================================
// FUNCIONES DE TELEGRAM (envío de mensajes y menús)
// ============================================================

async function sendMessage(chatId, text, replyMarkup = null) {
    const payload = { 
        chat_id: chatId, 
        text: text, 
        parse_mode: 'HTML' 
    };
    if (replyMarkup) {
        payload.reply_markup = JSON.stringify(replyMarkup);
    }
    
    try {
        await fetch(`${API_URL}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: context.signal
        });
    } catch(e) {
        // Solo mostrar error si no es por cancelación
        if (e.name !== 'AbortError') {
            context.error(`Send error: ${e.message}`);
        }
    }
}

async function sendMainMenu(chatId) {
    const productos = await obtenerProductos();
    const total = productos ? productos.length : 0;
    
    const keyboard = {
        inline_keyboard: [
            [{ text: "查看产品", callback_data: "list_products" }],
            [{ text: "修改产品", callback_data: "modify_product_start" }],
            [{ text: "统计数据", callback_data: "stats" }],
            [{ text: "刷新数据", callback_data: "refresh" }],
            [{ text: "帮助", callback_data: "help" }]
        ]
    };
    
    const message = `<b>🤖 元机器人 - 产品管理系统</b>\n\n` +
                   `📦 产品总数: ${total}\n` +
                   `🔐 GitHub: ${GITHUB_TOKEN ? "✅ 已连接" : "⚠️ 只读"}\n` +
                   `⏰ ${new Date().toLocaleString('zh-CN')}\n\n` +
                   `请选择一个选项:`;
    
    await sendMessage(chatId, message, keyboard);
}

async function listProducts(chatId, page = 0) {
    const productos = await obtenerProductos();
    
    if (!productos || productos.length === 0) {
        await sendMessage(chatId, "❌ 暂无产品数据");
        return;
    }
    
    const itemsPerPage = 8;
    const totalPages = Math.ceil(productos.length / itemsPerPage);
    const startIdx = page * itemsPerPage;
    const endIdx = Math.min(startIdx + itemsPerPage, productos.length);
    
    let message = `<b>📋 产品目录</b>\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `第 ${page + 1} / ${totalPages} 页\n`;
    message += `总计: ${productos.length} 个产品\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    for (let i = startIdx; i < endIdx; i++) {
        const p = productos[i];
        message += `<b>${i+1}. ${p.name || 'N/A'}</b>\n`;
        message += `🆔 ${p.ID || 'N/A'} | `;
        message += `💰 ${p.price || 'N/A'} | `;
        message += `🏷️ ${p.brand || 'N/A'} | `;
        message += `🚚 ${p.shipping || 'N/A'}\n\n`;
    }
    
    const keyboard = { inline_keyboard: [] };
    const navButtons = [];
    if (page > 0) navButtons.push({ text: "◀️ 上一页", callback_data: `page_${page-1}` });
    if (page < totalPages - 1) navButtons.push({ text: "下一页 ▶️", callback_data: `page_${page+1}` });
    if (navButtons.length > 0) keyboard.inline_keyboard.push(navButtons);
    keyboard.inline_keyboard.push([{ text: "🏠 主菜单", callback_data: "main_menu" }]);
    
    await sendMessage(chatId, message, keyboard);
}

async function showStats(chatId) {
    const productos = await obtenerProductos();
    
    if (!productos || productos.length === 0) {
        await sendMessage(chatId, "❌ 暂无统计数据");
        return;
    }
    
    const marcas = {};
    const precios = [];
    
    for (const p of productos) {
        const marca = p.brand || '未知品牌';
        marcas[marca] = (marcas[marca] || 0) + 1;
        const precio = parseFloat((p.price || '0').replace('$', ''));
        if (!isNaN(precio)) precios.push(precio);
    }
    
    const marcaTop = Object.keys(marcas).reduce((a, b) => marcas[a] > marcas[b] ? a : b, 'N/A');
    const precioMin = precios.length ? Math.min(...precios) : 0;
    const precioMax = precios.length ? Math.max(...precios) : 0;
    const precioProm = precios.length ? precios.reduce((a,b) => a+b, 0) / precios.length : 0;
    
    const message = `<b>📊 系统统计数据</b>\n\n` +
                   `📦 产品总数: ${productos.length}\n` +
                   `🏷️ 品牌数量: ${Object.keys(marcas).length}\n` +
                   `⭐ 最常见品牌: ${marcaTop}\n\n` +
                   `💰 价格统计\n` +
                   `   最低价: $${precioMin.toFixed(2)}\n` +
                   `   最高价: $${precioMax.toFixed(2)}\n` +
                   `   平均价: $${precioProm.toFixed(2)}`;
    
    const keyboard = { inline_keyboard: [[{ text: "🏠 主菜单", callback_data: "main_menu" }]] };
    await sendMessage(chatId, message, keyboard);
}

async function modifyProductSelection(chatId) {
    const productos = await obtenerProductos();
    
    if (!productos || productos.length === 0) {
        await sendMessage(chatId, "❌ 暂无产品数据");
        return;
    }
    
    // Mostrar TODOS los productos
    const keyboard = { inline_keyboard: [] };
    for (let i = 0; i < productos.length; i++) {
        keyboard.inline_keyboard.push([{
            text: `${productos[i].ID} - ${productos[i].name.substring(0, 35)}`,
            callback_data: `select_${productos[i].ID}`
        }]);
    }
    keyboard.inline_keyboard.push([{ text: "🏠 主菜单", callback_data: "main_menu" }]);
    
    await sendMessage(chatId, `✏️ 请选择要修改的产品 (共 ${productos.length} 个)`, keyboard);
}

async function showModifyOptions(chatId, productId) {
    const productos = await obtenerProductos();
    const producto = productos.find(p => p.ID === productId);
    
    if (!producto) {
        await sendMessage(chatId, "❌ 产品未找到");
        return;
    }
    
    userSessions[chatId] = { productId: productId };
    
    const message = `✏️ 修改产品: ${producto.name}\n\n` +
                   `💰 当前价格: ${producto.price}\n` +
                   `🚚 当前运费: ${producto.shipping}\n` +
                   `📝 当前描述: ${(producto.description || '无').substring(0, 60)}...\n\n` +
                   `请选择要修改的字段:`;
    
    const keyboard = {
        inline_keyboard: [
            [{ text: "💰 修改价格", callback_data: `modify_price_${productId}` }],
            [{ text: "🚚 修改运费", callback_data: `modify_shipping_${productId}` }],
            [{ text: "📝 修改描述", callback_data: `modify_desc_${productId}` }],
            [{ text: "◀️ 返回", callback_data: "modify_product_start" }],
            [{ text: "🏠 主菜单", callback_data: "main_menu" }]
        ]
    };
    
    await sendMessage(chatId, message, keyboard);
}

async function processPriceChange(chatId, productId, newPrice) {
    let priceStr = newPrice.replace('$', '');
    const priceNum = parseFloat(priceStr);
    
    if (isNaN(priceNum) || priceNum < 0) {
        await sendMessage(chatId, "❌ 价格格式无效，请输入数字 (例如: 45.99)");
        return;
    }
    
    const formattedPrice = `$${priceNum.toFixed(2)}`;
    const productos = await obtenerProductos();
    const index = productos.findIndex(p => p.ID === productId);
    
    if (index === -1) {
        await sendMessage(chatId, `❌ 产品编号 ${productId} 未找到`);
        return;
    }
    
    const oldPrice = productos[index].price;
    productos[index].price = formattedPrice;
    
    if (await actualizarGitHub(productos)) {
        await sendMessage(chatId, `✅ 价格更新成功\n\n产品: ${productos[index].name}\n原价: ${oldPrice}\n现价: ${formattedPrice}`);
    } else {
        await sendMessage(chatId, "❌ 保存到 GitHub 失败，请检查网络或 Token");
    }
}

async function processShippingChange(chatId, productId, newShipping) {
    let shippingStr = newShipping.replace('$', '');
    const shippingNum = parseFloat(shippingStr);
    
    if (isNaN(shippingNum) || shippingNum < 0) {
        await sendMessage(chatId, "❌ 运费格式无效，请输入数字 (例如: 5.99)");
        return;
    }
    
    const formattedShipping = `$${shippingNum.toFixed(2)}`;
    const productos = await obtenerProductos();
    const index = productos.findIndex(p => p.ID === productId);
    
    if (index === -1) {
        await sendMessage(chatId, `❌ 产品编号 ${productId} 未找到`);
        return;
    }
    
    const oldShipping = productos[index].shipping;
    productos[index].shipping = formattedShipping;
    
    if (await actualizarGitHub(productos)) {
        await sendMessage(chatId, `✅ 运费更新成功\n\n产品: ${productos[index].name}\n原运费: ${oldShipping}\n现运费: ${formattedShipping}`);
    } else {
        await sendMessage(chatId, "❌ 保存到 GitHub 失败，请检查网络或 Token");
    }
}

async function processDescriptionChange(chatId, productId, newDescription) {
    const productos = await obtenerProductos();
    const index = productos.findIndex(p => p.ID === productId);
    
    if (index === -1) {
        await sendMessage(chatId, `❌ 产品编号 ${productId} 未找到`);
        return;
    }
    
    const oldDescription = productos[index].description || '无';
    productos[index].description = newDescription;
    
    if (await actualizarGitHub(productos)) {
        await sendMessage(chatId, `✅ 描述更新成功\n\n产品: ${productos[index].name}\n原描述: ${oldDescription.substring(0, 50)}...\n新描述: ${newDescription.substring(0, 50)}...`);
    } else {
        await sendMessage(chatId, "❌ 保存到 GitHub 失败，请检查网络或 Token");
    }
}

// ============================================================
// MANEJADORES DE MENSAJES Y CALLBACKS
// ============================================================

async function handleCallback(callbackQuery) {
    const chatId = callbackQuery.message?.chat?.id;
    if (!chatId) return;
    
    const data = callbackQuery.data;
    
    // Responder al callback inmediatamente
    try {
        await fetch(`${API_URL}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: callbackQuery.id }),
            signal: context.signal
        });
    } catch (e) {}
    
    // Procesar la acción
    if (data === "main_menu") await sendMainMenu(chatId);
    else if (data === "list_products") await listProducts(chatId, 0);
    else if (data === "modify_product_start") await modifyProductSelection(chatId);
    else if (data === "stats") await showStats(chatId);
    else if (data === "refresh") {
        await obtenerProductos(true);
        await sendMessage(chatId, "✅ 数据刷新成功");
        await sendMainMenu(chatId);
    }
    else if (data === "help") {
        const helpMsg = `❓ 帮助信息\n\n` +
                       `/start - 显示主菜单\n` +
                       `/list - 查看产品列表\n` +
                       `/stats - 查看统计数据\n` +
                       `/change [编号] [价格] - 修改产品价格\n` +
                       `/shipping [编号] [运费] - 修改产品运费\n` +
                       `/description [编号] [描述] - 修改产品描述\n` +
                       `/cancel - 取消当前操作`;
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
        await sendMessage(chatId, "💰 请输入新的价格 (例如: 45.99):\n输入 /cancel 取消操作");
    }
    else if (data.startsWith("modify_shipping_")) {
        const productId = data.replace("modify_shipping_", "");
        userSessions[chatId] = { action: 'waiting_shipping', productId: productId };
        await sendMessage(chatId, "🚚 请输入新的运费 (例如: 5.99):\n输入 /cancel 取消操作");
    }
    else if (data.startsWith("modify_desc_")) {
        const productId = data.replace("modify_desc_", "");
        userSessions[chatId] = { action: 'waiting_description', productId: productId };
        await sendMessage(chatId, "📝 请输入新的产品描述:\n输入 /cancel 取消操作");
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
        await sendMessage(chatId, "❌ 操作已取消");
        await sendMainMenu(chatId);
    }
    else if (text.startsWith('/change')) {
        const parts = text.split(' ');
        if (parts.length !== 3) await sendMessage(chatId, "❌ 使用方法: /change 产品编号 价格\n示例: /change TY423 45.99");
        else await processPriceChange(chatId, parts[1], parts[2]);
    }
    else if (text.startsWith('/shipping')) {
        const parts = text.split(' ');
        if (parts.length !== 3) await sendMessage(chatId, "❌ 使用方法: /shipping 产品编号 运费\n示例: /shipping TY423 5.99");
        else await processShippingChange(chatId, parts[1], parts[2]);
    }
    else if (text.startsWith('/description')) {
        const parts = text.split(' ');
        if (parts.length < 3) await sendMessage(chatId, "❌ 使用方法: /description 产品编号 描述\n示例: /description TY423 高品质运动鞋");
        else {
            const description = parts.slice(2).join(' ');
            await processDescriptionChange(chatId, parts[1], description);
        }
    }
    else if (userSessions[chatId]) {
        const session = userSessions[chatId];
        if (session.action === 'waiting_price') {
            await processPriceChange(chatId, session.productId, text);
            delete userSessions[chatId];
        } else if (session.action === 'waiting_shipping') {
            await processShippingChange(chatId, session.productId, text);
            delete userSessions[chatId];
        } else if (session.action === 'waiting_description') {
            await processDescriptionChange(chatId, session.productId, text);
            delete userSessions[chatId];
        }
    }
}

// ============================================================
// BUCLE PRINCIPAL DE POLLING - SIEMPRE ENCENDIDO
// ============================================================
// Este es el corazón del bot. Está diseñado para:
// 1. Nunca detenerse por errores
// 2. Recuperarse automáticamente de errores 409
// 3. Reintentar ante fallos de red
// 4. Solo detenerse cuando el usuario cierra la ventana

async function pollTelegram() {
    // Paso 1: Obtener el último update_id para ignorar mensajes antiguos
    try {
        const response = await fetch(`${API_URL}/getUpdates?offset=-1`, { 
            signal: context.signal 
        });
        const data = await response.json();
        if (data.ok && data.result.length > 0) {
            lastUpdateId = data.result[data.result.length - 1].update_id;
            context.log(`[*] Starting from update_id: ${lastUpdateId}`);
        }
    } catch (e) {
        if (e.name === 'AbortError') return;
    }

    context.log('[*] Bot polling started - will run continuously');
    context.log('[*] Auto-recovery enabled for all errors');

    // Paso 2: Bucle infinito (solo se detiene con context.signal.aborted)
    while (!context.signal.aborted) {
        try {
            // Hacer la petición de long polling
            const url = `${API_URL}/getUpdates?timeout=25&offset=${lastUpdateId + 1}`;
            const response = await fetch(url, { signal: context.signal });
            
            // Si recibimos 409 (conflicto), esperar y reintentar
            if (response.status === 409) {
                context.log('[!] 409 Conflict detected - waiting 10 seconds before retry...');
                await context.sleep(10000);
                continue; // Reintentar
            }
            
            const data = await response.json();
            
            if (data.ok && data.result) {
                // Procesar todas las actualizaciones recibidas
                for (const update of data.result) {
                    if (update.update_id > lastUpdateId) {
                        lastUpdateId = update.update_id;
                        
                        // Procesar mensajes y callbacks
                        if (update.message) {
                            await handleMessage(update.message).catch(e => {
                                // Error silencioso para no detener el bucle
                            });
                        }
                        if (update.callback_query) {
                            await handleCallback(update.callback_query).catch(e => {
                                // Error silencioso para no detener el bucle
                            });
                        }
                    }
                }
            }
            
            // Pequeña pausa antes de la siguiente petición
            await context.sleep(500);
            
        } catch (e) {
            // Si es una cancelación (usuario cerró ventana), salir limpiamente
            if (e.name === 'AbortError') {
                context.log('[*] Bot stopped by user');
                break;
            }
            
            // Cualquier otro error: esperar y reintentar
            context.log(`[!] Connection error - retrying in 5 seconds...`);
            await context.sleep(5000);
            // Continuar el bucle (no se detiene)
        }
    }
}

// ============================================================
// INICIALIZACIÓN DEL BOT
// ============================================================

(async function init() {
    context.log('========================================');
    context.log('  YuanBot v3.0 - Always On (Chinese)');
    context.log('========================================');
    context.log('[*] Initializing system...');
    
    // Cargar o solicitar token de GitHub
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
            context.log('[!] Stored token is invalid, requesting new one...');
            const tokenProvided = await requestGitHubToken();
            if (tokenProvided) {
                await testToken();
            }
        }
    }
    
    // Cargar productos iniciales
    await obtenerProductos();
    
    context.log('[*] System initialization complete');
    context.log('[*] Bot is now running and will stay online');
    context.log('[*] Press "Detener" in Process Manager to stop');
    context.log('');
    
    // Iniciar el bucle de polling (no termina hasta que se aborte)
    pollTelegram();
    
    // Manejar la señal de abort (cuando el usuario detiene el proceso)
    context.signal.addEventListener('abort', () => {
        context.log('[!] Bot process terminated by user');
    });
})();
