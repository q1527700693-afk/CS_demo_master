require('dotenv').config();

const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const lobbyRoutes = require('./routes/lobbies');
const demoRoutes = require('./routes/demos');

const errorHandler = require('./middlewares/errorHandler');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/v1/health', (request, response) => {
    response.json({
        code: 0,
        message: 'success',
        data: {
            status: 'ok',
        },
    });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/lobbies', lobbyRoutes);
app.use('/api/v1/demos', demoRoutes);

// 未匹配到任何路由。
app.use((request, response) => {
    response.status(404).json({
        code: 40400,
        message: '资源不存在',
        data: null,
    });
});

app.use(errorHandler);

module.exports = app;
