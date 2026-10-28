'use strict';

const { runJob } = require('./services/replayJobRunner');

// The queue also kills the child; this watchdog covers a hung parse that ignores
// the budget (for example while a native decoder is stuck inside a thread).
const budget = Number(process.argv[4]) || 120_000;
setTimeout(() => process.exit(1), budget + 15_000).unref();

runJob(process.argv[2], process.argv[3], (message) => process.send?.(message))
    .then(() => { process.send?.({ ready: true }); process.disconnect?.(); })
    .catch((error) => {
        process.send?.({ error: String(error.message).slice(0, 300) });
        process.exitCode = 1;
        process.disconnect?.();
    });
