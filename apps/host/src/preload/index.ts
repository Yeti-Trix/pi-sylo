import { contextBridge, ipcRenderer, webUtils } from 'electron'

const SYLO_FILE_SCHEME = 'sylo-file'

contextBridge.exposeInMainWorld('sylo', {
  proposals: {
    list: () => ipcRenderer.invoke('proposals:list'),
    apply: (root: string, relPath: string, editedBody?: string) =>
      ipcRenderer.invoke('proposals:apply', root, relPath, editedBody) as Promise<
        | { ok: true; pushOk: boolean; detail: string }
        | { ok: false; error: string; detail?: string }
      >,
    reject: (root: string, relPath: string, reason: string) =>
      ipcRenderer.invoke('proposals:reject', root, relPath, reason) as Promise<
        | { ok: true; pushOk: boolean; detail: string }
        | { ok: false; error: string; detail?: string }
      >,
  },
  sweep: {
    getConfig: () => ipcRenderer.invoke('sweep:getConfig'),
    setConfig: (patch: Record<string, unknown>) => ipcRenderer.invoke('sweep:setConfig', patch),
    runNow: () => ipcRenderer.invoke('sweep:runNow'),
  },
  conversations: {
    list: (workspaceId?: string) => ipcRenderer.invoke('conversations:list', workspaceId),
    create: (title?: string, workspaceId?: string) =>
      ipcRenderer.invoke('conversations:create', title, workspaceId),
    findLatestEmpty: (workspaceId: string) =>
      ipcRenderer.invoke('conversations:findLatestEmpty', workspaceId) as Promise<string | null>,
    setTitle: (id: string, title: string) => ipcRenderer.invoke('conversations:setTitle', id, title),
    setWorkspace: (id: string, workspaceId: string) =>
      ipcRenderer.invoke('conversations:setWorkspace', id, workspaceId),
        setModel: (id: string, model: {
      model_provider: string | null
      model_id: string | null
      image_model_id: string | null
      image_model_provider: string | null
      thinking_level?: string | null
    }) =>
      ipcRenderer.invoke('conversations:setModel', id, model) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
    getModel: (id: string) =>
      ipcRenderer.invoke('conversations:getModel', id) as Promise<
        | {
            model_provider: string | null
            model_id: string | null
            image_model_id: string | null
            image_model_provider: string | null
            thinking_level: string | null
            effective: {
              provider: string
              modelId: string
              imageModelId: string
              imageModelProvider: string
              thinkingLevel: string | null
            }
          }
        | null
      >,
    delete: (id: string) => ipcRenderer.invoke('conversations:delete', id),
  },
  workspaces: {
    list: () => ipcRenderer.invoke('workspaces:list'),
    devWorkspaceId: () => ipcRenderer.invoke('workspaces:devWorkspaceId') as Promise<string | null>,
    defaultPathForName: (name: string) =>
      ipcRenderer.invoke('workspaces:defaultPathForName', name) as Promise<string>,
    resetPrimaryPiProject: () =>
      ipcRenderer.invoke('workspaces:resetPrimaryPiProject') as Promise<string>,
    create: (name: string, piCwd?: string, opts?: { createPiProjectDir?: boolean }) =>
      ipcRenderer.invoke('workspaces:create', name, piCwd ?? '', opts),
    update: (id: string, patch: { name?: string; pi_cwd?: string }, opts?: { createPiProjectDir?: boolean }) =>
      ipcRenderer.invoke('workspaces:update', id, patch, opts),
    /** Create the missing primary (user-data) workspace folder under `name`. */
    primaryProvision: (args: { name: string }) =>
      ipcRenderer.invoke('workspaces:primaryProvision', args) as Promise<
        | { ok: true; workspace: { id: string; name: string; pi_cwd: string } }
        | { ok: false; error: string; detail?: string }
      >,
    /** Restore the primary workspace by cloning a GitHub repo into its expected folder. */
    primaryRestoreFromGithub: (args: { cloneUrl: string }) =>
      ipcRenderer.invoke('workspaces:primaryRestoreFromGithub', args) as Promise<
        | { ok: true; workspace: { id: string; name: string; pi_cwd: string } }
        | { ok: false; error: string; detail?: string }
      >,
    delete: (id: string) => ipcRenderer.invoke('workspaces:delete', id),
    patchDisabled: (patch: {
      workspaceId: string
      kind: 'skill' | 'extension' | 'tool'
      path?: string
      extensionPath?: string
      toolName?: string
      excluded: boolean
    }) =>
      ipcRenderer.invoke('workspaces:disabled:patch', patch) as Promise<
        | {
            ok: true
            disabled: {
              skillPaths: string[]
              extensionPaths: string[]
              disabledTools: { extensionPath: string; toolName: string }[]
            }
          }
        | { ok: false; error: string }
      >,
    backup: {
      status: (workspaceId: string) =>
        ipcRenderer.invoke('workspaces:backup:status', workspaceId) as Promise<
          | {
              ok: true
              cwd: string
              github_remote_url: string
              github_backup_enabled: boolean
              github_last_sync_at: number | null
              git: {
                isRepo: boolean
                branch: string
                dirty: boolean
                ahead: number
                behind: number
                remoteUrl: string
              }
            }
          | { ok: false; error: string }
        >,
      save: (
        workspaceId: string,
        patch: { github_remote_url?: string; github_backup_enabled?: boolean },
      ) =>
        ipcRenderer.invoke('workspaces:backup:save', workspaceId, patch) as Promise<
          | { ok: true; linked: boolean; detail?: string }
          | { ok: false; error: string; detail?: string }
        >,
      pull: (workspaceId: string) =>
        ipcRenderer.invoke('workspaces:backup:pull', workspaceId) as Promise<
          | { ok: true; detail?: string }
          | { ok: false; error: string; detail?: string }
        >,
      push: (workspaceId: string) =>
        ipcRenderer.invoke('workspaces:backup:push', workspaceId) as Promise<
          | { ok: true; detail?: string }
          | { ok: false; error: string; detail?: string }
        >,
      pushAll: () =>
        ipcRenderer.invoke('workspaces:backup:pushAll') as Promise<{
          ok: true
          results: {
            workspaceId: string
            name: string
            result: { ok: true; detail?: string } | { ok: false; error: string; detail?: string }
          }[]
        }>,
    },
    github: {
      status: () =>
        ipcRenderer.invoke('github:status') as Promise<
          | { connected: true; login: string; encrypted: boolean }
          | { connected: false }
        >,
      connect: (token: string) =>
        ipcRenderer.invoke('github:connect', token) as Promise<
          | { ok: true; login: string; publicRepos: number | null }
          | { ok: false; error: string }
        >,
            disconnect: () =>
        ipcRenderer.invoke('github:disconnect') as Promise<{ ok: true }>,
      deviceFlow: {
        start: () =>
          ipcRenderer.invoke('github:deviceFlow:start') as Promise<
            | {
                ok: true
                userCode: string
                verificationUri: string
                verificationUriComplete?: string
                interval: number
                expiresIn: number
              }
            | { ok: false; error: string }
          >,
        poll: () =>
          ipcRenderer.invoke('github:deviceFlow:poll') as Promise<
            | {
                status: 'success'
                auth:
                  | { ok: true; login: string; publicRepos: number | null }
                  | { ok: false; error: string }
              }
            | { status: 'pending' }
            | { status: 'slow_down'; interval: number }
            | { status: 'expired'; error: string }
            | { status: 'error'; error: string }
          >,
        cancel: () =>
          ipcRenderer.invoke('github:deviceFlow:cancel') as Promise<{ ok: true }>,
      },
      defaultCloneDir: () => ipcRenderer.invoke('github:defaultCloneDir') as Promise<string>,
      setDefaultCloneDir: (dir: string) =>
        ipcRenderer.invoke('github:setDefaultCloneDir', dir) as Promise<string>,
      listRepos: (opts?: { page?: number; perPage?: number }) =>
        ipcRenderer.invoke('github:repos', opts ?? {}) as Promise<
          | {
              ok: true
              repos: {
                id: number
                full_name: string
                name: string
                owner: string
                private: boolean
                default_branch: string
                clone_url: string
                ssh_url: string
                pushed_at: string | null
                description: string | null
                archived: boolean
              }[]
              hasMore: boolean
              page: number
            }
          | { ok: false; error: string; status?: number }
        >,
      listOrgs: () =>
        ipcRenderer.invoke('github:orgs') as Promise<
          | { ok: true; orgs: Array<{ login: string; id: number }> }
          | { ok: false; error: string; status?: number }
        >,
      clone: (args: {
        cloneUrl: string
        destDir: string
        name: string
        privateRepo?: boolean
        enableBackup?: boolean
      }) =>
        ipcRenderer.invoke('workspaces:github:clone', args) as Promise<
          | {
              ok: true
              workspace: {
                id: string
                name: string
                pi_cwd: string
                path_segment: string
                github_remote_url: string
                github_backup_enabled: number
                github_last_sync_at: number | null
                sort_order: number
                created_at: number
              }
            }
          | { ok: false; error: string; detail?: string }
        >,
      publish: (args: {
        workspaceId: string
        name: string
        owner?: string
        privateRepo?: boolean
        description?: string
      }) =>
        ipcRenderer.invoke('workspaces:github:publish', args) as Promise<
          | {
              ok: true
              workspace: {
                id: string
                name: string
                pi_cwd: string
                path_segment: string
                github_remote_url: string
                github_backup_enabled: number
                github_last_sync_at: number | null
                sort_order: number
                created_at: number
              }
              repo: { html_url: string; full_name: string; default_branch: string; private: boolean }
            }
          | { ok: false; error: string; detail?: string }
        >,
    },
  },
  messages: {
    list: (conversationId: string) => ipcRenderer.invoke('messages:list', conversationId),
  },
  chat: {
    send: (
      conversationId: string,
      text: string,
      attachments?: { path: string; name?: string }[],
    ) => ipcRenderer.invoke('chat:send', conversationId, text, attachments ?? []),
    abort: (conversationId: string) =>
      ipcRenderer.invoke('chat:abort', conversationId) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
    steer: (
      conversationId: string,
      text: string,
      attachments?: { path: string; name?: string }[],
    ) =>
      ipcRenderer.invoke('chat:steer', conversationId, text, attachments ?? []) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
    deliverQueued: (
      conversationId: string,
      text: string,
      attachments?: { path: string; name?: string }[],
    ) =>
      ipcRenderer.invoke(
        'chat:deliverQueued',
        conversationId,
        text,
        attachments ?? [],
      ) as Promise<{ ok: true } | { ok: false; error: string }>,
    branchConversation: (conversationId: string) =>
      ipcRenderer.invoke(
        'chat:branchConversation',
        conversationId,
      ) as Promise<
        | { ok: true; conversationId: string; pi_session_relpath: string }
        | { ok: false; error: string }
      >,
    writePastedImage: (data: ArrayBuffer, mimeType: string) =>
      ipcRenderer.invoke('chat:writePastedImage', { data, mimeType }) as Promise<{
        path: string
        name: string
      }>,
  },
  prefs: {
    get: (key: string, fallback: unknown) => ipcRenderer.invoke('prefs:get', key, fallback),
    set: (key: string, value: unknown) => ipcRenderer.invoke('prefs:set', key, value),
  },
  globalAgents: (() => {
    type GlobalAgentsStatusPayload = {
      sourcePath: string
      targetPath: string
      sourceExists: boolean
      targetExists: boolean
      inSync: boolean
      content: string
      lastDeployedAt: string | null
    }
    return {
      status: () => ipcRenderer.invoke('globalAgents:status') as Promise<GlobalAgentsStatusPayload>,
      save: (content: string) =>
        ipcRenderer.invoke('globalAgents:save', content) as Promise<
          GlobalAgentsStatusPayload & { ok: boolean; error?: string }
        >,
      deploy: () =>
        ipcRenderer.invoke('globalAgents:deploy') as Promise<
          GlobalAgentsStatusPayload & { ok: boolean; error?: string }
        >,
    }
  })(),
  paths: {
    userData: () => ipcRenderer.invoke('paths:userData'),
    db: () => ipcRenderer.invoke('paths:db'),
    hostPiCwd: () => ipcRenderer.invoke('paths:hostPiCwd') as Promise<string>,
    piAgentDir: () => ipcRenderer.invoke('paths:piAgentDir') as Promise<string>,
    canonicalWorkspaceProject: () =>
      ipcRenderer.invoke('paths:canonicalWorkspaceProject') as Promise<string>,
    exists: (absPath: string) =>
      ipcRenderer.invoke('paths:exists', absPath) as Promise<boolean>,
    openGlobalSkillsFolder: () =>
      ipcRenderer.invoke('paths:openGlobalSkillsFolder') as Promise<
        { ok: true; path: string } | { ok: false; error: string }
      >,
    openProjectSkillsFolder: (workspaceId?: string) =>
      ipcRenderer.invoke('paths:openProjectSkillsFolder', workspaceId) as Promise<
        { ok: true; path: string; piCwd: string } | { ok: false; error: string }
      >,
  },
  /** Real filesystem path for a File from drag-drop or &lt;input type="file"&gt; (Electron only). */
  files: {
    pathFromWebFile: (file: File) => webUtils.getPathForFile(file),
    /** Thumbnail/preview URL for a local image path (sylo-file:// custom protocol). */
    localImageUrl: (absPath: string) => {
      const p = typeof absPath === 'string' ? absPath.trim() : ''
      if (!p) return ''
      return `${SYLO_FILE_SCHEME}://preview?path=${encodeURIComponent(p)}`
    },
    saveCopyAs: (args: { sourcePath: string; suggestedName?: string; workspaceId?: string }) =>
      ipcRenderer.invoke('files:saveCopyAs', args) as Promise<
        { ok: true; path: string } | { ok: false; cancelled?: boolean; error?: string }
      >,
    /** Read a local text file (UTF-8, truncated at the canvas cap). Used by the
     *  canvas popout window to render a dropped `.md` file without a round-trip
     *  through `canvas:show` (which only targets the main window). */
    readTextFile: (path: string) =>
      ipcRenderer.invoke('files:readTextFile', path) as Promise<
        | { ok: true; content: string; truncated: boolean }
        | { ok: false; error: string }
      >,
  },
  broker: {
    restart: () => ipcRenderer.invoke('broker:restart'),
    prepareConversation: (conversationId: string) =>
      ipcRenderer.invoke('broker:prepareConversation', conversationId) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
    getStatus: () =>
      ipcRenderer.invoke('broker:status:get') as Promise<{
        ready: boolean
        safeMode: unknown
        initError: string | null
        lastCapturedLogs: string | null
        resolvedModel: { provider: string; modelId: string; displayName?: string } | null
        modelInput: ('text' | 'image')[]
        visionCapable: boolean
      }>,
        onStatus: (cb: (p: unknown) => void) => {
      const ch = (_: unknown, p: unknown) => cb(p)
      ipcRenderer.on('broker:status', ch)
      return () => ipcRenderer.removeListener('broker:status', ch)
    },
    onError: (cb: (p: unknown) => void) => {
      const ch = (_: unknown, p: unknown) => cb(p)
      ipcRenderer.on('broker:error', ch)
      return () => ipcRenderer.removeListener('broker:error', ch)
    },
    getSystemPromptStats: () =>
      ipcRenderer.invoke('broker:system-prompt-stats:get') as Promise<{
        totalChars: number
        totalTokens: number
        sections: { label: string; chars: number; tokens: number; pct: number }[]
      } | null>,
    onSystemPromptStats: (cb: (p: unknown) => void) => {
      const ch = (_: unknown, p: unknown) => cb(p)
      ipcRenderer.on('broker:system-prompt-stats', ch)
      return () => ipcRenderer.removeListener('broker:system-prompt-stats', ch)
    },
    getActualContextTokens: () =>
      ipcRenderer.invoke('broker:context-window-stats:get') as Promise<number | null>,
    onActualContextTokens: (cb: (tokens: number) => void) => {
      const ch = (_: unknown, p: number) => cb(p)
      ipcRenderer.on('broker:context-window-stats', ch)
      return () => ipcRenderer.removeListener('broker:context-window-stats', ch)
    },
  },
  chatEvents: {
        onRefresh: (cb: (p: { conversationId: string; kind?: 'messages' | 'turnFinished' | 'turnStarted' | 'conversationRenamed' | 'conversationDeleted' }) => void) => {
      const ch = (_: unknown, p: { conversationId: string; kind?: 'messages' | 'turnFinished' | 'turnStarted' | 'conversationRenamed' | 'conversationDeleted' }) =>
        cb(p)
      ipcRenderer.on('chat:refresh', ch)
      return () => ipcRenderer.removeListener('chat:refresh', ch)
    },
    onStream: (
      cb: (p: { conversationId: string; messageId: string; delta: string }) => void,
    ) => {
      const ch = (
        _: unknown,
        p: { conversationId: string; messageId: string; delta: string },
      ) => cb(p)
      ipcRenderer.on('chat:stream', ch)
      return () => ipcRenderer.removeListener('chat:stream', ch)
    },
    onTool: (
      cb: (p: { conversationId: string; messageId: string; event: unknown; ts: number }) => void,
    ) => {
      const ch = (_: unknown, p: { conversationId: string; messageId: string; event: unknown; ts: number }) =>
        cb(p)
      ipcRenderer.on('chat:tool', ch)
      return () => ipcRenderer.removeListener('chat:tool', ch)
    },
  },
  capabilities: {
    settings: () => ipcRenderer.invoke('capabilities:settings'),
    writeSettings: (next: Record<string, unknown>) =>
      ipcRenderer.invoke('capabilities:writeSettings', next),
    discover: (workspaceId?: string) => ipcRenderer.invoke('capabilities:discover', workspaceId),
    list: (workspaceId?: string) => ipcRenderer.invoke('capabilities:list', workspaceId),
    disabled: {
      get: () =>
        ipcRenderer.invoke('capabilities:disabled:get') as Promise<{
          skillPaths: string[]
          extensionPaths: string[]
          disabledTools: { extensionPath: string; toolName: string }[]
        }>,
      set: (next: {
        skillPaths: string[]
        extensionPaths: string[]
        disabledTools?: { extensionPath: string; toolName: string }[]
      }) => ipcRenderer.invoke('capabilities:disabled:set', next),
      patch: (
        patch:
          | { kind: 'skill' | 'extension'; path: string; excluded: boolean }
          | { kind: 'tool'; extensionPath: string; toolName: string; excluded: boolean },
      ) =>
        ipcRenderer.invoke('capabilities:disabled:patch', patch) as Promise<
          | {
              ok: true
              disabled: {
                skillPaths: string[]
                extensionPaths: string[]
                disabledTools: { extensionPath: string; toolName: string }[]
              }
            }
          | { ok: false; error: string }
        >,
    },
    skillParamsMeta: (skillPath: string) =>
      ipcRenderer.invoke('capabilities:skillParamsMeta', skillPath),
    skillParamsGet: (skillPath: string) =>
      ipcRenderer.invoke('capabilities:skillParamsGet', skillPath),
    skillParamsSave: (skillPath: string, values: Record<string, unknown>) =>
      ipcRenderer.invoke('capabilities:skillParamsSave', skillPath, values),
    skillMdGet: (skillPath: string, workspaceId?: string) =>
      ipcRenderer.invoke('capabilities:skillMdGet', skillPath, workspaceId),
    skillMdSave: (
      skillPath: string,
      content: string,
      workspaceId?: string,
      confirmCoreSyloEdit?: boolean,
    ) =>
      ipcRenderer.invoke(
        'capabilities:skillMdSave',
        skillPath,
        content,
        workspaceId,
        confirmCoreSyloEdit,
      ),
    extensionConfigMeta: (extensionPath: string) =>
      ipcRenderer.invoke('capabilities:extensionConfigMeta', extensionPath),
    extensionConfigGet: (configKey: string) =>
      ipcRenderer.invoke('capabilities:extensionConfigGet', configKey),
    extensionConfigSave: (configKey: string, values: Record<string, unknown>) =>
      ipcRenderer.invoke('capabilities:extensionConfigSave', configKey, values),
  },
  shell: {
    openPath: (p: string) => ipcRenderer.invoke('shell:openPath', p),
    openExternal: (url: string) =>
      ipcRenderer.invoke('shell:openExternal', url) as Promise<{ ok: true } | { ok: false; error: string }>,
    resolveLocalPath: (raw: string, workspaceId?: string) =>
      ipcRenderer.invoke('shell:resolveLocalPath', raw, workspaceId) as Promise<
        | { ok: true; path: string }
        | { ok: false; error: string; tried: string[] }
      >,
    showItemInFolder: (absPath: string) =>
      ipcRenderer.invoke('shell:showItemInFolder', absPath) as Promise<string>,
    openDirectory: (dir: string) =>
      ipcRenderer.invoke('shell:openDirectory', dir) as Promise<
        { ok: true; path: string } | { ok: false; error: string }
      >,
    openSkillFile: (folderPath: string) =>
      ipcRenderer.invoke('shell:openSkillFile', folderPath),
    removeStandalone: (folderPath: string, workspaceId?: string) =>
      ipcRenderer.invoke('skills:removeStandalone', folderPath, workspaceId),
  },
  dialog: {
    openDirectory: (opts?: { title?: string; defaultPath?: string }) =>
      ipcRenderer.invoke('dialog:openDirectory', opts) as Promise<string | undefined>,
    openFile: (opts?: {
      title?: string
      defaultPath?: string
      filters?: { name: string; extensions: string[] }[]
    }) => ipcRenderer.invoke('dialog:openFile', opts) as Promise<string | undefined>,
  },
  git: {
    restore: (repoRoot: string, fileRel: string) =>
      ipcRenderer.invoke('git:restore', repoRoot, fileRel),
  },
  package: {
    installPath: (specPath: string, workspaceId?: string) =>
      ipcRenderer.invoke('package:installPath', specPath, workspaceId),
    installSpec: (spec: string, workspaceId?: string) =>
      ipcRenderer.invoke('package:installSpec', spec.trim(), workspaceId),
    updateSpec: (spec: string, workspaceId?: string) =>
      ipcRenderer.invoke('package:updateSpec', spec.trim(), workspaceId),
    uninstallSpec: (spec: string, workspaceId?: string) =>
      ipcRenderer.invoke('package:uninstallSpec', spec.trim(), workspaceId),
    searchPiPackages: (query: string) => ipcRenderer.invoke('package:searchPiPackages', query),
    piDevCatalog: (query: {
      page?: number
      name?: string
      type?: '' | 'extension' | 'skill' | 'theme' | 'prompt'
      sort?: 'downloads' | 'recent' | 'name'
    }) => ipcRenderer.invoke('package:piDevCatalog', query),
  },
  optionalPackages: {
    installPythonDeps: (packageId: string) =>
      ipcRenderer.invoke('optional-packages:installPythonDeps', packageId) as Promise<
        | { ok: true; skipped: boolean; message: string }
        | { ok: false; error: string }
      >,
    pythonReadiness: () =>
      ipcRenderer.invoke('optional-packages:pythonReadiness') as Promise<{
        preferredInstalled: boolean
        resolvedExe: string
        resolvedVersion: { major: number; minor: number; patch: number; raw: string } | null
        status: 'ok' | 'missing-preferred' | 'unusable'
        message: string
      }>,
  },
  ollama: {
    listTags: (baseOrigin: string) =>
      ipcRenderer.invoke('ollama:listTags', baseOrigin) as Promise<
        { ok: true; models: string[] } | { ok: false; error: string }
      >,
    inferBaseUrl: () => ipcRenderer.invoke('ollama:inferBaseUrl') as Promise<string>,
    probeVision: (baseOrigin: string, modelId: string) =>
      ipcRenderer.invoke('ollama:probeVision', baseOrigin, modelId) as Promise<
        { ok: true; vision: boolean } | { ok: false; error: string }
      >,
    patchBaseUrl: (baseOrigin: string, ensureModelId?: string, visionCapable?: boolean) =>
      ipcRenderer.invoke('pi:patchOllamaBaseUrl', baseOrigin, ensureModelId, visionCapable) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
  },
    models: {
    getInputConfig: (provider: string, modelId: string) =>
      ipcRenderer.invoke('models:getInputConfig', provider, modelId) as Promise<
        | { ok: true; input: ('text' | 'image')[]; explicit: boolean; visionCapable: boolean }
        | { ok: false; error: string }
      >,
        setVision: (provider: string, modelId: string, visionCapable: boolean) =>
      ipcRenderer.invoke('models:setVision', provider, modelId, visionCapable) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
  },
  /** Provider API keys — stored in Pi's `~/.pi/agent/auth.json` (masked reads). */
  piAuth: {
    get: (provider: string) =>
      ipcRenderer.invoke('pi:getProviderAuth', provider) as Promise<
        | { ok: true; hasKey: boolean; keyPreview: string | null }
        | { ok: false; error: string }
      >,
    /** key: '' removes the entry; null/missing key keeps it. */
    set: (provider: string, key: string) => ipcRenderer.invoke('pi:setProviderAuth', provider, key) as
      Promise<{ ok: true } | { ok: false; error: string }>,
  },
  /** OpenRouter (free-tier) model list from the public endpoint. */
  openrouter: {
    listModels: () =>
      ipcRenderer.invoke('openrouter:listModels') as Promise<
        | { ok: true; models: { id: string; name: string; contextLength: number | null }[]; source: 'live' | 'fallback' }
        | { ok: false; error: string }
      >,
  },
  /** Thinking (reasoning) effort supported for a provider/model per Pi. */
  thinking: {
    levels: (provider: string, modelId: string) =>
      ipcRenderer.invoke('thinking:levels', provider, modelId) as Promise<
        | { ok: true; levels: string[]; resolvedModel: { provider: string; modelId: string } | null }
        | { ok: false; error: string }
      >,
  },
  skills: {
    saveFromChat: (name: string, description: string, body: string) =>
      ipcRenderer.invoke('skills:saveFromChat', name, description, body),
  },
  safeMode: {
    clear: () => ipcRenderer.invoke('safeMode:clear'),
  },
  companion: {
    getStatus: () =>
      ipcRenderer.invoke('companion:getStatus') as Promise<{
        enabled: boolean
        running: boolean
        port: number
        bind: 'loopback' | 'lan'
        username: string
        hasCredentials: boolean
        staticBuilt: boolean
        urls: {
                    loopback: string
          lan: string[]
          fqdn: string | null
        }
        tls: {
          mode: 'mkcert' | 'sylo-ca'
          certName: string
          certsDir: string
          rootCaPath: string | null
          rootCaDownloadPath: string
        }
      }>,
    openCertsFolder: () => ipcRenderer.invoke('companion:openCertsFolder') as Promise<boolean>,
    setConfig: (patch: { enabled?: boolean; bind?: 'loopback' | 'lan'; port?: number }) =>
            ipcRenderer.invoke('companion:setConfig', patch) as Promise<
        | {
            enabled: boolean
            running: boolean
            port: number
            bind: 'loopback' | 'lan'
            username: string
            hasCredentials: boolean
            staticBuilt: boolean
            urls: {
              loopback: string
              lan: string[]
              fqdn: string | null
            }
          }
        | { ok: false; error: string }
      >,
    setCredentials: (payload: { username: string; password: string }) =>
            ipcRenderer.invoke('companion:setCredentials', payload) as Promise<
        | {
            enabled: boolean
            running: boolean
            port: number
            bind: 'loopback' | 'lan'
            username: string
            hasCredentials: boolean
            staticBuilt: boolean
            urls: {
              loopback: string
              lan: string[]
              fqdn: string | null
            }
          }
        | { ok: false; error: string }
      >,
  },
  canvas: {
    /** Renderer → main: report the docked canvas' open state so the native
     *  Window-menu item label stays in sync ("Show Canvas" / "Hide Canvas"). */
    reportOpenState: (open: boolean) =>
      ipcRenderer.invoke('canvas:set-open-state', open) as Promise<true>,
    /** Main → renderer: the operator clicked "Show/Hide Canvas" in the native
     *  Window menu. The renderer toggles its `canvasOpen` state (and persists
     *  the pref), then reports the new state back via `reportOpenState`. */
    onToggleRequest: (cb: () => void) => {
      const ch = () => cb()
      ipcRenderer.on('canvas:toggle', ch)
      return () => ipcRenderer.removeListener('canvas:toggle', ch)
    },
    onShow: (
      cb: (p: {
        toolCallId: string
        kind: 'svg' | 'mermaid' | 'markdown'
        title?: string
        content?: string
        filePath?: string
        sourcePath?: string
      }) => void,
    ) => {
      const ch = (
        _: unknown,
                p: {
          toolCallId: string
          kind: 'svg' | 'mermaid' | 'markdown'
          title?: string
          content?: string
          filePath?: string
          sourcePath?: string
          workspaceKey?: string
        },
      ) => cb(p)
      ipcRenderer.on('canvas:show', ch)
      return () => ipcRenderer.removeListener('canvas:show', ch)
    },
    openPopoutWindow: (payload: {
      kind: 'svg' | 'mermaid' | 'markdown'
      title?: string
      content?: string
      filePath?: string
      sourcePath?: string
      toolCallId?: string
    }) =>
      ipcRenderer.invoke('canvas:open-popout', payload) as Promise<
        { ok: true; id: string } | { ok: false; error: string }
      >,
    /** Open a popped-out window bound to a live subscription. The window loads
     *  `#popout-canvas-live=<liveId>`, fetches the latest state via
     *  `getLivePopout`, and subscribes to `canvas:live-update` so it stays in
     *  sync with the docked canvas. The `liveId` must already exist in main. */
    openLivePopoutWindow: (payload: { liveId: string; title?: string }) =>
      ipcRenderer.invoke('canvas:open-live-popout', payload) as Promise<
        { ok: true; id: string } | { ok: false; error: string }
      >,
    getPopout: (popoutId: string) =>
      ipcRenderer.invoke('canvas:get-popout', popoutId) as Promise<{
        kind: 'svg' | 'mermaid' | 'markdown'
        title?: string
        content?: string
        filePath?: string
        sourcePath?: string
        toolCallId?: string
      } | null>,
    showFile: (payload: { kind: 'svg' | 'markdown'; filePath: string; title?: string }) =>
      ipcRenderer.invoke('canvas:show-file', payload) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
        // ── Live (subscribed) canvas — sibling to the snapshot surface above ──
    /** Main → renderer: open a live subscription on the docked canvas.
     *  `workspaceKey` is set for `task-board` shows so the renderer can ignore
     *  it when the operator has switched to a different workspace (the board
     *  stays registered in main and is restored on return). */
        onLiveShow: (
      cb: (p: {
        liveId: string
        kind: 'live-demo' | 'task-board'
        title?: string
        data?: unknown
        workspaceKey?: string
      }) => void,
    ) => {
      const ch = (_: unknown, p: unknown) => cb(p as Parameters<typeof cb>[0])
      ipcRenderer.on('canvas:live-show', ch)
      return () => ipcRenderer.removeListener('canvas:live-show', ch)
    },
    /** Main → renderer: a data patch for a subscribed `liveId`. The renderer
     *  filters by `liveId` (it may receive patches for a subscription it has
     *  since replaced). */
    onLiveUpdate: (cb: (p: { liveId: string; data: unknown }) => void) => {
      const ch = (_: unknown, p: unknown) => cb(p as { liveId: string; data: unknown })
      ipcRenderer.on('canvas:live-update', ch)
      return () => ipcRenderer.removeListener('canvas:live-update', ch)
    },
    /** Main → renderer: a live subscription was disposed (e.g. "Stop" clicked).
     *  The docked canvas clears its live view. */
    onLiveClear: (cb: (p: { liveId: string }) => void) => {
      const ch = (_: unknown, p: unknown) => cb(p as { liveId: string })
      ipcRenderer.on('canvas:live-clear', ch)
      return () => ipcRenderer.removeListener('canvas:live-clear', ch)
    },
    /** Renderer → main: register this webContents (docked canvas or a popout)
     *  to receive `canvas:live-update` patches for `liveId`. Main auto-removes
     *  destroyed webContents. Returns false if `liveId` is unknown. */
    liveSubscribe: (liveId: string) =>
      ipcRenderer.invoke('canvas:live-subscribe', liveId) as Promise<boolean>,
    liveUnsubscribe: (liveId: string) =>
      ipcRenderer.invoke('canvas:live-unsubscribe', liveId) as Promise<void>,
    /** Popout-only: fetch the latest `CanvasLiveSubscription` state for a
     *  `liveId` so a freshly opened popout can render current data before the
     *  first `canvas:live-update` arrives. */
        getLivePopout: (liveId: string) =>
      ipcRenderer.invoke('canvas:get-live-popout', liveId) as Promise<
        | { liveId: string; kind: 'live-demo' | 'task-board'; title?: string; data?: unknown }
        | null
      >,
    stopLiveDemo: (liveId: string) =>
      ipcRenderer.invoke('canvas:live-demo-stop', liveId) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
        /** Phase 4: apply an operator edit (status toggle / notes) to a task on a
     *  task-board. The edit carries the board's `liveId` so main routes it to
     *  the right workspace's store regardless of which workspace is active.
     *  Fire-and-forget — the board reconciles via the next `canvas:live-update`
     *  once the broker's store emits `sylo-tasks:changed`. */
    taskApplyEdit: (payload: {
      liveId: string
      taskId: string
      status?: string
      notes?: string | null
    }) =>
      ipcRenderer.invoke('canvas:task-apply-edit', payload) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
    /** Per-workspace canvas restore: fetch the board currently bound to a
     *  workspace (by its cwd) when switching TO that workspace, so the docked
     *  canvas can re-show it with fresh data. Returns null if the workspace
     *  has no board (or it was disposed while away). */
    getActiveBoardForWorkspace: (workspaceKey: string) =>
      ipcRenderer.invoke('canvas:get-active-board-for-workspace', workspaceKey) as Promise<
        | { liveId: string; kind: 'live-demo' | 'task-board'; title?: string; data?: unknown }
        | null
      >,
  },
  skillSurface: {
    onShow: (cb: (p: { toolCallId: string; html?: string; path?: string; data: unknown }) => void) => {
      const ch = (
        _: unknown,
        p: { toolCallId: string; html?: string; path?: string; data: unknown },
      ) => cb(p)
      ipcRenderer.on('skill-surface:show-widget', ch)
      return () => ipcRenderer.removeListener('skill-surface:show-widget', ch)
    },
    injectFollowUp: (text: string) =>
      ipcRenderer.invoke('skill-surface:inject-follow-up', text) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
    logicforgeParseRulesGet: () => ipcRenderer.invoke('logicforge:parseRulesGet'),
    logicforgeParseRulesSave: (payload: { parse_config?: unknown; settings?: unknown }) =>
      ipcRenderer.invoke('logicforge:parseRulesSave', payload),
    logicforgeParseRulesReset: () => ipcRenderer.invoke('logicforge:parseRulesReset'),
    logicforgeIoReviewGet: (payload: { run_dir: string }) =>
      ipcRenderer.invoke('logicforge:ioReviewGet', payload),
    logicforgeIoReviewReseed: (payload: { run_dir: string; overwrite?: boolean }) =>
      ipcRenderer.invoke('logicforge:ioReviewReseed', payload),
    logicforgeIoReviewSave: (payload: { run_dir: string; review?: unknown }) =>
      ipcRenderer.invoke('logicforge:ioReviewSave', payload),
        logicforgeIoReviewApproveBuild: (payload: { run_dir: string; review?: unknown }) =>
      ipcRenderer.invoke('logicforge:ioReviewApproveBuild', payload),
    logicforgeDownloadAllowlistGet: () =>
      ipcRenderer.invoke('logicforge:downloadAllowlistGet'),
    logicforgeDownloadAllowlistSave: (payload: {
      allow_downloads?: boolean
      post_download_mode?: 'program' | 'run'
      ips?: Array<{ ip: string; label?: string; enabled?: boolean }>
      notes?: string
    }) => ipcRenderer.invoke('logicforge:downloadAllowlistSave', payload),
        logicforgeDownloadPlcStatus: (ip: string) =>
      ipcRenderer.invoke('logicforge:downloadPlcStatus', ip),
    logicforgeTemplates: (op: string, payload?: Record<string, unknown>) =>
      ipcRenderer.invoke('logicforge:templates', op, payload ?? {}),
    syloWorkflowsList: (payload?: { project_dir?: string; agent_dir?: string } | string) =>
      ipcRenderer.invoke('syloWorkflows:workflowsList', payload ?? ''),
    syloWorkflowRead: (payload: {
      project_dir: string
      id: string
      agent_dir?: string
    }) => ipcRenderer.invoke('syloWorkflows:workflowRead', payload),
    syloWorkflowSave: (payload: {
      content: string
      previous_id?: string
      agent_dir?: string
    }) => ipcRenderer.invoke('syloWorkflows:workflowSave', payload),
    syloWorkflowDelete: (payload: { id: string; agent_dir?: string }) =>
      ipcRenderer.invoke('syloWorkflows:workflowDelete', payload),
    fieldbrainConfigGet: () => ipcRenderer.invoke('fieldbrain:configGet'),
    fieldbrainConfigSave: (payload: Record<string, unknown>) =>
      ipcRenderer.invoke('fieldbrain:configSave', payload),
    fieldbrainDbCheck: () => ipcRenderer.invoke('fieldbrain:dbCheck'),
    fieldbrainDbMigrate: () => ipcRenderer.invoke('fieldbrain:dbMigrate'),
    fieldbrainLogList: () => ipcRenderer.invoke('fieldbrain:logList'),
    fieldbrainDocumentList: (payload?: Record<string, unknown>) =>
      ipcRenderer.invoke('fieldbrain:documentList', payload ?? {}),
    fieldbrainBrainList: (payload: Record<string, unknown>) =>
      ipcRenderer.invoke('fieldbrain:brainList', payload),
    fieldbrainProjectList: () => ipcRenderer.invoke('fieldbrain:projectList'),
    fieldbrainProjectCreate: (payload: Record<string, unknown>) =>
      ipcRenderer.invoke('fieldbrain:projectCreate', payload),
    fieldbrainDbBootstrap: (payload: Record<string, unknown>) =>
      ipcRenderer.invoke('fieldbrain:dbBootstrap', payload),
    fieldbrainPgvectorGuide: () => ipcRenderer.invoke('fieldbrain:pgvectorGuide'),
    fieldbrainPgvectorInstallFromFolder: (payload: Record<string, unknown>) =>
      ipcRenderer.invoke('fieldbrain:pgvectorInstallFromFolder', payload),
    fieldbrainPgvectorEnable: (payload: Record<string, unknown>) =>
      ipcRenderer.invoke('fieldbrain:pgvectorEnable', payload),
    onenoteAuthStatus: () => ipcRenderer.invoke('onenote:authStatus'),
    onenoteAuthStart: () => ipcRenderer.invoke('onenote:authStart'),
    onenoteAuthComplete: () => ipcRenderer.invoke('onenote:authComplete'),
    onenoteAuthLogout: () => ipcRenderer.invoke('onenote:authLogout'),
    onenoteSettingsGet: () => ipcRenderer.invoke('onenote:settingsGet'),
    onenoteSettingsSave: (payload: Record<string, unknown>) =>
      ipcRenderer.invoke('onenote:settingsSave', payload),
    onenoteNotebookList: () => ipcRenderer.invoke('onenote:notebookList'),
    onenoteIndexSync: () => ipcRenderer.invoke('onenote:indexSync'),
    onenoteIndexProgress: () => ipcRenderer.invoke('onenote:indexProgress'),
    onenoteImportLegacyCache: () => ipcRenderer.invoke('onenote:importLegacyCache'),
  },
  skillSurfaces: {
    lintBatch: (paths: string[]) => ipcRenderer.invoke('skill-surfaces:lint-batch', paths),
  },
  skillRoutes: {
    list: (workspaceId?: string) => ipcRenderer.invoke('skill-routes:list', workspaceId),
    openPopoutWindow: (routeKey: string) =>
      ipcRenderer.invoke('skill-route:open-popout', routeKey) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
  },
  skillData: {
    read: (skillKey: string, key: string) => ipcRenderer.invoke('skill-data:read', skillKey, key),
    write: (skillKey: string, key: string, value: unknown) =>
      ipcRenderer.invoke('skill-data:write', skillKey, key, value),
  },
  webAccess: {
    listRuns: (limit?: number) => ipcRenderer.invoke('webaccess:listRuns', limit),
    stats: () => ipcRenderer.invoke('webaccess:stats'),
    configGet: () => ipcRenderer.invoke('webaccess:configGet'),
        configSave: (values: Record<string, unknown>) =>
      ipcRenderer.invoke('webaccess:configSave', values) as Promise<
        { ok: true; restartNote?: string } | { ok: false; error: string }
      >,
    braveQuota: () => ipcRenderer.invoke('webaccess:braveQuota'),
    onLifecycle: (cb: (payload: unknown) => void) => {
      const ch = (_e: unknown, payload: unknown) => cb(payload)
      ipcRenderer.on('webaccess:lifecycle', ch)
      return () => ipcRenderer.removeListener('webaccess:lifecycle', ch)
    },
  },
  // Personal-plugin bridge — generic; ops/dispatch come from the installed
  // personal bundle (sylo-tools-personal). Empty op list + rpc error when the
  // bundle is absent (public/controls machines).
  personal: {
    ops: () => ipcRenderer.invoke('personal:ops') as Promise<string[]>,
    rpc: (op: string, payload?: unknown) =>
      ipcRenderer.invoke('personal:rpc', op, payload) as Promise<unknown>,
    settingsCard: () => ipcRenderer.invoke('personal:settingsCard') as Promise<unknown>,
  },
  // User-installed Pi packages (personal bundles, community tools) — generic
  // Capability-manager card data. Always-on; no toggle.
  userPackages: {
    list: () => ipcRenderer.invoke('user-packages:list') as Promise<unknown>,
  },
  tasksDb: {
    snapshotGet: (workspaceCwd: string) =>
      ipcRenderer.invoke('tasks:db-snapshot-get', workspaceCwd),
    listGet: (args: { workspaceCwd: string; listId: string }) =>
      ipcRenderer.invoke('tasks:db-list-get', args),
    listCreate: (
      args: { workspaceCwd: string; title: string; mode?: string; description?: string },
    ) => ipcRenderer.invoke('tasks:db-list-create', args),
    listDelete: (args: { workspaceCwd: string; listId: string }) =>
      ipcRenderer.invoke('tasks:db-list-delete', args),
    taskAdd: (args: {
      workspaceCwd: string
      list_id: string
      title: string
      status?: string
      notes?: string
      due?: string
      blocked_by?: string[]
    }) => ipcRenderer.invoke('tasks:db-task-add', args),
    taskUpdate: (args: {
      workspaceCwd: string
      id: string
      title?: string
      status?: string
      notes?: string | null
      due?: string | null
      blocked_by?: string[]
    }) => ipcRenderer.invoke('tasks:db-task-update', args),
    taskDelete: (args: { workspaceCwd: string; taskId: string }) =>
      ipcRenderer.invoke('tasks:db-task-delete', args),
  },
  logicforge: {
    parseRulesGet: () => ipcRenderer.invoke('logicforge:parseRulesGet'),
    parseRulesSave: (payload: { parse_config?: unknown; settings?: unknown }) =>
      ipcRenderer.invoke('logicforge:parseRulesSave', payload),
    parseRulesReset: () => ipcRenderer.invoke('logicforge:parseRulesReset'),
    ioReviewGet: (payload: { run_dir: string }) =>
      ipcRenderer.invoke('logicforge:ioReviewGet', payload),
    ioReviewReseed: (payload: { run_dir: string; overwrite?: boolean }) =>
      ipcRenderer.invoke('logicforge:ioReviewReseed', payload),
    ioReviewSave: (payload: { run_dir: string; review?: unknown }) =>
      ipcRenderer.invoke('logicforge:ioReviewSave', payload),
    ioReviewApproveBuild: (payload: { run_dir: string; review?: unknown }) =>
      ipcRenderer.invoke('logicforge:ioReviewApproveBuild', payload),
    downloadAllowlistGet: () => ipcRenderer.invoke('logicforge:downloadAllowlistGet'),
    downloadAllowlistSave: (payload: {
      allow_downloads?: boolean
      post_download_mode?: 'program' | 'run'
      ips?: Array<{ ip: string; label?: string; enabled?: boolean }>
      notes?: string
    }) => ipcRenderer.invoke('logicforge:downloadAllowlistSave', payload),
        downloadPlcStatus: (ip: string) =>
      ipcRenderer.invoke('logicforge:downloadPlcStatus', ip),
    templates: (op: string, payload?: Record<string, unknown>) =>
      ipcRenderer.invoke('logicforge:templates', op, payload ?? {}),
  },
  fieldbrain: {
    configGet: () => ipcRenderer.invoke('fieldbrain:configGet'),
    configSave: (payload: Record<string, unknown>) =>
      ipcRenderer.invoke('fieldbrain:configSave', payload),
    dbCheck: () => ipcRenderer.invoke('fieldbrain:dbCheck'),
    dbMigrate: () => ipcRenderer.invoke('fieldbrain:dbMigrate'),
    logList: () => ipcRenderer.invoke('fieldbrain:logList'),
    documentList: (payload?: Record<string, unknown>) =>
      ipcRenderer.invoke('fieldbrain:documentList', payload ?? {}),
    brainList: (payload: Record<string, unknown>) =>
      ipcRenderer.invoke('fieldbrain:brainList', payload),
    projectList: () => ipcRenderer.invoke('fieldbrain:projectList'),
    projectCreate: (payload: Record<string, unknown>) =>
      ipcRenderer.invoke('fieldbrain:projectCreate', payload),
    dbBootstrap: (payload: Record<string, unknown>) =>
      ipcRenderer.invoke('fieldbrain:dbBootstrap', payload),
    pgvectorGuide: () => ipcRenderer.invoke('fieldbrain:pgvectorGuide'),
    pgvectorInstallFromFolder: (payload: Record<string, unknown>) =>
      ipcRenderer.invoke('fieldbrain:pgvectorInstallFromFolder', payload),
    pgvectorEnable: (payload: Record<string, unknown>) =>
      ipcRenderer.invoke('fieldbrain:pgvectorEnable', payload),
  },
  onenote: {
    authStatus: () => ipcRenderer.invoke('onenote:authStatus'),
    authStart: () => ipcRenderer.invoke('onenote:authStart'),
    authComplete: () => ipcRenderer.invoke('onenote:authComplete'),
    authLogout: () => ipcRenderer.invoke('onenote:authLogout'),
    settingsGet: () => ipcRenderer.invoke('onenote:settingsGet'),
    settingsSave: (payload: Record<string, unknown>) =>
      ipcRenderer.invoke('onenote:settingsSave', payload),
    notebookList: () => ipcRenderer.invoke('onenote:notebookList'),
    indexSync: () => ipcRenderer.invoke('onenote:indexSync'),
    indexProgress: () => ipcRenderer.invoke('onenote:indexProgress'),
    importLegacyCache: () => ipcRenderer.invoke('onenote:importLegacyCache'),
  },
  tts: {
    listVoices: () =>
      ipcRenderer.invoke('tts:listVoices') as Promise<
        Array<{ id: string; label: string; backend: string }>
      >,
    configGet: () => ipcRenderer.invoke('tts:configGet') as Promise<Record<string, unknown>>,
    configSave: (values: Record<string, unknown>) =>
      ipcRenderer.invoke('tts:configSave', values) as Promise<
        { ok: true; restartNote?: string } | { ok: false; error: string }
      >,
        generate: (args: {
          text: string
          voice_id?: string
          kokoro_speed?: number
          orpheus_temperature?: number
          orpheus_top_p?: number
        }) =>
          ipcRenderer.invoke('tts:generate', args) as Promise<
        | {
            ok: true
            wavPath: string
            durationMs: number
            voiceId: string
            voiceLabel: string
          }
        | { ok: false; error: string }
      >,
    deleteRouteClip: (wavPath: string) =>
      ipcRenderer.invoke('tts:deleteRouteClip', wavPath) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
  },
  evals: {
    loadDashboard: () =>
      ipcRenderer.invoke('evals:loadDashboard') as Promise<
        | {
            ok: true
            data: {
              runs: Array<{
                run_id: string
                run_at: string
                note: string | null
                sylo_version: string | null
                sylo_git_commit: string | null
                sylo_git_dirty: boolean | null
                sessions_scanned: number
                sessions_skipped_since: number
                scope: 'cumulative' | 'windowed'
                since: string | null
                metrics: Record<string, number>
                totals: Record<string, number>
                anomaly_count: number
                model_error_breakdown: Array<{
                  model: string
                  calls: number
                  errors: number
                  error_rate: number
                }>
              }>
              tracked: Array<{ key: string; label: string; percent?: boolean }>
              builtAt: string
              runsDir: string
              minerPath: string
              labRoot: string
            }
          }
        | { ok: false; error: string }
      >,
    runBaseline: (note?: string, since?: string) =>
      ipcRenderer.invoke('evals:runBaseline', note, since) as Promise<
        | { ok: true; runId: string | null; output: string }
        | { ok: false; error: string; detail?: string }
      >,
  },
  tasks: {
    list: (conversationId: string) => ipcRenderer.invoke('tasks:list', conversationId),
    get: (taskId: string) => ipcRenderer.invoke('tasks:get', taskId),
        cancel: (taskId: string) => ipcRenderer.invoke('tasks:cancel', taskId) as Promise<
          | { ok: true; killed: boolean }
          | { ok: false; error: 'bad_id' | 'not_found' | 'not_running' }
        >,
    retry: (taskId: string) => ipcRenderer.invoke('tasks:retry', taskId),
    orphanedCount: () => ipcRenderer.invoke('tasks:orphanedCount') as Promise<number>,
    clearOrphaned: () =>
      ipcRenderer.invoke('tasks:clearOrphaned') as Promise<{ ok: true; deleted: number }>,
    diagnostics: () =>
      ipcRenderer.invoke('tasks:diagnostics') as Promise<{
        runningCount: number
        orphanedCount: number
        extensionEnabled: boolean
      }>,
    onLifecycle: (cb: (payload: unknown) => void) => {
      const ch = (_e: unknown, payload: unknown) => cb(payload)
      ipcRenderer.on('subagents:lifecycle', ch)
      return () => ipcRenderer.removeListener('subagents:lifecycle', ch)
    },
  },
  thinkTank: {
    sessionGet: (sessionId: string) => ipcRenderer.invoke('thinkTank:sessionGet', sessionId),
    listForConversation: (conversationId: string) =>
      ipcRenderer.invoke('thinkTank:listForConversation', conversationId) as Promise<
        Array<Record<string, unknown>>
      >,
    configGet: () => ipcRenderer.invoke('thinkTank:configGet'),
    configSave: (values: Record<string, unknown>) =>
      ipcRenderer.invoke('thinkTank:configSave', values) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
    pickReport: (sessionId: string, reportId: string) =>
      ipcRenderer.invoke('thinkTank:pickReport', sessionId, reportId) as Promise<
        { ok: true; selectedReportId: string } | { ok: false; error: string }
      >,
    inject: (sessionId: string, text: string) =>
      ipcRenderer.invoke('thinkTank:inject', sessionId, text) as Promise<
        { ok: true; pendingCount: number } | { ok: false; error: string }
      >,
    abort: (sessionId: string) =>
      ipcRenderer.invoke('thinkTank:abort', sessionId) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
    onLifecycle: (cb: (payload: unknown) => void) => {
      const ch = (_e: unknown, payload: unknown) => cb(payload)
      ipcRenderer.on('thinkTank:lifecycle', ch)
      return () => ipcRenderer.removeListener('thinkTank:lifecycle', ch)
    },
  },
  schedules: {
    list: (workspaceId: string) => ipcRenderer.invoke('schedules:list', workspaceId),
    get: (id: string) => ipcRenderer.invoke('schedules:get', id),
    create: (workspaceId: string, input: Record<string, unknown>) =>
      ipcRenderer.invoke('schedules:create', workspaceId, input),
    update: (id: string, patch: Record<string, unknown>) =>
      ipcRenderer.invoke('schedules:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('schedules:delete', id),
    fireNow: (id: string) =>
      ipcRenderer.invoke('schedules:fireNow', id) as Promise<
        { ok: true; conversationId: string } | { ok: false; error: string }
      >,
    onChanged: (cb: (payload: { workspaceId: string }) => void) => {
      const ch = (_e: unknown, payload: { workspaceId: string }) => cb(payload)
      ipcRenderer.on('schedules:changed', ch)
      return () => ipcRenderer.removeListener('schedules:changed', ch)
    },
  },
})
