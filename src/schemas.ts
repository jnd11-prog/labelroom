/**
 * Collection Schemas — single source of truth for worker and frontend.
 */

import type { CollectionSchema } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'
import {
  commentsSchema,
  itemsSchema,
  labelsSchema,
  roomStatsSchema,
  roomsSchema,
  teamMembersSchema,
} from './schemas/labelroom-schemas'

export const schemas: CollectionSchema[] = [
  usersSchema,
  settingsSchema,
  teamMembersSchema,
  roomsSchema,
  itemsSchema,
  labelsSchema,
  commentsSchema,
  roomStatsSchema,
]
