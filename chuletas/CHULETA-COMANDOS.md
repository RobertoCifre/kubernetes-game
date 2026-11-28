# Chuleta de comandos: kubectl y EKS

Ábrela al lado de la terminal mientras juegas.

- `<algo>` significa "pon aquí tu valor": no escribas los `< >`.
- `-n <namespace>` indica en qué "carpeta" (namespace) trabajas. En el juego es `-n nivel-2`, `-n nivel-3`…
- Sin `-n`, kubectl usa el namespace `default`.
- Los ejemplos son para bash (Linux, macOS, WSL o Git Bash). En PowerShell las comillas simples funcionan distinto.

## ⭐ Lo primero: tres palabras que salen en todo

| Palabra | Qué es | Ejemplo |
|---|---|---|
| **`-n <ns>`** | **namespace** = "carpeta" del cluster donde trabajas. Si no lo pones, va a `default` | `-n nivel-2` → "dentro de la carpeta nivel-2" |
| **Deployment** | "Quiero N copias de esta imagen funcionando siempre" (si una muere, se repone) | `kubectl create deployment web --image=nginx:1.27-alpine --replicas=3 -n nivel-2` |
| **Service** | Dirección fija delante de esas copias. **Aquí va el PUERTO** (`--port`) | `kubectl expose deployment web --port=80 -n nivel-2` |

¿Y el puerto en el Deployment? No hace falta: nginx ya escucha en el 80 por dentro. El puerto se le dice al Service (`expose --port=80`), que es quien recibe las peticiones y las reparte.

## 🔎 ¿Problema con…? Índice por recurso

Busca el recurso que falla y ve a la sección. Los números son los de esta chuleta (1 Mirar · 2 Crear · 3 Cambiar · 4 Dentro de los Pods · 5 Borrar · 6 Nodos · 7 Diagnosticar).

| Problema con… | Crearlo | Cambiarlo o arreglarlo | Mirarlo |
|---|---|---|---|
| **Deployment** (imagen, réplicas, variables, recursos, comando, sondas) | 2 · `create deployment` · YAML (CHULETA-YAML) | 3 · `set image` · `set env` · `set resources` · `scale` · `edit` · `patch` | 1 · `get deploy` · `describe deploy` |
| **Pod** que no arranca o se reinicia | Lo crea su Deployment | Se arregla en su **Deployment** (3) · `delete pod` lo recrea (5) | 1 · `describe pod` · `logs` · `logs --previous` · tabla de 7 |
| **Service** (no llega el tráfico, puertos, selector, IP pública) | 2 · `expose` (`--port`, `--target-port`, `--type`) | 3 · `set selector` · `edit svc` · `patch svc` | 1 · `get svc -o wide` · `get endpoints` · `describe svc` · CHULETA-RED |
| **DNS** (los nombres no resuelven) | — | CoreDNS es un Deployment de `kube-system`: se arregla como cualquier Deployment (3) | 4 · `run … nslookup` · CHULETA-RED |
| **ConfigMap / Secret** | 2 · `create configmap` · `create secret generic` | 3 · `edit configmap` (y `rollout restart`) | 4 · Leer un Secret |
| **Versiones** (la nueva falla, volver atrás) | — | 3 · `rollout undo` · `rollout restart` | 3 · `rollout status` · `rollout history` |
| **Job / CronJob** | 2 · `create job` · `create cronjob` | Se borran (5) y se vuelven a crear | 1 · `get jobs` · `logs job/<nombre>` |
| **Escalado y cuotas** (HPA, ResourceQuota, PDB) | 2 · `autoscale` · `create quota` · `create pdb` | 3 · `set resources` · `edit` · `patch` · `scale` | 1 · `get hpa` · `describe quota` · `get pdb` · CHULETA-CAPACIDAD |
| **Nodos** (no cabe, taints, labels, mantenimiento, nodo caído, más nodos) | 6 · node group | 3 · `label node` · `taint` · 6 · `cordon` · `drain` · `uncordon` · node group | 6 · `get nodes` · `describe node` · CHULETA-AWS-EKS |
| **Permisos** (`Forbidden`, RBAC, ServiceAccounts) | 2 · `create serviceaccount` · `role` · `rolebinding` · `clusterrole` · `clusterrolebinding` | 5 · borrar el que sobra · 2 · crear el correcto · 3 · `edit` | 1 · `auth can-i` · CHULETA-SEGURIDAD |
| **Seguridad del Pod** (Pod Security, root, capabilities) | YAML «restricted» en CHULETA-YAML | `apply -f -` con el securityContext (2) · 3 · `label namespace` | 1 · `get events` (*FailedCreate*) · CHULETA-SEGURIDAD |
| **Red entre Pods** (NetworkPolicy) | YAML en CHULETA-YAML y CHULETA-RED | `apply -f -` (2) · `delete netpol` (5) | 1 · `get netpol` · `describe netpol` |
| **Pod con varios contenedores** (READY 1/2, sidecars, logs de uno) | YAML: otro elemento en `containers:` (CHULETA-BAJO-EL-CAPO) | 3 · `edit` · `set env -c <contenedor>` | 1 · `logs -c` · `--all-containers` · 4 · `exec -c` |
| **El nodo por dentro** (PID de un contenedor, cgroup, reglas de kube-proxy, kubelet) | — | 6 · `systemctl start kubelet` | `kubectl debug node/<nodo>` · `crictl ps/inspect` · `iptables-save` · CHULETA-BAJO-EL-CAPO |
| **Dentro del contenedor** (procesos, cgroups, token, imagen sin shell, init containers) | — | Lo que encuentres se arregla en 2 o 3 | 4 · `exec` · `debug` · 1 · `logs -c` · CHULETA-BAJO-EL-CAPO |
| **AWS** (cuenta, versión del cluster, node group, credenciales de AWS para un Pod) | Pod Identity: CHULETA-BAJO-EL-CAPO | 6 · node group | `aws sts get-caller-identity` · `aws eks describe-cluster` · CHULETA-AWS-EKS |

## 0. Antes de nada: ¿dónde estoy?

| Quiero… | Comando |
|---|---|
| Ver con qué cuenta AWS estoy | `aws sts get-caller-identity` |
| Renovar la sesión AWS (si sale *Unauthorized* o *expired*) | `aws sso login --profile <tu-perfil>` |
| Ver a qué cluster apunta kubectl | `kubectl config current-context` |
| Ver todos los clusters que conozco | `kubectl config get-contexts` |
| Cambiar al cluster del juego | `kubectl config use-context eks-juego` |
| Conectar kubectl al cluster (primera vez) | `aws eks update-kubeconfig --name eks-juego --alias eks-juego --profile <tu-perfil> --region eu-west-1` |
| Dejar un namespace por defecto (ya no hace falta `-n`) | `kubectl config set-context --current --namespace=<ns>` |

## 1. MIRAR (no rompe nada, úsalos sin miedo)

### `get`: lista rápida

```bash
kubectl get nodes                      # nodos (las EC2)
kubectl get nodes -o wide              # + IPs, sistema operativo, versión
kubectl get pods -n <ns>               # pods de un namespace
kubectl get pods -A                    # pods de TODOS los namespaces
kubectl get pods -n <ns> -o wide       # + en qué nodo está cada pod y su IP
kubectl get pods -n <ns> --show-labels # + sus etiquetas (labels)
kubectl get deploy -n <ns>             # deployments
kubectl get rs -n <ns>                 # replicasets (uno por versión del deployment)
kubectl get svc -n <ns>                # services
kubectl get svc -n <ns> -o wide        # + el SELECTOR del service (a qué pods apunta)
kubectl get endpoints -n <ns>          # a qué IPs de pods manda tráfico cada service
kubectl get cm,secret -n <ns>          # configmaps y secrets (varios tipos separados por coma)
kubectl get hpa,pdb,quota -n <ns>      # autoescaladores, PDB y cuotas
kubectl get job,cronjob -n <ns>        # tareas
kubectl get ds -n kube-system          # daemonsets (un Pod por nodo)
kubectl get ns                         # namespaces
kubectl get all -n <ns>                # casi todo de golpe
kubectl get pods -n <ns> -w            # "en vivo": se actualiza solo (salir: Ctrl+C)
```

**Cómo leer `kubectl get pods`:**

```text
NAME                   READY   STATUS             RESTARTS   AGE
web-7d4b9c-x2kfp       1/1     Running            0          2m    ← bien
api-5f6c8d-abcde       0/1     ImagePullBackOff   0          1m    ← no puede descargar la imagen
app-6b7c9d-fghij       0/1     CrashLoopBackOff   5          3m    ← arranca y muere una y otra vez
gigante-8c9d-klmno     0/1     Pending            0          1m    ← no cabe en ningún nodo
```

- `READY 1/1`: contenedores listos / total.
- `RESTARTS` subiendo sin parar: algo lo mata, y conviene mirar `logs --previous`.

### Filtrar, columnas extra y contar

```bash
kubectl get pods -n <ns> -l app=web                # solo los que tienen esa label (-l = --selector)
kubectl get pods -n <ns> -l 'tier=backend,app!=web'
kubectl get nodes -L topology.kubernetes.io/zone   # añade una label como columna (-L)
kubectl get pods -n <ns> --no-headers | wc -l      # contar (sin la línea de cabecera)
kubectl get pods -A | grep -v Running              # lo que NO está Running
```

### Ver el objeto entero o un campo concreto

```bash
kubectl get deploy <nombre> -n <ns> -o yaml                      # todo el objeto en YAML
kubectl get pod <pod> -n <ns> -o jsonpath='{.status.qosClass}'   # un solo campo
kubectl get nodes -o jsonpath='{.items[*].metadata.name}'        # un campo de cada elemento
kubectl get pods -n <ns> -o name                                 # solo nombres: pod/xxx
```

El jsonpath empieza siempre por `{.` y sigue la estructura del YAML: `{.spec.replicas}`, `{.data.clave}`.

### `describe`: el detalle y **el porqué**

```bash
kubectl describe pod <pod> -n <ns>       # ⭐ EL MÁS ÚTIL: lee "Events" al final
kubectl describe deploy <nombre> -n <ns> # Conditions: ReplicaFailure si no puede crear Pods
kubectl describe rs <nombre> -n <ns>     # Events del ReplicaSet: FailedCreate (cuota, PodSecurity)
kubectl describe svc <nombre> -n <ns>    # mira "Selector", "TargetPort" y "Endpoints"
kubectl describe node <nodo>             # capacidad, allocatable, taints, pods del nodo
kubectl describe hpa <nombre> -n <ns>    # por qué no mide
```

### `logs`: lo que escribe la aplicación

```bash
kubectl logs <pod> -n <ns>               # salida del contenedor
kubectl logs <pod> -n <ns> --previous    # ⭐ la del contenedor ANTERIOR (el que murió)
kubectl logs <pod> -n <ns> -f            # seguir en vivo (Ctrl+C para salir)
kubectl logs deploy/<nombre> -n <ns>     # de un pod cualquiera del deployment
kubectl logs job/<nombre> -n <ns>        # salida de un Job
kubectl logs <pod> -n <ns> -c <contenedor>   # un contenedor concreto (también los init containers)
```

### Eventos y consumo

```bash
kubectl get events -n <ns> --sort-by=.lastTimestamp   # qué ha pasado, en orden
kubectl events -n <ns> --types=Warning                # solo avisos (comando más nuevo)
kubectl events -n <ns> --for pod/<pod>                # los de un objeto
kubectl top nodes                                     # CPU/RAM de los nodos (necesita metrics-server)
kubectl top pods -n <ns>                              # CPU/RAM de los pods
```

### Permisos: ¿puedo hacer esto?

```bash
kubectl auth can-i create deployments -n <ns>                                  # yo
kubectl auth can-i list pods -n <ns> --as=system:serviceaccount:<ns>:<sa>      # otra identidad
kubectl auth can-i --list -n <ns>                                              # todo lo que puedo
kubectl auth can-i list pods -A --as=system:serviceaccount:<ns>:<sa>           # en TODOS los namespaces
```

## 2. CREAR

```bash
# Un Deployment (N copias de una imagen que se reponen solas)
kubectl create deployment <nombre> --image=<imagen:tag> --replicas=<N> -n <ns>
#   ej: kubectl create deployment hola --image=nginx:1.27-alpine --replicas=2 -n pruebas

# Un Service delante de un deployment (dirección fija + reparte tráfico)  ← AQUÍ VA EL PUERTO
#   --port = puerto en el que escucha el Service (para nginx: 80)
#   el Service se llama igual que el deployment salvo que pongas --name=<otro>
kubectl expose deployment <nombre> --port=<puerto> -n <ns>                     # interno (ClusterIP)
kubectl expose deployment <nombre> --port=80 --target-port=8080 -n <ns>        # si el contenedor escucha en otro puerto
kubectl expose deployment <nombre> --port=80 --type=LoadBalancer -n <ns>       # público: AWS crea un balanceador
kubectl expose deployment <nombre> --name=<svc> --port=80 --target-port=<puerto|nombre-del-puerto> --type=NodePort -n <ns>   # abre un puerto 30000-32767 en cada nodo

# Configuración y secretos
kubectl create configmap <nombre> --from-literal=<CLAVE>=<valor> -n <ns>
kubectl create secret generic <nombre> --from-literal=<clave>=<valor> -n <ns>

# Un namespace
kubectl create namespace <ns>

# Una tarea que termina (Job) y una tarea programada (CronJob). El comando va detrás de --
kubectl create job <nombre> --image=busybox:1.37 -n <ns> -- echo hola
kubectl create cronjob <nombre> --image=busybox:1.37 --schedule="*/15 * * * *" -n <ns> -- date

# Un autoescalador (HPA)
kubectl autoscale deployment <nombre> --min=<n> --max=<n> --cpu-percent=<porcentaje> -n <ns>
#   cualquier kubectl: --cpu-percent=50   ·   los recientes (1.36) admiten también --cpu=50%

# Límites del namespace
kubectl create quota <nombre> --hard=pods=10,requests.cpu=2 -n <ns>
kubectl create pdb <nombre> --selector=app=<app> --min-available=1 -n <ns>

# Permisos (RBAC)
kubectl create serviceaccount <sa> -n <ns>
kubectl create role <rol> --verb=get,list,watch --resource=pods -n <ns>
kubectl create rolebinding <nombre> --role=<rol> --serviceaccount=<ns>:<sa> -n <ns>
kubectl create rolebinding <nombre> --clusterrole=view --serviceaccount=<ns>:<sa> -n <ns>
kubectl create clusterrole <rol> --verb=get,list,watch --resource=pods                        # como un Role, pero sin namespace
kubectl create clusterrolebinding <nombre> --clusterrole=<rol> --serviceaccount=<ns>:<sa>     # vale en TODOS los namespaces
```

### Crear desde YAML sin fichero (`apply -f -` con heredoc)

```bash
kubectl apply -f - <<'FIN'
apiVersion: v1
kind: ConfigMap
metadata:
  name: ejemplo
  namespace: pruebas
data:
  CLAVE: "valor"
FIN
```

`apply` crea si no existe y actualiza si existe. Plantillas de cada tipo: CHULETA-YAML.

¿No recuerdas los flags? `kubectl create deployment --help` y `kubectl expose --help`: al final traen ejemplos.

## 3. CAMBIAR

```bash
# Cambiar la imagen. El nombre del contenedor sale en "describe deploy"
#   (con "kubectl create deployment" se llama como el nombre de la imagen: nginx, busybox…)
kubectl set image deployment/<nombre> <contenedor>=<imagen:tag> -n <ns>

# Cambiar recursos (CPU en "m" = milésimas: 100m = 0,1 CPU · memoria en Mi/Gi)
kubectl set resources deployment <nombre> --requests=cpu=100m,memory=64Mi -n <ns>
kubectl set resources deployment <nombre> --limits=memory=256Mi -n <ns>

# Variables de entorno
kubectl set env deployment/<nombre> CLAVE=valor -n <ns>      # añadir o cambiar
kubectl set env deployment/<nombre> CLAVE- -n <ns>           # quitar (el - final)
kubectl set env deployment/<nombre> --list -n <ns>           # ver las que tiene
kubectl set env deployment/<nombre> -c <contenedor> CLAVE=valor -n <ns>   # en un contenedor concreto (sin -c: el primero)

# Cambiar a qué pods apunta un Service
kubectl set selector service <nombre> <clave>=<valor> -n <ns>

# Número de copias
kubectl scale deployment <nombre> --replicas=<N> -n <ns>

# Labels y taints de nodos
kubectl label node <nodo> clave=valor                         # poner
kubectl label node <nodo> clave=otro --overwrite              # cambiar una que ya existe
kubectl label node <nodo> clave-                              # quitar
kubectl taint nodes <nodo> clave=valor:NoSchedule             # repeler Pods
kubectl taint nodes <nodo> clave-                             # quitar el taint
kubectl taint nodes --all clave-                              # quitarlo de todos los nodos

# Labels de un namespace (p. ej. su nivel de Pod Security)
kubectl label namespace <ns> clave=valor --overwrite

# Editar cualquier cosa a mano (abre un editor con el YAML; guardar = aplicar)
kubectl edit deployment <nombre> -n <ns>        # imagen, command, sondas, recursos, tolerations, securityContext…
kubectl edit svc <nombre> -n <ns>               # selector, port, targetPort, type
kubectl edit configmap <nombre> -n <ns>         # ⚠️ si los Pods lo leen como variables, no lo ven hasta un  rollout restart
kubectl edit resourcequota <nombre> -n <ns>     # cuotas del namespace
kubectl edit serviceaccount <sa> -n <ns>        # la identidad de los Pods
kubectl edit <tipo> <nombre> -n <ns>            # vale para cualquier objeto: hpa, pdb, netpol, role…
#   en Linux suele abrir vi: "i" para escribir, Esc y ":wq" para guardar y salir, ":q!" para salir sin guardar
#   para usar nano:  export KUBE_EDITOR=nano
```

### `patch`: cambiar un campo sin editor

```bash
# merge: escribes solo la parte del objeto que cambia
kubectl patch deployment <nombre> -n <ns> --type=merge -p '{"spec":{"replicas":3}}'

# json: operaciones exactas sobre una ruta (útil en listas)
kubectl patch deployment <nombre> -n <ns> --type=json \
  -p '[{"op":"replace","path":"/spec/template/spec/containers/0/image","value":"nginx:1.27-alpine"}]'
#   otras rutas («0» = el primer contenedor de la lista; "value" = lo que quieras poner):
#     /spec/template/spec/containers/0/command
#     /spec/template/spec/containers/0/args
#     /spec/template/spec/containers/0/readinessProbe/httpGet/path   (o …/port)
#     /spec/template/spec/containers/0/livenessProbe/httpGet/path    (o …/port)
#   "op": "replace" cambia un campo que existe · "add" lo crea · "remove" lo borra (sin "value")

# otros objetos, con merge
kubectl patch svc <nombre> -n <ns> -p '{"spec":{"ports":[{"port":<puerto>,"targetPort":<puerto-del-contenedor>}]}}'
kubectl patch resourcequota <nombre> -n <ns> -p '{"spec":{"hard":{"pods":"<N>"}}}'
```

Comillas simples por fuera y dobles por dentro. Sin `--type`, kubectl usa `strategic` (parecido a merge, pero sabe fusionar listas como `containers` por nombre).

### Versiones de un deployment (rollout)

```bash
kubectl rollout status  deployment/<nombre> -n <ns>                  # espera a que termine
kubectl rollout history deployment/<nombre> -n <ns>                  # revisiones
kubectl rollout history deployment/<nombre> -n <ns> --revision=2     # detalle de una
kubectl rollout undo    deployment/<nombre> -n <ns>                  # vuelve a la anterior
kubectl rollout undo    deployment/<nombre> -n <ns> --to-revision=1  # vuelve a una concreta
kubectl rollout restart deployment/<nombre> -n <ns>                  # recrea los Pods (relee ConfigMaps en env)
kubectl rollout pause   deployment/<nombre> -n <ns>                  # congelar cambios
kubectl rollout resume  deployment/<nombre> -n <ns>                  # reanudar
```

## 4. DENTRO DE LOS PODS

```bash
# Ejecutar un comando dentro de un contenedor que ya corre (el comando va tras --)
kubectl exec <pod> -n <ns> -- env
kubectl exec deploy/<nombre> -n <ns> -- cat /etc/resolv.conf
kubectl exec -it <pod> -n <ns> -- sh                  # shell interactiva (exit para salir)

# Pod de usar y tirar para probar red/DNS desde dentro (--rm lo borra al salir)
kubectl run prueba --rm -it --image=busybox:1.37 -n <ns> -- nslookup <servicio>
kubectl run prueba --rm -it --image=busybox:1.37 -n <ns> -- wget -qO- -T 3 http://<servicio>

# Túnel desde tu PC a un Service o Pod (se queda abierto hasta Ctrl+C)
kubectl port-forward svc/<servicio> 8080:80 -n <ns>   # luego, en OTRA terminal: curl http://localhost:8080

# Imagen sin shell (exec no sirve): contenedor efímero de depuración dentro del Pod
kubectl debug -it <pod> -n <ns> --image=busybox:1.37 --target=<contenedor>
kubectl debug node/<nodo> -it --image=busybox:1.37    # depurar un nodo
#   qué mirar dentro (PID 1, cgroups, capabilities, token): CHULETA-BAJO-EL-CAPO
```

`busybox` trae `wget`, `nslookup` y `sh`, pero no `curl`.

### Leer un Secret (base64 NO es cifrado)

```bash
kubectl get secret <nombre> -n <ns> -o jsonpath='{.data.<clave>}' | base64 -d
echo 'aG9sYQ==' | base64 -d          # decodificar a mano → hola
echo -n 'hola' | base64              # codificar (-n: sin salto de línea al final)
```

## 5. BORRAR

```bash
kubectl delete pod <pod> -n <ns>                 # su deployment crea otro (útil para "reiniciar")
kubectl delete deployment <nombre> -n <ns>
kubectl delete svc <nombre> -n <ns>              # ⚠️ si era LoadBalancer, borra el balanceador de AWS
kubectl delete cm <nombre> -n <ns>
kubectl delete rolebinding <nombre> -n <ns>
kubectl delete <tipo> <nombre> -n <ns>           # cualquier otro: secret, job, hpa, quota, netpol, role…
kubectl delete clusterrolebinding <nombre>       # los de cluster van sin -n
kubectl delete namespace <ns>                    # ⚠️ borra TODO lo que hay dentro
```

## 6. NODOS

```bash
kubectl get nodes
kubectl describe node <nodo>
kubectl cordon <nodo>        # "no metas más pods aquí" (los que hay siguen)
kubectl uncordon <nodo>      # deshacer el cordon
kubectl drain <nodo> --ignore-daemonsets --delete-emptydir-data                  # cordon + sacar sus pods a otro nodo
kubectl drain <nodo> --ignore-daemonsets --delete-emptydir-data --timeout=120s   # que no espere para siempre
```

### Node group (las EC2 que gestiona EKS) con la AWS CLI

```bash
aws eks describe-nodegroup --cluster-name eks-juego --nodegroup-name ng-juego \
  --query 'nodegroup.[status,scalingConfig]'

# Cambiar el número de nodos (desiredSize debe estar entre minSize y maxSize)
aws eks update-nodegroup-config --cluster-name eks-juego --nodegroup-name ng-juego \
  --scaling-config minSize=1,maxSize=2,desiredSize=<N>
```

### Entrar dentro del nodo (sin SSH)

```bash
aws ec2 describe-instances --filters Name=tag:eks:nodegroup-name,Values=ng-juego Name=instance-state-name,Values=running \
  --query 'Reservations[].Instances[].InstanceId' --output text
aws ssm start-session --target <instance-id>
#   dentro:  sudo systemctl status kubelet  ·  sudo journalctl -u kubelet -n 50  ·  sudo crictl ps  ·  exit
```

Más comandos de AWS: CHULETA-AWS-EKS.

## 7. Diagnosticar: qué significa cada STATUS y qué mirar

| STATUS / síntoma | Qué pasa | Qué miro primero | Se arregla en |
|---|---|---|---|
| `Pending` | No cabe en ningún nodo (falta CPU o memoria, taints, nodeSelector, nodos cordoned) | `describe pod` → Events: *Insufficient cpu*, *untolerated taint* | 3 (`set resources`, labels, taints) · 6 (node group, `uncordon`) |
| `ErrImagePull` / `ImagePullBackOff` | No puede descargar la imagen (nombre o tag mal, o repo privado) | `describe pod` → Events: *not found* | 3 (`set image`, `edit`) |
| `CreateContainerConfigError` | Le falta un ConfigMap o Secret que usa | `describe pod` → Events: *configmap "x" not found* | 2 (crear lo que falta) |
| `CrashLoopBackOff` | Arranca y muere en bucle | `logs --previous` y `describe pod` → *Last State* | 3 (`set env`, `edit`, `patch`) |
| `OOMKilled` (Exit Code 137) | Usó más memoria que su `limits` y el kernel lo mató | `describe pod` → *Limits* vs lo que necesita | 3 (`set resources`) |
| `StartError` / `RunContainerError` | El comando del contenedor no existe o no se puede lanzar | `describe pod` → *executable file not found* | 3 (`edit`, `patch` del command) |
| `Running` pero `0/1` | Vive, pero no pasa la *readiness probe*, así que no recibe tráfico | `describe pod` → *Readiness probe failed…* | 3 (`edit`, `patch` de la sonda) |
| `RESTARTS` que suben con el Pod `Running` | Falla la *liveness probe* y el kubelet lo reinicia | `describe pod` → *Liveness probe failed…* | 3 (`edit`, `patch` de la sonda) |
| `READY 1/2` (Pod con varios contenedores) | Uno de los contenedores no está listo o se reinicia | `describe pod` → el bloque de cada contenedor · `logs -c <contenedor>` | 3 (`edit`, `set env -c`) |
| `Init:0/1` · `Init:CrashLoopBackOff` | Un init container no termina: espera algo o falla | `logs <pod> -c <init>` · `describe pod` → *Init Containers* | Lo que espere: 2 (crear el Service, el Secret…) |
| Menos Pods de los que pide el Deployment | El ReplicaSet no puede crearlos (cuota, PodSecurity) | `get events` → *FailedCreate* | 3 (`edit` la cuota) · CHULETA-SEGURIDAD |
| La versión nueva no termina de desplegarse | Los Pods nuevos fallan; los viejos siguen | `rollout status` · `get pods` | 3 (`rollout undo`) |
| Service sin endpoints | El *selector* del Service no casa con las *labels* de los pods | `get svc -o wide` vs `get pods --show-labels` | 3 (`set selector`, `edit svc`) |
| Service con endpoints que no responde | `targetPort` distinto del puerto del contenedor, o NetworkPolicy | `describe svc` → *TargetPort* | 3 (`edit svc`, `patch svc`) · CHULETA-RED |
| Service LoadBalancer en `<pending>` | AWS aún lo crea (2-4 min) o no puede | `describe svc` → Events | Esperar, o 2 (`expose --type=LoadBalancer`) |
| No llega a un Service de OTRO namespace | Los nombres cortos solo valen en el mismo namespace | `nslookup <servicio>.<namespace>` | Usa `<servicio>.<namespace>` · 3 (`set env`) |
| Nada resuelve nombres (DNS) | CoreDNS caído | `get deploy -n kube-system` → `coredns` | 3: es un Deployment más |
| HPA con TARGETS `<unknown>` | Los Pods no tienen `requests.cpu` (o falta metrics-server) | `describe hpa` | 3 (`set resources --requests`) |
| `drain` que no acaba | Un PodDisruptionBudget no permite sacar más Pods | `get pdb` → ALLOWED DISRUPTIONS | 3 (`scale`) · CHULETA-CAPACIDAD |
| Nodo `NotReady` | El kubelet o la instancia han caído | `describe node` → Conditions | 6 · CHULETA-AWS-EKS |
| `Unauthorized` en kubectl | Sesión AWS caducada o contexto equivocado | `aws sts get-caller-identity`, `aws sso login …` | 0 (contexto) |
| `Forbidden` | Estás autenticado pero RBAC no te deja | `kubectl auth can-i …` | 2 (role, rolebinding) · 5 (el que sobra) |

El detalle de cada caso, con el mensaje exacto, está en CHULETA-DIAGNOSTICO.

### El método de 4 pasos (sirve para el 90 % de los fallos)

```text
1. kubectl get pods -n <ns>                 → ¿qué STATUS tiene?
2. kubectl describe pod <pod> -n <ns>       → lee los EVENTS del final
3. kubectl logs <pod> -n <ns> [--previous]  → ¿qué dice la aplicación?
4. Si el pod está bien pero no llega tráfico → describe svc / get endpoints
```

## 8. Trucos que ahorran tiempo

```bash
alias k=kubectl                                    # luego: k get pods -A
kubectl config set-context --current --namespace=nivel-2   # deja nivel-2 por defecto (ya no hace falta -n)
kubectl explain deployment.spec.replicas           # documentación de cualquier campo
kubectl explain deployment.spec.template.spec.containers.livenessProbe
kubectl api-resources                              # todos los tipos de objeto y sus abreviaturas
kubectl create deployment x --image=nginx --dry-run=client -o yaml   # genera el YAML sin crear nada
```

Abreviaturas: `po` = pods · `deploy` = deployments · `rs` = replicasets · `svc` = services · `cm` = configmaps · `ns` = namespaces · `no` = nodes · `ep` = endpoints · `ds` = daemonsets · `sa` = serviceaccounts · `quota` = resourcequotas · `pdb` = poddisruptionbudgets · `netpol` = networkpolicies.

### Atajos (alias) habituales

Son los del plugin `kubectl` de oh-my-zsh y de kubectl-aliases; el juego los trae puestos (escribe `alias` para verlos todos). En tu PC: `alias k=kubectl` en el `~/.bashrc`, o el plugin.

| Atajo | Es | Atajo | Es |
|---|---|---|---|
| `k` | `kubectl` | `kd` | `kubectl describe` |
| `kg` | `kubectl get` | `kdp` · `kdd` · `kds` · `kdn` | `describe` pods · deployment · svc · node |
| `kgp` · `kgpw` · `kgpa` | `get pods` · `-o wide` · `--all-namespaces` | `kl` · `klf` · `klp` | `logs` · `logs -f` · `logs --previous` |
| `kgd` · `kgs` · `kgn` | `get deployment` · `svc` · `nodes` | `kex` | `kubectl exec -it` |
| `kga` · `kgaa` | `get all` · en todos los namespaces | `kaf` | `kubectl apply -f` |
| `kgns` · `kgcm` · `kgsec` | `get namespaces` · `configmaps` · `secret` | `ke` · `ked` | `kubectl edit` · `edit deployment` |
| `kge` | `get events --sort-by=.lastTimestamp` | `kdel` · `kdelp` · `kdeld` | `delete` · pods · deployment |
| `ksd` | `kubectl scale deployment` | `kpf` | `kubectl port-forward` |
| `krsd` · `krh` · `kru` · `krrd` | `rollout status` · `history` · `undo` · `restart` | `ktp` · `ktn` | `top pods` · `top nodes` |
| `kcn <ns>` | fija el namespace (`config set-context --current --namespace`) | `kubens <ns>` · `kns` | lo mismo, con la herramienta kubens |

```bash
alias kk='kubectl get pods -o wide'      # crear el tuyo (en el juego dura la sesión)
unalias kk                               # quitarlo
kubens nivel-14                          # a partir de aquí no hace falta -n nivel-14
kubens default                           # volver
```

## 9. Los comandos del juego (navegador)

```text
help                 # todos los comandos que entiende el simulador
mapa                 # los 76 niveles y cuáles llevas (se desbloquean en orden)
mision               # vuelve a enseñar la misión
pista                # una pista (−20 XP)
comprobar            # ¿lo he resuelto? (las misiones se comprueban solas)
responder 17         # niveles de pregunta
solucion             # la solución (el nivel queda a 0 XP)
repetir              # vuelve a montar el nivel desde cero
siguiente · anterior · nivel 23
```
