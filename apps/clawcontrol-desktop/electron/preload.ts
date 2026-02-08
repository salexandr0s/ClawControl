import { contextBridge, ipcRenderer } from 'electron'

interface DirectoryPickerResponse {
  canceled: boolean
  path: string | null
}

interface ServerRestartResponse {
  ok: boolean
  message: string
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
})
