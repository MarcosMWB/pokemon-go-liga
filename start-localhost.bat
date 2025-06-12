@echo off
echo Iniciando servidor local do Next.js...
echo.

cd /d "%~dp0" || exit
npm run dev

pause