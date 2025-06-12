@echo off
echo Realizando reinício completo com limpeza de cache...
echo.

taskkill /f /im node.exe > nul 2>&1
timeout /t 2 /nobreak > nul

cd /d "%~dp0" || exit

echo Limpando cache...
rd /s /q .next > nul 2>&1
rd /s /q node_modules\.vite > nul 2>&1

echo Instalando dependências...
npm install

echo Iniciando servidor...
start "" "start-localhost.bat"

pause