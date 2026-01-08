@echo off
REM Quick Start Script per INFOBI 4.0 con Docker
REM Uso: start-docker.bat

echo.
echo ================================================
echo   INFOBI 4.0 - Docker Quick Start
echo   BiGrid Multi-Level Pivot Included!
echo ================================================
echo.

REM Verifica che Docker sia installato
docker --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker non trovato!
    echo.
    echo Installa Docker Desktop da: https://www.docker.com/products/docker-desktop
    echo.
    pause
    exit /b 1
)

REM Verifica che docker-compose sia disponibile
docker-compose --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] docker-compose non trovato!
    echo.
    pause
    exit /b 1
)

echo [OK] Docker installato
echo.

REM Vai alla directory del progetto
cd /d %~dp0

REM Controlla se i container sono già in esecuzione
docker-compose ps | findstr "Up" >nul 2>&1
if not errorlevel 1 (
    echo [INFO] I container sono gia in esecuzione.
    echo.
    echo Vuoi riavviarli? (S/N)
    set /p restart=
    if /i "%restart%"=="S" (
        echo.
        echo [INFO] Riavvio container...
        docker-compose down
        echo.
    ) else (
        echo.
        echo [INFO] Usa i container esistenti.
        goto :show_urls
    )
)

echo [INFO] Avvio Docker containers...
echo.
echo Questo potrebbe richiedere alcuni minuti al primo avvio.
echo.

REM Avvia i container
docker-compose up --build -d

if errorlevel 1 (
    echo.
    echo [ERROR] Errore durante l'avvio dei container!
    echo.
    echo Controlla i log con: docker-compose logs
    echo.
    pause
    exit /b 1
)

echo.
echo [OK] Container avviati con successo!
echo.

REM Attendi che i servizi siano pronti
echo [INFO] Attendo che i servizi siano pronti...
timeout /t 5 /nobreak >nul

:show_urls
echo.
echo ================================================
echo   INFOBI 4.0 is RUNNING!
echo ================================================
echo.
echo Frontend:  http://localhost:3000
echo Backend:   http://localhost:8001
echo API Docs:  http://localhost:8001/docs
echo Cache:     localhost:6379
echo.
echo ================================================
echo   Test BiGrid Multi-Level Pivot:
echo ================================================
echo.
echo 1. Apri http://localhost:3000
echo 2. Login
echo 3. Vai a Reports
echo 4. Apri un report
echo 5. Clicca "Pivot Avanzato" (blu/viola)
echo 6. Trascina MULTIPLI campi in Colonne!
echo.
echo ================================================
echo.
echo Comandi utili:
echo   - Logs:    docker-compose logs -f
echo   - Stop:    docker-compose down
echo   - Restart: docker-compose restart
echo.
echo Premi un tasto per vedere i logs (CTRL+C per uscire)...
pause >nul

echo.
echo [INFO] Apertura logs...
docker-compose logs -f
