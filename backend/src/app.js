const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const lobbyRoutes = require('./routes/lobbies');
const demoRoutes = require('./routes/demos');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/v1/health', (request, response) => {
    response.json({
        code: 0,
        message: 'success',
        data: {
            status: 'ok'
        }
    });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/lobbies', lobbyRoutes);
app.use('/api/v1/demos', demoRoutes);

app.use((error, request, response, next) => {
    response.status(500).json({
        code: 50000,
        message: 'Internal server error',
        data: null
    });
});

module.exports = app;
