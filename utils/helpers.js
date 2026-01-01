/**
 * Convert a string to a URL-safe slug
 */
function slug(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Validate Kubernetes resource name
 * Must be lowercase alphanumeric with dashes, max 63 chars
 */
function validateK8sName(name) {
  return (
    !!name && name.length <= 63 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name)
  )
}

/**
 * Check if error is a 404 from Kubernetes API
 */
function is404(e) {
  return (
    e?.response?.statusCode === 404 ||
    e?.statusCode === 404 ||
    e?.body?.code === 404 ||
    (e?.message && e.message.includes('HTTP-Code: 404'))
  )
}

module.exports = {
  slug,
  validateK8sName,
  is404,
}
