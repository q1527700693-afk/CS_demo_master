'use strict';

require('dotenv').config();

const app = require('./app');

const port = process.env.PORT || 8000;

const stopQueue = require('./services/replayQueue').startQueue();
const server = app.listen(port, () => {
    console.log(`CS Demo Master backend started on http://localhost:${port}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    stopQueue(); server.close(() => process.exit(0));
});
