# Sylo

**Sylo** is a local-first desktop app that hosts **[Pi](https://pi.dev/)** — chat, workspaces, and a capability manager for skills, extensions, and packages. Pi runs the agent; Sylo runs the shell (Electron + SQLite).

## Get started

1. Install **[Node](https://nodejs.org/)** (24+) and **[Python 3.12 (python.org build)](https://www.python.org/downloads/windows/)** (for optional packages that use pip; Sylo prefers 3.12 — avoid the Microsoft Store Python build), **[Pi CLI](https://pi.dev/)** (optional — Sylo bundles the agent runtime itself; the CLI is for provider sign-in and `pi install`), and a model provider Pi can use (e.g. [Ollama](https://ollama.com/)).
2. From this repo:

```bash
npm install
npm start
```

On Windows you can double-click **`full-build-run-sylo.cmd`** instead (runs `bootstrap-pi` and skill-surface sync automatically before launch).

3. Open **Settings** and **Capability manager** to attach skills and install Pi packages.

**Full walkthrough** (UI map, skill sidebar UIs, attach flows, publishing Pi packages): **[docs/GETTING_STARTED.md](docs/GETTING_STARTED.md)**

From a dev repo, `npm start` and **`full-build-run-sylo.cmd`** both run **`bootstrap-pi`** and **`sync-skill-surfaces`** via `prepare:dev`. Run those manually only if you changed skills without restarting Sylo.

## Add Pi packages

Install community skills and extensions the same way you would for Pi:

- In Sylo: **Capability manager** → catalog or **Downloaded packages** → install.
- On the CLI: `pi install npm:package-name` or `pi install git:…` (see [Pi packages](https://pi.dev/docs/latest/packages)).

Sylo does not ship a fixed “recommended” package list — you choose what to install.

## Build your own

You can author **skills** (agent instructions + optional sidebar UI) and **extensions** (TypeScript tools for Pi) without forking Sylo:

- Scaffold in-app: **+ New skill** / extension authoring skills (`sylo-skill-author`, `sylo-extension-author`).
- Or follow **[docs/GETTING_STARTED.md](docs/GETTING_STARTED.md)** to build in any folder, then attach the folder or publish with `pi install`.

Optional **phone companion** (LAN HTTPS): **[docs/COMPANION_PHONE_INSTALL.md](docs/COMPANION_PHONE_INSTALL.md)**

## License

MIT — see [LICENSE](LICENSE).
