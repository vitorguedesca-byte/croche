@echo off
chcp 65001 >nul
echo === Credito cuja aula de origem voltou para a agenda ===
echo.
echo O credito e a troca por uma aula que deixou de acontecer. Quando a aula
echo volta para a agenda da aluna (ela remarcou a mesma aula, ou a grade dela
echo foi remontada em lote), nao ha o que repor: ela ficaria com a aula E com o
echo direito de marcar outra.
echo.
echo O servidor ja parou de entregar esses creditos. Este script limpa os que
echo ficaram para tras e AINDA NAO FORAM USADOS. Credito ja gasto nao e tocado:
echo a aula de reposicao dele existe, e apaga-lo deixaria essa aula orfa.
echo.
cd /d "%~dp0backend"

echo --- 1 de 2: LISTANDO (nada e apagado nesta etapa) ---
echo.
call npx dotenv -e .env -- node scripts/revogar-creditos-aula-de-volta.mjs
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
call npx dotenv -e .env -- node scripts/revogar-creditos-aula-de-volta.mjs --apagar
echo.
echo === Concluido! Reinicie o backend. ===
goto :pausa

:fim
echo.
echo Nada foi apagado. Rode de novo quando quiser.

:pausa
pause
