import { EventEmitter, InjectionSymbols, inject, injectable, Repository, type StorageService } from '@credo-ts/core'

import { DidCommPushNotificationsFcmRecord } from './DidCommPushNotificationsFcmRecord'

@injectable()
export class DidCommPushNotificationsFcmRepository extends Repository<DidCommPushNotificationsFcmRecord> {
  public constructor(
    @inject(InjectionSymbols.StorageService) storageService: StorageService<DidCommPushNotificationsFcmRecord>,
    @inject(EventEmitter) eventEmitter: EventEmitter
  ) {
    super(DidCommPushNotificationsFcmRecord, storageService, eventEmitter)
  }
}
