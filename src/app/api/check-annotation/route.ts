import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { verifyToken } from '@/lib/auth-token'
import { logUsage } from '@/lib/log-usage'

const anthropic = new Anthropic()

import type { AnnotationCheckResult } from '@/types/annotation'
export type { AnnotationCheckResult }

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
              '# ステップ3：文字サイズ推定',
              '以下の2値を推定する。',
              '',
              '【estimated_px】動画ネイティブ解像度での注釈文字の視覚的な高さ（px）',
              '- 縦型（1080×1920想定）: 全体高さ1920px基準',
              '- 横型黒帯（映像部分720px想定）: 黒帯を除いた映像部分高さ基準',
              '- 横型（1920×1080想定）: 全体高さ1080px基準',
              '- 文字高さ = フレーム全体高さ × 文字が占める割合',
              '',
              '【estimated_pt】動画編集ソフト（Adobe Premiere Pro / CapCut等）でのフォントサイズ（pt）推定',
              '- 日本語（ひらがな・カタカナ・漢字）: 全角文字は字面がem全体を占めるため estimated_pt ≈ estimated_px',
              '- 欧文（アルファベット・数字中心）: cap heightはem約70%のため estimated_pt ≈ estimated_px ÷ 0.7',
              '- 混在する場合は日本語基準で計算',
              '',
              '【推定方法（一貫性重視）】',
              '注釈のフォントサイズは動画全体で変わらない。シーンが変わっても同じ文字なら同じサイズになるよう、',
              '必ずフレーム全体高さに対する文字高さの「割合（%）」を先に計算し、そこから絶対値を逆算すること。',
              '目視での直接推定は禁止。割合ベースで計算した値を reported_ratio として記録すること。',
              '',
              '計算例（縦型1920px）：',
              '  文字がフレーム高さの約1.0% → estimated_px = 1920 × 0.010 = 19px',
              '  文字がフレーム高さの約0.9% → estimated_px = 1920 × 0.009 = 17px',
              '',
              '【min_pt / max_pt】合格範囲のフォントサイズ（pt）',
              '- estimated_ptと同じ計算式で、estimated_px=16/20として算出',
              '- 日本語: min_pt=16、max_pt=20',
              '- 欧文: min_pt=23（16÷0.7）、max_pt=29（20÷0.7）',
              '',
              '判定基準：16 ≤ estimated_px ≤ 20 → 合格、それ以外 → 不合格',
              '- estimated_px < 16 → 文字が小さすぎる',
              '- estimated_px > 20 → 文字が大きすぎる、またはキャプション等の誤検出の可能性',
              '',
              '# 注意事項',
              '- キャプションと注釈が混在する場合は注釈のみを判定対象とする',
              '- 複数の注釈行がある場合は最も小さい文字を基準にする',
              '- 注釈が見当たらない場合は status=検出不可、estimated_px=0、estimated_pt=0、min_pt=16、max_pt=20',
              '',
              '# 出力JSON配列',
              '[{"text_found":"検出した注釈テキスト（なければ空文字）","video_format":"縦型または横型黒帯または横型","estimated_px":推定文字高さ整数,"estimated_pt":推定フォントサイズ整数,"min_pt":合格下限フォントサイズ整数,"max_pt":合格上限フォントサイズ整数,"status":"合格または不合格または検出不可","reason":"判定理由1文（割合%とpx値と合格範囲を含める）"}]',
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
