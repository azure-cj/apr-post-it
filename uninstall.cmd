@echo off
rem Removes APG Post-It from this PC: the new desktop app, its saved data and
rem key, and what the old C# prototype left behind. It never touches this
rem source folder, the Google sheets or Drive.
setlocal EnableExtensions
title Uninstall APG Post-It

echo.
echo  This removes APG Post-It from this PC:
echo    - the installed desktop app (if it is installed)
echo    - its settings and saved data
echo    - the key saved for it in Windows Credential Manager
echo    - the old prototype's data in %LOCALAPPDATA%\APG.PostIt
echo.
echo  Your Google sheets, Drive and this source folder are NOT touched.
echo  You will need your web app link and key to sign in again.
echo.
choice /c YN /n /m " Uninstall APG Post-It? [Y/N] "
if errorlevel 2 (echo. & echo  Nothing was removed. & goto :end)

echo.
echo == Closing the app if it is open ==
taskkill /im "APG Post-It.exe" /f >nul 2>&1
taskkill /im "apg-post-it.exe" /f >nul 2>&1
taskkill /im "APG.PostIt.exe" /f >nul 2>&1
rem Give Windows a moment to release the files.
timeout /t 2 /nobreak >nul

echo == Removing the installed app ==
set "UNINSTALLER="
for %%R in (HKCU HKLM) do (
  for /f "tokens=2,*" %%A in ('reg query "%%R\Software\Microsoft\Windows\CurrentVersion\Uninstall\APG Post-It" /v UninstallString 2^>nul ^| find "UninstallString"') do set "UNINSTALLER=%%B"
)
if not defined UNINSTALLER if exist "%LOCALAPPDATA%\APG Post-It\uninstall.exe" set "UNINSTALLER="%LOCALAPPDATA%\APG Post-It\uninstall.exe""
if defined UNINSTALLER (
  echo    Running the app's own uninstaller...
  call %UNINSTALLER% /S
  timeout /t 3 /nobreak >nul
  echo    Done.
) else (
  echo    Not installed - skipped.
)

echo == Removing saved data ==
call :remove "%APPDATA%\com.alphapremier.apgpostit"
call :remove "%LOCALAPPDATA%\com.alphapremier.apgpostit"
call :remove "%LOCALAPPDATA%\APG Post-It"
call :remove "%LOCALAPPDATA%\APG.PostIt"

echo == Removing the saved key ==
cmdkey /delete:"key.APG Post-It" >nul 2>&1 && (echo    Removed.) || (echo    None saved - skipped.)

echo.
if exist "%USERPROFILE%\Downloads\APG Post-It" (
  echo  Photos the app downloaded are in:
  echo    %USERPROFILE%\Downloads\APG Post-It
  choice /c YN /n /m " Delete those photos too? [Y/N] "
  if not errorlevel 2 call :remove "%USERPROFILE%\Downloads\APG Post-It"
)

echo.
echo  APG Post-It has been uninstalled.
goto :end

:remove
if exist "%~1" (
  rmdir /s /q "%~1" 2>nul
  if exist "%~1" (echo    Could not remove %~1 - close any open files there and run this again.) else (echo    Removed %~1)
) else (
  echo    Not found: %~1
)
exit /b 0

:end
echo.
pause
endlocal
