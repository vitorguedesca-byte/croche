@echo off
echo Aplicando migration do PIN...
cd /d %~dp0backend
mysql -u root -panaevitor fios_que_curam -e "ALTER TABLE Client ADD COLUMN IF NOT EXISTS pin VARCHAR(255) NULL;"
echo Regenerando Prisma Client...
npx prisma generate
echo Migracao concluida! Reinicie o backend.
pause
