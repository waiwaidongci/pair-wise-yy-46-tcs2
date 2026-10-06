import { createAction, createReducer, createSelector, on, props } from '@ngrx/store'
import type { ClaimCase } from './models'
import { buildPreview, type MergeCandidate, type MergePreview, type MergeRecord } from './merge'
import type { AppState } from './claims.store'

export type MergeState = {
  candidates: MergeCandidate[]
  records: MergeRecord[]
  preview: MergePreview | null
  activeRecordId: string
  busy: boolean
  conflictError: string
}

const initialMergeState: MergeState = {
  candidates: [],
  records: [],
  preview: null,
  activeRecordId: '',
  busy: false,
  conflictError: '',
}

export const loadMergeStateSuccess = createAction('[Merge] Load State Success', props<{ candidates: MergeCandidate[]; records: MergeRecord[] }>())
export const startMergeSuccess = createAction('[Merge] Start Success', props<{ record: MergeRecord; preview: MergePreview }>())
export const mergeConfirmSuccess = createAction('[Merge] Confirm Success', props<{ mainCase: ClaimCase; mergedCase: ClaimCase; record: MergeRecord }>())
export const mergeConflict = createAction('[Merge] Conflict', props<{ message: string; record: MergeRecord }>())
export const mergeRollbackSuccess = createAction('[Merge] Rollback Success', props<{ mainCase: ClaimCase; mergedCase: ClaimCase; record: MergeRecord }>())
export const ignoreCandidateSuccess = createAction('[Merge] Ignore Success', props<{ candidate: MergeCandidate }>())
export const resolveConflictSuccess = createAction('[Merge] Resolve Conflict Success', props<{ record: MergeRecord }>())
export const setMergeBusy = createAction('[Merge] Busy', props<{ busy: boolean }>())
export const clearMergeConflict = createAction('[Merge] Clear Conflict')

export const mergeReducer = createReducer(
  initialMergeState,
  on(loadMergeStateSuccess, (state, { candidates, records }) => ({ ...state, candidates, records })),
  on(startMergeSuccess, (state, { record, preview }) => ({
    ...state,
    records: [record, ...state.records.filter((item) => item.id !== record.id)],
    preview,
    activeRecordId: record.id,
    conflictError: '',
  })),
  on(mergeConfirmSuccess, (state, { record }) => ({
    ...state,
    records: state.records.map((item) => (item.id === record.id ? record : item)),
    preview: null,
    busy: false,
  })),
  on(mergeConflict, (state, { message, record }) => ({
    ...state,
    records: state.records.map((item) => (item.id === record.id ? record : item)),
    conflictError: message,
    busy: false,
  })),
  on(mergeRollbackSuccess, (state, { record }) => ({
    ...state,
    records: state.records.map((item) => (item.id === record.id ? record : item)),
    preview: null,
    busy: false,
  })),
  on(ignoreCandidateSuccess, (state, { candidate }) => ({
    ...state,
    candidates: state.candidates.map((item) => (item.id === candidate.id ? candidate : item)),
  })),
  on(resolveConflictSuccess, (state, { record }) => ({
    ...state,
    records: state.records.map((item) => (item.id === record.id ? record : item)),
  })),
  on(setMergeBusy, (state, { busy }) => ({ ...state, busy })),
  on(clearMergeConflict, (state) => ({ ...state, conflictError: '' })),
)

export const selectMergeState = (state: AppState) => state.merge
export const selectMergeCandidates = createSelector(selectMergeState, (state) => state.candidates)
export const selectMergeRecords = createSelector(selectMergeState, (state) => state.records)
export const selectActiveRecord = createSelector(selectMergeState, (state) => state.records.find((item) => item.id === state.activeRecordId) ?? null)
export const selectMergePreview = createSelector(selectMergeState, (state) => state.preview)
/** 从冻结快照实时计算预览，重开页面后仍可继续并案。 */
export const selectActivePreview = createSelector(selectActiveRecord, (record) => {
  if (!record || record.status !== '进行中') return null
  const main = record.frozenSnapshots[record.mainCaseId]?.data
  const merged = record.frozenSnapshots[record.mergedCaseId]?.data
  return main && merged ? buildPreview(main, merged) : null
})
export const selectMergeConflictError = createSelector(selectMergeState, (state) => state.conflictError)
export const selectPendingCandidateCount = createSelector(selectMergeCandidates, (candidates) => candidates.filter((item) => item.status === '待处理').length)
