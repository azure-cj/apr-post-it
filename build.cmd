@echo off
rem Builds APG Post-It and runs the tests. Needs the .NET 8 SDK (https://dotnet.microsoft.com/download/dotnet/8.0).
setlocal
cd /d "%~dp0"
dotnet --version >nul 2>&1 || (echo .NET 8 SDK not found. Install it from https://dotnet.microsoft.com/download/dotnet/8.0 && exit /b 1)
echo == Building ==
dotnet build APG.PostIt.sln -nologo -v q || exit /b 1
echo == Running tests ==
dotnet run --project tests\PostIt.Tests --no-build || exit /b 1
echo.
echo Done. Start the app with:  run.cmd
endlocal
