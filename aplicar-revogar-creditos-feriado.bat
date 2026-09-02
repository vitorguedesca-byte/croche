@echo off
chcp 65001 >nul
echo === Feriado nao gera credito de reposicao ===
echo.
echo Regra invertida em 02/09/2026. Antes, cancelar as aulas de um feriado dava
echo um credito de reposicao para cada mensalista. Agora nao da mais: a
echo mensalidade ja e calculada sobre os dias em que a escola abre, entao
echo creditar o feriado pagaria a aluna duas vezes pelo mesmo dia.
echo.
echo O servidor ja parou de criar esses creditos. Este script limpa os que
echo ficaram para tras e AINDA NAO FORAM USADOS. Credito ja gasto nao e tocado:
echo a aula de reposicao dele existe, e apaga-lo deixaria essa aula orfa.
echo.
cd /d "%~dp0backend"

echo --- 1 de 2: LISTANDO (nada e apagado nesta etapa) ---
echo.
call npx dotenv -e .env -- node scripts/revogar-creditos-feriado.mjs
echo.
echo ============================================================
echo Leia a lista acima. Sao creditos de alunas reais, e algumas
echo podem ja ter visto o credito no portal delas.
echo ============================================================
echo.
choice /c SN /m "Apagar esses creditos agora"
if errorlevel 2 goto :fim

echo.
echo --- 2 de 2: APAGANDO ---
call npx dotenv -e .env -- node scripts/revogar-creditos-feriado.mjs --apagar
echo.
echo === Concluido! Reinicie o backend. ===
goto :pausa

:fim
echo.
echo Nada foi apagado. Rode de novo quando quiser.

:pausa
pause
