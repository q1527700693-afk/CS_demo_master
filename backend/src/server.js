const app = require('./app');

const port = process.env.PORT || 8000;

app.listen(port, () => {
    console.log(`CS Demo Master backend started on http://localhost:${port}`);
});
