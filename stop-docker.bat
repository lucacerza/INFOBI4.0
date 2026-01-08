@echo off
REM Stop Script per INFOBI 4.0 Docker
REM Uso: stop-docker.bat

echo.
echo ================================================
echo   INFOBI 4.0 - Docker Stop
echo ================================================
echo.

cd /d %~dp0

echo [INFO] Fermando i container...
docker-compose down

if errorlevel 1 (
    echo.
    echo [ERROR] Errore durante lo stop!
    pause
    exit /b 1
)

echo.
echo [OK] Tutti i container fermati!
echo.
echo Per riavviare usa: start-docker.bat
echo.
pause
