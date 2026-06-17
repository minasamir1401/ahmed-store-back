const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

const authPath = process.env.WHATSAPP_AUTH_PATH || path.join(__dirname, '.wwebjs_auth');

let client = null;
let qrCode = null;
let status = 'disconnected'; // 'disconnected', 'initializing', 'qr', 'connected'

function getStatus() {
  return { status, qr: qrCode };
}

function convertArabicNums(str) {
  if (!str) return '';
  return str.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}

function initWhatsApp() {
  if (client) {
    try {
      client.destroy();
    } catch (e) {
      console.error('Error destroying existing client:', e);
    }
  }

  status = 'initializing';
  qrCode = null;
  console.log('Initializing WhatsApp Client...');

  try {
    // Ensure parent directory for dataPath exists
    const parentDir = path.dirname(authPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    client = new Client({
      authStrategy: new LocalAuth({
        dataPath: authPath
      }),
      puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || (process.platform === 'linux' ? '/usr/bin/chromium-browser' : undefined),
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu'
        ],
        protocolTimeout: 180000
      }
    });

    client.on('qr', (qr) => {
      console.log('=== WhatsApp QR Code Received ===');
      qrcode.generate(qr, { small: true });
      qrCode = qr;
      status = 'qr';
    });

    client.on('ready', () => {
      console.log('WhatsApp Client is Ready and Connected! 🎉');
      status = 'connected';
      qrCode = null;
    });

    client.on('authenticated', () => {
      console.log('WhatsApp Client Authenticated!');
    });

    client.on('auth_failure', (msg) => {
      console.error('WhatsApp Authentication Failure:', msg);
      status = 'disconnected';
      qrCode = null;
    });

    client.on('disconnected', (reason) => {
      console.log('WhatsApp Client was Disconnected:', reason);
      status = 'disconnected';
      qrCode = null;
      // Re-initialize after delay
      setTimeout(() => initWhatsApp(), 5000);
    });

    client.initialize().catch(err => {
      console.error('Failed to initialize WhatsApp client:', err);
      status = 'disconnected';
    });
  } catch (error) {
    console.error('Error starting WhatsApp client:', error);
    status = 'disconnected';
  }
}

async function logoutWhatsApp() {
  console.log('Logging out of WhatsApp...');
  try {
    if (client) {
      if (status === 'connected') {
        await client.logout();
      }
      await client.destroy();
    }
  } catch (err) {
    console.error('Error during WhatsApp logout:', err);
  }

  // Clear auth session folder just to be sure
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
  client = null;

  // Restart client so it generates a new QR code
  initWhatsApp();
}

async function sendWhatsAppMessage(phone, message) {
  if (!client || status !== 'connected') {
    console.warn(`WhatsApp not connected (Status: ${status}). Cannot send message to ${phone}`);
    return false;
  }
  try {
    // If phone contains multiple numbers (e.g. separated by hyphen, slash, comma, or space), take the first one
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

    // Convert Arabic numerals to English numerals
    let cleaned = convertArabicNums(singlePhone);

    // Clean phone number from any spaces, plus signs, brackets or text
    let formattedPhone = cleaned.replace(/\D/g, '');
    
    // Strip leading 00 if present
    if (formattedPhone.startsWith('00')) {
      formattedPhone = formattedPhone.substring(2);
    }

    // Egyptian numbers starts with 01 and have 11 digits
    if (formattedPhone.startsWith('01') && formattedPhone.length === 11) {
      formattedPhone = '20' + formattedPhone.substring(1);
    } else if (formattedPhone.startsWith('20') && formattedPhone.length === 12) {
      // Already correct Egyptian number with country code, do nothing
    } else if (formattedPhone.length === 10 && formattedPhone.startsWith('1')) {
      // Egyptian number without leading zero, add country code
      formattedPhone = '20' + formattedPhone;
    }
    
    console.log(`Resolving WhatsApp ID for ${formattedPhone}...`);
    const numberDetails = await client.getNumberId(formattedPhone);
    
    if (!numberDetails) {
      console.warn(`Phone number ${phone} (${formattedPhone}) is not registered on WhatsApp.`);
      return false;
    }
    
    const chatId = numberDetails._serialized;
    console.log(`Sending WhatsApp message to resolved chatId: ${chatId}`);
    await client.sendMessage(chatId, message);
    console.log(`WhatsApp message sent successfully to ${chatId}`);
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
