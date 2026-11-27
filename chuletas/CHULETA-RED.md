# Chuleta de red: Services, DNS y NetworkPolicy

## Services: los cuatro tipos

| Tipo | Quién llega | Para qué |
|---|---|---|
| ClusterIP (por defecto) | Solo desde dentro del cluster | Comunicación entre aplicaciones |
| NodePort | Desde fuera, a `IP-del-nodo:30000-32767` | Pruebas, o detrás de un balanceador propio |
| LoadBalancer | Desde fuera, por un balanceador de AWS | Publicar en Internet o en la VPC |
| Headless (`clusterIP: None`) | El DNS devuelve las IPs de los Pods, sin IP virtual | StatefulSets, bases de datos con réplicas |

```bash
kubectl expose deployment <app> --port=80 -n <ns>                      # ClusterIP
kubectl expose deployment <app> --port=80 --type=LoadBalancer -n <ns>  # LoadBalancer
kubectl get svc -n <ns> -o wide                                        # tipo, IP, puertos, SELECTOR
```

## Los tres puertos (la confusión más típica)

| Campo | Dónde | Significa |
|---|---|---|
| `port` | Service | Donde escucha el Service. Es el que usan los clientes: `http://<svc>:<port>` |
| `targetPort` | Service | Donde escucha el contenedor. Si no se pone, vale lo mismo que `port` |
| `containerPort` | Pod | Informativo: documenta el puerto, pero no abre ni cierra nada |

```text
cliente ──► Service web:80 ──► (targetPort) ──► Pod 10.20.33.15:80
```

Si `targetPort` no coincide con el puerto real del proceso, el Service tiene endpoints pero las conexiones dan `connection refused`.

```bash
kubectl describe svc <svc> -n <ns> | grep -E "Port|TargetPort|Endpoints"
kubectl describe pod <pod> -n <ns> | grep -i port
```

## Endpoints y EndpointSlices

Son la lista real de IPs de Pods a las que el Service manda tráfico: solo Pods **listos** (readiness OK) que cumplen el selector.

```bash
kubectl get endpoints <svc> -n <ns>                                  # API antigua, aún útil
kubectl get endpointslices -n <ns> -l kubernetes.io/service-name=<svc>
```

| Ves | Significa |
|---|---|
| `<none>` | Ningún Pod cumple el selector, o ninguno está listo |
| Menos IPs de las esperadas | Algunos Pods fallan la readiness |
| IPs, pero no responde | `targetPort`, NetworkPolicy o la aplicación no escucha |

## DNS dentro del cluster

| Nombre | Desde dónde funciona |
|---|---|
| `<svc>` | Solo desde el mismo namespace |
| `<svc>.<ns>` | Desde cualquier namespace |
| `<svc>.<ns>.svc.cluster.local` | Desde cualquier sitio del cluster (nombre completo, FQDN) |

El `/etc/resolv.conf` de un Pod lo explica:

```text
search <ns>.svc.cluster.local svc.cluster.local cluster.local
nameserver 172.20.0.10
options ndots:5
```

- `search`: los sufijos que se prueban con un nombre corto. Por eso `<svc>` solo funciona en tu namespace.
- `nameserver`: la IP del Service de CoreDNS (`kube-dns`). La IP concreta depende del cluster.
- `ndots:5`: un nombre con menos de 5 puntos se prueba antes con los sufijos de `search`. Los nombres externos generan varias consultas extra; acabarlos en punto (`ejemplo.com.`) lo evita.

## Probar desde dentro del cluster

```bash
# Pod de usar y tirar (busybox trae nslookup y wget; no trae curl)
kubectl run prueba --rm -it --image=busybox:1.37 -n <ns> -- nslookup <svc>
kubectl run prueba --rm -it --image=busybox:1.37 -n <ns> -- wget -qO- -T 3 http://<svc>
kubectl run prueba --rm -it --image=busybox:1.37 -n <ns> -- cat /etc/resolv.conf

# Desde un Pod que ya existe
kubectl exec deploy/<app> -n <ns> -- nslookup <svc>.<otro-ns>
```

| Resultado | Diagnóstico |
|---|---|
| `bad address` o `NXDOMAIN` | El nombre no existe: errata, o falta el namespace |
| `connection timed out; no servers could be reached` | CoreDNS no responde: `kubectl get deploy coredns -n kube-system` |
| `connection refused` | Llega, pero nadie escucha en ese puerto (`targetPort`) |
| `download timed out` (wget) | NetworkPolicy, o el Pod destino no responde |

## port-forward: probar sin publicar nada

```bash
kubectl port-forward svc/<svc> 8080:80 -n <ns>    # local:remoto; se queda abierto hasta Ctrl+C
curl http://localhost:8080                        # en OTRA terminal
```

Admite `svc/`, `pod/` y `deployment/`. El túnel va por la API de Kubernetes: no abre nada a Internet. Es la forma segura de mirar un servicio interno.

## NetworkPolicy

Por defecto, **todo Pod puede hablar con todo Pod**, de cualquier namespace. Una NetworkPolicy que selecciona un Pod lo cierra para todo lo que no permita explícitamente.

| Concepto | Detalle |
|---|---|
| `podSelector` | A qué Pods del namespace se aplica (`{}` = todos) |
| `policyTypes: [Ingress]` | Controla lo que entra; `Egress`, lo que sale |
| `ingress.from.podSelector` | Desde qué Pods (del mismo namespace) se permite |
| `ingress.from.namespaceSelector` | Desde qué namespaces |
| Varias políticas | Se suman: lo que permita cualquiera, pasa |

Patrón de mínimo privilegio: una política "denegar todo" y otras que permitan solo lo necesario. Plantillas en CHULETA-YAML.

```bash
kubectl get netpol -n <ns>
kubectl describe netpol <nombre> -n <ns>
```

⚠️ En EKS las NetworkPolicies solo se cumplen si la VPC CNI tiene activado su soporte (`enableNetworkPolicy: "true"` en la configuración del addon `vpc-cni`; capítulo 06 del curso). Sin él, el cluster acepta los objetos pero no los aplica: todo sigue pasando.

```bash
aws eks describe-addon --cluster-name <cluster> --addon-name vpc-cni --query addon.configurationValues
```

## VPC CNI: cada Pod tiene una IP de la VPC

En EKS, el addon `vpc-cni` (DaemonSet `aws-node`) da a cada Pod una IP real de la subnet. Por eso el máximo de Pods por nodo lo marca la red:

```text
max Pods = ENIs × (IPs por ENI − 1) + 2
t3.medium: 3 × (6 − 1) + 2 = 17
t3.large:  3 × (12 − 1) + 2 = 35
```

Los "+2" son Pods que usan la red del propio nodo (`aws-node` y `kube-proxy`).

```bash
kubectl get node <nodo> -o jsonpath='{.status.allocatable.pods}'
kubectl get ds aws-node -n kube-system
```

Consecuencias: `Too many pods` aunque sobre CPU, y subnets que se quedan sin IPs (`failed to assign an IP address to container`). La *prefix delegation* sube ese máximo (capítulo 07 del curso).

## LoadBalancer en EKS

| Cómo | Qué crea | Notas |
|---|---|---|
| Service `type: LoadBalancer` sin controlador extra | Un balanceador de AWS creado por el cloud provider de EKS | Qué tipo crea por defecto en 1.36/1.37 no está comprobado |
| Con AWS Load Balancer Controller instalado | NLB para Services, ALB para Ingress | Lo recomendado en producción. Desde la v2.5 se hace controlador por defecto de los Services LoadBalancer |

- El balanceador cuesta mientras exista: ALB a 0,0252 $/h más uso. Al borrar el Service se borra el balanceador.
- `EXTERNAL-IP <pending>` unos minutos es normal. Si no cambia, mira `kubectl describe svc`: suelen ser los tags de las subnets (`kubernetes.io/role/elb=1` para públicos) o permisos.
- Antes de borrar un cluster, borra los Services LoadBalancer: si no, quedan balanceadores huérfanos cobrando.
