import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from './authOptions'

export async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session || !session.isDirector) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }
  return { ok: true, session }
}
