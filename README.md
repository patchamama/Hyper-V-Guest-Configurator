# Hyper-V Guest Configurator

PowerShell automation for preparing and provisioning Windows Hyper-V guest VMs.

## What it does

- Configures VM prerequisites for WSL2 (including nested virtualization).
- Supports two WSL tracks:
  - **Full WSL + AI stack**: WSL2 + Docker + Ollama + Caddy.
  - **Minimal WSL preparation**: enables support only, no WSL install.
- Deploys software to guest VM from:
  - **Local installers** in `softwares/`.
  - **Winget** package catalog.
- Handles interrupted runs with checkpoint/resume support.

## New behavior and options

### Startup safety prompt
If an interrupted/pending installation is detected, the script asks in English whether to continue before any resume/start-over action.

### Feature selection modes
- `1`: Full WSL2 + AI stack (WSL + Docker + Ollama)
- `2`: Software packages only
- `3`: Minimal WSL preparation only (no WSL install)
- `4`: Minimal WSL preparation + software
- `A`: Full WSL2 + AI stack + software

### Minimal WSL preparation mode
This mode:
- Enables `VirtualMachinePlatform` and `Microsoft-Windows-Subsystem-Linux`.
- Reboots VM to apply features.
- Prepares update/package support in guest Windows (Microsoft Update service registration, update services, winget source refresh when available).

It **does not** install WSL. At the end it prints required commands to run inside the VM:
- `wsl --install --no-distribution`
- `wsl --update`
- `wsl --set-default-version 2`

### Software source selection by folders
Local software selection is now two-step:
1. Choose one or more folders under `softwares/`.
2. Choose specific files from those folders.

Paths are preserved when copied to `C:\Install` in the VM.

### Default local installer behavior: copy-only
For local installers, default mode is now **copy-only** in all flows.
- Files are copied to guest VM.
- They are not executed unless you explicitly choose `silent` or `interactive`.

### Docker via winget option
When selecting winget packages, you can explicitly opt-in Docker Desktop installation via winget.

### PostgreSQL and SQL Server password prompts
When PostgreSQL or SQL Server installer/package is detected, the script can prompt for:
- PostgreSQL superuser password
- SQL Server `sa` password

Passwords are entered as hidden input and are not stored in checkpoint state.

## Requirements

- Host: Windows with Hyper-V enabled.
- Run PowerShell **as Administrator**.
- Guest VM: Windows guest reachable via PowerShell Direct/Hyper-V integration.
- Internet access for package downloads (winget/choco/WSL kernel/etc.).

## Usage

1. Put local installers in `softwares/` (subfolders supported).
2. Run from elevated PowerShell:

```powershell
.\hyperv-configurator.ps1
```

3. Follow prompts for VM, feature mode, and package/file selection.
