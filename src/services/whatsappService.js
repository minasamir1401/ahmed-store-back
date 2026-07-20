const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');

const authPath = process.env.WHATSAPP_AUTH_PATH || path.join(__dirname, '..', '..', '.baileys_auth');

let sock = null;
let qrCode = null;
let status = 'disconnected'; // 'disconnected', 'initializing', 'qr', 'connected'

function getStatus() {
  return { status, qr: qrCode };
}

function convertArabicNums(str) {
  if (!str) return '';
  return str.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}

async function initWhatsApp() {
  if (sock) {
    try {
      sock.end();
    } catch (e) {
      console.error('Error ending existing socket:', e);
    }
  }

  status = 'initializing';
  qrCode = null;
  console.log('Initializing WhatsApp Baileys Client...');

  try {
    const parentDir = path.dirname(authPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // Fetch the latest WhatsApp version to avoid 405 Method Not Allowed error
    let version = [2, 3000, 1017531287];
    try {
      const { version: latestVersion } = await fetchLatestBaileysVersion();
      version = latestVersion;
      console.log(`Successfully fetched latest WhatsApp version: ${version.join('.')}`);
    } catch (err) {
      console.warn('Failed to fetch latest WhatsApp version, using default fallback:', err);
    }

    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('=== WhatsApp QR Code Received ===');
        qrcode.generate(qr, { small: true });
        qrCode = qr;
        status = 'qr';
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('WhatsApp connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect);
        status = 'disconnected';
        qrCode = null;
        if (shouldReconnect) {
          setTimeout(() => initWhatsApp(), 5000);
        } else {
          console.log('Logged out of WhatsApp. Clear session and restart to generate new QR.');
        }
      } else if (connection === 'open') {
        console.log('WhatsApp Client is Ready and Connected! 🎉');
        status = 'connected';
        qrCode = null;
      }
    });

  } catch (error) {
    console.error('Error starting WhatsApp client:', error);
    status = 'disconnected';
  }
}

async function logoutWhatsApp() {
  console.log('Logging out of WhatsApp...');
  try {
    if (sock) {
      await sock.logout();
    }
  } catch (err) {
    console.error('Error during WhatsApp logout:', err);
  }

  // Clear auth session folder
  if (fs.existsSync(authPath)) {
    try {
      fs.rmSync(authPath, { recursive: true, force: true });
      console.log('WhatsApp Session files cleared.');
    } catch (e) {
      console.error('Error deleting auth folder:', e);
    }
  }

  status = 'disconnected';
  qrCode = null;
  sock = null;

  // Restart client
  initWhatsApp();
}

async function sendWhatsAppMessage(phone, message) {
  if (!sock || status !== 'connected') {
    console.warn(`WhatsApp not connected (Status: ${status}). Cannot send message to ${phone}`);
    return false;
  }
  try {
    // Clean and format phone number
    let singlePhone = phone;
    if (typeof phone === 'string') {
      const parts = phone.split(/[\s,/\-;_]+/);
      if (parts.length > 0) {
        const validPart = parts.find(p => p.replace(/\D/g, '').length >= 10);
        if (validPart) {
          singlePhone = validPart;
        }
      }
    }

    let cleaned = convertArabicNums(singlePhone);
    let formattedPhone = cleaned.replace(/\D/g, '');
    
    if (formattedPhone.startsWith('00')) {
      formattedPhone = formattedPhone.substring(2);
    }

    if (formattedPhone.startsWith('01') && formattedPhone.length === 11) {
      formattedPhone = '20' + formattedPhone.substring(1);
    } else if (formattedPhone.startsWith('20') && formattedPhone.length === 12) {
      // Correct
    } else if (formattedPhone.length === 10 && formattedPhone.startsWith('1')) {
      formattedPhone = '20' + formattedPhone;
    }

    const jid = `${formattedPhone}@s.whatsapp.net`;
    console.log(`Sending WhatsApp message to jid: ${jid}`);
    
    // Check if number is on WhatsApp
    const [result] = await sock.onWhatsApp(jid);
    if (!result || !result.exists) {
      console.warn(`Phone number ${phone} (${formattedPhone}) is not registered on WhatsApp.`);
      return false;
    }

    await sock.sendMessage(jid, { text: message });
    console.log(`WhatsApp message sent successfully to ${jid}`);
    return true;
  } catch (error) {
    console.error(`Error sending WhatsApp message to ${phone}:`, error);
    return false;
  }
}

module.exports = {
  initWhatsApp,
  logoutWhatsApp,
  sendWhatsAppMessage,
  getStatus
};
