# Dodo Screen Share - Windows Auto Setup & Provisioner
$ErrorActionPreference = "Continue"

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "🚀 DODO SCREEN SHARE - INICIALIZADOR PORTATIL" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""

$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# 1. Atualiza arquivos mais recentes do GitHub
Write-Host "[1/2] Verificando e baixando atualizações do GitHub..." -ForegroundColor Yellow
$desktopDir = Join-Path $baseDir "desktop"
if (-not (Test-Path $desktopDir)) { New-Item -ItemType Directory -Path $desktopDir -Force | Out-Null }

$files = @(
    "desktop/app.js",
    "desktop/main.js",
    "desktop/index.html",
    "desktop/style.css",
    "desktop/preload.cjs"
)

foreach ($f in $files) {
    try {
        $url = "https://raw.githubusercontent.com/itsnikotina/DodoScreenShare/main/$f"
        $dest = Join-Path $baseDir ($f -replace "/", "\")
        Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
    } catch {
        # Mantém versão local
    }
}
Write-Host "Código atualizado para a versão mais recente!" -ForegroundColor Green

# 2. Verifica ou baixa o Motor Electron Portátil Oficial (Zero Dependências)
$electronExe = Join-Path $baseDir "bin\electron\electron.exe"
if (-not (Test-Path $electronExe)) {
    Write-Host "[2/2] Baixando motor portátil gráfico (Apenas na 1ª vez, ~80MB)..." -ForegroundColor Yellow
    $binDir = Join-Path $baseDir "bin"
    if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir -Force | Out-Null }
    
    $zipPath = Join-Path $binDir "electron.zip"
    $electronUrl = "https://github.com/electron/electron/releases/download/v33.2.1/electron-v33.2.1-win32-x64.zip"
    
    Invoke-WebRequest -Uri $electronUrl -OutFile $zipPath -UseBasicParsing
    
    Write-Host "Descompactando motor portátil..." -ForegroundColor Yellow
    $targetElectron = Join-Path $binDir "electron"
    Expand-Archive -Path $zipPath -DestinationPath $targetElectron -Force
    
    Remove-Item -Force $zipPath -ErrorAction SilentlyContinue
    Write-Host "Motor portátil configurado com sucesso!" -ForegroundColor Green
}

# 3. Inicia o aplicativo diretamente pelo Electron
Write-Host ""
Write-Host "🚀 Iniciando Dodo Screen Share Desktop..." -ForegroundColor Green
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""

$mainJs = Join-Path $baseDir "desktop\main.js"
& $electronExe $mainJs

Write-Host "Aplicativo finalizado." -ForegroundColor Yellow
