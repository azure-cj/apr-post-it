@echo off
rem APG Post-It: run the desktop app from source (development).
rem Needs Node.js LTS and Rust. Installs the app's packages on first run.
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Install the LTS version from https://nodejs.org/ and run this again.
  goto :fail
)

where cargo >nul 2>nul
if errorlevel 1 (
  echo Rust ^(cargo^) was not found.
  echo Install it from https://rustup.rs/ and run this again.
  echo Windows also needs the WebView2 runtime, which Windows 10 and 11 normally have:
  echo https://developer.microsoft.com/microsoft-edge/webview2/
  goto :fail
)

if not exist "node_modules\" (
  echo Installing packages. This happens once and takes a few minutes...
  call npm install
  if errorlevel 1 goto :fail
)

echo Starting APG Post-It. The first start compiles the Rust side and is slow.
call npm run tauri dev
if errorlevel 1 goto :fail
endlocal
exit /b 0

:fail
echo.
pause
endlocal
exit /b 1
