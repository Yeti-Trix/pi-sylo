const DISMISS_KEY = 'sylo.companion.installHintDismissed'

export function isCompanionStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const nav = navigator as Navigator & { standalone?: boolean }
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    nav.standalone === true
  )
}

export function installHintDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

export function dismissInstallHint(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, '1')
  } catch {
    /* private mode */
  }
}

export type InstallPlatform = 'ios' | 'android' | 'other'

export function detectInstallPlatform(): InstallPlatform {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'other'
}

export function installHintText(platform: InstallPlatform): string {
  if (platform === 'ios') {
    return 'Add to Home Screen: tap Share, then “Add to Home Screen”. Opens full-screen like an app.'
  }
  if (platform === 'android') {
    return 'Tap Install app above when shown, or Chrome menu (⋮) → Install app / Add to Home screen.'
  }
  return 'Use your browser’s “Add to Home Screen” or “Install” option to pin this page.'
}
