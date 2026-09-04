import { useEffect, useState } from 'react'
import { btnGhost, card, cardTitle, leadText } from './ui-classes'

/**
 * Generic Settings card driven by the personal bundle's declarative config.
 *
 * The plugin (sylo-personal-tools) supplies title/copy/pref-key via the
 * `personal:settingsCard` IPC — the host owns no domain names. Renders nothing
 * when no personal bundle is installed (public/controls machines).
 */
export default function PersonalSettingsCard({
  onChanged,
}: {
  onChanged?: () => void | Promise<void>
}) {
  const [cfg, setCfg] = useState<{
    title: string
    lead: string
    prefKey: string
    defaultLabel: string
    valuePrefix: string
    pickLabel: string
    restartBrokerOnSave?: boolean
  } | null>(null)
  const [value, setValue] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void (async () => {
      const c = (await window.sylo.personal?.settingsCard()) as null | {
        title: string
        lead: string
        prefKey: string
        defaultLabel: string
        valuePrefix: string
        pickLabel: string
        restartBrokerOnSave?: boolean
      }
      if (!c) {
        setReady(true)
        return
      }
      setCfg(c)
      const v = (await window.sylo.prefs.get(c.prefKey, '')) as string
      setValue(typeof v === 'string' ? v : '')
      setReady(true)
    })()
  }, [])

  if (!ready || !cfg) return null

  return (
    <section className={card}>
      <h2 className={cardTitle}>{cfg.title}</h2>
      <p className={leadText}>{cfg.lead}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={btnGhost}
          onClick={() => {
            void window.sylo.dialog.openDirectory().then((p) => {
              if (!p) return
              setValue(p)
              void window.sylo.prefs.set(cfg.prefKey, p).then(async () => {
                if (cfg.restartBrokerOnSave) await window.sylo.broker.restart()
                await onChanged?.()
              })
            })
          }}
        >
          {cfg.pickLabel}
        </button>
        {value && (
          <button
            type="button"
            className={btnGhost}
            onClick={() => {
              setValue('')
              void window.sylo.prefs.set(cfg.prefKey, '').then(async () => {
                if (cfg.restartBrokerOnSave) await window.sylo.broker.restart()
                await onChanged?.()
              })
            }}
          >
            Reset to default
          </button>
        )}
      </div>
      <p className="mt-2 text-[0.78rem] leading-[1.4] opacity-70">
        {value ? `${cfg.valuePrefix}${value}` : cfg.defaultLabel}
      </p>
    </section>
  )
}