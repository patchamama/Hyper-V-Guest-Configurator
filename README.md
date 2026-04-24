# Hyper-V Guest Configurator

This project provides a robust PowerShell-based automation framework designed to streamline the provisioning and configuration of Microsoft Hyper-V guest virtual machines. It specializes in two primary areas: automated software deployment and the establishment of a complete WSL2/Docker infrastructure for AI workloads.

## Core Functionalities

### 1. Automated Software Installation
The script manages the lifecycle of software deployment through two main channels:
- **Local Installers**: Automates the transfer of binaries from the host's `softwares` directory to the guest VM (C:\Install). It supports silent installation modes for common tools like Firefox, Notepad++, PostgreSQL, and SQL Server using predefined command-line arguments.
- **Winget Integration**: Leverages the Windows Package Manager (Winget) to install modern applications directly from Microsoft's repository, ensuring up-to-date versions without manual intervention.

### 2. WSL2 and Docker Infrastructure
A significant portion of the script is dedicated to preparing the guest VM for containerized workloads:
- **Nested Virtualization**: Automatically configures the host processor settings to expose virtualization extensions to the guest VM, a prerequisite for running WSL2 and Docker.
- **WSL2 Deployment**: Enables the Virtual Machine Platform and Windows Subsystem for Linux features, installs the Linux kernel update package, and sets WSL2 as the default version.
- **Docker Desktop Orchestration**: Automates the installation of Docker Desktop via Chocolatey, manages necessary reboots, and ensures the Docker daemon is responsive before proceeding.

### 3. AI Stack Deployment (Ollama + Caddy)
The script automates the deployment of a local AI inference environment:
- **Containerization**: Uses Docker Compose to orchestrate an Ollama instance paired with a Caddy reverse proxy.
- **Security**: Caddy is configured to provide an SSL-secured endpoint for the Ollama API, including automatic certificate generation and installation into the guest's Trusted Root store.
- **Model Management**: Allows the user to select and automatically pull multiple LLM models (e.g., DeepSeek, Llama, Mistral) during the deployment phase.

## Technical Workflow

The execution follows a state-aware pipeline:
1.  **State Initialization**: Checks for existing deployment state files to allow resuming from the last successful step in case of interruptions.
2.  **Environment Validation**: Verifies VM connectivity and administrative privileges.
3.  **Feature Provisioning**:
    - Host-side: Configuration of nested virtualization.
    - Guest-side: Windows Feature enablement and WSL kernel installation.
4.  **Application Deployment**:
    - Infrastructure: Docker and Chocolatey setup.
    - Software: File transfer and silent/interactive installation.
5.  **Finalization**: Cleanup of temporary state files and deployment summary reporting.

## Requirements

- **Host OS**: Windows 10/11 Pro, Enterprise, or Server with Hyper-V role enabled.
- **Privileges**: PowerShell must be executed as Administrator.
- **Guest OS**: Windows 10/11 guest with WinRM enabled for remote command execution.
- **Connectivity**: The host must have network access to the guest VM and the internet for package downloads.

## Usage

1. Place local installers in the `softwares` folder.
2. Execute the script from an elevated PowerShell prompt:
   ```powershell
   .\hyperv-configurator.ps1
   ```
3. Follow the interactive prompts to select the target VM and desired features.
