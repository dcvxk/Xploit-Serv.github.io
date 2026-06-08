const TOKEN = "8964315899:AAFTQT_x3QjDVN3XZyV3eXaQBOHDm9PoLlk";
const API = `https://api.telegram.org/bot${TOKEN}`;

let lastUpdateId = 0;

const edades = {
  Juan: 25,
  Eric: 30,
  Rocio: 22
};

async function send(chatId, text) {
  try {
    const response = await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text }),
      signal: context.signal
    });
    const data = await response.json();
    if (!data.ok) {
      context.error("Error enviando mensaje:", data.description);
    }
  } catch (error) {
    if (error.name === 'AbortError') throw error; // Propagar para detener el bucle
    context.error("Error en send:", error.message);
  }
}

async function processMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();

  if (text === "/start") {
    await send(chatId, "¡Hola! Soy un bot de ejemplo. Usa /list para ver nombres o /edad [nombre] para saber la edad.");
    return;
  }

  if (text === "/list") {
    const nombres = Object.keys(edades);
    if (nombres.length > 0) {
      await send(chatId, "📋 Nombres disponibles:\n" + nombres.join("\n"));
    } else {
      await send(chatId, "No hay nombres en la lista.");
    }
    return;
  }

  if (text.startsWith("/edad ")) {
    const nombre = text.substring(6).trim();
    if (!nombre) {
      await send(chatId, "❌ Debes especificar un nombre. Ejemplo: /edad Juan");
      return;
    }
    const nombreEncontrado = Object.keys(edades).find(
      key => key.toLowerCase() === nombre.toLowerCase()
    );
    if (nombreEncontrado) {
      await send(chatId, `✅ ${nombreEncontrado} tiene ${edades[nombreEncontrado]} años`);
    } else {
      await send(chatId, `❌ No conozco a ${nombre}. Usa /list para ver los nombres disponibles.`);
    }
    return;
  }

  await send(chatId, "❓ Comando no reconocido. Usa /start para ayuda.");
}

async function poll() {
  // Bucle principal controlado por señal de cancelación
  while (!context.signal.aborted) {
    try {
      const res = await fetch(
        `${API}/getUpdates?offset=${lastUpdateId + 1}&timeout=25`,
        { signal: context.signal }
      );
      const data = await res.json();

      if (!data.ok) {
        if (data.error_code === 409) {
          context.error("❌ Error 409: Otra instancia del bot está corriendo. Detén las demás instancias.");
          return; // Salir del bucle
        }
        context.error("Error en getUpdates:", data.description);
        await context.sleep(5000); // Esperar antes de reintentar
        continue;
      }

      for (const update of data.result) {
        lastUpdateId = update.update_id;
        if (update.message) {
          await processMessage(update.message);
        }
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        context.log("Bot detenido.");
        break;
      }
      context.log("Error de conexión:", e.message);
      await context.sleep(5000); // Esperar antes de reintentar
    }
  }
}

context.log("🤖 Bot iniciado correctamente");
poll(); // Iniciar el polling