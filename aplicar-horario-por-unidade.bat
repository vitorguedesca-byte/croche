@echo off
echo === Aplicar horário por unidade ===
cd /d "%~dp0backend"
echo Gerando cliente Prisma...
npx prisma generate
echo.
echo Pronto! Reinicie o backend para aplicar.
pause
