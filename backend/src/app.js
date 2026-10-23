'use strict';

const express = require('express');
const cors = require('cors');
const fs = require('node:fs');
const path = require('node:path');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const lobbyRoutes = require('./routes/lobbies');
const friendRoutes = require('./routes/friends');
const demoRoutes = require('./routes/demos');
const errorHandler = require('./middlewares/errorHandler');
const { success } = require('./utils/response');

const uploadsDir = path.resolve(
    process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads')
);
// Both upload folders from the directory layout in TASKS.md 2 are prepared on
// boot; the demo module will write into demo-logs later.
fs.mkdirSync(path.join(uploadsDir, 'avatars'), { recursive: true });
fs.mkdirSync(path.join(uploadsDir, 'demo-logs'), { recursive: true });

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Avatars are user supplied images served from the API origin: forbid the
// browser from sniffing them into something else.
app.use(
    '/uploads',
    (request, response, next) => {
        response.setHeader('X-Content-Type-Options', 'nosniff');
        next();
    },
    express.static(uploadsDir, { fallthrough: true, index: false })
);

app.get('/api/v1/health', (request, response) => success(response, { status: 'ok' }));

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/lobbies', lobbyRoutes);
app.use('/api/v1/friends', friendRoutes);
app.use('/api/v1/demos', demoRoutes);

app.use((request, response) =>
    response.status(404).json({ code: 40400, message: 'Resource not found', data: null })
);

app.use(errorHandler);

module.exports = app;
