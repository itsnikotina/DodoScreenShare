@echo off
title Dodo Screen Share - Inicializador
cd /d "%~dp0"

echo =====================================================
echo 🚀 Iniciando Dodo Screen Share...
echo =====================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"

echo.
echo =====================================================
echo Janela finalizada. Pressione qualquer tecla para fechar.
pause
