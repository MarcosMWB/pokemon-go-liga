@echo off
echo Reiniciando servidor local...
echo.

taskkill /f /im node.exe > nul 2>&1
timeout /t 2 /nobreak > nul

cd /d "%~dp0" || exit
start "" "start-localhost.bat"

echo Servidor reiniciado com sucesso!
pause