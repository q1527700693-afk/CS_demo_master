const app = require('./app');

const port = Number(process.env.PORT) || 8000;
const host = process.env.HOST || '127.0.0.1';

app.listen(port, host, () => {
    console.log(`CS Demo Master backend started on http://${host}:${port}`);
});
