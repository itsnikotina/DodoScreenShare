@echo off
setlocal enabledelayedexpansion
title Dodo Screen Share - Inicializador 100%% Automatico
cls

echo =====================================================
echo 🚀 DODO SCREEN SHARE - INICIALIZADOR AUTOMATICO
echo =====================================================
echo.

:: 1. Verifica se existe Node.js no sistema ou se precisamos usar o Node Portatil
set "NODE_CMD=node"
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  if not exist "%~dp0bin\node\node.exe" (
    echo [1/4] Baixando ambiente portatil (Apenas na 1a vez)...
    powershell -Command "try { New-Item -ItemType Directory -Force -Path '%~dp0bin' | Out-Null; $zip = '%~dp0bin\node.zip'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object Net.WebClient).DownloadFile('https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip', $zip); Expand-Archive -Path $zip -DestinationPath '%~dp0bin\temp' -Force; Move-Item -Path '%~dp0bin\temp\node-v20.18.0-win-x64' -Destination '%~dp0bin\node' -Force; Remove-Item -Path '%~dp0bin\temp' -Recurse -Force; Remove-Item -Path $zip -Force; Write-Host 'Ambiente portatil pronto!' -ForegroundColor Green } catch { Write-Host 'Erro ao baixar ambiente: ' $_.Exception.Message -ForegroundColor Red; pause; exit 1 }"
  )
  set "PATH=%~dp0bin\node;%PATH%"
  set "NODE_CMD=%~dp0bin\node\node.exe"
)

:: 2. Atualiza os arquivos mais recentes do GitHub
where git >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  if exist "%~dp0.git" (
    echo [2/4] Atualizando codigo via Git...
    git pull --rebase --autostash >nul 2>nul
    goto check_deps
  )
)

echo [2/4] Baixando atualizacoes do GitHub automaticamente...
powershell -Command "try { if (!(Test-Path '%~dp0desktop')) { New-Item -ItemType Directory -Path '%~dp0desktop' | Out-Null }; (New-Object Net.WebClient).DownloadFile('https://raw.githubusercontent.com/itsnikotina/DodoScreenShare/main/desktop/app.js', '%~dp0desktop\app.js'); (New-Object Net.WebClient).DownloadFile('https://raw.githubusercontent.com/itsnikotina/DodoScreenShare/main/desktop/main.js', '%~dp0desktop\main.js'); (New-Object Net.WebClient).DownloadFile('https://raw.githubusercontent.com/itsnikotina/DodoScreenShare/main/desktop/index.html', '%~dp0desktop\index.html'); (New-Object Net.WebClient).DownloadFile('https://raw.githubusercontent.com/itsnikotina/DodoScreenShare/main/desktop/style.css', '%~dp0desktop\style.css'); (New-Object Net.WebClient).DownloadFile('https://raw.githubusercontent.com/itsnikotina/DodoScreenShare/main/desktop/preload.cjs', '%~dp0desktop\preload.cjs'); Write-Host 'Codigo atualizado com sucesso!' -ForegroundColor Green } catch { Write-Host 'Mantendo versao local.' -ForegroundColor Yellow }"

:check_deps
:: 3. Instala dependências (Electron) se ainda não existirem
if not exist "%~dp0node_modules\electron" (
  echo [3/4] Configurando motor grafico (Apenas na 1a vez)...
  call npm install --no-audit --no-fund
)

echo [4/4] Abrindo Dodo Screen Share...
echo =====================================================
echo.

call npx electron "%~dp0desktop\main.js"
if %ERRORLEVEL% NEQ 0 (
  pause
)
