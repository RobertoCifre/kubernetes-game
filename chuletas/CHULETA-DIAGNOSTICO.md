# Chuleta de diagnóstico: qué le pasa a mi Pod

Busca el STATUS que ves en `kubectl get pods`, lee el mensaje típico y confirma con el comando. Los mensajes reales pueden variar algo de versión a versión; la idea clave se mantiene.

## El método de 4 pasos

```text
1. kubectl get pods -n <ns>                     → ¿qué STATUS tiene?
2. kubectl describe pod <pod> -n <ns>           → lee los Events del final
3. kubectl logs <pod> -n <ns> [--previous]      → ¿qué dice la aplicación?
4. Si el Pod está bien pero no llega tráfico    → describe svc / get endpoints
```

Regla de oro: si no hay Pods (ni siquiera Pending), el problema está un nivel más arriba, en el ReplicaSet. Mira `kubectl get events -n <ns>`.

## Pending: no cabe en ningún nodo

El scheduler no encuentra nodo. El motivo exacto está en los Events del Pod.

| Mensaje en Events | Causa | Arreglo típico |
|---|---|---|
| `0/1 nodes are available: 1 Insufficient cpu` | Los requests de CPU no caben | Bajar `requests.cpu` o añadir nodos |
| `Insufficient memory` | Los requests de memoria no caben | Bajar `requests.memory` o añadir nodos |
| `Too many pods` | El nodo llegó a su máximo de Pods (red: VPC CNI) | Más nodos, o menos réplicas |
| `had untolerated taint {clave: valor}` | El nodo tiene un taint y el Pod no lo tolera | Quitar el taint o añadir una toleration |
| `didn't match Pod's node affinity/selector` | `nodeSelector` o affinity sin nodo que cumpla | Etiquetar un nodo o cambiar el selector |
| `node(s) were unschedulable` | Nodos en cordon (mantenimiento) | `kubectl uncordon` cuando acabe |

```bash
kubectl describe pod <pod> -n <ns> | tail -20
kubectl describe node <nodo> | grep -A8 -E "Taints|Allocatable|Allocated resources"
kubectl get nodes -L <label>
```

## ContainerCreating durante mucho tiempo

Lo normal es que dure segundos. Si se eterniza, mira los Events: suele ser un volumen que no se monta, un ConfigMap o Secret montado como volumen que no existe, o que no quedan IPs en la subnet ("failed to assign an IP address to container").

```bash
kubectl describe pod <pod> -n <ns> | tail -15
```

## ErrImagePull e ImagePullBackOff: la imagen no se descarga

`ErrImagePull` es el fallo inmediato; `ImagePullBackOff` es Kubernetes esperando cada vez más antes de reintentar. La causa es la misma.

| Mensaje en Events | Causa |
|---|---|
| `failed to resolve reference "docker.io/library/nginx:9.99": … not found` | El tag no existe |
| `pull access denied, repository does not exist or may require authorization` | El repositorio no existe (errata en el nombre) o es privado |
| `i/o timeout` o `dial tcp … timeout` | El nodo no sale a Internet (sin NAT ni endpoints de VPC) |

```bash
kubectl describe pod <pod> -n <ns> | grep -A3 -i image
kubectl get deploy <nombre> -n <ns> -o jsonpath='{.spec.template.spec.containers[*].image}'
```

Arreglo: `kubectl set image deployment/<nombre> <contenedor>=<imagen:tag> -n <ns>`.

## CreateContainerConfigError: le falta configuración

El contenedor no se crea porque algo que usa no existe.

| Mensaje en Events | Causa |
|---|---|
| `Error: configmap "x" not found` | Falta el ConfigMap |
| `Error: secret "x" not found` | Falta el Secret |
| `Error: couldn't find key K in ConfigMap ns/x` | Existe, pero no tiene esa clave |
| `Error: container has runAsNonRoot and image will run as root` | El Pod exige no-root y la imagen corre como root |

```bash
kubectl describe pod <pod> -n <ns> | tail -10
kubectl get cm,secret -n <ns>
```

Se arregla creando lo que falta. El Pod lo reintenta solo y arranca: no hace falta borrar nada.

## CrashLoopBackOff: arranca y muere en bucle

El proceso del contenedor termina y Kubernetes lo reinicia con esperas crecientes. La clave es el Exit Code del intento anterior.

```bash
kubectl logs <pod> -n <ns> --previous              # lo que dijo antes de morir
kubectl describe pod <pod> -n <ns> | grep -A6 "Last State"
```

### Tabla de exit codes

| Exit Code | Significado | Dónde mirar |
|---|---|---|
| 0 | Terminó "bien"… pero un Deployment espera un proceso que no acabe | El comando del contenedor no se queda corriendo |
| 1 | La aplicación decidió salir con error | `logs --previous`: el mensaje de la app |
| 2 | Uso incorrecto del comando o de la shell | `logs --previous` y el comando |
| 126 | El comando existe pero no se puede ejecutar (permisos) | El fichero o binario y sus permisos |
| 127 | Comando no encontrado (dentro de una shell: `sh -c`) | Errata en el comando |
| 128 | El runtime no pudo arrancar el proceso (StartError) (no comprobado en este cluster) | `describe pod` → Message |
| 137 | Matado con SIGKILL: OOMKilled, o no paró a tiempo tras SIGTERM | `describe pod` → Reason |
| 139 | Fallo de segmentación (SIGSEGV) | Bug de la aplicación o binario incompatible |
| 143 | Terminado con SIGTERM (parada ordenada) | Normal al parar; raro si se repite |

Los códigos mayores de 128 son 128 + número de señal: 137 = 128 + 9 (KILL), 143 = 128 + 15 (TERM).

## OOMKilled: se quedó sin memoria

`Last State: Terminated, Reason: OOMKilled, Exit Code: 137`. El contenedor usó más memoria que su `limits.memory` y el kernel lo mató.

```bash
kubectl describe pod <pod> -n <ns> | grep -E -A3 "Limits|Last State"
kubectl top pod <pod> -n <ns>
```

Arreglo: subir `limits.memory` por encima de lo que la aplicación usa de verdad, o hacer que use menos. La CPU nunca provoca OOMKilled: se estrangula (CHULETA-CAPACIDAD).

## StartError o RunContainerError: ni siquiera arranca el proceso

Mensaje típico: `exec: "nombre": executable file not found in $PATH`. El `command` del contenedor apunta a algo que no existe en la imagen (errata, o imagen sin ese programa).

```bash
kubectl get deploy <nombre> -n <ns> -o jsonpath='{.spec.template.spec.containers[0].command}'
```

Arreglo: corregir `command`/`args` con `kubectl edit` o `kubectl patch --type=json`.

## Running pero READY 0/1: vive, pero no recibe tráfico

La readiness probe falla: el Pod sale de los endpoints del Service, pero no se reinicia.

| Mensaje en Events | Causa |
|---|---|
| `Readiness probe failed: HTTP probe failed with statuscode: 404` | La ruta de la probe no existe |
| `Readiness probe failed: … connection refused` | Puerto equivocado en la probe |
| `Readiness probe failed: …` con un comando `exec` | El comando de la probe falla (por ejemplo, no llega a otro servicio) |

```bash
kubectl describe pod <pod> -n <ns> | grep -E "Readiness|Liveness|Warning"
```

## RESTARTS que suben con el Pod Running

La liveness probe falla y el kubelet mata el contenedor: `Liveness probe failed: … connection refused` y `Container x failed liveness probe, will be restarted`. Una liveness mal configurada (puerto, ruta o tiempos) tumba aplicaciones sanas.

## Completed

Normal en un Job. En un Deployment significa que el proceso terminó: el Pod pasará a CrashLoopBackOff con `Last State: Completed, Exit Code: 0`. El contenedor de un Deployment tiene que quedarse corriendo.

## Terminating que no acaba

Causas típicas: el nodo del Pod está caído (el kubelet no confirma), o el objeto tiene finalizers pendientes.

```bash
kubectl get pod <pod> -n <ns> -o jsonpath='{.metadata.finalizers}'
kubectl get nodes
```

Último recurso, sabiendo lo que haces: `kubectl delete pod <pod> -n <ns> --grace-period=0 --force` (no espera confirmación del nodo).

## Nodo NotReady

El kubelet del nodo dejó de informar: `Kubelet stopped posting node status`, con las condiciones en `Unknown`. Por defecto, sus Pods se desalojan pasados unos 5 minutos.

```bash
kubectl get nodes
kubectl describe node <nodo> | grep -A8 Conditions
kubectl get node <nodo> -o jsonpath='{.spec.providerID}'    # aws:///<zona>/<instance-id>
```

En EKS un nodo roto no se repara: se sustituye. Ver CHULETA-AWS-EKS (terminate-instances).

## FailedCreate: el Deployment quiere N Pods y hay menos

Los Pods ni siquiera existen. El error está en el ReplicaSet.

| Mensaje | Causa |
|---|---|
| `exceeded quota: x, requested: pods=1, used: pods=2, limited: pods=2` | ResourceQuota del namespace |
| `violates PodSecurity "restricted:latest": allowPrivilegeEscalation != false …` | Pod Security Admission del namespace |
| `must specify limits.memory` o `requests.cpu` | Una cuota exige recursos declarados |

```bash
kubectl get events -n <ns> --sort-by=.lastTimestamp
kubectl describe rs -n <ns> | tail -15
kubectl describe quota -n <ns>
kubectl get ns <ns> --show-labels
```

## Tráfico: el Service no llega

| Síntoma | Causa típica | Confirmar |
|---|---|---|
| `kubectl get endpoints` da `<none>` | El selector del Service no casa con las labels de los Pods, o los Pods no están listos | `kubectl get svc <s> -o wide` y `kubectl get pods --show-labels` |
| Hay endpoints pero `connection refused` | `targetPort` distinto del puerto donde escucha el contenedor | `kubectl describe svc <s>` → TargetPort |
| Hay endpoints pero `timeout` | Una NetworkPolicy lo bloquea | `kubectl get netpol -n <ns>` |
| `bad address` o `could not resolve host` | DNS: nombre mal, otro namespace o CoreDNS caído | Ver DNS abajo |

Probar desde dentro:

```bash
kubectl run prueba --rm -it --image=busybox:1.37 -n <ns> -- wget -qO- -T 3 http://<servicio>
```

## DNS

| Síntoma | Causa |
|---|---|
| Un nombre corto no resuelve desde otro namespace | Los nombres cortos solo valen en el mismo namespace: usa `<svc>.<ns>` |
| Nada resuelve: `connection timed out; no servers could be reached` | CoreDNS caído o escalado a 0 |

```bash
kubectl run dns --rm -it --image=busybox:1.37 -n <ns> -- nslookup kubernetes.default
kubectl get deploy coredns -n kube-system        # CoreDNS es un Deployment más: ¿cuántas réplicas tiene listas?
```

CoreDNS se arregla como cualquier Deployment (CHULETA-COMANDOS, 3. CAMBIAR).

## HPA con TARGETS `<unknown>`

| Mensaje en `describe hpa` | Causa |
|---|---|
| `missing request for cpu` | El Deployment no declara `requests.cpu`: sin request no hay porcentaje |
| `unable to fetch metrics` | No hay metrics-server o aún no tiene datos (espera 1-2 min) |

## drain bloqueado por un PDB

`error when evicting pods/"x" -n "ns" (will retry after 5s): Cannot evict pod as it would violate the pod's disruption budget.` El drain reintenta indefinidamente.

```bash
kubectl get pdb -n <ns>          # ALLOWED DISRUPTIONS = 0 → nada se puede desalojar
```

Arreglo sin tocar el PDB: más réplicas, para que sobre una. Para no esperar para siempre, usa `--timeout=120s` en el drain.

## Unauthorized y Forbidden

| Error | Significa | Confirmar |
|---|---|---|
| `You must be logged in to the server (Unauthorized)` | IAM: la credencial caducó, es de otra cuenta o no tiene access entry | `aws sts get-caller-identity`, `kubectl config current-context` |
| `… is forbidden: User "x" cannot list resource "pods" … in the namespace "y"` | RBAC: estás dentro, pero sin permiso para eso | `kubectl auth can-i list pods -n y` |

Detalle en CHULETA-SEGURIDAD.
