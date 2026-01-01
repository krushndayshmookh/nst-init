const http = require('http')
const fs = require('fs')
const path = require('path')
const k8s = require('@kubernetes/client-node')

const PORT = process.env.PORT || 8080
const NS = (process.env.K8S_NAMESPACE || 'apps').trim()
if (!NS) {
  console.error('FATAL: K8S_NAMESPACE is empty')
  process.exit(1)
}

const APP_ZONE = (process.env.APP_ZONE || 'nstsdc.org').trim()
const APP_SCHEME = (process.env.APP_SCHEME || 'https').trim()
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, 'public')

console.log('ENV:', { PORT, NS, APP_ZONE, APP_SCHEME, PUBLIC_DIR })

function json(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(body)
}
function bad(res, msg, extra = {}) {
  json(res, 400, { ok: false, error: msg, ...extra })
}
function slug(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}
function validateK8sName(name) {
  return (
    !!name && name.length <= 63 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name)
  )
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}
function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`)
  let p = url.pathname === '/' ? '/index.html' : url.pathname
  p = path.normalize(p).replace(/^(\.\.(\/|\\|$))+/, '')
  const full = path.join(PUBLIC_DIR, p)
  try {
    const data = fs.readFileSync(full)
    const ext = path.extname(full).toLowerCase()
    const type =
      ext === '.html'
        ? 'text/html; charset=utf-8'
        : ext === '.js'
        ? 'text/javascript; charset=utf-8'
        : ext === '.css'
        ? 'text/css; charset=utf-8'
        : ext === '.json'
        ? 'application/json; charset=utf-8'
        : ext === '.svg'
        ? 'image/svg+xml'
        : ext === '.png'
        ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': type })
    res.end(data)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
  }
}

function is404(e) {
  return (
    e?.response?.statusCode === 404 ||
    e?.statusCode === 404 ||
    e?.body?.code === 404 ||
    (e?.message && e.message.includes('HTTP-Code: 404'))
  )
}

const kc = new k8s.KubeConfig()
try {
  kc.loadFromCluster()
} catch {
  kc.loadFromDefault()
}

const core = kc.makeApiClient(k8s.CoreV1Api)
const apps = kc.makeApiClient(k8s.AppsV1Api)
const net = kc.makeApiClient(k8s.NetworkingV1Api)

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
    await apps.replaceNamespacedDeployment({ name, namespace: NS, body })
  } catch (e) {
    if (is404(e))
      await apps.createNamespacedDeployment({ namespace: NS, body })
    else throw e
  }
}

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
    const existing = (await core.readNamespacedService({ name, namespace: NS })).body
    existing.spec.selector = { app: name }
    existing.spec.ports = [{ name: 'http', port: 80, targetPort }]
    await core.replaceNamespacedService({ name, namespace: NS, body: existing })
  } catch (e) {
    if (is404(e))
      await core.createNamespacedService({ namespace: NS, body })
    else throw e
  }
}

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
    await net.replaceNamespacedIngress({ name: ingName, namespace: NS, body })
  } catch (e) {
    if (is404(e))
      await net.createNamespacedIngress({ namespace: NS, body })
    else throw e
  }
}

async function listApps() {
  const resp = await net.listNamespacedIngress({
    namespace: NS,
    labelSelector: 'app.kubernetes.io/managed-by=nst-init',
  })
  const items = resp.body?.items || []
  const out = items.map((ing) => {
    const ingName = ing?.metadata?.name || ''
    const internalName = ingName.endsWith('-ing')
      ? ingName.slice(0, -4)
      : ingName
    const hosts = (ing?.spec?.rules || [])
      .map((r) => r?.host)
      .filter(Boolean)
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
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return out
}

async function removeApp(name) {
  const ingName = `${name}-ing`
  try {
    await net.deleteNamespacedIngress({ name: ingName, namespace: NS });
  } catch (e) {
    if (!is404(e)) throw e
  }
  try {
    await core.deleteNamespacedService({ name, namespace: NS })
  } catch (e) {
    if (!is404(e)) throw e
  }
  try {
    await apps.deleteNamespacedDeployment({ name, namespace: NS })
  } catch (e) {
    if (!is404(e)) throw e
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, { ok: true, status: 'up', ns: NS, zone: APP_ZONE })
    }

    if (req.method === 'GET' && url.pathname === '/api/apps') {
      const apps = await listApps()
      return json(res, 200, { ok: true, apps })
    }

    if (req.method === 'POST' && url.pathname === '/api/apps') {
      const raw = await readBody(req)
      let data
      try {
        data = JSON.parse(raw || '{}')
      } catch {
        return bad(res, 'Invalid JSON')
      }

      const owner = slug(data.owner)
      const appName = slug(data.appName)
      const image = String(data.image || '').trim()

      if (!owner) return bad(res, 'Owner required')
      if (!appName) return bad(res, 'App name required')

      const internalName = `${owner}-${appName}`.slice(0, 63)
      if (!validateK8sName(internalName))
        return bad(res, 'Invalid name (letters/numbers/dash)', { internalName })

      if (!image) return bad(res, 'GHCR image required')

      await upsertDeployment(internalName, owner, image, 8080)
      await upsertService(internalName, 8080)

      const host = `${internalName}.${APP_ZONE}`
      await upsertIngress(internalName, [host], owner)

      return json(res, 200, {
        ok: true,
        internalName,
        host,
        url: `${APP_SCHEME}://${host}`,
      })
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/apps/')) {
      const internalName = decodeURIComponent(
        url.pathname.replace('/api/apps/', '')
      )
      if (!validateK8sName(internalName)) return bad(res, 'Invalid app id')
      await removeApp(internalName)
      return json(res, 200, { ok: true })
    }

    return serveStatic(req, res)
  } catch (e) {
    console.error('API Error:', {
      method: req.method,
      url: req.url,
      statusCode: e?.response?.statusCode || e?.statusCode,
      message: e?.body?.message || e?.message,
      reason: e?.body?.reason,
      details: e?.body?.details,
      stack: e?.stack,
    })
    return bad(res, 'Server error', {
      message: e?.body?.message || e?.message || String(e),
      reason: e?.body?.reason,
      statusCode: e?.response?.statusCode || e?.statusCode,
      details: e?.body?.details,
    })
  }
})

server.listen(PORT, () => console.log(`NST init running on :${PORT}`))
