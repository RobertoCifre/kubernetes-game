# Cluster en Llamas 3.7 — solo el juego del navegador (un único HTML con los 76 niveles y las chuletas dentro).
# nginx SIN root (usuario 101, puerto 8080); el HTML es de root y de solo lectura.
#
# Construir (desde la carpeta raíz del proyecto):  docker build -f docker/Dockerfile -t cluster-en-llamas:3.7.1 .
# Ejecutar:   docker run -d --name cluster-en-llamas -p 8080:8080 --read-only --tmpfs /tmp cluster-en-llamas:3.7.1
# Abrir:      http://localhost:8080
FROM nginxinc/nginx-unprivileged:1.28-alpine

LABEL org.opencontainers.image.title="cluster-en-llamas" \
      org.opencontainers.image.version="3.7" \
      org.opencontainers.image.description="Cluster en Llamas: browser game to learn Kubernetes (kubectl) and Amazon EKS — 76 levels, Spanish"

COPY --chmod=0444 docker/nginx-default.conf /etc/nginx/conf.d/default.conf
COPY --chmod=0444 cluster-en-llamas.html /usr/share/nginx/html/index.html

EXPOSE 8080
USER 101

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
