@echo off
title DSH Launcher
cd /d %~dp0
rem The API token lives in %USERPROFILE%\.dsh\launcher.token and survives restarts: the server
rem reuses it, so pages that are already open stay valid. Delete the file to rotate the token.
rem It reaches the page as a one-time ?t= query (sent only to this loopback server, scrubbed
rem from the address bar immediately); Edge's --app handoff drops #fragments, hence the query.
start "" /b node server.mjs
set "TOKENFILE=%USERPROFILE%\.dsh\launcher.token"
for /l %%i in (1,1,60) do (
  if exist "%TOKENFILE%" goto haveToken
  timeout /t 1 /nobreak >nul
)
echo 启动器没有在 60 秒内就绪,请看 .local\logs\ / launcher did not become ready in 60s; see .local\logs\
pause
exit /b 1
:haveToken
set /p DSHTOKEN=<"%TOKENFILE%"
start "" "http://127.0.0.1:3090/?t=%DSHTOKEN%"
echo DSH Launcher: http://127.0.0.1:3090/?t=%DSHTOKEN%
echo 关掉这个窗口就停止启动器 / closing this window stops the launcher
pause >nul
