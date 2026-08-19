@echo off
title DSH Launcher
cd /d %~dp0
start "" http://127.0.0.1:3090
node server.mjs
