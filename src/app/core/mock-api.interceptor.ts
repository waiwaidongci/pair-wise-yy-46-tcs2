import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http'
import { delay, of, throwError } from 'rxjs'
import { seedClaims } from './seed'
import { detectCandidates, executeMerge, rollbackMerge, buildPreview, type MergeCandidate, type MergeRecord } from './merge'
import type { ClaimCase } from './models'

const CLAIMS_KEY = 'property-claims-v1'
const MERGE_KEY = 'property-merge-v1'

function loadClaims(): ClaimCase[] {
  try {
    const raw = localStorage.getItem(CLAIMS_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* ignore */
  }
  return structuredClone(seedClaims)
}

function saveClaims(data: ClaimCase[]) {
  try {
    localStorage.setItem(CLAIMS_KEY, JSON.stringify(data))
  } catch {
    /* ignore */
  }
}

function loadMergeState(): { candidates: MergeCandidate[]; records: MergeRecord[] } {
  try {
    const raw = localStorage.getItem(MERGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* ignore */
  }
  return { candidates: [], records: [] }
}

function saveMergeState(data: { candidates: MergeCandidate[]; records: MergeRecord[] }) {
  try {
    localStorage.setItem(MERGE_KEY, JSON.stringify(data))
  } catch {
    /* ignore */
  }
}

let claims: ClaimCase[] = loadClaims()
const mergeState = loadMergeState()

/** 每次取状态时候选按当前案件重算，并保留已忽略/已合并状态。 */
function currentCandidates(): MergeCandidate[] {
  const detected = detectCandidates(claims)
  const persisted = new Map(mergeState.candidates.map((candidate) => [candidate.id, candidate]))
  return detected.map((candidate) => {
    const prev = persisted.get(candidate.id)
    return prev ? { ...candidate, status: prev.status } : candidate
  })
}

function persist() {
  saveClaims(claims)
  saveMergeState(mergeState)
}

function ok(body: unknown, delayMs = 180) {
  return of(new HttpResponse({ status: 200, body })).pipe(delay(delayMs))
}

function notFound() {
  return throwError(() => new HttpErrorResponse({ status: 404 }))
}

function conflict(body: unknown) {
  return throwError(() => new HttpErrorResponse({ status: 409, error: body }))
}

export const mockApiInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith('/api/')) return next(request)

  if (request.method === 'GET' && request.url === '/api/claims') {
    const query = request.params.get('query')?.toLowerCase() ?? ''
    const status = request.params.get('status') ?? ''
    const risk = request.params.get('risk') ?? ''
    const page = Number(request.params.get('page') ?? 1)
    const pageSize = Number(request.params.get('pageSize') ?? 10)
    const filtered = claims.filter(
      (item) =>
        (!query || `${item.id}${item.insured}${item.policyNo}`.toLowerCase().includes(query)) &&
        (!status || item.status === status) &&
        (!risk || item.riskLevel === risk),
    )
    const start = (page - 1) * pageSize
    return of(new HttpResponse({ status: 200, body: { items: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize } })).pipe(delay(220))
  }

  if (request.method === 'GET' && request.url.startsWith('/api/claims/')) {
    const id = request.url.split('/').pop()
    const item = claims.find((claim) => claim.id === id)
    return item ? of(new HttpResponse({ status: 200, body: item })).pipe(delay(120)) : throwError(() => new HttpErrorResponse({ status: 404 }))
  }

  if (request.method === 'POST' && request.url.endsWith('/quotes')) {
    const id = request.url.split('/').at(-2)
    const body = request.body as { itemId: string; amount: number; reason: string }
    const item = claims.find((claim) => claim.id === id)?.lossItems.find((loss) => loss.id === body.itemId)
    if (!item) return notFound()
    item.repairQuotes.push({
      version: item.repairQuotes.length + 1,
      amount: body.amount,
      reason: body.reason,
      operator: '当前用户',
      createdAt: new Date().toLocaleString('zh-CN'),
    })
    persist()
    return of(new HttpResponse({ status: 201, body: item })).pipe(delay(180))
  }

  if (request.method === 'POST' && request.url.endsWith('/approvals')) {
    const id = request.url.split('/').at(-2)
    const body = request.body as { role: string; result: string; comment: string }
    const item = claims.find((claim) => claim.id === id)
    const step = item?.approvals.find((approval) => approval.role === body.role)
    if (!item || !step) return notFound()
    step.status = body.result === '已通过' ? '已通过' : '已退回'
    step.operator = '当前用户'
    step.comment = body.comment
    step.completedAt = new Date().toLocaleString('zh-CN')
    item.audit.push({ id: `A-${Date.now()}`, at: '刚刚', operator: '当前用户', action: `会签${step.status}`, detail: body.comment })
    item.status = body.result === '已通过' ? '审批中' : '退回补件'
    persist()
    return of(new HttpResponse({ status: 200, body: item })).pipe(delay(180))
  }

  // 并案：状态总览
  if (request.method === 'GET' && request.url === '/api/merge/state') {
    return ok({ candidates: currentCandidates(), records: mergeState.records }, 160)
  }

  // 并案：开始（冻结两案快照，选主案）
  if (request.method === 'POST' && request.url === '/api/merge/start') {
    const body = request.body as { candidateId: string; mainCaseId: string }
    const candidate = currentCandidates().find((item) => item.id === body.candidateId)
    if (!candidate) return notFound()
    const main = claims.find((item) => item.id === body.mainCaseId)
    const mergedId = candidate.caseAId === body.mainCaseId ? candidate.caseBId : candidate.caseAId
    const merged = claims.find((item) => item.id === mergedId)
    if (!main || !merged) return notFound()
    const frozenAt = new Date().toLocaleString('zh-CN')
    const record: MergeRecord = {
      id: `MR-${Date.now()}`,
      candidateId: candidate.id,
      mainCaseId: main.id,
      mergedCaseId: merged.id,
      status: '进行中',
      frozenSnapshots: {
        [main.id]: { caseId: main.id, frozenAt, data: structuredClone(main) },
        [merged.id]: { caseId: merged.id, frozenAt, data: structuredClone(merged) },
      },
      conflicts: [],
      operator: '当前用户',
      startedAt: frozenAt,
      version: 1,
    }
    mergeState.records = [record, ...mergeState.records]
    const preview = buildPreviewFromRecord(record)
    persist()
    return ok({ record, preview }, 220)
  }

  // 并案：切换主案（两案快照已冻结，仅切换主案视角）
  if (request.method === 'POST' && request.url.includes('/api/merge/records/') && request.url.endsWith('/main')) {
    const recordId = request.url.split('/').at(-2)
    const body = request.body as { mainCaseId: string }
    const record = mergeState.records.find((item) => item.id === recordId)
    if (!record) return notFound()
    if (record.status !== '进行中') return conflict({ record, message: '并案已结束，不能切换主案。' })
    if (!record.frozenSnapshots[body.mainCaseId]) return notFound()
    record.mainCaseId = body.mainCaseId
    record.mergedCaseId = Object.keys(record.frozenSnapshots).find((id) => id !== body.mainCaseId) ?? record.mergedCaseId
    const preview = buildPreviewFromRecord(record)
    persist()
    return ok({ record, preview }, 160)
  }

  // 并案：确认（乐观锁，先到者生效）
  if (request.method === 'POST' && request.url.includes('/api/merge/records/') && request.url.endsWith('/confirm')) {
    const recordId = request.url.split('/').at(-2)
    const record = mergeState.records.find((item) => item.id === recordId)
    if (!record) return notFound()
    if (record.status !== '进行中') {
      return conflict({ record, message: '该并案已被先到者确认完成，后到请求未生效。' })
    }
    const main = claims.find((item) => item.id === record.mainCaseId)
    const merged = claims.find((item) => item.id === record.mergedCaseId)
    if (!main || !merged) return notFound()
    const result = executeMerge(main, merged)
    replaceClaim(result.main)
    replaceClaim(result.merged)
    record.status = '已完成'
    record.conflicts = result.conflicts
    record.completedAt = new Date().toLocaleString('zh-CN')
    record.version += 1
    const candidate = mergeState.candidates.find((item) => item.id === record.candidateId)
    if (candidate) candidate.status = '已合并'
    persist()
    return ok({ mainCase: result.main, mergedCase: result.merged, record }, 260)
  }

  // 并案：回滚（恢复原案与旧会签，不丢附件）
  if (request.method === 'POST' && request.url.includes('/api/merge/records/') && request.url.endsWith('/rollback')) {
    const recordId = request.url.split('/').at(-2)
    const record = mergeState.records.find((item) => item.id === recordId)
    if (!record) return notFound()
    const restored = rollbackMerge(record, claims)
    claims = restored
    record.status = '已回滚'
    record.completedAt = new Date().toLocaleString('zh-CN')
    record.version += 1
    const main = claims.find((item) => item.id === record.mainCaseId)
    const merged = claims.find((item) => item.id === record.mergedCaseId)
    if (main) {
      main.audit.push({ id: `A-ROLLBACK-${Date.now()}`, at: '刚刚', operator: '当前用户', action: '并案回滚', detail: '并案失败，已按冻结快照恢复原案与旧会签，附件保留。' })
    }
    persist()
    return ok({ mainCase: main, mergedCase: merged, record }, 220)
  }

  // 并案：忽略候选
  if (request.method === 'POST' && request.url.includes('/api/merge/candidates/') && request.url.endsWith('/ignore')) {
    const candidateId = request.url.split('/').at(-2)
    const detected = currentCandidates().find((item) => item.id === candidateId)
    if (!detected) return notFound()
    const existing = mergeState.candidates.find((item) => item.id === candidateId)
    if (existing) existing.status = '已忽略'
    else mergeState.candidates = [...mergeState.candidates, { ...detected, status: '已忽略' }]
    persist()
    return ok({ candidate: { ...detected, status: '已忽略' } }, 140)
  }

  // 并案：未决冲突处理
  if (request.method === 'POST' && request.url.includes('/api/merge/records/') && request.url.includes('/conflicts/')) {
    const segments = request.url.split('/')
    const recordId = segments.at(-4)
    const conflictId = segments.at(-2)
    const body = request.body as { resolution: string }
    const record = mergeState.records.find((item) => item.id === recordId)
    if (!record) return notFound()
    const conflict = record.conflicts.find((item) => item.id === conflictId)
    if (!conflict) return notFound()
    conflict.status = '已决'
    conflict.resolution = body.resolution as MergeRecord['conflicts'][number]['resolution']
    persist()
    return ok({ record }, 140)
  }

  return next(request)
}

function replaceClaim(next: ClaimCase) {
  const index = claims.findIndex((item) => item.id === next.id)
  if (index >= 0) claims[index] = next
  else claims.push(next)
}

function buildPreviewFromRecord(record: MergeRecord) {
  const main = record.frozenSnapshots[record.mainCaseId]?.data
  const merged = record.frozenSnapshots[record.mergedCaseId]?.data
  return main && merged ? buildPreview(main, merged) : null
}
