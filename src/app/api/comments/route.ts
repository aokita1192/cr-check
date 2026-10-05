import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { verifyToken } from '@/lib/auth-token'

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get('project_id')
  if (!projectId) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('comments')
    .select('*')
    .eq('project_id', projectId)
    .order('time_sec', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get('auth_token')?.value
  const authPayload = token ? await verifyToken(token) : null
  const author_email = authPayload?.email ?? null

  const body = await request.json()
  const { project_id, time_sec, content } = body

  if (!project_id || time_sec === undefined || !content) {
    return NextResponse.json({ error: '必須パラメータが不足しています' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('comments')
    .insert({ project_id, time_sec, content, author_email })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

export async function PATCH(request: NextRequest) {
  const { id, content } = await request.json()
  if (!id || !content) {
    return NextResponse.json({ error: '必須パラメータが不足しています' }, { status: 400 })
  }
  const { data, error } = await supabase
    .from('comments')
    .update({ content })
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const { error } = await supabase.from('comments').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return new NextResponse(null, { status: 204 })
}
