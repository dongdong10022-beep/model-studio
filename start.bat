@echo off
chcp 65001 >nul
title Model Studio Server (Port 3000)
cd /d "%~dp0"
echo ============================================
echo   MODEL STUDIO 模特经纪网站 启动中...
echo   地址: http://localhost:3000/
echo   后台: http://localhost:3000/admin.html
echo   按 Ctrl+C 停止服务
echo ============================================
echo.
node server.js
echo.
echo 服务已停止。
pause
