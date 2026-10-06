import { HttpClient, HttpParams } from '@angular/common/http'
import { Injectable } from '@angular/core'
import type { ClaimCase, ClaimFilters, PagedClaims } from './models'
import type { MergeCandidate, MergePreview, MergeRecord } from './merge'

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
    return this.http.post(`/api/claims/${claimId}/quotes`, body)
  }

  approve(claimId: string, body: { role: string; result: string; comment: string }) {
    return this.http.post(`/api/claims/${claimId}/approvals`, body)
  }

  // 并案相关
  mergeState() {
    return this.http.get<{ candidates: MergeCandidate[]; records: MergeRecord[] }>('/api/merge/state')
  }

  startMerge(candidateId: string, mainCaseId: string) {
    return this.http.post<{ record: MergeRecord; preview: MergePreview }>('/api/merge/start', { candidateId, mainCaseId })
  }

  switchMain(recordId: string, mainCaseId: string) {
    return this.http.post<{ record: MergeRecord; preview: MergePreview }>(`/api/merge/records/${recordId}/main`, { mainCaseId })
  }

  confirmMerge(recordId: string) {
    return this.http.post<{ mainCase: ClaimCase; mergedCase: ClaimCase; record: MergeRecord }>(`/api/merge/records/${recordId}/confirm`, {})
  }

  rollbackMerge(recordId: string) {
    return this.http.post<{ mainCase: ClaimCase; mergedCase: ClaimCase; record: MergeRecord }>(`/api/merge/records/${recordId}/rollback`, {})
  }

  ignoreCandidate(candidateId: string) {
    return this.http.post<{ candidate: MergeCandidate }>(`/api/merge/candidates/${candidateId}/ignore`, {})
  }

  resolveConflict(recordId: string, conflictId: string, resolution: string) {
    return this.http.post<{ record: MergeRecord }>(`/api/merge/records/${recordId}/conflicts/${conflictId}/resolve`, { resolution })
  }
}

