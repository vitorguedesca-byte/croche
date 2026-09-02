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
echo === Disparando deploy no Easypanel (Backend + Frontend) ===
ssh croche-vps "curl -s 'http://localhost:3000/api/deploy/2cd5bbf421cbe92f76b24e2fa767869a1badd98eb05e528a?forceRebuild=true' && echo. && curl -s 'http://localhost:3000/api/deploy/12bb61c09c57c9767d1120613b117baa787c58b95afbfccf?forceRebuild=true'"

echo.
echo === Pronto! Sistema atualizado em http://187.127.45.111 ===
pause
