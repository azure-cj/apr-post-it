@echo off
rem Starts APG Post-It (builds first if needed).
cd /d "%~dp0"
dotnet run --project src\PostIt.App
