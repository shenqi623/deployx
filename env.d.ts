/// <reference types="vite/client" />

interface DeployxDesktopApi {
  isDesktop?: boolean
  pickDirectory: () => Promise<string | null>
  pickFile: (filters?: { name: string; extensions: string[] }[]) => Promise<string | null>
}

interface Window {
  deployxDesktop?: DeployxDesktopApi
}
