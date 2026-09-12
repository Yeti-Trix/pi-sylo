# sylo-terminal-bridge

`terminal_read` — agent-side read access to the Sylo desktop terminal panes (pi-sylo issue #7).

The host mirrors every live terminal pane (cwd + scrollback tail) to a JSON file and passes its path to the broker as `SYLO_TERMINAL_BRIDGE_FILE`. This package registers a `terminal_read` tool that reads it: list live panes by omitting `session`, or pass a tab id / title substring plus `chars` to read a scrollback tail.

Inert outside the Sylo desktop app (the env var is only set by the Sylo host). Enable in **Capability manager → Sylo built-in packages → Terminal bridge**.