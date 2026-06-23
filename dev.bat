@echo off
echo === MedAlert Dev Recovery ===

echo [1/5] Reiniciando ADB daemon...
adb kill-server
timeout /t 2 /nobreak >nul
adb start-server

echo [2/5] Aguardando dispositivo...
adb wait-for-device

echo [3/5] Desbloqueando tela e configurando...
adb shell wm dismiss-keyguard
adb reverse tcp:8081 tcp:8081
adb shell settings put global stay_on_while_plugged_in 3

echo [4/5] Matando Metro antigo e iniciando...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8081" ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)

echo [5/5] Abrindo app...
adb shell am start -n com.medalert.app/.MainActivity

echo.
echo === Pronto! Iniciando Metro... ===
echo.
npx expo start --clear
