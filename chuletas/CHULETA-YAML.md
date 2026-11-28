# Chuleta de YAML: plantillas mínimas

Todas se aplican con `kubectl apply -f fichero.yaml`, o sin fichero con `kubectl apply -f - <<'FIN' … FIN`. Sustituye los nombres de ejemplo (`ejemplo`, `pruebas`) por los tuyos.

## Anatomía: los cuatro campos de siempre

```yaml
apiVersion: apps/v1        # grupo/versión de la API (kubectl api-resources lo dice)
kind: Deployment           # tipo de objeto
metadata:                  # nombre, namespace, labels
  name: ejemplo
  namespace: pruebas
spec:                      # lo que QUIERES (estado deseado)
  …
# status:                  # lo que HAY: lo escribe Kubernetes, no tú
```

Para ver qué campos admite algo: `kubectl explain deployment.spec.template.spec.containers`.

## Deployment completo comentado

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ejemplo
  namespace: pruebas
spec:
  replicas: 2
  selector:
    matchLabels:
      app: ejemplo            # DEBE coincidir con template.metadata.labels
  template:
    metadata:
      labels:
        app: ejemplo
    spec:
      nodeSelector:           # solo nodos con esta label
        disco: ssd
      tolerations:            # acepta nodos con este taint
      - key: dedicado
        operator: Equal
        value: "si"
        effect: NoSchedule
      containers:
      - name: web
        image: nginx:1.27-alpine
        ports:
        - containerPort: 80   # informativo: el puerto real lo decide la aplicación
          name: http          # opcional: con nombre, un Service puede usar  targetPort: http
          protocol: TCP
        resources:
          requests:           # lo que reserva el scheduler
            cpu: 100m
            memory: 64Mi
          limits:             # el máximo; pasar de memory = OOMKilled
            memory: 128Mi
        env:
        - name: MODO
          value: "normal"
        - name: MENSAJE
          valueFrom:
            configMapKeyRef:
              name: ejemplo-config
              key: MENSAJE
        - name: CLAVE_BD
          valueFrom:
            secretKeyRef:
              name: ejemplo-secreto
              key: password
        readinessProbe:       # ¿recibe tráfico?
          httpGet:
            path: /
            port: 80
          periodSeconds: 5
        livenessProbe:        # ¿sigue vivo? si falla, se reinicia
          httpGet:
            path: /
            port: 80
          initialDelaySeconds: 10
          periodSeconds: 10
```

Para un contenedor que solo ejecuta un comando (busybox), añade `command: ["sh", "-c", "echo hola; sleep 3600"]`. En un Deployment, el proceso tiene que quedarse corriendo.

## Deployment que pasa Pod Security "restricted"

```yaml
    spec:
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
      - name: web
        image: nginxinc/nginx-unprivileged:1.28-alpine   # corre como usuario 101, escucha en 8080
        ports:
        - containerPort: 8080
        securityContext:
          allowPrivilegeEscalation: false
          capabilities:
            drop: ["ALL"]
```

Una imagen que corre como root (nginx normal) no arranca con `runAsNonRoot: true`. Detalle en CHULETA-SEGURIDAD.

## Service: port frente a targetPort

```yaml
apiVersion: v1
kind: Service
metadata:
  name: ejemplo
  namespace: pruebas
spec:
  type: ClusterIP           # ClusterIP (interno) · NodePort · LoadBalancer
  selector:
    app: ejemplo            # a qué Pods manda el tráfico (por labels)
  ports:
  - port: 80                # donde escucha el Service
    targetPort: 80          # donde escucha el CONTENEDOR (8080 en nginx-unprivileged), o el NOMBRE del puerto: http
    # nodePort: 30080       # solo con type NodePort/LoadBalancer (30000-32767); si no lo pones, se elige uno
```

Lo mismo sin YAML: `kubectl expose deployment <dep> --name=<svc> --port=80 --target-port=http --type=NodePort -n <ns>`.

## ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: ejemplo-config
  namespace: pruebas
data:
  MENSAJE: "Hola"
  index.html: |
    <h1>Página servida desde un ConfigMap</h1>
```

## Secret: stringData frente a data

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: ejemplo-secreto
  namespace: pruebas
type: Opaque
stringData:                 # en claro: Kubernetes lo guarda en base64 por ti
  password: "MiClave123"
# data:                     # alternativa: ya en base64 (echo -n 'MiClave123' | base64)
#   password: TWlDbGF2ZTEyMw==
```

## Job: una tarea que termina

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: tarea
  namespace: pruebas
spec:
  backoffLimit: 2           # reintentos si falla
  template:
    spec:
      restartPolicy: Never  # en un Job: Never u OnFailure (nunca Always)
      containers:
      - name: tarea
        image: busybox:1.37
        command: ["sh", "-c", "echo hecho"]
```

## CronJob: una tarea programada

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: programada
  namespace: pruebas
spec:
  schedule: "30 2 * * 1"    # minuto hora día-mes mes día-semana
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
          - name: programada
            image: busybox:1.37
            command: ["sh", "-c", "date"]
```

| schedule | Significa |
|---|---|
| `*/15 * * * *` | Cada 15 minutos |
| `0 * * * *` | Al minuto 0 de cada hora |
| `30 2 * * *` | Todos los días a las 02:30 |
| `30 2 * * 1` | Los lunes a las 02:30 (0 o 7 = domingo) |
| `0 9 1 * *` | El día 1 de cada mes a las 09:00 |

Sin `timeZone`, la hora es la del controlador. En EKS se supone UTC (no comprobado). Para fijarla: `timeZone: "Europe/Madrid"` dentro de `spec`.

## HPA (autoscaling/v2)

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ejemplo
  namespace: pruebas
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ejemplo
  minReplicas: 1
  maxReplicas: 5
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 60   # % sobre requests.cpu (sin requests, no mide)
```

## ResourceQuota

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: limites
  namespace: pruebas
spec:
  hard:
    pods: "10"               # números entre comillas: son cantidades
    requests.cpu: "2"
    requests.memory: 2Gi
    limits.memory: 4Gi
```

## PodDisruptionBudget

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: ejemplo-pdb
  namespace: pruebas
spec:
  minAvailable: 1           # o maxUnavailable: 1 (uno de los dos)
  selector:
    matchLabels:
      app: ejemplo
```

## NetworkPolicy: denegar todo y permitir lo justo

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: denegar-todo
  namespace: pruebas
spec:
  podSelector: {}            # {} = todos los Pods del namespace
  policyTypes: ["Ingress"]   # sin reglas ingress = no entra nada
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: permitir-front-a-api
  namespace: pruebas
spec:
  podSelector:
    matchLabels:
      app: api               # a QUIÉN protege
  policyTypes: ["Ingress"]
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: front         # DESDE quién se permite
    ports:
    - port: 80
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: permitir-desde-otro-namespace
  namespace: pruebas
spec:
  podSelector: {}            # protege a todos los Pods de «pruebas»
  policyTypes: ["Ingress"]
  ingress:
  - from:
    - namespaceSelector:     # DESDE los Pods de otro namespace…
        matchLabels:
          kubernetes.io/metadata.name: otro-ns   # etiqueta que Kubernetes pone sola a cada namespace
    ports:                   # …y SOLO a este puerto
    - protocol: TCP
      port: 9000
```

`from` y `ports` en la misma regla = «desde ahí Y a ese puerto». Si pones `namespaceSelector: {}` abres a TODOS los namespaces. Las etiquetas de un namespace: `kubectl get ns --show-labels`.

Las políticas se suman: lo que permita cualquiera de ellas, pasa. En EKS solo se aplican si la VPC CNI tiene `enableNetworkPolicy` (CHULETA-RED).

## ServiceAccount, Role y RoleBinding

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: robot
  namespace: pruebas
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: leer-pods
  namespace: pruebas
rules:
- apiGroups: [""]            # "" = grupo core (pods, services, configmaps…)
  resources: ["pods"]
  verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: robot-leer-pods
  namespace: pruebas
subjects:
- kind: ServiceAccount
  name: robot
  namespace: pruebas
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role                 # o ClusterRole (view, edit, admin…)
  name: leer-pods
```

Deployments y ReplicaSets están en el grupo `apps`; Jobs y CronJobs, en `batch`.

## Namespace con Pod Security

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: pruebas
  labels:
    pod-security.kubernetes.io/enforce: restricted   # privileged · baseline · restricted
```

## Errores típicos de YAML

| Error | Síntoma | Arreglo |
|---|---|---|
| Tabuladores | `found character that cannot start any token` | Solo espacios (2 por nivel) |
| Indentación descuadrada | Campos que "desaparecen" o `unknown field` | Alinea los hijos bajo su padre |
| Falta `-` en una lista | `cannot unmarshal object into … array` | `containers:` y `env:` son listas: cada elemento empieza por `- ` |
| Número sin comillas donde va texto | `cannot unmarshal number into … string` | Valores de `env`, `data` y labels entre comillas: `"8080"`, `"true"` |
| `yes`, `no`, `on`, `off` sin comillas | Se interpretan como booleanos | Entre comillas: `"si"`, `"no"` |
| selector distinto de las labels del template | `selector does not match template labels` | `matchLabels` igual que `template.metadata.labels` |
| Cambiar el selector de un Deployment existente | `field is immutable` | Borrar y crear de nuevo |
| `kind` o `apiVersion` mal escrito | `no matches for kind` | `kubectl api-resources` da los correctos |

Truco para no empezar de cero: `kubectl create deployment x --image=nginx --dry-run=client -o yaml > x.yaml`.
