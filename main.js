const { startApp } = require('./src/main');

process.on('uncaughtException', (error) => {
    console.error('[Fatal] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
    console.error('[Fatal] Unhandled promise rejection:', reason);
});

startApp();