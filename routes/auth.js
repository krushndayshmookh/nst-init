const express = require('express')
const axios = require('axios')
const jwt = require('jsonwebtoken')

const router = express.Router()

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET
const CALLBACK_URL = process.env.CALLBACK_URL || 'http://localhost:8080/auth/github/callback'
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production'

if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
  console.warn('WARNING: GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET not set. Authentication will not work.')
}

/**
 * GET /auth/github
 * Redirect to GitHub OAuth
 */
router.get('/github', (req, res) => {
  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(CALLBACK_URL)}&scope=user:email`
  res.redirect(githubAuthUrl)
})

/**
 * GET /auth/github/callback
 * Handle GitHub OAuth callback
 */
router.get('/github/callback', async (req, res) => {
  const { code } = req.query

  if (!code) {
    return res.redirect('/?error=no_code')
  }

  try {
    // Exchange code for access token
    const tokenResponse = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
      },
      {
        headers: { Accept: 'application/json' },
      }
    )

    const { access_token } = tokenResponse.data

    if (!access_token) {
      return res.redirect('/?error=no_token')
    }

    // Get user info from GitHub
    const userResponse = await axios.get('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${access_token}`,
        Accept: 'application/json',
      },
    })

    const user = userResponse.data

    // Generate JWT token
    const token = jwt.sign(
      {
        githubId: user.id,
        username: user.login,
        name: user.name,
        avatar: user.avatar_url,
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    )

    console.log(`User logged in: ${user.login} (${user.id})`)

    // Redirect with token in URL
    res.redirect(`/?token=${token}`)
  } catch (error) {
    console.error('GitHub OAuth error:', error.message)
    res.redirect('/?error=auth_failed')
  }
})

/**
 * GET /auth/user
 * Get current user info
 */
router.get('/user', (req, res) => {
  const authHeader = req.headers.authorization
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null

  if (!token) {
    return res.json({ ok: true, user: null })
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    res.json({ ok: true, user: decoded })
  } catch (err) {
    console.error('JWT verification error:', err.message)
    res.json({ ok: true, user: null })
  }
})

/**
 * POST /auth/logout
 * Logout user (client-side only with JWT)
 */
router.post('/logout', (req, res) => {
  // With JWT, logout is handled client-side by removing the token
  res.json({ ok: true })
})

module.exports = router
