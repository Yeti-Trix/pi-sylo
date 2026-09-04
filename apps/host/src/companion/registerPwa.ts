let deferredInstall: Event | null = null

let serviceWorkerRegistered = false

let serviceWorkerFailed = false



export type CompanionPwaStatus = {

  secureContext: boolean

  serviceWorkerSupported: boolean

  serviceWorkerRegistered: boolean

  serviceWorkerFailed: boolean

  installPromptAvailable: boolean

  needsMkcertOnPhone: boolean

}



export function setupCompanionPwa(): void {

  if (typeof window === 'undefined') return



  void fetch('./api/companion/tls-info')

    .then((r) => (r.ok ? r.json() : null))

    .then((info: { needsCaOnPhone?: boolean } | null) => {

      if (info?.needsCaOnPhone) {

        window.dispatchEvent(new Event('sylo-companion-pwa-status'))

      }

    })

    .catch(() => {

      /* offline / server not ready */

    })



  if (!('serviceWorker' in navigator) || !window.isSecureContext) {

    window.dispatchEvent(new Event('sylo-companion-pwa-status'))

    return

  }



  void navigator.serviceWorker

    .register('./sw.js', { scope: './' })

    .then(() => {

      serviceWorkerRegistered = true

      window.dispatchEvent(new Event('sylo-companion-pwa-status'))

    })

    .catch(() => {

      serviceWorkerFailed = true

      window.dispatchEvent(new Event('sylo-companion-pwa-status'))

    })



  window.addEventListener('beforeinstallprompt', (event) => {

    event.preventDefault()

    deferredInstall = event

    window.dispatchEvent(new Event('sylo-companion-install-ready'))

    window.dispatchEvent(new Event('sylo-companion-pwa-status'))

  })



  window.addEventListener('appinstalled', () => {

    deferredInstall = null

    window.dispatchEvent(new Event('sylo-companion-installed'))

    window.dispatchEvent(new Event('sylo-companion-pwa-status'))

  })

}



export function getCompanionPwaStatus(): CompanionPwaStatus {

  const secureContext = typeof window !== 'undefined' && window.isSecureContext

  return {

    secureContext,

    serviceWorkerSupported: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,

    serviceWorkerRegistered,

    serviceWorkerFailed,

    installPromptAvailable: deferredInstall !== null,

    needsMkcertOnPhone: secureContext && serviceWorkerFailed,

  }

}



export function canPromptCompanionInstall(): boolean {

  return deferredInstall !== null

}



export async function promptCompanionInstall(): Promise<boolean> {

  const event = deferredInstall as BeforeInstallPromptEvent | null

  if (!event?.prompt) return false

  await event.prompt()

  const choice = await event.userChoice

  deferredInstall = null

  return choice.outcome === 'accepted'

}



type BeforeInstallPromptEvent = Event & {

  prompt: () => Promise<void>

  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>

}


