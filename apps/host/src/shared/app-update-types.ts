/** Update-check status shared between the main process, preload bridge, and
 *  renderer (see main/app-update-checker.ts). Informs only — never auto-updates. */
export type AppUpdateStatus = {
  /** Version of the running app (app.getVersion()). */
  currentVersion: string
  /** Latest version published on the public repo (package.json on main), null when unknown. */
  latestVersion: string | null
  /** latestVersion > currentVersion (numeric x.y.z compare). */
  isUpdateAvailable: boolean
  /** Unix ms of the last completed check, null until one completes. */
  checkedAt: number | null
  /** Last check error (fetch/parse); null on success. */
  error: string | null
  /** True for installer builds, false for a dev clone. Decides whether the
   *  banner tells the user to run the new setup .exe or to `git pull`. */
  isInstalledBuild: boolean
}