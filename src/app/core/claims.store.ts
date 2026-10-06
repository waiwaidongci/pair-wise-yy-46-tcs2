import { createAction, createReducer, createSelector, on, props } from '@ngrx/store'
import { seedClaims } from './seed'
import type { ClaimCase, ClaimFilters, MergeCandidateView, MergeConflict, MergeSession } from './models'

export type ClaimsState = {
  items: ClaimCase[]
  filters: ClaimFilters
  total: number
  selectedId: string
  loading: boolean
  draft: string
  toast: string
  mergeCandidates: MergeCandidateView[]
  mergeSessions: MergeSession[]
  unresolvedConflicts: MergeConflict[]
  mergeBusy: string
}

export type AppState = { claims: ClaimsState }

const defaultFilters: ClaimFilters = { query: '', status: '', risk: '', page: 1, pageSize: 10 }

function seedState(): ClaimsState {
  return {
    items: structuredClone(seedClaims),
    filters: { ...defaultFilters },
    total: seedClaims.length,
    selectedId: seedClaims[0].id,
    loading: false,
    draft: '待补充房屋檩条第三方复测依据。',
    toast: '',
    mergeCandidates: [],
    mergeSessions: [],
    unresolvedConflicts: [],
    mergeBusy: '',
  }
}

export const initialClaimsState: ClaimsState = seedState()

export const loadClaimsSuccess = createAction('[Claims] Load Success', props<{ items: ClaimCase[]; total: number }>())
export const setFilters = createAction('[Claims] Set Filters', props<{ filters: Partial<ClaimFilters> }>())
export const selectClaim = createAction('[Claims] Select', props<{ id: string }>())
export const saveDraft = createAction('[Claims] Save Draft', props<{ draft: string }>())
export const updateClaim = createAction('[Claims] Update Claim', props<{ claim: ClaimCase }>())
export const setToast = createAction('[Claims] Toast', props<{ message: string }>())
export const mergeBoardLoaded = createAction(
  '[Merges] Board Loaded',
  props<{ claims: ClaimCase[]; candidates: MergeCandidateView[]; conflicts: MergeConflict[]; sessions: MergeSession[] }>(),
)
export const setMergeBusy = createAction('[Merges] Busy', props<{ sessionId: string }>())

export const claimsReducer = createReducer(
  initialClaimsState,
  on(loadClaimsSuccess, (state, { items, total }) => ({ ...state, items, total, loading: false })),
  on(setFilters, (state, { filters }) => ({ ...state, filters: { ...state.filters, ...filters } })),
  on(selectClaim, (state, { id }) => ({ ...state, selectedId: id })),
  on(saveDraft, (state, { draft }) => ({ ...state, draft, toast: '草稿已恢复并保存到本地' })),
  on(updateClaim, (state, { claim }) => ({
    ...state,
    items: state.items.map((item) => (item.id === claim.id ? claim : item)),
    toast: '案件版本已更新',
  })),
  on(setToast, (state, { message }) => ({ ...state, toast: message })),
  on(mergeBoardLoaded, (state, { claims, candidates, conflicts, sessions }) => ({
    ...state,
    items: claims,
    total: claims.length,
    mergeCandidates: candidates,
    unresolvedConflicts: conflicts,
    mergeSessions: sessions,
    mergeBusy: '',
    selectedId: claims.some((claim) => claim.id === state.selectedId) ? state.selectedId : (claims[0]?.id ?? ''),
  })),
  on(setMergeBusy, (state, { sessionId }) => ({ ...state, mergeBusy: sessionId })),
)

export const selectClaimsState = (state: AppState) => state.claims
export const selectAllClaims = createSelector(selectClaimsState, (state) => state.items)
export const selectFilters = createSelector(selectClaimsState, (state) => state.filters)
export const selectSelectedClaim = createSelector(
  selectClaimsState,
  (state) => state.items.find((item) => item.id === state.selectedId) ?? state.items[0],
)
export const selectMergeCandidates = createSelector(selectClaimsState, (state) => state.mergeCandidates)
export const selectMergeSessions = createSelector(selectClaimsState, (state) => state.mergeSessions)
export const selectSessionsForSelectedClaim = createSelector(selectSelectedClaim, selectMergeSessions, (claim, sessions) =>
  claim ? sessions.filter((session) => session.masterId === claim.id || session.sourceId === claim.id) : [],
)
export const selectUnresolvedConflicts = createSelector(selectClaimsState, (state) => state.unresolvedConflicts)
export const selectSelectedClaimConflicts = createSelector(selectSelectedClaim, selectUnresolvedConflicts, (claim, conflicts) =>
  claim ? conflicts.filter((conflict) => conflict.masterId === claim.id || conflict.sourceId === claim.id) : [],
)
export const selectMergeBusy = createSelector(selectClaimsState, (state) => state.mergeBusy)
export const selectCandidateCount = createSelector(selectMergeCandidates, (candidates) => candidates.length)
export const selectUnresolvedConflictCount = createSelector(selectUnresolvedConflicts, (conflicts) => conflicts.length)
export const selectFilteredClaims = createSelector(selectAllClaims, selectFilters, (claims, filters) =>
  claims.filter(
    (item) =>
      (!filters.query || `${item.id}${item.insured}${item.policyNo}`.toLowerCase().includes(filters.query.toLowerCase())) &&
      (!filters.status || item.status === filters.status) &&
      (!filters.risk || item.riskLevel === filters.risk),
  ),
)
