const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, BufferJSON } = require('@whiskeysockets/baileys');
const { PrismaClient } = require('@prisma/client');
const qrcodeTerminal = require('qrcode-terminal');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

const prisma = new PrismaClient();
const authFolder = process.env.WHATSAPP_AUTH_PATH || path.join(__dirname, '..', '..', '.baileys_auth');

let sock = null;
let qrCode = null;
let status = 'disconnected'; // 'disconnected' | 'initializing' | 'qr' | 'connected'
let authHandler = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let isInitializing = false;

function getStatus() {
  return { status, qr: qrCode };
}

function convertArabicNums(str) {
  if (!str) return '';
  return str.replace(/[٠-٩]/g, (digit) => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit));
}

function normalizePhoneNumber(phone) {
  if (!phone) return null;
  let singlePhone = String(phone);
  const parts = singlePhone.split(/[\s,/\-;_]+/);
  if (parts.length > 0) {
    const validPart = parts.find((p) => p.replace(/\D/g, '').length >= 10);
    if (validPart) {
      singlePhone = validPart;
    }
  }

  let cleaned = convertArabicNums(singlePhone).replace(/\D/g, '');
  if (cleaned.startsWith('00')) {
    cleaned = cleaned.substring(2);
  }

  if (cleaned.startsWith('01') && cleaned.length === 11) {
    cleaned = '20' + cleaned.substring(1);
  } else if (cleaned.startsWith('20') && cleaned.length === 12) {
    // Valid Egyptian international format
  } else if (cleaned.length === 10 && cleaned.startsWith('1')) {
    cleaned = '20' + cleaned;
  }

  return cleaned || null;
}

async function getPrismaBaileysAuth(authPath) {
  if (!fs.existsSync(authPath)) {
    fs.mkdirSync(authPath, { recursive: true });
  }

  const credsFile = path.join(authPath, 'creds.json');
  if (!fs.existsSync(credsFile)) {
    try {
      const rows = await prisma.whatsAppSession.findMany();
      if (rows.length > 0) {
        console.log(`[WhatsApp] Restoring ${rows.length} session entries from PostgreSQL...`);
        for (const row of rows) {
          const filePath = path.join(authPath, row.key);
          fs.writeFileSync(filePath, row.value, 'utf-8');
        }
      }
    } catch (err) {
      console.error('[WhatsApp] Error restoring session from database:', err.message);
    }
  }

  const { state, saveCreds: baseSaveCreds } = await useMultiFileAuthState(authPath);

  const saveCreds = async () => {
    try {
      await baseSaveCreds();
      if (fs.existsSync(credsFile)) {
        const raw = fs.readFileSync(credsFile, 'utf-8');
        await prisma.whatsAppSession.upsert({
          where: { key: 'creds.json' },
          create: { key: 'creds.json', value: raw },
          update: { value: raw }
        });
      }
    } catch (err) {
      console.error('[WhatsApp] Failed to backup creds to DB:', err.message);
    }
  };

  const baseSet = state.keys.set;
  state.keys.set = async (data) => {
    await baseSet(data);
    try {
      const upserts = [];
      const deletes = [];
      for (const category in data) {
        for (const id in data[category]) {
          const value = data[category][id];
          const fileName = `${category}-${id}.json`.replace(/\//g, '__').replace(/:/g, '-');
          if (value) {
            const raw = JSON.stringify(value, BufferJSON.replacer);
            upserts.push(
              prisma.whatsAppSession.upsert({
                where: { key: fileName },
                create: { key: fileName, value: raw },
                update: { value: raw }
              })
            );
          } else {
            deletes.push(fileName);
          }
        }
      }
      if (upserts.length > 0) {
        await Promise.all(upserts);
      }
      if (deletes.length > 0) {
        await prisma.whatsAppSession.deleteMany({
          where: { key: { in: deletes } }
        });
      }
    } catch (dbErr) {
      console.error('[WhatsApp] Session keys DB sync error:', dbErr.message);
    }
  };

  return {
    state,
    saveCreds,
    clearAuth: async () => {
      try {
        if (fs.existsSync(authPath)) {
          fs.rmSync(authPath, { recursive: true, force: true });
        }
      } catch (e) {
        console.error('[WhatsApp] Failed to clear local auth folder:', e.message);
      }
      try {
        await prisma.whatsAppSession.deleteMany();
      } catch (e) {
        console.error('[WhatsApp] Failed to clear database session table:', e.message);
      }
    }
  };
}

function scheduleReconnect(delayMs = 5000) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    initWhatsApp().catch((err) => {
      console.error('[WhatsApp] Reconnect failed:', err.message);
    });
  }, delayMs);
}

async function initWhatsApp() {
  if (isInitializing) {
    return;
  }
  isInitializing = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (sock) {
    try {
      sock.ev.removeAllListeners();
      sock.end(undefined);
    } catch (e) {}
    sock = null;
  }

  status = 'initializing';
  qrCode = null;
  console.log('[WhatsApp] Initializing Baileys client...');

  try {
    authHandler = await getPrismaBaileysAuth(authFolder);

    sock = makeWASocket({
      auth: authHandler.state,
      logger: pino({ level: 'silent' }),
      browser: Browsers.macOS('Desktop'),
      syncFullHistory: false,
      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 25000
    });

    sock.ev.on('creds.update', authHandler.saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrCode = qr;
        status = 'qr';
        console.log('[WhatsApp] QR code received. Displaying in terminal and awaiting scan...');
        try {
          qrcodeTerminal.generate(qr, { small: true });
        } catch (e) {}
      }

      if (connection === 'open') {
        status = 'connected';
        qrCode = null;
        reconnectAttempts = 0;
        console.log('[WhatsApp] Connection opened successfully. Client is ready.');
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;

        console.log(`[WhatsApp] Connection closed. StatusCode: ${statusCode || 'none'}, LoggedOut: ${Boolean(isLoggedOut)}`);

        if (isLoggedOut) {
          status = 'disconnected';
          qrCode = null;
          await authHandler.clearAuth();
          console.log('[WhatsApp] Device unlinked or logged out. Session deleted. Reinitializing fresh state...');
          scheduleReconnect(1500);
        } else {
          status = 'disconnected';
          const delay = Math.min(3000 * Math.pow(1.5, reconnectAttempts), 30000);
          reconnectAttempts++;
          console.log(`[WhatsApp] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts})...`);
          scheduleReconnect(delay);
        }
      }
    });
  } catch (err) {
    console.error('[WhatsApp] Failed to initialize client:', err.message);
    status = 'disconnected';
    scheduleReconnect(10000);
  } finally {
    isInitializing = false;
  }
}

async function logoutWhatsApp() {
  console.log('[WhatsApp] Logging out...');
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  try {
    if (sock) {
      try {
        await sock.logout();
      } catch (e) {
        console.warn('[WhatsApp] Direct socket logout skipped, terminating connection:', e.message);
      }
      try {
        sock.ev.removeAllListeners();
        sock.end(undefined);
      } catch (e) {}
      sock = null;
    }
  } catch (err) {
    console.error('[WhatsApp] Error during logout:', err.message);
  }

  if (authHandler) {
    await authHandler.clearAuth();
  } else {
    try {
      if (fs.existsSync(authFolder)) {
        fs.rmSync(authFolder, { recursive: true, force: true });
      }
    } catch (e) {}
    try {
      await prisma.whatsAppSession.deleteMany();
    } catch (e) {}
  }

  status = 'disconnected';
  qrCode = null;
  reconnectAttempts = 0;

  setTimeout(() => {
    initWhatsApp().catch((err) => {
      console.error('[WhatsApp] Re-init after logout error:', err.message);
    });
  }, 1000);

  return { success: true };
}

async function sendWhatsAppMessage(phone, message) {
  if (!sock || status !== 'connected') {
    console.warn(`[WhatsApp] Not connected (Status: ${status}). Message to ${phone} not sent.`);
    return false;
  }

  const normalized = normalizePhoneNumber(phone);
  if (!normalized) {
    console.warn(`[WhatsApp] Invalid phone number provided: "${phone}"`);
    return false;
  }

  try {
    let targetJid = `${normalized}@s.whatsapp.net`;
    try {
      const lookup = await sock.onWhatsApp(normalized);
      if (lookup && lookup.length > 0 && lookup[0]?.exists) {
        targetJid = lookup[0].jid;
      }
    } catch (lookupErr) {
      console.warn(`[WhatsApp] JID lookup failed for ${normalized}, using fallback JID`);
    }

    console.log(`[WhatsApp] Sending message to ${targetJid}...`);
    await sock.sendMessage(targetJid, { text: message });
    console.log(`[WhatsApp] Message successfully sent to ${targetJid}`);
    return true;
  } catch (error) {
    console.error(`[WhatsApp] Error sending message to ${phone}:`, error.message);
    return false;
  }
}

module.exports = {
  initWhatsApp,
  logoutWhatsApp,
  sendWhatsAppMessage,
  getStatus
};
