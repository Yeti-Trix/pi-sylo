import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  clearSessionCookieHeader,
  companionSessionUsername,
  createCompanionSession,
  isCompanionRequestAuthorized,
  sessionCookieHeader,
  verifyCompanionLogin,
} from './auth.js'
import { emitCompanionEvent, subscribeCompanionEvents, type CompanionEvent } from './events.js'
import { getCompanionHostApi } from './host-api.js'
import {
  filterCompanionSendAttachments,
  writeCompanionUpload,
} from './companion-upload.js'
import {
  mimeForLocalImagePath,
  openCompanionLocalImageStream,
  resolveCompanionLocalImagePath,
} from './local-image-file.js'
import {
  companionBindHost,
  hasCompanionCredentials,
  readCompanionPrefs,
  type CompanionPrefs,
} from './prefs.js'
import { getCompanionTlsTrustInfo, readCompanionRootCaPem, type CompanionTlsMaterial } from './tls.js'
import { readNtfyPrefs, controlTopicFor } from '../ntfy/prefs.js'
import { publish as publishNtfy } from '../ntfy/client.js'

export { companionPublicUrls, type CompanionPublicUrls } from './server-urls.js'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
}

function isSecureRequest(req: IncomingMessage): boolean {
  const socket = req.socket as IncomingMessage['socket'] & { encrypted?: boolean }
  return socket.encrypted === true
}

type SseClient = {
  res: ServerResponse
  heartbeat: ReturnType<typeof setInterval>
}

export type CompanionServerHandle = {
  close: () => Promise<void>
  prefs: CompanionPrefs
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function requireAuth(req: IncomingMessage, res: ServerResponse): boolean {
  if (!hasCompanionCredentials()) {
    json(res, 503, { ok: false, error: 'credentials_not_configured' })
    return false
  }
  if (!isCompanionRequestAuthorized(req)) {
    json(res, 401, { ok: false, error: 'unauthorized' })
    return false
  }
  return true
}

function safeStaticPath(staticRoot: string, urlPath: string): string | null {
  const rel = decodeURIComponent(urlPath.split('?')[0] ?? '/')
  const cleaned = rel === '/' ? '/index.html' : rel
  const abs = normalize(join(staticRoot, cleaned))
  if (!abs.startsWith(normalize(staticRoot))) return null
  return abs
}

function serveStatic(res: ServerResponse, filePath: string): void {
  const ext = extname(filePath).toLowerCase()
  const headers: Record<string, string> = { 'Content-Type': MIME[ext] ?? 'application/octet-stream' }
  if (ext === '.js' && filePath.replace(/\\/g, '/').endsWith('/sw.js')) {
    headers['Cache-Control'] = 'no-cache'
  }
  res.writeHead(200, headers)
  createReadStream(filePath).pipe(res)
}

function createCompanionHandler(opts: {
  staticRoot: string
  sseClients: Set<SseClient>
  userDataPath: string
  personalAppRoot?: () => string
}): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const { staticRoot, sseClients, userDataPath, personalAppRoot } = opts
  return async (req, res) => {
    const secureCookies = isSecureRequest(req)
    if (!req.url) {
      res.writeHead(400)
      res.end()
      return
    }

    const url = new URL(req.url, 'http://sylo.local')

    if (url.pathname === '/api/companion/tls-info' && req.method === 'GET') {
      const tls = getCompanionTlsTrustInfo(userDataPath)
      json(res, 200, {
        mode: tls.mode,
        needsCaOnPhone: tls.mode === 'sylo-ca',
        rootCaDownloadPath: tls.rootCaDownloadPath,
      })
      return
    }

    if (url.pathname === '/api/companion/root-ca.pem' && req.method === 'GET') {
      const pem = readCompanionRootCaPem(userDataPath)
      if (!pem) {
        json(res, 503, { ok: false, error: 'root_ca_unavailable' })
        return
      }
      res.writeHead(200, {
        'Content-Type': 'application/x-pem-file; charset=utf-8',
        'Content-Disposition': 'attachment; filename="sylo-companion-ca.pem"',
        'Content-Length': Buffer.byteLength(pem),
        'Cache-Control': 'no-store',
      })
      res.end(pem)
      return
    }

    if (url.pathname === '/api/auth/status' && req.method === 'GET') {
      const username = companionSessionUsername(req)
      json(res, 200, {
        authenticated: isCompanionRequestAuthorized(req),
        username: username ?? undefined,
        hasCredentials: hasCompanionCredentials(),
      })
      return
    }

    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      try {
        const body = (await readJsonBody(req)) as { username?: unknown; password?: unknown }
        const username = typeof body.username === 'string' ? body.username : ''
        const password = typeof body.password === 'string' ? body.password : ''
        if (!verifyCompanionLogin(username, password)) {
          json(res, 401, { ok: false, error: 'invalid_credentials' })
          return
        }
        const sessionId = createCompanionSession(username)
        const payload = JSON.stringify({ ok: true, username: username.trim() })
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(payload),
          'Set-Cookie': sessionCookieHeader(sessionId, secureCookies),
        })
        res.end(payload)
      } catch (e) {
        json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      const payload = JSON.stringify({ ok: true })
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
        'Set-Cookie': clearSessionCookieHeader(secureCookies),
      })
      res.end(payload)
      return
    }

        if (url.pathname === '/api/health') {
      if (!requireAuth(req, res)) return
      json(res, 200, { ok: true, companion: true })
      return
    }

    // Request a Sylo restart. Publishes `restart` to this node's ntfy control
    // topic (sylo-<nodeName>-control); the standalone sylo-supervisor service
    // (independent of Sylo) picks it up and performs the kill+relaunch+revert.
    // Fire-and-forget publish; the supervisor notifies the phone with the
    // result, so this endpoint just confirms the trigger was accepted.
    if (url.pathname === '/api/restart' && req.method === 'POST') {
      if (!requireAuth(req, res)) return
      const prefs = readNtfyPrefs()
      if (!prefs.enabled || !prefs.nodeName) {
        json(res, 400, { ok: false, error: 'ntfy_not_configured' })
        return
      }
      const ok = await publishNtfy(prefs, controlTopicFor(prefs), {
        body: 'restart',
        title: 'Restart requested from companion',
        priority: 3,
        tags: ['arrows_counterclockwise'],
      })
            json(res, ok ? 200 : 502, { ok })
      return
    }

    // Request a Sylo REBUILD + restart. Same ntfy control channel, but publishes
    // `rebuild` so the supervisor runs npm install + prepare:dev (applies
    // companion/broker/skill-surface changes) before relaunching. Same 5-min
    // health-watch + auto-revert on failure.
    if (url.pathname === '/api/rebuild' && req.method === 'POST') {
      if (!requireAuth(req, res)) return
      const prefs = readNtfyPrefs()
      if (!prefs.enabled || !prefs.nodeName) {
        json(res, 400, { ok: false, error: 'ntfy_not_configured' })
        return
      }
      const ok = await publishNtfy(prefs, controlTopicFor(prefs), {
        body: 'rebuild',
        title: 'Rebuild requested from companion',
        priority: 3,
        tags: ['hammer_and_wrench'],
      })
      json(res, ok ? 200 : 502, { ok })
      return
    }

    if (url.pathname === '/api/broker/status' && req.method === 'GET') {
      if (!requireAuth(req, res)) return
      try {
        json(res, 200, getCompanionHostApi().getBrokerStatus())
      } catch (e) {
        json(res, 503, { ok: false, error: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    if (url.pathname === '/api/models' && req.method === 'GET') {
      if (!requireAuth(req, res)) return
      try {
        json(res, 200, await getCompanionHostApi().listModels())
      } catch (e) {
        json(res, 503, { ok: false, error: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    if (url.pathname === '/api/workspaces' && req.method === 'GET') {
      if (!requireAuth(req, res)) return
      try {
        const api = getCompanionHostApi()
        json(res, 200, {
          workspaces: api.listWorkspaces().map((w) => ({ id: w.id, name: w.name })),
          activeWorkspaceId: api.getActiveWorkspaceId(),
        })
      } catch (e) {
        json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    if (url.pathname === '/api/ui/active-workspace' && req.method === 'PUT') {
      if (!requireAuth(req, res)) return
      try {
        const body = (await readJsonBody(req)) as { workspaceId?: unknown }
        const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId.trim() : ''
        if (!workspaceId) {
          json(res, 400, { ok: false, error: 'missing_workspace_id' })
          return
        }
        getCompanionHostApi().setActiveWorkspaceId(workspaceId)
        json(res, 200, { ok: true, activeWorkspaceId: workspaceId })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        json(res, msg === 'workspace_not_found' ? 404 : 500, { ok: false, error: msg })
      }
      return
    }

    if (url.pathname === '/api/conversations/latest-empty' && req.method === 'GET') {
      if (!requireAuth(req, res)) return
      try {
        const api = getCompanionHostApi()
        const qs = url.searchParams.get('workspaceId')
        const workspaceId = qs && qs.trim() ? qs.trim() : api.getActiveWorkspaceId()
        const conversationId = api.findLatestEmptyConversation(workspaceId) ?? null
        json(res, 200, { conversationId, workspaceId })
      } catch (e) {
        json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    if (url.pathname === '/api/conversations' && req.method === 'GET') {
      if (!requireAuth(req, res)) return
      try {
        const api = getCompanionHostApi()
        const qs = url.searchParams.get('workspaceId')
                const workspaceId = qs && qs.trim() ? qs.trim() : api.getActiveWorkspaceId()
        json(res, 200, {
          conversations: api.listConversations(workspaceId),
          running: api.listRunningConversationIds(),
          workspaceId,
        })
      } catch (e) {
        json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    if (url.pathname === '/api/conversations' && req.method === 'POST') {
      if (!requireAuth(req, res)) return
      try {
        const body = (await readJsonBody(req)) as { title?: unknown; workspaceId?: unknown }
        const api = getCompanionHostApi()
        const title = typeof body.title === 'string' ? body.title : ''
        const workspaceId =
          typeof body.workspaceId === 'string' && body.workspaceId.trim()
            ? body.workspaceId.trim()
            : api.getActiveWorkspaceId()
                const conversation = api.createConversation(title, workspaceId)
        json(res, 201, { conversation })
      } catch (e) {
        json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    const titleMatch = /^\/api\/conversations\/([^/]+)\/title$/.exec(url.pathname)
    if (titleMatch && req.method === 'PUT') {
      if (!requireAuth(req, res)) return
      try {
        const conversationId = decodeURIComponent(titleMatch[1] ?? '')
        const body = (await readJsonBody(req)) as { title?: unknown }
        const title = typeof body.title === 'string' ? body.title : ''
        getCompanionHostApi().setConversationTitle(conversationId, title)
        json(res, 200, { ok: true, conversationId, title: title.trim() })
      } catch (e) {
        json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    const modelMatch = /^\/api\/conversations\/([^/]+)\/model$/.exec(url.pathname)
    if (modelMatch && (req.method === 'PUT' || req.method === 'PATCH')) {
      if (!requireAuth(req, res)) return
      try {
        const conversationId = decodeURIComponent(modelMatch[1] ?? '')
        const body = (await readJsonBody(req)) as {
          model_provider?: unknown
          model_id?: unknown
          image_model_id?: unknown
          image_model_provider?: unknown
        }
        const norm = (v: unknown): string | null => {
          if (v === null || v === undefined) return null
          const s = typeof v === 'string' ? v.trim() : ''
          return s === '' ? null : s
        }
        const result = getCompanionHostApi().setConversationModel(conversationId, {
          model_provider: norm(body.model_provider),
          model_id: norm(body.model_id),
          image_model_id: norm(body.image_model_id),
          image_model_provider: norm(body.image_model_provider),
        })
        json(res, 200, { ...result, conversationId })
      } catch (e) {
        json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    const deleteConvMatch = /^\/api\/conversations\/([^/]+)$/.exec(url.pathname)
    if (deleteConvMatch && req.method === 'DELETE') {
      if (!requireAuth(req, res)) return
      try {
        const conversationId = decodeURIComponent(deleteConvMatch[1] ?? '')
        const removed = getCompanionHostApi().deleteConversation(conversationId)
        json(res, removed ? 200 : 404, { ok: removed })
      } catch (e) {
        json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    const messagesMatch = /^\/api\/conversations\/([^/]+)\/messages$/.exec(url.pathname)
    if (messagesMatch && req.method === 'GET') {
      if (!requireAuth(req, res)) return
      try {
        const conversationId = decodeURIComponent(messagesMatch[1] ?? '')
        json(res, 200, { messages: getCompanionHostApi().listMessages(conversationId) })
      } catch (e) {
        json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    const sendMatch = /^\/api\/conversations\/([^/]+)\/send$/.exec(url.pathname)
    if (sendMatch && req.method === 'POST') {
      if (!requireAuth(req, res)) return
      try {
        const conversationId = decodeURIComponent(sendMatch[1] ?? '')
        const body = (await readJsonBody(req)) as { text?: unknown; attachments?: unknown }
        const text = typeof body.text === 'string' ? body.text : ''
        const attachments = filterCompanionSendAttachments(userDataPath, body.attachments)
        const result = await getCompanionHostApi().sendChat(conversationId, text, attachments)
        json(res, 200, result)
      } catch (e) {
        json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    if (url.pathname === '/api/files/upload' && req.method === 'POST') {
      if (!requireAuth(req, res)) return
      try {
        const body = (await readJsonBody(req)) as {
          name?: unknown
          data?: unknown
        }
        const name = typeof body.name === 'string' ? body.name : 'upload'
        const dataRaw = typeof body.data === 'string' ? body.data.trim() : ''
        if (!dataRaw) {
          json(res, 400, { ok: false, error: 'missing_file_data' })
          return
        }
        const buf = Buffer.from(dataRaw, 'base64')
        const written = writeCompanionUpload(userDataPath, buf, name)
        json(res, 201, written)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const status = msg === 'file_too_large' || msg === 'empty_file' ? 400 : 500
        json(res, status, { ok: false, error: msg })
      }
      return
    }

    const abortMatch = /^\/api\/conversations\/([^/]+)\/abort$/.exec(url.pathname)
    if (abortMatch && req.method === 'POST') {
      if (!requireAuth(req, res)) return
      try {
        const conversationId = decodeURIComponent(abortMatch[1] ?? '')
        json(res, 200, await getCompanionHostApi().abortChat(conversationId))
      } catch (e) {
        json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    const steerMatch = /^\/api\/conversations\/([^/]+)\/steer$/.exec(url.pathname)
    if (steerMatch && req.method === 'POST') {
      if (!requireAuth(req, res)) return
      try {
        const conversationId = decodeURIComponent(steerMatch[1] ?? '')
        const body = (await readJsonBody(req)) as { text?: unknown; attachments?: unknown }
        const text = typeof body.text === 'string' ? body.text : ''
        const attachments = filterCompanionSendAttachments(userDataPath, body.attachments)
        json(res, 200, await getCompanionHostApi().steerChat(conversationId, text, attachments))
      } catch (e) {
        json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    const deliverQueuedMatch = /^\/api\/conversations\/([^/]+)\/deliver-queued$/.exec(url.pathname)
    if (deliverQueuedMatch && req.method === 'POST') {
      if (!requireAuth(req, res)) return
      try {
        const conversationId = decodeURIComponent(deliverQueuedMatch[1] ?? '')
        const body = (await readJsonBody(req)) as { text?: unknown; attachments?: unknown }
        const text = typeof body.text === 'string' ? body.text : ''
        const attachments = filterCompanionSendAttachments(userDataPath, body.attachments)
        json(res, 200, await getCompanionHostApi().deliverQueuedChat(conversationId, text, attachments))
      } catch (e) {
        json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    if (url.pathname === '/api/files/local-image' && req.method === 'GET') {
      if (!requireAuth(req, res)) return
      const raw = url.searchParams.get('path')
      const filePath = resolveCompanionLocalImagePath(typeof raw === 'string' ? raw : '')
      if (!filePath) {
        res.writeHead(404)
        res.end()
        return
      }
      res.writeHead(200, { 'Content-Type': mimeForLocalImagePath(filePath) })
      openCompanionLocalImageStream(filePath).pipe(res)
      return
    }

    if (url.pathname === '/api/events' && req.method === 'GET') {
      if (!requireAuth(req, res)) return
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      })
      res.write(': connected\n\n')
      const heartbeat = setInterval(() => {
        try {
          res.write(': ping\n\n')
        } catch {
          /* */
        }
      }, 25000)
      const client: SseClient = { res, heartbeat }
      sseClients.add(client)
      req.on('close', () => {
        clearInterval(heartbeat)
        sseClients.delete(client)
      })
      return
    }

    if (url.pathname === '/api/personal/manifest' && req.method === 'GET') {
      if (!requireAuth(req, res)) return
      try {
        const manifest = await getCompanionHostApi().personalManifest()
        json(res, 200, manifest ?? null)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const status = msg === 'personal_plugin_unavailable' ? 501 : 500
        json(res, status, { ok: false, error: msg })
      }
      return
    }

    if (url.pathname === '/api/personal/rpc' && req.method === 'POST') {
      if (!requireAuth(req, res)) return
      try {
        const body = (await readJsonBody(req)) as { op?: unknown; payload?: unknown }
        const op = typeof body.op === 'string' ? body.op.trim() : ''
        if (!op) {
          json(res, 400, { ok: false, error: 'missing_op' })
          return
        }
        const result = await getCompanionHostApi().personalRpc(op, body.payload ?? {})
        json(res, 200, { ok: true, result })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const status =
          msg === 'unknown_op' ? 400 : msg === 'personal_plugin_unavailable' ? 501 : 500
        json(res, status, { ok: false, error: msg })
      }
      return
    }

    if (url.pathname.startsWith('/api/')) {
      json(res, 404, { ok: false, error: 'not_found' })
      return
    }

    if (url.pathname === '/personal-app' || url.pathname.startsWith('/personal-app/')) {
      const root = personalAppRoot?.()
      if (root && existsSync(root)) {
        const suffix =
          url.pathname === '/personal-app' || url.pathname === '/personal-app/' ?
            '/index.html'
          : url.pathname.slice('/personal-app'.length)
        const personalPath = safeStaticPath(root, suffix)
        if (personalPath && existsSync(personalPath) && statSync(personalPath).isFile()) {
          serveStatic(res, personalPath)
          return
        }
      }
      json(res, 404, { ok: false, error: 'personal_app_not_built' })
      return
    }

    const staticPath = safeStaticPath(staticRoot, url.pathname)
    if (staticPath && existsSync(staticPath) && statSync(staticPath).isFile()) {
      serveStatic(res, staticPath)
      return
    }

    const indexPath = join(staticRoot, 'index.html')
    if (existsSync(indexPath)) {
      serveStatic(res, indexPath)
      return
    }

    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Companion UI not built. Run npm run build:companion in apps/host.')
  }
}

export function startCompanionServer(opts: {
  staticRoot: string
  prefs: CompanionPrefs
  tls: CompanionTlsMaterial
  userDataPath: string
  personalAppRoot?: () => string
}): CompanionServerHandle {
  const sseClients = new Set<SseClient>()

  const pushSse = (event: CompanionEvent): void => {
    const line = `event: ${event.channel}\ndata: ${JSON.stringify(event.payload)}\n\n`
    for (const client of sseClients) {
      try {
        client.res.write(line)
      } catch {
        /* disconnected */
      }
    }
  }

  const unsubscribeEvents = subscribeCompanionEvents(pushSse)
  const handler = createCompanionHandler({
    staticRoot: opts.staticRoot,
    sseClients,
    userDataPath: opts.userDataPath,
    personalAppRoot: opts.personalAppRoot,
  })

  const host = companionBindHost(opts.prefs.bind)
  const port = opts.prefs.port

  const httpsServer: HttpsServer = createHttpsServer(
    { key: opts.tls.key, cert: opts.tls.cert },
    (req, res) => {
      void handler(req, res)
    },
  )
  httpsServer.on('error', (err) => {
    console.error('[sylo companion] HTTPS listen error:', err)
  })
  httpsServer.listen(port, host, () => {
    console.info('[sylo companion] HTTPS on', host === '0.0.0.0' ? '0.0.0.0' : host, port)
  })

  return {
    prefs: opts.prefs,
    close: () =>
      new Promise((resolve, reject) => {
        unsubscribeEvents()
        for (const client of sseClients) {
          clearInterval(client.heartbeat)
          try {
            client.res.end()
          } catch {
            /* */
          }
        }
        sseClients.clear()
        httpsServer.close((err) => {
          if (err) reject(err)
          else resolve()
        })
      }),
  }
}

export function emitCompanionBrokerStatus(payload: Record<string, unknown>): void {
  emitCompanionEvent({ channel: 'broker:status', payload })
}

export function emitCompanionBrokerError(payload: Record<string, unknown>): void {
  emitCompanionEvent({ channel: 'broker:error', payload })
}
