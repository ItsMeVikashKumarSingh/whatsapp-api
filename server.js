const express = require('express');
const { makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const cors = require('cors');

const app = express();
app.use(express.json());

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
  credentials: true
};
app.use(cors(corsOptions));

// Environment variables
const PORT = process.env.PORT || 3000;
const SESSION_DIR = process.env.SESSION_DIR || './auth_info';
const BOT_NAME = process.env.BOT_NAME || 'Customer Registration Bot';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const AUTO_RECONNECT = process.env.AUTO_RECONNECT !== 'false';
const RECONNECT_DELAY = parseInt(process.env.RECONNECT_DELAY) || 5000;

// Logging function
function log(level, message) {
  const levels = { error: 0, warn: 1, info: 2, debug: 3 };
  const currentLevel = levels[LOG_LEVEL] || 2;
  if (levels[level] <= currentLevel) {
    console.log(`[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`);
  }
}

let sock = null;
let qrString = '';
let isConnected = false;

async function startWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      browser: [BOT_NAME, 'Chrome', '1.0.0'],
      defaultQueryTimeoutMs: 60000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        log('info', 'QR Code generated');
        try {
          qrString = await qrcode.toDataURL(qr);
        } catch (err) {
          log('error', 'QR Code generation failed: ' + err.message);
        }
      }

      if (connection === 'open') {
        log('info', '✅ Connected to WhatsApp');
        isConnected = true;
        qrString = '';
      }

      if (connection === 'close') {
        log('warn', '❌ Connection closed');
        isConnected = false;
        
        const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect && AUTO_RECONNECT) {
          log('info', `🔄 Reconnecting in ${RECONNECT_DELAY}ms...`);
          setTimeout(() => startWhatsApp(), RECONNECT_DELAY);
        } else {
          log('error', 'Logged out from WhatsApp. Please scan QR again.');
        }
      }
    });

    sock.ev.on('messages.upsert', (m) => {
      log('debug', `Received ${m.messages.length} message(s)`);
    });

  } catch (error) {
    log('error', 'Failed to start WhatsApp: ' + error.message);
    setTimeout(() => startWhatsApp(), RECONNECT_DELAY);
  }
}

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    connected: isConnected,
    service: 'WhatsApp Customer Notification API',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Get QR Code for authentication
app.get('/qr', (req, res) => {
  if (isConnected) {
    res.json({ 
      status: 'connected', 
      message: 'Already connected to WhatsApp',
      timestamp: new Date().toISOString()
    });
  } else if (qrString) {
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>WhatsApp QR Code</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: Arial; display: flex; flex-direction: column; align-items: center; padding: 20px; background: #f5f5f5; }
            .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            h2 { color: #25D366; margin-bottom: 20px; }
            img { max-width: 300px; border: 2px solid #25D366; border-radius: 10px; }
            p { color: #666; text-align: center; margin-top: 15px; }
            .status { background: #e3f2fd; padding: 10px; border-radius: 5px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>📱 Scan QR Code with WhatsApp</h2>
            <img src="${qrString}" alt="QR Code" />
            <p><strong>Steps:</strong><br>
            1. Open WhatsApp on your phone<br>
            2. Go to Settings → Linked Devices<br>
            3. Tap "Link a Device"<br>
            4. Scan this QR code</p>
            <div class="status">
              🔄 Page will refresh automatically in 15 seconds
            </div>
          </div>
          <script>setTimeout(() => location.reload(), 15000);</script>
        </body>
      </html>
    `);
  } else {
    res.json({ 
      status: 'loading', 
      message: 'QR Code not ready, please wait...',
      timestamp: new Date().toISOString()
    });
  }
});

// Send message endpoint (main functionality)
app.post('/send-message', async (req, res) => {
  try {
    const { phone, message } = req.body;

    // Input validation
    if (!phone || !message) {
      return res.status(400).json({
        success: false,
        error: 'Phone number and message are required',
        example: { phone: "919999999999", message: "Hello World" }
      });
    }

    if (!sock || !isConnected) {
      return res.status(503).json({
        success: false,
        error: 'WhatsApp not connected. Please scan QR code first.',
        qrUrl: `${req.protocol}://${req.get('host')}/qr`
      });
    }

    // Clean phone number (remove +, spaces, dashes, etc.)
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    
    if (cleanPhone.length < 10) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format',
        received: phone,
        cleaned: cleanPhone
      });
    }

    const whatsappNumber = `${cleanPhone}@s.whatsapp.net`;

    // Send message
    const result = await sock.sendMessage(whatsappNumber, { text: message });

    log('info', `✅ Message sent to ${phone}: ${message.substring(0, 50)}...`);
    
    res.json({
      success: true,
      message: 'Message sent successfully',
      data: {
        to: phone,
        cleanPhone: cleanPhone,
        messageLength: message.length,
        messageId: result.key.id,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    log('error', `❌ Send message error: ${error.message}`);
    
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get connection status
app.get('/status', (req, res) => {
  res.json({
    connected: isConnected,
    qrReady: !!qrString,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Test endpoint for Spring Boot integration
app.post('/test', async (req, res) => {
  const testPhone = req.body.phone || '919999999999';
  const testMessage = req.body.message || '🎉 Test message from WhatsApp API - Customer Registration System is working!';

  if (!isConnected) {
    return res.status(503).json({
      success: false,
      error: 'WhatsApp not connected',
      qrUrl: `${req.protocol}://${req.get('host')}/qr`
    });
  }

  try {
    const cleanPhone = testPhone.replace(/[^0-9]/g, '');
    const whatsappNumber = `${cleanPhone}@s.whatsapp.net`;
    
    await sock.sendMessage(whatsappNumber, { text: testMessage });
    
    res.json({
      success: true,
      message: 'Test message sent successfully',
      to: testPhone,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Start server
const port = PORT || 3000;
app.listen(port, () => {
  log('info', `🚀 WhatsApp API Server running on port ${port}`);
  log('info', `📱 Visit http://localhost:${port}/qr to scan QR code`);
  log('info', `💻 Health check: http://localhost:${port}/`);
  log('info', `🔗 Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // Start WhatsApp connection
  startWhatsApp();
});

// Graceful shutdown
process.on('SIGINT', () => {
  log('info', 'Shutting down gracefully...');
  if (sock) {
    sock.end();
  }
  process.exit(0);
});
