const express = require('express')
const { NS, APP_ZONE } = require('../utils/kubernetes')

const router = express.Router()

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({ ok: true, status: 'up', ns: NS, zone: APP_ZONE })
})

module.exports = router
