export type ClaimStatus = '查勘中' | '待复核' | '退回补件' | '审批中' | '待支付' | '已结案'

export type Attachment = {
  id: string
  name: string
  category: '现场照片' | '修复报告' | '专家意见' | '保单摘录'
  version: number
  uploadedBy: string
  uploadedAt: string
  /** 并案后标记来源案件，便于保留来源引用 */
  sourceClaimId?: string
}

/** 并案后并列保留的金额依据（来自被合并案的重复科目） */
export type AmountBasis = {
  sourceClaimId: string
  sourceItemId: string
  version: number
  amount: number
  reason: string
  operator: string
  createdAt: string
}

export type LossItem = {
  id: string
  category: string
  description: string
  damage: string
  repairQuotes: Array<{ version: number; amount: number; reason: string; operator: string; createdAt: string }>
  salvage: number
  liability: number
  disputed: boolean
  attachments: Attachment[]
  expertNotes: string[]
  /** 并案时重复科目合成一项后，对端科目留痕 */
  mergedFrom?: Array<{ claimId: string; itemId: string }>
  /** 重复科目金额依据并列，仅合成科目有值 */
  amountBasis?: AmountBasis[]
  /** 被合并案带入的非重复科目，保留来源引用 */
  sourceClaimId?: string
}

export type ApprovalStatus = '待处理' | '已通过' | '已退回' | '已失效'

export type ApprovalStep = {
  role: string
  threshold: number
  status: ApprovalStatus
  operator?: string
  comment?: string
  completedAt?: string
}

/** 准备金重算后失效的原会签，仍保留在主案上待复核 */
export type InvalidApproval = ApprovalStep & { sourceClaimId: string; invalidatedReason: string }

export type AuditEvent = { id: string; at: string; operator: string; action: string; detail: string }

export type ClaimCase = {
  id: string
  policyNo: string
  insured: string
  lossAddress: string
  accidentDate: string
  reportedAt: string
  adjuster: string
  status: ClaimStatus
  riskLevel: '低' | '中' | '高'
  reserve: number
  paid: number
  deductible: number
  lossItems: LossItem[]
  approvals: ApprovalStep[]
  audit: AuditEvent[]
  /** 并案后保留的来源案件引用 */
  mergedFrom?: string[]
  /** 来源案件的旧会签，全部失效待复核 */
  invalidatedApprovals?: InvalidApproval[]
  /** 来源案件审计留痕前缀，合并后写入主案时间线 */
  sourceSnapshotId?: string
}

export type ClaimFilters = {
  query: string
  status: string
  risk: string
  page: number
  pageSize: number
}

export type PagedClaims = {
  items: ClaimCase[]
  total: number
  page: number
  pageSize: number
}

// ============ 并案领域模型 ============

/** 候选匹配维度 */
export type MergeMatchKey = 'accident' | 'address' | 'policy' | 'evidence'
export type MergeMatchReason = { key: MergeMatchKey; label: string; detail: string; score: number }

/** 并案会话状态：候选待冻结 → 已冻结待确认 → 已合并（可撤销）；异常为冲突/失败/已撤销 */
export type MergeStatus = '候选' | '待确认' | '已合并' | '冲突' | '失败' | '已撤销'

/** 两人同时确认时，后到者保留的分歧 */
export type MergeConflict = {
  sessionId: string
  masterId: string
  sourceId: string
  loserOperator: string
  winnerOperator: string
  masterChoice: string
  loserChoice: string
  at: string
  resolved: boolean
  resolution?: string
}

/** 并案处理记录（每次冻结/确认/冲突/失败/撤销都追加） */
export type MergeHistoryEntry = {
  id: string
  at: string
  operator: string
  action: '候选生成' | '冻结快照' | '确认并案' | '冲突保留' | '合并失败' | '撤销并案' | '分歧处理'
  detail: string
}

export type MergeSession = {
  id: string
  masterId: string
  sourceId: string
  masterChoice: string
  sourceChoice: string
  status: MergeStatus
  operator: string
  reasons: MergeMatchReason[]
  score: number
  evidencePairs: Array<{ master: string; source: string; detail: string }>
  /** 冻结时生成的两案快照，合并/回滚都以它为准 */
  frozenAt?: string
  frozenBy?: string
  masterSnapshot?: ClaimCase
  sourceSnapshot?: ClaimCase
  mergedClaimId?: string
  /** 先到确认者（并发仲裁胜出方） */
  wonBy?: string
  /** 后到确认者（operator）保留的分歧，同一会话可累积 */
  conflicts: MergeConflict[]
  history: MergeHistoryEntry[]
  failureReason?: string
  /** 主管判定非同一起事故，重新扫描时不再复活 */
  discarded?: boolean
  createdAt: string
  updatedAt: string
}

export type MergeCandidateView = {
  sessionId: string
  masterId: string
  sourceId: string
  master: ClaimCase
  source: ClaimCase
  status: MergeStatus
  operator: string
  score: number
  reasons: MergeMatchReason[]
  evidencePairs: MergeSession['evidencePairs']
}

export type MergeCommandResponse = {
  session?: MergeSession
  sessions?: MergeSession[]
  claims: ClaimCase[]
  candidates: MergeCandidateView[]
  conflicts: MergeConflict[]
  outcome?: 'merged' | 'conflict' | 'failed'
  conflict?: MergeConflict
  failureReason?: string
}
