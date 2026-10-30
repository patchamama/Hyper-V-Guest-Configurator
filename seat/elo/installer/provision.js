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

  let ip = null, port = 22;
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
    log('__STEP__ Creating the VirtualBox VM (NAT with port forwarding: SSH 2222 and the ELO ports)');
    const vb = (...a) => x.run(VBOX, a, { timeoutMs: 120000 });
    for (const a of [
      ['createvm', '--name', name, '--ostype', img.vbox, '--register', '--basefolder', VM_DIR],
      ['modifyvm', name, '--memory', String(ramGB * 1024), '--cpus', String(cpus), '--nic1', 'nat', '--graphicscontroller', 'vmsvga', '--audio-enabled', 'off'],
      ['modifyvm', name, '--natpf1', 'ssh,tcp,127.0.0.1,2222,,22'],
      ...[9090, 9060, 9010, 9200, 5050].map(p => ['modifyvm', name, '--natpf1', `elo${p},tcp,,${p},,${p}`]),
      ['storagectl', name, '--name', 'SATA', '--add', 'sata', '--controller', 'IntelAhci'],
      ['storageattach', name, '--storagectl', 'SATA', '--port', '0', '--device', '0', '--type', 'hdd', '--medium', disk],
      ['storageattach', name, '--storagectl', 'SATA', '--port', '1', '--device', '0', '--type', 'dvddrive', '--medium', seed],
      ['startvm', name, '--type', 'headless'],
    ]) { const r = await vb(...a); if (r.code !== 0) throw new Error(`VBoxManage ${a[0]}: ${r.err.trim()}`); }
    ip = '127.0.0.1'; port = 2222;
    log('__STEP__ Waiting for the VM to boot (cloud-init installs packages on first boot)');
  }
  if (!ip) throw new Error('the VM did not report an IP address (check it in the hypervisor console)');
  log(`VM address: ${ip}:${port}`);

  log('__STEP__ Waiting for SSH with the installer key');
  x.setTarget({ host: ip, port, user: 'elo', key: keyFile, kind: platform, vm: name });
  let info = '';
  for (let i = 0; i < 60; i++) {
    try { info = (await x.sh('cloud-init status --wait >/dev/null 2>&1; . /etc/os-release; echo "$PRETTY_NAME, $(nproc) CPU, $(awk \'/MemTotal/{printf "%.1f GB", $2/1048576}\' /proc/meminfo)"', 900)).trim(); if (info) break; }
    catch { await new Promise(res => setTimeout(res, 10000)); }
  }
  if (!info) throw new Error('SSH to the VM did not succeed');
  log(`Connected: ${info}`);
  log(`__STEP__ VM ready and set as the installation target (user elo, password ${pw})`);
}

module.exports = { status, installWsl, enableHyperV, installVirtualBox, createVm, VM_DIR, IMAGES };
