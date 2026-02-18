@echo off
title NeoXten Evidence Pack Watcher
cd /d "%~dp0"
echo Starting Evidence Pack watcher. New packs will be ingested automatically.
echo Press Ctrl+C to stop.
node dist/cli/index.js packs watch
