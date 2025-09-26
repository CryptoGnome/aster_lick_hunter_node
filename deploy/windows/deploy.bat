@echo off
setlocal enabledelayedexpansion

:: Simple Docker deployment for Windows
title Aster DEX Bot - Deploy

echo.
echo ^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=
echo    🚀 Aster DEX Bot - Windows Deploy
echo ^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=
echo.

:: Check Docker
where docker >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ❌ Docker not installed
    echo Install Docker Desktop: https://docs.docker.com/desktop/install/windows/
    pause
    exit /b 1
)

:: Check Docker Compose
docker compose version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    docker-compose version >nul 2>&1
    if %ERRORLEVEL% neq 0 (
        echo ❌ Docker Compose not found
        pause
        exit /b 1
    )
    set DOCKER_COMPOSE=docker-compose
) else (
    set DOCKER_COMPOSE=docker compose
)

echo ✅ Docker ready

:: Create directories for volumes
echo.
echo 📁 Creating volume directories...
if not exist "config" mkdir config
if not exist "data" mkdir data

if exist "config" if exist "data" (
    echo ✅ Volume directories created ^(config/, data/^)
) else (
    echo ❌ Failed to create volume directories
    pause
    exit /b 1
)

:: Configuration will be handled via web interface
echo ✅ Configuration will be handled via web interface

:: Network configuration (Windows = local only)
echo.
echo 🌐 Network Configuration
echo Windows deployment is configured for local access only
echo Dashboard will be available at: http://localhost:3000
echo.
set USE_NGINX=false

:: Build and start
echo.
echo 🔨 Building and starting containers...
%DOCKER_COMPOSE% down >nul 2>&1
%DOCKER_COMPOSE% build
if %ERRORLEVEL% neq 0 (
    echo ❌ Build failed
    pause
    exit /b 1
)

%DOCKER_COMPOSE% up -d bot
if %ERRORLEVEL% neq 0 (
    echo ❌ Failed to start container
    pause
    exit /b 1
)

:: Wait for services to be ready
echo.
echo ⏳ Waiting for services to be ready...

:: Wait up to 3 minutes for frontend to be ready
set TIMEOUT=180
set ELAPSED=0
set INTERVAL=5

:wait_loop
curl -s -f http://localhost:3000 >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo ✅ Frontend is ready!
    goto check_volumes
)

if %ELAPSED% geq %TIMEOUT% (
    echo.
    echo ⚠️  Frontend took longer than expected to start
    echo    Checking container status...
    goto check_volumes
)

echo|set /p="."
timeout /t %INTERVAL% >nul 2>&1
set /a ELAPSED=%ELAPSED%+%INTERVAL%
goto wait_loop

:check_volumes
:: Verify volumes are working
echo.
echo 🔍 Verifying volume mounts...
docker exec aster-bot test -d /app/config >nul 2>&1
if %ERRORLEVEL% neq 0 goto volume_error

docker exec aster-bot test -d /app/data >nul 2>&1
if %ERRORLEVEL% neq 0 goto volume_error

echo ✅ Volumes mounted correctly

:: Test write access
docker exec aster-bot touch /app/config/.test >nul 2>&1
if %ERRORLEVEL% equ 0 (
    docker exec aster-bot rm /app/config/.test >nul 2>&1
    echo ✅ Volume write access confirmed
) else (
    echo ⚠️  Volume write access issue
)
goto check_status

:volume_error
echo ❌ Volume mount issue detected

:check_status
:: Check status
%DOCKER_COMPOSE% ps | findstr "Up" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo.
    echo ✅ Bot deployed successfully!
    echo.
    echo 📊 Dashboard: http://localhost:3000
    echo.
    echo 🔧 Next steps:
    echo    • Visit http://localhost:3000/config to set API keys
    echo    • Bot runs in paper mode until configured
    echo 📝 Logs: %DOCKER_COMPOSE% logs -f
    echo 🛑 Stop: %DOCKER_COMPOSE% stop
) else (
    echo ❌ Failed to start
    %DOCKER_COMPOSE% logs
    pause
    exit /b 1
)

echo.
echo Press any key to exit...
pause >nul
