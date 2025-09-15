import { config } from 'dotenv'
config()

const port = 3001
const url = `http://localhost:${port}`

process.env.NODE_ENV = 'development'
process.env.AGENT_PORT = `${port}`
process.env.AGENT_ENDPOINTS = `http://192.168.1.25:3001,ws://192.168.1.25:3001`
process.env.SHORTENER_BASE_URL = `${url}/s`

require('./src/index')
