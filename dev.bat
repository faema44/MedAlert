@echo off
echo === MedAlert Dev Recovery ===

echo [1/4] Reiniciando ADB daemon...
adb kill-server
timeout /t 2 /nobreak >nul
adb start-server

echo [2/4] Aguardando dispositivo...
adb wait-for-device

echo [3/4] Configurando reverse proxy...
adb reverse tcp:8081 tcp:8081

echo [4/4] Matando Metro antigo e iniciando...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8081" ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)

echo.
echo === Pronto! Iniciando Metro... ===
echo.
npx expo start --clear
