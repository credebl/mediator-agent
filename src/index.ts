import {
  DidCommOutOfBandInvitation,
  DidCommOutOfBandRepository,
  DidCommOutOfBandRole,
  DidCommOutOfBandState,
  OutOfBandDidCommService,
} from '@credo-ts/didcomm'

import { createAgent } from './agent'
import { AGENT_NAME, INVITATION_URL } from './constants'

void createAgent().then(async (agent) => {
  agent.config.logger.info('Agent started')

  // Try to find existing out of band record
  const oobRepo = agent.dependencyManager.resolve(DidCommOutOfBandRepository)
  const outOfBandRecords = await oobRepo.findByQuery(agent.context, {
    state: DidCommOutOfBandState.AwaitResponse,
    role: DidCommOutOfBandRole.Sender,
  })

  let outOfBandRecord = outOfBandRecords.find((oobRecord) => oobRecord.reusable)

  // If it does't exist, we create a new one
  if (!outOfBandRecord) {
    outOfBandRecord = await agent.didcomm.oob.createInvitation({
      multiUseInvitation: true,
      label: AGENT_NAME,
    })
  }

  const httpEndpoint = agent.didcomm.config.endpoints.find((e) => e.startsWith('http')) as string
  const wsEndpoint = agent.didcomm.config.endpoints.find((e) => e.startsWith('ws')) as string

  const checkAreServiceEndpointSame = outOfBandRecord.outOfBandInvitation.getInlineServices().every((service) => {
    return service.serviceEndpoint === httpEndpoint || service.serviceEndpoint === wsEndpoint
  })

  agent.config.logger.info(
    `Checking if Agent endpoints are same as out of band service endpoints: ${checkAreServiceEndpointSame}`
  )

  if (!checkAreServiceEndpointSame) {
    const newOobInvitation = new DidCommOutOfBandInvitation({
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
