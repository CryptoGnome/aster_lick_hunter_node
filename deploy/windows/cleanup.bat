@echo off
setlocal enabledelayedexpansion

:: Clean removal script for Windows
title Aster DEX Bot - Cleanup

echo.
echo ^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=
echo    🧹 Aster DEX Bot - Windows Cleanup
echo ^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=^=
echo.

:: Detect docker compose command
docker compose version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    docker-compose version >nul 2>&1
    if %ERRORLEVEL% neq 0 (
        echo ⚠️  Docker Compose not found
        set DOCKER_COMPOSE=
    ) else (
        set DOCKER_COMPOSE=docker-compose
    )
) else (
    set DOCKER_COMPOSE=docker compose
)

:: Confirmation
echo This will remove:
echo • Docker containers
echo • Docker images
echo • Configuration files
echo • Trading data
echo.
set /p confirm="Are you sure? [y/N]: "

if /i not "%confirm%"=="y" (
    echo Cancelled
    pause
    exit /b 0
)

:: Stop and remove containers
if defined DOCKER_COMPOSE (
    echo.
    echo Stopping containers...
    %DOCKER_COMPOSE% down --volumes --remove-orphans >nul 2>&1
)

:: Remove images
echo Removing images...
for /f "tokens=*" %%i in ('docker images -q "*aster*" 2^>nul') do (
    docker rmi %%i >nul 2>&1
)

:: Remove files
echo Removing files...
if exist "config" rmdir /s /q "config"
if exist "data" rmdir /s /q "data"

echo.
echo ✅ Cleanup complete
echo.
echo Press any key to exit...
pause >nul
