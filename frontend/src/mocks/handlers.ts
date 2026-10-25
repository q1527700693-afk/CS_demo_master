import { mockModules } from '@/app/config'
import { analysisHandlers } from './analysis-handlers'
import { accountHandlers } from './account-handlers'
// Friends and lobbies always use the real backend contract.
export const handlers = [...accountHandlers, ...(mockModules.replay ? analysisHandlers : [])]
