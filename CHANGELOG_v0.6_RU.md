# Изменения Universal Stream Control v0.6

Дата: 22 октября 2026.

- Windows: команда установки туннеля WireGuard как системной службы с UAC, без импорта в GUI.
- Windows: сетевой preflight TCP 3100,7880,7881 и UDP 7882 до запуска Docker.
- Windows: диагностика HTTPS API VPN-шлюза и регистрации Windows-пира.
- VPN relay: защищённый endpoint GET /v1/status; совместимый со старым форматом peers.json.
- Android: кнопка вставки кода USCV1 из буфера обмена; объявление foreground service mediaProjection.
- Тесты: добавлены проверки занятости TCP/UDP-портов, формирования команды WireGuard, статусов шлюза. 15 успешных Node.js тестов.

Обратите внимание: в этом архиве исходники, а не готовые APK/EXE; не проводились тесты на физическом оборудовании. Для работы из разных сетей всё ещё требуется настроенный VPS и однократная установка Docker Desktop и WireGuard на Windows.
