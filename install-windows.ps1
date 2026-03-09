param(
    [string]$InstallDir = "$env:USERPROFILE\\.fugit-alpha\\bin",
    [switch]$WithSkill,
    [switch]$OverwriteSkill,
    [switch]$SkipRustInstall,
    [switch]$NoPathUpdate
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$CargoToml = Join-Path $RepoRoot "Cargo.toml"
$BinaryName = "fugit.exe"

if (-not (Test-Path $CargoToml)) {
    throw "Cargo.toml not found next to installer. Run this script from the fugit-alpha repository root."
}

function Ensure-Cargo {
    if (Get-Command cargo -ErrorAction SilentlyContinue) {
        return
    }

    if ($SkipRustInstall) {
        throw "cargo is not installed and -SkipRustInstall was provided."
    }

    Write-Host "[installer] cargo not found; installing Rust toolchain via rustup..."
    $rustupExe = Join-Path $env:TEMP "rustup-init.exe"
    Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile $rustupExe
    & $rustupExe -y --profile minimal --default-toolchain stable | Out-Null

    $cargoBin = Join-Path $env:USERPROFILE ".cargo\\bin"
    if (Test-Path $cargoBin) {
        $env:Path = "$cargoBin;$env:Path"
    }

    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        throw "Rust install finished but cargo is still unavailable in PATH. Restart PowerShell and try again."
    }
}

Ensure-Cargo

Write-Host "[installer] building fugit-alpha (binary: fugit)"
& cargo build --release --manifest-path $CargoToml
if ($LASTEXITCODE -ne 0) {
    throw "cargo build failed"
}

$BinarySource = Join-Path $RepoRoot "target\\release\\$BinaryName"
if (-not (Test-Path $BinarySource)) {
    throw "build succeeded but binary not found at $BinarySource"
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$BinaryDest = Join-Path $InstallDir $BinaryName
Copy-Item -Path $BinarySource -Destination $BinaryDest -Force

if (-not $NoPathUpdate) {
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ([string]::IsNullOrEmpty($userPath)) {
        $userPath = ""
    }
    if (-not $userPath.Split(';').Contains($InstallDir)) {
        $newPath = if ($userPath) { "$userPath;$InstallDir" } else { $InstallDir }
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Write-Host "[installer] added to User PATH: $InstallDir"
        Write-Host "[installer] restart your terminal to pick up PATH changes"
    }
}

if ($WithSkill) {
    Write-Host "[installer] installing bundled Codex skill..."
    $skillArgs = @("skill", "install-codex")
    if ($OverwriteSkill) {
        $skillArgs += "--overwrite"
    }
    & $BinaryDest $skillArgs
    if ($LASTEXITCODE -ne 0) {
        throw "skill installation failed"
    }
}

Write-Host "[installer] installed fugit to: $BinaryDest"
Write-Host "[installer] done"
