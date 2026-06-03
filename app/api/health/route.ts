import { NextResponse } from 'next/server'

export const runtime = 'edge'

export async function GET() {
  return NextResponse.json({
    status:  'ok',
    time:    new Date().toISOString(),
    version: 'v8',
  })
}
