import { useEffect, useState } from 'react'
import { btnGhost, card, cardTitle, leadText } from './ui-classes'

/**
 * Generic Settings cards driven by host plugins' declarative configs.
 *
 * Plugins supply title/copy/pref-key via the `personal:settingsCard` IPC (an
 * ARRAY since the v1 multi-plugin contract — a single object for back-compat);
 * the host owns no domain names. Renders nothing when no plugin declares a
 * card (public/controls machines).
 */
type CardConfig = {
  title: string
  lead: string
  prefKey: string
  defaultLabel: string
  valuePrefix: string
  pickLabel: string
  restartBrokerOnSave?: boolean
}

function isCardConfig(value: unknown): value is CardConfig {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as CardConfig).prefKey === 'string' &&
    typeof (value as CardConfig).title === 'string'
  )
}

export default function PersonalSettingsCard({
  onChanged,
}: {
  onChanged?: () => void | Promise<void>
}) {
  const [cfgs, setCfgs] = useState<CardConfig[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void (async () => {
      const raw = (await window.sylo.personal?.settingsCard()) as
        | CardConfig[]
        | CardConfig
        | null
        | undefined
      const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(isCardConfig)
      setCfgs(list)
      setReady(true)
    })()
  }, [])

  if (!ready || cfgs.length === 0) return null

  return (
    <>
      {cfgs.map((cfg) => (
        <PluginSettingsCard key={cfg.prefKey} cfg={cfg} onChanged={onChanged} />
      ))}
    </>
  )
}

function PluginSettingsCard({
  cfg,
  onChanged,
}: {
  cfg: CardConfig
  onChanged?: () => void | Promise<void>
}) {
  const [value, setValue] = useState('')

  useEffect(() => {
    void (async () => {
      const v = (await window.sylo.prefs.get(cfg.prefKey, '')) as string
      setValue(typeof v === 'string' ? v : '')
    })()
  }, [cfg.prefKey])

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