# Cluster en Llamas — los 76 niveles (especificación y solucionario)

> ⚠️ **SPOILERS.** Este documento tiene las soluciones. Úsalo solo cuando te atasques de verdad, o para repasar después de jugar.
> Es también la **especificación** del juego del navegador (`cluster-en-llamas.html`): mismos niveles, mismos nombres, mismas comprobaciones. Las soluciones usan comandos reales de `kubectl` y `aws`, así que casi todas valen igual en un cluster de verdad (los avisos «⚠️ En EKS real» dicen dónde cambia algo).

## Reglas comunes

- Cada nivel trabaja en su namespace `nivel-N`. Excepciones: el 9 crea `mi-equipo` y el 28 usa también `nivel-28-api`.
- Al preparar un nivel, el juego **borra los namespaces `nivel-*` de otros niveles** para liberar sitio en el nodo, y **deja el cluster en estado base**:
  - nodos sin cordon;
  - sin los taints ni las labels del juego (`mantenimiento`, `hardware`);
  - CoreDNS con 2 réplicas.
- **Puntos:** 100 XP por nivel. Cada pista resta 20. Ver la solución deja el nivel en 0 XP. Repetir un nivel no suma dos veces. Máximo: 7.600 XP. Todos los niveles están abiertos: se recomienda ir en orden, pero se puede saltar a cualquiera con `nivel N`.
- **Rangos por XP:**

  | Rango | Desde |
  |---|---|
  | 🐣 Becario de Kubernetes | 0 |
  | 📦 Junior de pods | 300 |
  | 🔧 Operador de cluster | 900 |
  | 🛠️ Administrador EKS | 2.000 |
  | 🚒 SRE de guardia | 3.300 |
  | 🔬 Cirujano de contenedores | 4.600 |
  | 👑 Maestro EKS | 6.000 |
  | 🎓 Listo para la CKA | 7.300 |

  Al cruzar cada umbral, el juego avisa del ascenso y dice cuántos XP faltan para el siguiente (también con `rango`).
- **Tipos de nivel:**
  - **misión**: se comprueba el estado del cluster al instante (o con `comprobar`).
  - **pregunta**: se contesta con `responder <valor>`, sin distinguir mayúsculas ni el punto final. Algunas aceptan variantes (lo indica cada nivel).
- **Imágenes usadas.** Todas existen en Docker Hub (comprobado el 27/11/2026):
  - `nginx:1.25-alpine`, `1.26-alpine`, `1.27-alpine` y `1.28-alpine`;
  - `busybox:1.37`, `polinux/stress` y `nginxinc/nginx-unprivileged:1.28-alpine`;
  - `registry.k8s.io/pause:3.10` (nivel 64).

  Los niveles de averías usan a propósito tres nombres que **no** existen: `nginx:9.99-noexiste`, `ngnix:1.27-alpine`, `nginx:1.99-alpine` y `nginx:1.27-alpne`.
- **Requisitos de los niveles con varios nodos:**
  - El **43** necesita añadir un nodo: subir el node group.
  - El **46** y el **53** necesitan 2 nodos: el juego los pone él.
  - En un EKS real, al acabarlos vuelve a 1 nodo: cada t3.medium cuesta dinero mientras está encendido.

---

## MUNDO 1 · Primeros pasos

Los seis primeros niveles solo piden **mirar**: aprender a leer el cluster con `get` y `describe`, y que cada nivel vive en su namespace `nivel-N` (por eso los comandos llevan `-n nivel-N`).

### 1 · Tu primer kubectl · *pregunta*
- **Preparación:** Deployment `hola` en `nivel-1`.
- **Misión:** ¿Cómo se llama el Deployment que hay en `nivel-1`?
- **Respuesta:** `hola`
- **Solución:** `kubectl get deployments -n nivel-1`
- **Pistas:**
  1. `kubectl get deployments -n nivel-1`.
  2. Prueba sin `-n`: «No resources found in default namespace».
  3. El nombre es la columna NAME.
- **Aprendes:** `kubectl get <tipo> -n <namespace>`; sin `-n` se usa `default`.

### 2 · ¿Y el Pod? · *pregunta*
- **Preparación:** Deployment `saludo` (1 réplica) en `nivel-2`.
- **Misión:** ¿Cómo se llama el Pod que ha creado `saludo`?
- **Respuesta:** el nombre completo del Pod (`saludo-<hash>-<sufijo>`, distinto en cada partida).
- **Solución:** `kubectl get pods -n nivel-2` y copiar el nombre.
- **Pistas:**
  1. `kubectl get pods -n nivel-2`.
  2. El nombre del Pod es el del Deployment más dos trozos aleatorios.
  3. Cópialo entero.
- **Aprendes:** los Pods los crea el Deployment (a través de un ReplicaSet); si uno muere, el nuevo tiene otro nombre.

### 3 · La puerta de entrada · *pregunta*
- **Preparación:** Deployment `web` y Service `entrada` (selector `app=web`) en `nivel-3`.
- **Misión:** ¿Cómo se llama el Service?
- **Respuesta:** `entrada`
- **Solución:** `kubectl get svc -n nivel-3`
- **Pistas:**
  1. `kubectl get services -n nivel-3`.
  2. Abreviado: `svc`.
  3. El Service no tiene por qué llamarse como el Deployment.
- **Aprendes:** el Service es la dirección fija delante de los Pods; se le llama por su nombre.

### 4 · ¿Qué imagen usa? · *pregunta*
- **Preparación:** Deployment `tienda` con `nginx:1.26-alpine` en `nivel-4`.
- **Misión:** ¿Qué imagen usa `tienda`?
- **Respuesta:** `nginx:1.26-alpine`
- **Solución:** `kubectl describe deployment tienda -n nivel-4` (línea `Image:`) o `kubectl get deploy -n nivel-4 -o wide`.
- **Pistas:**
  1. `kubectl describe deployment tienda -n nivel-4` → `Image:`.
  2. `kubectl get deploy -n nivel-4 -o wide` → columna IMAGES.
  3. Lleva nombre y tag separados por `:`.
- **Aprendes:** `describe` da el detalle; `-o wide` añade columnas; el tag es la versión de la imagen.

### 5 · ¿Por qué puerto entro? · *pregunta*
- **Preparación:** Deployment `api` (nginx en el 80) y Service `api` con `port: 8080`, `targetPort: 80`, en `nivel-5`.
- **Misión:** ¿En qué puerto escucha el Service `api`?
- **Respuesta:** `8080`
- **Solución:** `kubectl get svc -n nivel-5` → columna PORT(S).
- **Pistas:**
  1. `kubectl get svc -n nivel-5`.
  2. `8080/TCP` = puerto 8080, protocolo TCP.
  3. `describe svc` enseña también el TargetPort.
- **Aprendes:** `port` (el del Service) y `targetPort` (el del contenedor) no tienen por qué coincidir.

### 6 · Cuenta las copias · *pregunta*
- **Preparación:** Deployment `contador` con 4 réplicas en `nivel-6`.
- **Misión:** ¿Cuántos Pods tiene `contador`?
- **Respuesta:** `4`
- **Solución:** `kubectl get deploy -n nivel-6` (READY 4/4) o contar con `kubectl get pods -n nivel-6`.
- **Pistas:**
  1. `kubectl get deploy -n nivel-6`: READY x/y.
  2. O cuéntalos con `get pods`.
  3. `kubectl get pods -n nivel-6 --no-headers | wc -l`.
- **Aprendes:** READY = listos / pedidos; el Deployment repone los Pods que faltan.

### 7 · Reconocimiento del terreno · *pregunta*
- **Misión:** ¿Cuántos Pods como máximo admite tu nodo? (lo que Kubernetes llama «allocatable pods»)
- **Respuesta:** `.status.allocatable.pods` del primer nodo de `kubectl get nodes`. En un t3.medium es **17**.
- **Pistas:**
  1. `kubectl get nodes` y apunta el nombre.
  2. `kubectl describe node <nombre>` y busca «Allocatable».
  3. t3.medium: 3 ENIs × (6−1) IPs + 2 = ?
- **Aprendes:** en EKS el máximo de Pods por nodo lo marca la red (VPC CNI: IPs por tarjeta de red), no la CPU ni la RAM.

### 8 · ¿Dónde vive tu nodo? · *pregunta*
- **Misión:** ¿En qué zona de disponibilidad está tu nodo? Si hay varios, el primero de `kubectl get nodes`.
- **Respuesta:** la label `topology.kubernetes.io/zone` del primer nodo (`eu-west-1a`).
- **Pistas:**
  1. Los nodos llevan labels que pone EKS: `kubectl get nodes --show-labels`.
  2. `kubectl get nodes -L topology.kubernetes.io/zone` la saca como columna.
  3. También sale en `kubectl describe node <nodo>`, en Labels.
- **Aprendes:** la zona importa: un volumen EBS solo se puede montar en su zona, y se reparten réplicas entre zonas para sobrevivir a la caída de una.

### 9 · Tu propio espacio · *misión*
- **Misión:** Crea un namespace llamado `mi-equipo`.
- **Se supera cuando:** existe el namespace `mi-equipo`.
- **Solución:** `kubectl create namespace mi-equipo`
- **Pistas:**
  1. `kubectl get namespaces` muestra los que hay.
  2. `kubectl create namespace --help`.
  3. `kubectl create namespace mi-equipo`.
- **Aprendes:** un namespace separa nombres, permisos y cuotas. **No** aísla la red: para eso están las NetworkPolicies (nivel 50).

### 10 · Tu primer despliegue · *misión*
- **Misión:** En `nivel-10` crea:
  - un Deployment `web` con la imagen `nginx:1.27-alpine` y 3 réplicas;
  - un Service `web` (puerto 80) que apunte a ellas.
- **Se supera cuando:** `web` tiene la imagen exacta y 3/3 listos, y el Service `web` tiene 3 endpoints.
- **Solución:**
  ```bash
  kubectl create deployment web --image=nginx:1.27-alpine --replicas=3 -n nivel-10
  kubectl expose deployment web --port=80 -n nivel-10
  ```
- **Pistas:**
  1. `kubectl create deployment … --image=… --replicas=… -n nivel-10`.
  2. El puerto va en el Service: `kubectl expose deployment web --port=80 -n nivel-10`.
  3. Comprueba con `kubectl get deploy,svc,endpoints -n nivel-10`.
- **Aprendes:** el Deployment mantiene N copias y el Service les da una IP y un nombre estables.

### 11 · Más copias · *misión*
- **Preparación:** Deployment `contador` (`nginx:1.27-alpine`, 1 réplica).
- **Misión:** Escala `contador` a 5 réplicas listas.
- **Se supera cuando:** `spec.replicas=5` y hay 5 listas.
- **Solución:** `kubectl scale deployment contador --replicas=5 -n nivel-11`
- **Pistas:**
  1. `kubectl get deploy -n nivel-11`.
  2. `kubectl scale --help`.
  3. `kubectl scale deployment contador --replicas=5 -n nivel-11`.
- **Aprendes:** cambias el estado **deseado** y el ReplicaSet crea los Pods que faltan. Si borras uno, vuelve a crearlo.

### 12 · Etiquetas · *pregunta*
- **Preparación:** tres Deployments.

  | Deployment | Réplicas | Labels del Pod | Imagen |
  |---|---|---|---|
  | `api` | 2 | `app=api, tier=backend` | `nginx:1.27-alpine` |
  | `worker` | 1 | `app=worker, tier=backend` | `busybox:1.37` (`sleep 3600`) |
  | `web` | 2 | `app=web, tier=frontend` | `nginx:1.27-alpine` |
- **Misión:** ¿Cuántos Pods de `nivel-12` tienen la etiqueta `tier=backend`?
- **Respuesta:** **3**
- **Pistas:**
  1. `kubectl get pods -n nivel-12 --show-labels`.
  2. Filtra con `-l tier=backend`.
  3. Para contar: `kubectl get pods -n nivel-12 -l tier=backend --no-headers | wc -l`.
- **Aprendes:** las labels y los selectors son el "pegamento" de Kubernetes: Services, Deployments y NetworkPolicies eligen Pods por labels.

### 13 · Mensaje en los logs · *pregunta*
- **Preparación:** Deployment `emisor` (`busybox:1.37`). Al arrancar escribe `Código de acceso: K8S-7319` y después se queda dormido.
- **Misión:** ¿Cuál es el código de acceso que escribe `emisor` en sus logs?
- **Respuesta:** **K8S-7319**
- **Pistas:**
  1. `kubectl get pods -n nivel-13`.
  2. `kubectl logs <pod> -n nivel-13`.
  3. Sin buscar el nombre del Pod: `kubectl logs deploy/emisor -n nivel-13`.
- **Aprendes:** `kubectl logs` muestra la salida estándar del contenedor. Si el contenedor murió, usa `--previous`.

---

## MUNDO 2 · Pods que no arrancan

### 14 · La imagen fantasma · *misión*
- **Preparación:** Deployment `api` (contenedor `api`, imagen `nginx:9.99-noexiste`, 1 réplica).
- **Misión:** El Deployment `api` no arranca nunca. Haz que tenga 1 réplica lista, sin borrarlo.
- **Se supera cuando:** `api` tiene 1/1 lista.
- **Solución** (cualquiera de las dos):
  - `kubectl set image deployment/api api=nginx:1.27-alpine -n nivel-14`
  - `kubectl edit deployment api -n nivel-14` y cambiar `image:`.
- **Pistas:**
  1. `kubectl get pods -n nivel-14`: ¿qué STATUS ves?
  2. `kubectl describe pod <pod> -n nivel-14` y lee los Events.
  3. La etiqueta (tag) no existe: `kubectl set image deployment/api api=nginx:1.27-alpine -n nivel-14`, o `kubectl edit`.
- **Aprendes:** `ErrImagePull` es el primer fallo de descarga; `ImagePullBackOff` es Kubernetes esperando cada vez más entre reintentos.

### 15 · Error tipográfico · *misión*
- **Preparación:** Deployment `tienda` (contenedor `tienda`, imagen `ngnix:1.27-alpine`, 2 réplicas).
- **Misión:** Los Pods de `tienda` no consiguen descargar su imagen. Arréglalo.
- **Se supera cuando:** la imagen es del repositorio `nginx` y hay 2/2 listas.
- **Solución:** `kubectl set image deployment/tienda tienda=nginx:1.27-alpine -n nivel-15`
- **Pistas:**
  1. `kubectl describe pod … -n nivel-15`: «pull access denied, repository does not exist».
  2. Lee el nombre de la imagen letra a letra.
  3. `ngnix` → `nginx`: `kubectl set image deployment/tienda tienda=nginx:1.27-alpine -n nivel-15`.
- **Aprendes:** si el **repositorio** no existe, el error dice "does not exist or may require authorization". Si no existe el **tag**, dice "not found".

### 16 · Falta la configuración · *misión*
- **Preparación:** Deployment `app` (`busybox:1.37`). La variable `MENSAJE` sale del ConfigMap `app-config` (clave `MENSAJE`), que **no existe**.
- **Misión:** El Deployment `app` no arranca. Averigua qué le falta y dáselo SIN tocar el Deployment.
- **Se supera cuando:** `app` tiene 1/1 lista.
- **Solución:** `kubectl create configmap app-config --from-literal=MENSAJE=hola -n nivel-16`
- **Pistas:**
  1. STATUS `CreateContainerConfigError`.
  2. `describe pod`: ¿qué ConfigMap y qué clave busca?
  3. `kubectl create configmap app-config --from-literal=MENSAJE=hola -n nivel-16`.
- **Aprendes:** `CreateContainerConfigError` casi siempre significa que falta un ConfigMap o Secret, o una de sus claves.

### 17 · Falta el secreto · *misión*
- **Preparación:** Deployment `bd-cliente` (`busybox:1.37`, `sleep 3600`). La variable `DB_PASSWORD` sale del Secret `db-cred` (clave `password`), que no existe.
- **Misión:** `bd-cliente` necesita una contraseña que nadie le ha dado. Dásela (inventa una) sin tocar el Deployment.
- **Se supera cuando:** `bd-cliente` tiene 1/1 lista.
- **Solución:** `kubectl create secret generic db-cred --from-literal=password=MiClave123 -n nivel-17`
- **Pistas:**
  1. Igual que el nivel 16, pero con un Secret.
  2. `kubectl create secret generic --help`.
  3. `kubectl create secret generic db-cred --from-literal=password=lo-que-quieras -n nivel-17`.
- **Aprendes:** los Secrets se usan igual que los ConfigMaps. En el nivel 35 verás que no están "cifrados".

### 18 · El devorador de RAM · *misión*
- **Preparación:** Deployment `tragon` (`polinux/stress`, `--vm 1 --vm-bytes 150M --vm-hang 1`). Requests: memoria 64Mi, CPU 50m. Limits: memoria 100Mi.
- **Misión:** `tragon` se reinicia sin parar. Descubre por qué muere y arréglalo cambiando SOLO sus recursos.
- **Se supera cuando:** `tragon` está listo y no se reinicia durante 30 s (en el navegador: límite > 155Mi).
- **Solución:** `kubectl set resources deployment tragon --limits=memory=256Mi -n nivel-18`, o con `kubectl edit`.
- **Pistas:**
  1. `describe pod`: «Last State: Terminated, Reason: ???, Exit Code: 137».
  2. Intenta usar ~150 MB y su límite es 100Mi: el kernel lo mata (OOMKilled).
  3. `kubectl set resources deployment tragon --limits=memory=256Mi -n nivel-18`.
- **Aprendes:** superar `limits.memory` = OOMKilled (137). La CPU no mata: se estrangula (*throttling*).

### 19 · Variable olvidada · *misión*
- **Preparación:** Deployment `procesador` (`busybox:1.37`). Al arrancar comprueba la variable `MODO`: si no vale `normal` ni `debug`, escribe `ERROR: falta la variable de entorno MODO (valores válidos: normal o debug)` y sale con código 1.
- **Misión:** `procesador` arranca y muere una y otra vez. Lee qué le pasa y haz que arranque.
- **Se supera cuando:** está listo y `MODO` vale `normal` o `debug`.
- **Solución:** `kubectl set env deployment/procesador MODO=normal -n nivel-19`
- **Pistas:**
  1. `kubectl logs <pod> -n nivel-19 --previous` (lo que dijo antes de morir).
  2. Las variables de entorno se cambian con `kubectl set env`.
  3. `kubectl set env deployment/procesador MODO=normal -n nivel-19`.
- **Aprendes:** CrashLoopBackOff con Exit Code 1 = la aplicación decidió salir. **Los logs son lo primero que hay que mirar.**

### 20 · Comando equivocado · *misión*
- **Preparación:** Deployment `reloj` (`busybox:1.37`, `command: ["slep","3600"]`).
- **Misión:** `reloj` no llega ni a arrancar su proceso. Encuentra el error y corrígelo.
- **Se supera cuando:** `reloj` tiene 1/1 lista.
- **Solución:** `kubectl edit deployment reloj -n nivel-20` → `command: ["sleep","3600"]`, o:
  ```bash
  kubectl patch deployment reloj -n nivel-20 --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/command","value":["sleep","3600"]}]'
  ```
- **Pistas:**
  1. `describe pod`: «executable file not found in $PATH».
  2. Mira el campo `command` con `kubectl get deploy reloj -n nivel-20 -o yaml`.
  3. `kubectl edit deployment reloj -n nivel-20` y corrige `slep` → `sleep`.
- **Aprendes:** `StartError`/`RunContainerError` = el contenedor ni siguiera pudo lanzar su proceso (comando inexistente, permisos…).

### 21 · Atasco en el scheduler · *misión*
- **Preparación:** Deployment `gigante` (`nginx:1.27-alpine`). Requests: CPU 64 (más de lo que tiene casi cualquier nodo), memoria 64Mi.
- **Misión:** El Pod de `gigante` no sale de Pending. Haz que arranque en los nodos que ya tienes, sin añadir nodos.
- **Se supera cuando:** `gigante` está 1/1 y no se han añadido nodos.
- **Solución:** `kubectl set resources deployment gigante --requests=cpu=100m -n nivel-21`
- **Pistas:**
  1. `describe pod`: «0/1 nodes are available: 1 Insufficient cpu».
  2. Pide 64 CPUs; tu nodo tiene ~1,9 allocatable (`describe node`).
  3. `kubectl set resources deployment gigante --requests=cpu=100m -n nivel-21`.
- **Aprendes:** el scheduler coloca Pods según **requests**, no según el uso real. Pending + Insufficient = no cabe.

### 22 · Memoria imposible · *misión*
- **Preparación:** Deployment `analitica` (`nginx:1.27-alpine`). Requests: memoria 16Gi, CPU 50m.
- **Misión:** `analitica` se queda en Pending. Haz que arranque sin añadir nodos.
- **Se supera cuando:** `analitica` está 1/1.
- **Solución:** `kubectl set resources deployment analitica --requests=memory=64Mi -n nivel-22`
- **Pistas:**
  1. `describe pod`: «Insufficient memory».
  2. Un t3.medium tiene 4 GiB, y ~3,2 allocatable.
  3. `kubectl set resources deployment analitica --requests=memory=64Mi -n nivel-22`.
- **Aprendes:** CPU y memoria se planifican igual. Pedir de más deja nodos "llenos" aunque estén ociosos.

---

## MUNDO 3 · Tráfico y salud

### 23 · Nadie contesta al teléfono · *misión*
- **Preparación:** Deployment `tienda` (`nginx:1.27-alpine`, 2 réplicas, `app=tienda`). Service `tienda` con selector `app=tiendaa`.
- **Misión:** Los Pods de `tienda` están perfectos, pero el Service no les manda tráfico. Haz que tenga endpoints.
- **Se supera cuando:** el Service `tienda` tiene 2 endpoints.
- **Solución** (cualquiera de las dos):
  - `kubectl set selector service tienda app=tienda -n nivel-23`
  - `kubectl edit svc tienda -n nivel-23`
- **Pistas:**
  1. `kubectl get endpoints tienda -n nivel-23` devuelve `<none>`.
  2. Compara `kubectl get svc tienda -o wide` con `kubectl get pods --show-labels`.
  3. `kubectl set selector service tienda app=tienda -n nivel-23`.
- **Aprendes:** un Service sin endpoints casi siempre es un selector que no casa con las labels de los Pods.

### 24 · Puerto equivocado · *misión*
- **Preparación:** Deployment `web` (nginx, 2 réplicas; escucha en el 80). Service `web` con `port: 80` y `targetPort: 8080`.
- **Misión:** El Service `web` tiene endpoints, pero nadie le responde. Compruébalo con:
  ```bash
  kubectl run prueba --rm -it --image=busybox:1.37 -n nivel-24 -- wget -qO- -T 3 http://web
  ```
  Y arréglalo.
- **Se supera cuando:** `targetPort` vale 80 y hay endpoints.
- **Solución:** `kubectl edit svc web -n nivel-24` y poner `targetPort: 80`, o:
  ```bash
  kubectl patch svc web -n nivel-24 -p '{"spec":{"ports":[{"port":80,"targetPort":80}]}}'
  ```
- **Pistas:**
  1. `kubectl describe svc web`: mira TargetPort.
  2. nginx escucha en el 80 (`kubectl describe pod` → Port).
  3. `kubectl edit svc web -n nivel-24` y cambia `targetPort: 8080` por `80`.
- **Aprendes:**
  - `port` es donde escucha el Service; `targetPort`, donde escucha el contenedor.
  - Los endpoints existen aunque el puerto esté mal: tener endpoints no garantiza que funcione.

### 25 · Nunca está listo · *misión*
- **Preparación:** Deployment `portal` (nginx, 2 réplicas). `readinessProbe` con `httpGet path /salud port 80`, que da 404.
- **Misión:** Los Pods de `portal` están Running pero 0/1 READY y el Service no les manda tráfico. Arréglalo.
- **Se supera cuando:** `portal` tiene 2/2 listos.
- **Solución:** `kubectl edit deployment portal -n nivel-25` → `path: /`
- **Pistas:**
  1. `describe pod`: «Readiness probe failed: HTTP probe failed with statuscode: 404».
  2. nginx solo responde en `/`.
  3. `kubectl edit deployment portal -n nivel-25` y cambia `path: /salud` por `path: /`.
- **Aprendes:** readiness decide si el Pod **recibe tráfico**. Si falla, no se reinicia: sale de los endpoints.

### 26 · Reinicios misteriosos · *misión*
- **Preparación:** Deployment `vigia` (nginx, 1 réplica). `livenessProbe` con `httpGet / port 8080`, `initialDelaySeconds 5`, `periodSeconds 5`, `failureThreshold 2`.
- **Misión:** `vigia` funciona… un rato. Luego Kubernetes lo reinicia, una y otra vez. Descubre por qué y arréglalo.
- **Se supera cuando:** el puerto de la liveness es 80 y el Pod está listo sin reiniciarse durante 30 s.
- **Solución:** `kubectl edit deployment vigia -n nivel-26` → liveness `port: 80`
- **Pistas:**
  1. RESTARTS sube; en `describe pod` busca «Liveness probe failed».
  2. «connection refused» en el puerto 8080, pero nginx escucha en el 80.
  3. `kubectl edit deployment vigia -n nivel-26` y pon la liveness en `port: 80`.
- **Aprendes:** liveness decide si el contenedor sigue **vivo**: si falla, el kubelet lo mata y lo reinicia. Una liveness mal hecha tumba aplicaciones sanas.

### 27 · La web secreta · *pregunta*
- **Preparación:**
  - ConfigMap `boveda-html` con `index.html` = `<h1>Código: PF-4096</h1>`.
  - Deployment `boveda` (nginx) que lo monta en `/usr/share/nginx/html`.
  - Service `boveda` (ClusterIP 80), sin acceso desde fuera.
- **Misión:** El Service `boveda` sirve una página con un código, pero no tiene acceso desde fuera del cluster. ¿Cuál es el código?
- **Respuesta:** **PF-4096**
- **Pistas:**
  1. `kubectl port-forward` abre un túnel desde tu PC hasta el Service.
  2. `kubectl port-forward svc/boveda 8080:80 -n nivel-27`.
  3. Con el port-forward abierto (en el navegador del juego queda activo; en tu terminal, en otra ventana): `curl http://localhost:8080`.
- **Aprendes:** `port-forward` es la forma segura de probar algo interno sin publicarlo en Internet.

### 28 · Vecinos lejanos · *misión*
- **Preparación:**
  - En `nivel-28-api`: Deployment `catalogo` (nginx) y Service `catalogo` (80).
  - En `nivel-28`: Deployment `tienda-web` (`busybox:1.37`, `sleep 3600`) con la variable `API_URL=http://catalogo`. Su readiness es `sh -c 'wget -qO- -T 2 "$API_URL" > /dev/null'`.
- **Misión:** `tienda-web` (en `nivel-28`) no llega al catálogo, que vive en otro namespace (`nivel-28-api`). Arregla su configuración para que lo encuentre.
- **Se supera cuando:** `tienda-web` tiene 1/1 lista.
- **Solución:** `kubectl set env deployment/tienda-web API_URL=http://catalogo.nivel-28-api -n nivel-28`
- **Pistas:**
  1. El nombre corto `catalogo` solo se resuelve dentro del mismo namespace.
  2. Formato: `<servicio>.<namespace>` (o el nombre completo `.svc.cluster.local`).
  3. `kubectl set env deployment/tienda-web API_URL=http://catalogo.nivel-28-api -n nivel-28`.
- **Aprendes:** el DNS de Kubernetes busca primero en tu namespace (`search` en `/etc/resolv.conf`). Para otro namespace hay que nombrarlo.

### 29 · Nombre completo · *pregunta*
- **Preparación:** Deployment y Service `pagos` (nginx).
- **Misión:** ¿Cuál es el nombre DNS completo (FQDN) del Service `pagos`?
- **Respuesta:** **pagos.nivel-29.svc.cluster.local** (se acepta con o sin punto final).
- **Pistas:**
  1. Formato: `<servicio>.<namespace>.svc.<dominio-del-cluster>`.
  2. `kubectl run dns --rm -it --image=busybox:1.37 -n nivel-29 -- cat /etc/resolv.conf`.
  3. `kubectl run dns --rm -it --image=busybox:1.37 -n nivel-29 -- nslookup pagos`.
- **Aprendes:** el dominio por defecto es `cluster.local`. Con el FQDN llegas a cualquier Service desde cualquier namespace.

### 30 · Ábrete al mundo · *misión* (en AWS crea un balanceador real, unos 0,03 $/h)
- **Preparación:** Deployment `escaparate` (nginx).
- **Misión:** Publica `escaparate` en Internet con un Service `escaparate` de tipo LoadBalancer en el puerto 80, y compruébalo con `curl`.
- **Se supera cuando:** el Service es de tipo LoadBalancer, tiene hostname y responde por HTTP. Al superarlo, el juego borra el Service para que deje de costar.
- **Solución:**
  ```bash
  kubectl expose deployment escaparate --type=LoadBalancer --port=80 -n nivel-30
  kubectl get svc -n nivel-30 -w     # esperar EXTERNAL-IP
  curl http://<hostname>
  ```
- **Pistas:**
  1. `kubectl expose … --type=LoadBalancer`.
  2. `kubectl get svc -n nivel-30 -w` hasta que EXTERNAL-IP deje de ser `<pending>`.
  3. En EKS, el DNS y los health checks del ELB tardan 2-4 min.
- **Aprendes:**
  - `type: LoadBalancer` hace que AWS cree un balanceador, que cuesta mientras exista.
  - En producción se usa el AWS Load Balancer Controller (ALB/NLB).

---

## MUNDO 4 · Actualizaciones y configuración

### 31 · Nueva versión · *misión*
- **Preparación:** Deployment `web` (`nginx:1.27-alpine`, 3 réplicas).
- **Misión:** Actualiza `web` a `nginx:1.28-alpine` sin cortar el servicio, y comprueba que el despliegue ha terminado.
- **Se supera cuando:** la imagen es 1.28-alpine, hay 3/3 actualizados y listos, y no quedan Pods viejos.
- **Solución:**
  ```bash
  kubectl set image deployment/web nginx=nginx:1.28-alpine -n nivel-31
  kubectl rollout status deployment/web -n nivel-31
  ```
  El contenedor se llama `nginx`, como lo crea `kubectl create deployment`.
- **Pistas:**
  1. El contenedor se llama `nginx`: míralo en `kubectl describe deploy web`.
  2. `kubectl set image deployment/web nginx=nginx:1.28-alpine -n nivel-31`.
  3. `kubectl rollout status deployment/web -n nivel-31` espera a que termine.
- **Aprendes:** el rolling update crea Pods nuevos antes de quitar los viejos (`maxSurge`/`maxUnavailable`): cero cortes.

### 32 · Despliegue roto · *misión*
- **Preparación:** Deployment `web` (`nginx:1.27-alpine`, 3 réplicas) actualizado a `nginx:1.99-alpine`, que no existe. Los Pods viejos siguen sirviendo y hay uno nuevo en `ImagePullBackOff`.
- **Misión:** Alguien ha desplegado una versión rota de `web`. Vuelve a la versión que funcionaba.
- **Se supera cuando:** la imagen es `nginx:1.27-alpine`, hay 3/3 listos y ningún Pod falla.
- **Solución:** `kubectl rollout undo deployment/web -n nivel-32`
- **Pistas:**
  1. `kubectl rollout status deployment/web -n nivel-32` se queda esperando.
  2. Fíjate en que los Pods viejos **siguen funcionando**: el rolling update protege.
  3. `kubectl rollout undo deployment/web -n nivel-32`.
- **Aprendes:**
  - Un despliegue roto no tumba el servicio, gracias al rolling update.
  - `rollout undo` vuelve a la revisión anterior al instante.

### 33 · Viaje en el tiempo · *misión*
- **Preparación:** Deployment `app` con 3 revisiones. Cada una lleva la anotación `kubernetes.io/change-cause`.

  | Revisión | Imagen | change-cause |
  |---|---|---|
  | 1 | `nginx:1.25-alpine` | «versión inicial 1.25» |
  | 2 | `nginx:1.26-alpine` | «actualizo a 1.26» |
  | 3 | `nginx:1.27-alpine` | «actualizo a 1.27» |
- **Misión:** Vuelve `app` exactamente a su PRIMERA revisión.
- **Se supera cuando:** la imagen es `nginx:1.25-alpine` y está listo.
- **Solución:**
  ```bash
  kubectl rollout history deployment/app -n nivel-33
  kubectl rollout undo deployment/app --to-revision=1 -n nivel-33
  ```
- **Pistas:**
  1. `kubectl rollout history deployment/app -n nivel-33`.
  2. `undo` sin más vuelve solo a la anterior (la 2).
  3. `kubectl rollout undo deployment/app --to-revision=1 -n nivel-33`.
- **Aprendes:** el historial vive en los ReplicaSets antiguos (`revisionHistoryLimit`). Al volver a la 1, pasa a ser la revisión 4.

### 34 · Configuración en caliente · *misión*
- **Preparación:**
  - ConfigMap `saludo-config` con `MENSAJE=Hola`.
  - Deployment `saludo` (busybox) que lee `MENSAJE` como variable de entorno y escribe `Mensaje: $MENSAJE` cada 10 s.
- **Misión:** Cambia el mensaje a «Bienvenido» y consigue que la aplicación lo use DE VERDAD.
- **Se supera cuando:** el ConfigMap dice `Bienvenido` y todos los Pods de `saludo` lo tienen en su entorno.
- **Solución:**
  ```bash
  kubectl edit configmap saludo-config -n nivel-34        # MENSAJE: Bienvenido
  kubectl rollout restart deployment/saludo -n nivel-34
  ```
- **Pistas:**
  1. Cambiar el ConfigMap no basta: mira `kubectl logs deploy/saludo -n nivel-34`.
  2. Las variables de entorno se leen solo al arrancar el contenedor.
  3. `kubectl rollout restart deployment/saludo -n nivel-34`, después de editar el ConfigMap.
- **Aprendes:** un ConfigMap usado como variable de entorno no se refresca; montado como fichero sí (con retraso). Tras cambiarlo: `rollout restart`.

### 35 · Secretos que no lo son · *pregunta*
- **Preparación:** Secret `credenciales` con `usuario=admin` y `password=S3cr3t0-EKS`.
- **Misión:** ¿Cuál es la contraseña guardada en el Secret `credenciales`?
- **Respuesta:** **S3cr3t0-EKS**
- **Pistas:**
  1. `kubectl get secret credenciales -n nivel-35 -o yaml`: los valores están en base64.
  2. `echo <valor> | base64 -d`.
  3. `kubectl get secret credenciales -n nivel-35 -o jsonpath='{.data.password}' | base64 -d`.
- **Aprendes:**
  - **base64 no es cifrado.** Quien pueda leer Secrets (RBAC) ve las contraseñas.
  - En EKS el cifrado está en etcd (KMS); en el día a día lo que te protege es el RBAC.

### 36 · Tarea única · *misión*
- **Misión:** Crea en `nivel-36` un Job llamado `calculo`, con imagen `busybox:1.37`, que ejecute `echo 42` y termine con éxito.
- **Se supera cuando:** el Job `calculo` tiene 1 completado y usa busybox.
- **Solución:** `kubectl create job calculo --image=busybox:1.37 -n nivel-36 -- echo 42`
- **Pistas:**
  1. Un Job ejecuta algo hasta que termina bien. No es un Deployment.
  2. `kubectl create job --help`; el comando va detrás de `--`.
  3. `kubectl create job calculo --image=busybox:1.37 -n nivel-36 -- echo 42`.
- **Aprendes:** un Job sirve para tareas que terminan (migraciones, cálculos). Su Pod acaba en `Completed`. Con `kubectl logs job/calculo` ves la salida.

### 37 · Tarea programada · *misión*
- **Misión:** Crea en `nivel-37` un CronJob llamado `limpieza` (imagen `busybox:1.37`, comando `echo limpiando`) que se ejecute TODOS LOS DÍAS A LAS 03:00.
- **Se supera cuando:** existe el CronJob `limpieza` con `schedule = "0 3 * * *"`.
- **Solución:** `kubectl create cronjob limpieza --image=busybox:1.37 --schedule="0 3 * * *" -n nivel-37 -- echo limpiando`
- **Pistas:**
  1. Formato cron: minuto hora día-del-mes mes día-de-la-semana.
  2. «A las 03:00 todos los días» = `0 3 * * *`.
  3. `kubectl create cronjob limpieza --image=busybox:1.37 --schedule="0 3 * * *" -n nivel-37 -- echo limpiando`.
- **Aprendes:** un CronJob crea un Job en cada disparo. La hora es UTC salvo que pongas `timeZone`.

### 38 · Un Pod en cada nodo · *pregunta*
- **Misión:** ¿Cuántos Pods del DaemonSet `kube-proxy` hay ahora mismo en el cluster?
- **Respuesta:** el número de Pods de `kube-proxy`, que es igual al número de nodos.
- **Pistas:**
  1. `kubectl get daemonsets -n kube-system`.
  2. Columnas DESIRED / READY.
  3. `kubectl get pods -n kube-system -o wide | grep kube-proxy`.
- **Aprendes:** un DaemonSet pone un Pod en cada nodo. Así funcionan `aws-node` (red) y `kube-proxy` en EKS.

---

## MUNDO 5 · Capacidad y escalado

### 39 · Calidad de servicio · *pregunta*
- **Preparación:** tres Deployments con `nginx:1.27-alpine`.

  | Deployment | Recursos |
  |---|---|
  | `oro` | requests = limits (CPU 100m / mem 64Mi) |
  | `plata` | requests CPU 50m, mem 32Mi; limits mem 128Mi |
  | `bronce` | sin recursos |
- **Misión:** ¿Qué clase QoS (QoS Class) tiene el Pod de `plata`?
- **Respuesta:** **Burstable**
- **Pistas:**
  1. Hay 3 clases: Guaranteed, Burstable y BestEffort.
  2. `kubectl describe pod <pod-de-plata> -n nivel-39` y busca «QoS Class».
  3. `kubectl get pods -n nivel-39 -l app=plata -o jsonpath='{.items[0].status.qosClass}'`.
- **Aprendes:**
  - Guaranteed: requests = limits.
  - Burstable: algún request.
  - BestEffort: nada.
  - Si el nodo se queda sin memoria, se desaloja primero BestEffort.

### 40 · Autoescalado · *misión*
- **Preparación:** Deployment `web` (nginx, requests CPU 50m / mem 32Mi).
- **Misión:** Crea un HorizontalPodAutoscaler `web` (mínimo 1, máximo 4, objetivo 50 % de CPU) y consigue que muestre la CPU real.
- **Se supera cuando:** el HPA tiene min 1, max 4 y objetivo 50, y la métrica es conocida.
- **Solución:** `kubectl autoscale deployment web --min=1 --max=4 --cpu-percent=50 -n nivel-40`
- **Pistas:**
  1. `kubectl autoscale deployment … -n nivel-40`.
  2. Flags: `--min=1 --max=4 --cpu-percent=50`. kubectl 1.36 también admite `--cpu=50%`.
  3. `kubectl get hpa -n nivel-40 -w` hasta que TARGETS deje de ser `<unknown>`.
- **Aprendes:** el HPA cambia el número de Pods según métricas de metrics-server. Sin metrics-server no funciona.

### 41 · Autoescalado a ciegas · *misión*
- **Preparación:** Deployment `api` (nginx, **sin requests**) y HPA `api` (min 1, max 5, CPU 60 %). TARGETS muestra `<unknown>`.
- **Misión:** El HPA de `api` no consigue medir la CPU. Arréglalo sin borrar el HPA.
- **Se supera cuando:** el HPA `api` (min 1, max 5) tiene métrica conocida.
- **Solución:** `kubectl set resources deployment api --requests=cpu=50m -n nivel-41`
- **Pistas:**
  1. `kubectl describe hpa api -n nivel-41` → «missing request for cpu».
  2. El % de CPU se calcula sobre los **requests**.
  3. `kubectl set resources deployment api --requests=cpu=50m -n nivel-41`.
- **Aprendes:** HPA por % de CPU = uso / requests. Sin requests no hay porcentaje.

### 42 · Cuota agotada · *misión*
- **Preparación:** ResourceQuota `limite-pods` (`pods: 2`) y Deployment `fila` (nginx, 4 réplicas). Solo se crean 2 Pods.
- **Misión:** El Deployment `fila` quiere 4 Pods, pero solo tiene 2. Consigue los 4 sin reducir réplicas.
- **Se supera cuando:** `fila` tiene 4/4.
- **Solución:** `kubectl edit resourcequota limite-pods -n nivel-42` → `pods: "4"`, o:
  ```bash
  kubectl patch resourcequota limite-pods -n nivel-42 -p '{"spec":{"hard":{"pods":"4"}}}'
  ```
- **Pistas:**
  1. `kubectl get events -n nivel-42`: «exceeded quota».
  2. `kubectl describe resourcequota -n nivel-42`.
  3. `kubectl edit resourcequota limite-pods -n nivel-42` y sube `pods` a 4.
- **Aprendes:**
  - Las cuotas limitan lo que un namespace puede consumir.
  - El fallo no está en los Pods (no existen): hay que mirarlo en los eventos del ReplicaSet.

### 43 · Sin hueco · *misión* (en AWS añade un nodo: +0,0456 $/h)
- **Preparación:** Deployment `relleno` (nginx, sin requests), con réplicas = huecos de Pod libres + 3. Quedan 3 Pending por «Too many pods».
- **Misión:** Algunos Pods de `relleno` no caben en ningún nodo. Haz que arranquen TODOS sin reducir réplicas.
- **Se supera cuando:** `relleno` está al completo.
- **Solución:**
  ```bash
  aws eks update-nodegroup-config --cluster-name eks-juego --nodegroup-name ng-juego \
    --scaling-config minSize=1,maxSize=2,desiredSize=2
  ```
  Si ya estabas en 2 nodos, sube `maxSize=3,desiredSize=3`.
- **Pistas:**
  1. `describe pod`: «Too many pods».
  2. Hacen falta más nodos: es el node group de AWS, no kubectl.
  3. `aws eks update-nodegroup-config --cluster-name eks-juego --nodegroup-name ng-juego --scaling-config minSize=1,maxSize=2,desiredSize=2`.
- **Aprendes:** cuando no caben Pods, se añaden nodos: a mano (node group), con Cluster Autoscaler o con Karpenter.

### 44 · Nodo vetado · *misión*
- **Preparación:** todos los nodos con el taint `mantenimiento=si:NoSchedule`, y Deployment `urgente` (nginx) en Pending.
- **Misión:** Nadie puede arrancar Pods nuevos y `urgente` necesita arrancar YA. Haz que arranque.
- **Se supera cuando:** `urgente` está 1/1.
- **Solución** (cualquiera de las dos):
  - quitar el taint: `kubectl taint nodes --all mantenimiento-`;
  - añadir una toleration a `urgente` (`kubectl edit`).
- **Pistas:**
  1. `describe pod`: «had untolerated taint {mantenimiento: si}».
  2. `kubectl describe node | grep Taints`.
  3. `kubectl taint nodes --all mantenimiento-` (el `-` final lo quita), o una toleration en el Deployment.
- **Aprendes:**
  - Los taints repelen Pods y las tolerations les dejan pasar.
  - Así se reservan nodos (GPU, sistema…) o se sacan de servicio.

### 45 · Etiqueta que falta · *misión*
- **Preparación:** Deployment `gpu-app` (nginx) con `nodeSelector: hardware=gpu`. Ningún nodo tiene esa label.
- **Misión:** `gpu-app` solo puede ir a nodos con `hardware=gpu`. Haz que arranque SIN modificar el Deployment.
- **Se supera cuando:** `gpu-app` está 1/1 y su `nodeSelector` sigue intacto.
- **Solución:** `kubectl label node <nodo> hardware=gpu`
- **Pistas:**
  1. `describe pod`: «didn't match Pod's node affinity/selector».
  2. Si no puedes cambiar el Pod, cambia el nodo.
  3. `kubectl label node <nodo> hardware=gpu`.
- **Aprendes:** `nodeSelector`/`affinity` = el Pod elige nodos por labels. En EKS se ponen en el node group o en el NodePool de Karpenter.

### 46 · Mantenimiento · *misión* (necesita 2 nodos)
- **Preparación:** Deployment `web` (nginx, 2 réplicas).
- **Misión:** Hay que parchear un nodo. Sácalo de servicio: no planificable y sin Pods de aplicación (los de DaemonSet pueden quedarse).
- **Se supera cuando:** un nodo está cordoned y sin Pods que no sean de DaemonSet.
- **Solución:** `kubectl drain <nodo> --ignore-daemonsets --delete-emptydir-data`. Después, `kubectl uncordon <nodo>`.
- **Pistas:**
  1. Con 1 solo nodo, los Pods no tendrían a dónde ir.
  2. `kubectl cordon` marca el nodo; `kubectl drain` lo marca y lo vacía.
  3. `kubectl drain <nodo> --ignore-daemonsets --delete-emptydir-data`.
- **Aprendes:** `drain` desaloja respetando los PDB (nivel 53). Antes de parchear, actualizar o terminar un nodo: siempre drain.

---

## MUNDO 6 · Seguridad y permisos

### 47 · ¿Quién soy? · *pregunta*
- **Misión:** ¿Cuál es el número de cuenta AWS (12 dígitos) en la que vive el cluster?
- **Respuesta:** el número de cuenta (en el simulador, `123456789012`; en un EKS real, el de tu cuenta).
- **Pistas:**
  1. `aws sts get-caller-identity`.
  2. El ARN del cluster lo contiene: `aws eks describe-cluster --name eks-juego --query cluster.arn`.
  3. También sale en `kubectl config current-context`.
- **Aprendes:** EKS autentica con IAM. `aws sts get-caller-identity` es lo primero que se mira ante un `Unauthorized`.

### 48 · Permisos mínimos · *misión*
- **Preparación:** ServiceAccount `lector`, sin permisos.
- **Misión:** Haz que la ServiceAccount `lector` pueda VER (get, list, watch) los Pods de `nivel-48`, y NADA más.
- **Se supera cuando:**
  - `can-i list pods` y `can-i get pods` → yes;
  - `can-i delete pods` y `can-i list secrets` → no.

  Todo con `--as=system:serviceaccount:nivel-48:lector`.
- **Solución:**
  ```bash
  kubectl create role ver-pods --verb=get,list,watch --resource=pods -n nivel-48
  kubectl create rolebinding lector-ver-pods --role=ver-pods --serviceaccount=nivel-48:lector -n nivel-48
  ```
- **Pistas:**
  1. `kubectl auth can-i list pods -n nivel-48 --as=system:serviceaccount:nivel-48:lector`.
  2. Hacen falta un Role (qué se puede hacer) y un RoleBinding (a quién se le da).
  3. `kubectl create role ver-pods --verb=get,list,watch --resource=pods -n nivel-48` y luego `kubectl create rolebinding lector-ver-pods --role=ver-pods --serviceaccount=nivel-48:lector -n nivel-48`.
- **Aprendes:** RBAC = Role (verbos sobre recursos) + RoleBinding (a quién). Mínimo privilegio: solo lo necesario.

### 49 · Demasiados permisos · *misión*
- **Preparación:** ServiceAccount `bot` con el RoleBinding `bot-todo` → ClusterRole `admin`.
- **Misión:** La ServiceAccount `bot` puede borrar cualquier cosa de `nivel-49`. Déjala en solo LECTURA.
- **Se supera cuando:**
  - `can-i list deployments` → yes;
  - `can-i delete deployments` y `can-i create pods` → no.
- **Solución:**
  ```bash
  kubectl delete rolebinding bot-todo -n nivel-49
  kubectl create rolebinding bot-lectura --clusterrole=view --serviceaccount=nivel-49:bot -n nivel-49
  ```
- **Pistas:**
  1. `kubectl get rolebindings -n nivel-49 -o wide`.
  2. Existen ClusterRoles predefinidos: `view`, `edit`, `admin`.
  3. Borra `bot-todo` y crea un RoleBinding con `--clusterrole=view`.
- **Aprendes:** un RoleBinding a un ClusterRole da esos permisos solo en ese namespace. `view` no deja leer Secrets.

### 50 · Muro de fuego · *misión*
- **Preparación:**
  - Deployment y Service `web` (nginx).
  - Deployment `cliente` (busybox; readiness `wget -qO- -T 2 http://web`).
  - NetworkPolicy `denegar-todo` (`podSelector: {}`, `policyTypes: [Ingress]`).
- **Misión:** Hay una política que bloquea todo el tráfico entrante en `nivel-50`. Permite SOLO que `cliente` hable con `web`, sin borrar `denegar-todo`.
- **Se supera cuando:** `denegar-todo` sigue existiendo y `cliente` está listo. En EKS real, además, existe una política que selecciona `app=web` y permite desde `app=cliente`.
- **Solución:** `kubectl apply -f -` con:
  ```yaml
  apiVersion: networking.k8s.io/v1
  kind: NetworkPolicy
  metadata:
    name: permitir-cliente
    namespace: nivel-50
  spec:
    podSelector:
      matchLabels:
        app: web
    policyTypes: ["Ingress"]
    ingress:
    - from:
      - podSelector:
          matchLabels:
            app: cliente
  ```
- **Pistas:**
  1. `kubectl get networkpolicy -n nivel-50` y `kubectl describe networkpolicy denegar-todo`.
  2. Las políticas se suman: añade otra que permita de `app=cliente` a `app=web`.
  3. `kubectl apply -f -` con una NetworkPolicy `permitir-cliente` (`podSelector app=web`, `ingress from podSelector app=cliente`).
- **Aprendes:** por defecto todo Pod habla con todo Pod. Con un "denegar todo" más permisos explícitos se hace una red de mínimo privilegio.
- **⚠️ Solo EKS:** las NetworkPolicies solo se aplican si la VPC CNI tiene activado el soporte (`enableNetworkPolicy`, capítulo 06 del curso). Sin él, el cluster las acepta pero **no las cumple**, y por eso la versión de terminal comprueba también los objetos.

### 51 · Pod Security · *misión*
- **Preparación:** namespace `nivel-51` con `pod-security.kubernetes.io/enforce=restricted`, y Deployment `inseguro` (`nginx:1.27-alpine`, sin securityContext). El ReplicaSet no puede crear Pods.
- **Misión:** El namespace `nivel-51` solo admite Pods "restricted". Haz que `inseguro` tenga 1 Pod listo, SIN quitar esa etiqueta del namespace.
- **Se supera cuando:** `inseguro` está 1/1 y el namespace sigue en `restricted`.
- **Solución:** `kubectl apply -f -` con:
  ```yaml
  apiVersion: apps/v1
  kind: Deployment
  metadata:
    name: inseguro
    namespace: nivel-51
  spec:
    replicas: 1
    selector:
      matchLabels:
        app: inseguro
    template:
      metadata:
        labels:
          app: inseguro
      spec:
        securityContext:
          runAsNonRoot: true
          seccompProfile:
            type: RuntimeDefault
        containers:
        - name: inseguro
          image: nginxinc/nginx-unprivileged:1.28-alpine
          ports:
          - containerPort: 8080
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
  ```
- **Pistas:**
  1. `kubectl get events -n nivel-51` o `kubectl describe rs -n nivel-51`: «violates PodSecurity "restricted"».
  2. El mensaje enumera qué falta: allowPrivilegeEscalation, capabilities, runAsNonRoot y seccompProfile.
  3. nginx normal corre como root: usa `nginxinc/nginx-unprivileged:1.28-alpine` (puerto 8080) y añade el securityContext.
- **Aprendes:**
  - Pod Security Admission bloquea Pods inseguros por namespace.
  - Una imagen que corre como root no pasa `runAsNonRoot`.

---

## MUNDO 7 · Guardia

### 52 · Ficha del cluster · *pregunta*
- **Misión:** ¿Qué versión de Kubernetes tiene el control plane? (formato `1.XX`)
- **Respuesta:** la versión real (`1.36`). Se acepta `v1.36`.
- **Pistas:**
  1. `kubectl version`, en la línea Server Version.
  2. `aws eks describe-cluster --name eks-juego --query cluster.version`.
  3. Solo el minor: `1.XX`.
- **Aprendes:** la versión marca el soporte (14 meses estándar) y el precio (soporte extendido = 0,60 $/h).

### 53 · Presupuesto de interrupción · *misión* (necesita 2 nodos)
- **Preparación:** Deployment `pagos` (nginx, 2 réplicas) y PodDisruptionBudget `pagos-pdb` (`minAvailable: 2`).
- **Misión:** Vacía (drain) un nodo que tenga un Pod de `pagos`, SIN borrar ni modificar el PDB.
- **Se supera cuando:**
  - un nodo está cordoned y sin Pods de aplicación;
  - el PDB sigue con `minAvailable: 2`;
  - `pagos` tiene 2 o más listos.
- **Solución:**
  ```bash
  kubectl scale deployment pagos --replicas=3 -n nivel-53
  kubectl drain <nodo> --ignore-daemonsets --delete-emptydir-data
  kubectl uncordon <nodo>    # al acabar
  ```
- **Pistas:**
  1. `drain` se queda en «Cannot evict pod as it would violate the pod's disruption budget».
  2. `kubectl get pdb -n nivel-53`: ALLOWED DISRUPTIONS = 0.
  3. Sube `pagos` a 3 réplicas (`kubectl scale`) y repite el drain.
- **Aprendes:** el PDB protege la disponibilidad en drains, upgrades y Karpenter. Un PDB imposible bloquea el mantenimiento.

### 54 · Nodo caído · *misión*
- **Preparación:** un nodo pasa a NotReady (en EKS, el juego para su kubelet por SSM).
- **Misión:** Un nodo está NotReady. En EKS los nodos rotos no se arreglan: se SUSTITUYEN. Sustitúyelo por uno sano.
- **Se supera cuando:** todos los nodos están Ready, su número es el `desiredSize` del node group y la instancia rota ya no existe.
- **Solución:**
  ```bash
  kubectl describe node <nodo-NotReady>     # ProviderID: aws:///eu-west-1a/i-0abc...
  aws ec2 terminate-instances --instance-ids i-0abc...
  kubectl get nodes -w                       # el node group crea otro
  ```
- **Pistas:**
  1. `kubectl get nodes`: ¿cuál está NotReady?
  2. `kubectl describe node <nodo>`: el ProviderID termina en el ID de la instancia EC2.
  3. `aws ec2 terminate-instances --instance-ids <i-…>`. El node group (ASG) lanza uno nuevo.
- **Aprendes:**
  - Los nodos son ganado, no mascotas.
  - El ASG del node group mantiene `desiredSize`: terminar una instancia mala es el arreglo normal.

### 55 · El DNS ha caído · *misión*
- **Preparación:** CoreDNS escalado a 0, y Deployment `cliente` (busybox; readiness `nslookup kubernetes.default.svc.cluster.local`).
- **Misión:** 🚨 `cliente` no consigue resolver nombres y nada en el cluster encuentra a nadie. La causa NO está en `nivel-55`. Encuéntrala y deja `cliente` listo.
- **Se supera cuando:** `cliente` está listo y CoreDNS tiene al menos 1 réplica (en EKS real se deja en 2).
- **Solución:** `kubectl scale deployment coredns --replicas=2 -n kube-system`
- **Pistas:**
  1. Prueba: `kubectl run dns --rm -it --image=busybox:1.37 -n nivel-55 -- nslookup kubernetes.default`.
  2. ¿Quién resuelve los nombres dentro del cluster? Mira `kubectl get deploy -n kube-system`.
  3. `kubectl scale deployment coredns --replicas=2 -n kube-system`.
- **Aprendes:** CoreDNS es crítico: sin él nada encuentra a nada. Si "falla todo a la vez", mira primero `kube-system`.

### 56 · JEFE DE GUARDIA: la tienda caída · *misión*
- **Preparación:**
  - Deployment `api-precios` (2 réplicas, imagen `nginx:1.27-alpne`: tag con errata).
  - Service `api-precios` con selector `app=api-precio` (le falta la s).
  - Deployment `tienda-web` (busybox) con `API_URL=http://api-precios:8080` (el Service escucha en el 80) y readiness `wget -qO- -T 2 "$API_URL"`.
- **Misión:** 🔥 La tienda online no carga los precios. Hay MÁS DE UN fallo. Encuéntralos todos y arréglalo.
- **Se supera cuando:** `api-precios` tiene 2/2 y `tienda-web` está listo.
- **Solución:**
  ```bash
  kubectl set image deployment/api-precios nginx=nginx:1.27-alpine -n nivel-56
  kubectl set selector service api-precios app=api-precios -n nivel-56
  kubectl set env deployment/tienda-web API_URL=http://api-precios -n nivel-56
  ```
- **Pistas:**
  1. Ve de abajo arriba: ¿están bien los Pods de `api-precios`?
  2. Después, ¿tiene endpoints el Service?
  3. Por último, ¿a qué URL y a qué puerto llama `tienda-web`? (`kubectl set env deployment/tienda-web --list`)
- **Aprendes:**
  - En producción los fallos vienen en cadena.
  - Método: de abajo arriba (Pods → Service → quien llama), un fallo cada vez, comprobando entre medias.

---

## MUNDO 8 · Bajo el capó

Aquí se abre el contenedor: procesos, cgroups, capabilities, el token de la ServiceAccount, init containers, contenedores efímeros, permisos de cluster y credenciales de AWS. Chuleta: `CHULETA-BAJO-EL-CAPO.md`.

### 57 · ¿Quién es el PID 1? · *pregunta*
- **Preparación:** Deployment `web` (`nginx:1.27-alpine`).
- **Misión:** Entra en el contenedor de `web` y averigua qué programa es su PID 1.
- **Respuesta:** `nginx` (vale cualquier respuesta que lo contenga).
- **Solución:** `kubectl exec -it deploy/web -n nivel-57 -- sh` → `ps` → `responder nginx`.
- **Pistas:**
  1. `kubectl exec -it deploy/web -n nivel-57 -- sh` y dentro `ps`.
  2. Sin entrar: `kubectl exec deploy/web -n nivel-57 -- cat /proc/1/cmdline`.
  3. El PID 1 es el proceso que arranca la imagen (su CMD/ENTRYPOINT).
- **Aprendes:** dentro del contenedor tu programa es el PID 1 porque vive en su propio *PID namespace*. Si el PID 1 muere, el contenedor muere: por eso nginx corre con `daemon off;`.

### 58 · El límite de memoria, visto por el kernel · *pregunta*
- **Preparación:** Deployment `api` (busybox) con `requests: cpu 100m, memory 96Mi` y `limits: cpu 500m, memory 192Mi`.
- **Misión:** ¿Qué número EXACTO ve el kernel como límite de memoria del contenedor? En bytes.
- **Respuesta:** `201326592` (192 × 1024 × 1024).
- **Solución:** `kubectl exec deploy/api -n nivel-58 -- cat /sys/fs/cgroup/memory.max`
- **Pistas:**
  1. Entra en el contenedor.
  2. Los ficheros del cgroup están en `/sys/fs/cgroup/`.
  3. `cat /sys/fs/cgroup/memory.max`.
- **Aprendes:** el kubelet escribe `limits.memory` en `memory.max` (cgroup v2). Si el proceso pasa de ahí, el kernel lo mata: OOMKilled, exit 137. `memory.current` es el uso actual y `memory.events` cuenta los OOM.

### 59 · CPU: cuota y periodo · *pregunta*
- **Preparación:** Deployment `calc` (busybox) con `limits.cpu: 300m`.
- **Misión:** ¿Cuántos microsegundos de CPU puede gastar el contenedor en cada periodo de 100 ms?
- **Respuesta:** `30000` (también vale `30000 100000`).
- **Solución:** `kubectl exec deploy/calc -n nivel-59 -- cat /sys/fs/cgroup/cpu.max`
- **Pistas:**
  1. Entra en el contenedor.
  2. `cat /sys/fs/cgroup/cpu.max` da dos números: cuota y periodo.
  3. 300m = 0,3 CPU: el 30 % de 100000 µs.
- **Aprendes:** `cpu.max` = «cuota periodo». Si gasta la cuota antes de tiempo, el kernel lo frena (throttling, `nr_throttled` en `cpu.stat`). Pasarse de CPU ralentiza; pasarse de memoria mata. Los requests de CPU van a `cpu.weight`.

### 60 · Capabilities: los superpoderes de root · *pregunta*
- **Preparación:**
  - Deployment `normal` (`nginx:1.27-alpine`, corre como root).
  - Deployment `blindado` (`nginxinc/nginx-unprivileged:1.28-alpine`, uid 101, `capabilities.drop: ["ALL"]`, `allowPrivilegeEscalation: false`).
- **Misión:** ¿Qué `CapEff` tiene el PID 1 de `normal`?
- **Respuesta:** `00000000a80425fb` (también sin los ceros de la izquierda).
- **Solución:** `kubectl exec deploy/normal -n nivel-60 -- cat /proc/1/status` → línea `CapEff`.
- **Pistas:**
  1. `cat /proc/1/status` dentro del contenedor.
  2. Busca la línea `CapEff:`.
  3. Compáralo con `blindado`: ¿por qué sale todo a ceros?
- **Aprendes:** `a80425fb` son las 14 capabilities que containerd da por defecto. Con `drop: ["ALL"]` y un usuario que no es root, queda `0000000000000000`. Es lo que exige la Pod Security `restricted`.

### 61 · Un token que nadie usa · *misión*
- **Preparación:** Deployment `web` (2 réplicas) con la ServiceAccount `default`.
- **Misión:** `web` no usa la API de Kubernetes, pero lleva montado el token. Haz que sus Pods NO lo monten, y que `web` siga funcionando.
- **Se supera cuando:** todos los Pods de `web` están listos (al menos 2) y ninguno lleva el token.
- **Solución:**
  ```bash
  kubectl patch serviceaccount default -n nivel-61 -p '{"automountServiceAccountToken":false}'
  kubectl rollout restart deployment web -n nivel-61
  ```
  (o `automountServiceAccountToken: false` en el `spec` del Pod, dentro del Deployment)
- **Trampas:** cambiar la ServiceAccount y no recrear los Pods no basta. Bajar a 0 réplicas, tampoco.
- **Pistas:**
  1. `kubectl exec deploy/web -n nivel-61 -- ls /var/run/secrets/kubernetes.io/serviceaccount`.
  2. El campo es `automountServiceAccountToken: false`.
  3. El token se decide AL CREAR el Pod.
- **Aprendes:** si la aplicación no llama a la API, no le des credenciales. Se aplica a los Pods nuevos.

### 62 · Esperando a la base de datos · *misión*
- **Preparación:**
  - Deployment `bd` (nginx), sin Service.
  - Deployment `app` con el init container `espera-bd`: `until nslookup bd; do echo esperando a bd; sleep 2; done`.
- **Misión:** `app` lleva un rato en `Init:0/1`. Arréglalo SIN tocar el Deployment `app`.
- **Se supera cuando:** `app` está listo y sigue teniendo su init container.
- **Solución:**
  ```bash
  kubectl logs deploy/app -c espera-bd -n nivel-62
  kubectl expose deployment bd --port=80 -n nivel-62
  ```
- **Trampa:** quitar el init container no vale.
- **Pistas:**
  1. ¿Qué significa `Init:0/1`?
  2. `kubectl logs deploy/app -c espera-bd -n nivel-62`.
  3. Los nombres DNS los dan los Services.
- **Aprendes:** los init containers se ejecutan en orden y cada uno debe terminar bien antes del contenedor principal. Se depuran con `logs -c <init>`.

### 63 · Credenciales de AWS sin claves · *misión*
- **Preparación:** ServiceAccount `subidor` y Deployment `subidor` (busybox) que la usa.
- **Misión:** dale al Deployment el rol `arn:aws:iam::123456789012:role/eks-quest-s3-subidor` con EKS Pod Identity y comprueba dentro del Pod que le llegan las credenciales.
- **Se supera cuando:** existe la asociación (nivel-63 / subidor / ese rol) y hay un Pod listo de `subidor` con `AWS_CONTAINER_CREDENTIALS_FULL_URI`.
- **Solución:**
  ```bash
  aws eks create-pod-identity-association --cluster-name eks-juego --namespace nivel-63 \
    --service-account subidor --role-arn arn:aws:iam::123456789012:role/eks-quest-s3-subidor
  kubectl rollout restart deployment subidor -n nivel-63
  kubectl exec deploy/subidor -n nivel-63 -- env | grep AWS_
  ```
- **Trampas:** asociar otra ServiceAccount no vale; sin recrear los Pods, tampoco.
- **⚠️ En EKS real:** necesitas el add-on `eks-pod-identity-agent` y un rol IAM cuya política de confianza admita a `pods.eks.amazonaws.com` (`sts:AssumeRole` y `sts:TagSession`).
- **Aprendes:** Pod Identity = asociación (namespace + ServiceAccount → rol IAM) + agente en cada nodo. Sin claves en Secrets.

### 64 · Un contenedor sin shell · *pregunta*
- **Preparación:** Deployment `minimo` (`registry.k8s.io/pause:3.10`: sin sh, ps ni cat).
- **Misión:** ¿Cuál es el comando de su PID 1?
- **Respuesta:** `/pause` (también `pause`).
- **Solución:**
  ```bash
  kubectl debug -it deploy/minimo -n nivel-64 --image=busybox:1.37 --target=minimo
  ps
  exit
  responder /pause
  ```
- **Pistas:**
  1. `kubectl exec … -- sh` falla: no hay shell.
  2. `kubectl debug` mete un contenedor efímero con sus propias herramientas.
  3. Con `--target` ves los procesos del contenedor objetivo.
- **Aprendes:** un contenedor efímero con `--target` comparte el espacio de procesos del objetivo. Así se depuran las imágenes mínimas («distroless»).

### 65 · Un auditor para todo el cluster · *misión*
- **Preparación:** ServiceAccount `auditor`.
- **Misión:** `auditor` tiene que poder VER y LISTAR los Pods de TODOS los namespaces, y nada más.
- **Se supera cuando:** puede `get` y `list` pods en todo el cluster, y NO puede borrar Pods, listar Secrets, listar Deployments ni crear Pods.
- **Solución:**
  ```bash
  kubectl create clusterrole ver-pods-global --verb=get,list,watch --resource=pods
  kubectl create clusterrolebinding auditor-ver-pods --clusterrole=ver-pods-global --serviceaccount=nivel-65:auditor
  ```
- **Trampas:** el ClusterRole `view` da demasiado; un RoleBinding solo vale para su namespace; `--verb=*` incluye borrar.
- **Pistas:**
  1. Role + RoleBinding = un namespace. Para todos: ClusterRole + ClusterRoleBinding.
  2. `kubectl create clusterrole ver-pods-global --verb=get,list,watch --resource=pods`.
  3. `kubectl auth can-i list pods -A --as=system:serviceaccount:nivel-65:auditor`.
- **Aprendes:** mínimo privilegio a escala de cluster = tu propio ClusterRole, no los predefinidos.

### 66 · JEFE FINAL: el servicio blindado · *misión*
- **Preparación:** namespace con Pod Security `restricted`.
  - Deployment `cola` (`nginx-unprivileged`, puerto 8080), sin Service.
  - Deployment `pedidos` (2 réplicas, `nginx-unprivileged`, todo no-root y sin capabilities):
    - init container `espera-cola` (busybox, `runAsUser: 1000`) que espera a que resuelva `cola`;
    - variable `COLA_PASSWORD` del Secret `cola-cred`, que no existe;
    - readiness `httpGet /healthz :8080`, que nginx no sirve (404).
- **Misión:** deja los 2 Pods de `pedidos` listos SIN rebajar la seguridad del namespace.
- **Se supera cuando:** `pedidos` tiene 2/2, conserva su init container y el namespace sigue en `restricted`.
- **Solución:**
  ```bash
  kubectl logs deploy/pedidos -c espera-cola -n nivel-66
  kubectl expose deployment cola --port=8080 -n nivel-66
  kubectl create secret generic cola-cred --from-literal=password=s3cret0 -n nivel-66
  kubectl patch deployment pedidos -n nivel-66 --type=json \
    -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/"}]'
  ```
- **Pistas:**
  1. De fuera adentro: `Init` → logs del init container.
  2. Cuando pase el init: `describe pod` → ¿falta un Secret?
  3. Al final, `Running 0/1`: la readiness. ¿Responde nginx en `/healthz`?
- **Aprendes:** los fallos vienen en capas: el init tapa el Secret, y el Secret tapa la sonda. Arregla uno, mira otra vez, sigue. Y en `restricted` la solución nunca es quitar la seguridad.

---

## MUNDO 9 · Redes y Pods por dentro

Cómo se comunican los Pods y qué hay debajo: IPs de Pod, endpoints, DNS, sidecars que comparten red y ficheros, procesos compartidos, OOM, y el nodo visto por dentro (crictl, cgroups, kube-proxy). Chuletas: `CHULETA-BAJO-EL-CAPO.md` (secciones 8-10) y `CHULETA-RED.md`.

### 67 · Cada Pod tiene su IP · *pregunta*
- **Preparación:** Deployment `eco` (nginx).
- **Misión:** ¿Qué IP tiene el Pod de `eco`?
- **Respuesta:** la IP del Pod (`kubectl get pods -o wide`); cambia en cada partida.
- **Solución:** `kubectl get pods -n nivel-67 -o wide`
- **Aprendes:** cada Pod tiene una IP real de la VPC (VPC CNI); los Services usan otro rango (172.20.0.0/16) de IPs virtuales.

### 68 · ¿Quién recibe tráfico de verdad? · *pregunta*
- **Preparación:** Deployments `tienda-a` (2 réplicas) y `tienda-b` (1 réplica, readiness en `/salud` que falla), todos con `rol=tienda`; Service `tienda` con selector `rol=tienda`.
- **Respuesta:** `2`
- **Solución:** `kubectl get endpoints tienda -n nivel-68`
- **Aprendes:** un Service solo manda tráfico a los Pods LISTOS; si la readiness falla, el Pod sale de los endpoints.

### 69 · ¿Quién contesta al DNS? · *pregunta*
- **Preparación:** Deployment `cliente` (busybox).
- **Misión:** mira `/etc/resolv.conf` dentro de un Pod: ¿cómo se llama el Service que hay detrás del `nameserver`?
- **Respuesta:** `kube-dns`
- **Solución:** `kubectl exec deploy/cliente -n nivel-69 -- cat /etc/resolv.conf` (nameserver 172.20.0.10) y `kubectl get svc -A | grep 172.20.0.10`.
- **Aprendes:** el DNS de los Pods es el Service `kube-dns` (kube-system), delante de CoreDNS; `search` y `ndots:5` explican por qué funcionan los nombres cortos.

### 70 · Dos contenedores, una red · *misión*
- **Preparación:** Deployment `web` con dos contenedores: `app` (nginx en el 80) y el sidecar `vigia` (busybox), que comprueba `$DESTINO` (`http://localhost:8080`) en bucle y en su readiness.
- **Misión:** el Pod se queda en 1/2. Déjalo 2/2 sin quitar el sidecar ni su sonda.
- **Se supera cuando:** `web` está listo (2/2) y `vigia` conserva su readinessProbe.
- **Solución:**
  ```bash
  kubectl logs deploy/web -c vigia -n nivel-70
  kubectl set env deployment/web -c vigia DESTINO=http://localhost:80 -n nivel-70
  ```
- **Trampas:** quitar el sidecar o su sonda no vale; `set env` sin `-c` cambia el contenedor `app`, no el sidecar.
- **Aprendes:** los contenedores de un Pod comparten red (se hablan por `localhost`); READY x/y cuenta contenedores.

### 71 · Procesos compartidos · *pregunta*
- **Preparación:** Deployment `par` con `shareProcessNamespace: true` y dos contenedores: `app` (nginx) y `consola` (busybox).
- **Misión:** entra en `consola`: ¿cuántos procesos de nginx ves (master + workers)?
- **Respuesta:** `3`
- **Solución:** `kubectl exec -it deploy/par -c consola -n nivel-71 -- sh` → `ps`.
- **Aprendes:** con `shareProcessNamespace` el PID 1 es `/pause` y cada contenedor ve los procesos de los demás.

### 72 · ¿A quién mata primero el kernel? · *pregunta*
- **Preparación:** Deployments `oro` (Guaranteed), `plata` (Burstable: solo requests de memoria) y `bronce` (BestEffort).
- **Misión:** ¿cuál tiene el `oom_score_adj` más alto?
- **Respuesta:** `bronce`
- **Solución:** `kubectl exec deploy/<nombre> -n nivel-72 -- cat /proc/1/oom_score_adj` en los tres (−997, entre 2 y 999, 1000).
- **Aprendes:** el kubelet fija `oom_score_adj` según la QoS; con poca memoria en el nodo, el kernel mata primero a los BestEffort.

### 73 · Del contenedor al proceso del nodo · *pregunta*
- **Preparación:** Deployment `rastro` (nginx).
- **Misión:** ¿qué PID tiene EN EL NODO el proceso principal del contenedor `rastro`?
- **Respuesta:** el PID que da `crictl inspect` (cambia en cada partida).
- **Solución:**
  ```bash
  kubectl get pods -n nivel-73 -o wide
  kubectl debug node/<nodo> -it --image=busybox:1.37
  crictl ps --name rastro
  crictl inspect <id> | grep pid
  ```
- **Aprendes:** `crictl` habla con containerd; dentro del contenedor el proceso es el PID 1, fuera es otro (PID namespace).

### 74 · El cgroup del Pod, desde el nodo · *pregunta*
- **Preparación:** Deployment `medido` con `requests.memory` y sin limits (Burstable).
- **Misión:** ¿en qué rama de QoS está su cgroup?
- **Respuesta:** `burstable`
- **Solución:** dentro, `cat /proc/self/cgroup` da `0::/`; en el nodo, `crictl inspect <id> | grep pid` y `cat /proc/<pid>/cgroup` → `/kubepods.slice/kubepods-burstable.slice/kubepods-burstable-pod<uid>.slice/cri-containerd-<id>.scope`.
- **Aprendes:** el kubelet cuelga los cgroups por QoS y por Pod; desde dentro no se ve (namespace de cgroup).

### 75 · Las tripas de un Service · *pregunta*
- **Preparación:** Deployment `pagos` (nginx-unprivileged, 8080) y Service `pagos` (port 80 → targetPort 8080).
- **Misión:** ¿a qué IP:puerto reenvían las reglas de kube-proxy el tráfico del Service?
- **Respuesta:** `<IP del Pod>:8080`
- **Solución:** `kubectl debug node/<nodo> -it --image=busybox:1.37` → `iptables-save | grep pagos` → `DNAT --to-destination`.
- **Aprendes:** kube-proxy convierte cada Service en reglas KUBE-SVC → KUBE-SEP → DNAT; la IP del Service no existe en ninguna interfaz.

---

## MUNDO 10 · Examen final

### 76 · EXAMEN FINAL: laboratorio estilo CKA · *misión por tareas*

Inspirado en las tareas más conocidas de las prácticas públicas de la CKA (no son preguntas reales del examen, que es confidencial). Seis tareas **independientes**: cada una puntúa por separado, se aprueba con 4 de 6 (66 %, como la CKA) y se puede seguir subiendo nota. `comprobar` enseña cuáles llevas. Los XP son proporcionales a la nota.

- **Preparación:** 3 nodos (uno con el kubelet parado, NotReady); namespaces `app-team1`, `fubar` (Deployment `datos`), `internal` (Deployment `informes`) y `nivel-76` (Deployments `front-end`, `legacy-app` —escribe `/var/log/legacy-app.log` en un volumen `logs`— y `lotes`, fijado al nodo a desalojar).
- **Tareas y solución:**
  1. **RBAC.**
     ```bash
     kubectl create clusterrole deployment-clusterrole --verb=create --resource=deployments,statefulsets,daemonsets
     kubectl create serviceaccount cicd-token -n app-team1
     kubectl create rolebinding cicd-token-binding --clusterrole=deployment-clusterrole --serviceaccount=app-team1:cicd-token -n app-team1
     ```
     Trampas: un ClusterRoleBinding (vale en todo el cluster) o el ClusterRole `edit` (da de más) no cuentan.
  2. **Mantenimiento:** `kubectl drain <nodo indicado> --ignore-daemonsets --delete-emptydir-data`. Solo `cordon` no basta.
  3. **NetworkPolicy** en `fubar`:
     ```yaml
     apiVersion: networking.k8s.io/v1
     kind: NetworkPolicy
     metadata:
       name: allow-port-from-namespace
       namespace: fubar
     spec:
       podSelector: {}
       policyTypes: ["Ingress"]
       ingress:
       - from:
         - namespaceSelector:
             matchLabels:
               kubernetes.io/metadata.name: internal
         ports:
         - protocol: TCP
           port: 9000
     ```
     Trampas: sin el puerto, o abierta a todos los namespaces, no cuenta.
  4. **Exponer:**
     ```bash
     kubectl patch deployment front-end -n nivel-76 --type=json -p '[{"op":"add","path":"/spec/template/spec/containers/0/ports","value":[{"name":"http","containerPort":80,"protocol":"TCP"}]}]'
     kubectl expose deployment front-end --name=front-end-svc --port=80 --target-port=http --type=NodePort -n nivel-76
     ```
  5. **Sidecar:** `kubectl edit deployment legacy-app -n nivel-76` y añade:
     ```yaml
     - name: sidecar
       image: busybox:1.37
       command: ["/bin/sh", "-c", "tail -n+1 -f /var/log/legacy-app.log"]
       volumeMounts:
       - name: logs
         mountPath: /var/log
     ```
     Comprobación: `kubectl logs deploy/legacy-app -c sidecar -n nivel-76`.
  6. **Nodo caído:** `kubectl get nodes` → `kubectl debug node/<nodo> -it --image=busybox:1.37` (o `aws ssm start-session`) → `systemctl status kubelet` → `systemctl start kubelet`. Esperar sin hacer nada no lo arregla.
- **Aprendes:** el examen es práctico y por tareas: lee bien el namespace de cada una, compruébala (get, describe, `auth can-i`, logs) y no te atasques: pasa a la siguiente.
