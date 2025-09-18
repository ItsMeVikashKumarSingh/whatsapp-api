import express from 'express';
import { makeWASocket, DisconnectReason, useMultiFileAuthState } from 'baileys';
import qrcode from 'qrcode';
import cors from 'cors';

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;
const SESSION_DIR = './auth_info';
const BOT_NAME = process.env.BOT_NAME || 'Customer Registration Bot';

let sock = null;
let qrString = '';
let isConnected = false;

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

async function startWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      browser: [BOT_NAME, 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        log('QR Code generated');
        qrString = await qrcode.toDataURL(qr);
      }

      if (connection === 'open') {
        log('✅ Connected to WhatsApp');
        isConnected = true;
        qrString = '';
      }

      if (connection === 'close') {
        log('❌ Connection closed');
        isConnected = false;
        const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          log('🔄 Reconnecting in 5 seconds...');
          setTimeout(() => startWhatsApp(), 5000);
        }
      }
    });
  } catch (error) {
    log('Failed to start WhatsApp: ' + error.message);
    setTimeout(() => startWhatsApp(), 5000);
  }
}

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    connected: isConnected,
    timestamp: new Date().toISOString()
  });
});

// QR Code endpoint
app.get('/qr', (req, res) => {
  if (isConnected) {
    res.json({ status: 'connected', message: 'Already connected to WhatsApp' });
  } else if (qrString) {
    res.send(`
      <html>
        <body style="display:flex;flex-direction:column;align-items:center;padding:20px;">
          <h2>📱 Scan QR Code with WhatsApp</h2>
          <img src="${qrString}" alt="QR Code" style="max-width:400px;" />
          <p>Open WhatsApp → Settings → Linked Devices → Link a Device</p>
          <script>setTimeout(() => location.reload(), 15000);</script>
        </body>
      </html>
    `);
  } else {
    res.json({ status: 'loading', message: 'QR Code not ready, please wait...' });
  }
});

// Send message endpoint
app.post('/send-message', async (req, res) => {
  try {
    const { phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({
        success: false,
        error: 'Phone number and message are required'
      });
    }

    if (!sock || !isConnected) {
      return res.status(503).json({
        success: false,
        error: 'WhatsApp not connected. Please scan QR code first.',
        qrUrl: `${req.protocol}://${req.get('host')}/qr`
      });
    }

    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const whatsappNumber = `${cleanPhone}@s.whatsapp.net`;

    await sock.sendMessage(whatsappNumber, { text: message });

    log(`✅ Message sent to ${phone}: ${message}`);
    
    res.json({
      success: true,
      message: 'Message sent successfully',
      to: phone,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    log(`❌ Send message error: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Status endpoint
app.get('/status', (req, res) => {
  res.json({
    connected: isConnected,
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, () => {
  log(`🚀 WhatsApp API Server running on port ${PORT}`);
  log(`📱 Visit /qr to scan QR code`);
  startWhatsApp();
});
