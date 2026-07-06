@echo off
REM Deploy do Fios que Curam na VPS (187.127.45.111)
REM Uso: deploy.bat  (commite suas mudancas antes, ou ele envia o que ja esta commitado)
cd /d "%~dp0"

echo === Enviando codigo para o GitHub ===
git push origin main
if errorlevel 1 (
  echo ERRO no push. Verifique suas credenciais/commits.
  pause
  exit /b 1
)

echo.
echo === Rodando deploy na VPS ===
ssh croche-vps "/var/www/croche/deploy.sh"

echo.
echo === Pronto! Sistema atualizado em http://187.127.45.111 ===
pause
