# Hyper-V Guest Configurator

Automated deployment toolkit for Hyper-V virtual machines. Configures WSL2,
Docker Desktop, Ollama (AI engine), custom software, and more on Windows
guest VMs — from a single script run on the Hyper-V host.

Two tools are included:

| Tool | Interface | Best for |
|------|-----------|----------|
| `hyperv-configurator.ps1` | Interactive CLI (arrow-key menus) | Automation, scripting, advanced users |
| `hyperv-web-configurator.ps1` | Browser GUI at `http://127.0.0.1:3000` | Visual configuration, beginners |

---

## Requirements

**Host machine** (running Hyper-V):
- Windows 10 Pro/Enterprise, Windows 11, or Windows Server 2016+
- Hyper-V enabled and at least one VM created
- PowerShell 5.1+ (pre-installed on Windows 10+)
- Administrator rights

**Guest VM**:
- Windows 10/11 or Windows Server 2019/2022
- PowerShell remoting enabled (on by default)
- Connected to an **Internal** or **Default** Hyper-V switch (not Private)

**Optional** (ELO downloads only):
- Node.js — installed automatically via winget if missing
- Account on `partner.elo.com`

---

## Quick Start

### Web Configurator (recommended)

```powershell
# Run as Administrator
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
cd C:\ollama-ssl\installator
.\hyperv-web-configurator.ps1
# Browser opens at http://127.0.0.1:3000
```

### CLI Configurator

```powershell
# Run as Administrator
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
cd C:\ollama-ssl\installator
.\hyperv-configurator.ps1
```

---

## Feature Modes

Both tools support the same feature set, selected at startup:

| Mode | What gets configured |
|------|----------------------|
| Full WSL2 + AI Stack | Nested virtualization → WSL2 kernel → Docker Desktop → Ollama + Caddy via Docker Compose |
| Software Packages | Copy local installers, run winget packages, download URLs |
| WSL Preparation | Enables WSL features only (no WSL install) — prepares for manual WSL install |
| WSL Prep + Software | Combination of the above two |
| Full Stack + Software | Everything |

---

## Configuration Files

### `downloads.txt`

URLs downloaded directly inside the VM (the VM fetches from the internet).
Supports ELO CDN links with expiring tokens.

```
# Format: Display Name | URL
ELO Server Setup | https://cdn2.elo.com/Serversetup_Windows/.../file.zip?token=...&expire=...
# Bare URLs also work:
https://example.com/tool.zip
```

### `ollama-models.json`

Models shown in the Ollama model selector.

```json
[
  { "tag": "llama3.1:8b",      "desc": "Meta LLaMA 3.1 8B — balanced quality" },
  { "tag": "deepseek-r1:1.5b", "desc": "DeepSeek R1 1.5B — fast, lightweight" }
]
```

Find model tags at [ollama.com/library](https://ollama.com/library).

### `softwares\`

Drop installer files in named subfolders. They appear automatically in both tools.

```
softwares\
  ELO\
    serversetup2-25.00.zip
    ELO_Java_Client_Windows_25.zip
  Apps\
    Firefox Installer.exe
    7z2409-x64.exe
```

---

## File Transfer Methods

When copying local files from the host to the VM, two methods are available.
Both tools default to **HTTP Download** and fall back automatically.

### HTTP Download *(default — recommended)*

The host starts a temporary `HttpListener` server on a random port (52000–53000).
The VM downloads files directly via the Hyper-V virtual switch.

- **Speed**: ~500 MB/s to 1 GB/s (memory-mapped virtual network)
- **Requires**: Internal or Default switch (not Private)
- **Firewall**: A temporary inbound rule (`HVCopy-<port>` / `HVWebCopy-<port>`) is added and removed automatically
- **Browser**: The VM's default browser opens automatically with a directory listing of `softwares\` so you can verify files before and after the copy
- **Fallback**: If the host IP cannot be detected (Private switch), PSSession Copy is used instead

To browse shared files manually during the copy step, open the URL printed in the log:
```
http://192.168.xxx.xxx:52xxx/
```

### PSSession Copy *(fallback)*

Files are serialized in 8 MB chunks over PowerShell remoting.

- **Speed**: ~50–100 MB/s
- **Always available** — no switch or firewall requirements
- Selected automatically when HTTP is unavailable, or manually in the web UI

---

## ELO Token Refresh

ELO CDN download URLs include a `token=...&expire=...` parameter that expires
after a few hours. When tokens expire, downloads fail with a `WebException`.

### Web UI

1. Go to **Downloads** panel
2. Click **↻ Refresh Tokens**
3. A Chromium browser opens — log in at `partner.elo.com`
4. Navigate to Software Downloads and click each download link
5. Click **✓ Done** in the web UI

### CLI

The script detects expiry automatically:

```
[!] Expired tokens detected for: serversetup2-25.00.zip
Launching token refresher...
Log in at partner.elo.com, click each download, then press ENTER in this window.
```

Alternatively run manually:

```powershell
node refresh-elo-tokens.js
```

---

## Checkpoint / Resume

Both tools save progress to `C:\ollama-ssl\deploy-state.json` after each step.
On restart after interruption:

- **CLI**: Detects the saved state and asks whether to resume or start over.
- **Web**: Shows completed steps as ✅. Click **↺ Reset** to clear state.

Progress saved includes: VM name, selected features, models, local files, URLs,
winget packages, install mode, transfer method, and completed steps.

---

## WSL2 + AI Stack — What Gets Deployed

```
HOST ──────────────────────────────────────────────────────
  .\hyperv-configurator.ps1  or  web UI
  Drives all steps via PSSession / HTTP to the VM

GUEST VM ──────────────────────────────────────────────────
  Step 1  Enable Nested Virtualization (Set-VMProcessor)
  Step 2  Enable WSL Windows Features (VirtualMachinePlatform + WSL)
  Step 3  Install WSL2 kernel MSI + set default version
  Step 4  Install Docker Desktop via Chocolatey
  Step 5  Start Docker Desktop (manual step — accept ToS)
  Step 6  Deploy Ollama + Caddy via Docker Compose

  C:\ollama-ssl\docker-compose.yml  →  ollama:11434, caddy:443
  C:\ollama-ssl\Caddyfile           →  HTTPS reverse proxy to Ollama
  SSL certificate                   →  Caddy local CA, trusted on VM
```

---

## Web Configurator — Architecture

```
hyperv-web-configurator.ps1    Launcher — checks Node.js, installs deps,
                                starts server, opens browser
        │
        ▼
web/server.js                  Express + WebSocket server (port 3000, localhost)
        │                      REST: /api/vms /api/state /api/downloads etc.
        │                      WS:   streams PowerShell output live
        ▼
web/public/index.html          Single-page app — sidebar config steps,
                                execution panel with per-step progress bars,
                                light/dark theme (ELO brand colors)
```

The server spawns PowerShell processes and streams output to the browser
via WebSocket. Each "Run" button generates and executes a PS script for
that step — no PS scripts are stored on disk, they are generated at runtime.

---

## Manual Steps (Help Panel)

The web UI **Help** section contains copy-paste PowerShell commands for running
each step manually inside the VM if automation is unavailable:

- **Enable Guest Services** — run on HOST
- **Enable Nested Virtualization** — run on HOST (VM must be off)
- **Enable WSL Features** — run INSIDE VM (needs reboot after)
- **Install WSL2 Kernel** — run INSIDE VM (after WSL features + reboot)
- **Browse Shared Files** — URL format and how the HTTP file server works

---

## Folder Structure

```
installator\
  hyperv-configurator.ps1       CLI tool
  hyperv-web-configurator.ps1   Web UI launcher
  web\
    server.js                   Node.js Express/WS server
    public\
      index.html                Browser single-page app
  refresh-elo-tokens.js         Playwright-based ELO token refresher
  downloads.txt                 URL catalogue (edit this)
  ollama-models.json            Ollama model catalogue (edit this)
  softwares\                    Place installer files here
  how-to.en.txt                 Getting started guide (English)
  how-to.es.txt                 Getting started guide (Spanish)
  how-to.de.txt                 Getting started guide (German)
  package.json                  Node.js dependencies (express, ws, playwright)
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Empty VM list | Not running as admin | Right-click → Run as Administrator |
| Cannot connect to VM | VM off or Private switch | Start VM; change to Internal switch |
| HTTP host IP not detected | Private switch | Shown as warning; PSSession used automatically |
| ELO download WebException | Token expired | Refresh tokens (see above) |
| Playwright browser fails | Node.js missing | Install from https://nodejs.org |
| `PSSessionStateBroken` | DISM restart in VM | Script recovers automatically; may need VM reboot |
| Firewall rule left behind | Script crashed | `Get-NetFirewallRule -DisplayName "HVCopy-*" \| Remove-NetFirewallRule` |
| Port 3000 already in use | Old server running | Script kills the old process automatically |

---

## License

Internal tool — no license file. All rights reserved.
