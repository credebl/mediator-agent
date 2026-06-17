import type { Socket } from 'node:net'
import {
  AskarModule,
  AskarModuleConfigStoreOptions,
  AskarMultiWalletDatabaseScheme,
  AskarStoreDuplicateError,
} from '@credo-ts/askar'
import { Agent, PeerDidNumAlgo } from '@credo-ts/core'
import {
  DidCommHttpOutboundTransport,
  DidCommMimeType,
  DidCommModule,
  DidCommOutOfBandRole,
  DidCommOutOfBandState,
  DidCommQueueTransportRepository,
  DidCommWsOutboundTransport,
} from '@credo-ts/didcomm'
import { agentDependencies, DidCommHttpInboundTransport, DidCommWsInboundTransport } from '@credo-ts/node'
import { askarNodeJS } from '@openwallet-foundation/askar-nodejs'
import express, { type Express } from 'express'
import { Server, WebSocketServer } from 'ws'

import { AGENT_ENDPOINTS, AGENT_PORT, LOG_LEVEL, POSTGRES_HOST, WALLET_KEY, WALLET_NAME } from './constants'
import { askarPostgresConfig } from './database'
import { Logger } from './logger'
import { DidCommPushNotificationsFcmModule } from './push-notifications/fcm'
import { StorageServiceMessageQueue } from './storage/StorageMessageQueue'

function createModules(
  storeConfig: AskarModuleConfigStoreOptions,
  app: Express,
  socketServer: WebSocketServer,
  queueTransportRepository: DidCommQueueTransportRepository
) {
  const modules = {
    didcomm: new DidCommModule({
      connections: {
        autoAcceptConnections: true,
        peerNumAlgoForDidExchangeRequests: PeerDidNumAlgo.InceptionKeyWithoutDoc,
      },
      mediator: {
        autoAcceptMediationRequests: true,
      },
      queueTransportRepository,
      transports: {
        inbound: [
          new DidCommHttpInboundTransport({ app, port: AGENT_PORT }),
          new DidCommWsInboundTransport({ server: socketServer }),
        ],
        outbound: [new DidCommHttpOutboundTransport(), new DidCommWsOutboundTransport()],
      },
      endpoints: AGENT_ENDPOINTS,
      useDidSovPrefixWhereAllowed: true,
      didCommMimeType: DidCommMimeType.V0,
    }),
    askar: new AskarModule({
      askar: askarNodeJS,
      store: storeConfig,
      multiWalletDatabaseScheme: AskarMultiWalletDatabaseScheme.ProfilePerWallet,
    }),
    pushNotificationsFcm: new DidCommPushNotificationsFcmModule(),
  }

  return modules
}

export async function createAgent() {
  // We create our own instance of express here. This is not required
  // but allows use to use the same server (and port) for both WebSockets and HTTP
  const app = express()
  const socketServer = new Server({ noServer: true })

  const logger = new Logger(LOG_LEVEL)

  const queueTransportRepository = new StorageServiceMessageQueue()
  // Only load postgres database in production
  const storageConfig = POSTGRES_HOST ? askarPostgresConfig : undefined

  const walletConfig: AskarModuleConfigStoreOptions = {
    id: WALLET_NAME,
    key: WALLET_KEY,
    database: storageConfig,
  }

  if (storageConfig) {
    logger.info('Using postgres storage', {
      walletId: walletConfig.id,
      host: storageConfig.config.host,
    })
  } else {
    logger.info('Using SQlite storage', {
      walletId: walletConfig.id,
    })
  }

  const agent = new Agent({
    config: {
      logger: logger,
      autoUpdateStorageOnStartup: true,
    },
    dependencies: agentDependencies,
    modules: {
      ...createModules(walletConfig, app, socketServer, queueTransportRepository),
    },
  })

  // Added health check endpoint

  app.get('/health', async (_req, res) => {
    res.status(200).send('Ok')
  })

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  app.get('/invite', async (req, res) => {
    if (!req.query._oobid || typeof req.query._oobid !== 'string') {
      return res.status(400).send('Missing or invalid _oobid')
    }

    const outOfBandRecord = await agent.didcomm.oob.findById(req.query._oobid)

    if (
      !outOfBandRecord ||
      outOfBandRecord.role !== DidCommOutOfBandRole.Sender ||
      outOfBandRecord.state !== DidCommOutOfBandState.AwaitResponse
    ) {
      return res.status(400).send(`No invitation found for _oobid ${req.query._oobid}`)
    }
    return res.send(outOfBandRecord.outOfBandInvitation.toJSON())
  })

  try {
    await agent.modules.askar.provisionStore()
    agent.config.logger.info('Provisioned store')
  } catch (error) {
    if (error instanceof AskarStoreDuplicateError) {
      agent.config.logger.info('Store already exists')
    } else {
      agent.config.logger.error('Error provisioning store', {
        error,
      })
    }
  }

  await agent.initialize()

  const inboundTransport = agent.didcomm.config.inboundTransports.find(
    (transport) => transport instanceof DidCommHttpInboundTransport
  )

  inboundTransport?.server?.on('listening', () => {
    logger.info(`Agent listening on port ${AGENT_PORT}`)
  })

  inboundTransport?.server?.on('error', (err) => {
    logger.error(`Agent failed to start on port ${AGENT_PORT}`, err)
  })

  inboundTransport?.server?.on('close', () => {
    logger.info(`Agent stopped listening on port ${AGENT_PORT}`)
  })

  // When an 'upgrade' to WS is made on our http server, we forward the
  // request to the WS server
  inboundTransport?.server?.on('upgrade', (request, socket, head) => {
    socketServer.handleUpgrade(request, socket as Socket, head, (socket) => {
      socketServer.emit('connection', socket, request)
    })
  })

  return agent
}

export type MediatorAgent = Agent<ReturnType<typeof createModules>>
