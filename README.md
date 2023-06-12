# Lider SFU server

A WebRTC SFU server of Lider system

## How to run

1. Generate cert file and key file to start https server

```
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes
```

2. Add directory of these file to env
   <br>
   Example:

```
HTTPS_CERT_FILE=/cert.pem

HTTPS_KEY_FILE=/key.pem
```
