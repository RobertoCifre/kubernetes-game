# ⎈ EKS Quest — a Kubernetes game

[![tests](https://github.com/RobertoCifre/kubernetes-game/actions/workflows/tests.yml/badge.svg)](https://github.com/RobertoCifre/kubernetes-game/actions/workflows/tests.yml)

**▶ Play online: https://robertocifre.github.io/kubernetes-game/**

**Learn `kubectl` and Amazon EKS by fixing a broken cluster — in your browser, with nothing to install.**

EKS Quest is a free, single-file game. A simulated EKS cluster runs inside the page, and every level breaks it in a different way: Pods stuck in `Pending`, images that don't exist, Services without endpoints, failing probes, OOMKills, missing permissions, nodes that die… You fix them with the **real commands** (`kubectl get`, `describe`, `logs`, `exec`, `edit`, `rollout`, `aws eks …`), so everything you practise works on a real cluster.

It goes from *"what is this Pod called?"* to looking **inside** containers and nodes: PID 1, cgroups, Linux capabilities, ServiceAccount tokens, init containers, sidecars, ephemeral debug containers, `crictl`, kube-proxy rules, ClusterRoles and EKS Pod Identity — and ends with a CKA-style final lab.

> 🇪🇸 **The game is in Spanish** (missions, hints and cheat sheets). The commands, of course, are the same in any language.

![EKS Quest: mission panel on the left, terminal on the right](docs/captura.png)

## Play

| Option | How |
|---|---|
| **Online** | Open **https://robertocifre.github.io/kubernetes-game/** — nothing to install. |
| **Just the file** | Download [`eks-quest.html`](https://github.com/RobertoCifre/kubernetes-game/releases/latest/download/eks-quest.html) from the latest release and double-click it. Any modern browser; works offline. |
| **Docker** | `docker build -f docker/Dockerfile -t eks-quest:3.4 .` then `docker run -d -p 8080:8080 --read-only --tmpfs /tmp eks-quest:3.4` and open http://localhost:8080 |

You don't need an AWS account, a cluster, `kubectl` or `kind`: the cluster is simulated. Your progress is saved in your browser (`localStorage`) and never leaves it — the page makes no network requests at all. Each browser keeps its own save, so use **💾 Guardar** now and then: it downloads a `.json` copy and gives you a code you can load with **📂 Cargar** in any browser or computer.

Type `help` in the game terminal to see what it understands, `mapa` for the level map, `pista` for a hint and `solucion` if you're stuck.

## The 76 levels

| World | Levels | What you learn |
|---|---|---|
| 1 · Primeros pasos (*first steps*) | 1–13 | Reading the cluster: names of Deployments, Pods and Services, images, ports, replicas; then nodes, namespaces, creating, scaling, labels, logs |
| 2 · Pods que no arrancan (*Pods that won't start*) | 14–22 | `ErrImagePull`, `CreateContainerConfigError`, `CrashLoopBackOff`, `OOMKilled`, `Pending` |
| 3 · Tráfico y salud (*traffic and health*) | 23–30 | Selectors, `targetPort`, readiness/liveness probes, port-forward, DNS, LoadBalancers |
| 4 · Actualizaciones y configuración (*updates and config*) | 31–38 | Rolling updates, rollbacks, ConfigMaps, Secrets, Jobs, CronJobs, DaemonSets |
| 5 · Capacidad y escalado (*capacity and scaling*) | 39–46 | QoS, HPA, ResourceQuotas, node groups, taints, nodeSelector, drain |
| 6 · Seguridad y permisos (*security and permissions*) | 47–51 | IAM vs RBAC, Roles, NetworkPolicies, Pod Security |
| 7 · Guardia (*on call*) | 52–56 | Cluster versions, PodDisruptionBudgets, dead nodes, CoreDNS, chained failures |
| 8 · Bajo el capó (*under the hood*) | 57–66 | PID 1, cgroup v2 (`memory.max`, `cpu.max`), capabilities, SA tokens, init containers, `kubectl debug`, ClusterRoles, Pod Identity |
| 9 · Redes y Pods por dentro (*networking and Pod internals*) | 67–75 | Pod IPs, endpoints and readiness, cluster DNS, sidecars sharing `localhost` and volumes, shared process namespace, OOM score by QoS, `crictl`, cgroups from the node, kube-proxy iptables rules |
| 10 · Examen final (*final exam*) | 76 | A CKA-style lab: six independent, separately graded tasks (RBAC, node drain, NetworkPolicy, NodePort Service, logging sidecar, broken kubelet); 66 % to pass |

Each level is either a **mission** (fix the cluster; it's checked automatically) or a **question** (investigate and answer with `responder <value>`). Levels unlock in order (type `experto` to open them all if you already know the basics), the mission always tells you which namespace to use (`-n nivel-N`), and you climb ranks as you earn XP. The final exam is timed: 2 hours, like the CKA. Many have traps: deleting the broken thing, or giving too many permissions, doesn't count as a fix.

## Cheat sheets and solutions

- [`chuletas/`](chuletas) — the cheat sheets that are also built into the game (📚 button). They contain every command you need to solve all 76 levels (a test checks it): commands by task, a troubleshooting tree by Pod status, YAML templates, networking, security, capacity, AWS CLI for EKS, and what's inside a container.
- [`docs/NIVELES.md`](docs/NIVELES.md) — ⚠️ **spoilers**: every level's setup, solution, hints and what it teaches.

## How it works

The page is a small Kubernetes simulator written in plain JavaScript (no frameworks, no dependencies):

- an object store and reconciliation loop with controllers for Deployments/ReplicaSets, DaemonSets, Jobs, HPAs and nodes, plus a scheduler;
- admission (ResourceQuota, Pod Security), RBAC, Services, DNS and NetworkPolicies;
- a busybox-like shell inside containers, with `/proc`, `/sys/fs/cgroup` and the ServiceAccount token;
- a YAML parser, JSONPath and JMESPath for `-o yaml`, `-o jsonpath` and `--query`.

It's a simulator, not a real cluster: it supports the commands and flags the levels need, plus the most common ones around them, and some low-level outputs (PIDs, cgroup paths, iptables rules, `oom_score_adj`) are realistic approximations rather than byte-for-byte copies. When you're done, practise on a real cluster: kind or minikube on your laptop, [Killercoda](https://killercoda.com/) in the browser, or a test EKS cluster.

## Build from source

`eks-quest.html` is generated from `src/` and `chuletas/`:

```bash
python construir.py               # Python 3; writes eks-quest.html
node tests/niveles.test.js        # plays all 76 levels with their solutions
node tests/trampas.test.js        # wrong or tricky "fixes" must NOT pass
node tests/chuletas.test.js       # the cheat sheets contain the commands needed for every level
node tests/simulacro.test.js      # ~12,000 real kubectl/aws commands across all levels: no crashes, no "not supported"
```

| Path | Contents |
|---|---|
| `src/sim.js` | The simulated cluster: objects, controllers, scheduler, containers, network |
| `src/comandos.js` | The terminal: `kubectl` and `aws` commands |
| `src/vistas.js` | `get` tables, `describe` and `-o yaml` output |
| `src/niveles.js` | The 76 levels: setup, success check, hints |
| `src/ui.js`, `src/plantilla.html`, `src/estilo.css` | The page |
| `src/yaml.js` | YAML, JSONPath and JMESPath |
| `docker/` | Unprivileged nginx image, Compose file and a Kubernetes manifest to deploy the game on your own cluster |

## License

- Code (`src/`, `tests/`, `docker/`, `construir.py`, `eks-quest.html`): [MIT](LICENSE).
- Learning material (`chuletas/`, `docs/`): [CC BY 4.0](LICENSE-docs). `eks-quest.html` bundles the cheat sheets: that part stays under CC BY 4.0.
- No third-party code is included. The Docker image is built on [`nginxinc/nginx-unprivileged`](https://hub.docker.com/r/nginxinc/nginx-unprivileged): if you distribute the built image, the licenses of nginx and Alpine Linux also apply to it.

Kubernetes® and CKA (Certified Kubernetes Administrator) are trademarks of The Linux Foundation. Amazon EKS and AWS are trademarks of Amazon.com, Inc. or its affiliates. This is an independent project, not affiliated with or endorsed by them. The final lab is inspired by publicly available CKA practice tasks; it does not contain real exam questions. The cluster in the game is simulated: the account ID (`123456789012`), resource IDs and command outputs are examples.
