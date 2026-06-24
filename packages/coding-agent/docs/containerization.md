# Containerization

Tau runs with all permissions by default, but in some cases, you will want to have more control over what directories Tau can write to and which accesses it has.

There are two general options. You can either
1. run the whole `tau` process inside an isolated environment, or
2. build an extension that routes selected tool execution into an isolated environment.

## Choose a pattern

| Pattern | What is isolated | Best for | Notes |
| --- | --- | --- | --- |
| OpenShell | Whole `tau` process in a policy-controlled sandbox | Local or remote managed sandbox | Requires an OpenShell gateway |
| Plain Docker | Whole `tau` process in a local container | Simple local isolation | Provider API keys enter the container. |

Extensions run wherever the `tau` process runs. If you run host `tau` with a tool-routing extension, other custom extension tools still run on the host unless they also delegate their operations.

## OpenShell

Use [NVIDIA OpenShell](https://docs.nvidia.com/openshell/about/overview) when you want a policy-controlled sandbox with filesystem, process, network, credential, and inference controls.
OpenShell can run sandboxes through a local gateway backed by Docker, Podman, or a VM runtime, or through a remote Kubernetes gateway.

Every sandbox requires an active gateway.
Register and select one before creating a sandbox:

```bash
openshell gateway add <gateway-url> --name <name>
openshell gateway select <name>
```

Launch `tau` inside an OpenShell sandbox:

```bash
openshell sandbox create --name tau-sandbox --from tau -- tau
```

In this pattern, the whole `tau` process runs inside the sandbox.
Built-in tools, `!` commands, and extension tools execute inside the OpenShell boundary.

If the gateway is remote, project files are not bind-mounted from the host, meaning writes in the sandbox are not reflected on your machine.
Clone the repository inside the sandbox or use OpenShell file transfer commands:

```bash
openshell sandbox upload tau-sandbox ./repo /workspace
openshell sandbox download tau-sandbox /workspace/repo ./repo-out
```

OpenShell providers can keep raw model API keys outside the sandbox.
When inference routing is configured, code inside the sandbox can call `https://inference.local`, and the gateway injects the configured provider credentials upstream.
Keep OpenRouter API credentials outside the sandbox when routing tool execution through a container.

## Plain Docker

Run the whole `tau` process in Docker when you want the simplest local container boundary.

`Dockerfile.tau`:

```dockerfile
FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates git ripgrep \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g --ignore-scripts @earendil-works/tau-coding-agent

WORKDIR /workspace
ENTRYPOINT ["tau"]
```

Build and run:

```bash
docker build -t tau-sandbox -f Dockerfile.tau .

docker run --rm -it \
  -e OPENROUTER_API_KEY \
  -v "$PWD:/workspace" \
  -v tau-agent-home:/root/.tau/agent \
  tau-sandbox
```

The `-v "$PWD:/workspace"` mount means reads and writes in `/workspace` inside Docker directly affect your host files.

Use a named volume for `/root/.tau/agent` if you want container-local settings and sessions. Mounting your host `~/.tau/agent` exposes host auth and session files to the container.
