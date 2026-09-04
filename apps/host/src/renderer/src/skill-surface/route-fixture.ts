/**
 * Skill routes may ship multi-file Vite builds. Sandbox iframes use srcdoc (null origin),
 * so external script/link URLs fail CORS. Host fetches assets same-origin and inlines them.
 */

export type InlinedRouteFixture = {
  headHtml: string
  bodyHtml: string
  byteLength: number
}

export async function inlineRouteFixtureAssets(
  html: string,
  fixtureUrl: string,
  signal?: AbortSignal,
): Promise<InlinedRouteFixture> {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const base = new URL('./', fixtureUrl)

  for (const link of [...doc.querySelectorAll('link[rel="stylesheet"][href]')]) {
    const href = link.getAttribute('href')
    if (!href || href.startsWith('data:')) continue
    const res = await fetch(new URL(href, base), { signal })
    if (!res.ok) throw new Error(`route_stylesheet_fetch_failed:${href}:${res.status}`)
    const style = doc.createElement('style')
    style.textContent = await res.text()
    link.replaceWith(style)
  }

  for (const script of [...doc.querySelectorAll('script[src]')]) {
    const src = script.getAttribute('src')
    if (!src) continue
    const res = await fetch(new URL(src, base), { signal })
    if (!res.ok) throw new Error(`route_script_fetch_failed:${src}:${res.status}`)
    const inline = doc.createElement('script')
    const type = script.getAttribute('type')
    if (type) inline.setAttribute('type', type)
    inline.textContent = await res.text()
    script.replaceWith(inline)
  }

  for (const el of [...doc.querySelectorAll('link[rel="modulepreload"]')]) {
    el.remove()
  }

  const headHtml = doc.head?.innerHTML.trim() ?? ''
  const bodyHtml = doc.body?.innerHTML.trim() ?? html.trim()
  return { headHtml, bodyHtml, byteLength: headHtml.length + bodyHtml.length }
}
