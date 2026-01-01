const express = require('express')
const path = require('path')
const healthRoutes = require('./routes/health')
const appsRoutes = require('./routes/apps')
const errorHandler = require('./middleware/errorHandler')
const { NS, APP_ZONE } = require('./utils/kubernetes')

const PORT = process.env.PORT || 8080
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, 'public')

console.log('Starting NST init server...')
console.log(`Namespace: ${NS}, Zone: ${APP_ZONE}, Port: ${PORT}`)

const app = express()

// Middleware
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// API Routes
app.use('/api', healthRoutes)
app.use('/api/apps', appsRoutes)

// Static files (public directory)
app.use(express.static(PUBLIC_DIR))

// Error handling middleware (must be last)
app.use(errorHandler)

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
