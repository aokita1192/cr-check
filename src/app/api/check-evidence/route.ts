import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { verifyToken } from '@/lib/auth-token'
import { logUsage } from '@/lib/log-usage'

const anthropic = new Anthropic()
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY ?? ''
const SHEETS_ID = process.env.PRICE_SHEET_ID ?? '1fEFmeeEVk2jeL3Z3MnZZ82ixaPVSDSXaTP60LDakZjY'
const EVIDENCE_SHEET_GID = '541691112'

let cachedEvidenceData: EvidenceRow[] | null = null
let evidenceCacheExpiry = 0

type EvidenceRow = {
  no: string
  claim: string
  category: string
  expiry: string
}

export type EvidenceCheckResult = {
  claim_in_frame: string
  claim_type: 'evidence' | 'jisseki'  // evidence=エビデンスリスト照合, jisseki=査定実績照合
  evidence_no: string | null
  evidence_category: string | null
  expiry_date: string | null
  is_expired: boolean
  status: '合格' | '不合格' | '対象外' | '査定実績で確認'
  reason: string
}

async function fetchEvidenceData(): Promise<EvidenceRow[]> {
  if (cachedEvidenceData && Date.now() < evidenceCacheExpiry) return cachedEvidenceData

  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEETS_ID}?key=${GOOGLE_API_KEY}&fields=sheets.properties`
  )
  if (!metaRes.ok) return []
  const meta = await metaRes.json()
  const sheet = (meta.sheets ?? []).find(
    (s: { properties: { sheetId: number } }) => String(s.properties.sheetId) === EVIDENCE_SHEET_GID
  )
  const sheetName: string = sheet?.properties?.title ?? '②エビデンスリスト'

  const dataRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEETS_ID}/values/${encodeURIComponent(sheetName)}?key=${GOOGLE_API_KEY}`
  )
  if (!dataRes.ok) return []

  const json = await dataRes.json()
  const rows: string[][] = json.values ?? []

  // ヘッダー行検出（「No」または「訴求したい内容」を含む行）
  const headerIdx = rows.findIndex(row =>
    row.some(c => c.includes('No') || c.includes('訴求したい内容'))
  )
  if (headerIdx < 0) return []

  const result: EvidenceRow[] = rows
    .slice(headerIdx + 1)
    .filter(row => row[1]?.match(/^E\d+/))
    .map(row => ({
      no: row[1] ?? '',
      claim: row[2] ?? '',
      category: (row[3] ?? '').replace(/\n[\s\S]*/g, '').trim(),
      expiry: (row[7] ?? '').replace(/\n[\s\S]*/g, '').trim(),
    }))

  cachedEvidenceData = result
  evidenceCacheExpiry = Date.now() + 10 * 60 * 1000
  return result
}

function evidenceToText(rows: EvidenceRow[]): string {
  if (rows.length === 0) return '（エビデンスデータなし）'
  return rows.map(r => `${r.no}\t${r.claim}\t区分${r.category}\t使用期限:${r.expiry}`).join('\n')
}

function extractBase64(dataUrl: string) {
  return {
    data: dataUrl.replace(/^data:[^;]+;base64,/, ''),
    mediaType: (dataUrl.match(/^data:([^;]+);/) ?? [])[1] ?? 'image/jpeg',
  }
}

function estimateCost(input: number, output: number): number {
  return (input / 1_000_000) * 3.0 + (output / 1_000_000) * 15.0
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get('auth_token')?.value
  const authPayload = token ? await verifyToken(token) : null
  const userEmail = authPayload?.email ?? 'unknown'

  try {
    if (!GOOGLE_API_KEY) {
      return NextResponse.json({ error: 'GOOGLE_API_KEY が未設定です' }, { status: 500 })
    }

    const { frameBase64, projectId } = await request.json()
    if (!frameBase64) {
      return NextResponse.json({ error: '動画フレームが不足しています' }, { status: 400 })
    }

    const evidenceRows = await fetchEvidenceData().catch(() => [] as EvidenceRow[])
    const frame = extractBase64(frameBase64)
    const today = new Date().toISOString().slice(0, 7) // YYYY-MM

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: frame.mediaType as Anthropic.Base64ImageSource['media_type'],
                data: frame.data,
              },
            },
            {
              type: 'text',
              text: [
                '動画フレームに表示されているテキスト・訴求内容を読み取り、以下のJSON配列のみを返せ（説明文・コードブロック不要）。',
                '',
                '# ステップ1：フレームから訴求内容を分類して抽出',
                'フレームの訴求内容を以下の2種類に分類する。',
                '',
                '【査定実績訴求（claim_type=jisseki）】',
                '特定の車の実際の売却・査定結果を根拠にした訴求。以下のような表現が該当する：',
                '- 「〇万高く売れたり」「〇万UP」「下取りより〇万円高く」',
                '- 「〇万円で売却」「下取り額〇万円 → 売却額△万円」',
                '- 実際の車種・価格・走行距離を示した査定実績の比較',
                '→ これらは査定実績シートで別途確認するため claim_type=jisseki とし、status=査定実績で確認 とする',
                '',
                '【エビデンスリスト訴求（claim_type=evidence）】',
                '市場全体・経済統計・制度等の一般的な主張。以下のような表現が該当する：',
                '- 「円安で中古車価格が高騰」「半導体不足で値上がり」',
                '- 「中古車相場が2倍に」「維持費は年〇万円」「輸出需要が増加」',
                '→ これらをエビデンスリストと照合する',
                '',
                '# ステップ2：エビデンスリスト訴求のみ照合',
                '以下のエビデンスリストから、claim_type=evidence の訴求に対応するエントリーを探せ。',
                '- 主旨が同じであれば一致とみなす',
                '- 一致するエントリーが見つからない場合は evidence_no=null、status=対象外',
                '',
                `# 今日の日付: ${new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' })}`,
                '# 使用期限チェック（claim_type=evidenceのみ）:',
                '- 使用期限が今日以降 → is_expired=false → status=合格',
                '- 使用期限が今日より前 → is_expired=true → status=不合格',
                '',
                '# エビデンスリスト（No・訴求内容・区分・使用期限）',
                evidenceToText(evidenceRows),
                '',
                '# 区分の意味',
                'A：根拠＋注釈が必要　B：根拠のみ必要　C：根拠・注釈不要',
                '',
                '- フレームに訴求内容が映っていない場合は空配列を返す',
                '',
                '# 出力JSON配列',
                '[{"claim_in_frame":"フレームの訴求内容","claim_type":"jisseki または evidence","evidence_no":"E01またはnull","evidence_category":"AまたはBまたはCまたはnull","expiry_date":"使用期限またはnull","is_expired":true/false,"status":"合格/不合格/対象外/査定実績で確認","reason":"判定理由1文"}]',
              ].join('\n'),
            },
          ],
        },
      ],
    })

    const raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text).join('').trim()

    const jsonMatch = raw.match(/\[[\s\S]*\]/)
    let parsed: EvidenceCheckResult[] | null = null
    if (jsonMatch) {
      try {
        const val = JSON.parse(jsonMatch[0])
        parsed = Array.isArray(val) ? val : [val]
      } catch { /* 無視 */ }
    }

    const cost = estimateCost(response.usage.input_tokens, response.usage.output_tokens)
    logUsage({
      user_email: userEmail,
      action: 'ai_evidence_check',
      project_id: projectId ?? null,
      metadata: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        evidence_rows: evidenceRows.length,
      },
      cost_usd: cost,
    })

    return NextResponse.json({ parsed, raw })
  } catch (err) {
    console.error('Check evidence error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'エビデンス確認に失敗しました' },
      { status: 500 }
    )
  }
}
