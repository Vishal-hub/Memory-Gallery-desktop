const path = require('path');
const { app, BrowserWindow } = require('electron');
const { createDb } = require('../../lib/indexer');
const { createMainWindow } = require('./window');
const { registerIpcHandlers } = require('./ipc');
const { createLibraryRefreshManager } = require('./library-refresh');
const { warmVisionModels, warmFaceModels } = require('../../lib/indexer/model-registry');

let latestRunStats = null;

function broadcastToAll(channel, payload) {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  });
}

function configureChromiumCachePaths() {
  const userDataPath = app.getPath('userData');
  app.setPath('sessionData', path.join(userDataPath, 'session-data'));
  app.setPath('userCache', path.join(userDataPath, 'cache'));
  app.commandLine.appendSwitch('disk-cache-dir', path.join(userDataPath, 'cache', 'chromium'));
  app.commandLine.appendSwitch('gpu-shader-disk-cache-size-kb', '0');
}

function startApp() {
  configureChromiumCachePaths();
  app.whenReady().then(() => {
    const dbPath = path.join(app.getPath('userData'), 'memory-index.sqlite');
    const db = createDb(dbPath);
    const refreshManager = createLibraryRefreshManager({
      app,
      db,
      setLatestRunStats: (stats) => {
        latestRunStats = stats;
      },
    });

    registerIpcHandlers({
      app,
      db,
      refreshManager,
      getLatestRunStats: () => latestRunStats,
      setLatestRunStats: (stats) => {
        latestRunStats = stats;
      },
    });

    createMainWindow();
    setTimeout(() => {
      warmVisionModels().catch((error) => {
        console.error('[Models] Vision warmup failed:', error);
        broadcastToAll('model-load-error', {
          message: error.message || 'AI models failed to load',
          hint: 'AI features (tagging, search, face recognition) are unavailable. Check your internet connection and restart the app.',
        });
      });
      warmFaceModels().catch((error) => {
        console.error('[Models] Face model warmup failed:', error);
        broadcastToAll('model-load-error', {
          message: error.message || 'Face recognition models failed to load',
          hint: 'Face recognition will fall back to basic detection. Check your internet connection and restart the app.',
        });
      });
    }, 300);
    refreshManager.startWatching();
    setTimeout(() => {
      refreshManager.checkForStartupChanges().catch((error) => {
        console.error('[LibraryRefresh] Startup delta check failed:', error);
      });
    }, 1200);

    app.on('before-quit', () => {
      refreshManager.dispose();
    });
  });
}

module.exports = {
  startApp,
};
