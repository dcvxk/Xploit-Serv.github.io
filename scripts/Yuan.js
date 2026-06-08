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

// ===== GITHUB TOKEN =====
function saveGitHubToken(token) {
    try { localStorage.setItem(STORAGE_TOKEN_KEY, token); context.log('[*] GitHub token saved'); } catch(e) {}
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
            'Enter your GitHub Personal Access Token:\n\nRequired for write access.\nLeave empty for read-only mode.',
            ''
        );
        if (token && (token.startsWith('ghp_') || token.startsWith('github_pat_'))) {
            GITHUB_TOKEN = token;
            saveGitHubToken(token);
            context.log('[*] GitHub token configured');
            resolve(true);
        } else if (token) {
            context.error('Invalid token format');
            resolve(false);
        } else {
            context.log('[!] Read-only mode');
            GITHUB_TOKEN = null;
            resolve(false);
        }
    });
}

async function testToken() {
    if (!GITHUB_TOKEN) return false;
    try {
        const response = await fetch('https://api.github.com/user', {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' },
            signal: context.signal
        });
        if (response.ok) {
            const user = await response.json();
            context.log(`[*] Authenticated as: ${user.login}`);
            return true;
        }
        context.error('Authentication failed');
        GITHUB_TOKEN = null;
        try { localStorage.removeItem(STORAGE_TOKEN_KEY); } catch(e) {}
        return false;
    } catch(e) {
        if (e.name === 'AbortError') throw e;
        return false;
    }
}

// ===== PRODUCTOS =====
async function obtenerProductos(forceRefresh = false) {
    const now = Date.now() / 1000;
    if (!forceRefresh && productosCache && (now - cacheTimestamp) < 30) return productosCache;
    try {
        const response = await fetch(RAW_URL, { signal: context.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data?.products) {
            productosCache = data.products;
            cacheTimestamp = now;
            context.log(`[*] Loaded ${productosCache.length} products`);
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
    if (!GITHUB_TOKEN) { context.log('[!] Read-only mode'); return false; }
    try {
        const getRes = await fetch(GITHUB_API_URL, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' },
            signal: context.signal
        });
        let sha = null;
        if (getRes.ok) { const d = await getRes.json(); sha = d.sha; }
        const json = JSON.stringify({ products: productos }, null, 2);
        const b64 = btoa(unescape(encodeURIComponent(json)));
        const putRes = await fetch(GITHUB_API_URL, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message: `Updated ${new Date().toLocaleString()}`, content: b64, branch: "main", ...(sha && { sha }) }),
            signal: context.signal
        });
        if (putRes.ok) { cacheTimestamp = 0; context.log('[*] Saved to GitHub'); return true; }
        const err = await putRes.json();
        context.error(`GitHub error: ${err.message}`);
        return false;
    } catch(e) {
        if (e.name === 'AbortError') throw e;
        context.error(`Save error: ${e.message}`);
        return false;
    }
}

// ===== TELEGRAM =====
async function sendMessage(chatId, text, replyMarkup = null) {
    const payload = { chat_id: chatId, text, parse_mode: 'HTML' };
    if (replyMarkup) payload.reply_markup = JSON.stringify(replyMarkup);
    try {
        await fetch(`${API_URL}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload), signal: context.signal
        });
    } catch(e) { if (e.name !== 'AbortError') context.error(`Send error: ${e.message}`); }
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
    const message = `<b>🤖 元机器人 - 产品管理系统</b>\n\n📦 产品总数: ${total}\n🔐 GitHub: ${GITHUB_TOKEN ? "✅ 已连接" : "⚠️ 只读"}\n⏰ ${new Date().toLocaleString('zh-CN')}\n\n请选择:`;
    await sendMessage(chatId, message, keyboard);
}

async function listProducts(chatId, page = 0) {
    const productos = await obtenerProductos();
    if (!productos?.length) { await sendMessage(chatId, "❌ 暂无产品"); return; }
    const perPage = 8, totalPages = Math.ceil(productos.length / perPage);
    const start = page * perPage, end = Math.min(start + perPage, productos.length);
    let msg = `<b>📋 产品目录</b>\n━━━━━━━━━━━━━━\n第 ${page+1}/${totalPages} 页 | 共 ${productos.length} 个\n━━━━━━━━━━━━━━\n\n`;
    for (let i = start; i < end; i++) {
        const p = productos[i];
        msg += `<b>${i+1}. ${p.name||'N/A'}</b>\n🆔 ${p.ID||'N/A'} | 💰 ${p.price||'N/A'} | 🏷️ ${p.brand||'N/A'} | 🚚 ${p.shipping||'N/A'}\n\n`;
    }
    const nav = [];
    if (page > 0) nav.push({ text: "◀️ 上一页", callback_data: `page_${page-1}` });
    if (page < totalPages - 1) nav.push({ text: "下一页 ▶️", callback_data: `page_${page+1}` });
    const keyboard = { inline_keyboard: [...(nav.length ? [nav] : []), [{ text: "🏠 主菜单", callback_data: "main_menu" }]] };
    await sendMessage(chatId, msg, keyboard);
}

async function showStats(chatId) {
    const productos = await obtenerProductos();
    if (!productos?.length) { await sendMessage(chatId, "❌ 暂无数据"); return; }
    const marcas = {}, precios = [];
    for (const p of productos) {
        marcas[p.brand||'未知'] = (marcas[p.brand||'未知']||0) + 1;
        const pr = parseFloat((p.price||'0').replace('$',''));
        if (!isNaN(pr)) precios.push(pr);
    }
    const topMarca = Object.keys(marcas).reduce((a,b) => marcas[a] > marcas[b] ? a : b, 'N/A');
    const min = precios.length ? Math.min(...precios) : 0;
    const max = precios.length ? Math.max(...precios) : 0;
    const avg = precios.length ? precios.reduce((a,b)=>a+b,0)/precios.length : 0;
    const msg = `<b>📊 统计数据</b>\n\n📦 总数: ${productos.length}\n🏷️ 品牌数: ${Object.keys(marcas).length}\n⭐ 最常见: ${topMarca}\n\n💰 价格\n最低: $${min.toFixed(2)}\n最高: $${max.toFixed(2)}\n平均: $${avg.toFixed(2)}`;
    await sendMessage(chatId, msg, { inline_keyboard: [[{ text: "🏠 主菜单", callback_data: "main_menu" }]] });
}

async function modifyProductSelection(chatId) {
    const productos = await obtenerProductos();
    if (!productos?.length) { await sendMessage(chatId, "❌ 暂无产品"); return; }
    const keyboard = { inline_keyboard: productos.map(p => ([{ text: `${p.ID} - ${p.name.substring(0,35)}`, callback_data: `select_${p.ID}` }])) };
    keyboard.inline_keyboard.push([{ text: "🏠 主菜单", callback_data: "main_menu" }]);
    await sendMessage(chatId, `✏️ 选择产品 (共 ${productos.length} 个)`, keyboard);
}

async function showModifyOptions(chatId, productId) {
    const productos = await obtenerProductos();
    const p = productos.find(x => x.ID === productId);
    if (!p) { await sendMessage(chatId, "❌ 未找到"); return; }
    userSessions[chatId] = { productId };
    const msg = `✏️ 修改: ${p.name}\n\n💰 价格: ${p.price}\n🚚 运费: ${p.shipping}\n📝 描述: ${(p.description||'无').substring(0,60)}...\n\n选择字段:`;
    const kb = {
        inline_keyboard: [
            [{ text: "💰 价格", callback_data: `modify_price_${productId}` }],
            [{ text: "🚚 运费", callback_data: `modify_shipping_${productId}` }],
            [{ text: "📝 描述", callback_data: `modify_desc_${productId}` }],
            [{ text: "◀️ 返回", callback_data: "modify_product_start" }],
            [{ text: "🏠 主菜单", callback_data: "main_menu" }]
        ]
    };
    await sendMessage(chatId, msg, kb);
}

async function processPriceChange(chatId, productId, newPrice) {
    const num = parseFloat(newPrice.replace('$',''));
    if (isNaN(num) || num < 0) { await sendMessage(chatId, "❌ 无效价格"); return; }
    const productos = await obtenerProductos();
    const idx = productos.findIndex(p => p.ID === productId);
    if (idx === -1) { await sendMessage(chatId, "❌ 未找到"); return; }
    const old = productos[idx].price;
    productos[idx].price = `$${num.toFixed(2)}`;
    if (await actualizarGitHub(productos)) {
        await sendMessage(chatId, `✅ 价格更新\n产品: ${productos[idx].name}\n${old} → $${num.toFixed(2)}`);
    } else {
        await sendMessage(chatId, "❌ 保存失败");
    }
}

async function processShippingChange(chatId, productId, newShipping) {
    const num = parseFloat(newShipping.replace('$',''));
    if (isNaN(num) || num < 0) { await sendMessage(chatId, "❌ 无效运费"); return; }
    const productos = await obtenerProductos();
    const idx = productos.findIndex(p => p.ID === productId);
    if (idx === -1) { await sendMessage(chatId, "❌ 未找到"); return; }
    const old = productos[idx].shipping;
    productos[idx].shipping = `$${num.toFixed(2)}`;
    if (await actualizarGitHub(productos)) {
        await sendMessage(chatId, `✅ 运费更新\n产品: ${productos[idx].name}\n${old} → $${num.toFixed(2)}`);
    } else {
        await sendMessage(chatId, "❌ 保存失败");
    }
}

async function processDescriptionChange(chatId, productId, newDesc) {
    const productos = await obtenerProductos();
    const idx = productos.findIndex(p => p.ID === productId);
    if (idx === -1) { await sendMessage(chatId, "❌ 未找到"); return; }
    const old = productos[idx].description || '无';
    productos[idx].description = newDesc;
    if (await actualizarGitHub(productos)) {
        await sendMessage(chatId, `✅ 描述更新\n产品: ${productos[idx].name}\n${old.substring(0,40)}... → ${newDesc.substring(0,40)}...`);
    } else {
        await sendMessage(chatId, "❌ 保存失败");
    }
}

// ===== HANDLERS =====
async function handleCallback(cq) {
    const chatId = cq.message?.chat?.id;
    if (!chatId) return;
    const data = cq.data;
    fetch(`${API_URL}/answerCallbackQuery`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: cq.id }), signal: context.signal
    }).catch(()=>{});
    
    if (data === "main_menu") await sendMainMenu(chatId);
    else if (data === "list_products") await listProducts(chatId);
    else if (data === "modify_product_start") await modifyProductSelection(chatId);
    else if (data === "stats") await showStats(chatId);
    else if (data === "refresh") { await obtenerProductos(true); await sendMessage(chatId, "✅ 已刷新"); await sendMainMenu(chatId); }
    else if (data === "help") {
        await sendMessage(chatId, `❓ 帮助\n\n/start 主菜单\n/list 产品列表\n/stats 统计\n/change ID 价格\n/shipping ID 运费\n/description ID 描述\n/cancel 取消`);
    }
    else if (data.startsWith("page_")) await listProducts(chatId, parseInt(data.split("_")[1]));
    else if (data.startsWith("select_")) await showModifyOptions(chatId, data.replace("select_",""));
    else if (data.startsWith("modify_price_")) {
        const pid = data.replace("modify_price_","");
        userSessions[chatId] = { action: 'waiting_price', productId: pid };
        await sendMessage(chatId, "💰 输入新价格 (例: 45.99)\n/cancel 取消");
    }
    else if (data.startsWith("modify_shipping_")) {
        const pid = data.replace("modify_shipping_","");
        userSessions[chatId] = { action: 'waiting_shipping', productId: pid };
        await sendMessage(chatId, "🚚 输入新运费 (例: 5.99)\n/cancel 取消");
    }
    else if (data.startsWith("modify_desc_")) {
        const pid = data.replace("modify_desc_","");
        userSessions[chatId] = { action: 'waiting_description', productId: pid };
        await sendMessage(chatId, "📝 输入新描述\n/cancel 取消");
    }
}

async function handleMessage(msg) {
    const chatId = msg.chat.id, text = msg.text;
    if (!text) return;
    if (text === '/start') await sendMainMenu(chatId);
    else if (text === '/list') await listProducts(chatId);
    else if (text === '/stats') await showStats(chatId);
    else if (text === '/cancel') { delete userSessions[chatId]; await sendMessage(chatId, "❌ 已取消"); await sendMainMenu(chatId); }
    else if (text.startsWith('/change')) {
        const parts = text.split(' ');
        if (parts.length !== 3) await sendMessage(chatId, "❌ 用法: /change ID 价格");
        else await processPriceChange(chatId, parts[1], parts[2]);
    }
    else if (text.startsWith('/shipping')) {
        const parts = text.split(' ');
        if (parts.length !== 3) await sendMessage(chatId, "❌ 用法: /shipping ID 运费");
        else await processShippingChange(chatId, parts[1], parts[2]);
    }
    else if (text.startsWith('/description')) {
        const parts = text.split(' ');
        if (parts.length < 3) await sendMessage(chatId, "❌ 用法: /description ID 描述");
        else await processDescriptionChange(chatId, parts[1], parts.slice(2).join(' '));
    }
    else if (userSessions[chatId]) {
        const s = userSessions[chatId];
        if (s.action === 'waiting_price') { await processPriceChange(chatId, s.productId, text); delete userSessions[chatId]; }
        else if (s.action === 'waiting_shipping') { await processShippingChange(chatId, s.productId, text); delete userSessions[chatId]; }
        else if (s.action === 'waiting_description') { await processDescriptionChange(chatId, s.productId, text); delete userSessions[chatId]; }
    }
}

// ===== POLLING LOOP =====
async function pollTelegram() {
    // Saltar a último update_id para evitar mensajes antiguos
    try {
        const r = await fetch(`${API_URL}/getUpdates?offset=-1`, { signal: context.signal });
        const d = await r.json();
        if (d.ok && d.result.length) lastUpdateId = d.result[d.result.length-1].update_id;
    } catch(e) { if (e.name === 'AbortError') return; }

    context.log('[*] Bot polling started (800ms interval, 25s timeout)');

    while (botActive && !context.signal.aborted) {
        try {
            const url = `${API_URL}/getUpdates?timeout=25&offset=${lastUpdateId + 1}`;
            const response = await fetch(url, { signal: context.signal });
            if (response.status === 409) {
                context.error('[!] 409 Conflict: Another instance running. Stopping.');
                botActive = false;
                break;
            }
            const data = await response.json();
            if (data.ok && data.result) {
                for (const u of data.result) {
                    if (u.update_id > lastUpdateId) {
                        lastUpdateId = u.update_id;
                        if (u.message) await handleMessage(u.message);
                        if (u.callback_query) await handleCallback(u.callback_query);
                    }
                }
            } else if (!data.ok) {
                context.error(`API error: ${data.description}`);
                await context.sleep(5000);
            }
        } catch(e) {
            if (e.name === 'AbortError') { context.log('Bot stopped.'); break; }
            // Silent error for network issues
            await context.sleep(2000);
        }
    }
}

// ===== INIT =====
(async function init() {
    context.log('[*] YuanBot System v2.0 (Chinese)');
    
    if (!loadGitHubToken()) {
        context.log('[!] GitHub token needed');
        const ok = await requestGitHubToken();
        if (ok) await testToken();
    } else {
        const valid = await testToken();
        if (!valid) {
            context.log('[!] Stored token invalid');
            const ok = await requestGitHubToken();
            if (ok) await testToken();
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
