export {}

declare global {
  type ProposalKind = 'commons' | 'workspace'

  type SweepConfig = {
    enabled: boolean
    day_of_week: number
    time_local: string
    reader_provider: string
    reader_model_id: string
    max_findings: number
    max_transcript_chars: number
    last_run_at: number
    last_status: string
  }

  type ProposalItem = {
    root: string
    kind: ProposalKind
    label: string
    relPath: string
    fileName: string
    id: string
    title: string
    status: string
    scope: string
    target: string
    source: string
    body: string
    proposedChange: string
    frontmatterError?: string
  }

  type CapabilityOrigin =
    | 'pi-agent'
    | 'pi-cwd'
    | 'cursor-skills'
    | 'sylo-repo'
    | 'npm-package'
    | 'git-package'
    | 'sylo-builtin'
    | 'sylo-optional'

  type GithubRepoLite = {
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
  }

  type SkillSurfaceLintSurface =
    | { kind: 'widget'; id: string; title?: string; fallbackPath: string; ok: boolean }
    | {
        kind: 'route'
        id: string
        title?: string
        nav_section?: string
        required_capabilities?: string[]
        fallbackPath: string
        ok: boolean
      }

  type SkillSurfaceLintReport = {
    skillMdPath: string
    surfaces: SkillSurfaceLintSurface[]
    errors: string[]
    hasParamsSchema: boolean
  }

  type CapabilityToolInfo = {
    name: string
    description?: string
    /** Canonical paths of other extensions that register this tool name — host-only UX. */
    nameConflictPeers?: string[]
    /** When true, excluded via ~/.sylo/disabled.json (merged with workspace). */
    excludedFromAgent?: boolean
  }

  type CapabilitiesView = {
    agentDir: string
    piCwd: string
    brokerReady: boolean
    brokerOk: boolean
    brokerError?: string
    skills: {
      name: string
      path: string
      origin: CapabilityOrigin
      excludedFromAgent: boolean
    }[]
    extensions: {
      name: string
      path: string
      /** Broker-resolved absolute path when known — same keying as per-tool disable in ~/.sylo/disabled.json. */
      resolvedPath?: string
      origin: CapabilityOrigin
      excludedFromAgent: boolean
      tools: CapabilityToolInfo[]
      commandNames: string[]
      builtinHint?: string
    }[]
    packages: string[]
    packageInventory: {
      source: string
      scope: string
      filtered: boolean
      installedPath?: string
    }[]
    loadErrors: { path: string; error: string }[]
    /** Duplicate Pi tool id → canonical extension paths contributing that name (broker snapshot only). */
    toolNameCollisions: Record<string, string[]>
  }

  interface Window {
    sylo: {
      proposals: {
        list: () => Promise<
          | { ok: false; error: string }
          | {
              ok: true
              commonsDir: string
              pending: ProposalItem[]
              recent: Array<{
                root: string
                kind: ProposalKind
                label: string
                status: string
                fileName: string
                mtimeMs: number
              }>
            }
        >
        apply: (
          root: string,
          relPath: string,
          editedBody?: string,
        ) => Promise<
          | { ok: true; pushOk: boolean; detail: string }
          | { ok: false; error: string; detail?: string }
        >
        reject: (
          root: string,
          relPath: string,
          reason: string,
        ) => Promise<
          | { ok: true; pushOk: boolean; detail: string }
          | { ok: false; error: string; detail?: string }
        >
      }
      sweep: {
    getConfig: () => Promise<SweepConfig>
    setConfig: (patch: Partial<SweepConfig>) => Promise<SweepConfig>
    runNow: () => Promise<
      | { ok: true; conversationId: string; msgCount: number }
      | { ok: false; error: string }
    >
  }
  conversations: {
        list: (workspaceId?: string) => Promise<
          {
            id: string
            title: string
            created_at: number
            updated_at: number
            workspace_id: string | null
            pi_session_relpath: string | null
            model_provider: string | null
            model_id: string | null
            image_model_id: string | null
            image_model_provider: string | null
            thinking_level: string | null
          }[]
        >
        create: (
          title?: string,
          workspaceId?: string,
        ) => Promise<{
          id: string
          title: string
          created_at: number
          updated_at: number
          workspace_id: string | null
          pi_session_relpath: string | null
          model_provider: string | null
          model_id: string | null
          image_model_id: string | null
          image_model_provider: string | null
          thinking_level: string | null
        }>
        /** Most recently updated conversation in this workspace that has no rows in `messages`. */
        findLatestEmpty: (workspaceId: string) => Promise<string | null>
        setTitle: (id: string, title: string) => Promise<void>
        setWorkspace: (id: string, workspaceId: string) => Promise<void>
        /** Persist the per-chat model override (null fields inherit the global default). */
        setModel: (
          id: string,
          model: {
            model_provider: string | null
            model_id: string | null
            image_model_id: string | null
            image_model_provider: string | null
            thinking_level?: string | null
          },
        ) => Promise<{ ok: true } | { ok: false; error: string }>
        /** Per-chat override + resolved effective model (per-chat ?? global prefs). */
        getModel: (
          id: string,
        ) => Promise<
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
        >
        delete: (id: string) => Promise<void>
      }
      /** Thinking (reasoning) effort supported for a provider/model per Pi. */
            thinking: {
        levels: (
          provider: string,
          modelId: string,
        ) => Promise<
          | { ok: true; levels: string[]; resolvedModel: { provider: string; modelId: string } | null }
          | { ok: false; error: string }
        >
      }
      workspaces: {
        list: () => Promise<
          {
            id: string
            name: string
            pi_cwd: string
            path_segment: string
            disabled_skill_paths_json: string
            disabled_extension_paths_json: string
            enabled_skill_paths_json: string
            always_apply_skill_paths_json: string
            github_remote_url: string
            github_backup_enabled: number
            github_last_sync_at: number | null
            sort_order: number
            created_at: number
            /** Effective Pi project directory (inherits Default workspace when unset). */
            resolved_pi_cwd: string
            /** Primary only: its folder was missing on disk at app startup. */
            folder_missing: boolean
          }[]
        >
        /** Ensures Dev sylo workspace exists (dev repo clone) and returns its id. */
        devWorkspaceId: () => Promise<string | null>
        defaultPathForName: (name: string) => Promise<string>
        create: (
          name: string,
          piCwd?: string,
          opts?: { createPiProjectDir?: boolean },
        ) => Promise<
          | { ok: true; workspace: {
              id: string
              name: string
              pi_cwd: string
              path_segment: string
              disabled_skill_paths_json: string
              disabled_extension_paths_json: string
              enabled_skill_paths_json: string
              always_apply_skill_paths_json: string
              github_remote_url: string
              github_backup_enabled: number
              github_last_sync_at: number | null
              sort_order: number
              created_at: number
            } }
          | { ok: false; error: 'pi_project_dir_not_found'; path: string }
          | { ok: false; error: 'mkdir_failed'; path: string; detail: string }
        >
        update: (
          id: string,
          patch: { name?: string; pi_cwd?: string },
          opts?: { createPiProjectDir?: boolean },
        ) => Promise<
          | { ok: true }
          | { ok: false; error: 'pi_project_dir_not_found'; path: string }
          | { ok: false; error: 'mkdir_failed'; path: string; detail: string }
          | { ok: false; error: 'rename_failed'; detail: string }
        >
        /** Create the missing primary (user-data) workspace folder under `name`. */
        primaryProvision: (args: { name: string }) => Promise<
          | { ok: true; workspace: { id: string; name: string; pi_cwd: string } }
          | { ok: false; error: string; detail?: string }
        >
        /** Restore the primary workspace by cloning a GitHub repo into its expected folder. */
        primaryRestoreFromGithub: (args: { cloneUrl: string }) => Promise<
          | { ok: true; workspace: { id: string; name: string; pi_cwd: string } }
          | { ok: false; error: string; detail?: string }
        >
        resetPrimaryPiProject: () => Promise<string>
        delete: (id: string) => Promise<void>
        patchDisabled: (
          patch:
            | {
                workspaceId: string
                kind: 'skill' | 'extension'
                path: string
                excluded: boolean
              }
            | {
                workspaceId: string
                kind: 'tool'
                extensionPath: string
                toolName: string
                excluded: boolean
              },
        ) => Promise<
          | {
              ok: true
              disabled: {
                skillPaths: string[]
                extensionPaths: string[]
                disabledTools: { extensionPath: string; toolName: string }[]
              }
            }
          | { ok: false; error: string }
        >
        backup: {
          status: (workspaceId: string) => Promise<
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
          >
          save: (
            workspaceId: string,
            patch: { github_remote_url?: string; github_backup_enabled?: boolean },
          ) => Promise<
            | { ok: true; linked: boolean; detail?: string }
            | { ok: false; error: string; detail?: string }
          >
          pull: (workspaceId: string) => Promise<
            | { ok: true; detail?: string }
            | { ok: false; error: string; detail?: string }
          >
          push: (workspaceId: string) => Promise<
            | { ok: true; detail?: string }
            | { ok: false; error: string; detail?: string }
          >
          pushAll: () => Promise<{
            ok: true
            results: {
              workspaceId: string
              name: string
              result: { ok: true; detail?: string } | { ok: false; error: string; detail?: string }
            }[]
          }>
        }
        github: {
          status: () => Promise<
            | { connected: true; login: string; encrypted: boolean }
            | { connected: false }
          >
                    connect: (
            token: string,
          ) => Promise<
            | { ok: true; login: string; publicRepos: number | null }
            | { ok: false; error: string }
          >
          deviceFlow: {
            start: () => Promise<
              | {
                  ok: true
                  userCode: string
                  verificationUri: string
                  verificationUriComplete?: string
                  interval: number
                  expiresIn: number
                }
              | { ok: false; error: string }
            >
            poll: () => Promise<
              | { status: 'success'; auth: { ok: true; login: string; publicRepos: number | null } | { ok: false; error: string } }
              | { status: 'pending' }
              | { status: 'slow_down'; interval: number }
              | { status: 'expired'; error: string }
              | { status: 'error'; error: string }
            >
            cancel: () => Promise<{ ok: true }>
          }
          disconnect: () => Promise<{ ok: true }>
          /** Resolved clone root: stored pref override else `<Documents>/GitHub`. */
          defaultCloneDir: () => Promise<string>
          setDefaultCloneDir: (dir: string) => Promise<string>
          listRepos: (opts?: { page?: number; perPage?: number }) => Promise<
            | {
                ok: true
                repos: GithubRepoLite[]
                hasMore: boolean
                page: number
              }
            | { ok: false; error: string; status?: number }
          >
          listOrgs: () => Promise<
            | { ok: true; orgs: Array<{ login: string; id: number }> }
            | { ok: false; error: string; status?: number }
          >
          clone: (args: {
            cloneUrl: string
            destDir: string
            name: string
            privateRepo?: boolean
            enableBackup?: boolean
          }) => Promise<
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
          >
          publish: (args: {
            workspaceId: string
            name: string
            owner?: string
            privateRepo?: boolean
            description?: string
          }) => Promise<
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
          >
        }
      }
      messages: {
        list: (
          conversationId: string,
        ) => Promise<
          {
            id: string
            conversation_id: string
            role: string
            content: string
            tool_calls_json: string | null
            status: string
            created_at: number
          }[]
        >
      }
      chat: {
        send: (
          conversationId: string,
          text: string,
          attachments?: { path: string; name?: string }[],
        ) => Promise<{
          assistantMessageId: string
          error?: 'broker_not_ready'
          deferred?: true
        }>
        abort: (
          conversationId: string,
        ) => Promise<{ ok: true } | { ok: false; error: string }>
        steer: (
          conversationId: string,
          text: string,
          attachments?: { path: string; name?: string }[],
        ) => Promise<{ ok: true } | { ok: false; error: string }>
        deliverQueued: (
          conversationId: string,
          text: string,
          attachments?: { path: string; name?: string }[],
        ) => Promise<{ ok: true } | { ok: false; error: string }>
        branchConversation: (
          conversationId: string,
        ) => Promise<
          | { ok: true; conversationId: string; pi_session_relpath: string }
          | { ok: false; error: string }
        >
        /** Save clipboard image bytes under userData/sylo-paste-images; returns path for the agent. */
        writePastedImage: (
          data: ArrayBuffer,
          mimeType: string,
        ) => Promise<{ path: string; name: string }>
      }
      prefs: { get: (key: string, fallback: unknown) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void> }
      /** Global AI instructions: source of truth in the universal workspace, deployed to the global Pi directory. */
      globalAgents: {
        status: () => Promise<{
          sourcePath: string
          targetPath: string
          sourceExists: boolean
          targetExists: boolean
          inSync: boolean
          content: string
          lastDeployedAt: string | null
        }>
        save: (
          content: string,
        ) => Promise<
          {
            sourcePath: string
            targetPath: string
            sourceExists: boolean
            targetExists: boolean
            inSync: boolean
            content: string
            lastDeployedAt: string | null
          } & { ok: boolean; error?: string }
        >
        deploy: () => Promise<
          {
            sourcePath: string
            targetPath: string
            sourceExists: boolean
            targetExists: boolean
            inSync: boolean
            content: string
            lastDeployedAt: string | null
          } & { ok: boolean; error?: string }
        >
      }
      paths: {
        userData: () => Promise<string>
        db: () => Promise<string>
        /** Resolved primary (Default) workspace Pi project directory; others inherit when their path is empty. */
        hostPiCwd: () => Promise<string>
        /** Resolved Pi agent directory (`sylo.pi_agent_dir`, expanded; default ~/.pi/agent). */
        piAgentDir: () => Promise<string>
        /** `userData/sylo-project` — built-in primary workspace Pi folder for new installs. */
        canonicalWorkspaceProject: () => Promise<string>
        /** True when the given absolute path exists on disk (best-effort, never throws). */
        exists: (absPath: string) => Promise<boolean>
        /** `~/.pi/agent/skills` (resolved); creates the folder if missing, then opens in the OS file manager. */
        openGlobalSkillsFolder: () => Promise<{ ok: true; path: string } | { ok: false; error: string }>
        /** `<workspace Pi project>/.pi/skills`; creates `.pi/skills` if missing, then opens in the OS file manager. */
        openProjectSkillsFolder: (
          workspaceId?: string,
        ) => Promise<{ ok: true; path: string; piCwd: string } | { ok: false; error: string }>
      }
      /** OS path for a renderer File (drag-drop / file picker); no copy is made. */
      files: {
        pathFromWebFile: (file: File) => string
        /** Renderer-safe URL for local image thumbnails (`sylo-file://` protocol). */
        localImageUrl: (absPath: string) => string
        /** Native save dialog; default folder is the active workspace Pi project directory. */
        saveCopyAs: (args: {
          sourcePath: string
          suggestedName?: string
          workspaceId?: string
        }        ) => Promise<
          { ok: true; path: string } | { ok: false; cancelled?: boolean; error?: string }
        >
        /** Read a local UTF-8 text file (truncated at the canvas cap). Used by the
         *  canvas popout to render a dropped `.md` file locally. */
        readTextFile: (
          path: string,
        ) => Promise<
          | { ok: true; content: string; truncated: boolean }
          | { ok: false; error: string }
        >
      }
      broker: {
        restart: () => Promise<boolean>
        prepareConversation: (
          conversationId: string,
        ) => Promise<{ ok: true } | { ok: false; error: string }>
        getStatus: () => Promise<{
          ready: boolean
          safeMode: boolean
          initError: string | null
          lastCapturedLogs: string | null
          resolvedModel: { provider: string; modelId: string; displayName?: string } | null
          modelInput: ('text' | 'image')[]
          visionCapable: boolean
        }>
                onStatus: (cb: (p: unknown) => void) => () => void
        onError: (cb: (p: unknown) => void) => () => void
        getSystemPromptStats: () => Promise<{
          totalChars: number
          totalTokens: number
          sections: { label: string; chars: number; tokens: number; pct: number }[]
        } | null>
        onSystemPromptStats: (cb: (p: unknown) => void) => () => void
        getActualContextTokens: () => Promise<number | null>
        onActualContextTokens: (cb: (tokens: number) => void) => () => void
      }
      chatEvents: {
                onRefresh: (
          cb: (p: {
            conversationId: string
            kind?: 'messages' | 'turnFinished' | 'turnStarted' | 'conversationRenamed' | 'conversationDeleted'
          }) => void,
        ) => () => void
        onStream: (
          cb: (p: { conversationId: string; messageId: string; delta: string }) => void,
        ) => () => void
        onTool: (
          cb: (p: { conversationId: string; messageId: string; event: unknown; ts: number }) => void,
        ) => () => void
      }
      capabilities: {
        settings: () => Promise<Record<string, unknown>>
        writeSettings: (next: Record<string, unknown>) => Promise<boolean>
        discover: (workspaceId?: string) => Promise<{
          skills: { name: string; path: string; origin: CapabilityOrigin; excludedFromAgent: boolean }[]
          extensions: { name: string; path: string; origin: CapabilityOrigin; excludedFromAgent: boolean }[]
          agentDir: string
          piCwd: string
        }>
        list: (workspaceId?: string) => Promise<CapabilitiesView>
        disabled: {
          get: () => Promise<{
            skillPaths: string[]
            extensionPaths: string[]
            disabledTools: { extensionPath: string; toolName: string }[]
          }>
          set: (next: {
            skillPaths: string[]
            extensionPaths: string[]
            disabledTools?: { extensionPath: string; toolName: string }[]
          }) => Promise<boolean>
          patch: (
            patch:
              | { kind: 'skill' | 'extension'; path: string; excluded: boolean }
              | {
                  kind: 'tool'
                  extensionPath: string
                  toolName: string
                  excluded: boolean
                },
          ) => Promise<
            | {
                ok: true
                disabled: {
                  skillPaths: string[]
                  extensionPaths: string[]
                  disabledTools: { extensionPath: string; toolName: string }[]
                }
              }
            | { ok: false; error: string }
          >
        }
        skillParamsMeta: (
          skillPath: string,
        ) => Promise<
          | { ok: true; meta: { skillPath: string; schemaPath: string; valuesPath: string } }
          | { ok: false; error: string }
        >
        skillParamsGet: (skillPath: string) => Promise<
          | {
              ok: true
              meta: { skillPath: string; schemaPath: string; valuesPath: string }
              schema: Record<string, unknown>
              values: Record<string, unknown>
            }
          | { ok: false; error: string }
        >
        skillParamsSave: (
          skillPath: string,
          values: Record<string, unknown>,
        ) => Promise<{ ok: true } | { ok: false; error: string }>
        skillMdGet: (
          skillPath: string,
          workspaceId?: string,
        ) => Promise<
          | {
              ok: true
              content: string
              skillDir: string
              skillName: string
              editable: boolean
              isCoreSyloSkill: boolean
            }
          | { ok: false; error: string }
        >
        skillMdSave: (
          skillPath: string,
          content: string,
          workspaceId?: string,
          confirmCoreSyloEdit?: boolean,
        ) => Promise<{ ok: true } | { ok: false; error: string }>
        extensionConfigMeta: (
          extensionPath: string,
        ) => Promise<
          | { ok: true; meta: { configKey: string; schemaPath: string; valuesPath: string } }
          | { ok: false; error: string }
        >
        extensionConfigGet: (configKey: string) => Promise<
          | {
              ok: true
              meta: { configKey: string; schemaPath: string; valuesPath: string }
              schema: Record<string, unknown>
              values: Record<string, unknown>
            }
          | { ok: false; error: string }
        >
        extensionConfigSave: (
          configKey: string,
          values: Record<string, unknown>,
        ) => Promise<{ ok: true } | { ok: false; error: string }>
      }
      shell: {
        openPath: (p: string) => Promise<string>
        openExternal: (url: string) => Promise<{ ok: true } | { ok: false; error: string }>
        /** Resolve a model/user path against workspace Pi cwd, home, and OneDrive roots. */
        resolveLocalPath: (
          raw: string,
          workspaceId?: string,
        ) => Promise<
          | { ok: true; path: string }
          | { ok: false; error: string; tried: string[] }
        >
        /** Reveal a resolved file or folder in the OS file manager. */
        showItemInFolder: (absPath: string) => Promise<string>
        /** Create `dir` if needed, then open in the OS file manager. */
        openDirectory: (dir: string) => Promise<{ ok: true; path: string } | { ok: false; error: string }>
        openSkillFile: (folderPath: string) => Promise<string>
        removeStandalone: (
          folderPath: string,
          workspaceId?: string,
        ) => Promise<{ ok: true } | { ok: false; error: string }>
      }
      dialog: {
        openDirectory: (opts?: { title?: string; defaultPath?: string }) => Promise<string | undefined>
        openFile: (opts?: {
          title?: string
          defaultPath?: string
          filters?: { name: string; extensions: string[] }[]
        }) => Promise<string | undefined>
      }
      git: { restore: (repoRoot: string, fileRel: string) => Promise<{ ok: boolean; err?: string }> }
      package: {
        installPath: (specPath: string, workspaceId?: string) => Promise<{ ok: boolean; detail?: string }>
        installSpec: (spec: string, workspaceId?: string) => Promise<{ ok: boolean; detail?: string }>
        updateSpec: (spec: string, workspaceId?: string) => Promise<{ ok: boolean; detail?: string }>
        uninstallSpec: (spec: string, workspaceId?: string) => Promise<{ ok: boolean; detail?: string }>
        searchPiPackages: (
          query: string,
        ) => Promise<
          | { ok: true; packages: { name: string; description: string }[] }
          | { ok: false; error: string }
        >
        piDevCatalog: (query: {
          page?: number
          name?: string
          type?: '' | 'extension' | 'skill' | 'theme' | 'prompt'
          sort?: 'downloads' | 'recent' | 'name'
        }) => Promise<
          | {
              ok: true
              packages: {
                name: string
                description: string
                installSpec: string
                types: string[]
                downloadsMonthly: number
                publishedMs: number
              }[]
              rangeStart: number
              rangeEnd: number
              total: number
              page: number
              pageSize: number
              sourceUrl: string
            }
          | { ok: false; error: string }
        >
      }
      optionalPackages: {
        installPythonDeps: (
          packageId: string,
        ) => Promise<
          | { ok: true; skipped: boolean; message: string }
          | { ok: false; error: string }
        >
        pythonReadiness: () => Promise<{
          preferredInstalled: boolean
          resolvedExe: string
          resolvedVersion: {
            major: number
            minor: number
            patch: number
            raw: string
          } | null
          status: 'ok' | 'missing-preferred' | 'unusable'
          message: string
        }>
      }
      ollama: {
        listTags: (
          baseOrigin: string,
        ) => Promise<{ ok: true; models: string[] } | { ok: false; error: string }>
        inferBaseUrl: () => Promise<string>
        probeVision: (
          baseOrigin: string,
          modelId: string,
        ) => Promise<{ ok: true; vision: boolean } | { ok: false; error: string }>
        patchBaseUrl: (
          baseOrigin: string,
          ensureModelId?: string,
          visionCapable?: boolean,
        ) => Promise<{ ok: true } | { ok: false; error: string }>
      }
            models: {
        getInputConfig: (
          provider: string,
          modelId: string,
        ) => Promise<
          | { ok: true; input: ('text' | 'image')[]; explicit: boolean; visionCapable: boolean }
          | { ok: false; error: string }
        >
        setVision: (
          provider: string,
          modelId: string,
          visionCapable: boolean,
        ) => Promise<{ ok: true } | { ok: false; error: string }>
      }
      /** Provider API keys — stored in Pi's `~/.pi/agent/auth.json` (masked reads). */
      piAuth: {
        get: (
          provider: string,
        ) => Promise<{ ok: true; hasKey: boolean; keyPreview: string | null } | { ok: false; error: string }>
        /** key: '' removes the entry; null/missing key keeps it. */
        set: (provider: string, key: string) => Promise<{ ok: true } | { ok: false; error: string }>
      }
      /** OpenRouter (free-tier) model list from the public endpoint. */
      openrouter: {
        listModels: () => Promise<
          | {
              ok: true
              models: { id: string; name: string; contextLength: number | null }[]
              source: 'live' | 'fallback'
            }
          | { ok: false; error: string }
        >
      }
      skills: {
        saveFromChat: (
          name: string,
          description: string,
          body: string,
        ) => Promise<{ path: string }>
      }
      safeMode: { clear: () => Promise<boolean> }
      companion: {
        getStatus: () => Promise<{
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
        }>
        openCertsFolder: () => Promise<boolean>
        setConfig: (patch: {
          enabled?: boolean
          bind?: 'loopback' | 'lan'
          port?: number
        }) => Promise<
          | {
              enabled: boolean
              running: boolean
              port: number
              bind: 'loopback' | 'lan'
              username: string
              hasCredentials: boolean
              staticBuilt: boolean
                            urls: { loopback: string; lan: string[]; fqdn: string | null }
            }
          | { ok: false; error: string }
        >
        setCredentials: (payload: {
          username: string
          password: string
        }) => Promise<
          | {
              enabled: boolean
              running: boolean
              port: number
              bind: 'loopback' | 'lan'
              username: string
              hasCredentials: boolean
              staticBuilt: boolean
                            urls: { loopback: string; lan: string[]; fqdn: string | null }
            }
          | { ok: false; error: string }
        >
      }
      canvas: {
        /** Renderer → main: report the docked canvas' open state so the native
         *  Window-menu item label stays in sync. */
        reportOpenState: (open: boolean) => Promise<true>
        /** Main → renderer: the operator clicked "Show/Hide Canvas" in the
         *  native Window menu. */
        onToggleRequest: (cb: () => void) => () => void
                onShow: (
          cb: (p: {
            toolCallId: string
            kind: 'svg' | 'mermaid' | 'markdown'
            title?: string
            content?: string
            filePath?: string
            sourcePath?: string
            workspaceKey?: string
          }) => void,
        ) => () => void
        openPopoutWindow: (payload: {
          kind: 'svg' | 'mermaid' | 'markdown'
          title?: string
          content?: string
          filePath?: string
          sourcePath?: string
          toolCallId?: string
        }) => Promise<{ ok: true; id: string } | { ok: false; error: string }>
        openLivePopoutWindow: (
          payload: { liveId: string; title?: string },
        ) => Promise<{ ok: true; id: string } | { ok: false; error: string }>
        getPopout: (popoutId: string) => Promise<{
          kind: 'svg' | 'mermaid' | 'markdown'
          title?: string
          content?: string
          filePath?: string
          sourcePath?: string
          toolCallId?: string
        } | null>
        showFile: (payload: {
          kind: 'svg' | 'markdown'
          filePath: string
          title?: string
        }) => Promise<{ ok: true } | { ok: false; error: string }>
        // ── Live (subscribed) canvas — sibling to the snapshot surface above ──
                onLiveShow: (
          cb: (p: {
            liveId: string
            kind: 'live-demo' | 'task-board'
            title?: string
            data?: unknown
            workspaceKey?: string
          }) => void,
        ) => () => void
        onLiveUpdate: (cb: (p: { liveId: string; data: unknown }) => void) => () => void
        onLiveClear: (cb: (p: { liveId: string }) => void) => () => void
        liveSubscribe: (liveId: string) => Promise<boolean>
        liveUnsubscribe: (liveId: string) => Promise<void>
        getLivePopout: (
          liveId: string,
        ) => Promise<
          | { liveId: string; kind: 'live-demo' | 'task-board'; title?: string; data?: unknown }
          | null
        >
        stopLiveDemo: (
          liveId: string,
        ) => Promise<{ ok: true } | { ok: false; error: string }>
                taskApplyEdit: (payload: {
          liveId: string
          taskId: string
          status?: string
          notes?: string | null
        }) => Promise<{ ok: true } | { ok: false; error: string }>
        getActiveBoardForWorkspace: (
          workspaceKey: string,
        ) => Promise<
          | { liveId: string; kind: 'live-demo' | 'task-board'; title?: string; data?: unknown }
          | null
        >
      }
      skillSurface: {
        onShow: (
          cb: (p: { toolCallId: string; html?: string; path?: string; data: unknown }) => void,
        ) => () => void
        injectFollowUp: (text: string) => Promise<{ ok: true } | { ok: false; error: string }>
        logicforgeParseRulesGet: () => Promise<{
          ok: true
          parse_config_path: string
          settings_path: string
          parse_config: unknown
          settings: unknown
        }>
        logicforgeParseRulesSave: (payload: {
          parse_config?: unknown
          settings?: unknown
        }) => Promise<{ ok: true; parse_config_path: string; settings_path: string }>
        logicforgeParseRulesReset: () => Promise<{
          ok: true
          parse_config_path: string
          settings_path: string
          parse_config: unknown
          settings: unknown
        }>
        logicforgeIoReviewGet: (payload: { run_dir: string }) => Promise<{
          ok: true
          run_dir: string
          path: string
          review: unknown
        }>
        logicforgeIoReviewReseed: (payload: { run_dir: string; overwrite?: boolean }) => Promise<{
          ok: true
          run_dir: string
          path: string
          review: unknown
        }>
        logicforgeIoReviewSave: (payload: { run_dir: string; review?: unknown }) => Promise<{
          ok: true
          run_dir: string
          path: string
          review: unknown
        }>
                logicforgeIoReviewApproveBuild: (payload: { run_dir: string; review?: unknown }) => Promise<{
          ok: true
          run_dir: string
          review_path: string
          scaffold: unknown
        }>
        logicforgeDownloadAllowlistGet: () => Promise<{
          ok: true
          path: string
          allowlist: unknown
        }>
        logicforgeDownloadAllowlistSave: (payload: {
          allow_downloads?: boolean
          post_download_mode?: 'program' | 'run'
          ips?: Array<{ ip: string; label?: string; enabled?: boolean }>
          notes?: string
        }) => Promise<{ ok: true; path: string }>
        logicforgeDownloadPlcStatus: (ip: string) => Promise<{
          ok: true
          reachable: boolean
          ip: string
          error?: string | null
          keyswitch?: string | null
          mode?: string | null
          key_position?: string | null
          product_name?: string | null
          vendor?: string | null
                    in_allowlist?: boolean
        }>
        logicforgeTemplates: (op: string, payload?: Record<string, unknown>) => Promise<{
          ok: true
          [key: string]: unknown
        }>
        syloWorkflowsList: (payload?: {
          project_dir?: string
          agent_dir?: string
        }) => Promise<{
          ok: true
          workflows: {
            id: string
            title: string
            description: string
            source: string
            path: string
            filename: string
            editable: boolean
          }[]
          library: { operator_dir: string; bundled_dir: string; legacy_dir: string }
        }>
        syloWorkflowRead: (payload: {
          project_dir: string
          id: string
          agent_dir?: string
        }) => Promise<{
          ok: true
          id: string
          title: string
          description: string
          source: string
          path: string
          editable: boolean
          body: string
          raw: string
        }>
        syloWorkflowSave: (payload: {
          content: string
          previous_id?: string
          agent_dir?: string
        }) => Promise<{
          ok: true
          workflow: {
            id: string
            title: string
            description: string
            source: string
            path: string
            filename: string
            editable: boolean
          }
        }>
        syloWorkflowDelete: (payload: {
          id: string
          agent_dir?: string
        }) => Promise<{
          ok: true
          deleted: {
            id: string
            title: string
            description: string
            source: string
            path: string
            filename: string
            editable: boolean
          }
        }>
        fieldbrainConfigGet: () => Promise<{
          ok: true
          config: Record<string, unknown>
          databaseConfigPath: string
          guidedSetup: string[]
        }>
        fieldbrainConfigSave: (payload: Record<string, unknown>) => Promise<
          | { ok: true; config: Record<string, unknown>; databaseConfigPath: string }
          | { ok: false; error: string }
        >
        fieldbrainDbCheck: () => Promise<Record<string, unknown>>
        fieldbrainDbMigrate: () => Promise<Record<string, unknown>>
        fieldbrainLogList: () => Promise<Record<string, unknown>>
        fieldbrainDocumentList: (payload?: Record<string, unknown>) => Promise<Record<string, unknown>>
        fieldbrainBrainList: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
        fieldbrainProjectList: () => Promise<Record<string, unknown>>
        fieldbrainProjectCreate: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
        fieldbrainDbBootstrap: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
        fieldbrainPgvectorGuide: () => Promise<Record<string, unknown>>
        fieldbrainPgvectorInstallFromFolder: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
        fieldbrainPgvectorEnable: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
        onenoteAuthStatus: () => Promise<Record<string, unknown>>
        onenoteAuthStart: () => Promise<Record<string, unknown>>
        onenoteAuthComplete: () => Promise<Record<string, unknown>>
        onenoteAuthLogout: () => Promise<Record<string, unknown>>
        onenoteSettingsGet: () => Promise<Record<string, unknown>>
        onenoteSettingsSave: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
        onenoteNotebookList: () => Promise<Record<string, unknown>>
        onenoteIndexSync: () => Promise<Record<string, unknown>>
        onenoteIndexProgress: () => Promise<Record<string, unknown>>
        onenoteImportLegacyCache: () => Promise<Record<string, unknown>>
      }
      skillSurfaces: {
        lintBatch: (paths: string[]) => Promise<Record<string, SkillSurfaceLintReport>>
      }
      skillRoutes: {
        list: (workspaceId?: string) => Promise<
          {
            skillName: string
            skillFolderName: string
            skillDir: string
            routeId: string
            title: string
            entry: string
            fallback: string
            fixturePath: string
            nav_section: 'domain' | 'tools' | 'library' | 'dev'
          }[]
        >
        openPopoutWindow: (routeKey: string) => Promise<{ ok: true } | { ok: false; error: string }>
      }
      skillData: {
        read: (
          skillKey: string,
          key: string,
        ) => Promise<{ ok: true; value: unknown | undefined } | { ok: false; error: string }>
        write: (
          skillKey: string,
          key: string,
          value: unknown,
        ) => Promise<{ ok: true } | { ok: false; error: string }>
      }
      webAccess: {
        listRuns: (limit?: number) => Promise<
          import('../../shared/web-access-types.js').WebAccessRunRow[]
        >
        stats: () => Promise<import('../../shared/web-access-types.js').WebAccessStats>
        configGet: () => Promise<Record<string, unknown>>
                configSave: (
          values: Record<string, unknown>,
        ) => Promise<{ ok: true; restartNote?: string } | { ok: false; error: string }>
        braveQuota: () => Promise<Record<string, unknown> | null>
        onLifecycle: (cb: (payload: unknown) => void) => () => void
      }
      personal: {
        ops: () => Promise<string[]>
        rpc: (op: string, payload?: unknown) => Promise<unknown>
        settingsCard: () => Promise<unknown>
      }
      userPackages: {
        list: () => Promise<
          Array<{
            spec: string
            name: string
            version: string | null
            description: string | null
            resolvedPath: string | null
            exists: boolean
          }>
        >
      }
      tasksDb: {
        snapshotGet: (workspaceCwd: string) => Promise<
          | { ok: true; result: import('../../../../../packages/sylo-tasks/shared/types.js').TasksWorkspaceSnapshot | null }
          | { ok: false; error: string }
        >
        listGet: (args: { workspaceCwd: string; listId: string }) => Promise<
          | { ok: true; result: import('../../../../../packages/sylo-tasks/shared/types.js').TaskListSnapshot | null }
          | { ok: false; error: string }
        >
        listCreate: (args: {
          workspaceCwd: string
          title: string
          mode?: string
          description?: string
        }) => Promise<
          | { ok: true; result: import('../../../../../packages/sylo-tasks/shared/types.js').TaskList }
          | { ok: false; error: string }
        >
        listDelete: (args: { workspaceCwd: string; listId: string }) => Promise<
          | { ok: true; result: boolean }
          | { ok: false; error: string }
        >
        taskAdd: (args: {
          workspaceCwd: string
          list_id: string
          title: string
          status?: string
          notes?: string
          due?: string
          blocked_by?: string[]
        }) => Promise<
          | { ok: true; result: import('../../../../../packages/sylo-tasks/shared/types.js').Task }
          | { ok: false; error: string }
        >
        taskUpdate: (args: {
          workspaceCwd: string
          id: string
          title?: string
          status?: string
          notes?: string | null
          due?: string | null
          blocked_by?: string[]
        }) => Promise<
          | { ok: true; result: import('../../../../../packages/sylo-tasks/shared/types.js').Task | null }
          | { ok: false; error: string }
        >
        taskDelete: (args: { workspaceCwd: string; taskId: string }) => Promise<
          | { ok: true; result: boolean }
          | { ok: false; error: string }
        >
      }
      logicforge: {
        parseRulesGet: () => Promise<{
          ok: true
          parse_config_path: string
          settings_path: string
          parse_config: unknown
          settings: unknown
        }>
        parseRulesSave: (payload: {
          parse_config?: unknown
          settings?: unknown
        }) => Promise<{ ok: true; parse_config_path: string; settings_path: string }>
        parseRulesReset: () => Promise<{
          ok: true
          parse_config_path: string
          settings_path: string
          parse_config: unknown
          settings: unknown
        }>
        ioReviewGet: (payload: { run_dir: string }) => Promise<{
          ok: true
          run_dir: string
          path: string
          review: unknown
        }>
        ioReviewReseed: (payload: { run_dir: string; overwrite?: boolean }) => Promise<{
          ok: true
          run_dir: string
          path: string
          review: unknown
        }>
        ioReviewSave: (payload: { run_dir: string; review?: unknown }) => Promise<{
          ok: true
          run_dir: string
          path: string
          review: unknown
        }>
                ioReviewApproveBuild: (payload: { run_dir: string; review?: unknown }) => Promise<{
          ok: true
          run_dir: string
          review_path: string
          scaffold: unknown
        }>
        downloadAllowlistGet: () => Promise<{ ok: true; path: string; allowlist: unknown }>
        downloadAllowlistSave: (payload: {
          allow_downloads?: boolean
          post_download_mode?: 'program' | 'run'
          ips?: Array<{ ip: string; label?: string; enabled?: boolean }>
          notes?: string
        }) => Promise<{ ok: true; path: string }>
        downloadPlcStatus: (ip: string) => Promise<{
          ok: true
          reachable: boolean
          ip: string
          error?: string | null
          keyswitch?: string | null
          mode?: string | null
          key_position?: string | null
          product_name?: string | null
          vendor?: string | null
                    in_allowlist?: boolean
        }>
        templates: (op: string, payload?: Record<string, unknown>) => Promise<{
          ok: true
          [key: string]: unknown
        }>
      }
      fieldbrain: {
        configGet: () => Promise<{
          ok: true
          config: Record<string, unknown>
          databaseConfigPath: string
          guidedSetup: string[]
        }>
        configSave: (payload: Record<string, unknown>) => Promise<
          | { ok: true; config: Record<string, unknown>; databaseConfigPath: string }
          | { ok: false; error: string }
        >
        dbCheck: () => Promise<Record<string, unknown>>
        dbMigrate: () => Promise<Record<string, unknown>>
        logList: () => Promise<Record<string, unknown>>
        documentList: (payload?: Record<string, unknown>) => Promise<Record<string, unknown>>
        brainList: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
        projectList: () => Promise<Record<string, unknown>>
        projectCreate: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
        dbBootstrap: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
        pgvectorGuide: () => Promise<Record<string, unknown>>
        pgvectorInstallFromFolder: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
        pgvectorEnable: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
      }
      onenote: {
        authStatus: () => Promise<Record<string, unknown>>
        authStart: () => Promise<Record<string, unknown>>
        authComplete: () => Promise<Record<string, unknown>>
        authLogout: () => Promise<Record<string, unknown>>
        settingsGet: () => Promise<Record<string, unknown>>
        settingsSave: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
        notebookList: () => Promise<Record<string, unknown>>
        indexSync: () => Promise<Record<string, unknown>>
        indexProgress: () => Promise<Record<string, unknown>>
        importLegacyCache: () => Promise<Record<string, unknown>>
      }
      tts: {
        listVoices: () => Promise<Array<{ id: string; label: string; backend: string }>>
        configGet: () => Promise<Record<string, unknown>>
        configSave: (
          values: Record<string, unknown>,
        ) => Promise<{ ok: true; restartNote?: string } | { ok: false; error: string }>
        generate: (args: {
          text: string
          voice_id?: string
          kokoro_speed?: number
          orpheus_temperature?: number
          orpheus_top_p?: number
        }) => Promise<
          | {
              ok: true
              wavPath: string
              durationMs: number
              voiceId: string
              voiceLabel: string
            }
          | { ok: false; error: string }
        >
        deleteRouteClip: (wavPath: string) => Promise<{ ok: true } | { ok: false; error: string }>
      }
      evals: {
        loadDashboard: () => Promise<
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
        >
        runBaseline: (note?: string, since?: string) => Promise<
          | { ok: true; runId: string | null; output: string }
          | { ok: false; error: string; detail?: string }
        >
      }
      tasks: {
        list: (conversationId: string) => Promise<
          {
            id: string
            host_session_id: string
            conversation_id: string
            parent_task_id: string | null
            group_run_id: string | null
            depth: number
            title: string
            spec_json: string
            status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'orphaned'
            status_reason: string | null
            mode: 'single' | 'parallel' | 'chain'
            agent_name: string
            step_index: number | null
            started_at: number | null
            ended_at: number | null
            result_summary: string | null
            result_json: string | null
            tokens_used: number | null
            created_at: number
            updated_at: number
          }[]
        >
        get: (taskId: string) => Promise<
          | {
              id: string
              host_session_id: string
              conversation_id: string
              parent_task_id: string | null
              group_run_id: string | null
              depth: number
              title: string
              spec_json: string
              status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'orphaned'
              status_reason: string | null
              mode: 'single' | 'parallel' | 'chain'
              agent_name: string
              step_index: number | null
              started_at: number | null
              ended_at: number | null
              result_summary: string | null
              result_json: string | null
              tokens_used: number | null
              created_at: number
              updated_at: number
            }
          | null
        >
        cancel: (taskId: string) => Promise<
          | { ok: true; killed: boolean }
          | { ok: false; error: 'bad_id' | 'not_found' | 'not_running' }
        >
        retry: (taskId: string) => Promise<
          | {
              ok: true
              agent: string
              mode: 'single' | 'parallel' | 'chain'
              task: string
              groupRunId: string | null
              stepIndex?: number
            }
          | { ok: false; error: 'not_found' | 'bad_spec' }
        >
        orphanedCount: () => Promise<number>
        clearOrphaned: () => Promise<{ ok: true; deleted: number }>
        diagnostics: () => Promise<{
          runningCount: number
          orphanedCount: number
          extensionEnabled: boolean
        }>
        onLifecycle: (cb: (payload: unknown) => void) => () => void
      }
      thinkTank: {
        sessionGet: (sessionId: string) => Promise<Record<string, unknown> | null>
        listForConversation: (conversationId: string) => Promise<Array<Record<string, unknown>>>
        configGet: () => Promise<Record<string, unknown>>
        configSave: (
          values: Record<string, unknown>,
        ) => Promise<{ ok: true } | { ok: false; error: string }>
        pickReport: (
          sessionId: string,
          reportId: string,
        ) => Promise<{ ok: true; selectedReportId: string } | { ok: false; error: string }>
        inject: (
          sessionId: string,
          text: string,
        ) => Promise<{ ok: true; pendingCount: number } | { ok: false; error: string }>
        abort: (sessionId: string) => Promise<{ ok: true } | { ok: false; error: string }>
        onLifecycle: (cb: (payload: unknown) => void) => () => void
      }
      schedules: {
        list: (workspaceId: string) => Promise<
          Array<{
            id: string
            workspace_id: string
            title: string
            prompt_text: string
            recurrence: 'once' | 'daily' | 'weekly' | 'monthly'
            start_at: number
            time_local: string
            day_of_week: number | null
            day_of_month: number | null
            max_runs: number | null
            run_count: number
            catchup_on_startup: number
            enabled: number
            next_run_at: number
            last_run_at: number | null
            last_conversation_id: string | null
            last_run_status: string | null
            created_at: number
            updated_at: number
          }>
        >
        get: (id: string) => Promise<Record<string, unknown> | null>
        create: (workspaceId: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>
        update: (id: string, patch: Record<string, unknown>) => Promise<Record<string, unknown> | null>
        delete: (id: string) => Promise<{ ok: boolean }>
        fireNow: (
          id: string,
        ) => Promise<{ ok: true; conversationId: string } | { ok: false; error: string }>
        onChanged: (cb: (payload: { workspaceId: string }) => void) => () => void
      }
    }
  }
}
