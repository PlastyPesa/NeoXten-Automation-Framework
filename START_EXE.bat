@echo off
title NeoXten Evidence Pack Watcher
cd /d "%~dp0"
if exist "dist\cli\index.exe" (
  dist\cli\index.exe packs watch
) else (
  echo EXE not built. Running with Node instead.
  node dist/cli/index.js packs watch
)
pause
