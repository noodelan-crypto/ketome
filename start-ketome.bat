@echo off
title KetoMe
cd /d %~dp0
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download from https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies - first run only, please wait...
  call npm install
)
start "" http://localhost:5173
npm run dev
