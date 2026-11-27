# Chuleta de seguridad: IAM, RBAC y Pod Security

## Dos preguntas distintas

| Capa | Pregunta | Error si falla | Dónde se configura |
|---|---|---|---|
| IAM (autenticación) | ¿Quién eres? ¿Puedes entrar al cluster? | `Unauthorized` | AWS: rol/usuario IAM + access entry del cluster |
| RBAC (autorización) | Ya dentro: ¿qué puedes hacer y dónde? | `Forbidden` | Kubernetes: Role/ClusterRole + RoleBinding |

```bash
aws sts get-caller-identity                      # ¿con qué identidad AWS voy?
kubectl config current-context                   # ¿contra qué cluster?
kubectl auth whoami                              # ¿quién soy para Kubernetes? (kubectl reciente)
kubectl auth can-i delete pods -n <ns>           # ¿puedo hacer esto?
kubectl auth can-i --list -n <ns>                # todo lo que puedo hacer en ese namespace
```

## Access entries (EKS): quién entra

Con el modo de autenticación `API`, el acceso se da con access entries, no con el ConfigMap `aws-auth`.

```bash
aws eks list-access-entries --cluster-name <cluster>
aws eks list-associated-access-policies --cluster-name <cluster> --principal-arn <arn-rol>
aws eks list-access-policies                     # AmazonEKSClusterAdminPolicy, AmazonEKSViewPolicy…
```

Una access entry puede llevar una access policy de EKS (permisos ya hechos) o grupos de Kubernetes que luego se enlazan con RBAC. Detalle en el capítulo 06 del curso.

## RBAC: las piezas

| Objeto | Qué es | Ámbito |
|---|---|---|
| Role | Lista de permisos: verbos sobre recursos | Un namespace |
| ClusterRole | Lista de permisos | Todo el cluster (o reutilizable en namespaces) |
| RoleBinding | Da un Role o ClusterRole a alguien, en un namespace | Un namespace |
| ClusterRoleBinding | Da un ClusterRole a alguien en todo el cluster | Todo el cluster |
| ServiceAccount | Identidad de una aplicación (Pod) dentro de Kubernetes | Un namespace |

Verbos habituales: `get`, `list`, `watch` (leer) · `create`, `update`, `patch`, `delete` (escribir).

```bash
kubectl create serviceaccount <sa> -n <ns>
kubectl create role <rol> --verb=get,list,watch --resource=pods -n <ns>
kubectl create rolebinding <nombre> --role=<rol> --serviceaccount=<ns>:<sa> -n <ns>
kubectl create rolebinding <nombre> --clusterrole=view --serviceaccount=<ns>:<sa> -n <ns>
kubectl get roles,rolebindings -n <ns> -o wide
kubectl describe rolebinding <nombre> -n <ns>
```

Un RoleBinding que apunta a un ClusterRole da esos permisos solo en el namespace del RoleBinding. Es la forma normal de reutilizar `view` o `edit`.

## ClusterRoles predefinidos

| ClusterRole | Permite | Ojo |
|---|---|---|
| `view` | Leer casi todo en el namespace | **No** deja leer Secrets |
| `edit` | Leer y modificar casi todo | No deja tocar Roles ni RoleBindings |
| `admin` | Todo en el namespace, incluido dar permisos dentro de él | No toca la cuota ni el propio namespace |
| `cluster-admin` | Todo, en todo el cluster | Superusuario: casi nunca hace falta |

## Probar permisos de otra identidad

```bash
# Una ServiceAccount se nombra así: system:serviceaccount:<namespace>:<nombre>
kubectl auth can-i list pods -n <ns> --as=system:serviceaccount:<ns>:<sa>
kubectl auth can-i delete deployments -n <ns> --as=system:serviceaccount:<ns>:<sa>
kubectl auth can-i --list -n <ns> --as=system:serviceaccount:<ns>:<sa>
```

`--as` necesita que TÚ tengas permiso para suplantar (`impersonate`). Un administrador lo tiene.

Mínimo privilegio: da solo los verbos y recursos que la aplicación usa, en su namespace. Si dudas, empieza por `view` y añade.

## Secrets: base64 no es cifrado

```bash
kubectl get secret <nombre> -n <ns> -o yaml                            # valores en base64
kubectl get secret <nombre> -n <ns> -o jsonpath='{.data.<clave>}' | base64 -d
kubectl describe secret <nombre> -n <ns>                               # solo tamaños, sin valores
```

- base64 es una codificación: cualquiera la deshace. Quien pueda leer Secrets por RBAC ve las contraseñas.
- En EKS, desde Kubernetes 1.28 los datos de la API se cifran al guardarse en etcd, con KMS (documentación oficial, capítulo 06 del curso). Eso protege el disco, no a quien tiene permiso de lectura.
- En la práctica te protegen: RBAC estricto (`view` no lee Secrets), no meter Secrets en git y, para lo serio, AWS Secrets Manager.

## Pod Security Admission

Se activa por namespace con una label:

```bash
kubectl label ns <ns> pod-security.kubernetes.io/enforce=restricted
kubectl get ns <ns> --show-labels
```

| Nivel | Qué permite |
|---|---|
| `privileged` | Todo (sin restricciones) |
| `baseline` | Bloquea lo claramente peligroso: privileged, hostNetwork, hostPath… |
| `restricted` | Lo más estricto: además exige lo de la tabla siguiente |

Modos: `enforce` (rechaza), `warn` (avisa al crear) y `audit` (lo anota en el log de auditoría).

### Qué exige `restricted` (documentación oficial de Pod Security Standards)

| Campo | Valor exigido |
|---|---|
| `securityContext.runAsNonRoot` (Pod o contenedor) | `true` |
| `securityContext.allowPrivilegeEscalation` (cada contenedor) | `false` |
| `securityContext.capabilities.drop` (cada contenedor) | `["ALL"]` (solo se puede volver a añadir `NET_BIND_SERVICE`) |
| `securityContext.seccompProfile.type` (Pod o contenedor) | `RuntimeDefault` o `Localhost` |
| Volúmenes | Solo tipos seguros: configMap, secret, emptyDir, persistentVolumeClaim… |

Si no se cumple, el Pod **no se crea**: el error sale en los eventos del ReplicaSet (`violates PodSecurity "restricted:latest": …`), y el propio mensaje dice qué falta.

## securityContext: el Pod sin privilegios

```yaml
spec:
  securityContext:
    runAsNonRoot: true
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: app
    image: nginxinc/nginx-unprivileged:1.28-alpine
    securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true       # opcional; si la app escribe, monta un emptyDir
      capabilities:
        drop: ["ALL"]
```

## Imágenes que corren como root

`runAsNonRoot: true` hace que el kubelet compruebe el usuario de la imagen. Si es root, falla con `CreateContainerConfigError: container has runAsNonRoot and image will run as root`.

| Imagen | Usuario | Puerto |
|---|---|---|
| `nginx:1.27-alpine` | root | 80 |
| `nginxinc/nginx-unprivileged:1.28-alpine` | 101 (nginx) | 8080 |

Un proceso que no es root no puede escuchar en puertos por debajo del 1024 sin la capability `NET_BIND_SERVICE`. Por eso las imágenes "unprivileged" usan el 8080. Recuerda ajustar el `targetPort` del Service.

## Red

NetworkPolicy (quién puede hablar con quién) y el requisito de la VPC CNI en EKS: CHULETA-RED.

## Checklist rápido

- `aws sts get-caller-identity` antes de nada: ¿cuenta correcta?
- Cada aplicación con su ServiceAccount y un Role mínimo.
- Nadie con `cluster-admin` "por comodidad".
- Namespaces de aplicación con Pod Security `baseline` como mínimo, mejor `restricted`.
- Imágenes no-root, `allowPrivilegeEscalation: false` y `capabilities: drop ALL`.
- Secrets fuera de git; acceso a Secrets solo a quien lo necesita.
- "Denegar todo" + permisos explícitos en NetworkPolicy (con el soporte de la VPC CNI activado).
