import { NextResponse } from 'next/server'

export async function POST(request) {
  const { email, password } = await request.json()

  const validEmail = process.env.ADMIN_EMAIL
  const validPassword = process.env.ADMIN_PASSWORD

  if (email === validEmail && password === validPassword) {
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ success: false, error: 'Invalid credentials' }, { status: 401 })
}
