# EKS Quest 3.0 en Docker

La imagen sirve **solo el juego del navegador**: un único HTML con los 60 niveles y las chuletas dentro.

- **Servidor:** nginx **sin root** (usuario 101, puerto 8080), imagen `nginxinc/nginx-unprivileged:1.28-alpine`.
- **Ficheros:** de root y de solo lectura; el contenedor funciona con todo su sistema de ficheros en solo lectura.
- **Cabeceras:** `Content-Security-Policy` estricta (el juego no carga nada de fuera), `nosniff`, `no-referrer`.

Es una **simulación**: no se conecta a AWS ni a ningún cluster. No necesita cuentas, claves ni kubectl.

## Arrancarlo

Desde la carpeta raíz del proyecto:

```bash
docker build -f docker/Dockerfile -t eks-quest:3.0 .
docker run -d --name eks-quest -p 8080:8080 --read-only --tmpfs /tmp eks-quest:3.0
# abre http://localhost:8080
```

O con Compose:

```bash
docker compose -f docker/docker-compose.yml up -d --build     # arrancar
docker compose -f docker/docker-compose.yml down              # parar y borrar el contenedor
```

**La partida (nivel y XP) se guarda en el navegador** (localStorage), no en el contenedor: borrar o actualizar la imagen no la pierde, y en otro navegador empiezas de cero (puedes saltar a cualquier nivel con `nivel N`).

## Llevarlo a otra máquina

| Opción | Qué copias | Qué necesita el otro PC |
|---|---|---|
| **A. Solo el HTML** | `eks-quest.html` (≈0,45 MB) | Un navegador. Funciona sin Internet, con doble clic |
| **B. Clonar el repositorio y construir** | `git clone` | Docker |
| **C. Imagen exportada** | `eks-quest-3.0.tar` (`docker save`) | Docker: `docker load -i eks-quest-3.0.tar` |

Para la C, en el PC de origen:

```bash
# imagen para Intel/AMD (amd64) y ARM (arm64: Mac con Apple Silicon, Raspberry Pi 4/5…)
docker buildx build --platform linux/amd64,linux/arm64 -f docker/Dockerfile -t eks-quest:3.0 --load .
docker save eks-quest:3.0 -o eks-quest-3.0.tar
```

Exportar las dos arquitecturas en un solo `.tar` necesita el almacén de imágenes de containerd (Docker Desktop lo trae activado en las versiones recientes). Si no lo tienes, quita `--platform` y exporta solo la de tu máquina.

## Práctica extra: desplegarlo en tu propio cluster

`k8s-eks-quest.yaml` despliega el juego en Kubernetes con 2 réplicas, un namespace con Pod Security `restricted`, usuario no-root, sin capabilities y con el sistema de ficheros en solo lectura (los temporales de nginx van a un `emptyDir`). Es un buen ejemplo de lo que enseñan los mundos 6 y 8.

```bash
# kind: carga la imagen local en el cluster
kind load docker-image eks-quest:3.0
# (en EKS: sube la imagen a ECR y usa su URI en lugar de eks-quest:3.0)
sed 's#<IMAGEN>#eks-quest:3.0#' docker/k8s-eks-quest.yaml | kubectl apply -f -
kubectl port-forward svc/eks-quest 8080:80 -n eks-quest       # y abre http://localhost:8080
```

⚠️ Subir la imagen a ECR (o a cualquier registro) crea recursos en tu cuenta. ECR cobra por GB almacenado; esta imagen pesa unas decenas de MB.
