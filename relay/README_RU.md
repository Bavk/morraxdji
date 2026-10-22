# Зачем нужен relay/

Это **не видеосервер**. Сервис на публичном VPS принимает WireGuard-пакеты от Android и Windows и маршрутизирует их внутри виртуальной подсети 10.77.0.0/24. API `relay.mjs` автоматически добавляет и удаляет peer-конфигурации из `wg set`, используя постоянный `peers.json` (восстанавливает peers при запуске API).

На VPS нет данных комнат и самих видеозаписей. Однако он является доверенным VPN-шлюзом: там могут быть видны открытые метаданные/HTTP-сигналинг внутри WireGuard.

См. корневой `README_RU.md` для инструкции по установке. Установка предполагает Ubuntu/Debian, root, Docker на VPS не нужен, нужен Node >=20 и DNS/HTTPS через Caddy. Скрипт не изменяет Caddyfile автоматически, чтобы не сломать другие сайты.

```bash
sudo bash install-relay-ubuntu.sh vpn.example.com
sudo systemctl status wg-quick@usc0
sudo systemctl status universal-stream-relay
sudo wg show usc0
```

Брандмауэр: UDP 51820, TCP 443, TCP 80 для сертификатов. Node API `127.0.0.1:8777` НЕ открывать отдельно.
