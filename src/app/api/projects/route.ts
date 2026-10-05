import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  const { video_url } = await request.json()

  if (!video_url) {
    return NextResponse.json({ error: 'video_url is required' }, { status: 400 })
  }

  const projectId = crypto.randomUUID()

  const { error } = await supabase
    .from('projects')
    .insert({ id: projectId, video_url })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ projectId }, { status: 201 })
}
