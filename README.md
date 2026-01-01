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

1. **Create a GitHub OAuth App:**
   - Go to GitHub Settings → Developer settings → OAuth Apps → New OAuth App
   - Set Homepage URL: `https://init.nstsdc.org`
   - Set Authorization callback URL: `https://init.nstsdc.org/auth/github/callback`
   - Note down your Client ID and Client Secret

2. Update the GitHub credentials in `k8s.yaml`:
   - Replace `your-github-client-id` with your GitHub OAuth Client ID
   - Replace `your-github-client-secret` with your GitHub OAuth Client Secret
   - Change `JWT_SECRET` to a random string

   If you need to use a different domain, replace `nstsdc.org`:

   ```bash
   # macOS
   sed -i '' 's/nstsdc.org/yourdomain.com/g' k8s.yaml
   
   # Linux
   sed -i 's/nstsdc.org/yourdomain.com/g' k8s.yaml
   ```

3. Apply the Kubernetes manifests:

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
- `GITHUB_CLIENT_ID` - GitHub OAuth App Client ID (required)
- `GITHUB_CLIENT_SECRET` - GitHub OAuth App Client Secret (required)
- `CALLBACK_URL` - GitHub OAuth callback URL (required)
- `JWT_SECRET` - Secret for JWT token encryption (required)

## Authentication

NST init uses GitHub OAuth with JWT (JSON Web Tokens) for authentication. Users must login with GitHub to:

- Deploy new applications
- Delete their own deployments

Viewing deployed apps is public and doesn't require authentication. JWT tokens are stored in browser localStorage and are valid for 7 days. Deployments are tracked by GitHub user ID, so ownership persists even if users change their GitHub username.
