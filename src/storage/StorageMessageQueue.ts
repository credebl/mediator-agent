import { AgentContext, injectable, utils } from '@credo-ts/core'
import type {
  AddMessageOptions,
  DidCommQueueTransportRepository,
  GetAvailableMessageCountOptions,
  QueuedDidCommMessage,
  RemoveMessagesOptions,
  TakeFromQueueOptions,
} from '@credo-ts/didcomm'
import { NOTIFICATION_WEBHOOK_URL, USE_PUSH_NOTIFICATIONS } from '../constants'
import { DidCommPushNotificationsFcmRepository } from '../push-notifications/fcm'
import { MessageRecord } from './MessageRecord'
import { MessageRepository } from './MessageRepository'

export interface NotificationMessage {
  messageType: string
  token: string
  clientCode: string
}

@injectable()
export class StorageServiceMessageQueue implements DidCommQueueTransportRepository {
  public async getAvailableMessageCount(agentContext: AgentContext, options: GetAvailableMessageCountOptions) {
    const { connectionId } = options

    const messageRepository = agentContext.resolve(MessageRepository)
    const messageRecords = await messageRepository.findByConnectionId(agentContext, connectionId)

    agentContext.config.logger.debug(`Found ${messageRecords.length} messages for connection ${connectionId}`)

    return messageRecords.length
  }

  public async takeFromQueue(
    agentContext: AgentContext,
    options: TakeFromQueueOptions
  ): Promise<QueuedDidCommMessage[]> {
    const { connectionId, limit, deleteMessages } = options

    const messageRepository = agentContext.resolve(MessageRepository)
    const messageRecords = await messageRepository.findByConnectionId(agentContext, connectionId)

    const messagesToTake = limit ?? messageRecords.length
    agentContext.config.logger.debug(
      `Taking ${messagesToTake} messages from queue for connection ${connectionId} (of total ${
        messageRecords.length
      }) with deleteMessages=${String(deleteMessages)}`
    )

    const messageRecordsToReturn = messageRecords.splice(0, messagesToTake)

    if (deleteMessages) {
      this.removeMessages(agentContext, { connectionId, messageIds: messageRecordsToReturn.map((msg) => msg.id) })
    }

    const queuedMessages = messageRecordsToReturn.map((messageRecord) => ({
      id: messageRecord.id,
      receivedAt: messageRecord.createdAt,
      encryptedMessage: messageRecord.message,
    }))

    return queuedMessages
  }

  public async addMessage(agentContext: AgentContext, options: AddMessageOptions) {
    const { connectionId, payload, messageType } = options

    agentContext.config.logger.debug(
      `Adding message to queue for connection ${connectionId} with payload ${JSON.stringify(payload)}`
    )

    const messageRepository = agentContext.resolve(MessageRepository)

    const id = utils.uuid()
    await messageRepository.save(
      agentContext,
      new MessageRecord({
        id,
        connectionId,
        message: payload,
      })
    )

    // Send a notification to the device
    if (USE_PUSH_NOTIFICATIONS && NOTIFICATION_WEBHOOK_URL) {
      await this.sendNotification(agentContext, connectionId, messageType)
    }

    return id
  }

  public async removeMessages(agentContext: AgentContext, options: RemoveMessagesOptions) {
    const { messageIds } = options

    agentContext.config.logger.debug(`Removing message ids ${messageIds}`)
    const messageRepository = agentContext.resolve(MessageRepository)

    const deletePromises = messageIds.map((messageId) => messageRepository.deleteById(agentContext, messageId))

    await Promise.all(deletePromises)
  }

  private async sendNotification(agentContext: AgentContext, connectionId: string, messageType?: string) {
    try {
      const pushNotificationsFcmRepository = agentContext.resolve(DidCommPushNotificationsFcmRepository)

      // Get the device token for the connection
      const pushNotificationFcmRecord = await pushNotificationsFcmRepository.findSingleByQuery(agentContext, {
        connectionId,
      })

      if (!pushNotificationFcmRecord?.deviceToken) {
        agentContext.config.logger.info(`No device token found for connectionId so skip sending notification`)
        return
      }

      // Prepare a message to be sent to the device
      const message: NotificationMessage = {
        messageType: messageType || 'default',
        token: pushNotificationFcmRecord?.deviceToken || '',
        clientCode: pushNotificationFcmRecord?.clientCode || '',
      }

      agentContext.config.logger.info(`Sending notification to ${pushNotificationFcmRecord?.connectionId}`)
      await this.processNotification(agentContext, message)
      agentContext.config.logger.info(`Notification sent successfully to ${connectionId}`)
    } catch (error) {
      agentContext.config.logger.error(`Error sending notification`, {
        cause: error,
      })
    }
  }

  private async processNotification(agentContext: AgentContext, message: NotificationMessage) {
    try {
      const body = {
        fcmToken: message.token || 'abc',
        messageType: message.messageType,
        clientCode: message.clientCode || '5b4d6bc6-362e-4f53-bdad-ee2742bc0de3',
      }
      const requestOptions = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }

      const response = await fetch(NOTIFICATION_WEBHOOK_URL, requestOptions)

      if (response.ok) {
        agentContext.config.logger.info(`Notification sent successfully`)
      } else {
        agentContext.config.logger.error(`Error sending notification`, {
          cause: response.statusText,
        })
      }
    } catch (error) {
      agentContext.config.logger.error(`Error sending notification`, {
        cause: error,
      })
    }
  }
}
