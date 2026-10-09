@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo === Обновление сайта «Уникум» ===
git add -A
set /p MSG=Что изменили (Enter - "обновление"): 
if "%MSG%"=="" set MSG=обновление
git commit -m "%MSG%"
git push
echo.
echo Готово. Сайт обновится за 1-2 минуты.
pause
