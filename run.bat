@echo off
title Dodo Screen Share - Auto Launcher
cls
echo =====================================================
echo 🚀 DODO SCREEN SHARE - INICIALIZADOR AUTOMATICO
echo =====================================================

:: 1. Baixa atualizações sem precisar de Git
where git >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  if exist .git (
    echo [1/3] Atualizando via Git...
    git pull --rebase --autostash >nul 2>nul
  ) else (
    goto download_powershell
  )
) else (
  :download_powershell
  echo [1/3] Baixando ultimas atualizacoes diretamente do GitHub...
  powershell -Command "try { if (!(Test-Path desktop)) { New-Item -ItemType Directory -Path desktop | Out-Null }; Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/itsnikotina/DodoScreenShare/main/desktop/app.js' -OutFile 'desktop\app.js'; Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/itsnikotina/DodoScreenShare/main/desktop/main.js' -OutFile 'desktop\main.js'; Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/itsnikotina/DodoScreenShare/main/desktop/index.html' -OutFile 'desktop\index.html'; Write-Host 'Codigo atualizado com sucesso!' -ForegroundColor Green } catch { Write-Host 'Usando versao em cache.' -ForegroundColor Yellow }"
)

:: 2. Verifica se o Node.js está instalado
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo [AVISO] O Node.js nao foi encontrado no seu PC.
  echo Por favor, instale o Node.js (versao LTS gratuita) em: https://nodejs.org
  echo.
  pause
  exit /b
)

:: 3. Instala dependências se necessário
if not exist node_modules (
  echo [2/3] Configurando dependencias na primeira vez...
  call npm install
)

echo [3/3] Abrindo Dodo Screen Share...
echo =====================================================
echo.

call npx electron desktop/main.js
pause
