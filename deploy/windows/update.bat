@echo off
setlocal enabledelayedexpansion

:: Update script for Windows
title Aster DEX Bot - Update

echo.
echo ^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=
echo    🔄 Aster DEX Bot - Windows Update
echo ^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=
echo.

:: Check if we're in the right directory
if not exist "..\..\package.json" (
    echo ❌ Run this script from the deploy\windows\ directory
    pause
    exit /b 1
)

if not exist "deploy.bat" (
    echo ❌ Run this script from the deploy\windows\ directory
    pause
    exit /b 1
)

:: Detect docker compose command
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

echo ✅ Docker Compose ready

:: Check if containers are running
for /f %%i in ('%DOCKER_COMPOSE% ps -q 2^>nul ^| find /c /v ""') do set RUNNING_CONTAINERS=%%i
if %RUNNING_CONTAINERS% gtr 0 (
    echo ⚠️  Bot is currently running
    echo    This will stop the bot temporarily during update
    echo.
    set /p confirm="Continue with update? [y/N]: "
    if /i not "!confirm!"=="y" (
        echo Update cancelled
        pause
        exit /b 0
    )

    echo.
    echo 🛑 Stopping containers...
    %DOCKER_COMPOSE% down
) else (
    echo ✅ No running containers
)

:: Go to project root
cd ..\..

:: Check git status
echo.
echo 📋 Checking git status...
git status >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ❌ Not a git repository
    pause
    exit /b 1
)

:: Show current branch
for /f "tokens=*" %%i in ('git branch --show-current') do set CURRENT_BRANCH=%%i
echo    Current branch: !CURRENT_BRANCH!

if not "!CURRENT_BRANCH!"=="main" (
    echo ⚠️  You're not on main branch
    set /p switch="Switch to main branch? [y/N]: "
    if /i "!switch!"=="y" (
        git checkout main
    )
)

:: Check for uncommitted changes
git diff-index --quiet HEAD -- >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ⚠️  You have uncommitted changes
    echo.
    git status --short
    echo.
    set /p stash="Stash changes and continue? [y/N]: "
    if /i "!stash!"=="y" (
        for /f "tokens=1-3" %%a in ('date /t') do set CURRENT_DATE=%%a %%b %%c
        for /f "tokens=1" %%a in ('time /t') do set CURRENT_TIME=%%a
        git stash push -m "Auto-stash before update !CURRENT_DATE! !CURRENT_TIME!"
        echo ✅ Changes stashed
    ) else (
        echo Update cancelled
        pause
        exit /b 0
    )
)

:: Update from remote
echo.
echo ⬇️  Pulling latest changes...
git fetch origin
git pull origin main
if %ERRORLEVEL% neq 0 (
    echo ❌ Git pull failed
    pause
    exit /b 1
)

echo ✅ Code updated

:: Go back to deploy\windows directory
cd deploy\windows

:: Rebuild and restart
echo.
echo 🔨 Rebuilding containers...
%DOCKER_COMPOSE% build --no-cache
if %ERRORLEVEL% neq 0 (
    echo ❌ Build failed
    pause
    exit /b 1
)

echo.
echo 🚀 Starting updated bot...
%DOCKER_COMPOSE% up -d
if %ERRORLEVEL% neq 0 (
    echo ❌ Failed to start
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
goto final_check

:volume_error
echo ❌ Volume mount issue detected

:final_check
%DOCKER_COMPOSE% ps | findstr "Up" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo.
    echo ✅ Bot updated and restarted successfully!
    echo.
    echo 📝 Logs: %DOCKER_COMPOSE% logs -f
    echo 📊 Status: %DOCKER_COMPOSE% ps
) else (
    echo ❌ Failed to start after update
    echo.
    echo Check logs: %DOCKER_COMPOSE% logs
    pause
    exit /b 1
)

echo.
echo Press any key to exit...
pause >nul
