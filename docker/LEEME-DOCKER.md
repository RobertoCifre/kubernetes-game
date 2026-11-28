# Cluster en Llamas 3.7 en Docker

La imagen sirve **solo el juego del navegador**: un único HTML con los 76 niveles y las chuletas dentro.

- **Servidor:** nginx **sin root** (usuario 101, puerto 8080), imagen `nginxinc/nginx-unprivileged:1.28-alpine`.
- **Ficheros:** de root y de solo lectura; el contenedor funciona con todo su sistema de ficheros en solo lectura.
- **Cabeceras:** `Content-Security-Policy` estricta (el juego no carga nada de fuera), `nosniff`, `no-referrer`.

Es una **simulación**: no se conecta a AWS ni a ningún cluster. No necesita cuentas, claves ni kubectl.

## Arrancarlo

Desde la carpeta raíz del proyecto:

```bash
docker build -f docker/Dockerfile -t cluster-en-llamas:3.7.2 .
docker run -d --name cluster-en-llamas -p 8080:8080 --read-only --tmpfs /tmp cluster-en-llamas:3.7.2
# abre http://localhost:8080
```

O con Compose:

```bash
docker compose -f docker/docker-compose.yml up -d --build     # arrancar
docker compose -f docker/docker-compose.yml down              # parar y borrar el contenedor
```

**La partida (nivel y XP) se guarda en el navegador** (localStorage), no en el contenedor: borrar o actualizar la imagen no la pierde, y en otro navegador empiezas de cero (los niveles se desbloquean en orden).

## Llevarlo a otra máquina

| Opción | Qué copias | Qué necesita el otro PC |
|---|---|---|
| **A. Solo el HTML** | `cluster-en-llamas.html` (≈0,45 MB) | Un navegador. Funciona sin Internet, con doble clic |
| **B. Clonar el repositorio y construir** | `git clone` | Docker |
| **C. Imagen exportada** | `cluster-en-llamas-3.7.tar` (`docker save`) | Docker: `docker load -i cluster-en-llamas-3.7.tar` |

Para la C, en el PC de origen:

```bash
# imagen para Intel/AMD (amd64) y ARM (arm64: Mac con Apple Silicon, Raspberry Pi 4/5…)
docker buildx build --platform linux/amd64,linux/arm64 -f docker/Dockerfile -t cluster-en-llamas:3.7.2 --load .
docker save cluster-en-llamas:3.7.2 -o cluster-en-llamas-3.7.tar
```

Exportar las dos arquitecturas en un solo `.tar` necesita el almacén de imágenes de containerd (Docker Desktop lo trae activado en las versiones recientes). Si no lo tienes, quita `--platform` y exporta solo la de tu máquina.

## Práctica extra: desplegarlo en tu propio cluster

`k8s-cluster-en-llamas.yaml` despliega el juego en Kubernetes con 2 réplicas, un namespace con Pod Security `restricted`, usuario no-root, sin capabilities y con el sistema de ficheros en solo lectura (los temporales de nginx van a un `emptyDir`). Es un buen ejemplo de lo que enseñan los mundos 6 y 8.

```bash
# kind: carga la imagen local en el cluster
kind load docker-image cluster-en-llamas:3.7.2
# (en EKS: sube la imagen a ECR y usa su URI en lugar de cluster-en-llamas:3.7.2)
sed 's#<IMAGEN>#cluster-en-llamas:3.7.2#' docker/k8s-cluster-en-llamas.yaml | kubectl apply -f -
kubectl port-forward svc/cluster-en-llamas 8080:80 -n cluster-en-llamas       # y abre http://localhost:8080
```

⚠️ Subir la imagen a ECR (o a cualquier registro) crea recursos en tu cuenta. ECR cobra por GB almacenado; esta imagen pesa unas decenas de MB.
