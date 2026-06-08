# Hyper-V Guest Configurator

Automated deployment toolkit for Hyper-V virtual machines. Configures WSL2,
Docker Desktop, Ollama (AI engine), custom software, and more on Windows
guest VMs — from a single script run on the Hyper-V host.

Two tools are included:

| Tool | Interface | Best for |
|------|-----------|----------|
| `hyperv-configurator.ps1` | Interactive CLI (arrow-key menus) | Automation, scripting, advanced users |
| `hyperv-web-configurator.ps1` | Browser GUI at `http://127.0.0.1:3000` | Visual configuration, beginners |

The web configurator also runs in **Docker / Local Machine mode** — a containerized
version for production servers that provides DB management, LLM queries, File Search,
and Logs Viewer without requiring Hyper-V.

---

## Quick Install — Docker / Local Machine Mode

> No Node.js, no npm, no dependencies. Just Docker.

### One-liner (Windows CMD — run as Administrator)

```cmd
curl -L -o install_local.bat "https://raw.githubusercontent.com/patchamama/Hyper-V-Guest-Configurator/main/install_local.bat" && install_local.bat
```

### One-liner (PowerShell — run as Administrator)

```powershell
irm "https://raw.githubusercontent.com/patchamama/Hyper-V-Guest-Configurator/main/install_local.bat" -OutFile install_local.bat; .\install_local.bat
```

The script will:
1. Check if Docker Desktop is installed — offer to install it via `winget` if not
2. Pull the pre-built image from `ghcr.io` (fast, ~30 seconds)
3. Fall back to cloning the repo and building locally if no pre-built image is available
4. Create `C:\ollama-configurator\` with config files and data directories
5. Start the container and open the browser at `http://localhost:3000`

### Uninstall

```cmd
cd C:\ollama-configurator
uninstall.bat
```

Stops the container, removes the image, optionally removes data and Docker Desktop.
Leaves no orphaned dependencies.

---

## Requirements — Hyper-V Mode

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

## Requirements — Docker / Local Machine Mode

- Windows 10 (1803+), Windows 11, or any Linux server
- Docker Desktop (Windows) or Docker Engine (Linux)
- 1 GB free disk space

---

## Quick Start — Hyper-V Mode

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

## Operating Modes

### Hyper-V Mode

Selected when you pick a Hyper-V virtual machine as the target. All features
are available: VM management, WSL2/AI stack deployment, file transfers, port
exposure, winget package installation, and Remote Desktop setup.

### Docker / Local Machine Mode

Activated automatically when the app detects it is running inside a Docker
container or on a non-Windows host. The browser UI shows a **🐳 Docker · Local Mode**
badge and hides Hyper-V-specific features.

**Available in Docker mode:**

| Feature | Status |
|---------|--------|
| Database admin (PostgreSQL, MySQL, SQL Server) | ✅ Full |
| LLM / RAG queries (via Ollama) | ✅ Full |
| Community Knowledge Base | ✅ Full (when data is present) |
| Port exposure & network tools | ✅ Full |
| File Search | 🔜 Coming soon |
| Logs Viewer | 🔜 Coming soon |
| VM management (Hyper-V) | ❌ Requires Windows host |
| PSSession / winget features | ❌ Requires Windows host |

---

## Feature Modes — Hyper-V Only

Both CLI and Web tools support the same installation workflows for guest VMs:

| Mode | What gets configured |
|------|----------------------|
| Full WSL2 + AI Stack | Nested virtualization → WSL2 kernel → Docker Desktop → Ollama + Caddy via Docker Compose |
| Software Packages | Copy local installers, run winget packages, download URLs |
| WSL Preparation | Enables WSL features only (no WSL install) — prepares for manual WSL install |
| WSL Prep + Software | Combination of the above two |
| Full Stack + Software | Everything |

---

## Docker Deployment (for developers)

To publish a new pre-built image to GitHub Container Registry so users can install
via the one-liner above:

```powershell
# Edit docker_deploy.ps1 — set GitHubUser and RepoName at the top
.\docker_deploy.ps1
```

The script will:
1. Build the Docker image
2. Prompt for a version tag (optional)
3. Log in to `ghcr.io` using a GitHub PAT (`write:packages` scope)
4. Push the image as `ghcr.io/patchamama/Hyper-V-Guest-Configurator:latest`

**After pushing**, make the package public in GitHub:
`github.com/patchamama/Hyper-V-Guest-Configurator → Packages → Container → Package settings → Change visibility → Public`

---

## Configuration Files

### `downloads.txt`

URLs downloaded directly inside the VM (the VM fetches from the internet).
Supports ELO CDN links with expiring tokens.

```
# Format: Display Name | URL
ELO Server Setup | https://cdn2.elo.com/...?token=...&expire=...
# Bare URLs also work:
https://example.com/tool.zip
```

### `llm-config.json`

LLM provider and model configuration for the RAG/LLM panel.

```json
{
  "provider": "ollama",
  "ollama": { "host": "http://localhost:11434", "model": "deepseek-r1:1.5b" }
}
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
  Apps\
    Firefox Installer.exe
    7z2409-x64.exe
```

---

## File Transfer Methods (Hyper-V mode)

When copying local files from the host to the VM, two methods are available.
Both tools default to **HTTP Download** and fall back automatically.

### HTTP Download *(default — recommended)*

The host starts a temporary `HttpListener` on a random port (52000–53000).
The VM downloads files directly via the Hyper-V virtual switch.

- **Speed**: ~500 MB/s to 1 GB/s (memory-mapped virtual network)
- **Requires**: Internal or Default switch (not Private)
- **Firewall**: Temporary inbound rule added and removed automatically

### PSSession Copy *(fallback)*

Files are serialized in 8 MB chunks over PowerShell remoting.

- **Speed**: ~50–100 MB/s
- **Always available** — no switch or firewall requirements

---

## ELO Token Refresh

ELO CDN download URLs include a `token=...&expire=...` parameter that expires
after a few hours.

### Web UI

1. Go to **Downloads** panel
2. Click **↻ Refresh Tokens**
3. A Chromium browser opens — log in at `partner.elo.com`
4. Navigate to Software Downloads and click each download link
5. Click **✓ Done** in the web UI

### CLI

```
[!] Expired tokens detected for: serversetup2-25.00.zip
Launching token refresher...
```

Or manually: `node refresh-elo-tokens.js`

---

## Checkpoint / Resume

Both tools save progress to `deploy-state.json` after each step.
On restart after interruption:

- **CLI**: Detects the saved state and asks whether to resume or start over.
- **Web**: Shows completed steps as ✅. Click **↺ Reset** to clear state.

---

## WSL2 + AI Stack — What Gets Deployed

```
HOST ──────────────────────────────────────────────────────
  .\hyperv-configurator.ps1  or  web UI
  Drives all steps via PSSession / HTTP to the VM

GUEST VM ──────────────────────────────────────────────────
  Step 1  Enable Nested Virtualization (Set-VMProcessor)
  Step 2  Enable WSL Windows Features
  Step 3  Install WSL2 kernel MSI + set default version
  Step 4  Install Docker Desktop via Chocolatey
  Step 5  Start Docker Desktop (manual step — accept ToS)
  Step 6  Deploy Ollama + Caddy via Docker Compose
```

---

## Web Configurator — Architecture

```
hyperv-web-configurator.ps1    Launcher — checks Node.js, installs deps,
                                starts server, opens browser
        │
        ▼
web/server.js                  Express + WebSocket server (port 3000)
        │                      REST: /api/vms /api/db /api/community etc.
        │                      WS:   streams PowerShell output live
        ▼
web/public/index.html          Single-page app
                                Sidebar nav · Execution panel · DB Admin
                                Community KB · LLM panel · Exposure
```

---

## Folder Structure

```
installator\
  hyperv-configurator.ps1       CLI tool (Hyper-V mode)
  hyperv-web-configurator.ps1   Web UI launcher (Hyper-V mode)
  install_local.bat             One-click Docker / Local Mode install
  uninstall.bat                 Removes container, image, data, optional Docker
  docker_deploy.ps1             Build & push image to ghcr.io
  Dockerfile                    Docker image definition (Node 22 + pwsh)
  docker-compose.yml            Docker Compose config
  .dockerignore                 Files excluded from the image
  web\
    server.js                   Node.js Express/WS server
    public\
      index.html                Browser single-page app
  refresh-elo-tokens.js         Playwright-based ELO token refresher
  downloads.txt                 URL catalogue
  llm-config.json               LLM / Ollama settings
  ollama-models.json            Ollama model catalogue
  softwares\                    Place installer files here
  community\                    Community KB data (SQLite + articles)
  package.json                  Node.js dependencies
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
| Docker container won't start | Docker daemon not running | Start Docker Desktop |
| Port 3000 in use | Old server running | Change `APP_PORT` in `install_local.bat` or stop the old process |
| `ghcr.io` pull fails | Image not published yet | Run `docker_deploy.ps1` first, or build from source |

---

## License

Internal tool — no license file. All rights reserved.
