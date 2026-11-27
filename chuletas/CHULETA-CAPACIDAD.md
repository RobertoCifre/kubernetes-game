# Chuleta de capacidad: recursos, scheduler, escalado y mantenimiento

## requests y limits

| Campo | Lo usa | Efecto |
|---|---|---|
| `requests.cpu` / `requests.memory` | El scheduler | Reserva: el Pod solo va a un nodo donde quepa lo pedido |
| `limits.memory` | El kernel (cgroups) | Si se supera, el proceso muere: OOMKilled, Exit Code 137 |
| `limits.cpu` | El kernel (cgroups) | Si se supera, el proceso se frena (*throttling*), no muere |

Unidades: CPU en milésimas (`100m` = 0,1 CPU; `1` = 1 CPU). Memoria en `Mi`/`Gi` (potencias de 2) o `M`/`G` (potencias de 10).

```bash
kubectl set resources deployment <app> --requests=cpu=100m,memory=64Mi --limits=memory=128Mi -n <ns>
kubectl describe node <nodo> | grep -A8 "Allocated resources"    # cuánto está reservado
kubectl top pods -n <ns>                                         # cuánto se usa de verdad
```

El scheduler mira los **requests**, no el uso real. Un nodo puede estar "lleno" con la CPU ociosa.

## Cómo decide el scheduler

Para cada nodo, primero filtra (¿puede ir aquí?) y luego puntúa (¿dónde mejor?). Si ningún nodo pasa los filtros, el Pod se queda Pending.

| Filtro | Mensaje si no se cumple |
|---|---|
| Caben los requests de CPU | `Insufficient cpu` |
| Caben los requests de memoria | `Insufficient memory` |
| Quedan huecos de Pod (máximo por nodo) | `Too many pods` |
| Tolera los taints del nodo | `had untolerated taint {clave: valor}` |
| Cumple `nodeSelector` / affinity | `didn't match Pod's node affinity/selector` |
| El nodo no está en cordon | `node(s) were unschedulable` |

## QoS: quién muere primero

| Clase | Cuándo | Prioridad al desalojar |
|---|---|---|
| Guaranteed | Todos los contenedores con requests = limits de CPU y memoria | Lo último en salir |
| Burstable | Algún request o limit, sin llegar a Guaranteed | En medio |
| BestEffort | Ningún request ni limit | Lo primero en salir |

Si un nodo se queda sin memoria, el kubelet desaloja primero los BestEffort, luego los Burstable y al final los Guaranteed (documentación oficial de QoS).

```bash
kubectl get pod <pod> -n <ns> -o jsonpath='{.status.qosClass}'
kubectl describe pod <pod> -n <ns> | grep "QoS Class"
```

## OOMKilled frente a throttling

| Síntoma | Causa | Dónde se ve |
|---|---|---|
| Reinicios con `Reason: OOMKilled`, Exit Code 137 | Superó `limits.memory` | `kubectl describe pod` → Last State |
| La app va lenta, sin reinicios | Llega a `limits.cpu` y se frena | Métricas de throttling del contenedor (cgroup `cpu.stat`) |

## ResourceQuota y LimitRange

| Objeto | Qué hace |
|---|---|
| ResourceQuota | Tope total del namespace: número de Pods, suma de requests y limits… |
| LimitRange | Valores por defecto y mínimos/máximos por contenedor en el namespace |

```bash
kubectl get quota,limitrange -n <ns>
kubectl describe quota -n <ns>              # Used frente a Hard
kubectl edit resourcequota <nombre> -n <ns>
```

Si una cuota impide crear Pods, no verás Pods en error: el ReplicaSet registra `FailedCreate … exceeded quota` en los eventos (`kubectl get events -n <ns>`).

## HPA: escalar Pods

```bash
kubectl autoscale deployment <app> --min=1 --max=5 --cpu-percent=60 -n <ns>
kubectl get hpa -n <ns> -w
kubectl describe hpa <app> -n <ns>
```

Fórmula (documentación oficial):

```text
réplicas deseadas = ceil( réplicas actuales × valor actual / valor objetivo )
ejemplo: 2 réplicas al 90 % con objetivo 60 % → ceil(2 × 90 / 60) = 3
```

Requisitos:

- metrics-server instalado (`kubectl top pods` funciona).
- `requests.cpu` en el Deployment: el porcentaje es uso / request. Sin request, TARGETS sale `<unknown>`.
- Tiempo: unos minutos hasta tener métricas y para que estabilice.

## Escalar nodos

| Forma | Cómo | Cuándo |
|---|---|---|
| Node group a mano | `aws eks update-nodegroup-config … --scaling-config desiredSize=N` | Laboratorio o cambios puntuales |
| Cluster Autoscaler | Sube o baja el ASG del node group cuando hay Pods Pending | Clásico, con node groups |
| Karpenter | Crea las EC2 que hagan falta, del tamaño justo, sin node groups | Lo moderno en EKS (capítulo 09 del curso) |

`desiredSize` tiene que quedar entre `minSize` y `maxSize`: para pasar de 2 a 3 nodos, sube también `maxSize`. Comandos en CHULETA-AWS-EKS.

## Taints y tolerations

Un taint en el nodo repele Pods. Una toleration en el Pod le deja entrar.

```bash
kubectl taint nodes <nodo> dedicado=gpu:NoSchedule        # poner
kubectl taint nodes <nodo> dedicado-                      # quitar (todas las variantes de esa clave)
kubectl taint nodes --all dedicado-                       # quitar de todos
kubectl describe node <nodo> | grep Taints
```

| Efecto | Qué hace |
|---|---|
| `NoSchedule` | No entran Pods nuevos sin toleration; los que hay se quedan |
| `PreferNoSchedule` | Lo evita si puede |
| `NoExecute` | Además expulsa a los que ya estaban sin toleration |

Toleration en el Pod (dentro de `spec.template.spec`):

```yaml
tolerations:
- key: dedicado
  operator: Equal
  value: gpu
  effect: NoSchedule
```

## nodeSelector y labels de nodo

```bash
kubectl get nodes --show-labels
kubectl get nodes -L topology.kubernetes.io/zone,node.kubernetes.io/instance-type
kubectl label node <nodo> disco=ssd
kubectl label node <nodo> disco-                  # quitar
```

`nodeSelector: {disco: ssd}` en el Pod = solo nodos con esa label. En EKS, las labels fijas se ponen en el node group o en el NodePool de Karpenter, porque un nodo nuevo no hereda las que pusiste a mano.

## cordon, drain y uncordon

```bash
kubectl cordon <nodo>                                            # no entran Pods nuevos
kubectl drain <nodo> --ignore-daemonsets --delete-emptydir-data  # cordon + desalojar
kubectl drain <nodo> --ignore-daemonsets --delete-emptydir-data --timeout=120s
kubectl uncordon <nodo>                                          # vuelve a servicio
```

- `--ignore-daemonsets`: los Pods de DaemonSet no se mueven (volverían al mismo nodo).
- `--delete-emptydir-data`: acepta perder los datos de volúmenes `emptyDir`.
- Los Pods sueltos (sin Deployment) no se recrean en otro sitio: drain se niega salvo con `--force`.

## PodDisruptionBudget (PDB)

Limita cuántos Pods de una aplicación pueden caer a la vez en desalojos voluntarios: drain, actualizaciones de nodos, consolidación de Karpenter.

```bash
kubectl create pdb <nombre> --selector=app=<app> --min-available=1 -n <ns>
kubectl get pdb -n <ns>          # mira ALLOWED DISRUPTIONS
```

| Configuración | Con 2 réplicas | ALLOWED DISRUPTIONS |
|---|---|---|
| `minAvailable: 1` | Puede caer 1 | 1 |
| `minAvailable: 2` | No puede caer ninguna | 0: bloquea cualquier drain |
| `maxUnavailable: 1` | Puede caer 1 | 1 |

Si ALLOWED DISRUPTIONS es 0, el drain se queda reintentando (`Cannot evict pod as it would violate the pod's disruption budget`). Arreglo sin tocar el PDB: más réplicas, para que sobre alguna.

## DaemonSets: un Pod en cada nodo

```bash
kubectl get ds -A
#   columnas: DESIRED = en cuántos nodos debe haber uno · READY = cuántos funcionan
kubectl get pods -n kube-system -o wide | grep aws-node
```

En EKS, `aws-node` (red, VPC CNI) y `kube-proxy` (reglas de Services) son DaemonSets: hay uno por nodo, y al añadir un nodo aparecen solos. También cuentan para el máximo de Pods del nodo.
