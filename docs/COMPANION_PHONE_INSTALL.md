# Install Sylo Companion on your phone

Use this guide when you want Sylo chat on your phone while **Pi, broker, and SQLite stay on the desktop**.

Each Sylo install creates its **own** HTTPS certificate authority (CA) the first time you enable the companion server. Your phone must trust that CA once; after that, Chrome can offer **Install app** (Android) or Safari can add a home-screen shortcut (iOS).

**Tailscale shortcut (no CA install):** if your PC is on a Tailscale tailnet and the **HTTPS certificates** feature is enabled in your Tailscale admin console, Sylo automatically provisions a Let's Encrypt certificate for your node's MagicDNS name the first time you enable the companion with **Network bind** set to Tailscale. The phone URL becomes `https://<your-node>.<your-tailnet>.ts.net:9241` — a publicly-trusted cert, so the phone needs **no root-CA install** and you can skip Part 2 entirely. (If HTTPS certificates isn't enabled on the tailnet, Sylo silently falls back to the self-signed CA path in Part 2.)

---

## Part 1 — Desktop (one-time setup)

1. Start Sylo on your PC.
2. Open **Developer → Settings → Companion**.
3. Set **Username** and **Password** → **Save login**.
4. Check **Enable companion server**.
5. Set **Network bind** to **Phone on same Wi‑Fi / Tailscale**.
6. Note the **URL (LAN)** (default **`https://<your-ip>:9241`**) or click **Copy phone URL**.
7. If the phone cannot connect, allow **Node.js** through Windows Firewall on port **9241**.

Enabling companion **automatically** creates TLS material under your Sylo user data folder. You do not run mkcert unless you are a developer using the optional override below.

---

## Part 2 — Phone (Android: Install app)

### Step 1 — Open the companion URL

On your phone, open the **HTTPS** URL from Settings (example: `https://100.101.102.103:9241`).

The first time, the browser may warn that the connection is not private. That is expected — you have not installed this Sylo install’s CA yet. Continue / proceed so you can reach the login page.

### Step 2 — Download the root certificate

On the login page, tap **Download root certificate**.

Or open this path on the same host (same port):

```text
https://<your-ip>:9241/api/companion/root-ca.pem
```

The file is named `sylo-companion-ca.pem`.

### Step 3 — Install the CA on Android

1. Open **Settings → Security → Encryption & credentials** (wording varies by device).
2. Tap **Install a certificate → CA certificate**.
3. Select the downloaded `sylo-companion-ca.pem`.
4. Confirm the warning about user-installed CAs.

### Step 4 — Reload the companion site

Close the browser tab completely. Open the **same HTTPS URL** again.

You should see a **padlock** (no “connection is not secure” bar).

### Step 5 — Log in

Use the username and password from desktop Settings → Companion.

### Step 6 — Install the app

- Tap **Install app** in the banner inside the companion UI, **or**
- Chrome **⋮ → Install app** / **Add to Home screen**.

Launch from your home screen — it opens standalone (no browser URL bar).

---

## Part 3 — Phone (iPhone / iPad)

1. Follow **Steps 1–3** above (download the root CA from the companion site).
2. Install the profile when iOS prompts you.
3. Go to **Settings → General → About → Certificate Trust Settings** and **enable** trust for the Sylo CA.
4. Reload the companion HTTPS URL (padlock).
5. Log in.
6. Safari **Share → Add to Home Screen**.

iOS does not show Chrome’s “Install app” label; Add to Home Screen is the equivalent.

---

## Troubleshooting

| Symptom | Fix |
|--------|-----|
| `ERR_SSL_PROTOCOL_ERROR` | Use **`https://`** and port **9241**, not 9242. |
| “Connection is not secure” after CA install | Wrong or old CA on the phone. Remove old user CAs under **Trusted credentials → User**, download a fresh CA from **this** Sylo install, reinstall. |
| No **Install app** in Chrome | CA not trusted yet, or page not in a secure context. Reload after CA install; check padlock. |
| Page never loads | Firewall blocking **9241**; companion disabled; wrong IP; not on same Wi‑Fi / Tailscale. |
| IP changed | Copy the new **URL (LAN)** from desktop Settings. If HTTPS breaks, restart Sylo so the cert SAN list can refresh. |

---

## Restart Sylo from the phone (with auto-revert safety net)

The companion **System** tab has a **Restart Sylo** button. It publishes `restart` to the ntfy control topic `sylo-&lt;node&gt;-control`; a standalone watchdog service (`sylo-supervisor`, independent of Sylo) picks it up, kills the desktop Sylo, relaunches it, and watches for it to come back. If Sylo doesn’t return within 5 minutes, the watchdog **auto-reverts your recent code changes** (snapshotted to a git stash — nothing is lost) and sends an ntfy notification with the error so the agent can fix it.

**One-time setup (on Thor):**
1. Enable Windows auto-login for your account (the watchdog relaunches the Sylo GUI into your interactive session; also recovers after a power outage).
2. In an **elevated PowerShell**, run:
   ```powershell
   %USERPROFILE%\Documents\GitHub\sylo-dev\apps\host\scripts\install-sylo-supervisor.ps1
   ```
   This creates the `StartSylo` Scheduled Task + the `sylo-supervisor` Windows service (auto-start, restart-on-failure).
3. Restart Sylo once via `full-build-run-sylo.cmd` so the new companion code (System tab + `/api/restart`) loads.

**When Sylo is hung or dead** (companion unreachable), the button isn’t available — instead open the **ntfy app** and publish `restart` to topic `sylo-&lt;node&gt;-control`. The watchdog handles it the same way (this is the dead-Sylo escape hatch). You’ll get the result as an ntfy notification on `sylo-notify`.

Recover reverted edits with `git -C "<repo-root>" stash apply <ref>` (the ref is in the notification).

---

## Optional — Developer mkcert override

If `apps/host/certs/sylo-companion.crt` and `.key` (or legacy `sylo-tailscale.*`) exist, Sylo uses those **mkcert** files instead of the auto CA. Developers can run:

```powershell
.\scripts\dev\companion-mkcert.ps1
```

Then copy `apps/host/certs/rootCA.pem` to the phone, or use `scripts/dev/serve-companion-rootca.bat` for HTTP download on port 8765.

Normal operators should **not** need this — use the on-site **Download root certificate** button.

---

## Security notes

- The companion password protects your desktop Sylo from other devices on the LAN.
- Prefer **Tailscale** over exposing a port on your home router.
- Leave companion **off** on untrusted networks.
- Each Sylo installation has its **own** CA. Do not reuse a root certificate from another machine or an old Sylo v1 install unless you know it matches the server cert Sylo is using.

See also [GETTING_STARTED.md](GETTING_STARTED.md) §2.5.
