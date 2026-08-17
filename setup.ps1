# Dodo Screen Share - Windows Auto Setup & Provisioner
$ErrorActionPreference = "Continue"

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "🚀 DODO SCREEN SHARE - CONFIGURAÇÃO AUTOMÁTICA" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""

$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# 1. Verifica ou baixa Node.js Portátil
$nodeExe = Join-Path $baseDir "bin\node\node.exe"
$hasSystemNode = (Get-Command node -ErrorAction SilentlyContinue) -ne $null

if (-not $hasSystemNode -and -not (Test-Path $nodeExe)) {
    Write-Host "[1/4] Baixando ambiente portátil do Node.js (Apenas na 1ª vez)..." -ForegroundColor Yellow
    $binDir = Join-Path $baseDir "bin"
    if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir -Force | Out-Null }
    
    $zipPath = Join-Path $binDir "node.zip"
    $nodeUrl = "https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip"
    
    Invoke-WebRequest -Uri $nodeUrl -OutFile $zipPath -UseBasicParsing
    
    Write-Host "Descompactando ambiente..." -ForegroundColor Yellow
    $tempDir = Join-Path $binDir "temp"
    Expand-Archive -Path $zipPath -DestinationPath $tempDir -Force
    
    $extracted = Join-Path $tempDir "node-v20.18.0-win-x64"
    $targetNode = Join-Path $binDir "node"
    if (Test-Path $targetNode) { Remove-Item -Recurse -Force $targetNode }
    Move-Item -Path $extracted -Destination $targetNode -Force
    
    Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
    Remove-Item -Force $zipPath -ErrorAction SilentlyContinue
    Write-Host "Ambiente portátil pronto com sucesso!" -ForegroundColor Green
}

# Configura PATH do Node portátil
if (Test-Path $nodeExe) {
    $env:PATH = "$(Join-Path $baseDir 'bin\node');" + $env:PATH
}

# 2. Atualiza arquivos do repositório
Write-Host "[2/4] Verificando e baixando atualizações do GitHub..." -ForegroundColor Yellow
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
        # Mantém arquivo local se offline
    }
}
Write-Host "Código atualizado para a versão mais recente!" -ForegroundColor Green

# 3. Instala dependências se necessário
$electronExe = Join-Path $baseDir "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electronExe)) {
    Write-Host "[3/4] Configurando dependências do Electron (Apenas na 1ª vez)..." -ForegroundColor Yellow
    Set-Location $baseDir
    $npmPath = if (Test-Path "$baseDir\bin\node\npm.cmd") { "$baseDir\bin\node\npm.cmd" } else { "npm" }
    & $npmPath install --no-audit --no-fund
}

# 4. Inicia o aplicativo
Write-Host "[4/4] Iniciando Dodo Screen Share Desktop..." -ForegroundColor Green
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""

Set-Location $baseDir
$mainJs = Join-Path $baseDir "desktop\main.js"

if (Test-Path $electronExe) {
    & $electronExe $mainJs
} else {
    $nodeCmd = if (Test-Path $nodeExe) { $nodeExe } else { "node" }
    $cliJs = Join-Path $baseDir "node_modules\electron\cli.js"
    & $nodeCmd $cliJs $mainJs
}

Write-Host "Aplicativo finalizado." -ForegroundColor Yellow
