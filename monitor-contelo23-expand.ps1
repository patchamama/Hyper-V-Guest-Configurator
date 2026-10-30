$ErrorActionPreference = 'Stop'

$vmName = 'Contelo23'
$targetSize = 200GB
$logPath = Join-Path $PSScriptRoot 'monitor-contelo23-expand.log'
$deadline = (Get-Date).AddHours(6)

function Write-Log([string] $message) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $message" | Add-Content -LiteralPath $logPath
}

try {
    Import-Module Hyper-V -ErrorAction Stop
    Write-Log 'Supervisor iniciado.'

    do {
        $vm = Get-VM -Name $vmName -ErrorAction Stop
        $disk = Get-VMHardDiskDrive -VMName $vmName -ErrorAction Stop |
            Where-Object { $_.ControllerType -eq 'IDE' -and $_.ControllerNumber -eq 0 -and $_.ControllerLocation -eq 0 }

        if ($disk -and $vm.State -eq 'Off' -and $vm.Status -notmatch 'zusammengeführt|merging') {
            $vhd = Get-VHD -Path $disk.Path -ErrorAction Stop
            if ($vhd.VhdType -ne 'Differencing' -and $vhd.Size -lt $targetSize) {
                Resize-VHD -Path $disk.Path -SizeBytes $targetSize -ErrorAction Stop
                $verified = Get-VHD -Path $disk.Path -ErrorAction Stop
                if ($verified.Size -eq $targetSize) {
                    Write-Log "Correcto: disco ampliado a $([math]::Round($verified.Size / 1GB)) GB: $($verified.Path)"
                    exit 0
                }
                throw 'La verificación posterior al redimensionamiento no coincidió con 200 GB.'
            }
            if ($vhd.Size -ge $targetSize) {
                Write-Log "No se requiere cambio: el disco ya mide $([math]::Round($vhd.Size / 1GB)) GB."
                exit 0
            }
        }

        Start-Sleep -Seconds 30
    } while ((Get-Date) -lt $deadline)

    throw 'Tiempo de espera agotado: la fusión no finalizó en seis horas.'
}
catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    exit 1
}
