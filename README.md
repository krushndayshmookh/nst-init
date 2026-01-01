# NST init

A web-based Kubernetes deployment tool that makes it easy to deploy containerized applications with automatic ingress routing and service configuration.

## Prerequisites

- Node.js 22 or higher
- Access to a Kubernetes cluster
- kubectl configured with cluster access

For development you can use [Minikube](https://minikube.sigs.k8s.io/docs/start/) or [Kind](https://kind.sigs.k8s.io/docs/user/quick-start/) and for frontend development you do not need a cluster.

## Setup

```bash
npm install
```

## Usage

### Local Development

```bash
npm start
```

Open <http://localhost:8080> in your browser.

### Deploy to Kubernetes

1. First, update the domain in `k8s.yaml`. You need to replace `nstsdc.org` with your actual domain in:
    - `APP_ZONE` environment variable in `Deployment` section (`spec.template.spec.containers.env`)
    - `host` in `Ingress` section (`spec.rules.host`)

    You can use this command to replace all occurrences:

    ```bash
    # macOS
    sed -i '' 's/nstsdc.org/yourdomain.com/g' k8s.yaml
    
    # Linux
    sed -i 's/nstsdc.org/yourdomain.com/g' k8s.yaml
    ```

2. Apply the Kubernetes manifests:

    ```bash
    kubectl apply -f k8s.yaml
    ```

    The manifests use the pre-built image: `ghcr.io/krushndayshmookh/nst-init:latest`

### Build Custom Image (Optional)

If you want to build your own image:

```bash
docker buildx build --platform linux/amd64 -t ghcr.io/your-username/nst-init:latest --push .
```

Then update the image in `k8s.yaml` under the `Deployment` section (`spec.template.spec.containers.image`):

```yaml
image: ghcr.io/your-username/nst-init:latest
```

## Configuration

Set these environment variables in your Kubernetes deployment:

- `K8S_NAMESPACE` - Kubernetes namespace for deployments (default: `apps`)
- `APP_ZONE` - Domain zone for ingress (default: `nstsdc.org`)
- `APP_SCHEME` - URL scheme (default: `https`)
- `PORT` - Server port (default: `8080`)
