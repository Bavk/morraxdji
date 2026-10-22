# Universal Stream Control v0.15 — сборка на GitHub, пошагово

> **Обновление 22.10.2026:** исходники опубликованы в публичном репозитории [Bavk/morraxdji](https://github.com/Bavk/morraxdji). [GitHub Actions успешно собрал EXE и APK](https://github.com/Bavk/morraxdji/actions/runs/39785111844). Ссылки и ограничения приведены в [README](README.md) и [отчёте сборки](BUILD_RESULTS_v0.32.md). Ниже сохранена исходная инструкция для самостоятельного развёртывания нового репозитория.

## Что нужно

- Бесплатный аккаунт GitHub и доступ к интернету.
- Приватный репозиторий (`Private`), например `universal-stream-control`.
- Исходники этого архива и **все вложенные папки**, включая скрытую `.github/workflows`.
- Для первого запуска сборки **не нужны** Docker, VPS, ключи WireGuard, Android Studio, собственная лицензия Windows или сертификат подписи Windows. Для реальной трансляции Windows-пользователю понадобится WireGuard, а для разных провайдеров — настроенный VPN-ретранслятор.
- Для распространения в production позднее понадобятся постоянная подпись APK, политика обновления и по желанию подпись Windows EXE. GitHub собирает сейчас отладочный APK и неподписанный Windows EXE.

## 1. Создай приватный репозиторий

Открой https://github.com/new → Repository name: `universal-stream-control` → **Private** → **Create repository**. При создании пустого репозитория не добавляй README/.gitignore/license (они уже включены в наш исходный проект).

## 2. Загрузить проект правильно — через GitHub Desktop (проще)

1. Установи GitHub Desktop с официального сайта https://desktop.github.com/ и войди в аккаунт.
2. **File → Clone repository** → выбери созданный репозиторий → **Clone**.
3. Распакуй архив v0.15. Скопируй **содержимое** папки проекта (а не сам ZIP и не лишнюю папку уровнем выше) в локальную папку репозитория. В корне репозитория должны находиться файлы `README_RU.md`, `RUN_TESTS.sh`, `GITHUB_START_RU.md`, `.gitignore` и папки `.github`, `windows`, `android`, `server`, `relay`.
4. Убедись, что файл `.github/workflows/build-and-test.yml` присутствует. Windows может скрывать файлы/папки, имена которых начинаются с точки, но GitHub Desktop должен их видеть.
5. В GitHub Desktop в Summary напиши `Initial Universal Stream Control v0.15` → **Commit to main** → **Push origin**.
6. На сайте GitHub открой репозиторий и проверь наличие `.github/workflows/build-and-test.yml`.

**Альтернатива — Git CLI** (в папке распакованного проекта; замени ссылку на свою):

```powershell
git init
git branch -M main
git add .
git commit -m "Initial Universal Stream Control v0.15"
git remote add origin https://github.com/ВАШ_ЛОГИН/universal-stream-control.git
git push -u origin main
```

Для отправки Git через HTTPS потребуется настроенная авторизация (Git Credential Manager / браузер), не вводи пароль GitHub в команду.

## 3. Запуск автоматической сборки

1. Открой свой репозиторий → вкладка **Actions**.
2. Если GitHub просит разрешить Actions, разреши запуск рабочих процессов для этого репозитория.
3. Слева выбери **Test and build prototypes**.
4. Нажми **Run workflow** → branch `main` → **Run workflow**. (Сборка также стартует автоматически после `push` в `main`.)
5. Открой запуск и проверь три задания:
   - `Server, VPN and desktop logic tests` — исходники и быстрые тесты;
   - `Unsigned Windows NSIS installer` — настоящий Electron + дымовой тест окна + неподписанный EXE;
   - `Android debug APK` — компиляция Kotlin/Android и проверка debug-подписи.

Каждое задание, завершённое с красным крестиком, **не является собранным приложением**. Войди в задание и открой шаг с ошибкой; полный текст ошибки можно передать для исправления.

## 4. Как забрать EXE и APK

В успешном запуске Actions прокрути до **Artifacts**:

- `universal-stream-windows-unsigned` → ZIP с `.exe` и `SHA256SUMS.txt`;
- `universal-stream-operator-debug-apk` → ZIP с `.apk` и `SHA256SUMS.txt`.

Распакуй эти ZIP-файлы. EXE поставь на Windows, APK — на один тестовый Android-пульт. Проверить SHA-256 можно в PowerShell командой `Get-FileHash -Algorithm SHA256 .\имя-файла.exe` и сравнить с `SHA256SUMS.txt`.

Внимание: Windows может предупредить о неподписанном EXE; Android debug APK подписан **тестовым** ключом сборщика. Не распространяй этот APK как релиз: после новой сборки другим debug-ключом для обновления может потребоваться переустановка.

## 5. Что делать при ошибке

- `No workflows found`: убедись, что `.github/workflows/build-and-test.yml` загружен **в корень** ветки по умолчанию.
- `npm install`/`npm ci` fails: покажи log шага Install Electron dependencies.
- `Smoke test` fails: покажи лог `USC_ELECTRON_SMOKE_FAIL`.
- `gradle :app:assembleDebug` fails: покажи первые строки с `e: ...` / `What went wrong` и финальные 30–50 строк лога.
- `apksigner` fails: приложи вывод Verify Android APK package and debug signature.
- Нет Artifacts: проверь статус **всех** задач; GitHub загружает установщики только после успешной компиляции и проверок.

**Не присылай** VPN-ключи, пароли, private keys, коды операторов, `.env`, токены GitHub. В исходниках для CI ничего из этого не требуется.

## 6. Чего сборка GitHub НЕ делает

Наличие зелёной сборки не подтверждает, что Video/WebRTC, VPN и MediaProjection работают на конкретном пульте. Требуется тест с реальным Windows-ПК, сетью и Android-пультом, сначала в LAN, потом через VPN. Для эксплуатации на нескольких сетях нужен доступный из интернета VPN-шлюз при CG-NAT у Windows.
