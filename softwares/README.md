# `softwares/` directory

Put your local installers here, organized in subfolders if you want.

Examples:
- `softwares/browsers/Firefox Installer.exe`
- `softwares/databases/postgresql-18.3-2-windows-x64.exe`
- `softwares/tools/npp.8.9.3.Installer.x64.exe`

How the script uses this folder:
1. First, it lets you choose one or more folders inside `softwares/`.
2. Then, it shows files from those folders so you can choose exactly what to copy.
3. Selected files are copied to `C:\Install` inside the target Hyper-V VM, preserving subfolder structure.

Important:
- Default behavior is `copy-only` for local installers.
- That means files are copied but not executed unless you explicitly choose another install mode.
