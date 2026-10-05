import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { verifyToken } from '@/lib/auth-token'
import { logUsage } from '@/lib/log-usage'

const anthropic = new Anthropic()

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY ?? ''
const SHEETS_ID = process.env.PRICE_SHEET_ID ?? '1fEFmeeEVk2jeL3Z3MnZZ82ixaPVSDSXaTP60LDakZjY'
const BASIC_SHEET_GID  = process.env.PRICE_SHEET_GID ?? '1274815939'
const BID_SHEET_GID    = '1915590926'
const OLD_SHEETS_ID    = '1LqLCjKd8UgQgXNVn-DDfAIEeHVwJTUbmDY7OkZVojcs'

const BASIC_KEYS = ['ナンバー', 'メーカー', '車種', '年式', '走行距離', '売却価格', '下取り額', '差額']

type SheetRow = Record<string, string>

// ── キャッシュ ──────────────────────────────────────────
let cachedBasic: SheetRow[] | null = null; let basicExpiry = 0
let cachedBid:   BidRow[]   | null = null; let bidExpiry   = 0
let cachedOld:   OldRow[]   | null = null; let oldExpiry   = 0

type BidRow = {
  no: string          // B-xxx
  date: string        // 2025/07
  maker: string
  model: string
  year: string
  mileage: string     // 50000
  minDiff: number     // 最低入札価格の差額（円）
  top1: number        // 入札額(下限)1社目（円）
  calcDiff: number    // top1 - minDiff（"X万高く"の実値）
}

type OldRow = {
  no: string
  date: string
  maker: string
  model: string
  year: string
  mileage: string
  sellPrice: string
  tradePrice: string
  diff: string
}

export type DetectResult = {
  detected_text: string
  maker: string | null
  model: string | null
  year: string | null
  mileage: string | null
  assessment_date: string | null
  matched_vehicle: string | null
  vehicle_match: boolean
  confidence: '高' | '中' | '低'
  // 基本シート用（売却額・下取り額）
  frame_price: string | null
  frame_trade: string | null
  frame_diff: string | null
  sheet_price_sell: string | null
  sheet_price_trade: string | null
  // 入札額シート用（X万高く）
  frame_diff_claim: string | null
  calculated_diff: string | null
  price_match: boolean | null
  matched_row: string | null
  reason: string
}

// ── 基本シート取得 ──────────────────────────────────────
async function fetchBasicSheet(): Promise<SheetRow[]> {
  if (cachedBasic && Date.now() < basicExpiry) return cachedBasic
  const meta = await fetchSheetMeta()
  const name = meta[BASIC_SHEET_GID] ?? '【査定実績】基本'
  const rows = await fetchValues(name)
  const headerIdx = rows.findIndex(r => r.some(c => c.includes('メーカー') || c.includes('車種')))
  if (headerIdx < 0) return []
  const headers = rows[headerIdx].map(h => h.replace(/\n/g, '').trim())
  const keyMap: Record<string, string> = {
    'ナンバー': '査定実績ナンバー', 'メーカー': 'メーカー', '車種': '車種',
    '年式': '年式', '走行距離': '走行距離', '売却価格': '売却価格',
    '下取り額': '下取り額', '差額': '下取り額との差額',
  }
  const result = rows.slice(headerIdx + 1)
    .filter(r => r.length > 0 && (r[0]?.startsWith('A-') || r[1]?.startsWith('A-')))
    .map(r => {
      const obj: SheetRow = {}
      for (const [k, full] of Object.entries(keyMap)) {
        const idx = headers.findIndex(h => h.includes(full))
        obj[k] = idx >= 0 ? (r[idx] ?? '') : ''
      }
      return obj
    })
  cachedBasic = result; basicExpiry = Date.now() + 10 * 60 * 1000
  return result
}

// ── 入札額シート取得 ────────────────────────────────────
async function fetchBidSheet(): Promise<BidRow[]> {
  if (cachedBid && Date.now() < bidExpiry) return cachedBid
  const meta = await fetchSheetMeta()
  const name = meta[BID_SHEET_GID] ?? '【査定実績】各社入札額'
  const rows = await fetchValues(name)
  const headerIdx = rows.findIndex(r => r.some(c => c.includes('査定実績') && c.includes('ナンバー')))
  if (headerIdx < 0) return []
  const result: BidRow[] = rows.slice(headerIdx + 1)
    .filter(r => r.length > 1 && (r[0]?.startsWith('B-') || r[1]?.startsWith('B-')))
    .map(r => {
      const offset = r[0]?.startsWith('B-') ? 0 : 1
      const top1   = parseInt(r[offset + 10] ?? '0', 10) || 0
      const minDiff= parseInt(r[offset + 9]  ?? '0', 10) || 0
      return {
        no:       r[offset]     ?? '',
        date:     r[offset + 2] ?? '',
        maker:    r[offset + 3] ?? '',
        model:    r[offset + 4] ?? '',
        year:     r[offset + 6] ?? '',
        mileage:  r[offset + 7] ?? '',
        minDiff,
        top1,
        calcDiff: top1 - minDiff,
      }
    })
  cachedBid = result; bidExpiry = Date.now() + 10 * 60 * 1000
  return result
}

// ── 旧レギュレーションシート取得 ────────────────────────
function parseYen(v: string): number { return parseInt(v.replace(/[¥,]/g, ''), 10) || 0 }
function yenToMan(yen: number): string { return yen > 0 ? `${Math.round(yen / 10000)}万円` : '' }

async function fetchOldSheet(): Promise<OldRow[]> {
  if (cachedOld && Date.now() < oldExpiry) return cachedOld
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${OLD_SHEETS_ID}/values/${encodeURIComponent('査定事例')}?key=${GOOGLE_API_KEY}`
  )
  if (!res.ok) return []
  const rows: string[][] = (await res.json()).values ?? []
  const headerIdx = rows.findIndex(r => r.some(c => c === 'メーカー') && r.some(c => c === '年式'))
  if (headerIdx < 0) return []
  const result: OldRow[] = rows.slice(headerIdx + 1)
    .filter(r => r[1]?.trim() && /^\d+$/.test(r[1].trim()))
    .map(r => ({
      no: r[1] ?? '',
      date: r[3] ?? '',
      maker: r[5] ?? '',
      model: r[6] ?? '',
      year: r[8] ?? '',
      mileage: r[10] ?? '',
      sellPrice: yenToMan(parseYen(r[11] ?? '')),
      tradePrice: yenToMan(parseYen(r[13] ?? '')),
      diff: yenToMan(parseYen(r[14] ?? '')),
    }))
  cachedOld = result; oldExpiry = Date.now() + 10 * 60 * 1000
  return result
}

function oldToText(rows: OldRow[]): string {
  if (!rows.length) return '（データなし）'
  const lines = rows.slice(0, 200).map(r =>
    [r.no, r.date, r.maker, r.model, r.year, r.mileage, r.sellPrice, r.tradePrice, r.diff].join('\t')
  )
  return `No.\t査定依頼日\tメーカー\t車種\t年式\t走行距離\t売却額\t下取り額\t差額\n${lines.join('\n')}`
}

// ── 共通ユーティリティ ──────────────────────────────────
let cachedMeta: Record<string, string> | null = null; let metaExpiry = 0
async function fetchSheetMeta(): Promise<Record<string, string>> {
  if (cachedMeta && Date.now() < metaExpiry) return cachedMeta
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEETS_ID}?key=${GOOGLE_API_KEY}&fields=sheets.properties`)
  if (!res.ok) return {}
  const json = await res.json()
  const map: Record<string, string> = {}
  for (const s of json.sheets ?? []) map[String(s.properties.sheetId)] = s.properties.title
  cachedMeta = map; metaExpiry = Date.now() + 60 * 60 * 1000
  return map
}
async function fetchValues(sheetName: string): Promise<string[][]> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEETS_ID}/values/${encodeURIComponent(sheetName)}?key=${GOOGLE_API_KEY}`)
  if (!res.ok) return []
  return (await res.json()).values ?? []
}

// ── Claude 用テキスト変換 ───────────────────────────────
function basicToText(rows: SheetRow[]): string {
  if (!rows.length) return '（データなし）'
  const header = BASIC_KEYS.join('\t')
  const body = rows.slice(0, 300).map(r =>
    BASIC_KEYS.map(k => {
      const v = r[k] ?? ''
      if ((k === '売却価格' || k === '下取り額' || k === '差額') && /^\d+$/.test(v))
        return `${Math.round(Number(v) / 10000)}万円`
      if (k === '走行距離' && /^\d+$/.test(v))
        return `${Number(v).toLocaleString()}km`
      return v
    }).join('\t')
  ).join('\n')
  return `${header}\n${body}`
}

function bidToText(rows: BidRow[]): string {
  if (!rows.length) return '（データなし）'
  const lines = rows.slice(0, 400).map(r =>
    [r.no, r.date, r.maker, r.model, r.year,
     `${Number(r.mileage).toLocaleString()}km`,
     `${Math.round(r.calcDiff / 10000)}万高く`].join('\t')
  )
  return `ナンバー\t査定年月\tメーカー\t車種\t年式\t走行距離\t計算済み差額\n${lines.join('\n')}`
}

function extractBase64(dataUrl: string) {
  return {
    data: dataUrl.replace(/^data:[^;]+;base64,/, ''),
    mediaType: (dataUrl.match(/^data:([^;]+);/) ?? [])[1] ?? 'image/jpeg',
  }
}
function estimateCost(i: number, o: number) { return (i / 1e6) * 3.0 + (o / 1e6) * 15.0 }

// ── POST ────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const token = request.cookies.get('auth_token')?.value
  const authPayload = token ? await verifyToken(token) : null
  const userEmail = authPayload?.email ?? 'unknown'

  try {
    if (!GOOGLE_API_KEY) return NextResponse.json({ error: 'GOOGLE_API_KEY が未設定です' }, { status: 500 })
    const { frameBase64, projectId } = await request.json()
    if (!frameBase64) return NextResponse.json({ error: '動画フレームが不足しています' }, { status: 400 })

    const [basicRows, bidRows, oldRows] = await Promise.all([
      fetchBasicSheet().catch(() => [] as SheetRow[]),
      fetchBidSheet().catch(() => [] as BidRow[]),
      fetchOldSheet().catch(() => [] as OldRow[]),
    ])
    const frame = extractBase64(frameBase64)

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1200,
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
              '動画フレームのテキストを読み取り、以下のJSON配列のみを返せ（説明文・コードブロック不要）。',
              '',
              '# ステップ1：フレームタイプを判断し情報を抽出',
              'フレームに映るすべての車について個別に処理（1台でも配列で返す）。',
              '',
              '【タイプA：売却実績フレーム】',
              '「〇万UP!」「売却価格〇万円」「下取り額〇万円」などが書かれている',
              '抽出項目：メーカー・車種・年式・走行距離・売却額・下取り額・差額（表示されているもの）',
              '例）「スズキ スペーシア 22万UP! 210万円→232万円 2024年式 走行1万km」',
              '  → 差額=22万、下取り額=210万、売却額=232万、1万km=10,000km',
              '例）「ホンダ N-BOXカスタム 2018年式 走行20000km 下取り額：68万円」',
              '  → 下取り額=68万、売却額=表示なし',
              '',
              '【タイプB：入札差額フレーム】',
              '「〇万高く売れたり」「〇万高く買取」などの表現がある',
              '抽出項目：メーカー・車種・年式・走行距離・査定年月・主張差額（〇万高く）',
              '例）「日産 セレナ 2020年式 走行50000km 査定月:2024年9月 140万高く売れたり」',
              '  → 主張差額=140万、査定年月=2024/09',
              '',
              '# ステップ2：照合',
              '',
              '## タイプAの場合 → 新旧 両方の査定実績シートで照合',
              '1. まず【査定実績】基本シート（A-xxx形式）を照合',
              '2. 次に旧レギュレーション【査定事例】シート（No.数字形式）でも照合',
              '3. どちらかに一致があれば vehicle_match=true として採用',
              '4. matched_row：基本シートの場合A-xxx、旧シートの場合「旧-No.番号」',
              '照合ルール：フレームに表示されている項目のみ照合（表示なし項目はスキップ）',
              '- メーカー・車種・年式・走行距離が一致 → vehicle_match=true',
              '- 売却価格・下取り額・差額（表示があるもの）がすべて一致 → price_match=true',
              '- 不一致があればreasonに項目名を記載',
              '',
              '## タイプBの場合 → 【査定実績】各社入札額シートで照合',
              '照合ルール：',
              '- メーカー・車種・年式・走行距離が一致する行を探す（査定年月でも絞り込む）',
              '- シートの「計算済み差額」（入札額1社目－最低入札価格の差額）が主張差額と一致するか確認',
              '- 一致 → vehicle_match=true、price_match=true',
              '- 不一致 → price_match=false、reasonに「主張〇万 vs 実際△万」と記載',
              '- frame_diff_claimに主張差額、calculated_diffにシートの計算済み差額を記載',
              '',
              '# 【査定実績】基本シート（タイプA照合用）',
              basicToText(basicRows),
              '',
              '# 【査定実績】各社入札額シート（タイプB照合用）',
              bidToText(bidRows),
              '',
              '# 旧レギュレーション【査定事例】シート（タイプA照合・補完用）',
              '※ 走行距離は「20万km以上」「5万km未満」のようなテキスト形式',
              oldToText(oldRows),
              '',
              '# 出力JSON配列',
              '[{',
              '  "detected_text":"フレームの該当テキスト全文",',
              '  "maker":"メーカー名またはnull",',
              '  "model":"車種名のみ（メーカー除く）またはnull",',
              '  "year":"年式の数字（例:2020）またはnull",',
              '  "mileage":"走行距離（例:50,000km）またはnull",',
              '  "assessment_date":"査定年月（例:2024/09）またはnull",',
              '  "matched_vehicle":"メーカー＋車種名またはnull",',
              '  "vehicle_match":true/false,',
              '  "confidence":"高/中/低",',
              '  "frame_price":"売却額（万円表記）またはnull",',
              '  "frame_trade":"下取り額（万円表記）またはnull",',
              '  "frame_diff":"差額〇万UP等またはnull",',
              '  "sheet_price_sell":"基本シートの売却価格またはnull",',
              '  "sheet_price_trade":"基本シートの下取り額またはnull",',
              '  "frame_diff_claim":"主張差額（例:140万）またはnull【タイプBのみ】",',
              '  "calculated_diff":"シート計算済み差額（例:140万）またはnull【タイプBのみ】",',
              '  "price_match":true/false/null,',
              '  "matched_row":"A-xxxまたはB-xxxまたはnull",',
              '  "reason":"合否理由"',
              '}]',
            ].join('\n'),
          },
        ],
      }],
    })

    const raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text).join('').trim()

    const jsonMatch = raw.match(/\[[\s\S]*\]/)
    let parsed: DetectResult[] | null = null
    if (jsonMatch) {
      try {
        const val = JSON.parse(jsonMatch[0])
        parsed = Array.isArray(val) ? val : [val]
      } catch { /* ignore */ }
    }

    const cost = estimateCost(response.usage.input_tokens, response.usage.output_tokens)
    logUsage({
      user_email: userEmail, action: 'ai_detect', project_id: projectId ?? null,
      metadata: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens, basic_rows: basicRows.length, bid_rows: bidRows.length, old_rows: oldRows.length },
      cost_usd: cost,
    })

    return NextResponse.json({ parsed, raw, basicRows: basicRows.length, bidRows: bidRows.length })
  } catch (err) {
    console.error('Detect car error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'AI車種判定に失敗しました' }, { status: 500 })
  }
}
