import { otelSDK } from './tracer';
import {
  OutOfBandDidCommService,
  OutOfBandInvitation,
  OutOfBandRepository,
  OutOfBandRole,
  OutOfBandState,
} from '@credo-ts/core'

import { createAgent } from './agent'
import { INVITATION_URL } from './constants'

void createAgent().then(async (agent) => {
  if (otelSDK) {
      await otelSDK.start();
      // eslint-disable-next-line no-console
      console.log('OpenTelemetry SDK started successfully');
    } else {
      // eslint-disable-next-line no-console
      console.log('OpenTelemetry SDK disabled for this environment');
    }
  agent.config.logger.info('Agent started')

  // Try to find existing out of band record
  const oobRepo = agent.dependencyManager.resolve(OutOfBandRepository)
  const outOfBandRecords = await oobRepo.findByQuery(agent.context, {
    state: OutOfBandState.AwaitResponse,
    role: OutOfBandRole.Sender,
  })

  let outOfBandRecord = outOfBandRecords.find((oobRecord) => oobRecord.reusable)

  // If it does't exist, we create a new one
  if (!outOfBandRecord) {
    outOfBandRecord = await agent.oob.createInvitation({
      multiUseInvitation: true,
    })
  }

  const httpEndpoint = agent.config.endpoints.find((e) => e.startsWith('http')) as string
  const wsEndpoint = agent.config.endpoints.find((e) => e.startsWith('ws')) as string

  const checkAreServiceEndpointSame = outOfBandRecord.outOfBandInvitation.getInlineServices().every((service) => {
    return service.serviceEndpoint === httpEndpoint || service.serviceEndpoint === wsEndpoint
  })

  agent.config.logger.info(
    `Checking if Agent endpoints are same as out of band service endpoints: ${checkAreServiceEndpointSame}`
  )

  if (!checkAreServiceEndpointSame) {
    const newOobInvitation = new OutOfBandInvitation({
      ...outOfBandRecord.outOfBandInvitation.toJSON(),
      id: outOfBandRecord.outOfBandInvitation.id,
      handshakeProtocols: outOfBandRecord.outOfBandInvitation.handshakeProtocols,
      services: outOfBandRecord.outOfBandInvitation.getInlineServices().map((oobService) => {
        let serviceEndpoint = oobService.serviceEndpoint
        if (oobService.serviceEndpoint.startsWith('http')) {
          serviceEndpoint = httpEndpoint
        } else {
          serviceEndpoint = wsEndpoint
        }

        return new OutOfBandDidCommService({
          id: oobService.id,
          recipientKeys: oobService.recipientKeys,
          routingKeys: oobService.routingKeys,
          serviceEndpoint,
        })
      }),
    })

    outOfBandRecord.outOfBandInvitation = newOobInvitation

    agent.config.logger.info(`Updating the out of band record with new service endpoints`)
    await oobRepo.update(agent.context, outOfBandRecord)
  }

  const invitationEndpoint = INVITATION_URL ?? `${httpEndpoint}/invite`
  const mediatorInvitationUrlLong = outOfBandRecord.outOfBandInvitation.toUrl({
    domain: invitationEndpoint,
  })

  agent.config.logger.info(`Out of band invitation url: \n\n\t${mediatorInvitationUrlLong}`)
})
