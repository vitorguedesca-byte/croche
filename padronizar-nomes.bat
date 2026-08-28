@echo off
chcp 65001 >nul
cd /d "%~dp0backend"

echo === Padronizacao de nomes de alunas ===
echo.
echo Corrige caixa (MARIA DA SILVA - Maria da Silva), espacos sobrando,
echo conectivos (da, de, dos), acento gravado errado no banco e caractere
echo estranho. O nome novo desce junto para as aulas e a lista de espera.
echo.
echo --- 1) Simulacao: o que mudaria ---
echo.
call node --env-file=.env scripts/padronizar-nomes.mjs

echo.
echo ==========================================================
echo Confira a lista acima.
echo   S = gravar as mudancas no banco (faz backup antes)
echo   N = sair sem mexer em nada
echo ==========================================================
set /p RESP="Gravar? (S/N): "
if /I not "%RESP%"=="S" goto :fim

echo.
echo --- 2) Gravando ---
call node --env-file=.env scripts/padronizar-nomes.mjs --aplicar

:fim
echo.
pause
