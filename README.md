# ⎈ EKS Quest — a Kubernetes game

**Learn `kubectl` and Amazon EKS by fixing a broken cluster — in your browser, with nothing to install.**

EKS Quest is a free, single-file game. A simulated EKS cluster runs inside the page, and every level breaks it in a different way: Pods stuck in `Pending`, images that don't exist, Services without endpoints, failing probes, OOMKills, missing permissions, nodes that die… You fix them with the **real commands** (`kubectl get`, `describe`, `logs`, `exec`, `edit`, `rollout`, `aws eks …`), so everything you practise works on a real cluster.

It goes from *"what is a Pod?"* to looking **inside** containers: PID 1, cgroups, Linux capabilities, ServiceAccount tokens, init containers, ephemeral debug containers, ClusterRoles and EKS Pod Identity.

> 🇪🇸 **The game is in Spanish** (missions, hints and cheat sheets). The commands, of course, are the same in any language.

![EKS Quest: mission panel on the left, terminal on the right](docs/captura.png)

## Play

| Option | How |
|---|---|
| **Just the file** | Download [`eks-quest.html`](eks-quest.html) and open it in any modern browser. Works offline. |
| **Docker** | `docker build -f docker/Dockerfile -t eks-quest:3.0 .` then `docker run -d -p 8080:8080 --read-only --tmpfs /tmp eks-quest:3.0` and open http://localhost:8080 |

You don't need an AWS account, a cluster, `kubectl` or `kind`: the cluster is simulated. Your progress is saved in your browser (`localStorage`) and never leaves it — the page makes no network requests at all.

Type `help` in the game terminal to see what it understands, `mapa` for the level map, `pista` for a hint and `solucion` if you're stuck.

## The 60 levels

| World | Levels | What you learn |
|---|---|---|
| 1 · Primeros pasos (*first steps*) | 1–7 | Nodes, namespaces, Deployments, Services, scaling, labels, logs |
| 2 · Pods que no arrancan (*Pods that won't start*) | 8–16 | `ErrImagePull`, `CreateContainerConfigError`, `CrashLoopBackOff`, `OOMKilled`, `Pending` |
| 3 · Tráfico y salud (*traffic and health*) | 17–24 | Selectors, `targetPort`, readiness/liveness probes, port-forward, DNS, LoadBalancers |
| 4 · Actualizaciones y configuración (*updates and config*) | 25–32 | Rolling updates, rollbacks, ConfigMaps, Secrets, Jobs, CronJobs, DaemonSets |
| 5 · Capacidad y escalado (*capacity and scaling*) | 33–40 | QoS, HPA, ResourceQuotas, node groups, taints, nodeSelector, drain |
| 6 · Seguridad y permisos (*security and permissions*) | 41–45 | IAM vs RBAC, Roles, NetworkPolicies, Pod Security |
| 7 · Guardia (*on call*) | 46–50 | Cluster versions, PodDisruptionBudgets, dead nodes, CoreDNS, chained failures |
| 8 · Bajo el capó (*under the hood*) | 51–60 | PID 1, cgroup v2 (`memory.max`, `cpu.max`), capabilities, SA tokens, init containers, `kubectl debug`, ClusterRoles, Pod Identity |

Each level is either a **mission** (fix the cluster; it's checked automatically) or a **question** (investigate and answer with `responder <value>`). Many have traps: deleting the broken thing, or giving too many permissions, doesn't count as a fix.

## Cheat sheets and solutions

- [`chuletas/`](chuletas) — the cheat sheets that are also built into the game (📚 button): commands by task, a troubleshooting tree by Pod status, YAML templates, networking, security, capacity, AWS CLI for EKS, and what's inside a container.
- [`docs/NIVELES.md`](docs/NIVELES.md) — ⚠️ **spoilers**: every level's setup, solution, hints and what it teaches.

## How it works

The page is a small Kubernetes simulator written in plain JavaScript (no frameworks, no dependencies):

- an object store and reconciliation loop with controllers for Deployments/ReplicaSets, DaemonSets, Jobs, HPAs and nodes, plus a scheduler;
- admission (ResourceQuota, Pod Security), RBAC, Services, DNS and NetworkPolicies;
- a busybox-like shell inside containers, with `/proc`, `/sys/fs/cgroup` and the ServiceAccount token;
- a YAML parser, JSONPath and JMESPath for `-o yaml`, `-o jsonpath` and `--query`.

It's a simulator, not a real cluster: it supports the commands and flags the levels need, plus the most common ones around them. When you're done, practise on a real cluster (kind or minikube on your laptop, or a test EKS cluster).

## Build from source

`eks-quest.html` is generated from `src/` and `chuletas/`:

```bash
python construir.py               # Python 3; writes eks-quest.html
node tests/niveles.test.js        # plays all 60 levels with their solutions
node tests/trampas.test.js        # wrong or tricky "fixes" must NOT pass
```

| Path | Contents |
|---|---|
| `src/sim.js` | The simulated cluster: objects, controllers, scheduler, containers, network |
| `src/comandos.js` | The terminal: `kubectl` and `aws` commands |
| `src/vistas.js` | `get` tables, `describe` and `-o yaml` output |
| `src/niveles.js` | The 60 levels: setup, success check, hints |
| `src/ui.js`, `src/plantilla.html`, `src/estilo.css` | The page |
| `src/yaml.js` | YAML, JSONPath and JMESPath |
| `docker/` | Unprivileged nginx image, Compose file and a Kubernetes manifest to deploy the game on your own cluster |
