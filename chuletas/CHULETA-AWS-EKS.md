# Chuleta de AWS CLI para operar EKS

kubectl habla con Kubernetes. La AWS CLI habla con AWS: el cluster como recurso, los node groups, las instancias EC2 y la identidad. En el día a día se usan las dos.

## ⚠️ Antes de nada: cuenta y región

```bash
aws sts get-caller-identity                 # ¿es la cuenta que esperas? (en el juego: 123456789012)
export AWS_PROFILE=mi-laboratorio AWS_REGION=eu-west-1
aws sso login --profile mi-laboratorio      # si la sesión ha caducado
```

Si tienes varios perfiles (laboratorio, trabajo, **producción**…), mira qué `AWS_PROFILE` tienes en tu `~/.bashrc` o en la sesión actual. Comprueba la cuenta antes de cualquier comando que cree, cambie o borre.

## Identidad

```bash
aws sts get-caller-identity                                   # cuenta, ARN y usuario/rol
aws sts get-caller-identity --query Account --output text     # solo la cuenta
```

Es lo primero que se mira ante un `Unauthorized` en kubectl: credencial caducada, otra cuenta u otro rol.

## El cluster

```bash
aws eks list-clusters
aws eks describe-cluster --name <cluster> --query 'cluster.[status,version,endpoint]' --output text
aws eks describe-cluster --name <cluster> --query cluster.version --output text      # ej. 1.36
aws eks describe-cluster --name <cluster> --query cluster.arn --output text          # incluye la cuenta
aws eks describe-cluster --name <cluster> --query cluster.upgradePolicy              # STANDARD o EXTENDED
aws eks describe-cluster-versions --query 'clusterVersions[].[clusterVersion,status,endOfStandardSupportDate]' --output text
```

Conectar kubectl a un cluster (escribe en `~/.kube/config`):

```bash
aws eks update-kubeconfig --name <cluster> --alias <cluster>
kubectl config current-context
```

## Insights: avisos antes de actualizar

```bash
aws eks list-insights --cluster-name <cluster>
aws eks list-insights --cluster-name <cluster> --filter categories=UPGRADE_READINESS
aws eks describe-insight --cluster-name <cluster> --id <insight-id>
```

Las categorías incluyen `UPGRADE_READINESS` (cosas que romperían el upgrade) y `MISCONFIGURATION`. El formato exacto de `--filter` está en `aws eks list-insights help`.

## Node groups: los nodos gestionados

```bash
aws eks list-nodegroups --cluster-name <cluster>
aws eks describe-nodegroup --cluster-name <cluster> --nodegroup-name <ng> \
  --query 'nodegroup.[status,instanceTypes,amiType,scalingConfig]'

# Cambiar el número de nodos: desiredSize siempre entre minSize y maxSize
aws eks update-nodegroup-config --cluster-name <cluster> --nodegroup-name <ng> \
  --scaling-config minSize=1,maxSize=3,desiredSize=2
```

Durante el cambio, el node group está en `UPDATING`. La EC2 nueva tarda unos minutos en aparecer como `Ready` en `kubectl get nodes -w`.

## De nodo de Kubernetes a instancia EC2

El nombre del nodo es su DNS privado, y el `providerID` lleva la zona y el ID de la instancia:

```bash
kubectl get node <nodo> -o jsonpath='{.spec.providerID}'
# aws:///eu-west-1a/i-0123456789abcdef0
kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"  "}{.spec.providerID}{"\n"}{end}'
```

Las instancias de un node group llevan el tag `eks:nodegroup-name`:

```bash
aws ec2 describe-instances \
  --filters Name=tag:eks:nodegroup-name,Values=<ng> Name=instance-state-name,Values=running \
  --query 'Reservations[].Instances[].[InstanceId,PrivateDnsName,Placement.AvailabilityZone,State.Name]' \
  --output table
```

## Sustituir un nodo roto

En EKS un nodo que falla no se repara: se termina y el node group (un Auto Scaling Group por debajo) lanza otro para mantener `desiredSize`.

```bash
kubectl get nodes                                         # ¿cuál está NotReady?
kubectl get node <nodo> -o jsonpath='{.spec.providerID}'  # → i-…
kubectl drain <nodo> --ignore-daemonsets --delete-emptydir-data --timeout=120s   # si aún responde
aws ec2 terminate-instances --instance-ids <i-…>
kubectl get nodes -w                                      # aparece uno nuevo en unos minutos
```

⚠️ `terminate-instances` es irreversible. Comprueba antes el ID, la cuenta y que la instancia es del node group.

## Entrar en un nodo sin SSH (Session Manager)

Necesita la política `AmazonSSMManagedInstanceCore` en el rol del nodo y el plugin de Session Manager en tu PC.

```bash
aws ssm start-session --target <i-…>
# dentro del nodo:
sudo systemctl status kubelet
sudo journalctl -u kubelet -n 50 --no-pager
sudo crictl ps
exit
```

Un comando sin sesión interactiva (por ejemplo, en un script):

```bash
aws ssm send-command --instance-ids <i-…> --document-name AWS-RunShellScript \
  --parameters 'commands=["systemctl is-active kubelet"]' \
  --query Command.CommandId --output text
aws ssm get-command-invocation --command-id <id> --instance-id <i-…> \
  --query '[Status,StandardOutputContent]' --output text
```

## Addons gestionados

```bash
aws eks list-addons --cluster-name <cluster>
aws eks describe-addon --cluster-name <cluster> --addon-name vpc-cni \
  --query 'addon.[addonVersion,status,configurationValues]'
aws eks describe-addon-versions --addon-name coredns --kubernetes-version 1.36 \
  --query 'addons[0].addonVersions[0].addonVersion' --output text
```

## Costes de referencia (eu-west-1, comprobados el 26/11/2026)

| Recurso | Precio | Al mes si se queda encendido |
|---|---|---|
| Control plane EKS (soporte estándar) | 0,10 $/h | 73 $ |
| Control plane EKS en soporte extendido | 0,60 $/h | 438 $ |
| Nodo t3.medium | 0,0456 $/h | 33,29 $ |
| NAT Gateway | 0,048 $/h + 0,048 $/GB | 35,04 $ + tráfico |
| IPv4 pública | 0,005 $/h | 3,65 $ |
| ALB | 0,0252 $/h + 0,008 $/LCU-h | 18,40 $ + uso |
| EBS gp3 | 0,088 $/GB-mes | 1,76 $ por 20 GB |

- Un cluster de laboratorio olvidado (control plane + 1 nodo + IP) cuesta unos 3,6 $ al día.
- El soporte extendido viene activado por defecto al crear un cluster: créalo con `--upgrade-policy supportType=STANDARD`.
- Antes de borrar un cluster, borra sus Services LoadBalancer y sus volúmenes: si no, quedan recursos huérfanos cobrando.

```bash
aws eks list-clusters                                              # ¿queda algo encendido?
aws elbv2 describe-load-balancers --query 'LoadBalancers[].[LoadBalancerName,VpcId]' --output text
aws ec2 describe-volumes --filters Name=status,Values=available --query 'Volumes[].[VolumeId,Size]' --output text
```

## Lo que hace cada herramienta

| Quiero… | Herramienta |
|---|---|
| Ver o cambiar Pods, Deployments, Services, RBAC | kubectl |
| Ver la versión, el endpoint o el estado del cluster | `aws eks describe-cluster` |
| Añadir o quitar nodos | `aws eks update-nodegroup-config` |
| Saber qué instancia EC2 es un nodo | `kubectl get node … providerID` + `aws ec2 describe-instances` |
| Sustituir un nodo | `aws ec2 terminate-instances` |
| Entrar en un nodo | `aws ssm start-session` |
| Saber quién soy | `aws sts get-caller-identity` |
