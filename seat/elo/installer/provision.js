'use strict';
// Provisioning of the installation targets on Windows:
//  - status(): WSL, Docker Desktop, Hyper-V, VirtualBox (installed / enabled / edition).
//  - installWsl({distro,user,password}): enable WSL if missing (reboot may be needed) and install Ubuntu/Debian for
//    the signed-in user, with a default user and systemd.
//  - enableHyperV(), installVirtualBox(): Windows feature / signed Oracle installer (reboot may be needed).
//  - createVm({platform,distro,name,ramGB,cpus,diskGB}): Ubuntu 24.04 / Debian 13 cloud image → qemu-img (in WSL)
//    → VHDX (Hyper-V, Gen2) or VDI (VirtualBox) + cloud-init NoCloud seed (user "elo", installer SSH key,
//    passwordless sudo) → VM started, IP detected, set as the installer's SSH target.
const fs = require('fs');
const path = require('path');
const x = require('./exec');

const VM_DIR = 'C:\\ProgramData\\hvc-vms';
const CACHE = path.join(VM_DIR, 'cache');
const VBOX = 'C:\\Program Files\\Oracle\\VirtualBox\\VBoxManage.exe';
const DOCKER_DESKTOP = 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe';
const IMAGES = {
  ubuntu: { url: 'https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img', file: 'ubuntu-24.04-cloudimg-amd64.img', label: 'Ubuntu 24.04 LTS', vbox: 'Ubuntu_64', hv: 'linux-cloud-tools-virtual' },
  debian: { url: 'https://cloud.debian.org/images/cloud/trixie/latest/debian-13-genericcloud-amd64.qcow2', file: 'debian-13-genericcloud-amd64.qcow2', label: 'Debian 13', vbox: 'Debian_64', hv: 'hyperv-daemons' },
};
const psq = s => String(s).replace(/'/g, "''");
const userRun = async script => {   // PowerShell as the signed-in user (WSL distros are per user)
  const seat = x.getSeatLib() || (() => { try { return require('../../seat-lib'); } catch { return null; } })();
  if (seat && x.getMode() === 'wsl-user') return seat.runAsUser(script, 1800);
  return (await x.ps(script, 1800000)).out;
};

async function status() {
  if (!x.IS_WIN) return { ok: true, platform: process.platform };
  const r = await x.ps(`$o=[ordered]@{}; $o.edition=(Get-CimInstance Win32_OperatingSystem).Caption
$w=Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -EA SilentlyContinue; $vmp=Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -EA SilentlyContinue
$o.wslFeature="$($w.State)"; $o.vmPlatform="$($vmp.State)"; $o.wslExe=[bool](Get-Command wsl.exe -EA SilentlyContinue)
$h=Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -EA SilentlyContinue; $o.hyperV="$($h.State)"
$o.hyperVCmdlets=[bool](Get-Command New-VM -EA SilentlyContinue)
$o.vbox=Test-Path '${VBOX}'; if($o.vbox){ $o.vboxVersion=(& '${VBOX}' --version) }
$o.dockerDesktop=Test-Path '${DOCKER_DESKTOP}'
$o.switches=@(try{ Get-VMSwitch -EA Stop | % Name }catch{})
ConvertTo-Json -Compress $o`);
  let s = {}; try { s = JSON.parse(r.out.trim().split('\n').pop()); } catch {}
  const env = await x.detect().catch(() => ({}));
  return { ok: true, ...s, wslDistro: env.distro || null, home: /Home/i.test(s.edition || '') };
}

// WSL: enable the features if needed (elevated; reboot), then install the distro for the signed-in user.
async function installWsl({ distro = 'Ubuntu-24.04', user = 'elo', password }, log) {
  const st = await status();
  if (st.wslFeature !== 'Enabled' || st.vmPlatform !== 'Enabled') {
    log('__STEP__ Enabling WSL (Windows features)');
    const r = await x.ps('wsl.exe --install --no-distribution 2>&1 | Out-String', 1800000);
    log(r.out.replace(/\0/g, '').trim());
    log('__REBOOT__ Windows must be restarted to finish enabling WSL. Run the installer again afterwards.');
    return;
  }
  log(`__STEP__ Installing ${distro} for the signed-in user`);
  log((await userRun(`$env:WSL_UTF8='1'; wsl.exe --install -d '${psq(distro)}' --no-launch 2>&1 | Out-String`)).trim());
  log('__STEP__ Creating the default user, enabling systemd');
  const pw = password || Math.random().toString(36).slice(2, 12);
  const cfg = `id -u ${user} >/dev/null 2>&1 || useradd -m -s /bin/bash -G sudo ${user}; echo '${user}:${pw.replace(/'/g, '')}' | chpasswd; ` +
    `printf '[user]\\ndefault=${user}\\n[boot]\\nsystemd=true\\n' > /etc/wsl.conf; echo configured`;
  log((await userRun(`$env:WSL_UTF8='1'; wsl.exe -d '${psq(distro)}' -u root -- bash -c "${cfg.replace(/"/g, '\\"')}" 2>&1 | Out-String; wsl.exe --terminate '${psq(distro)}'`)).trim());
  log(`__STEP__ ${distro} ready (user ${user}${password ? '' : ', password ' + pw})`);
  process.env.ELO_WSL_DISTRO = distro;
}

async function enableHyperV(log) {
  const st = await status();
  if (st.home) throw new Error(`Hyper-V is not available on ${st.edition} (needs Pro, Enterprise or Education)`);
  if (st.hyperV === 'Enabled') { log('Hyper-V is already enabled'); return; }
  log('__STEP__ Enabling Hyper-V');
  const r = await x.ps(`$r=Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -All -NoRestart; "RestartNeeded=$($r.RestartNeeded)"`, 1800000);
  log(r.out.trim() || r.err.trim());
  log('__REBOOT__ Windows must be restarted to finish enabling Hyper-V.');
}

async function installVirtualBox(log) {
  if (fs.existsSync(VBOX)) { log('VirtualBox is already installed'); return; }
  log('__STEP__ Downloading VirtualBox (latest stable)');
  const r = await x.ps(`[Net.ServicePointManager]::SecurityProtocol='Tls12'; $b='https://download.virtualbox.org/virtualbox'
$v=(Invoke-WebRequest "$b/LATEST-STABLE.TXT" -UseBasicParsing).Content.Trim()
$exe=(Invoke-WebRequest "$b/$v/" -UseBasicParsing).Links.href | Where-Object { $_ -match "^VirtualBox-$([regex]::Escape($v))-\\d+-Win\\.exe$" } | Select-Object -First 1
if(-not $exe){ 'ERROR: installer not found for '+$v; exit }
$f=Join-Path $env:TEMP $exe; Invoke-WebRequest "$b/$v/$exe" -OutFile $f -UseBasicParsing
$s=Get-AuthenticodeSignature $f; if($s.Status -ne 'Valid'){ 'ERROR: signature '+$s.Status; exit }
"Installing $exe (signed by $($s.SignerCertificate.Subject.Split(',')[0]))"
Start-Process $f -ArgumentList '--silent','--ignore-reboot' -Wait; if(Test-Path '${VBOX}'){ 'VirtualBox installed: '+(& '${VBOX}' --version) } else { 'ERROR: installation failed' }`, 1800000);
  log(r.out.trim());
  if (/ERROR/.test(r.out)) throw new Error(r.out.match(/ERROR:.*/)[0]);
}

// cloud-init NoCloud user-data for the VM.
function userData({ name, distro, password, pubKey }) {
  return `#cloud-config
hostname: ${name}
users:
  - name: elo
    groups: [sudo]
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    lock_passwd: false
    ssh_authorized_keys: ['${pubKey}']
chpasswd:
  expire: false
  users: [{name: elo, password: '${password}', type: text}]
ssh_pwauth: true
growpart: {mode: auto, devices: ['/']}
package_update: true
packages: [openssh-server, curl, ca-certificates, ${IMAGES[distro].hv}]
runcmd:
  - [systemctl, enable, --now, ssh]
`;
}

async function createVm({ platform, distro = 'ubuntu', name, ramGB = 16, cpus = 4, diskGB = 80, password }, log, keyFile) {
  const img = IMAGES[distro]; if (!img) throw new Error('unknown distro');
  if (!/^[A-Za-z0-9-]{2,40}$/.test(name || '')) throw new Error('VM name: letters, digits and "-" only');
  const st = await status();
  if (platform === 'hyperv' && st.hyperV !== 'Enabled') throw new Error('Hyper-V is not enabled');
  if (platform === 'vbox' && !st.vbox) throw new Error('VirtualBox is not installed');
  if (!fs.existsSync(keyFile + '.pub')) await x.run('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'elo-installer', '-f', keyFile]);
  const pubKey = fs.readFileSync(keyFile + '.pub', 'utf8').trim();
  const pw = password || Math.random().toString(36).slice(2, 12);
  const dir = path.join(VM_DIR, name); fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(path.join(dir, 'user-data'), userData({ name, distro, password: pw, pubKey }));
  fs.writeFileSync(path.join(dir, 'meta-data'), `instance-id: ${name}-${Date.now()}\nlocal-hostname: ${name}\n`);
  const L = p => x.toLinux(p), ext = platform === 'hyperv' ? 'vhdx' : 'vdi', disk = path.join(dir, `${name}.${ext}`), seed = path.join(dir, 'seed.iso');

  log(`__STEP__ Downloading ${img.label} cloud image (cached)`);
  log('__STEP__ Converting the disk with qemu-img and creating the cloud-init seed (in WSL)');
  const out = await x.shLocal(`set -e; export DEBIAN_FRONTEND=noninteractive
command -v qemu-img >/dev/null && command -v cloud-localds >/dev/null || { apt-get update -qq; apt-get install -y -qq qemu-utils cloud-image-utils >/dev/null; }
c=${x.shq(L(path.join(CACHE, img.file)))}; [ -s "$c" ] || curl -fsSL -o "$c" ${x.shq(img.url)}
echo "image: $(du -h "$c" | cut -f1)"
# Resize the qcow2 copy first (qemu-img cannot resize VHDX), then convert to the hypervisor's format.
cp -f "$c" /tmp/elo-vm.qcow2 && qemu-img resize /tmp/elo-vm.qcow2 ${Number(diskGB)}G >/dev/null
qemu-img convert -O ${platform === 'hyperv' ? 'vhdx -o subformat=dynamic' : 'vdi'} /tmp/elo-vm.qcow2 /tmp/elo-vm.${ext} && rm -f /tmp/elo-vm.qcow2
mv -f /tmp/elo-vm.${ext} ${x.shq(L(disk))}
cloud-localds ${x.shq(L(seed))} ${x.shq(L(path.join(dir, 'user-data')))} ${x.shq(L(path.join(dir, 'meta-data')))}
ls -lh ${x.shq(L(dir))} | tail -n +2 | awk '{print $5, $9}'`, 3600);
  log(out.trim());
  if (!fs.existsSync(disk) || !fs.existsSync(seed)) throw new Error('disk or seed not created');

  let ip = null, port = 22, portMap = null;
  if (platform === 'hyperv') {
    log('__STEP__ Creating the Hyper-V VM (Generation 2, Secure Boot with the UEFI CA template)');
    const r = await x.ps(`$ErrorActionPreference='Stop'; $n='${psq(name)}'
$sw=(Get-VMSwitch | Where-Object Name -eq 'Default Switch' | Select-Object -First 1); if(-not $sw){ $sw=Get-VMSwitch | Select-Object -First 1 }
New-VM -Name $n -Generation 2 -MemoryStartupBytes ${Number(ramGB)}GB -VHDPath '${psq(disk)}' -SwitchName $sw.Name -Path '${psq(VM_DIR)}' | Out-Null
Set-VMFirmware -VMName $n -SecureBootTemplate MicrosoftUEFICertificateAuthority
Set-VMProcessor -VMName $n -Count ${Number(cpus)}
Set-VMMemory -VMName $n -DynamicMemoryEnabled $false
Add-VMDvdDrive -VMName $n -Path '${psq(seed)}'
Start-VM -Name $n
$mac=(Get-VMNetworkAdapter -VMName $n).MacAddress; "switch=$($sw.Name) mac=$mac"`, 300000);
    log(r.out.trim() || r.err.trim());
    log('__STEP__ Waiting for the VM to boot and report its IP (cloud-init installs packages on first boot)');
    for (let i = 0; i < 60 && !ip; i++) {
      await new Promise(res => setTimeout(res, 10000));
      const q = await x.ps(`$n='${psq(name)}'; $a=Get-VMNetworkAdapter -VMName $n; $ip=@($a.IPAddresses | ?{ $_ -match '^\\d+\\.\\d+\\.\\d+\\.\\d+$' })[0]
if(-not $ip){ $m=($a.MacAddress -replace '(..)(?!$)','$1-'); $ip=(Get-NetNeighbor -LinkLayerAddress $m -AddressFamily IPv4 -EA SilentlyContinue | Select-Object -First 1).IPAddress }; "$ip"`);
      ip = (q.out.trim().split('\n').pop() || '').trim() || null;
    }
  } else {
    // Host ports for the NAT forwarding: first free port from 2222 (SSH) and from <port>+10000 for the ELO ports
    // (other software may already use some, e.g. 19010).
    const used = new Set((await x.ps('Get-NetTCPConnection -State Listen -EA SilentlyContinue | % LocalPort | Sort-Object -Unique')).out.split(/\s+/).map(Number));
    const free = p => { while (used.has(p)) p++; used.add(p); return p; };
    port = free(2222);
    portMap = Object.fromEntries([9090, 9060, 9010, 9200, 5050].map(p => [p, free(p + 10000)]));
    log(`__STEP__ Creating the VirtualBox VM (NAT: SSH ${port}, ELO ports ${Object.entries(portMap).map(([g, h]) => `${g}→${h}`).join(' ')})`);
    const vb = (...a) => x.run(VBOX, a, { timeoutMs: 120000 });
    for (const a of [
      ['createvm', '--name', name, '--ostype', img.vbox, '--register', '--basefolder', VM_DIR],
      ['modifyvm', name, '--memory', String(ramGB * 1024), '--cpus', String(cpus), '--nic1', 'nat', '--graphicscontroller', 'vmsvga', '--audio-enabled', 'off'],
      ['modifyvm', name, '--natpf1', `ssh,tcp,127.0.0.1,${port},,22`],
      ...Object.entries(portMap).map(([g, h]) => ['modifyvm', name, '--natpf1', `elo${g},tcp,127.0.0.1,${h},,${g}`]),
      // 2 SATA ports only: the guest kernel otherwise probes 30 ports one by one at boot.
      ['storagectl', name, '--name', 'SATA', '--add', 'sata', '--controller', 'IntelAhci', '--portcount', '2'],
      ['storageattach', name, '--storagectl', 'SATA', '--port', '0', '--device', '0', '--type', 'hdd', '--medium', disk],
      ['storageattach', name, '--storagectl', 'SATA', '--port', '1', '--device', '0', '--type', 'dvddrive', '--medium', seed],
      ['startvm', name, '--type', 'headless'],
    ]) { const r = await vb(...a); if (r.code !== 0) throw new Error(`VBoxManage ${a[0]}: ${r.err.trim()}`); }
    ip = '127.0.0.1';
    log('__STEP__ Waiting for the VM to boot (cloud-init installs packages on first boot; slower when Hyper-V is enabled)');
  }
  if (!ip) throw new Error('the VM did not report an IP address (check it in the hypervisor console)');
  log(`VM address: ${ip}:${port}`);

  log('__STEP__ Waiting for SSH with the installer key');
  // Checked against this VM explicitly (not the global target, which the UI may change meanwhile); the VM becomes
  // the installation target only once SSH works.
  const vmTarget = { host: ip, port, user: 'elo', key: keyFile, kind: platform, vm: name, portMap };
  let info = '';
  for (let i = 0; i < 90 && !info; i++) {
    try { info = (await x.shOn(vmTarget, 'cloud-init status --wait >/dev/null 2>&1; . /etc/os-release; echo "$PRETTY_NAME, $(nproc) CPU, $(awk \'/MemTotal/{printf "%.1f GB", $2/1048576}\' /proc/meminfo)"', 900)).trim(); }
    catch { await new Promise(res => setTimeout(res, 10000)); }
  }
  if (!info) throw new Error('SSH to the VM did not succeed');
  log(`Connected: ${info}`);
  x.setTarget(vmTarget);
  log(`__STEP__ VM ready and set as the installation target (user elo, password ${pw})`);
}

// ── Windows Server VM (Hyper-V) with WSL2 + Ubuntu inside, reachable over SSH like a Linux VM ─────────────────────
// ELO images are Linux-only, so Docker runs in WSL2 inside the VM (nested virtualization). Windows Server 2019 has
// no WSL2, hence 2022 and 2025 only. Evaluation ISOs (180 days) or an own ISO; the image is applied to the VHDX
// with DISM (no setup UI), unattend.xml sets the Administrator password and skips OOBE.
const WIN_IMAGES = {
  ws2025: { label: 'Windows Server 2025', iso: 'https://go.microsoft.com/fwlink/?linkid=2293312&clcid=0x409&culture=en-us&country=us', file: 'ws2025-eval-en-us.iso' },
  ws2022: { label: 'Windows Server 2022', iso: 'https://go.microsoft.com/fwlink/p/?LinkID=2195280&clcid=0x409&culture=en-us&country=US', file: 'ws2022-eval-en-us.iso' },
};
const WSL_ROOTFS = { url: 'https://cloud-images.ubuntu.com/wsl/releases/24.04/current/ubuntu-noble-wsl-amd64-wsl.rootfs.tar.gz', file: 'ubuntu-24.04-wsl-rootfs.tar.gz' };
const EDITIONS = { 'standard-desktop': 'Standard.*Desktop', 'standard-core': 'Standard(?!.*Desktop)', 'datacenter-desktop': 'Datacenter.*Desktop', 'datacenter-core': 'Datacenter(?!.*Desktop)' };
const ELO_PORTS = [9090, 9060, 9010, 9200, 5050];

function unattend({ name, password, productKey }) {
  const c = n => `<component name="${n}" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">`;
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">
  <settings pass="specialize">${c('Microsoft-Windows-Shell-Setup')}<ComputerName>${esc(name.slice(0, 15))}</ComputerName>${productKey ? `<ProductKey>${esc(productKey)}</ProductKey>` : ''}</component></settings>
  <settings pass="oobeSystem">${c('Microsoft-Windows-Shell-Setup')}
    <UserAccounts><AdministratorPassword><Value>${esc(password)}</Value><PlainText>true</PlainText></AdministratorPassword></UserAccounts>
    <OOBE><HideEULAPage>true</HideEULAPage><SkipMachineOOBE>true</SkipMachineOOBE><SkipUserOOBE>true</SkipUserOOBE><ProtectYourPC>3</ProtectYourPC></OOBE>
  </component></settings>
</unattend>
`;
}

// Startup task inside the VM: keeps the WSL distro running and forwards the VM's SSH (22) and ELO ports to it.
const WSL_START = `$d='Ubuntu'
if(-not (Get-CimInstance Win32_Process -Filter "Name='wsl.exe'" | ? { $_.CommandLine -match 'sleep infinity' })) { Start-Process wsl.exe -ArgumentList '-d',$d,'-u','root','--','sleep','infinity' -WindowStyle Hidden; Start-Sleep 5 }
$ip=((wsl.exe -d $d -u root -- hostname -I) -split '\\s+')[0]
netsh interface portproxy reset | Out-Null
foreach($p in 22,${ELO_PORTS.join(',')}){ netsh interface portproxy add v4tov4 listenport=$p listenaddress=0.0.0.0 connectport=$p connectaddress=$ip | Out-Null }
"wsl=$ip" | Out-File C:\\elo\\wsl-start.log
`;

async function createWinVm({ distro, name, ramGB = 16, cpus = 4, diskGB = 127, password, isoPath, edition = 'standard-desktop', productKey, acceptEula }, log, keyFile) {
  const w = WIN_IMAGES[distro]; if (!w) throw new Error('unknown Windows version');
  if (!acceptEula) throw new Error('the Microsoft license terms must be accepted for the unattended installation');
  if (!/^[A-Za-z0-9-]{2,15}$/.test(name || '')) throw new Error('VM name: 2–15 letters, digits or "-" (Windows computer name)');
  if (productKey && !/^[A-Z0-9]{5}(-[A-Z0-9]{5}){4}$/i.test(productKey)) throw new Error('product key: XXXXX-XXXXX-XXXXX-XXXXX-XXXXX');
  if (!EDITIONS[edition]) throw new Error('unknown edition');
  const st = await status();
  if (st.hyperV !== 'Enabled') throw new Error('Hyper-V is not enabled');
  if (!fs.existsSync(keyFile + '.pub')) await x.run('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'elo-installer', '-f', keyFile]);
  const pubKey = fs.readFileSync(keyFile + '.pub', 'utf8').trim();
  // Complex enough for the Windows password policy.
  const pw = password || `Elo-${Math.random().toString(36).slice(2, 8)}${Math.floor(Math.random() * 90 + 10)}X`;
  const dir = path.join(VM_DIR, name); fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(CACHE, { recursive: true });
  const disk = path.join(dir, `${name}.vhdx`), unattendFile = path.join(dir, 'unattend.xml');
  if (fs.existsSync(disk)) throw new Error(`${disk} already exists`);
  fs.writeFileSync(unattendFile, unattend({ name, password: pw, productKey }));
  const ps = async (script, min = 30) => { const r = await x.ps(`$ErrorActionPreference='Stop'; ${script}`, min * 60000); if (r.code !== 0) throw new Error((r.err || r.out).trim().split('\n').slice(-3).join(' ')); return r.out.trim(); };
  const dl = async (url, file, label) => {
    log(`__STEP__ Downloading ${label} (cached in ${CACHE})`);
    log(await ps(`$f='${psq(file)}'; if(-not (Test-Path $f) -or (Get-Item $f).Length -lt 1MB){ [Net.ServicePointManager]::SecurityProtocol='Tls12'; $ProgressPreference='SilentlyContinue'
Invoke-WebRequest '${psq(url)}' -OutFile "$f.part" -UseBasicParsing; Move-Item "$f.part" $f -Force }; "$([math]::Round((Get-Item $f).Length/1GB,2)) GB  $f"`, 180));
  };
  const iso = isoPath || path.join(CACHE, w.file);
  if (isoPath) { if (!fs.existsSync(isoPath)) throw new Error(`ISO not found: ${isoPath}`); log(`__STEP__ Using the ISO ${isoPath}`); }
  else await dl(w.iso, iso, `${w.label} evaluation ISO (about 5–6 GB, 180-day evaluation)`);
  const rootfs = path.join(CACHE, WSL_ROOTFS.file);
  await dl(WSL_ROOTFS.url, rootfs, 'Ubuntu 24.04 WSL root file system');

  log(`__STEP__ Applying ${w.label} to a new ${diskGB} GB VHDX (DISM, a few minutes)`);
  log(await ps(`$vhd='${psq(disk)}'; $iso='${psq(iso)}'
New-VHD -Path $vhd -SizeBytes ${Number(diskGB)}GB -Dynamic | Out-Null
$dn=(Mount-VHD -Path $vhd -Passthru | Get-Disk).Number
try {
  Initialize-Disk -Number $dn -PartitionStyle GPT
  $efi=New-Partition -DiskNumber $dn -Size 260MB -AssignDriveLetter; Format-Volume -Partition $efi -FileSystem FAT32 -NewFileSystemLabel System -Confirm:$false | Out-Null
  New-Partition -DiskNumber $dn -Size 16MB -GptType '{e3c9e316-0b5c-4db8-817d-f92df00215ae}' | Out-Null
  $win=New-Partition -DiskNumber $dn -UseMaximumSize -AssignDriveLetter; Format-Volume -Partition $win -FileSystem NTFS -NewFileSystemLabel Windows -Confirm:$false | Out-Null
  $S=(Get-Partition -DiskNumber $dn -PartitionNumber $efi.PartitionNumber).DriveLetter; $W=(Get-Partition -DiskNumber $dn -PartitionNumber $win.PartitionNumber).DriveLetter
  $img=Mount-DiskImage -ImagePath $iso -PassThru; $I=($img | Get-Volume).DriveLetter
  try {
    $wim="$($I):\\sources\\install.wim"; if(-not (Test-Path $wim)){ $wim="$($I):\\sources\\install.esd" }
    $all=Get-WindowsImage -ImagePath $wim; $sel=$all | ? { $_.ImageName -match '${EDITIONS[edition]}' } | Select-Object -First 1
    if(-not $sel){ throw "edition not in the ISO: $(($all | % ImageName) -join ', ')" }
    "image: $($sel.ImageName) (index $($sel.ImageIndex))"
    Expand-WindowsImage -ImagePath $wim -Index $sel.ImageIndex -ApplyPath "$($W):\\" | Out-Null
  } finally { Dismount-DiskImage -ImagePath $iso | Out-Null }
  New-Item -ItemType Directory -Force "$($W):\\Windows\\Panther" | Out-Null; Copy-Item '${psq(unattendFile)}' "$($W):\\Windows\\Panther\\unattend.xml"
  bcdboot "$($W):\\Windows" /s "$($S):" /f UEFI | Out-String
  Set-Partition -DiskNumber $dn -PartitionNumber $efi.PartitionNumber -GptType '{c12a7328-f81f-11d2-ba4b-00a0c93ec93b}'
} finally { Dismount-VHD -Path $vhd }
"VHDX: $([math]::Round((Get-Item $vhd).Length/1GB,1)) GB"`, 60));

  log('__STEP__ Creating the Hyper-V VM (Generation 2, nested virtualization for WSL2) and starting Windows');
  log(await ps(`$n='${psq(name)}'
$sw=(Get-VMSwitch | Where-Object Name -eq 'Default Switch' | Select-Object -First 1); if(-not $sw){ $sw=Get-VMSwitch | Select-Object -First 1 }
New-VM -Name $n -Generation 2 -MemoryStartupBytes ${Number(ramGB)}GB -VHDPath '${psq(disk)}' -SwitchName $sw.Name -Path '${psq(VM_DIR)}' | Out-Null
Set-VMProcessor -VMName $n -Count ${Number(cpus)} -ExposeVirtualizationExtensions $true
Set-VMMemory -VMName $n -DynamicMemoryEnabled $false
Get-VMNetworkAdapter -VMName $n | Set-VMNetworkAdapter -MacAddressSpoofing On
Enable-VMIntegrationService -VMName $n -Name 'Guest Service Interface'
Start-VM -Name $n; "switch=$($sw.Name)"`, 5));

  // PowerShell Direct (VMBus): works without network, as Administrator.
  const cred = `$c=New-Object PSCredential('Administrator',(ConvertTo-SecureString '${psq(pw)}' -AsPlainText -Force))`;
  const inVm = (body, min = 30) => ps(`${cred}; Invoke-Command -VMName '${psq(name)}' -Credential $c -ScriptBlock { $ErrorActionPreference='Stop'; ${body} }`, min);
  const waitVm = async label => {
    log(`__STEP__ ${label}`);
    for (let i = 0; i < 90; i++) {
      try { return await inVm(`$o=Get-CimInstance Win32_OperatingSystem; "$($o.Caption) $($o.Version), $env:COMPUTERNAME"`, 2); }
      catch { await new Promise(r => setTimeout(r, 10000)); }
    }
    throw new Error('Windows in the VM did not answer over PowerShell Direct (check the VM console)');
  };
  log(await waitVm('Waiting for Windows setup (specialize + first boot, several minutes)'));

  log('__STEP__ Enabling WSL and the Virtual Machine Platform in the VM (then restart)');
  log(await inVm(`foreach($f in 'Microsoft-Windows-Subsystem-Linux','VirtualMachinePlatform'){ $r=Enable-WindowsOptionalFeature -Online -FeatureName $f -All -NoRestart; "$f restart=$($r.RestartNeeded)" }`, 20));
  await ps(`Restart-VM -Name '${psq(name)}' -Force`, 5);
  await new Promise(r => setTimeout(r, 30000));
  log(await waitVm('Waiting for the VM after the restart'));

  log('__STEP__ Installing WSL (latest release from GitHub) and importing Ubuntu 24.04');
  log(await inVm(`New-Item -ItemType Directory -Force C:\\elo\\wsl | Out-Null; [Net.ServicePointManager]::SecurityProtocol='Tls12'; $ProgressPreference='SilentlyContinue'
$a=(Invoke-RestMethod https://api.github.com/repos/microsoft/WSL/releases/latest).assets | ? name -match 'x64\\.msi$' | Select-Object -First 1
Invoke-WebRequest $a.browser_download_url -OutFile C:\\elo\\wsl.msi -UseBasicParsing
$p=Start-Process msiexec.exe -ArgumentList '/i','C:\\elo\\wsl.msi','/qn','/norestart' -Wait -PassThru; "$($a.name) exit=$($p.ExitCode)"`, 30));
  const s = `${cred}; $s=New-PSSession -VMName '${psq(name)}' -Credential $c`;
  log(await ps(`${s}; Copy-Item '${psq(rootfs)}' -Destination C:\\elo\\rootfs.tar.gz -ToSession $s; Remove-PSSession $s; 'rootfs copied'`, 30));
  log(await inVm(`$env:WSL_UTF8='1'; wsl.exe --import Ubuntu C:\\elo\\wsl\\Ubuntu C:\\elo\\rootfs.tar.gz --version 2 2>&1 | Out-String; Remove-Item C:\\elo\\rootfs.tar.gz; wsl.exe -l -v 2>&1 | Out-String`, 30));

  log('__STEP__ Configuring Ubuntu in WSL: user elo with the installer key, passwordless sudo, systemd, OpenSSH');
  const setup = `set -e; export DEBIAN_FRONTEND=noninteractive
id -u elo >/dev/null 2>&1 || useradd -m -s /bin/bash -G sudo elo; echo 'elo:${pw}' | chpasswd
echo 'elo ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/elo; mkdir -p /home/elo/.ssh; echo '${pubKey}' > /home/elo/.ssh/authorized_keys
chown -R elo:elo /home/elo/.ssh; chmod 700 /home/elo/.ssh; chmod 600 /home/elo/.ssh/authorized_keys
printf '[user]\\ndefault=elo\\n[boot]\\nsystemd=true\\n' > /etc/wsl.conf
apt-get update -qq; apt-get install -y -qq openssh-server curl ca-certificates >/dev/null; systemctl enable ssh >/dev/null 2>&1 || true; echo configured`;
  const b64 = Buffer.from(setup.replace(/\r/g, '')).toString('base64');
  log(await inVm(`$env:WSL_UTF8='1'; wsl.exe -d Ubuntu -u root -- bash -c "echo ${b64} | base64 -d | bash" 2>&1 | Out-String; wsl.exe --terminate Ubuntu | Out-Null`, 30));

  log('__STEP__ Startup task in the VM: keep WSL running, forward SSH and the ELO ports to it, open the firewall');
  const startB64 = Buffer.from(WSL_START, 'utf16le').toString('base64');
  log(await inVm(`[IO.File]::WriteAllText('C:\\elo\\wsl-start.ps1', [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${startB64}')))
New-NetFirewallRule -DisplayName 'ELO via WSL' -Direction Inbound -Protocol TCP -LocalPort 22,${ELO_PORTS.join(',')} -Action Allow | Out-Null
$act=New-ScheduledTaskAction -Execute powershell.exe -Argument '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\\elo\\wsl-start.ps1'
$trg=New-ScheduledTaskTrigger -AtStartup; $set=New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0 -AllowStartIfOnBatteries
Register-ScheduledTask -TaskName 'ELO-WSL' -Action $act -Trigger $trg -Settings $set -User Administrator -Password '${psq(pw)}' -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName 'ELO-WSL'; Start-Sleep 25; Get-Content C:\\elo\\wsl-start.log -EA SilentlyContinue`, 10));

  log('__STEP__ Detecting the VM address and connecting over SSH (Ubuntu in WSL)');
  let ip = null;
  for (let i = 0; i < 30 && !ip; i++) {
    const q = await x.ps(`@((Get-VMNetworkAdapter -VMName '${psq(name)}').IPAddresses | ?{ $_ -match '^\\d+\\.\\d+\\.\\d+\\.\\d+$' })[0]`);
    ip = q.out.trim() || null; if (!ip) await new Promise(r => setTimeout(r, 10000));
  }
  if (!ip) throw new Error('the VM did not report an IP address');
  const vmTarget = { host: ip, port: 22, user: 'elo', key: keyFile, kind: 'hyperv', vm: name, os: w.label };
  let info = '';
  for (let i = 0; i < 30 && !info; i++) {
    try { info = (await x.shOn(vmTarget, '. /etc/os-release; echo "$PRETTY_NAME (WSL2 in ' + w.label + '), $(nproc) CPU, $(awk \'/MemTotal/{printf "%.1f GB", $2/1048576}\' /proc/meminfo)"', 120)).trim(); }
    catch { await new Promise(r => setTimeout(r, 10000)); }
  }
  if (!info) throw new Error(`SSH to ${ip} did not succeed (see C:\\elo\\wsl-start.log in the VM)`);
  log(`Connected: ${info}`);
  x.setTarget(vmTarget);
  log(`__STEP__ VM ready and set as the installation target (Windows: Administrator / ${pw}; Ubuntu in WSL: elo / ${pw}). Next: Requirements installs Docker, Install deploys ELO.`);
}

module.exports = { status, installWsl, enableHyperV, installVirtualBox, createVm, createWinVm, VM_DIR, IMAGES, WIN_IMAGES };
