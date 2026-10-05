import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { verifyToken } from '@/lib/auth-token'
import { logUsage } from '@/lib/log-usage'

const anthropic = new Anthropic()

export type AnnotationCheckResult = {
  text_found: string
  video_format: '縦型' | '横型黒帯' | '横型'
  estimated_px: number
  status: '合格' | '不合格' | '検出不可'
  reason: string
}

function extractBase64(dataUrl: string) {
  return {
    data: dataUrl.replace(/^data:[^;]+;base64,/, ''),
    mediaType: (dataUrl.match(/^data:([^;]+);/) ?? [])[1] ?? 'image/jpeg',
  }
}

function estimateCost(i: number, o: number) { return (i / 1e6) * 3.0 + (o / 1e6) * 15.0 }

export async function POST(request: NextRequest) {
  const token = request.cookies.get('auth_token')?.value
  const authPayload = token ? await verifyToken(token) : null
  const userEmail = authPayload?.email ?? 'unknown'

  try {
    const { frameBase64, projectId } = await request.json()
    if (!frameBase64) {
      return NextResponse.json({ error: '動画フレームが不足しています' }, { status: 400 })
    }

    const frame = extractBase64(frameBase64)

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: frame.mediaType as Anthropic.Base64ImageSource['media_type'], data: frame.data },
          },
          {
            type: 'text',
            text: [
              '動画フレーム内の注釈テキスト（免責事項・出典・注意書きなど）を検出し、文字サイズを判定せよ。以下のJSON配列のみを返せ（説明文・コードブロック不要）。',
              '',
              '# ステップ1：動画フォーマット判定',
              '- 縦型：縦長フレーム（縦>横、または黒帯が左右にある）',
              '- 横型黒帯：横長フレームで上下に黒帯（レターボックス）がある',
              '- 横型：黒帯なしの横長フレーム',
              '',
              '# ステップ2：注釈テキストの特定',
              '注釈テキスト（チェック対象）：',
              '- 「※個人の感想です」「査定額は一例です」「〇〇調べ」「〇年〇月時点」など',
              '- 画面上部または下部に小さく配置された免責事項・出典・注意書き',
              '',
              'チェック対象外：',
              '- メインキャプション（話者の発言テキスト：通常画面中央〜下部に大きく配置）',
              '- 車種名・価格・年式などのメイン情報テキスト',
              '- タイトルテキスト',
              '',
              '# ステップ3：文字サイズ推定（動画ネイティブ解像度ベース）',
              '判定基準：注釈文字高さ40px以上 → 合格、40px未満 → 不合格',
              '',
              '縦型（動画縦解像度≒1920px想定）の目安：',
              '- 合格：フレーム全体高さの約2.1%以上',
              '- 不合格：約2.1%未満',
              '',
              '横型黒帯（映像部分の縦解像度≒720px想定）の目安：',
              '- 合格：映像部分（黒帯除く）高さの約5.6%以上',
              '- 不合格：約5.6%未満',
              '',
              '横型（縦解像度≒1080px想定）の目安：',
              '- 合格：フレーム全体高さの約3.7%以上',
              '- 不合格：約3.7%未満',
              '',
              '# 注意事項',
              '- キャプションと注釈が混在する場合は注釈のみを判定対象とする',
              '- 複数の注釈行がある場合は最も小さい文字を基準にする',
              '- 注釈が見当たらない場合は status=検出不可、estimated_px=0',
              '',
              '# 出力JSON配列',
              '[{"text_found":"検出した注釈テキスト（なければ空文字）","video_format":"縦型または横型黒帯または横型","estimated_px":推定文字高さ整数,"status":"合格または不合格または検出不可","reason":"判定理由1文"}]',
            ].join('\n'),
          },
        ],
      }],
    })

    const raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text).join('').trim()

    const jsonMatch = raw.match(/\[[\s\S]*\]/)
    let parsed: AnnotationCheckResult[] | null = null
    if (jsonMatch) {
      try {
        const val = JSON.parse(jsonMatch[0])
        parsed = Array.isArray(val) ? val : [val]
      } catch { /* ignore */ }
    }

    const cost = estimateCost(response.usage.input_tokens, response.usage.output_tokens)
    logUsage({
      user_email: userEmail, action: 'ai_annotation_check', project_id: projectId ?? null,
      metadata: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
      cost_usd: cost,
    })

    return NextResponse.json({ parsed, raw })
  } catch (err) {
    console.error('Check annotation error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : '注釈サイズ判定に失敗しました' }, { status: 500 })
  }
}
