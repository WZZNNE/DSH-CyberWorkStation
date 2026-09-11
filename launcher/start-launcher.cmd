@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
title DSH Launcher
rem Resolve against the invocation directory before changing cwd.
set "DSH_RESOLVED_HOME="
set "DSH_HOME_RESOLVED_OK="
set "DSH_HOME_HELPER=%~dp0home-paths.mjs"
for /f "delims=" %%H in ('node -e "import(require('node:url').pathToFileURL(process.env.DSH_HOME_HELPER).href).then(m=>console.log(m.normalizeDshHome()))" ^&^& echo DSH_HOME_RESOLVED_OK') do (
  if "%%H"=="DSH_HOME_RESOLVED_OK" (set "DSH_HOME_RESOLVED_OK=1") else set "DSH_RESOLVED_HOME=%%H"
)
if not defined DSH_HOME_RESOLVED_OK exit /b 1
if not defined DSH_RESOLVED_HOME exit /b 1
set "DSH_HOME=%DSH_RESOLVED_HOME%"
cd /d "%~dp0"
rem The API token lives in DSH_HOME (default USERPROFILE\.dsh) and survives restarts: the server
rem reuses it, so pages that are already open stay valid. Delete the file to rotate the token.
rem It reaches the page as a one-time ?t= query (sent only to this loopback server, scrubbed
rem from the address bar immediately); Edge's --app handoff drops #fragments, hence the query.
start "" /b node server.mjs
call node launcher-open.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
echo 关掉这个窗口就停止启动器 / closing this window stops the launcher
pause >nul
