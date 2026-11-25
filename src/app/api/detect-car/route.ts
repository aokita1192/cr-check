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
  year_match: boolean | null
  mileage_match: boolean | null
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
  const headerIdx = rows.findIndex(r =>
    r.some(c => c.replace(/\n/g, '').trim() === 'メーカー') &&
    r.some(c => c.replace(/\n/g, '').trim() === '車種')
  )
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
      const allFulls = Object.values(keyMap)
      for (const [k, full] of Object.entries(keyMap)) {
        // 完全一致を優先。なければ部分一致だが、より長い別キーにも一致する列は除外
        let idx = headers.findIndex(h => h === full)
        if (idx < 0) {
          idx = headers.findIndex(h =>
            h.includes(full) &&
            !allFulls.some(o => o !== full && o.length > full.length && o.includes(full) && h.includes(o))
          )
        }
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
  // 売却価格・下取り額がどちらも空の行はプレースホルダーとして除外（価格照合に使えない）
  const realRows = rows.filter(r => r['売却価格'] || r['下取り額'])
  if (!realRows.length) return '（実データなし）'
  const body = realRows.slice(0, 300).map(r =>
    BASIC_KEYS.map(k => {
      const v = r[k] ?? ''
      const digits = v.replace(/,/g, '')
      if ((k === '売却価格' || k === '下取り額' || k === '差額') && /^\d+$/.test(digits))
        return `${Math.round(Number(digits) / 10000)}万円`
      if (k === '走行距離' && /^\d+$/.test(digits))
        return `${Number(digits).toLocaleString()}km`
      return v
    }).join('\t')
  ).join('\n')
  return `${header}\n${body}`
}

function bidToText(rows: BidRow[]): string {
  if (!rows.length) return '（データなし）'
  const lines = rows.slice(0, 400).map(r =>
    [r.no, r.date, r.maker, r.model, r.year,
     `${Number(r.mileage.replace(/,/g, '')).toLocaleString()}km`,
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


// ── 照合結果のサーバー側検証（LLMの行番号取り違え対策） ──
const normText = (v: string | null | undefined) =>
  (v ?? '').normalize('NFKC').replace(/[\s\u3000]/g, '').toLowerCase()
const toNum = (v: string | null | undefined) => parseInt((v ?? '').replace(/[^\d]/g, ''), 10) || 0
const toMan = (v: string | null | undefined) => {
  const n = toNum(v)
  if (!n) return 0
  return n >= 100000 ? Math.round(n / 10000) : n   // 円表記 / 万円表記 どちらも万円へ
}
function modelMatches(a: string | null | undefined, b: string | null | undefined) {
  const x = normText(a), y = normText(b)
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x))
}

function verifyBasicMatch(p: DetectResult, basicRows: SheetRow[]): DetectResult {
  if (!p.vehicle_match || !p.model) return p
  const byNo = new Map(basicRows.map(r => [r['ナンバー']?.trim(), r]))
  const cur = p.matched_row ? byNo.get(p.matched_row.trim()) : undefined
  // A-xxx 以外（B-/旧）はここでは検証対象外
  if (p.matched_row && !p.matched_row.trim().startsWith('A-')) return p

  const fy = toNum(p.year), fm = toNum(p.mileage)
  const fSell = toMan(p.frame_price), fTrade = toMan(p.frame_trade)
  const sameModel = (r: SheetRow) => modelMatches(r['車種'], p.model) && (!p.maker || modelMatches(r['メーカー'], p.maker))

  let row = cur && sameModel(cur) ? cur : undefined
  const corrected: string[] = []
  if (!row) {
    if (p.matched_row) corrected.push(`AI判定の${p.matched_row}は車種が不一致（${cur ? `${cur['メーカー']} ${cur['車種']}` : '該当行なし'}）のためサーバー側で再照合`)
    const cands = basicRows.filter(sameModel)
    const score = (r: SheetRow) => {
      let sc = 0
      if (fy && toNum(r['年式']) === fy) sc += 4
      if (fm && toNum(r['走行距離']) === fm) sc += 4
      if (fSell && toMan(r['売却価格']) === fSell) sc += 2
      if (fTrade && toMan(r['下取り額']) === fTrade) sc += 2
      return sc
    }
    const best = [...cands].sort((a, b) => score(b) - score(a))[0]
    if (best) {
      const yOk = !fy || Math.abs(toNum(best['年式']) - fy) <= 2
      const mOk = !fm || Math.abs(toNum(best['走行距離']) - fm) <= Math.max(30000, fm * 0.3)
      if (yOk && mOk) row = best
    }
    if (!row) {
      return { ...p, matched_row: null, vehicle_match: false, price_match: null,
        reason: `${corrected.join('／')}${corrected.length ? '／' : ''}基本シートに該当する車種・年式・走行距離の行なし` }
    }
  } else if (fy || fm) {
    // 車種は合っているが同一車種に複数行ある場合、年式・走行距離・価格が最も近い行を優先
    const exact = (r: SheetRow) =>
      (!fy || toNum(r['年式']) === fy) && (!fm || toNum(r['走行距離']) === fm)
    if (!exact(row)) {
      const alt = basicRows.filter(r => sameModel(r) && exact(r))
      const pick = alt.find(r => (!fSell || toMan(r['売却価格']) === fSell) && (!fTrade || toMan(r['下取り額']) === fTrade)) ?? alt[0]
      if (pick) { corrected.push(`${row['ナンバー']}→${pick['ナンバー']}に補正`); row = pick }
    }
  }

  // シートの実値で上書き（LLMの書き写しを信用しない）
  const sheetSell = toMan(row['売却価格']), sheetTrade = toMan(row['下取り額'])
  const sellOk = !fSell || fSell === sheetSell
  const tradeOk = !fTrade || fTrade === sheetTrade
  const yearOk = !fy ? null : toNum(row['年式']) === fy
  const mileOk = !fm ? null : toNum(row['走行距離']) === fm
  const diffs: string[] = []
  if (!sellOk) diffs.push(`売却価格：フレーム${fSell}万 vs シート${sheetSell}万`)
  if (!tradeOk) diffs.push(`下取り額：フレーム${fTrade}万 vs シート${sheetTrade}万`)
  return {
    ...p,
    matched_row: row['ナンバー'],
    matched_vehicle: `${row['メーカー']} ${row['車種']}`,
    year_match: yearOk,
    mileage_match: mileOk,
    sheet_price_sell: sheetSell ? `${sheetSell}万円` : null,
    sheet_price_trade: sheetTrade ? `${sheetTrade}万円` : null,
    price_match: fSell || fTrade ? sellOk && tradeOk : p.price_match,
    reason: [...corrected, diffs.length ? `不一致：${diffs.join('、')}` : p.reason].filter(Boolean).join('／'),
  }
}


// B-xxx（入札額）・旧-No.xxx の行番号検証
type LooseRow = { no: string; maker: string; model: string; year: string; mileage: string }
function verifyOtherMatch(p: DetectResult, bidRows: BidRow[], oldRows: OldRow[]): DetectResult {
  const mr = p.matched_row?.trim() ?? ''
  const isBid = mr.startsWith('B-'), isOld = mr.startsWith('旧-')
  if (!p.vehicle_match || !p.model || (!isBid && !isOld)) return p
  const rows: LooseRow[] = isBid ? bidRows : oldRows
  const keyOf = (r: LooseRow) => (isBid ? r.no : `旧-No.${r.no}`)
  const norm = (k: string) => k.replace(/^旧-(No\.?)?/, '')
  const sameModel = (r: LooseRow) => modelMatches(r.model, p.model) && (!p.maker || modelMatches(r.maker, p.maker))
  const cur = rows.find(r => isBid ? r.no.trim() === mr : r.no.trim() === norm(mr))
  const fy = toNum(p.year), fm = toNum(p.mileage)
  // 旧シートの走行距離は「5万km未満」等のテキストなので距離は照合しない
  const useMile = isBid && fm > 0
  const yOk = (r: LooseRow) => !fy || toNum(r.year) === fy
  const mOk = (r: LooseRow) => !useMile || toNum(r.mileage) === fm
  let row = cur && sameModel(cur) ? cur : undefined
  const notes: string[] = []
  if (!row) {
    if (mr) notes.push(`AI判定の${mr}は車種が不一致（${cur ? `${cur.maker} ${cur.model}` : '該当行なし'}）のためサーバー側で再照合`)
    const cands = rows.filter(sameModel)
    const best = cands.find(r => yOk(r) && mOk(r))
      ?? cands.find(r => (!fy || Math.abs(toNum(r.year) - fy) <= 2) && (!useMile || Math.abs(toNum(r.mileage) - fm) <= Math.max(30000, fm * 0.3)))
    if (!best) {
      return { ...p, matched_row: null, vehicle_match: false, price_match: null,
        reason: `${notes.join('／')}${notes.length ? '／' : ''}該当する車種・年式の行なし` }
    }
    row = best
  } else if (!(yOk(row) && mOk(row))) {
    const alt = rows.find(r => sameModel(r) && yOk(r) && mOk(r))
    if (alt) { notes.push(`${keyOf(row)}→${keyOf(alt)}に補正`); row = alt }
  }
  const out: DetectResult = {
    ...p, matched_row: keyOf(row), matched_vehicle: `${row.maker} ${row.model}`,
    year_match: fy ? toNum(row.year) === fy : null,
    mileage_match: useMile ? toNum(row.mileage) === fm : p.mileage_match,
  }
  if (isBid) {
    const br = row as BidRow
    const calc = Math.round(br.calcDiff / 10000)
    const claim = toMan(p.frame_diff_claim)
    out.calculated_diff = calc ? `${calc}万円` : null
    out.price_match = claim ? claim === calc : null
    if (claim && claim !== calc) notes.push(`主張差額：フレーム${claim}万 vs シート${calc}万`)
  }
  if (notes.length) out.reason = notes.join('／')
  return out
}

// ── GET（デバッグ用：ヘッダー確認） ─────────────────────
export async function GET() {
  if (!GOOGLE_API_KEY) return NextResponse.json({ error: 'no key' }, { status: 500 })
  const meta = await fetchSheetMeta()
  const name = meta[BASIC_SHEET_GID] ?? '【査定実績】基本'
  const rows = await fetchValues(name)
  const headerIdx = rows.findIndex(r =>
    r.some(c => c.replace(/\n/g, '').trim() === 'メーカー') &&
    r.some(c => c.replace(/\n/g, '').trim() === '車種')
  )
  const headers = headerIdx >= 0 ? rows[headerIdx].map(h => h.replace(/\n/g, '').trim()) : []
  const rawRows = rows.slice(headerIdx + 1, headerIdx + 4)
  return NextResponse.json({ sheetName: name, headerIdx, headers, rawRows })
}

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
      max_tokens: 4096,
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
              '# ステップ1：フレームから情報を抽出',
              'フレームに映るすべての車について個別に処理（1台でも配列で返す）。',
              'フレームに表示されているすべての情報を抽出する：',
              '- 車両情報：メーカー・車種・年式・走行距離',
              '- 価格情報（表示があるもののみ）：売却額・下取り額・差額・主張差額（〇万高く等）',
              '- 査定年月（表示がある場合）',
              '例）「スズキ スペーシア 22万UP! 210万円→232万円 2024年式 走行1万km」',
              '  → 差額=22万、下取り額=210万、売却額=232万、1万km=10,000km',
              '例）「ホンダ N-BOX 2013年式 走行120,000km 査定月:2026/01 下取り10万円だったのが」',
              '  → 下取り額=10万、査定年月=2026/01',
              '例）「日産 セレナ 2020年式 走行50000km 査定月:2024年9月 140万高く売れたり」',
              '  → 主張差額=140万、査定年月=2024/09',
              '',
              '# ステップ2：シートを順番に照合（見つかった時点で終了）',
              '',
              '## 照合の優先順位',
              '**必ず以下の順で探す。前のシートで見つかれば後のシートは参照しない。**',
              '',
              '### 1. 【査定実績】基本シート（A-xxx形式）を最初に照合',
              '照合ルール（段階的に緩和）：',
              '【完全一致】メーカー・車種・年式・走行距離がすべて完全一致する行を最優先で探す',
              '【近似一致】完全一致がない場合は、メーカー・車種が一致し、かつ以下を満たす最も近い行を採用：',
              '  - 年式：±2年以内',
              '  - 走行距離：±30,000km以内（またはフレームの走行距離の±30%以内の大きい方）',
              '  - 近似一致の場合は confidence=低 とし、reasonに「近似一致（年式/走行距離の差異あり）」を記載',
              '→ 一致する車両が見つかれば matched_row=A-xxx とし、ステップ2終了。',
              '',
              '### 2. 【査定実績】各社入札額シート（B-xxx形式）を照合',
              '（基本シートで見つからなかった場合のみ）',
              '照合ルール（段階的に緩和）：',
              '【完全一致】メーカー・車種・年式・走行距離がすべて完全一致する行を最優先で探す（査定年月でも絞り込む）',
              '【近似一致】完全一致がない場合は、メーカー・車種が一致し、かつ以下を満たす最も近い行を採用：',
              '  - 年式：±2年以内',
              '  - 走行距離：±30,000km以内（またはフレームの走行距離の±30%以内の大きい方）',
              '  - 近似一致の場合は confidence=低 とし、reasonに「近似一致（年式/走行距離の差異あり）」を記載',
              '→ 一致する車両が見つかれば matched_row=B-xxx とし、ステップ2終了。',
              '',
              '### 3. 旧レギュレーション【査定事例】シート（No.数字形式）を照合',
              '（基本・入札額シートいずれでも見つからなかった場合のみ）',
              '→ 一致する車両が見つかれば matched_row=「旧-No.番号」とする。',
              '',
              '### 4. すべてのシートで見つからない場合',
              'vehicle_match=false、reasonに「全シートに該当データなし」と記載',
              '',
              '## 価格照合（vehicle_match=trueの場合のみ）',
              'matched_rowがA-xxx（基本シート）の場合：',
              '- フレームに売却価格・下取り額・差額が表示されていれば、シートの値と照合',
              '- すべて一致 → price_match=true',
              '- 不一致があればreasonに「項目名不一致：フレーム〇万 vs シート△万」を記載',
              'matched_rowがB-xxx（入札額シート）の場合：',
              '- フレームに主張差額（〇万高く等）が表示されていればシートのcalcDiffと照合 → price_match=true/false',
              '- 主張差額がnullの場合 → price_match=null',
              '- frame_diff_claimに主張差額（nullも可）、calculated_diffにシートの計算済み差額を記載',
              '',
              '# 【査定実績】基本シート（A-xxx）',
              basicToText(basicRows),
              '',
              '# 【査定実績】各社入札額シート（B-xxx）',
              bidToText(bidRows),
              '',
              '# 旧レギュレーション【査定事例】シート',
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
              '  "year_match":true/false/null（年式が一致すればtrue、不一致ならfalse、表示なし・照合不可はnull）,',
              '  "mileage_match":true/false/null（走行距離が一致すればtrue、不一致ならfalse、表示なし・照合不可はnull）,',
              '  "confidence":"高/中/低",',
              '  "frame_price":"売却額（万円表記）またはnull",',
              '  "frame_trade":"下取り額（万円表記）またはnull",',
              '  "frame_diff":"差額〇万UP等またはnull",',
              '  "sheet_price_sell":"基本シートの売却価格またはnull",',
              '  "sheet_price_trade":"基本シートの下取り額またはnull",',
              '  "frame_diff_claim":"主張差額（例:140万）またはnull",',
              '  "calculated_diff":"入札額シートの計算済み差額またはnull",',
              '  "price_match":true/false/null,',
              '  "matched_row":"A-xxxまたはB-xxxまたは旧-No.番号またはnull",',
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

    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/)
    let parsed: DetectResult[] | null = null
    if (jsonMatch) {
      try {
        const val = JSON.parse(jsonMatch[0])
        parsed = (Array.isArray(val) ? val : [val]).map((x: DetectResult) => verifyOtherMatch(verifyBasicMatch(x, basicRows), bidRows, oldRows))
      } catch { /* ignore */ }
    }

    const cost = estimateCost(response.usage.input_tokens, response.usage.output_tokens)
    logUsage({
      user_email: userEmail, action: 'ai_detect', project_id: projectId ?? null,
      metadata: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens, basic_rows: basicRows.length, bid_rows: bidRows.length, old_rows: oldRows.length },
      cost_usd: cost,
    })

    return NextResponse.json({ parsed, raw, basicRows: basicRows.length, bidRows: bidRows.length, basicSample: basicRows.slice(0, 3) })
  } catch (err) {
    console.error('Detect car error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'AI車種判定に失敗しました' }, { status: 500 })
  }
}
