/**
 * Centralized error handling middleware
 * Catches errors from async routes and formats response
 */
function errorHandler(err, req, res, next) {
  // Log error details
  console.error(`Error [${req.method} ${req.url}]:`, err?.message || String(err))

  // Extract status code
  const statusCode = err?.response?.statusCode || err?.statusCode || 500

  // Format error response
  res.status(statusCode).json({
    ok: false,
    error: 'Server error',
    message: err?.body?.message || err?.message || String(err),
    reason: err?.body?.reason,
    statusCode,
    details: err?.body?.details,
  })
}

module.exports = errorHandler
