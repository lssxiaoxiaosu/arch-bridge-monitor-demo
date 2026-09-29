@echo off
chcp 65001 >nul
title 拱桥智能监测平台 原型Demo
cd /d %~dp0
echo 正在启动本地演示服务...
start "" http://localhost:8090/
py -m http.server 8090
