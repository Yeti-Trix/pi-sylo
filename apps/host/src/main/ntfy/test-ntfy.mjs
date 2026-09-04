// Standalone protocol check: publish + JSON-stream subscribe against public ntfy.sh.
// Run: node apps/host/src/main/ntfy/test-ntfy.mjs
const TOPIC = 'sylo-dev-test-' + Date.now()
const BASE = 'https://ntfy.sh'

async function main() {
  const subUrl = `${BASE}/${TOPIC}/json`
  const ac = new AbortController()
  const received = []

  const subP = (async () => {
    const res = await fetch(subUrl, { signal: ac.signal })
    if (!res.ok || !res.body) throw new Error('subscribe http ' + res.status)
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        try { received.push(JSON.parse(line)) } catch { /* ignore */ }
      }
    }
  })().catch((e) => { if (e.name !== 'AbortError') console.error('subscribe error', e) })

  await new Promise((r) => setTimeout(r, 1500)) // let the stream connect
  const pubRes = await fetch(`${BASE}/${TOPIC}`, {
    method: 'POST',
    headers: { Title: 'Protocol test' },
    body: 'hello from node test',
  })
  console.log('publish status', pubRes.status)

  await new Promise((r) => setTimeout(r, 2000)) // wait for delivery
  ac.abort()
  await subP.catch(() => {})
  console.log('received events:', received.length)
  for (const e of received) console.log(JSON.stringify(e))
  const gotMessage = received.some(
    (e) => e.event === 'message' && e.message === 'hello from node test',
  )
  console.log('RESULT:', gotMessage ? 'PASS' : 'FAIL')
  process.exit(gotMessage ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })