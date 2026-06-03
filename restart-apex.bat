@echo off
:loop
echo.
echo ============================================
echo  APEX Trader BTC - Auto-Restart Guardian
echo ============================================
cd /d "C:\Users\lath1\OneDrive\Desktop\apex-trader-btc"
echo Starting APEX Trader (npm run dev)...
npm run dev
echo.
echo [!] Server crashed or exited. Restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto loop
