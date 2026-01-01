const express = require('express')
const { slug, validateK8sName } = require('../utils/helpers')
const {
  APP_ZONE,
  APP_SCHEME,
  upsertDeployment,
  upsertService,
  upsertIngress,
  listApps,
  removeApp,
} = require('../utils/kubernetes')

const router = express.Router()

/**
 * GET /api/apps
 * List all deployed apps
 */
router.get('/', async (req, res, next) => {
  try {
    const apps = await listApps()
    res.json({ ok: true, apps })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/apps
 * Deploy a new app or update existing one
 */
router.post('/', async (req, res, next) => {
  try {
    const { owner, appName, image, port } = req.body

    const ownerSlug = slug(owner)
    const appNameSlug = slug(appName)
    const imageUrl = String(image || '').trim()
    const containerPort = parseInt(port, 10) || 8080

    if (!ownerSlug) {
      return res.status(400).json({ ok: false, error: 'Owner required' })
    }
    if (!appNameSlug) {
      return res.status(400).json({ ok: false, error: 'App name required' })
    }

    const internalName = `${ownerSlug}-${appNameSlug}`.slice(0, 63)
    if (!validateK8sName(internalName)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid name (letters/numbers/dash)',
        internalName,
      })
    }

    if (!imageUrl) {
      return res.status(400).json({ ok: false, error: 'GHCR image required' })
    }
    if (containerPort < 1 || containerPort > 65535) {
      return res
        .status(400)
        .json({ ok: false, error: 'Port must be between 1 and 65535' })
    }

    console.log(`Deploying app: ${internalName} (${imageUrl}:${containerPort})`)

    await upsertDeployment(internalName, ownerSlug, imageUrl, containerPort)
    await upsertService(internalName, containerPort)

    const host = `${appNameSlug}.${APP_ZONE}`
    await upsertIngress(internalName, [host], ownerSlug)

    console.log(`App deployed: ${internalName} at ${APP_SCHEME}://${host}`)

    res.json({
      ok: true,
      internalName,
      host,
      url: `${APP_SCHEME}://${host}`,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /api/apps/:name
 * Remove an app and all its resources
 */
router.delete('/:name', async (req, res, next) => {
  try {
    const internalName = decodeURIComponent(req.params.name)
    
    if (!validateK8sName(internalName)) {
      return res.status(400).json({ ok: false, error: 'Invalid app id' })
    }

    await removeApp(internalName)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

module.exports = router
