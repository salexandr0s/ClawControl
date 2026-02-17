import { contextBridge, ipcRenderer } from 'electron'

interface DirectoryPickerResponse {
  canceled: boolean
  path: string | null
}

interface ServerRestartResponse {
  ok: boolean
  message: string
}

interface RunModelAuthLoginResponse {
  ok: boolean
  message?: string
}

interface DesktopUpdateInfo {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  releaseUrl: string
  releaseName: string | null
  publishedAt: string | null
  notes: string | null
  error?: string
}

interface WhatsNewSection {
  title: string
  items: string[]
}

interface WhatsNewPayload {
  version: string
  title: string
  publishedAt: string | null
  highlights: string[]
  sections: WhatsNewSection[]
  releaseUrl: string
}

interface OpenExternalUrlResponse {
  ok: boolean
  message?: string
}

interface DesktopSettingsPayload {
  gatewayHttpUrl?: string | null
  gatewayWsUrl?: string | null
  gatewayToken?: string | null
  workspacePath?: string | null
  setupCompleted?: boolean
}

contextBridge.exposeInMainWorld('clawcontrolDesktop', {
  pickDirectory: async (defaultPath?: string): Promise<string | null> => {
    const result = await ipcRenderer.invoke('clawcontrol:pick-directory', {
      defaultPath,
    }) as DirectoryPickerResponse

    if (!result || result.canceled) return null
    return result.path
  },

  restartServer: async (): Promise<ServerRestartResponse> =>
    ipcRenderer.invoke('clawcontrol:restart-server') as Promise<ServerRestartResponse>,

  getSettings: async (): Promise<unknown> =>
    ipcRenderer.invoke('clawcontrol:get-settings') as Promise<unknown>,

  saveSettings: async (payload: DesktopSettingsPayload): Promise<unknown> =>
    ipcRenderer.invoke('clawcontrol:save-settings', payload) as Promise<unknown>,

  getInitStatus: async (): Promise<unknown> =>
    ipcRenderer.invoke('clawcontrol:get-init-status') as Promise<unknown>,

  testGateway: async (payload?: { gatewayHttpUrl?: string; gatewayToken?: string; withRetry?: boolean }): Promise<unknown> =>
    ipcRenderer.invoke('clawcontrol:test-gateway', payload ?? {}) as Promise<unknown>,

  runModelAuthLogin: async (providerId: string): Promise<RunModelAuthLoginResponse> =>
    ipcRenderer.invoke('clawcontrol:run-model-auth-login', { providerId }) as Promise<RunModelAuthLoginResponse>,

  checkForUpdates: async (): Promise<DesktopUpdateInfo> =>
    ipcRenderer.invoke('clawcontrol:check-for-updates') as Promise<DesktopUpdateInfo>,

  getWhatsNew: async (): Promise<WhatsNewPayload | null> =>
    ipcRenderer.invoke('clawcontrol:get-whats-new') as Promise<WhatsNewPayload | null>,

  ackWhatsNew: async (version: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('clawcontrol:ack-whats-new', { version }) as Promise<{ ok: boolean }>,

  openExternalUrl: async (url: string): Promise<OpenExternalUrlResponse> =>
    ipcRenderer.invoke('clawcontrol:open-external-url', { url }) as Promise<OpenExternalUrlResponse>,
})
