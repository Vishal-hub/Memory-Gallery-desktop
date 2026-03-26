const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_INVOKE_CHANNELS = new Set([
  'read-images',
  'refresh-library',
  'get-events',
  'search-semantic',
  'get-index-debug',
  'clear-cache',
  'get-index-roots',
  'set-index-roots',
  'get-people',
  'rename-person',
  'select-folder',
]);

const ALLOWED_RECEIVE_CHANNELS = new Set([
  'indexing-progress',
  'library-refresh-complete',
  'library-change-detected',
  'library-refresh-error',
  'visual-indexing-started',
  'visual-indexing-progress',
  'visual-indexing-complete',
  'face-indexing-started',
  'face-indexing-progress',
  'face-indexing-complete',
  'semantic-indexing-started',
  'semantic-indexing-progress',
  'semantic-indexing-complete',
]);

const ALLOWED_SEND_CHANNELS = new Set([
  'user-activity',
]);

const api = {
  invoke: async (channel, ...args) => {
    if (!ALLOWED_INVOKE_CHANNELS.has(channel)) {
      console.error(`[Preload] Blocked invoke on unknown channel: ${channel}`);
      return null;
    }
    try {
      return await ipcRenderer.invoke(channel, ...args);
    } catch (error) {
      console.error(`[IPC] ${channel} failed:`, error);
      throw error;
    }
  },
  on: (channel, callback) => {
    if (!ALLOWED_RECEIVE_CHANNELS.has(channel)) {
      console.error(`[Preload] Blocked listener on unknown channel: ${channel}`);
      return;
    }
    ipcRenderer.on(channel, callback);
  },
  send: (channel, ...args) => {
    if (!ALLOWED_SEND_CHANNELS.has(channel)) {
      console.error(`[Preload] Blocked send on unknown channel: ${channel}`);
      return;
    }
    ipcRenderer.send(channel, ...args);
  },
  readImages: () => ipcRenderer.invoke('read-images'),
  getIndexDebug: () => ipcRenderer.invoke('get-index-debug'),
};

contextBridge.exposeInMainWorld('api', api);
