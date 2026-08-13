@echo off
setlocal
title Forno Dashboard - Launcher
cd /d "%~dp0"

if not exist "backend\node_modules" (
  echo Instalando dependencias do backend pela primeira vez, aguarde...
  pushd backend
  call npm install
  popd
)

if not exist "frontend\node_modules" (
  echo Instalando dependencias do frontend pela primeira vez, aguarde...
  pushd frontend
  call npm install
  popd
)

echo Iniciando backend...
start "Forno Dashboard - Backend" cmd /k "cd /d "%~dp0backend" && npm start"

echo Iniciando frontend...
start "Forno Dashboard - Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo Aguardando o frontend subir...
timeout /t 6 /nobreak >nul

echo Abrindo o navegador...
start http://localhost:3000

echo.
echo Pronto! O sistema deve abrir automaticamente no navegador.
echo Para ENCERRAR o sistema, feche as duas janelas de terminal:
echo   "Forno Dashboard - Backend" e "Forno Dashboard - Frontend"
echo.
pause
endlocal
