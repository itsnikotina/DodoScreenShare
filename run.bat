@echo off
title Dodo Screen Share - Inicializador
cd /d "%~dp0"

echo =====================================================
echo 🚀 Iniciando Dodo Screen Share...
echo =====================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"

if %ERRORLEVEL% NEQ 0 (
  echo.
  echo [AVISO] Ocorreu um problema ao executar. Pressione qualquer tecla para sair.
  pause
)
