import { HttpClient, HttpParams } from '@angular/common/http'
import { Injectable } from '@angular/core'
import type { ClaimCase, ClaimFilters, MergeCommandResponse, PagedClaims } from './models'

@Injectable({ providedIn: 'root' })
export class ClaimsService {
  constructor(private readonly http: HttpClient) {}

  list(filters: ClaimFilters) {
    const params = new HttpParams()
      .set('query', filters.query)
      .set('status', filters.status)
      .set('risk', filters.risk)
      .set('page', filters.page)
      .set('pageSize', filters.pageSize)
    return this.http.get<PagedClaims>('/api/claims', { params })
  }

  get(id: string) {
    return this.http.get<ClaimCase>(`/api/claims/${id}`)
  }

  addQuote(claimId: string, body: { itemId: string; amount: number; reason: string }) {
    return this.http.post<ClaimCase>(`/api/claims/${claimId}/quotes`, body)
  }

  approve(claimId: string, body: { role: string; result: string; comment: string }) {
    return this.http.post<ClaimCase>(`/api/claims/${claimId}/approvals`, body)
  }

  // -------- 并案处理 --------

  mergeBoard() {
    return this.http.get<MergeCommandResponse>('/api/merges')
  }

  rescanCandidates(operator = '当前主管') {
    return this.http.post<MergeCommandResponse>('/api/merges/rescan', { operator })
  }

  freezeMerge(sessionId: string, operator: string) {
    return this.http.post<MergeCommandResponse>('/api/merges/freeze', { sessionId, operator })
  }

  confirmMerge(sessionId: string, operator: string, chosenMasterId: string, simulateFailure = false) {
    return this.http.post<MergeCommandResponse>('/api/merges/confirm', { sessionId, operator, chosenMasterId, simulateFailure })
  }

  undoMerge(sessionId: string, operator: string) {
    return this.http.post<MergeCommandResponse>('/api/merges/undo', { sessionId, operator })
  }

  resolveConflict(sessionId: string, operator: string, resolution: '接受主案' | '维持分歧') {
    return this.http.post<MergeCommandResponse>('/api/merges/conflicts/resolve', { sessionId, operator, resolution })
  }

  discardCandidate(sessionId: string, operator: string) {
    return this.http.post<MergeCommandResponse>('/api/merges/discard', { sessionId, operator })
  }
}
