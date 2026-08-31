@echo off
chcp 65001 >nul
title Model Studio 公网隧道 (serveo)
cd /d "%~dp0"
echo ============================================
echo   MODEL STUDIO 公网隧道 启动中...
echo   固定域名: modelstudio.serveo.net (需已用 Google/GitHub 注册密钥)
echo   若尚未注册，将分配随机地址，请在输出中查看
echo   本机服务: http://localhost:3000/
echo   按 Ctrl+C 停止隧道
echo ============================================
echo.
ssh -i "%~dp0.serveo_key" -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R modelstudio:80:localhost:3000 serveo.net
echo.
echo 隧道已断开。
pause
