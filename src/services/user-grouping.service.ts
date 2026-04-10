import { ref, get, set, type Database } from 'firebase/database'
import type { GroupingFieldKey, UserGroupingId } from '@/lib/userGrouping'

export type UserGroupingConfigItemKind = 'builtin' | 'byField'

export interface UserGroupingConfigItem {
  readonly id: UserGroupingId
  readonly enabled: boolean
  readonly label?: string | null
  readonly kind?: UserGroupingConfigItemKind
  readonly fieldKey?: GroupingFieldKey | null
}

export interface UserGroupingConfig {
  readonly items: readonly UserGroupingConfigItem[]
}

function getConfigRef(database: Database) {
  return ref(database, 'settings/userGrouping')
}

export async function getUserGroupingConfig(database: Database): Promise<UserGroupingConfig | null> {
  const snapshot = await get(getConfigRef(database))
  if (!snapshot.exists()) {
    return null
  }
  const value = snapshot.val() as UserGroupingConfig | null
  return value ?? null
}

export async function saveUserGroupingConfig(database: Database, config: UserGroupingConfig): Promise<void> {
  await set(getConfigRef(database), config)
}
