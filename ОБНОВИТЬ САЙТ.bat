@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo === Обновление сайта «Уникум» ===
echo.
where git >nul 2>nul
if errorlevel 1 (
  echo Не найден Git. Установите его с https://git-scm.com/download/win
  echo и запустите этот файл ещё раз.
  pause
  exit /b
)
if not exist ".git" (
  echo Первый запуск: связываю папку с репозиторием на GitHub...
  git init -q
  git remote add origin https://github.com/rutasha2809-creator/CRM-UNIKUM.git
  git fetch -q origin main
  git reset -q origin/main
  git branch -M main
  git branch -q -u origin/main main
  echo Готово.
  echo.
)
git pull -q --rebase --autostash origin main
git add -A
set /p MSG=Что изменили (Enter - "обновление"):
if "%MSG%"=="" set MSG=обновление
git commit -m "%MSG%"
git push origin main
echo.
echo Готово. Сайт обновится за 1-2 минуты:
echo https://rutasha2809-creator.github.io/CRM-UNIKUM/
pause
