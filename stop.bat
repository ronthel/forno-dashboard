@echo off
REM ---------------------------------------------------------------------
REM stop.bat -- Forno Dashboard
REM
REM Encerra tudo que o start.bat liga: InfluxDB, pipeline PLC -> InfluxDB,
REM icone de status, backend e frontend do dashboard.
REM
REM InfluxDB / PLC Pipeline / Backend / Frontend sao encerrados pelo
REM titulo da janela (definido pelo proprio start.bat, entao so afeta
REM essas janelas). O icone de status (tray_status.py) nao tem janela,
REM entao e identificado pelo nome do script rodando.
REM ---------------------------------------------------------------------

echo Parando InfluxDB, pipeline PLC -^> InfluxDB, backend e frontend...
taskkill /FI "WindowTitle eq Forno Dashboard - InfluxDB*" /T /F >nul 2>&1
taskkill /FI "WindowTitle eq Forno Dashboard - PLC Pipeline*" /T /F >nul 2>&1
taskkill /FI "WindowTitle eq Forno Dashboard - Backend*" /T /F >nul 2>&1
taskkill /FI "WindowTitle eq Forno Dashboard - Frontend*" /T /F >nul 2>&1

echo Parando icone de status na bandeja...
powershell -NoProfile -Command ^
  "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'tray_status\.py' } | ForEach-Object { Write-Host ('Encerrando PID ' + $_.ProcessId + ' (' + $_.Name + ')'); Stop-Process -Id $_.ProcessId -Force }"

echo.
echo Feito.
pause
