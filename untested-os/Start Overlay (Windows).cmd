@echo off
rem Starts TOTEM Overlay. The first time, it downloads the app's runtime (Electron 44.9.0,
rem about 120 MB) from GitHub and checks it against the SHA-256 Electron publishes.
rem Run it again while the overlay runs to open its settings.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-overlay-windows.ps1" %*
if errorlevel 1 pause
