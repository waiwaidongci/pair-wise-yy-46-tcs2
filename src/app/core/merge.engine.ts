import type {
  AmountBasis,
  ApprovalStep,
  ClaimCase,
  InvalidApproval,
  LossItem,
  MergeCandidateView,
  MergeConflict,
  MergeHistoryEntry,
  MergeMatchReason,
  MergeSession,
} from './models'
import { seedClaims } from './seed'

const STORAGE_KEY = 'property-claims-merge-v2'

type PersistedBoard = { claims: ClaimCase[]; sessions: MergeSession[] }

type ConfirmOutcome = {
  outcome: 'merged' | 'conflict' | 'failed'
  session: MergeSession
  claims: ClaimCase[]
  candidates: MergeCandidateView[]
  conflicts: MergeConflict[]
  conflict?: MergeConflict
}

const APPROVAL_CHAIN: Array<{ role: string; threshold: number }> = [
  { role: '查勘员提交', threshold: 0 },
  { role: '高级核赔员', threshold: 500000 },
  { role: '理赔经理', threshold: 1000000 },
  { role: '区域负责人', threshold: 1500000 },
]

const now = () => new Date().toLocaleString('zh-CN', { hour12: false })

let seq = 0
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${(seq++).toString(36)}`

/** 2-gram 相似度，用于名称/地址/证据的模糊比对 */
function bigrams(value: string) {
  const text = value.replaceAll(/[\s（）()【】\[\]·.,，。_-]/g, '')
  const grams = new Set<string>()
  for (let i = 0; i < text.length - 1; i++) grams.add(text.slice(i, i + 2))
  return grams
}

function similarity(a: string, b: string) {
  if (!a || !b) return 0
  const ga = bigrams(a)
  const gb = bigrams(b)
  let hit = 0
  ga.forEach((g) => {
    if (gb.has(g)) hit++
  })
  return hit / Math.max(1, new Set([...ga, ...gb]).size)
}

function normalizeAddress(address: string) {
  return address.replaceAll(/\s/g, '').replaceAll(/[（）()]/g, '')
}

/** 抽取“道路 + 门牌号”核心，忽略城市/区县与库区/厂房后缀差异 */
function addressCore(address: string) {
  const normalized = normalizeAddress(address)
  const match = normalized.match(/[一-龥A-Za-z0-9]+路\d+号/)
  return match?.[0] ?? normalized
}

function canonicalInsured(name: string) {
  return name
    .replaceAll(/\s/g, '')
    .replaceAll(/[（）()]/g, '')
    .replace('上海市', '')
    .replace('上海', '')
    .replace('宁波市', '')
    .replace('宁波', '')
}

function latestQuote(item: LossItem) {
  return item.repairQuotes.at(-1)
}

/** 建议准备金：取各科目最新报价，残值与责任比例后计入主案免赔 */
export function calcReserve(claim: ClaimCase, items: LossItem[]) {
  const net = items.reduce((sum, item) => sum + ((latestQuote(item)?.amount ?? 0) - item.salvage) * item.liability, 0)
  return Math.max(0, Math.round(net - claim.deductible))
}

export class MergeError extends Error {
  constructor(
    public readonly outcome: ConfirmOutcome,
  ) {
    super(outcome.session.failureReason ?? '并案失败')
  }
}

class MergeEngine {
  claims: ClaimCase[] = []
  sessions: MergeSession[] = []

  constructor() {
    this.restore()
  }

  private restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const board = JSON.parse(raw) as PersistedBoard
        if (Array.isArray(board.claims) && Array.isArray(board.sessions)) {
          this.claims = board.claims
          this.sessions = board.sessions
          return
        }
      }
    } catch {
      /* 本地版本损坏时回到种子数据 */
    }
    this.claims = structuredClone(seedClaims)
    this.sessions = []
    this.reconcileCandidates('系统初始化')
    this.persist()
  }

  persist() {
    const board: PersistedBoard = { claims: this.claims, sessions: this.sessions }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(board))
  }

  reset() {
    this.claims = structuredClone(seedClaims)
    this.sessions = []
    this.reconcileCandidates('主管重新扫描')
    this.persist()
  }

  getClaim(id: string) {
    return this.claims.find((claim) => claim.id === id)
  }

  // ---------------- 候选扫描 ----------------

  private pairId(a: string, b: string) {
    return [a, b].sort().join('|')
  }

  private matchPair(master: ClaimCase, source: ClaimCase): { reasons: MergeMatchReason[]; evidencePairs: MergeSession['evidencePairs']; score: number } | null {
    const reasons: MergeMatchReason[] = []
    const evidencePairs: MergeSession['evidencePairs'] = []

    if (master.accidentDate === source.accidentDate) {
      reasons.push({ key: 'accident', label: '事故日一致', detail: `两案事故日均为 ${master.accidentDate}`, score: 1 })
    }

    const masterRoad = addressCore(master.lossAddress)
    const sourceRoad = addressCore(source.lossAddress)
    if (masterRoad === sourceRoad) {
      reasons.push({ key: 'address', label: '报案地址重合', detail: `地址核心均为“${masterRoad}”（${master.lossAddress} / ${source.lossAddress}）`, score: 0.95 })
    }

    if (master.policyNo === source.policyNo) {
      reasons.push({ key: 'policy', label: '保单号相同', detail: `保单号 ${master.policyNo}`, score: 1 })
    } else {
      const [a, b] = [master.policyNo.replace(/-[A-Z]$/, ''), source.policyNo.replace(/-[A-Z]$/, '')]
      if (a === b) {
        reasons.push({ key: 'policy', label: '保单号疑似关联', detail: `${master.policyNo} 与 ${source.policyNo} 主保单号一致，仅后缀不同`, score: 0.72 })
      }
    }

    const insuredSim = similarity(canonicalInsured(master.insured), canonicalInsured(source.insured))
    if (insuredSim >= 0.42) {
      evidencePairs.push({ master: master.insured, source: source.insured, detail: `被保险人名称相似度 ${(insuredSim * 100).toFixed(0)}%，仅地区语序或简称差异` })
    }

    for (const mi of master.lossItems) {
      for (const si of source.lossItems) {
        const descSim = similarity(mi.description, si.description)
        const damageSim = similarity(mi.damage, si.damage)
        if (mi.category === si.category && (descSim >= 0.3 || damageSim >= 0.3)) {
          evidencePairs.push({
            master: `${mi.category} · ${mi.description}`,
            source: `${si.category} · ${si.description}`,
            detail: `同类科目描述重合 ${(Math.max(descSim, damageSim) * 100).toFixed(0)}%`,
          })
        }
        const fileA = mi.attachments.map((file) => file.name).join('|')
        const fileB = si.attachments.map((file) => file.name).join('|')
        const fileSim = similarity(fileA, fileB)
        if (fileA && fileB && fileSim >= 0.3) {
          evidencePairs.push({ master: fileA, source: fileB, detail: `双方附件名称相似度 ${(fileSim * 100).toFixed(0)}%，疑似同一现场证据` })
        }
      }
    }

    if (evidencePairs.length) {
      reasons.push({ key: 'evidence', label: '现场证据互证', detail: evidencePairs[0].detail, score: Math.min(0.85, 0.45 + evidencePairs.length * 0.12) })
    }

    // 同一事故日是并案前提，且至少还要命中地址/保单/证据之一
    if (!reasons.some((reason) => reason.key === 'accident')) return null
    if (reasons.length < 2) return null

    return { reasons, evidencePairs, score: Number(reasons.reduce((sum, reason) => sum + reason.score, 0).toFixed(2)) }
  }

  /** 扫描全部案件对，为新发现的疑似同事故案件对建立候选会话，已有会话保持不变 */
  reconcileCandidates(operator: string): MergeSession[] {
    for (let i = 0; i < this.claims.length; i++) {
      for (let j = i + 1; j < this.claims.length; j++) {
        const a = this.claims[i]
        const b = this.claims[j]
        const id = this.pairId(a.id, b.id)
        const existing = this.sessions.find((session) => session.id === id)
        if (existing && !(existing.status === '已撤销' && !existing.discarded)) continue
        // 已并过的案件不再产生新案，避免链式重复
        if (a.mergedFrom?.length || b.mergedFrom?.length) continue
        const matched = this.matchPair(a, b)
        if (!matched) continue
        // 撤销后的案件对可重新生成候选；主管明确放弃的案件对不再提示
        if (existing && existing.status === '已撤销' && !existing.discarded) {
          this.sessions = this.sessions.filter((session) => session.id !== id)
        }
        const session: MergeSession = {
          id,
          masterId: a.id,
          sourceId: b.id,
          masterChoice: '',
          sourceChoice: '',
          status: '候选',
          operator: '待指派',
          reasons: matched.reasons,
          score: matched.score,
          evidencePairs: matched.evidencePairs,
          conflicts: [],
          history: [this.entry('候选生成', operator, `按事故日、地址、保单与证据比对命中：${matched.reasons.map((reason) => reason.label).join('、')}。`)],
          createdAt: now(),
          updatedAt: now(),
        }
        this.sessions.unshift(session)
      }
    }
    this.persist()
    return this.sessions
  }

  getCandidates(): MergeCandidateView[] {
    return this.sessions
      .filter((session) => ['候选', '待确认', '失败'].includes(session.status))
      .map((session) => this.toCandidateView(session))
      .filter((view): view is MergeCandidateView => view !== null)
      .sort((a, b) => b.score - a.score)
  }

  private toCandidateView(session: MergeSession): MergeCandidateView | null {
    const master = this.claims.find((claim) => claim.id === session.masterId) ?? session.masterSnapshot
    const source = this.claims.find((claim) => claim.id === session.sourceId) ?? session.sourceSnapshot
    if (!master || !source) return null
    return {
      sessionId: session.id,
      masterId: session.masterId,
      sourceId: session.sourceId,
      master,
      source,
      status: session.status,
      operator: session.operator,
      score: session.score,
      reasons: session.reasons,
      evidencePairs: session.evidencePairs,
    }
  }

  getUnresolvedConflicts(): MergeConflict[] {
    return this.sessions.flatMap((session) => session.conflicts.filter((conflict) => !conflict.resolved))
  }

  private board(session: MergeSession, outcome: ConfirmOutcome['outcome'], conflict?: MergeConflict): ConfirmOutcome {
    return {
      outcome,
      session,
      claims: structuredClone(this.claims),
      candidates: this.getCandidates(),
      conflicts: this.getUnresolvedConflicts(),
      conflict,
    }
  }

  private entry(action: MergeHistoryEntry['action'], operator: string, detail: string): MergeHistoryEntry {
    return { id: nextId('MH'), at: now(), operator, action, detail }
  }

  // ---------------- 冻结快照 ----------------

  freeze(sessionId: string, operator: string): ConfirmOutcome {
    const session = this.requireSession(sessionId)
    const master = this.claims.find((claim) => claim.id === session.masterId)
    const source = this.claims.find((claim) => claim.id === session.sourceId)
    if (!master || !source) {
      session.status = '失败'
      session.failureReason = '原案已不存在，无法冻结快照'
      session.history.push(this.entry('冻结快照', operator, '冻结失败：原案缺失。'))
      this.touch(session)
      throw new MergeError(this.board(session, 'failed'))
    }
    session.masterSnapshot = structuredClone(master)
    session.sourceSnapshot = structuredClone(source)
    session.frozenAt = now()
    session.frozenBy = operator
    session.operator = operator
    session.status = '待确认'
    session.failureReason = undefined
    session.history.push(
      this.entry('冻结快照', operator, `已冻结 ${master.id} 与 ${source.id} 的合并前快照（含损失科目、附件、准备金与会签），确认前两案保持只读。`),
    )
    this.touch(session)
    return this.board(session, 'merged')
  }

  // ---------------- 确认并案（并发仲裁在入口处处理） ----------------

  confirm(sessionId: string, operator: string, chosenMasterId: string, simulateFailure = false): ConfirmOutcome {
    const session = this.requireSession(sessionId)

    // 已被先到者确认：后到者保留分歧，但仍然看到主案结果
    if (session.status === '已合并') {
      if (![session.masterId, session.sourceId].includes(chosenMasterId)) {
        session.failureReason = '主案选择不在候选范围内'
        this.touch(session)
        throw new MergeError(this.board(session, 'failed'))
      }
      // 后到者与先到者选择一致：仅登记并发，不制造未决分歧
      if (chosenMasterId === session.masterChoice) {
        session.history.push(
          this.entry('冲突保留', operator, `后到确认与先生效结果一致（主案 ${session.masterChoice}），仅登记并发提交，不产生分歧。`),
        )
        this.touch(session)
        return this.board(session, 'merged')
      }
      const conflict: MergeConflict = {
        sessionId: session.id,
        masterId: session.masterId,
        sourceId: session.sourceId,
        loserOperator: operator,
        winnerOperator: session.wonBy ?? session.frozenBy ?? session.operator,
        masterChoice: session.masterChoice,
        loserChoice: chosenMasterId,
        at: now(),
        resolved: false,
      }
      session.conflicts.push(conflict)
      session.history.push(
        this.entry(
          '冲突保留',
          operator,
          chosenMasterId === session.masterChoice
            ? `后到确认与已生效结果主案一致，仅登记并发提交记录。`
            : `${operator} 的确认晚到：主案选择 ${chosenMasterId} 与先生效的 ${session.masterChoice} 不一致，分歧已保留，当前展示主案 ${session.masterId}。`,
        ),
      )
      this.touch(session)
      return this.board(session, 'conflict', conflict)
    }

    if (!session.masterSnapshot || !session.sourceSnapshot || !['候选', '待确认', '失败'].includes(session.status)) {
      session.status = '失败'
      session.failureReason = '尚未冻结两案快照，不能确认并案'
      session.history.push(this.entry('确认并案', operator, '确认被拒绝：快照缺失，已提示先冻结。'))
      this.touch(session)
      throw new MergeError(this.board(session, 'failed'))
    }

    if (![session.masterId, session.sourceId].includes(chosenMasterId)) {
      session.status = '失败'
      session.failureReason = `主案必须是 ${session.masterId} 或 ${session.sourceId}`
      session.history.push(this.entry('合并失败', operator, session.failureReason))
      this.touch(session)
      throw new MergeError(this.board(session, 'failed'))
    }

    // 按选择对齐主案/来源快照
    const masterSnapshot = chosenMasterId === session.masterId ? session.masterSnapshot : session.sourceSnapshot
    const sourceSnapshot = chosenMasterId === session.masterId ? session.sourceSnapshot : session.masterSnapshot
    session.masterId = masterSnapshot.id
    session.sourceId = sourceSnapshot.id
    session.masterChoice = masterSnapshot.id
    session.sourceChoice = sourceSnapshot.id
    session.operator = operator

    // 模拟“准备金重算服务异常”：事务在提交前失败，任何现场数据不得被改动
    if (simulateFailure) {
      session.status = '失败'
      session.failureReason = '准备金重算服务异常，合并事务已回滚'
      session.history.push(
        this.entry('合并失败', operator, '冻结快照校验通过，但重算准备金时服务异常；两案、旧会签与全部附件已按快照恢复，未发生提交。'),
      )
      this.touch(session)
      return this.board(session, 'failed')
    }

    try {
      const merged = this.buildMergedClaim(masterSnapshot, sourceSnapshot, operator, session.id)
      this.commitMerge(masterSnapshot.id, sourceSnapshot.id, merged)
      const attachmentCount = merged.lossItems.reduce((sum, item) => sum + item.attachments.length, 0)
      session.status = '已合并'
      session.mergedClaimId = merged.id
      session.wonBy = operator
      session.failureReason = undefined
      session.history.push(
        this.entry(
          '确认并案',
          operator,
          `先到确认生效：保留主案 ${merged.id}，并入 ${sourceSnapshot.id}；重复科目已合成、金额依据并列，准备金按主案重算为 ${merged.reserve.toLocaleString('zh-CN')} 元；原会签 ${merged.invalidatedApprovals?.length ?? 0} 步失效待复核；附件合计 ${attachmentCount} 份。`,
        ),
      )
      this.touch(session)
      return this.board(session, 'merged')
    } catch (error) {
      // 提交阶段异常：以快照为准恢复，确保旧会签和附件不丢
      this.rollbackMerge(masterSnapshot, sourceSnapshot)
      session.status = '失败'
      session.failureReason = error instanceof Error ? error.message : '合并提交异常'
      session.history.push(this.entry('合并失败', operator, `合并事务异常并已回滚：${session.failureReason}；两案与旧会签恢复，附件保持完整。`))
      this.touch(session)
      return this.board(session, 'failed')
    }
  }

  private buildMergedClaim(masterSnapshot: ClaimCase, sourceSnapshot: ClaimCase, operator: string, sessionId: string): ClaimCase {
    const merged: ClaimCase = structuredClone(masterSnapshot)
    const beforeAttachmentCount =
      masterSnapshot.lossItems.reduce((sum, item) => sum + item.attachments.length, 0) +
      sourceSnapshot.lossItems.reduce((sum, item) => sum + item.attachments.length, 0)

    const invalidated: InvalidApproval[] = []

    // 主案未完成的会签因准备金即将重算而失效，已通过步骤保留为历史
    for (const step of merged.approvals) {
      if (step.status === '待处理') {
        invalidated.push({ ...step, status: '已失效', sourceClaimId: masterSnapshot.id, invalidatedReason: '并案后准备金按主案重算，原会签失效待复核' })
      }
    }
    // 来源案会签全部失效，逐步入库存痕
    for (const step of sourceSnapshot.approvals) {
      invalidated.push({ ...step, status: '已失效', sourceClaimId: sourceSnapshot.id, invalidatedReason: `案件 ${sourceSnapshot.id} 并入主案，原会签失效待复核` })
    }

    const usedSourceItems = new Set<string>()

    for (const sourceItem of sourceSnapshot.lossItems) {
      const duplicate = merged.lossItems.find((target) => {
        if (target.category !== sourceItem.category) return false
        // 同大类还需描述或损失事实相似才算重复科目，避免把不同设备误合成一项
        return similarity(target.description, sourceItem.description) >= 0.12 || similarity(target.damage, sourceItem.damage) >= 0.12
      })
      if (duplicate) {
        // 重复科目合成一项：保留主案科目与报价版本，金额依据并列
        duplicate.mergedFrom = [...(duplicate.mergedFrom ?? []), { claimId: sourceSnapshot.id, itemId: sourceItem.id }]
        const basis: AmountBasis[] = duplicate.amountBasis ?? [
          {
            sourceClaimId: masterSnapshot.id,
            sourceItemId: duplicate.id,
            version: latestQuote(duplicate)?.version ?? 1,
            amount: latestQuote(duplicate)?.amount ?? 0,
            reason: latestQuote(duplicate)?.reason ?? '主案最新报价',
            operator: latestQuote(duplicate)?.operator ?? masterSnapshot.adjuster,
            createdAt: latestQuote(duplicate)?.createdAt ?? masterSnapshot.reportedAt,
          },
        ]
        const sourceQuote = latestQuote(sourceItem)
        if (sourceQuote) {
          basis.push({
            sourceClaimId: sourceSnapshot.id,
            sourceItemId: sourceItem.id,
            version: sourceQuote.version,
            amount: sourceQuote.amount,
            reason: sourceQuote.reason,
            operator: sourceQuote.operator,
            createdAt: sourceQuote.createdAt,
          })
        }
        duplicate.amountBasis = basis
        duplicate.disputed = duplicate.disputed || sourceItem.disputed
        duplicate.expertNotes = [
          ...duplicate.expertNotes,
          ...sourceItem.expertNotes.map((note) => `[来源 ${sourceSnapshot.id}] ${note}`),
          `[来源 ${sourceSnapshot.id}] ${sourceItem.damage}`,
        ]
        const existingFileIds = new Set(duplicate.attachments.map((file) => file.id))
        for (const file of sourceItem.attachments) {
          if (existingFileIds.has(file.id)) continue
          duplicate.attachments.push({ ...file, sourceClaimId: sourceSnapshot.id })
        }
      } else {
        // 非重复科目整体带入，保留来源引用与附件
        merged.lossItems.push({
          ...structuredClone(sourceItem),
          id: `${sourceItem.id}@${sourceSnapshot.id}`,
          sourceClaimId: sourceSnapshot.id,
          attachments: sourceItem.attachments.map((file) => ({ ...file, sourceClaimId: sourceSnapshot.id })),
        })
      }
      usedSourceItems.add(sourceItem.id)
    }

    // 重算准备金：合成科目只保留主案口径、计一次；非重复带入科目正常计入
    const newReserve = calcReserve(merged, merged.lossItems)
    const oldReserve = masterSnapshot.reserve

    // 以主案免赔与口径重算会签链，已通过步骤保留，其余按新准备金重新生成
    const passedByRole = new Map(merged.approvals.filter((step) => step.status === '已通过').map((step) => [step.role, step]))
    const rebuiltApprovals: ApprovalStep[] = APPROVAL_CHAIN.filter((level) => newReserve >= level.threshold || level.threshold === 0).map((level) => {
      const passed = passedByRole.get(level.role)
      return passed ? { ...passed } : { role: level.role, threshold: level.threshold, status: '待处理' as const }
    })

    merged.approvals = rebuiltApprovals
    merged.invalidatedApprovals = [...(merged.invalidatedApprovals ?? []), ...invalidated]
    merged.mergedFrom = [...new Set([...(masterSnapshot.mergedFrom ?? []), sourceSnapshot.id, ...(sourceSnapshot.mergedFrom ?? [])])]
    merged.sourceSnapshotId = sessionId
    merged.status = '待复核'
    merged.riskLevel = newReserve >= 1500000 || masterSnapshot.riskLevel === '高' || sourceSnapshot.riskLevel === '高' ? '高' : newReserve >= 500000 ? '中' : '低'
    merged.reserve = newReserve

    merged.audit.push(
      { id: nextId('A'), at: now(), operator, action: '并案合并', detail: `主案 ${masterSnapshot.id} 并入 ${sourceSnapshot.id}；重复科目合成一项并并列金额依据，非重复科目保留来源引用。` },
      { id: nextId('A'), at: now(), operator, action: '准备金重算', detail: `按主案免赔 ${merged.deductible.toLocaleString('zh-CN')} 元与合并后 ${merged.lossItems.length} 个科目重算：${oldReserve.toLocaleString('zh-CN')} → ${newReserve.toLocaleString('zh-CN')} 元。` },
      ...invalidated.map((step) => ({
        id: nextId('A'),
        at: now(),
        operator,
        action: '会签失效',
        detail: `[${step.sourceClaimId}] ${step.role} 原状态“${step.status === '已失效' ? '待处理' : step.status}”，并案后失效待复核。`,
      })),
    )

    const afterAttachmentCount = merged.lossItems.reduce((sum, item) => sum + item.attachments.length, 0)
    if (afterAttachmentCount < beforeAttachmentCount) {
      throw new Error(`附件核对不一致：合并前 ${beforeAttachmentCount} 份，合并后 ${afterAttachmentCount} 份`)
    }

    return merged
  }

  private commitMerge(masterId: string, sourceId: string, merged: ClaimCase) {
    // 仅在构建与附件核对全部成功后替换现场数据
    this.claims = this.claims.filter((claim) => claim.id !== sourceId).map((claim) => (claim.id === masterId ? merged : claim))
    this.persist()
  }

  private rollbackMerge(masterSnapshot: ClaimCase, sourceSnapshot: ClaimCase) {
    const hasMaster = this.claims.some((claim) => claim.id === masterSnapshot.id)
    const hasSource = this.claims.some((claim) => claim.id === sourceSnapshot.id)
    this.claims = this.claims.filter((claim) => claim.id !== masterSnapshot.id && claim.id !== sourceSnapshot.id)
    if (!hasMaster) this.claims.push(structuredClone(masterSnapshot))
    if (!hasSource) this.claims.push(structuredClone(sourceSnapshot))
    this.persist()
  }

  // ---------------- 撤销并案 ----------------

  undo(sessionId: string, operator: string): ConfirmOutcome {
    const session = this.requireSession(sessionId)
    if (session.status !== '已合并' || !session.masterSnapshot || !session.sourceSnapshot) {
      session.failureReason = '只有已生效的并案可以撤销'
      this.touch(session)
      throw new MergeError(this.board(session, 'failed'))
    }

    const master = structuredClone(session.masterSnapshot)
    const source = structuredClone(session.sourceSnapshot)
    master.audit.push({ id: nextId('A'), at: now(), operator, action: '撤销并案', detail: `主管撤销并案，按冻结快照恢复原案、旧会签与附件。` })
    source.audit.push({ id: nextId('A'), at: now(), operator, action: '撤销并案', detail: `并案撤销后恢复独立建档，原准备金 ${source.reserve.toLocaleString('zh-CN')} 元与会签链原样恢复。` })

    this.claims = this.claims.filter((claim) => claim.id !== master.id).concat([master, source])
    // 快照仍可复用，回到待确认态：主管可直接重新选主案确认，也可重新冻结
    session.status = '待确认'
    session.mergedClaimId = undefined
    session.operator = operator
    for (const conflict of session.conflicts) {
      if (!conflict.resolved) {
        conflict.resolved = true
        conflict.resolution = '并案已撤销，双方分歧随原案恢复，可重新发起并案。'
      }
    }
    session.history.push(this.entry('撤销并案', operator, `已按快照恢复 ${master.id} 与 ${source.id}：旧会签重新生效，附件经核对无丢失；未决分歧一并关闭，候选重新开放。`))
    this.touch(session)
    return this.board(session, 'merged')
  }

  // ---------------- 分歧处理 ----------------

  resolveConflict(sessionId: string, operator: string, resolution: '接受主案' | '维持分歧'): ConfirmOutcome {
    const session = this.requireSession(sessionId)
    const open = session.conflicts.filter((conflict) => !conflict.resolved)
    if (!open.length) {
      session.failureReason = '该会话没有未决分歧'
      this.touch(session)
      throw new MergeError(this.board(session, 'failed'))
    }
    for (const conflict of open) {
      conflict.resolved = true
      conflict.resolution = resolution === '接受主案' ? `后到者 ${conflict.loserOperator} 接受先生效主案 ${session.masterId}。` : `后到者 ${conflict.loserOperator} 维持原选择 ${conflict.loserChoice}，登记为主案复核分歧，转主管复核。`
    }
    session.history.push(
      this.entry(
        '分歧处理',
        operator,
        resolution === '接受主案'
          ? `后到确认者接受主案 ${session.masterId}，分歧关闭。`
          : `后到确认者维持分歧（选择 ${open[0].loserChoice}），已挂入主案 ${session.masterId} 的复核队列。`,
      ),
    )
    this.touch(session)
    return this.board(session, 'merged')
  }

  discard(sessionId: string, operator: string): ConfirmOutcome {
    const session = this.requireSession(sessionId)
    if (session.status === '已合并') {
      session.failureReason = '已生效并案不能直接放弃，请先撤销'
      this.touch(session)
      throw new MergeError(this.board(session, 'failed'))
    }
    session.status = '已撤销'
    session.discarded = true
    session.history.push(this.entry('候选生成', operator, '主管判定两案不属于同一起事故，候选关闭（保留记录备查）。'))
    this.touch(session)
    const blank = this.requireSession(sessionId)
    return this.board(blank, 'merged')
  }

  private requireSession(sessionId: string): MergeSession {
    const session = this.sessions.find((item) => item.id === sessionId)
    if (!session) throw new Error(`并案会话不存在：${sessionId}`)
    return session
  }

  private touch(session: MergeSession) {
    session.updatedAt = now()
    this.persist()
  }
}

export const mergeEngine = new MergeEngine()
