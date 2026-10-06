import type { ClaimCase, LossItem } from './models'

/**
 * 并案领域逻辑：候选识别、预览、执行与回滚。
 * 全部为纯函数，不依赖框架，便于在拦截器与组件间复用。
 */

export type MergeSignalType = '事故日' | '地址' | '保单' | '被保险人' | '证据'
export type MergeSignal = { type: MergeSignalType; detail: string }

export type MergeCandidate = {
  id: string
  caseAId: string
  caseBId: string
  signals: MergeSignal[]
  score: number
  status: '待处理' | '已合并' | '已忽略'
  detectedAt: string
}

export type MergeConflict = {
  id: string
  type: '金额' | '科目' | '准备金' | '会签' | '附件'
  description: string
  mainValue: string
  mergedValue: string
  status: '未决' | '已决'
  resolution?: '主案优先' | '并入保留' | '待人工'
}

export type FrozenSnapshot = {
  caseId: string
  frozenAt: string
  data: ClaimCase
}

export type MergeRecord = {
  id: string
  candidateId: string
  mainCaseId: string
  mergedCaseId: string
  status: '进行中' | '已完成' | '已回滚' | '冲突待决'
  /** 冻结快照按案件编号索引，主案切换时无需重新冻结 */
  frozenSnapshots: Record<string, FrozenSnapshot>
  conflicts: MergeConflict[]
  operator: string
  startedAt: string
  completedAt?: string
  version: number
}

export type ItemMatch = {
  mainItem?: LossItem
  mergedItem?: LossItem
  match: '重复' | '主案独有' | '并案独有'
}

export type MergePreview = {
  main: ClaimCase
  merged: ClaimCase
  items: ItemMatch[]
  reserveBasis: { main: number; merged: number; recomputed: number }
  approvalCount: { main: number; merged: number }
  attachmentCount: { main: number; merged: number; afterMerge: number }
  conflicts: MergeConflict[]
}

/** 归一化：去空白，便于地址/保单比对。 */
export function norm(value: string): string {
  return value.replace(/\s+/g, '').trim()
}

function addressSimilar(a: string, b: string): boolean {
  const na = norm(a)
  const nb = norm(b)
  if (na === nb) return true
  // 模糊匹配：一方地址是另一方的核心片段
  return na.length >= 6 && nb.length >= 6 && (na.includes(nb) || nb.includes(na))
}

function evidenceMatches(a: ClaimCase, b: ClaimCase): boolean {
  const namesA = a.lossItems.flatMap((item) => item.attachments.map((file) => file.name))
  const namesB = b.lossItems.flatMap((item) => item.attachments.map((file) => file.name))
  return namesA.some((name) => namesB.includes(name))
}

/** 按事故日、地址、保单、被保险人、证据识别候选，信号数 >= 2 才入列。 */
export function detectCandidates(claims: ClaimCase[]): MergeCandidate[] {
  const active = claims.filter((item) => !item.mergedInto)
  const out: MergeCandidate[] = []
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]
      const b = active[j]
      const signals: MergeSignal[] = []
      if (a.accidentDate === b.accidentDate) {
        signals.push({ type: '事故日', detail: `事故日均为 ${a.accidentDate}` })
      }
      if (addressSimilar(a.lossAddress, b.lossAddress)) {
        signals.push({ type: '地址', detail: `${a.lossAddress} ↔ ${b.lossAddress}` })
      }
      if (norm(a.policyNo) === norm(b.policyNo)) {
        signals.push({ type: '保单', detail: `保单号均为 ${a.policyNo}` })
      }
      if (norm(a.insured) === norm(b.insured)) {
        signals.push({ type: '被保险人', detail: `被保险人均为 ${a.insured}` })
      }
      if (evidenceMatches(a, b)) {
        signals.push({ type: '证据', detail: '存在同名附件证据' })
      }
      if (signals.length >= 2) {
        out.push({
          id: `MC-${a.id}-${b.id}`,
          caseAId: a.id,
          caseBId: b.id,
          signals,
          score: signals.length,
          status: '待处理',
          detectedAt: new Date().toLocaleString('zh-CN'),
        })
      }
    }
  }
  return out
}

function itemKey(item: LossItem): string {
  return `${norm(item.category)}|${norm(item.description)}`
}

function findMatch(main: ClaimCase, merged: ClaimCase): ItemMatch[] {
  const result: ItemMatch[] = []
  const used = new Set<string>()
  for (const mainItem of main.lossItems) {
    const key = itemKey(mainItem)
    const mergedItem = merged.lossItems.find((candidate) => !used.has(candidate.id) && itemKey(candidate) === key)
    if (mergedItem) {
      used.add(mergedItem.id)
      result.push({ mainItem, mergedItem, match: '重复' })
    } else {
      result.push({ mainItem, match: '主案独有' })
    }
  }
  for (const mergedItem of merged.lossItems) {
    if (!used.has(mergedItem.id)) result.push({ mergedItem, match: '并案独有' })
  }
  return result
}

function latestQuote(item: LossItem): number {
  return item.repairQuotes.at(-1)?.amount ?? 0
}

/** 按主案参数重算准备金：(最新报价 - 残值) * 责任比例 - 免赔。 */
export function recomputeReserve(claim: ClaimCase): number {
  const net = claim.lossItems.reduce((sum, item) => sum + Math.max(0, latestQuote(item) - item.salvage) * item.liability, 0)
  return Math.max(0, Math.round(net - claim.deductible))
}

function countAttachments(claim: ClaimCase): number {
  return claim.lossItems.reduce((sum, item) => sum + item.attachments.length, 0)
}

/** 生成并案预览：科目匹配、金额依据、准备金重算、会签失效与冲突清单。 */
export function buildPreview(main: ClaimCase, merged: ClaimCase): MergePreview {
  const items = findMatch(main, merged)
  const conflicts: MergeConflict[] = []
  for (const row of items) {
    if (row.match === '重复' && row.mainItem && row.mergedItem) {
      const mainAmount = latestQuote(row.mainItem)
      const mergedAmount = latestQuote(row.mergedItem)
      if (mainAmount !== mergedAmount) {
        conflicts.push({
          id: `CF-${row.mainItem.id}-金额`,
          type: '金额',
          description: `${row.mainItem.category} 报价金额不一致`,
          mainValue: String(mainAmount),
          mergedValue: String(mergedAmount),
          status: '未决',
        })
      }
      if (row.mainItem.salvage !== row.mergedItem.salvage || row.mainItem.liability !== row.mergedItem.liability) {
        conflicts.push({
          id: `CF-${row.mainItem.id}-条件`,
          type: '科目',
          description: `${row.mainItem.category} 残值/责任比例不一致`,
          mainValue: `残值 ${row.mainItem.salvage} / 责任 ${row.mainItem.liability}`,
          mergedValue: `残值 ${row.mergedItem.salvage} / 责任 ${row.mergedItem.liability}`,
          status: '未决',
        })
      }
    }
  }
  const recomputed = recomputeReserve({ ...main, lossItems: mergeItems(main, merged) })
  if (main.reserve !== merged.reserve) {
    conflicts.push({
      id: 'CF-reserve',
      type: '准备金',
      description: '两案准备金不一致，将按主案重算',
      mainValue: String(main.reserve),
      mergedValue: String(merged.reserve),
      status: '未决',
    })
  }
  const afterMerge = countAttachments(main) + countAttachments(merged)
  return {
    main,
    merged,
    items,
    reserveBasis: { main: main.reserve, merged: merged.reserve, recomputed },
    approvalCount: {
      main: main.approvals.filter((step) => step.status === '待处理').length,
      merged: merged.approvals.filter((step) => step.status === '待处理').length,
    },
    attachmentCount: { main: countAttachments(main), merged: countAttachments(merged), afterMerge },
    conflicts,
  }
}

/** 合并损失科目：重复项并入主案科目（金额并列、附件 union），独有项追加。 */
function mergeItems(main: ClaimCase, merged: ClaimCase): LossItem[] {
  const result: LossItem[] = structuredClone(main.lossItems)
  const rows = findMatch(main, merged)
  for (const row of rows) {
    if (row.match === '重复' && row.mainItem && row.mergedItem) {
      const target = result.find((item) => item.id === row.mainItem!.id)!
      const mergedItem = row.mergedItem
      target.amountBasis = { main: latestQuote(target), merged: latestQuote(mergedItem) }
      target.sourceCaseIds = [...new Set([...(target.sourceCaseIds ?? []), merged.id])]
      for (const file of mergedItem.attachments) {
        if (!target.attachments.some((existing) => existing.id === file.id)) target.attachments.push(file)
      }
      for (const note of mergedItem.expertNotes) {
        if (!target.expertNotes.includes(note)) target.expertNotes.push(note)
      }
    } else if (row.match === '并案独有' && row.mergedItem) {
      const clone = structuredClone(row.mergedItem)
      clone.sourceCaseId = merged.id
      result.push(clone)
    }
  }
  return result
}

/** 执行并案：冻结快照后调用；返回新的主案与被并案（含冲突）。 */
export function executeMerge(main: ClaimCase, merged: ClaimCase): { main: ClaimCase; merged: ClaimCase; conflicts: MergeConflict[] } {
  const nextMain: ClaimCase = structuredClone(main)
  const nextMerged: ClaimCase = structuredClone(merged)
  const rows = findMatch(nextMain, nextMerged)
  const conflicts: MergeConflict[] = []

  nextMain.sourceOf = [...(nextMain.sourceOf ?? []), merged.id]

  for (const row of rows) {
    if (row.match === '重复' && row.mainItem && row.mergedItem) {
      const target = nextMain.lossItems.find((item) => item.id === row.mainItem!.id)!
      const mergedItem = row.mergedItem
      target.amountBasis = { main: latestQuote(target), merged: latestQuote(mergedItem) }
      if (latestQuote(target) !== latestQuote(mergedItem)) {
        conflicts.push({
          id: `CF-${target.id}-金额`,
          type: '金额',
          description: `${target.category} 报价金额不一致`,
          mainValue: String(latestQuote(target)),
          mergedValue: String(latestQuote(mergedItem)),
          status: '未决',
        })
      }
      if (target.salvage !== mergedItem.salvage || target.liability !== mergedItem.liability) {
        conflicts.push({
          id: `CF-${target.id}-条件`,
          type: '科目',
          description: `${target.category} 残值/责任比例不一致`,
          mainValue: `残值 ${target.salvage} / 责任 ${target.liability}`,
          mergedValue: `残值 ${mergedItem.salvage} / 责任 ${mergedItem.liability}`,
          status: '未决',
        })
      }
      target.sourceCaseIds = [...new Set([...(target.sourceCaseIds ?? []), merged.id])]
      for (const file of mergedItem.attachments) {
        if (!target.attachments.some((existing) => existing.id === file.id)) target.attachments.push(file)
      }
      for (const note of mergedItem.expertNotes) {
        if (!target.expertNotes.includes(note)) target.expertNotes.push(note)
      }
    } else if (row.match === '并案独有' && row.mergedItem) {
      const clone = structuredClone(row.mergedItem)
      clone.sourceCaseId = merged.id
      nextMain.lossItems.push(clone)
    }
  }

  // 重复准备金按主案重算
  const mergedReserve = nextMerged.reserve
  nextMain.reserveBasis = { main: nextMain.reserve, merged: mergedReserve }
  nextMain.reserve = recomputeReserve(nextMain)
  if (nextMain.reserveBasis.main !== mergedReserve) {
    conflicts.push({
      id: 'CF-reserve',
      type: '准备金',
      description: '两案准备金不一致，已按主案重算',
      mainValue: String(nextMain.reserveBasis.main),
      mergedValue: String(mergedReserve),
      status: '未决',
    })
  }

  // 原会签失效待复核
  nextMain.approvals = nextMain.approvals.map((step) => ({ role: step.role, threshold: step.threshold, status: '待处理' as const }))
  nextMain.status = '待复核'
  nextMain.audit.push({
    id: `A-MERGE-${Date.now()}`,
    at: '刚刚',
    operator: '当前用户',
    action: '并案完成',
    detail: `已并入 ${merged.id}（${merged.policyNo} / ${merged.insured}），来源引用已保留；重复科目已合并、金额并列；原会签失效待复核。`,
  })

  nextMerged.mergedInto = nextMain.id
  nextMerged.status = '已结案'
  nextMerged.audit.push({
    id: `A-MERGE-OUT-${Date.now()}`,
    at: '刚刚',
    operator: '当前用户',
    action: '已并入主案',
    detail: `本案已并入 ${nextMain.id}，科目与附件已随案移交，来源引用保留。`,
  })

  return { main: nextMain, merged: nextMerged, conflicts }
}

/** 回滚：用冻结快照恢复两案，原会签与附件一并还原。 */
export function rollbackMerge(record: MergeRecord, claims: ClaimCase[]): ClaimCase[] {
  return claims.map((item) => {
    const snapshot = record.frozenSnapshots[item.id]
    return snapshot ? structuredClone(snapshot.data) : item
  })
}
