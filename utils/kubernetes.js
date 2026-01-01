const k8s = require('@kubernetes/client-node')
const { is404 } = require('./helpers')

const NS = (process.env.K8S_NAMESPACE || 'apps').trim()
if (!NS) {
  console.error('FATAL: K8S_NAMESPACE is empty')
  process.exit(1)
}

const APP_ZONE = (process.env.APP_ZONE || 'nstsdc.org').trim()
const APP_SCHEME = (process.env.APP_SCHEME || 'https').trim()

// Initialize Kubernetes client
const kc = new k8s.KubeConfig()
try {
  kc.loadFromCluster()
} catch {
  kc.loadFromDefault()
}

const core = kc.makeApiClient(k8s.CoreV1Api)
const apps = kc.makeApiClient(k8s.AppsV1Api)
const net = kc.makeApiClient(k8s.NetworkingV1Api)

/**
 * Create or update a Kubernetes Deployment
 */
async function upsertDeployment(name, owner, image, containerPort) {
  const body = {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name,
      namespace: NS,
      labels: {
        'app.kubernetes.io/managed-by': 'nst-init',
        'nst.owner': owner,
      },
    },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: name } },
      template: {
        metadata: {
          labels: { app: name, 'nst.owner': owner },
        },
        spec: {
          containers: [
            {
              name,
              image,
              ports: [{ containerPort }],
              env: [{ name: 'PORT', value: String(containerPort) }],
            },
          ],
        },
      },
    },
  }
  try {
    await apps.readNamespacedDeployment({ name, namespace: NS })
    console.log(`Updated deployment: ${name}`)
    await apps.replaceNamespacedDeployment({ name, namespace: NS, body })
  } catch (e) {
    if (is404(e)) {
      console.log(`Created deployment: ${name}`)
      await apps.createNamespacedDeployment({ namespace: NS, body })
    } else throw e
  }
}

/**
 * Create or update a Kubernetes Service
 */
async function upsertService(name, targetPort) {
  const body = {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: {
      name,
      namespace: NS,
      labels: { 'app.kubernetes.io/managed-by': 'nst-init' },
    },
    spec: {
      selector: { app: name },
      ports: [{ name: 'http', port: 80, targetPort }],
    },
  }

  try {
    const existing = await core.readNamespacedService({ name, namespace: NS })
    console.log(`Updated service: ${name}`)
    existing.spec.selector = { app: name }
    existing.spec.ports = [{ name: 'http', port: 80, targetPort }]
    await core.replaceNamespacedService({ name, namespace: NS, body: existing })
  } catch (e) {
    if (is404(e)) {
      console.log(`Created service: ${name}`)
      await core.createNamespacedService({ namespace: NS, body })
    } else throw e
  }
}

/**
 * Create or update a Kubernetes Ingress
 */
async function upsertIngress(name, hosts, owner) {
  const ingName = `${name}-ing`
  const rules = (hosts || [])
    .map((h) => String(h || '').trim())
    .filter(Boolean)
    .map((host) => ({
      host,
      http: {
        paths: [
          {
            path: '/',
            pathType: 'Prefix',
            backend: { service: { name, port: { number: 80 } } },
          },
        ],
      },
    }))

  const body = {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'Ingress',
    metadata: {
      name: ingName,
      namespace: NS,
      labels: {
        'app.kubernetes.io/managed-by': 'nst-init',
        'nst.owner': owner,
      },
    },
    spec: {
      ingressClassName: 'traefik',
      rules,
    },
  }

  try {
    await net.readNamespacedIngress({ name: ingName, namespace: NS })
    console.log(`Updated ingress: ${ingName}`)
    await net.replaceNamespacedIngress({ name: ingName, namespace: NS, body })
  } catch (e) {
    if (is404(e)) {
      console.log(`Created ingress: ${ingName}`)
      await net.createNamespacedIngress({ namespace: NS, body })
    } else throw e
  }
}

/**
 * List all apps managed by nst-init
 */
async function listApps() {
  const resp = await net.listNamespacedIngress({
    namespace: NS,
    labelSelector: 'app.kubernetes.io/managed-by=nst-init',
  })
  const items = resp.items || []
  console.log(`Listed ${items.length} app(s)`)

  const out = items.map((ing) => {
    const ingName = ing?.metadata?.name || ''
    const internalName = ingName.endsWith('-ing')
      ? ingName.slice(0, -4)
      : ingName
    const hosts = (ing?.spec?.rules || []).map((r) => r?.host).filter(Boolean)
    const owner = ing?.metadata?.labels?.['nst.owner'] || ''
    const createdAt = ing?.metadata?.creationTimestamp || ''
    return {
      internalName,
      owner,
      hosts,
      urls: hosts.map((h) => `${APP_SCHEME}://${h}`),
      createdAt,
    }
  })

  // Fetch port information from services
  for (const app of out) {
    try {
      const svc = await core.readNamespacedService({
        name: app.internalName,
        namespace: NS,
      })
      app.port = svc.spec?.ports?.[0]?.targetPort || null
    } catch (e) {
      console.error(`Failed to get service for ${app.internalName}:`, e?.message || e)
      app.port = null
    }
  }

  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return out
}

/**
 * Remove all resources for an app
 */
async function removeApp(name) {
  console.log(`Deleting app: ${name}`)
  const ingName = `${name}-ing`

  let deleted = []
  try {
    await net.deleteNamespacedIngress({ name: ingName, namespace: NS })
    deleted.push('ingress')
  } catch (e) {
    if (!is404(e)) throw e
  }
  try {
    await core.deleteNamespacedService({ name, namespace: NS })
    deleted.push('service')
  } catch (e) {
    if (!is404(e)) throw e
  }
  try {
    await apps.deleteNamespacedDeployment({ name, namespace: NS })
    deleted.push('deployment')
  } catch (e) {
    if (!is404(e)) throw e
  }

  console.log(`Deleted app ${name}: ${deleted.join(', ')}`)
}

module.exports = {
  NS,
  APP_ZONE,
  APP_SCHEME,
  upsertDeployment,
  upsertService,
  upsertIngress,
  listApps,
  removeApp,
}
