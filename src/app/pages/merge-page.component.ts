import { Component, OnInit } from '@angular/core'
import { CommonModule, CurrencyPipe } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Router } from '@angular/router'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatChipsModule } from '@angular/material/chips'
import { MatExpansionModule } from '@angular/material/expansion'
import { MatIconModule } from '@angular/material/icon'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { MatRadioModule } from '@angular/material/radio'
import { MatSnackBar } from '@angular/material/snack-bar'
import { Store } from '@ngrx/store'
import type { Observable } from 'rxjs'
import { ClaimsService } from '../core/claims.service'
import { selectClaim, upsertClaims, type AppState } from '../core/claims.store'
import {
  clearMergeConflict,
  ignoreCandidateSuccess,
  loadMergeStateSuccess,
  mergeConflict,
  mergeConfirmSuccess,
  mergeRollbackSuccess,
  resolveConflictSuccess,
  selectActivePreview,
  selectActiveRecord,
  selectMergeCandidates,
  selectMergeConflictError,
  selectMergeRecords,
  setMergeBusy,
  startMergeSuccess,
} from '../core/merge.store'
import type { MergeCandidate, MergePreview, MergeRecord } from '../core/merge'
import { StatusChipComponent } from '../shared/status-chip.component'

@Component({
  selector: 'app-merge-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CurrencyPipe,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatExpansionModule,
    MatIconModule,
    MatProgressBarModule,
    MatRadioModule,
    StatusChipComponent,
  ],
  template: `
    <section class="page">
      <div class="page-head">
        <div>
          <p class="eyebrow">MERGE CASES / 并案处理</p>
          <h1>重复建档并案</h1>
          <p class="muted">按事故日、地址、保单、被保险人与证据识别重复案件；冻结快照后选主案、合科目、并列金额、重算准备金，原会签失效待复核。</p>
        </div>
        <div class="actions">
          <button mat-stroked-button (click)="load()"><mat-icon>refresh</mat-icon> 刷新候选</button>
        </div>
      </div>

      <mat-card *ngIf="conflictError$ | async as conflictError" class="conflict-banner" appearance="outlined">
        <mat-icon>bolt</mat-icon>
        <div class="conflict-body">
          <strong>并案冲突：先到者已生效</strong>
          <p>{{ conflictError }}</p>
          <button mat-stroked-button color="primary" (click)="viewMain()">查看主案</button>
        </div>
        <button mat-icon-button (click)="clearConflict()"><mat-icon>close</mat-icon></button>
      </mat-card>

      <mat-progress-bar *ngIf="busy$ | async" mode="indeterminate"></mat-progress-bar>

      <div class="merge-grid">
        <div class="main-col">
          <section class="panel">
            <div class="panel-head">
              <h3>并案候选</h3>
              <span class="muted">{{ (candidates$ | async)?.length }} 组 · 信号数 ≥ 2 入列</span>
            </div>
            <div class="candidate-list">
              <mat-expansion-panel *ngFor="let candidate of candidates$ | async" [disabled]="candidate.status !== '待处理'">
                <mat-expansion-panel-header>
                  <mat-panel-title>
                    <strong>{{ candidate.caseAId }}</strong>
                    <mat-icon class="dup-icon">content_copy</mat-icon>
                    <strong>{{ candidate.caseBId }}</strong>
                  </mat-panel-title>
                  <mat-panel-description>
                    <mat-chip-set>
                      <mat-chip *ngFor="let signal of candidate.signals" [class]="'sig sig-' + signal.type">{{ signal.type }}</mat-chip>
                    </mat-chip-set>
                    <app-status-chip [label]="candidate.status" [tone]="candidate.status === '待处理' ? 'warn' : candidate.status === '已合并' ? 'good' : 'default'" />
                  </mat-panel-description>
                </mat-expansion-panel-header>

                <div class="candidate-body">
                  <ul class="signal-list">
                    <li *ngFor="let signal of candidate.signals"><mat-icon>check_circle</mat-icon> {{ signal.detail }}</li>
                  </ul>
                  <div class="candidate-actions" *ngIf="candidate.status === '待处理'">
                    <button mat-flat-button color="primary" (click)="start(candidate)"><mat-icon>merge</mat-icon> 开始并案</button>
                    <button mat-stroked-button (click)="ignore(candidate)">忽略</button>
                  </div>
                  <p class="muted detected">识别于 {{ candidate.detectedAt }}</p>
                </div>
              </mat-expansion-panel>
              <p *ngIf="(candidates$ | async)?.length === 0" class="empty">暂无重复建档候选。</p>
            </div>
          </section>

          <ng-container *ngIf="activeRecord$ | async as record">
            <section class="panel workspace" *ngIf="record.status === '进行中'">
              <div class="panel-head">
                <h3>并案工作台 · 冻结快照</h3>
                <span class="muted">版本 v{{ record.version }} · 先到者生效</span>
              </div>

              <div class="case-pick">
                <p>选择主案（两案快照已冻结，可随时切换；被并案附件与科目随案移交）：</p>
                <mat-radio-group [ngModel]="record.mainCaseId" (ngModelChange)="switchMain(record, $event)">
                  <mat-radio-button *ngFor="let snap of snapshotList(record)" [value]="snap.caseId">
                    {{ snap.caseId }} · {{ snap.data.insured }} · {{ snap.data.policyNo }}
                  </mat-radio-button>
                </mat-radio-group>
              </div>

              <ng-container *ngIf="activePreview$ | async as preview">
                <div class="case-compare">
                  <mat-card appearance="outlined" class="picked">
                    <span>主案</span>
                    <strong>{{ preview.main.id }}</strong>
                    <small>{{ preview.main.policyNo }} · {{ preview.main.insured }}</small>
                    <small>{{ preview.main.lossAddress }}</small>
                  </mat-card>
                  <mat-icon class="compare-arrow">arrow_forward</mat-icon>
                  <mat-card appearance="outlined" class="merged-card">
                    <span>被并案</span>
                    <strong>{{ preview.merged.id }}</strong>
                    <small>{{ preview.merged.policyNo }} · {{ preview.merged.insured }}</small>
                    <small>{{ preview.merged.lossAddress }}</small>
                  </mat-card>
                </div>

                <div class="preview-section">
                  <h4>科目匹配与金额依据</h4>
                  <div class="item-match">
                    <div *ngFor="let row of preview.items" class="match-row" [class.dup]="row.match === '重复'">
                      <mat-icon>{{ row.match === '重复' ? 'link' : row.match === '主案独有' ? 'remove' : 'add' }}</mat-icon>
                      <div class="match-info">
                        <strong>{{ (row.mainItem ?? row.mergedItem)?.category }}</strong>
                        <span>{{ (row.mainItem ?? row.mergedItem)?.description }}</span>
                      </div>
                      <span class="match-tag" [class]="'tag-' + row.match">{{ row.match }}</span>
                      <div class="amount-basis" *ngIf="row.match === '重复' && row.mainItem && row.mergedItem">
                        <div><small>主案金额</small><strong>{{ latest(row.mainItem) | currency:'CNY':'symbol':'1.0-0' }}</strong></div>
                        <div><small>并案金额</small><strong>{{ latest(row.mergedItem) | currency:'CNY':'symbol':'1.0-0' }}</strong></div>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="preview-grid">
                  <div class="preview-block">
                    <h4>附件（只增不丢）</h4>
                    <p>主案 {{ preview.attachmentCount.main }} 件 + 并案 {{ preview.attachmentCount.merged }} 件 → 合并后 <strong>{{ preview.attachmentCount.afterMerge }}</strong> 件，去重保留。</p>
                  </div>
                  <div class="preview-block">
                    <h4>准备金（按主案重算）</h4>
                    <p>主案 {{ preview.reserveBasis.main | currency:'CNY':'symbol':'1.0-0' }} + 并案 {{ preview.reserveBasis.merged | currency:'CNY':'symbol':'1.0-0' }}</p>
                    <p class="recompute">重算后 <strong>{{ preview.reserveBasis.recomputed | currency:'CNY':'symbol':'1.0-0' }}</strong></p>
                  </div>
                  <div class="preview-block warn-block">
                    <h4>会签（失效待复核）</h4>
                    <p>原会签步骤全部失效，案件回到 <strong>待复核</strong>，由复核岗重新多级会签。</p>
                  </div>
                </div>

                <div class="preview-section" *ngIf="preview.conflicts.length">
                  <h4>未决冲突（{{ preview.conflicts.length }}）</h4>
                  <ul class="conflict-list">
                    <li *ngFor="let conflict of preview.conflicts">
                      <app-status-chip label="未决" tone="warn" />
                      <strong>{{ conflict.type }}</strong>
                      <span>{{ conflict.description }}</span>
                      <small>主案 {{ conflict.mainValue }} ↔ 并案 {{ conflict.mergedValue }}</small>
                    </li>
                  </ul>
                </div>

                <div class="workspace-actions">
                  <button mat-flat-button color="primary" [disabled]="busy$ | async" (click)="confirm(record)"><mat-icon>check_circle</mat-icon> 确认并案（先到者生效）</button>
                  <button mat-stroked-button color="warn" [disabled]="busy$ | async" (click)="rollback(record)"><mat-icon>undo</mat-icon> 取消并案 / 回滚原案</button>
                </div>
              </ng-container>
            </section>

            <section class="panel workspace" *ngIf="record.status === '已完成' || record.status === '已回滚'">
              <div class="panel-head">
                <h3>并案记录 · {{ record.status }}</h3>
                <span class="muted">{{ record.completedAt }}</span>
              </div>
              <div class="done-body">
                <p *ngIf="record.status === '已完成'">
                  <mat-icon class="ok">check_circle</mat-icon>
                  主案 <strong>{{ record.mainCaseId }}</strong> 已并入 <strong>{{ record.mergedCaseId }}</strong>，来源引用保留于主案审计与科目标记中。
                </p>
                <p *ngIf="record.status === '已回滚'">
                  <mat-icon class="rollback">undo</mat-icon>
                  已按冻结快照恢复两案，原会签与附件还原，未丢失附件。
                </p>

                <div class="preview-section" *ngIf="record.conflicts.length">
                  <h4>未决冲突（{{ unresolvedCount(record) }}）</h4>
                  <ul class="conflict-list">
                    <li *ngFor="let conflict of record.conflicts">
                      <app-status-chip [label]="conflict.status" [tone]="conflict.status === '未决' ? 'warn' : 'good'" />
                      <strong>{{ conflict.type }}</strong>
                      <span>{{ conflict.description }}</span>
                      <small>主案 {{ conflict.mainValue }} ↔ 并案 {{ conflict.mergedValue }}</small>
                      <span class="resolution" *ngIf="conflict.resolution">处理：{{ conflict.resolution }}</span>
                      <button *ngIf="conflict.status === '未决'" mat-stroked-button (click)="resolve(record, conflict.id, '主案优先')">主案优先</button>
                      <button *ngIf="conflict.status === '未决'" mat-stroked-button (click)="resolve(record, conflict.id, '并入保留')">并入保留</button>
                    </li>
                  </ul>
                </div>

                <div class="workspace-actions">
                  <button mat-stroked-button color="primary" (click)="viewRecordMain(record)"><mat-icon>visibility</mat-icon> 查看主案</button>
                </div>
              </div>
            </section>
          </ng-container>
        </div>

        <aside class="side-col">
          <section class="panel">
            <div class="panel-head"><h3>处理记录</h3><span class="muted">{{ (records$ | async)?.length }} 条</span></div>
            <div class="record-list">
              <div *ngFor="let record of records$ | async" class="record-row" [class.active]="record.id === (activeRecord$ | async)?.id">
                <div class="record-top">
                  <strong>{{ record.mainCaseId }}</strong>
                  <mat-icon>merge</mat-icon>
                  <strong>{{ record.mergedCaseId }}</strong>
                </div>
                <div class="record-meta">
                  <app-status-chip [label]="record.status" [tone]="record.status === '已完成' ? 'good' : record.status === '已回滚' ? 'default' : 'warn'" />
                  <span class="muted">v{{ record.version }} · {{ record.operator }}</span>
                </div>
                <small class="muted">{{ record.startedAt }}</small>
              </div>
              <p *ngIf="(records$ | async)?.length === 0" class="empty">暂无并案处理记录。</p>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head"><h3>未决冲突</h3><span class="muted">重开页面后仍保留</span></div>
            <div class="unresolved">
              <div *ngFor="let item of unresolved$ | async" class="unresolved-row">
                <mat-icon>warning_amber</mat-icon>
                <div><strong>{{ item.type }}</strong><span>{{ item.description }}</span></div>
              </div>
              <p *ngIf="(unresolved$ | async)?.length === 0" class="empty">无未决冲突。</p>
            </div>
          </section>
        </aside>
      </div>
    </section>
  `,
  styles: [`
    .conflict-banner { display: flex; align-items: center; gap: 12px; padding: 14px 16px; margin-bottom: 14px; border-color: #ce743e; background: #fff7f0; }
    .conflict-banner > mat-icon { color: #b55a2e; font-size: 26px; width: 26px; height: 26px; }
    .conflict-body { flex: 1; }
    .conflict-body strong { color: #984313; }
    .conflict-body p { margin: 4px 0 8px; color: #6d5c52; font-size: 12px; }
    .merge-grid { display: grid; grid-template-columns: minmax(0,1fr) 340px; gap: 14px; align-items: start; }
    .panel { margin-bottom: 14px; }
    .candidate-list { padding: 8px 12px 12px; }
    .candidate-body { padding: 8px 4px 4px; }
    .signal-list { margin: 0 0 12px; padding: 0; list-style: none; }
    .signal-list li { display: flex; align-items: center; gap: 6px; padding: 5px 0; color: #4f626d; font-size: 12px; }
    .signal-list mat-icon { font-size: 16px; width: 16px; height: 16px; color: #2f8191; }
    .candidate-actions { display: flex; gap: 8px; }
    .detected { margin: 10px 0 0; font-size: 10px; }
    .dup-icon { font-size: 16px; width: 16px; height: 16px; color: #2f8191; }
    mat-panel-title { display: flex; align-items: center; gap: 6px; }
    mat-panel-description { align-items: center; gap: 10px; }
    .sig { font-size: 10px; }
    .sig-事故日 { background: #eaf4f5; color: #175866; }
    .sig-地址 { background: #fff0e4; color: #984313; }
    .sig-保单 { background: #e7f5ed; color: #246d55; }
    .sig-被保险人 { background: #f0eaf5; color: #5a3d7a; }
    .sig-证据 { background: #f5f0e4; color: #7a6a2d; }
    .workspace { padding-bottom: 8px; }
    .case-pick { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; }
    .case-pick mat-radio-group { display: flex; flex-direction: column; gap: 8px; }
    .case-compare { display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
    .case-compare mat-card { flex: 1; padding: 12px; }
    .case-compare span { color: #6c7a84; font-size: 11px; }
    .case-compare strong { display: block; margin: 3px 0; color: #153747; }
    .case-compare small { display: block; color: #7b8790; font-size: 10px; }
    .case-compare .picked { border-color: #2f8191; background: #f0f8f8; }
    .case-compare .merged-card { border-color: #ce743e; }
    .compare-arrow { color: #2f8191; }
    .preview-section { padding: 8px 16px 14px; }
    .preview-section h4 { margin: 6px 0 10px; font-size: 13px; }
    .item-match { display: flex; flex-direction: column; gap: 6px; }
    .match-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: #f5f8f9; border-radius: 6px; }
    .match-row.dup { background: #eaf4f5; }
    .match-row > mat-icon { color: #2f8191; font-size: 18px; width: 18px; height: 18px; }
    .match-info { flex: 1; display: flex; flex-direction: column; }
    .match-info strong { font-size: 12px; }
    .match-info span { color: #7b8790; font-size: 10px; }
    .match-tag { padding: 2px 8px; border-radius: 10px; font-size: 10px; }
    .tag-重复 { background: #d8ecef; color: #175866; }
    .tag-主案独有 { background: #edf1f2; color: #6c7a84; }
    .tag-并案独有 { background: #fff0e4; color: #984313; }
    .amount-basis { display: flex; gap: 14px; }
    .amount-basis > div { display: flex; flex-direction: column; align-items: flex-end; }
    .amount-basis small { color: #7b8790; font-size: 9px; }
    .amount-basis strong { color: #153747; font-size: 13px; }
    .preview-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding: 0 16px 14px; }
    .preview-block { padding: 10px 12px; background: #f5f8f9; border-radius: 6px; }
    .preview-block h4 { margin: 0 0 6px; font-size: 12px; }
    .preview-block p { margin: 4px 0; color: #5f6d76; font-size: 11px; line-height: 1.5; }
    .preview-block .recompute strong { color: #b95c2c; font-size: 14px; }
    .warn-block { background: #fff7f0; }
    .warn-block h4 { color: #984313; }
    .conflict-list { margin: 0; padding: 0; list-style: none; }
    .conflict-list li { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 0; border-bottom: 1px solid #edf0f2; font-size: 12px; }
    .conflict-list strong { color: #984313; }
    .conflict-list span { color: #4f626d; }
    .conflict-list small { width: 100%; color: #7b8790; font-size: 10px; }
    .conflict-list .resolution { color: #246d55; font-size: 11px; }
    .workspace-actions { display: flex; gap: 8px; padding: 4px 16px 16px; }
    .done-body { padding: 8px 4px 4px; }
    .done-body > p { display: flex; align-items: center; gap: 8px; padding: 0 16px; font-size: 12px; }
    .done-body .ok { color: #246d55; }
    .done-body .rollback { color: #b55a2e; }
    .record-list { padding: 8px 12px 12px; }
    .record-row { padding: 10px; border-bottom: 1px solid #edf0f2; }
    .record-row.active { background: #f0f8f8; }
    .record-top { display: flex; align-items: center; gap: 6px; font-size: 12px; }
    .record-top mat-icon { font-size: 16px; width: 16px; height: 16px; color: #2f8191; }
    .record-meta { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
    .record-meta .muted { font-size: 10px; }
    .unresolved { padding: 8px 12px 12px; }
    .unresolved-row { display: flex; gap: 8px; padding: 8px 0; border-bottom: 1px solid #edf0f2; }
    .unresolved-row > mat-icon { color: #b55a2e; font-size: 18px; width: 18px; height: 18px; }
    .unresolved-row strong { display: block; font-size: 11px; color: #984313; }
    .unresolved-row span { color: #5f6d76; font-size: 11px; }
    .empty { padding: 16px; color: #8b969d; font-size: 12px; text-align: center; }
    @media (max-width: 1050px) { .merge-grid { grid-template-columns: 1fr; } .preview-grid { grid-template-columns: 1fr; } }
  `],
})
export class MergePageComponent implements OnInit {
  candidates$: Observable<MergeCandidate[]>
  records$: Observable<MergeRecord[]>
  activeRecord$: Observable<MergeRecord | null>
  activePreview$: Observable<MergePreview | null>
  conflictError$: Observable<string>
  busy$: Observable<boolean>
  unresolved$: Observable<Array<{ type: string; description: string }>>
  private records: MergeRecord[] = []

  constructor(
    private readonly store: Store<AppState>,
    private readonly service: ClaimsService,
    private readonly router: Router,
    private readonly snackBar: MatSnackBar,
  ) {
    this.candidates$ = this.store.select(selectMergeCandidates)
    this.records$ = this.store.select(selectMergeRecords)
    this.activeRecord$ = this.store.select(selectActiveRecord)
    this.activePreview$ = this.store.select(selectActivePreview)
    this.conflictError$ = this.store.select(selectMergeConflictError)
    this.busy$ = this.store.select((state) => state.merge.busy)
    this.unresolved$ = this.store.select((state) =>
      state.merge.records.flatMap((record) =>
        record.conflicts.filter((conflict) => conflict.status === '未决').map((conflict) => ({ type: conflict.type, description: conflict.description })),
      ),
    )
  }

  ngOnInit() {
    this.load()
    this.records$.subscribe((records) => (this.records = records))
  }

  load() {
    this.service.mergeState().subscribe((state) => {
      this.store.dispatch(loadMergeStateSuccess({ candidates: state.candidates, records: state.records }))
    })
  }

  latest(item: { repairQuotes: Array<{ amount: number }> }) {
    return item.repairQuotes.at(-1)?.amount ?? 0
  }

  snapshotList(record: MergeRecord) {
    return Object.values(record.frozenSnapshots)
  }

  start(candidate: MergeCandidate) {
    this.service.startMerge(candidate.id, candidate.caseAId).subscribe((result) => {
      this.store.dispatch(startMergeSuccess({ record: result.record, preview: result.preview }))
    })
  }

  switchMain(record: MergeRecord, mainCaseId: string) {
    if (mainCaseId === record.mainCaseId) return
    this.service.switchMain(record.id, mainCaseId).subscribe((result) => {
      this.store.dispatch(startMergeSuccess({ record: result.record, preview: result.preview }))
    })
  }

  confirm(record: MergeRecord) {
    this.store.dispatch(setMergeBusy({ busy: true }))
    this.service.confirmMerge(record.id).subscribe({
      next: (result) => {
        this.store.dispatch(mergeConfirmSuccess({ mainCase: result.mainCase, mergedCase: result.mergedCase, record: result.record }))
        this.store.dispatch(upsertClaims({ cases: [result.mainCase, result.mergedCase] }))
        this.snackBar.open('并案完成：重复科目已合并，准备金按主案重算，原会签失效待复核', '关闭', { duration: 2600 })
      },
      error: (err) => {
        const body = err?.error ?? {}
        this.store.dispatch(mergeConflict({ message: body.message ?? '并案冲突', record: body.record ?? record }))
        this.snackBar.open('并案未生效：已被先到者确认', '关闭', { duration: 2600 })
      },
    })
  }

  rollback(record: MergeRecord) {
    this.store.dispatch(setMergeBusy({ busy: true }))
    this.service.rollbackMerge(record.id).subscribe({
      next: (result) => {
        this.store.dispatch(mergeRollbackSuccess({ mainCase: result.mainCase, mergedCase: result.mergedCase, record: result.record }))
        this.store.dispatch(upsertClaims({ cases: [result.mainCase, result.mergedCase] }))
        this.snackBar.open('已回滚：按冻结快照恢复原案与旧会签，附件未丢失', '关闭', { duration: 2600 })
      },
      error: () => this.store.dispatch(setMergeBusy({ busy: false })),
    })
  }

  ignore(candidate: MergeCandidate) {
    this.service.ignoreCandidate(candidate.id).subscribe((result) => {
      this.store.dispatch(ignoreCandidateSuccess({ candidate: result.candidate }))
    })
  }

  resolve(record: MergeRecord, conflictId: string, resolution: string) {
    this.service.resolveConflict(record.id, conflictId, resolution).subscribe((result) => {
      this.store.dispatch(resolveConflictSuccess({ record: result.record }))
      this.snackBar.open(`冲突已处理：${resolution}`, '关闭', { duration: 1800 })
    })
  }

  unresolvedCount(record: MergeRecord) {
    return record.conflicts.filter((conflict) => conflict.status === '未决').length
  }

  viewMain() {
    const latest = this.records.find((record) => record.status === '已完成')
    if (latest) {
      this.store.dispatch(selectClaim({ id: latest.mainCaseId }))
      this.router.navigate(['/assessment'])
    }
  }

  viewRecordMain(record: MergeRecord) {
    this.store.dispatch(selectClaim({ id: record.mainCaseId }))
    this.router.navigate(['/assessment'])
  }

  clearConflict() {
    this.store.dispatch(clearMergeConflict())
  }
}
