/**
 * Thin client for `/api/actions/<name>`. The SDK has hooks for record reads
 * (useQuery) but none for server actions, so this attaches the user's JWT.
 */

import { getAuthToken } from 'deepspace'

export interface ActionReply<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export async function callAction<T = unknown>(
  name: string,
  params: Record<string, unknown> = {},
): Promise<ActionReply<T>> {
  let token: string | null = null
  try {
    token = await getAuthToken()
  } catch {
    token = null
  }
  if (!token) return { success: false, error: 'Please sign in first' }
  try {
    const res = await fetch(`/api/actions/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    })
    const body = (await res.json().catch(() => ({}))) as ActionReply<T>
    if (!res.ok) return { success: false, error: body.error ?? `Request failed (${res.status})` }
    return body
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}
