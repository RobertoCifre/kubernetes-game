# EKS Quest 3.1 — solo el juego del navegador (un único HTML con los 66 niveles y las chuletas dentro).
# nginx SIN root (usuario 101, puerto 8080); el HTML es de root y de solo lectura.
#
# Construir (desde la carpeta raíz del proyecto):  docker build -f docker/Dockerfile -t eks-quest:3.1 .
# Ejecutar:   docker run -d --name eks-quest -p 8080:8080 --read-only --tmpfs /tmp eks-quest:3.1
# Abrir:      http://localhost:8080
FROM nginxinc/nginx-unprivileged:1.28-alpine

LABEL org.opencontainers.image.title="eks-quest" \
      org.opencontainers.image.version="3.1" \
      org.opencontainers.image.description="EKS Quest: browser game to learn Kubernetes (kubectl) and Amazon EKS — 66 levels, Spanish"

COPY --chmod=0444 docker/nginx-default.conf /etc/nginx/conf.d/default.conf
COPY --chmod=0444 eks-quest.html /usr/share/nginx/html/index.html

EXPOSE 8080
USER 101

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
