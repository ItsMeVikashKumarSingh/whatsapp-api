# WhatsApp Customer Notification API

Simple REST API for sending WhatsApp messages to customers using Baileys library.

## Features

- 📱 Send WhatsApp messages via REST API
- 🔄 Auto-reconnection handling
- 📊 Connection status monitoring
- 🎯 Perfect for customer notifications

## Quick Start

1. Clone this repository
2. Run `npm install`
3. Run `npm start`
4. Visit `http://localhost:3000/qr` to scan QR code
5. Send messages via POST to `/send-message`

## API Endpoints

- `GET /` - Health check
- `GET /qr` - Display QR code for authentication
- `GET /status` - Connection status
- `POST /send-message` - Send WhatsApp message

### Send Message Example

