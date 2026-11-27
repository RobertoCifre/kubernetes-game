# Chuletas: índice

Todas sirven para el EKS real y para el juego. Empieza por la de comandos; las demás son para cuando algo concreto te pasa.

## Qué chuleta mirar según lo que te pasa

| Lo que ves | Chuleta | Sección |
|---|---|---|
| No sé ni por dónde empezar | CHULETA-COMANDOS | Lo primero: tres palabras |
| Un Pod en `Pending` | CHULETA-DIAGNOSTICO | Pending |
| Un Pod en `ErrImagePull` o `ImagePullBackOff` | CHULETA-DIAGNOSTICO | Imagen |
| Un Pod en `CreateContainerConfigError` | CHULETA-DIAGNOSTICO | Configuración |
| Un Pod en `CrashLoopBackOff` o con RESTARTS que suben | CHULETA-DIAGNOSTICO | Se reinicia |
| `OOMKilled` o Exit Code 137 | CHULETA-CAPACIDAD | Memoria y CPU |
| `Running` pero `0/1` en READY | CHULETA-DIAGNOSTICO | Running pero no listo |
| El Deployment quiere N Pods y hay menos (ni siquiera Pending) | CHULETA-DIAGNOSTICO | FailedCreate |
| Un Service sin endpoints, o con endpoints que no responden | CHULETA-RED | Services y puertos |
| Nada resuelve nombres, o no llego a otro namespace | CHULETA-RED | DNS |
| Quiero escribir un objeto en YAML | CHULETA-YAML | La plantilla del tipo que necesites |
| `Forbidden`, `Unauthorized` o "¿quién puede hacer qué?" | CHULETA-SEGURIDAD | IAM y RBAC |
| Pod Security, Secrets, contenedores como root | CHULETA-SEGURIDAD | Pod Security |
| No caben Pods, taints, nodeSelector, cuotas, HPA, drain, PDB | CHULETA-CAPACIDAD | |
| Nodos, node group, instancias EC2, versión del cluster, costes | CHULETA-AWS-EKS | |
| Un Pod en `Init:0/1` o `Init:CrashLoopBackOff` | CHULETA-BAJO-EL-CAPO | Init containers |
| Quiero ver por dentro: PID 1, cgroups, capabilities, token | CHULETA-BAJO-EL-CAPO | |
| Una imagen sin shell (`exec` no sirve) | CHULETA-BAJO-EL-CAPO | kubectl debug |
| Permisos en todo el cluster, o credenciales de AWS para un Pod | CHULETA-BAJO-EL-CAPO | ClusterRole · Pod Identity |

## Todas las chuletas

| Fichero | Para qué |
|---|---|
| CHULETA-COMANDOS.md | Los comandos de kubectl por tarea: mirar, crear, cambiar, borrar, entrar en Pods, nodos |
| CHULETA-DIAGNOSTICO.md | Árbol de averías por STATUS: qué significa, el mensaje típico y cómo confirmarlo |
| CHULETA-YAML.md | Plantillas mínimas comentadas de cada tipo de objeto y errores típicos de YAML |
| CHULETA-RED.md | Services, puertos, DNS, port-forward, NetworkPolicy, VPC CNI y balanceadores |
| CHULETA-SEGURIDAD.md | IAM frente a RBAC, Roles, ServiceAccounts, Secrets, Pod Security, securityContext |
| CHULETA-CAPACIDAD.md | requests y limits, scheduler, QoS, cuotas, HPA, taints, drain, PDB, DaemonSets |
| CHULETA-AWS-EKS.md | AWS CLI para operar EKS: identidad, cluster, node groups, instancias, SSM y costes |
| CHULETA-BAJO-EL-CAPO.md | Dentro del contenedor: PID 1, cgroups, capabilities, token, init containers, kubectl debug, ClusterRoles y Pod Identity |

## El método que sirve casi siempre

```text
1. kubectl get pods -n <ns>                    → ¿qué STATUS tiene?
2. kubectl describe pod <pod> -n <ns>          → lee los Events del final
3. kubectl logs <pod> -n <ns> [--previous]     → ¿qué dice la aplicación?
4. Si el Pod está bien pero no llega tráfico   → describe svc / get endpoints
```

Si "todo falla a la vez", mira primero `kube-system` (`kubectl get pods -n kube-system`): CoreDNS, aws-node y kube-proxy sostienen al resto.

## Antes de tocar nada en el EKS real

- Comprueba la cuenta: `aws sts get-caller-identity` (¿es tu cuenta de laboratorio y no la de producción?).
- Comprueba el cluster: `kubectl config current-context`.
- Comprueba el namespace: casi todos los comandos llevan `-n <ns>`.
