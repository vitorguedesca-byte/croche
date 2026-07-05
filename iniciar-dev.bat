@echo off
start "Backend - Fios que Curam" cmd /k "cd /d %~dp0backend && npm run dev"
timeout /t 2 >nul
start "Frontend - Fios que Curam" cmd /k "cd /d %~dp0frontend && npm run dev"
