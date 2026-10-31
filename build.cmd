@echo off
rem APG Post-It: install packages, run the tests, and build the Windows installer.
setlocal
cd /d "%~dp0app"
if errorlevel 1 (
  echo Could not find the app folder next to build.cmd.
  goto :fail
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install the LTS version from https://nodejs.org/
  goto :fail
)
where cargo >nul 2>nul
if errorlevel 1 (
  echo Rust ^(cargo^) was not found. Install it from https://rustup.rs/
  goto :fail
)

echo [1/3] Installing packages...
call npm install
if errorlevel 1 goto :fail

echo [2/3] Running the tests...
call npm test
if errorlevel 1 (
  echo The tests failed, so no installer was built.
  goto :fail
)

echo [3/3] Building the installer. This takes several minutes...
call npm run tauri build
if errorlevel 1 goto :fail

echo.
echo Done. The installer is in:
echo   %CD%\src-tauri\target\release\bundle\nsis
if exist "src-tauri\target\release\bundle\nsis\" start "" "src-tauri\target\release\bundle\nsis"
endlocal
exit /b 0

:fail
echo.
echo The build stopped. Read the messages above.
pause
endlocal
exit /b 1
