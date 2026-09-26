const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// The report window receives only the narrowly scoped report bridge.  It has
// no access to workspace, credentials, media, or arbitrary shell/file APIs.
contextBridge.exposeInMainWorld('reportAPI', {
  getConfig: () => ipcRenderer.invoke('reports:get-config'),
  chooseVault: () => ipcRenderer.invoke('reports:choose-vault'),
  openVault: () => ipcRenderer.invoke('reports:open-vault'),
  get: ({ type, key, version } = {}) => ipcRenderer.invoke('reports:get', { type, key, version }),
  list: ({ type } = {}) => ipcRenderer.invoke('reports:list', { type }),
  weeklySources: ({ weekKey } = {}) => ipcRenderer.invoke('reports:sources', { weekKey }),
  save: (payload = {}) => ipcRenderer.invoke('reports:save', {
    type: payload.type,
    key: payload.key,
    content: payload.content,
    expectedRevision: payload.expectedRevision == null ? null : payload.expectedRevision,
    confirmed: payload.confirmed === true,
  }),
  copy: ({ type, key, revision, confirmed } = {}) => ipcRenderer.invoke('reports:copy', {
    type,
    key,
    revision,
    confirmed: confirmed === true,
  }),
  returnHome: () => ipcRenderer.invoke('reports:return-home'),
  onFocusType: (callback) => subscribe('reports:focus-type', callback),
});
