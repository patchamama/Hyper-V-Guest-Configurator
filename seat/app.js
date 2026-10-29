'use strict';
// Standalone "Dedicated Seat" app: assign a USB mouse/keyboard exclusively to an RDP session or a kiosk
// browser running in WSL. Must run elevated (usbipd bind). Open http://localhost:3100
const express = require('express');
const path = require('path');
const seat = require('./seat-lib');

const PORT = Number(process.env.SEAT_PORT) || 3100;
const app = express();
app.use('/api/seat', seat.router());
app.use(express.static(path.join(__dirname, 'public')));
app.listen(PORT, () => console.log(`Dedicated Seat app: http://localhost:${PORT}`));
