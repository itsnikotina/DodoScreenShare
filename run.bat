@echo off
title Dodo Screen Share - Auto Launcher
cls
echo =====================================================
echo 🚀 DODO SCREEN SHARE - INICIALIZADOR AUTOMATICO
echo =====================================================

if exist .git (
  echo [1/3] Verificando e baixando atualizacoes do GitHub...
  git pull --rebase --autostash
)

if not exist node_modules (
  echo [2/3] Instalando dependencias necessarias...
  call npm install
)

echo [3/3] Iniciando Dodo Screen Share Desktop Host...
echo =====================================================
echo.

npx electron desktop/main.js
pause
