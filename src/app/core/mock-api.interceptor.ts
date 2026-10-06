import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http'
import { delay, of, throwError } from 'rxjs'
import { mergeEngine, MergeError } from './merge.engine'
import type { MergeCommandResponse } from './models'

function board(extra: Partial<MergeCommandResponse> = {}): MergeCommandResponse {
  return {
    claims: structuredClone(mergeEngine.claims),
    candidates: mergeEngine.getCandidates(),
    conflicts: mergeEngine.getUnresolvedConflicts(),
    sessions: structuredClone(mergeEngine.sessions),
    ...extra,
  }
}

function mergeFailure(error: unknown) {
  if (error instanceof MergeError) {
    return throwError(() => new HttpErrorResponse({ status: 409, statusText: 'Merge Conflict', error: error.outcome }))
  }
  return throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Merge Engine Error', error: { message: (error as Error)?.message } }))
}

export const mockApiInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith('/api/')) return next(request)

  if (request.method === 'GET' && request.url === '/api/claims') {
    const query = request.params.get('query')?.toLowerCase() ?? ''
    const status = request.params.get('status') ?? ''
    const risk = request.params.get('risk') ?? ''
    const page = Number(request.params.get('page') ?? 1)
    const pageSize = Number(request.params.get('pageSize') ?? 10)
    const filtered = mergeEngine.claims.filter(
      (item) =>
        (!query || `${item.id}${item.insured}${item.policyNo}`.toLowerCase().includes(query)) &&
        (!status || item.status === status) &&
        (!risk || item.riskLevel === risk),
    )
    const start = (page - 1) * pageSize
    return of(
      new HttpResponse({
        status: 200,
        body: { items: structuredClone(filtered.slice(start, start + pageSize)), total: filtered.length, page, pageSize },
      }),
    ).pipe(delay(220))
  }

  if (request.method === 'GET' && request.url.startsWith('/api/claims/')) {
    const id = request.url.split('/').pop()
    const item = mergeEngine.getClaim(id ?? '')
    return item
      ? of(new HttpResponse({ status: 200, body: structuredClone(item) })).pipe(delay(120))
      : throwError(() => new HttpErrorResponse({ status: 404 }))
  }

  if (request.method === 'POST' && request.url.endsWith('/quotes')) {
    const id = request.url.split('/').at(-2)
    const body = request.body as { itemId: string; amount: number; reason: string }
    const claim = mergeEngine.claims.find((entry) => entry.id === id)
    const item = claim?.lossItems.find((loss) => loss.id === body.itemId)
    if (!claim || !item) return throwError(() => new HttpErrorResponse({ status: 404 }))
    item.repairQuotes.push({
      version: item.repairQuotes.length + 1,
      amount: body.amount,
      reason: body.reason,
      operator: '当前用户',
      createdAt: new Date().toLocaleString('zh-CN'),
    })
    mergeEngine.persist()
    return of(new HttpResponse({ status: 201, body: structuredClone(claim) })).pipe(delay(180))
  }

  if (request.method === 'POST' && request.url.endsWith('/approvals')) {
    const id = request.url.split('/').at(-2)
    const body = request.body as { role: string; result: string; comment: string }
    const item = mergeEngine.claims.find((claim) => claim.id === id)
    const step = item?.approvals.find((approval) => approval.role === body.role)
    if (!item || !step) return throwError(() => new HttpErrorResponse({ status: 404 }))
    step.status = body.result === '已通过' ? '已通过' : '已退回'
    step.operator = '当前用户'
    step.comment = body.comment
    step.completedAt = new Date().toLocaleString('zh-CN')
    item.audit.push({ id: `A-${Date.now()}`, at: '刚刚', operator: '当前用户', action: `会签${step.status}`, detail: body.comment })
    item.status = body.result === '已通过' ? '审批中' : '退回补件'
    mergeEngine.persist()
    return of(new HttpResponse({ status: 200, body: structuredClone(item) })).pipe(delay(180))
  }

  // ---------------- 并案处理 ----------------

  if (request.method === 'GET' && request.url === '/api/merges') {
    return of(new HttpResponse({ status: 200, body: board() })).pipe(delay(160))
  }

  const body = (request.body ?? {}) as Record<string, unknown>
  const operator = typeof body['operator'] === 'string' ? (body['operator'] as string) : '当前主管'

  if (request.method === 'POST' && request.url === '/api/merges/rescan') {
    mergeEngine.reconcileCandidates(operator)
    return of(new HttpResponse({ status: 200, body: board() })).pipe(delay(200))
  }

  if (request.method === 'POST' && request.url === '/api/merges/freeze') {
    try {
      const result = mergeEngine.freeze(body['sessionId'] as string, operator)
      return of(new HttpResponse({ status: 200, body: board({ session: result.session }) })).pipe(delay(240))
    } catch (error) {
      return mergeFailure(error)
    }
  }

  if (request.method === 'POST' && request.url === '/api/merges/confirm') {
    try {
      const result = mergeEngine.confirm(
        body['sessionId'] as string,
        operator,
        body['chosenMasterId'] as string,
        body['simulateFailure'] === true,
      )
      return of(
        new HttpResponse({
          status: 200,
          body: board({ outcome: result.outcome, session: result.session, conflict: result.conflict }),
        }),
      ).pipe(delay(300))
    } catch (error) {
      return mergeFailure(error)
    }
  }

  if (request.method === 'POST' && request.url === '/api/merges/undo') {
    try {
      const result = mergeEngine.undo(body['sessionId'] as string, operator)
      return of(new HttpResponse({ status: 200, body: board({ outcome: 'merged', session: result.session }) })).pipe(delay(260))
    } catch (error) {
      return mergeFailure(error)
    }
  }

  if (request.method === 'POST' && request.url === '/api/merges/conflicts/resolve') {
    try {
      const result = mergeEngine.resolveConflict(body['sessionId'] as string, operator, body['resolution'] as '接受主案' | '维持分歧')
      return of(new HttpResponse({ status: 200, body: board({ session: result.session }) })).pipe(delay(200))
    } catch (error) {
      return mergeFailure(error)
    }
  }

  if (request.method === 'POST' && request.url === '/api/merges/discard') {
    try {
      const result = mergeEngine.discard(body['sessionId'] as string, operator)
      return of(new HttpResponse({ status: 200, body: board({ session: result.session }) })).pipe(delay(180))
    } catch (error) {
      return mergeFailure(error)
    }
  }

  return next(request)
}
