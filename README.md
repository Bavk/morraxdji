# Universal Stream Control v0.15

**Русская документация:** [README_RU.md](README_RU.md).

**Сборка EXE и APK через GitHub Actions:** [GITHUB_START_RU.md](GITHUB_START_RU.md).

**Первое испытание на оборудовании:** [FIRST_REAL_RUN_RU.md](FIRST_REAL_RUN_RU.md).

## Готовые сборки v0.15

GitHub Actions успешно собрал обе платформы: [запуск 39764243154](https://github.com/Bavk/morraxdji/actions/runs/39764243154).

- [Windows EXE — NSIS установщик](https://github.com/Bavk/morraxdji/actions/runs/39764243154/artifacts/12418939147)
- [Android APK со встроенным WireGuard](https://github.com/Bavk/morraxdji/actions/runs/39764243154/artifacts/12419138538)

Артефакты скачиваются как ZIP вместе с SHA256SUMS.txt; для скачивания может потребоваться вход в GitHub. Срок хранения — 30 дней. Новая сборка запускается при push в main или вручную через Actions.

EXE без цифровой подписи, APK подписан отладочным ключом. Windows одновременно запускает локальный видеосервер и просмотр; LiveKit встроен в EXE и работает без Docker/WSL2; для VPN нужен WireGuard для Windows. Для подключения через интернет требуется настроенный VPN-ретранслятор. На Android WireGuard встроен в APK, отдельное приложение не требуется.

Проверены 66 автоматических тестов, запуск интерфейса Electron, упаковка серверных модулей, формат EXE, пакет и подпись APK, контрольные суммы и наличие нативных библиотек WireGuard для четырёх архитектур. Перед эксплуатацией требуется испытание трансляции и VPN на реальных пультах: [результаты сборки](BUILD_RESULTS_v0.15.md).

**Windows без Docker:** [актуальная инструкция](WINDOWS_NATIVE_RU.md). При сборке запускается настоящий встроенный LiveKit и проверяются операции комнат, остановка и перезапуск.
