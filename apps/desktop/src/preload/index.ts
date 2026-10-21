import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import { CHANNELS, type DesktopApi, type MenuCommand } from "../shared/api";

/** Subscribes `listener` to `channel`; the returned function unsubscribes. */
function listen<T extends unknown[]>(channel: string, listener: (...args: T) => void) {
  const handler = (_event: IpcRendererEvent, ...args: unknown[]) => listener(...(args as T));
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.off(channel, handler);
  };
}

const api: DesktopApi = {
  openFile: () => ipcRenderer.invoke(CHANNELS.openFile),
  readFile: (path) => ipcRenderer.invoke(CHANNELS.readFile, path),
  saveFile: (path, suggestedName, bytes) =>
    ipcRenderer.invoke(CHANNELS.saveFile, path, suggestedName, bytes),
  recentFiles: () => ipcRenderer.invoke(CHANNELS.recentFiles),
  readData: (file) => ipcRenderer.invoke(CHANNELS.readData, file),
  writeData: (file, data) => ipcRenderer.invoke(CHANNELS.writeData, file, data),
  writeRecovery: (recovery, bytes) => ipcRenderer.invoke(CHANNELS.writeRecovery, recovery, bytes),
  deleteRecovery: (id) => ipcRenderer.invoke(CHANNELS.deleteRecovery, id),
  listRecoveries: () => ipcRenderer.invoke(CHANNELS.listRecoveries),
  readRecovery: (id) => ipcRenderer.invoke(CHANNELS.readRecovery, id),
  askUnsaved: (name) => ipcRenderer.invoke(CHANNELS.askUnsaved, name),
  setWindowState: (state) => ipcRenderer.send(CHANNELS.setWindowState, state),
  closeWindow: () => ipcRenderer.send(CHANNELS.closeWindow),
  takePendingPaths: () => ipcRenderer.invoke(CHANNELS.takePendingPaths),
  trackEvent: (event) => ipcRenderer.send(CHANNELS.trackEvent, event),
  reportError: (error) => ipcRenderer.send(CHANNELS.reportError, error),
  getLocale: () => ipcRenderer.invoke(CHANNELS.getLocale),
  setLocale: (locale) => ipcRenderer.invoke(CHANNELS.setLocale, locale),
  onMenu: (listener) => listen<[MenuCommand]>(CHANNELS.menu, listener),
  onOpenPath: (listener) => listen<[string]>(CHANNELS.openPath, listener),
  onCloseRequest: (listener) => listen<[]>(CHANNELS.closeRequest, listener),
};

contextBridge.exposeInMainWorld("furrow", api);
