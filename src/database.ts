import type { AskarPostgresStorageConfig } from '@credo-ts/askar'

import { POSTGRES_HOST, POSTGRES_PASSWORD, POSTGRES_USER } from './constants'

export const askarPostgresConfig: AskarPostgresStorageConfig = {
  // AskarWalletPostgresStorageConfig defines interface for the Postgres plugin configuration.
  type: 'postgres',
  config: {
    host: POSTGRES_HOST as string,
    connectTimeout: 10,
  },
  credentials: {
    account: POSTGRES_USER as string,
    password: POSTGRES_PASSWORD as string,
    adminAccount: POSTGRES_USER as string,
    adminPassword: POSTGRES_PASSWORD as string,
  },
}
