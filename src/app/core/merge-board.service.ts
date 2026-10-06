import { HttpErrorResponse } from '@angular/common/http'
import { Injectable } from '@angular/core'
import { Store } from '@ngrx/store'
import { catchError, Observable, of, OperatorFunction, tap, throwError } from 'rxjs'
import { ClaimsService } from './claims.service'
import { mergeBoardLoaded, setMergeBusy, type AppState } from './claims.store'
import type { MergeCommandResponse } from './models'

@Injectable({ providedIn: 'root' })
export class MergeBoardService {
  constructor(
    private readonly http: ClaimsService,
    private readonly store: Store<AppState>,
  ) {}

  apply = (board: MergeCommandResponse) => {
    this.store.dispatch(
      mergeBoardLoaded({
        claims: board.claims,
        candidates: board.candidates,
        conflicts: board.conflicts,
        sessions: board.sessions ?? [],
      }),
    )
  }

  /** 409 响应体里带的是失败/冲突后的最新看板，需要照样应用 */
  private capture(): OperatorFunction<MergeCommandResponse, MergeCommandResponse> {
    return catchError((error: unknown): Observable<MergeCommandResponse> => {
      if (error instanceof HttpErrorResponse && error.error?.claims) {
        const board = error.error as MergeCommandResponse
        this.apply(board)
        return of(board)
      }
      return throwError(() => error)
    })
  }

  load() {
    this.http.mergeBoard().subscribe(this.apply)
  }

  rescan(operator: string): Observable<MergeCommandResponse> {
    return this.http.rescanCandidates(operator).pipe(tap(this.apply))
  }

  freeze(sessionId: string, operator: string): Observable<MergeCommandResponse> {
    this.store.dispatch(setMergeBusy({ sessionId }))
    return this.http.freezeMerge(sessionId, operator).pipe(tap(this.apply), this.capture())
  }

  confirm(sessionId: string, operator: string, chosenMasterId: string, simulateFailure: boolean): Observable<MergeCommandResponse> {
    this.store.dispatch(setMergeBusy({ sessionId }))
    return this.http.confirmMerge(sessionId, operator, chosenMasterId, simulateFailure).pipe(tap(this.apply), this.capture())
  }

  undo(sessionId: string, operator: string): Observable<MergeCommandResponse> {
    this.store.dispatch(setMergeBusy({ sessionId }))
    return this.http.undoMerge(sessionId, operator).pipe(tap(this.apply), this.capture())
  }

  resolveConflict(sessionId: string, operator: string, resolution: '接受主案' | '维持分歧'): Observable<MergeCommandResponse> {
    this.store.dispatch(setMergeBusy({ sessionId }))
    return this.http.resolveConflict(sessionId, operator, resolution).pipe(tap(this.apply), this.capture())
  }

  discard(sessionId: string, operator: string): Observable<MergeCommandResponse> {
    this.store.dispatch(setMergeBusy({ sessionId }))
    return this.http.discardCandidate(sessionId, operator).pipe(tap(this.apply), this.capture())
  }
}
