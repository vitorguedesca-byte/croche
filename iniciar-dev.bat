@echo off
title Fios que Curam - Inicializador Dev
echo ===================================================
echo   Iniciando ambiente de desenvolvimento...
echo ===================================================

REM Encerra processos Node presos nas portas 4000 e 5173 caso existam
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 4000, 5173 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" 2>nul

echo [1/2] Iniciando Backend na porta 4000...
start "Backend - Fios que Curam" cmd /k "cd /d %~dp0backend && npm run dev"

timeout /t 3 >nul

echo [2/2] Iniciando Frontend na porta 5173...
start "Frontend - Fios que Curam" cmd /k "cd /d %~dp0frontend && npm run dev"

timeout /t 2 >nul
echo Abrindo navegador em http://localhost:5173...
start http://localhost:5173

echo.
echo ===================================================
echo   Sistema iniciado! Acesse: http://localhost:5173
echo ===================================================
