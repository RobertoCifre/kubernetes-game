# Chuleta: bajo el capó (qué hay DENTRO de un contenedor)

Un contenedor no es una máquina virtual. Es un **proceso normal del nodo** al que Linux le pone tres cosas:

| Pieza de Linux | Qué hace | Dónde lo ves |
|---|---|---|
| **namespaces** | Aíslan lo que el proceso VE: sus propios PIDs, su red, su hostname, sus montajes | `ps` dentro: tu programa es el PID 1 |
| **cgroups** (v2) | Limitan lo que el proceso GASTA: memoria, CPU, número de procesos | `/sys/fs/cgroup/` |
| **capabilities + seccomp** | Recortan lo que el proceso PUEDE HACER, aunque sea root | `/proc/1/status` |

Kubernetes no inventa nada: el kubelet traduce tu YAML a estas piezas y se lo pasa a containerd.

## 1. Procesos: el PID 1

```bash
kubectl exec -it <pod> -n <ns> -- sh
ps                          # PID 1 = el programa de la imagen (CMD/ENTRYPOINT)
cat /proc/1/cmdline         # el comando exacto del PID 1
cat /proc/1/environ         # sus variables de entorno (en el real van separadas por \0: tr '\0' '\n')
```

- Si el PID 1 termina, el contenedor termina. Por eso nginx corre con `daemon off;` (en primer plano).
- En el **nodo**, ese mismo proceso tiene otro PID cualquiera: el PID 1 es solo «dentro de su namespace».
- `shareProcessNamespace: true` en el Pod hace que todos sus contenedores vean los procesos de todos (y el PID 1 pasa a ser `/pause`).

## 2. cgroups: los requests y limits, escritos en ficheros

| En el YAML | Fichero del cgroup v2 | Ejemplo |
|---|---|---|
| `limits.memory: 128Mi` | `memory.max` | `134217728` (128 × 1024 × 1024 bytes) |
| sin `limits.memory` | `memory.max` | `max` (sin límite: puede comerse el nodo) |
| `limits.cpu: 250m` | `cpu.max` | `25000 100000` = 25 ms de cada 100 ms |
| `requests.cpu: 250m` | `cpu.weight` | `10` (el reparto cuando varios compiten) |
| `requests.memory` | (ninguno) | sirve al scheduler y a la prioridad de OOM, no se escribe aquí |

```bash
cat /sys/fs/cgroup/memory.max       # el límite
cat /sys/fs/cgroup/memory.current   # lo que usa AHORA
cat /sys/fs/cgroup/memory.events    # oom_kill N → cuántas veces lo ha matado el kernel
cat /sys/fs/cgroup/cpu.max          # «cuota periodo»
cat /sys/fs/cgroup/cpu.stat         # nr_throttled / throttled_usec → ¿le frenan la CPU?
```

- **Memoria**: si `memory.current` llega a `memory.max`, el kernel mata el proceso → `OOMKilled`, exit code 137.
- **CPU**: si gasta su cuota antes de acabar el periodo, el kernel lo **frena** (throttling). No muere: va lento. Una aplicación lenta con `nr_throttled` subiendo pide más `limits.cpu`.

## 3. Usuario y capabilities

```bash
id                                   # uid=0(root) o uid=101(nginx)…
grep -E 'Uid|Cap|NoNewPrivs|Seccomp' /proc/1/status
```

| Línea | Qué significa |
|---|---|
| `Uid:` | El usuario real. `runAsUser` en el securityContext lo cambia |
| `CapEff:` | Capabilities EFECTIVAS (máscara hexadecimal). `00000000a80425fb` = las 14 que da containerd por defecto. `0000000000000000` = ninguna |
| `CapBnd:` | El tope que nunca podrá superar (aunque ejecute un programa setuid) |
| `NoNewPrivs: 1` | `allowPrivilegeEscalation: false`: ningún programa puede ganar privilegios |
| `Seccomp: 2` | Filtro de llamadas al sistema activo (`seccompProfile: RuntimeDefault`) |

Para traducir la máscara a nombres (en un Linux con `libcap`, no en busybox): `capsh --decode=00000000a80425fb`.

Un usuario que no es root tiene `CapEff` a cero aunque no quites nada. Lo más seguro es las dos cosas: `runAsNonRoot: true` **y** `capabilities: {drop: ["ALL"]}`. Si la aplicación necesita una concreta (por ejemplo, abrir el puerto 80), se añade solo esa: `add: ["NET_BIND_SERVICE"]`.

## 4. El token de la ServiceAccount

```bash
ls /var/run/secrets/kubernetes.io/serviceaccount/     # ca.crt  namespace  token
cat /var/run/secrets/kubernetes.io/serviceaccount/token
```

- Es la credencial del Pod frente a la API de Kubernetes. Caduca y el kubelet la renueva sola.
- Si la aplicación no habla con la API, **no la montes**: `automountServiceAccountToken: false` en la ServiceAccount (vale para todos sus Pods) o en el `spec` del Pod.
- Se decide **al crear el Pod**: si cambias la ServiceAccount, los Pods que ya existen siguen con el token → `kubectl rollout restart`.

## 5. Init containers

```yaml
spec:
  initContainers:
  - name: espera-bd
    image: busybox:1.37
    command: ["sh", "-c", "until nslookup bd; do echo esperando a bd; sleep 2; done"]
  containers:
  - name: app
    image: nginx:1.27-alpine
```

| STATUS | Qué pasa |
|---|---|
| `Init:0/1` | El primer init container aún no ha terminado (¿espera algo?) |
| `Init:Error` / `Init:CrashLoopBackOff` | Un init container falla: se reintenta con espera creciente |
| `PodInitializing` | Los init terminaron; arranca el contenedor principal |

```bash
kubectl logs <pod> -c espera-bd -n <ns>          # los logs de UN contenedor concreto
kubectl describe pod <pod> -n <ns>               # sección «Init Containers»
```

Se ejecutan **en orden** y cada uno tiene que acabar bien (exit 0) antes del siguiente. Pod Security también se aplica a ellos.

## 6. kubectl debug: entrar donde no hay shell

Las imágenes mínimas («distroless», `pause`…) no traen `sh`, ni `ps`, ni `cat`: `kubectl exec` no sirve.

```bash
# contenedor EFÍMERO dentro del Pod, compartiendo los procesos del contenedor objetivo
kubectl debug -it <pod> -n <ns> --image=busybox:1.37 --target=<contenedor>
ps                         # ves el PID 1 del objetivo
ls /proc/1/root/           # su sistema de ficheros (puede dar «Permission denied» si los usuarios no coinciden)

# depurar un NODO: un Pod con los namespaces del host; su disco está en /host
kubectl debug node/<nodo> -it --image=busybox:1.37
```

- Sin `--target` compartes la red del Pod, pero no ves sus procesos.
- Un contenedor efímero no se puede quitar: desaparece cuando se borra el Pod.

## 7. Permisos de cluster: ClusterRole y ClusterRoleBinding

| Quiero dar… | Objeto «qué» | Objeto «a quién» |
|---|---|---|
| permisos en UN namespace | Role | RoleBinding |
| permisos en TODOS los namespaces | ClusterRole | ClusterRoleBinding |
| un ClusterRole reutilizable, pero solo en un namespace | ClusterRole | RoleBinding |

```bash
kubectl create clusterrole ver-pods-global --verb=get,list,watch --resource=pods
kubectl create clusterrolebinding auditor-ver-pods --clusterrole=ver-pods-global --serviceaccount=<ns>:<sa>
kubectl auth can-i list pods -A --as=system:serviceaccount:<ns>:<sa>      # -A = en todos los namespaces
kubectl auth can-i list secrets -n kube-system --as=system:serviceaccount:<ns>:<sa>   # lo que NO debe poder
```

Cuidado con los atajos: los ClusterRoles `view`, `edit` y `admin` dan mucho más de lo que parece. Mínimo privilegio es escribir el tuyo.

## 8. EKS Pod Identity: credenciales de AWS sin claves

```bash
aws eks create-pod-identity-association --cluster-name <cluster> \
  --namespace <ns> --service-account <sa> --role-arn arn:aws:iam::<cuenta>:role/<rol>
aws eks list-pod-identity-associations --cluster-name <cluster>
kubectl rollout restart deployment <dep> -n <ns>      # los Pods ya creados no la ven
kubectl exec deploy/<dep> -n <ns> -- env | grep AWS_  # dentro: AWS_CONTAINER_CREDENTIALS_FULL_URI…
```

- Necesita el add-on `eks-pod-identity-agent` (un DaemonSet en `kube-system`) y un rol IAM cuya política de confianza admita a `pods.eks.amazonaws.com` (`sts:AssumeRole` y `sts:TagSession`).
- Los SDK de AWS leen esas variables solos: no hay claves en Secrets que se puedan filtrar ni caducar.
