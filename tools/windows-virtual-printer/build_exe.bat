@echo off
setlocal
title Build Delivery Platform Virtual Printer

where py >nul 2>&1
if %ERRORLEVEL%==0 (
  set PY=py
) else (
  set PY=python
)

%PY% -m pip install --upgrade pyinstaller
if errorlevel 1 goto :error

%PY% -m PyInstaller ^
  --noconfirm ^
  --clean ^
  --onefile ^
  --windowed ^
  --name DeliveryPrinterInstaller ^
  delivery_virtual_printer.py

if errorlevel 1 goto :error

echo.
echo Build complete:
echo   dist\DeliveryPrinterInstaller.exe
echo.
pause
exit /b 0

:error
echo.
echo Build failed.
pause
exit /b 1
