@echo off
setlocal
title Forno Dashboard - Launcher
cd /d "%~dp0"

REM ---------------------------------------------------------------------
REM start.bat -- Forno Dashboard (dashboard + pipeline PLC -> InfluxDB)
REM
REM Sobe, num so clique: InfluxDB, o pipeline que le o PLC e grava no
REM InfluxDB (plc-service), o icone de status na bandeja, e o
REM backend/frontend do dashboard. Abre o navegador no final.
REM
REM Cada etapa grava uma linha com hora exata em logs\start.log -- se
REM travar em algum ponto, esse arquivo mostra exatamente onde parou.
REM
REM Para ENCERRAR tudo, use stop.bat (nesta mesma pasta).
REM ---------------------------------------------------------------------

if not exist "%~dp0logs" mkdir "%~dp0logs"
set "LOGFILE=%~dp0logs\start.log"
echo.>>"%LOGFILE%"
echo ======================================================>>"%LOGFILE%"
echo [%date% %time%] Iniciando start.bat>>"%LOGFILE%"

REM --- Configuracao do InfluxDB: ajuste se for diferente na sua VM ---
set INFLUXDB_EXE=C:\influxdb3\influxdb3.exe
set INFLUXDB_DATA_DIR=C:\influxdb3\data
set INFLUXDB_NODE_ID=local01

REM --- 1) Dependencias do dashboard (Node), instala na primeira vez ---
echo [%date% %time%] Verificando node_modules do backend...>>"%LOGFILE%"
if not exist "backend\node_modules" (
  echo Instalando dependencias do backend pela primeira vez, aguarde...
  echo [%date% %time%] Instalando dependencias do backend - npm install...>>"%LOGFILE%"
  pushd backend
  call npm install >>"%LOGFILE%" 2>&1
  popd
  echo [%date% %time%] Backend: npm install concluido.>>"%LOGFILE%"
) else (
  echo [%date% %time%] Backend: node_modules ja existe, pulando install.>>"%LOGFILE%"
)

echo [%date% %time%] Verificando node_modules do frontend...>>"%LOGFILE%"
if not exist "frontend\node_modules" (
  echo Instalando dependencias do frontend pela primeira vez, aguarde...
  echo [%date% %time%] Instalando dependencias do frontend - npm install...>>"%LOGFILE%"
  pushd frontend
  call npm install >>"%LOGFILE%" 2>&1
  popd
  echo [%date% %time%] Frontend: npm install concluido.>>"%LOGFILE%"
) else (
  echo [%date% %time%] Frontend: node_modules ja existe, pulando install.>>"%LOGFILE%"
)

REM --- 2) InfluxDB: sobe se ainda nao estiver rodando ---
echo Verificando se o InfluxDB ja esta rodando na porta 8181...
echo [%date% %time%] Verificando se o InfluxDB ja esta rodando na porta 8181...>>"%LOGFILE%"
netstat -ano | findstr ":8181" | findstr "LISTENING" >nul
if %errorlevel%==0 (
    echo InfluxDB ja esta rodando. Pulando essa etapa.
    echo [%date% %time%] InfluxDB ja esta rodando - porta 8181 em uso. Pulando essa etapa.>>"%LOGFILE%"
) else (
    if not exist "%INFLUXDB_EXE%" (
        echo AVISO: nao encontrei o influxdb3.exe em "%INFLUXDB_EXE%".
        echo Ajuste a variavel INFLUXDB_EXE no topo deste arquivo, ou suba o InfluxDB manualmente.
        echo [%date% %time%] AVISO: influxdb3.exe nao encontrado em "%INFLUXDB_EXE%". InfluxDB NAO foi iniciado por este script.>>"%LOGFILE%"
    ) else (
        echo Iniciando InfluxDB...
        echo [%date% %time%] Iniciando InfluxDB - %INFLUXDB_EXE%...>>"%LOGFILE%"
        start "Forno Dashboard - InfluxDB" /min "%INFLUXDB_EXE%" serve --node-id %INFLUXDB_NODE_ID% --object-store file --data-dir "%INFLUXDB_DATA_DIR%"
        echo Aguardando o InfluxDB subir...
        echo [%date% %time%] Aguardando 5s o InfluxDB subir...>>"%LOGFILE%"
        timeout /t 5 >nul
        echo [%date% %time%] Espera de 5s concluida, seguindo em frente.>>"%LOGFILE%"
    )
)

REM --- 3) Pipeline PLC -> InfluxDB e icone de status (plc-service) ---
echo [%date% %time%] Verificando venv do plc-service...>>"%LOGFILE%"
if not exist "plc-service\venv\Scripts\python.exe" (
    echo AVISO: nao encontrei o ambiente virtual em "plc-service\venv".
    echo Pulando o pipeline PLC -^> InfluxDB. Veja plc-service\README.md para configura-lo.
    echo [%date% %time%] AVISO: plc-service\venv nao encontrado. Pipeline PLC -^> InfluxDB NAO foi iniciado.>>"%LOGFILE%"
) else (
    echo Iniciando pipeline PLC -^> InfluxDB...
    echo [%date% %time%] Iniciando pipeline PLC -^> InfluxDB...>>"%LOGFILE%"
    start "Forno Dashboard - PLC Pipeline" /min "%~dp0plc-service\venv\Scripts\python.exe" "%~dp0plc-service\plc_to_influx.py"

    echo Iniciando icone de status na bandeja...
    echo [%date% %time%] Iniciando icone de status na bandeja...>>"%LOGFILE%"
    start "" "%~dp0plc-service\venv\Scripts\pythonw.exe" "%~dp0plc-service\tray_status.py"
)

REM --- 4) Backend e frontend do dashboard ---
echo Iniciando backend...
echo [%date% %time%] Iniciando backend (npm start)...>>"%LOGFILE%"
start "Forno Dashboard - Backend" cmd /k "cd /d "%~dp0backend" && npm start"

echo Iniciando frontend...
echo [%date% %time%] Iniciando frontend (npm run dev)...>>"%LOGFILE%"
start "Forno Dashboard - Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo Aguardando o frontend subir...
echo [%date% %time%] Aguardando 6s o frontend subir...>>"%LOGFILE%"
timeout /t 6 /nobreak >nul

echo Abrindo o navegador...
echo [%date% %time%] Abrindo o navegador em http://localhost:3000 ...>>"%LOGFILE%"
start http://localhost:3000

echo.
echo Pronto! InfluxDB, o pipeline do PLC, o icone de status e o dashboard estao rodando.
echo Para ENCERRAR tudo de uma vez, rode stop.bat (nesta mesma pasta).
echo.
echo [%date% %time%] start.bat concluido.>>"%LOGFILE%"
pause
endlocal
