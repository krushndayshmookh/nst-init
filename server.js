const http = require("http");
const fs = require("fs");
const path = require("path");
const k8s = require("@kubernetes/client-node");

const PORT = process.env.PORT || 8080;
const NS = process.env.K8S_NAMESPACE || "apps";
const APP_ZONE = process.env.APP_ZONE || "dayshmookh.work"; // IMPORTANT: zone for apps
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, "public");

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(body);
}
function bad(res, msg, extra = {}) { json(res, 400, { ok: false, error: msg, ...extra }); }
function slug(s) {
  return String(s || "").trim().toLowerCase()
    .replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
function validateK8sName(name) {
  return !!name && name.length <= 63 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name);
}
function defaultPortForType(t) {
  switch (t) {
    case "node": return 3000;
    case "bun": return 3000;
    case "flask": return 5000;
    case "django": return 8000;
    case "image":
    default: return 8080;
  }
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => data += c);
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let p = url.pathname === "/" ? "/index.html" : url.pathname;
  p = path.normalize(p).replace(/^(\.\.(\/|\\|$))+/, "");
  const full = path.join(PUBLIC_DIR, p);
  try {
    const data = fs.readFileSync(full);
    const ext = path.extname(full).toLowerCase();
    const type = ext === ".html" ? "text/html" : ext === ".js" ? "text/javascript" : "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}

const kc = new k8s.KubeConfig();
try { kc.loadFromCluster(); } catch { kc.loadFromDefault(); }

const core = kc.makeApiClient(k8s.CoreV1Api);
const apps = kc.makeApiClient(k8s.AppsV1Api);
const net = kc.makeApiClient(k8s.NetworkingV1Api);

async function ensureNamespace() {
  try { await core.readNamespace(NS); }
  catch (e) { if (e?.response?.statusCode === 404) await core.createNamespace({ metadata: { name: NS } }); else throw e; }
}

async function upsertDeployment(name, owner, appType, image, containerPort) {
  const body = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name, namespace: NS, labels: { "app.kubernetes.io/managed-by":"nst-init", "nst.owner": owner, "nst.type": appType } },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: name } },
      template: {
        metadata: { labels: { app: name, "nst.owner": owner, "nst.type": appType } },
        spec: { containers: [{ name, image, ports: [{ containerPort }], env: [{ name: "PORT", value: String(containerPort) }] }] }
      }
    }
  };
  try { await apps.readNamespacedDeployment(name, NS); await apps.replaceNamespacedDeployment(name, NS, body); }
  catch (e) { if (e?.response?.statusCode === 404) await apps.createNamespacedDeployment(NS, body); else throw e; }
}

async function upsertService(name) {
  const body = {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name, namespace: NS, labels: { "app.kubernetes.io/managed-by":"nst-init" } },
    spec: { selector: { app: name }, ports: [{ name: "http", port: 80, targetPort: 1 }] } // patched below
  };
  try { await core.readNamespacedService(name, NS); /* keep existing */ }
  catch (e) { if (e?.response?.statusCode === 404) await core.createNamespacedService(NS, body); else throw e; }
}

async function replaceServicePort(name, targetPort) {
  const svc = (await core.readNamespacedService(name, NS)).body;
  svc.spec.ports = [{ name: "http", port: 80, targetPort }];
  await core.replaceNamespacedService(name, NS, svc);
}

async function upsertIngress(name, host) {
  const ingName = `${name}-ing`;
  const body = {
    apiVersion: "networking.k8s.io/v1",
    kind: "Ingress",
    metadata: { name: ingName, namespace: NS, labels: { "app.kubernetes.io/managed-by":"nst-init" } },
    spec: {
      rules: [{
        host,
        http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name, port: { number: 80 } } } }] }
      }]
    }
  };
  try { await net.readNamespacedIngress(ingName, NS); await net.replaceNamespacedIngress(ingName, NS, body); }
  catch (e) { if (e?.response?.statusCode === 404) await net.createNamespacedIngress(NS, body); else throw e; }
}

async function listApps() {
  const resp = await net.listNamespacedIngress(NS, undefined, undefined, undefined, undefined, "app.kubernetes.io/managed-by=nst-init");
  const items = resp.body.items || [];
  const out = items.map(ing => {
    const ingName = ing?.metadata?.name || "";
    const internalName = ingName.endsWith("-ing") ? ingName.slice(0, -4) : ingName;
    const host = ing?.spec?.rules?.[0]?.host || "";
    const owner = ing?.metadata?.labels?.["nst.owner"] || "";
    const type = ing?.metadata?.labels?.["nst.type"] || "";
    const createdAt = ing?.metadata?.creationTimestamp || "";
    return { internalName, owner, type, host, url: host ? `https://${host}` : "", createdAt };
  });
  out.sort((a,b)=> String(b.createdAt).localeCompare(String(a.createdAt)));
  return out;
}

async function removeApp(name) {
  const ingName = `${name}-ing`;
  try { await net.deleteNamespacedIngress(ingName, NS); } catch (e) { if (e?.response?.statusCode !== 404) throw e; }
  try { await core.deleteNamespacedService(name, NS); } catch (e) { if (e?.response?.statusCode !== 404) throw e; }
  try { await apps.deleteNamespacedDeployment(name, NS); } catch (e) { if (e?.response?.statusCode !== 404) throw e; }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/apps") {
      const apps = await listApps();
      return json(res, 200, { ok: true, apps });
    }

    if (req.method === "POST" && url.pathname === "/api/apps") {
      const raw = await readBody(req);
      let data; try { data = JSON.parse(raw || "{}"); } catch { return bad(res, "Invalid JSON"); }

      const owner = slug(data.owner);
      const appName = slug(data.appName);
      const appType = String(data.appType || "image").toLowerCase();
      const image = String(data.image || "").trim();
      const repo = String(data.repo || "").trim();

      if (!owner) return bad(res, "Owner required");
      if (!appName) return bad(res, "App name required");

      const internalName = `${owner}-${appName}`.slice(0, 63);
      if (!validateK8sName(internalName)) return bad(res, "Invalid name (letters/numbers/dash)", { internalName });

      if (!image) {
        if (repo) return bad(res, "Repo deploy not supported yet. Provide GHCR image.");
        return bad(res, "GHCR image required");
      }

      await ensureNamespace();

      const containerPort = defaultPortForType(appType);
      const host = `${internalName}.${APP_ZONE}`;
      const urlOut = `https://${host}`;

      await upsertDeployment(internalName, owner, appType, image, containerPort);
      await upsertService(internalName);
      await replaceServicePort(internalName, containerPort);
      await upsertIngress(internalName, host);

      return json(res, 200, { ok: true, internalName, url: urlOut });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/apps/")) {
      const internalName = decodeURIComponent(url.pathname.replace("/api/apps/",""));
      if (!validateK8sName(internalName)) return bad(res, "Invalid app id");
      await removeApp(internalName);
      return json(res, 200, { ok: true });
    }

    return serveStatic(req, res);
  } catch (e) {
    return bad(res, "Server error", { detail: String(e?.body?.message || e?.message || e) });
  }
});

server.listen(PORT, () => console.log(`NST init running on :${PORT}`));
