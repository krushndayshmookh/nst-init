const jwt = require('jsonwebtoken')

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production'

/**
 * Require authentication middleware
 * Returns 401 if user is not logged in
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null

  if (!token) {
    return res.status(401).json({ ok: false, error: 'Authentication required' })
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    req.user = decoded
    next()
  } catch (err) {
    console.error('JWT verification error:', err.message)
    return res.status(401).json({ ok: false, error: 'Invalid token' })
  }
}

/**
 * Optional authentication middleware
 * Adds user to request if logged in, but doesn't block
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET)
      req.user = decoded
    } catch (err) {
      // Invalid token, but don't block
      console.error('JWT verification error:', err.message)
    }
  }
  next()
}

module.exports = {
  requireAuth,
  optionalAuth,
}
