import { Component } from '@angular/core'
import { CommonModule, CurrencyPipe } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Router } from '@angular/router'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatCheckboxModule } from '@angular/material/checkbox'
import { MatChipsModule } from '@angular/material/chips'
import { MatDividerModule } from '@angular/material/divider'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatIconModule } from '@angular/material/icon'
import { MatInputModule } from '@angular/material/input'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { MatRadioModule } from '@angular/material/radio'
import { MatSelectModule } from '@angular/material/select'
import { MatSnackBar } from '@angular/material/snack-bar'
import { Store } from '@ngrx/store'
import type { Observable } from 'rxjs'
import { MergeBoardService } from '../core/merge-board.service'
import type { MergeCandidateView, MergeConflict, MergeSession } from '../core/models'
import { selectMergeBusy, selectMergeCandidates, selectMergeSessions, selectUnresolvedConflicts, selectClaim, setToast, type AppState } from '../core/claims.store'
import { StatusChipComponent } from '../shared/status-chip.component'

type MergeForm = {
  opA: string
  opB: string
  choiceA: string
  choiceB: string
  firstArriver: 'A' | 'B'
  simulateFailure: boolean
}

@Component({
  selector: 'app-merge-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CurrencyPipe,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatChipsModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatRadioModule,
    MatSelectModule,
    StatusChipComponent,
  ],
  template: `
    <section class="page">
      <div class="page-head">
        <div>
          <p class="eyebrow">CASE MERGE / 并案处理</p>
          <h1>疑似同事故案件并案</h1>
          <p class="muted">按事故日、报案地址、保单与证据列出候选；先冻结两案快照，选主案后合并，全过程可撤销。</p>
        </div>
        <div class="actions">
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="operator-field">
            <mat-label>当前主管</mat-label>
            <input matInput [(ngModel)]="operator" />
          </mat-form-field>
          <button mat-stroked-button (click)="rescan()"><mat-icon>travel_explore</mat-icon> 重新扫描候选</button>
        </div>
      </div>

      <!-- 未决冲突 -->
      <section class="panel conflict-panel" *ngIf="conflicts$ | async as conflicts">
        <div class="panel-head" *ngIf="conflicts.length">
          <h3><mat-icon>flash_on</mat-icon> 未决并发分歧 · {{ conflicts.length }}</h3>
          <span class="muted">先到者已生效，后到者选择被保留并可见主案</span>
        </div>
        <div class="conflict-list" *ngIf="conflicts.length">
          <article *ngFor="let conflict of conflicts">
            <div class="conflict-main">
              <strong>会话 {{ conflict.sessionId }}</strong>
              <p>
                先生效：<b>{{ conflict.winnerOperator }}</b> 选择主案 <b>{{ conflict.masterChoice }}</b>；
                后到：<b>{{ conflict.loserOperator }}</b> 选择 <b>{{ conflict.loserChoice }}</b>
              </p>
              <small>{{ conflict.at }} · 当前主案 {{ conflict.masterId }}（含来源 {{ conflict.sourceId }} 的引用）</small>
            </div>
            <div class="conflict-actions">
              <button mat-flat-button color="primary" [disabled]="(busy$ | async) === conflict.sessionId" (click)="resolve(conflict, '接受主案')">后到者接受主案</button>
              <button mat-stroked-button color="warn" [disabled]="(busy$ | async) === conflict.sessionId" (click)="resolve(conflict, '维持分歧')">维持分歧，转复核</button>
            </div>
          </article>
        </div>
      </section>

      <div class="merge-grid">
        <div class="candidate-col">
          <div class="panel-head list-head">
            <h3>并案候选</h3>
            <span class="muted">{{ (candidates$ | async)?.length ?? 0 }} 对待确认</span>
          </div>

          <ng-container *ngIf="(candidates$ | async) as candidates">
            <article class="panel candidate" *ngFor="let candidate of candidates">
              <header>
                <div>
                  <h3>{{ candidate.masterId }} <mat-icon>compare_arrows</mat-icon> {{ candidate.sourceId }}</h3>
                  <small>{{ candidate.master.lossAddress }} / {{ candidate.source.lossAddress }}</small>
                </div>
                <div class="score">
                  <app-status-chip [label]="statusLabel(candidate.status)" [tone]="candidate.status === '失败' ? 'warn' : candidate.status === '待确认' ? 'default' : 'good'" />
                  <span>匹配置信度 <b>{{ candidate.score }}</b></span>
                </div>
              </header>

              <div class="reasons">
                <mat-chip *ngFor="let reason of candidate.reasons">{{ reason.label }}</mat-chip>
                <p class="reason-detail" *ngFor="let reason of candidate.reasons">{{ reason.detail }}</p>
              </div>

              <div class="case-pair">
                <mat-card appearance="outlined" [class.picked]="form(candidate.sessionId).choiceA === candidate.masterId">
                  <span>A 案</span>
                  <strong>{{ candidate.master.id }}</strong>
                  <small>{{ candidate.master.insured }}</small>
                  <small>保单 {{ candidate.master.policyNo }} · 事故日 {{ candidate.master.accidentDate }}</small>
                  <small>准备金 {{ candidate.master.reserve | currency:'CNY':'symbol':'1.0-0' }} · {{ candidate.master.lossItems.length }} 科目 · {{ attachmentTotal(candidate.master) }} 附件</small>
                  <small>会签 {{ pendingText(candidate.master) }}</small>
                </mat-card>
                <mat-card appearance="outlined" [class.picked]="form(candidate.sessionId).choiceA === candidate.sourceId">
                  <span>B 案</span>
                  <strong>{{ candidate.source.id }}</strong>
                  <small>{{ candidate.source.insured }}</small>
                  <small>保单 {{ candidate.source.policyNo }} · 事故日 {{ candidate.source.accidentDate }}</small>
                  <small>准备金 {{ candidate.source.reserve | currency:'CNY':'symbol':'1.0-0' }} · {{ candidate.source.lossItems.length }} 科目 · {{ attachmentTotal(candidate.source) }} 附件</small>
                  <small>会签 {{ pendingText(candidate.source) }}</small>
                </mat-card>
              </div>

              <div class="evidence" *ngIf="candidate.evidencePairs.length">
                <h4><mat-icon>fact_check</mat-icon> 证据互证（{{ candidate.evidencePairs.length }}）</h4>
                <div *ngFor="let pair of candidate.evidencePairs">
                  <span>{{ pair.master }}</span>
                  <mat-icon>link</mat-icon>
                  <span>{{ pair.source }}</span>
                  <small>{{ pair.detail }}</small>
                </div>
              </div>

              <div class="snapshot-note" *ngIf="candidate.status === '待确认'">
                <mat-icon>ac_unit</mat-icon>
                <div>
                  <strong>两案快照已冻结</strong>
                  <p>冻结后两案只读；合并以快照为准，失败或撤销时按快照恢复，附件不会丢失。</p>
                </div>
              </div>
              <div class="snapshot-note fail" *ngIf="candidate.status === '失败'">
                <mat-icon>sync_problem</mat-icon>
                <div>
                  <strong>上次合并失败</strong>
                  <p>现场两案、旧会签与附件均保持原状，可修正后重新确认。</p>
                </div>
              </div>

              <!-- 第一步：冻结 -->
              <div class="step-actions" *ngIf="candidate.status === '候选'">
                <button mat-flat-button color="primary" [disabled]="(busy$ | async) === candidate.sessionId" (click)="freeze(candidate)">
                  <mat-icon>ac_unit</mat-icon> 冻结两案快照
                </button>
                <button mat-button (click)="discard(candidate)">判定非同一事故，关闭候选</button>
              </div>

              <!-- 第二步：选主案并确认 -->
              <div class="confirm-zone" *ngIf="candidate.status === '待确认' || candidate.status === '失败'">
                <mat-divider></mat-divider>
                <div class="confirm-form">
                  <div class="choice-line">
                    <label>主案选择</label>
                    <mat-radio-group [(ngModel)]="form(candidate.sessionId).choiceA">
                      <mat-radio-button [value]="candidate.masterId">保留 {{ candidate.masterId }} 为主案</mat-radio-button>
                      <mat-radio-button [value]="candidate.sourceId">保留 {{ candidate.sourceId }} 为主案</mat-radio-button>
                    </mat-radio-group>
                  </div>
                  <div class="op-line">
                    <mat-form-field appearance="outline" subscriptSizing="dynamic">
                      <mat-label>确认人 1</mat-label>
                      <input matInput [(ngModel)]="form(candidate.sessionId).opA" />
                    </mat-form-field>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic">
                      <mat-label>确认人 2（并发）</mat-label>
                      <input matInput [(ngModel)]="form(candidate.sessionId).opB" />
                    </mat-form-field>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic" class="choice-b">
                      <mat-label>确认人 2 的主案选择</mat-label>
                      <mat-select [(ngModel)]="form(candidate.sessionId).choiceB">
                        <mat-option [value]="candidate.masterId">{{ candidate.masterId }}</mat-option>
                        <mat-option [value]="candidate.sourceId">{{ candidate.sourceId }}</mat-option>
                      </mat-select>
                    </mat-form-field>
                    <mat-radio-group [(ngModel)]="form(candidate.sessionId).firstArriver" class="first-pick">
                      <mat-radio-button value="A">1 先到</mat-radio-button>
                      <mat-radio-button value="B">2 先到</mat-radio-button>
                    </mat-radio-group>
                  </div>
                  <div class="guard-line">
                    <mat-checkbox [(ngModel)]="form(candidate.sessionId).simulateFailure">模拟准备金重算服务异常（验证失败回滚）</mat-checkbox>
                  </div>
                </div>
                <div class="step-actions">
                  <button mat-flat-button color="primary" [disabled]="(busy$ | async) === candidate.sessionId || !form(candidate.sessionId).choiceA" (click)="confirmOne(candidate)">
                    <mat-icon>merge_type</mat-icon> 单人确认并案
                  </button>
                  <button mat-stroked-button [disabled]="(busy$ | async) === candidate.sessionId" (click)="confirmConcurrent(candidate)">
                    <mat-icon>groups</mat-icon> 两人同时提交
                  </button>
                  <button mat-button (click)="discard(candidate)">取消并案</button>
                </div>
                <mat-progress-bar *ngIf="(busy$ | async) === candidate.sessionId" mode="indeterminate"></mat-progress-bar>
              </div>
            </article>

            <div class="empty panel" *ngIf="candidates.length === 0">
              <mat-icon>verified</mat-icon>
              <p>当前没有待处理候选。重新扫描会按事故日、地址、保单与证据再次比对全部案件。</p>
            </div>
          </ng-container>
        </div>

        <!-- 处理记录 -->
        <aside class="history-col">
          <div class="panel">
            <div class="panel-head"><h3>并案处理记录</h3><span class="muted">重开页面仍保留</span></div>
            <div class="history-list" *ngIf="(sessions$ | async) as sessions">
              <ng-container *ngIf="sessions.length; else noHistory">
                <article *ngFor="let session of sessions">
                  <div class="history-title">
                    <strong>{{ session.masterId }} ↔ {{ session.sourceId }}</strong>
                    <app-status-chip [label]="session.status" [tone]="historyTone(session.status)" />
                  </div>
                  <ul>
                    <li *ngFor="let event of session.history">
                      <b>{{ event.action }}</b>
                      <p>{{ event.detail }}</p>
                      <small>{{ event.at }} · {{ event.operator }}</small>
                    </li>
                  </ul>
                  <div class="conflict-mini" *ngFor="let conflict of session.conflicts">
                    <mat-icon>{{ conflict.resolved ? 'task_alt' : 'pending_actions' }}</mat-icon>
                    <span>{{ conflict.loserOperator }} 的后到分歧{{ conflict.resolved ? '已处理：' + conflict.resolution : '待处理' }}</span>
                  </div>
                  <div class="history-actions" *ngIf="session.status === '已合并'">
                    <button mat-stroked-button color="primary" (click)="openMaster(session)"><mat-icon>visibility</mat-icon> 查看主案</button>
                    <button mat-stroked-button color="warn" [disabled]="(busy$ | async) === session.id" (click)="undo(session)"><mat-icon>undo</mat-icon> 撤销并案</button>
                  </div>
                </article>
              </ng-container>
              <ng-template #noHistory><p class="muted empty-note">暂无处理记录。</p></ng-template>
            </div>
          </div>
        </aside>
      </div>
    </section>
  `,
  styles: [`
    .operator-field { width: 160px; }
    .merge-grid { display: grid; grid-template-columns: minmax(0,1fr) 360px; gap: 14px; align-items: start; }
    .list-head { padding: 0 2px 10px; }
    .candidate { margin-bottom: 14px; padding: 0; overflow: hidden; }
    .candidate > header { display: flex; justify-content: space-between; gap: 12px; padding: 14px 16px; border-bottom: 1px solid #e6ebed; }
    .candidate h3 { margin: 0 0 4px; font-size: 15px; display: flex; align-items: center; gap: 6px; }
    .candidate h3 mat-icon { color: #2f8191; }
    .candidate header small { color: #7b8790; font-size: 11px; }
    .score { display: grid; gap: 6px; justify-items: end; }
    .score span { font-size: 11px; color: #6d7982; }
    .score b { color: #175866; font-size: 14px; }
    .reasons { padding: 12px 16px 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .reasons mat-chip { font-size: 11px; min-height: 26px; background: #e7f1f3; color: #1c5d6b; }
    .reason-detail { flex-basis: 100%; margin: 2px 0; color: #66757e; font-size: 11px; line-height: 1.5; }
    .case-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 12px 16px; }
    .case-pair mat-card { padding: 12px; border-color: #d6e0e4; }
    .case-pair mat-card.picked { border-color: #2f8191; box-shadow: inset 0 0 0 1px #2f8191; background: #f2f9fa; }
    .case-pair span { display: inline-block; padding: 2px 8px; border-radius: 10px; background: #eef3f5; color: #5a6b75; font-size: 10px; }
    .case-pair strong { display: block; margin: 8px 0 4px; color: #153747; }
    .case-pair small { display: block; color: #6d7982; font-size: 10.5px; line-height: 1.7; }
    .evidence { margin: 0 16px 10px; padding: 10px 12px; background: #f7f9fa; border-radius: 8px; }
    .evidence h4 { margin: 0 0 8px; font-size: 12px; display: flex; align-items: center; gap: 5px; }
    .evidence > div { display: grid; grid-template-columns: minmax(0,1fr) 18px minmax(0,1fr); gap: 4px 6px; padding: 6px 0; border-top: 1px dashed #dfe6e9; align-items: center; }
    .evidence > div span { font-size: 11px; color: #33485a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .evidence > div mat-icon { font-size: 15px; width: 15px; height: 15px; color: #8aa0ab; }
    .evidence > div small { grid-column: 1 / -1; color: #83909a; font-size: 10px; }
    .snapshot-note { display: flex; gap: 9px; margin: 0 16px 12px; padding: 10px 12px; background: #eef6f8; border-left: 3px solid #3c8c9b; color: #26596a; }
    .snapshot-note.fail { background: #fff3ec; border-left-color: #c4613b; color: #7d4326; }
    .snapshot-note mat-icon { margin-top: 2px; }
    .snapshot-note p { margin: 4px 0 0; font-size: 11px; line-height: 1.5; }
    .step-actions { display: flex; gap: 10px; flex-wrap: wrap; padding: 4px 16px 16px; }
    .confirm-zone { padding: 0 16px 16px; }
    .confirm-zone mat-divider { margin-bottom: 12px; }
    .confirm-form { display: grid; gap: 10px; margin-bottom: 8px; }
    .choice-line { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
    .choice-line label { font-size: 12px; font-weight: 700; color: #465965; }
    .op-line { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .op-line mat-form-field { width: 150px; }
    .op-line .choice-b { width: 200px; }
    .first-pick { display: flex; gap: 12px; font-size: 12px; }
    .guard-line { font-size: 12px; }
    .conflict-panel { margin-bottom: 14px; }
    .conflict-list article { display: flex; justify-content: space-between; gap: 14px; padding: 12px 16px; border-top: 1px solid #e6ebed; flex-wrap: wrap; }
    .conflict-main p { margin: 6px 0; font-size: 12px; color: #475965; }
    .conflict-main small { color: #8a969e; font-size: 10.5px; }
    .conflict-actions { display: flex; gap: 8px; align-items: center; }
    .history-list { padding: 8px 14px 14px; max-height: 720px; overflow: auto; }
    .history-list > article { padding: 10px 0; border-bottom: 1px solid #edf0f2; }
    .history-title { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
    .history-title strong { font-size: 12px; color: #20445a; }
    .history-list ul { list-style: none; margin: 8px 0 0; padding: 0; }
    .history-list li { position: relative; padding: 0 0 10px 14px; border-left: 2px solid #d8e2e6; }
    .history-list li::before { content: ''; position: absolute; left: -5px; top: 3px; width: 8px; height: 8px; border-radius: 50%; background: #3c8c9b; }
    .history-list li b { font-size: 11.5px; color: #235062; }
    .history-list li p { margin: 3px 0; font-size: 11px; color: #5d6b74; line-height: 1.55; }
    .history-list li small { color: #94a0a8; font-size: 10px; }
    .conflict-mini { display: flex; gap: 6px; align-items: flex-start; margin-bottom: 8px; font-size: 11px; color: #8a4d27; }
    .history-actions { display: flex; gap: 8px; }
    .empty { padding: 26px; text-align: center; color: #6d7982; }
    .empty mat-icon { font-size: 34px; width: 34px; height: 34px; color: #5ea07f; }
    .empty p { font-size: 12px; }
    .empty-note { padding: 8px 4px; font-size: 11.5px; }
    @media (max-width: 1180px) { .merge-grid { grid-template-columns: 1fr; } }
    @media (max-width: 680px) { .case-pair { grid-template-columns: 1fr; } }
  `],
})
export class MergePageComponent {
  candidates$: Observable<MergeCandidateView[]>
  sessions$: Observable<MergeSession[]>
  conflicts$: Observable<MergeConflict[]>
  busy$: Observable<string>
  operator = '主管-王敏'
  private forms = new Map<string, MergeForm>()

  constructor(
    private readonly store: Store<AppState>,
    private readonly board: MergeBoardService,
    private readonly router: Router,
    private readonly snackBar: MatSnackBar,
  ) {
    this.candidates$ = this.store.select(selectMergeCandidates)
    this.sessions$ = this.store.select(selectMergeSessions)
    this.conflicts$ = this.store.select(selectUnresolvedConflicts)
    this.busy$ = this.store.select(selectMergeBusy)
  }

  form(sessionId: string): MergeForm {
    let form = this.forms.get(sessionId)
    if (!form) {
      form = { opA: this.operator, opB: '主管-赵宁', choiceA: '', choiceB: '', firstArriver: 'A', simulateFailure: false }
      this.forms.set(sessionId, form)
    }
    return form
  }

  attachmentTotal(claim: MergeCandidateView['master']) {
    return claim.lossItems.reduce((sum, item) => sum + item.attachments.length, 0)
  }

  attachmentCount(candidate: MergeCandidateView) {
    return this.attachmentTotal(candidate.master) + this.attachmentTotal(candidate.source)
  }

  pendingText(claim: MergeCandidateView['master']) {
    const pending = claim.approvals.filter((step) => step.status === '待处理').length
    return pending ? `${pending} 步待处理，合并后将按新准备金重走` : '暂无待处理步骤'
  }

  statusLabel(status: MergeCandidateView['status']) {
    return status === '候选' ? '待冻结' : status === '待确认' ? '快照已冻结' : status === '失败' ? '失败待重试' : status
  }

  historyTone(status: MergeSession['status']): 'default' | 'warn' | 'good' {
    if (status === '已合并') return 'good'
    if (status === '失败' || status === '冲突') return 'warn'
    return 'default'
  }

  private feedback(outcome: string | undefined, candidate?: MergeCandidateView) {
    if (outcome === 'merged') {
      this.snackBar.open(candidate ? '并案已生效：重复科目合成、准备金按主案重算，旧会签已挂“待复核”' : '操作已生效，看板已刷新', '关闭', { duration: 2600 })
    } else if (outcome === 'conflict') {
      this.snackBar.open('检测到并发：先到确认已生效，后到者的分歧已保留并可查看主案', '关闭', { duration: 3000 })
    } else if (outcome === 'failed') {
      this.snackBar.open('合并失败：已按快照恢复原案与旧会签，附件无丢失', '关闭', { duration: 3000 })
    }
  }

  rescan() {
    this.board.rescan(this.operator).subscribe(() => {
      this.store.dispatch(setToast({ message: '候选扫描完成' }))
    })
  }

  freeze(candidate: MergeCandidateView) {
    this.board.freeze(candidate.sessionId, this.form(candidate.sessionId).opA || this.operator).subscribe((result) => {
      this.feedback(result.outcome, candidate)
    })
  }

  confirmOne(candidate: MergeCandidateView) {
    const form = this.form(candidate.sessionId)
    this.board.confirm(candidate.sessionId, form.opA || this.operator, form.choiceA, form.simulateFailure).subscribe((result) => {
      this.feedback(result.outcome, candidate)
    })
  }

  /** 模拟两人几乎同时提交：按所选“先到者”错开 350ms 网络抖动，验证先到生效、后到保留分歧 */
  confirmConcurrent(candidate: MergeCandidateView) {
    const form = this.form(candidate.sessionId)
    form.choiceA = form.choiceA || candidate.masterId
    form.choiceB = form.choiceB || (form.choiceA === candidate.masterId ? candidate.sourceId : candidate.masterId)

    const first = form.firstArriver === 'A'
      ? { op: form.opA || this.operator, choice: form.choiceA }
      : { op: form.opB || '主管-赵宁', choice: form.choiceB }
    const second = form.firstArriver === 'A'
      ? { op: form.opB || '主管-赵宁', choice: form.choiceB }
      : { op: form.opA || this.operator, choice: form.choiceA }

    this.board.confirm(candidate.sessionId, first.op, first.choice, form.simulateFailure).subscribe((result) => {
      if (result.outcome === 'failed') this.feedback('failed', candidate)
    })
    window.setTimeout(() => {
      this.board.confirm(candidate.sessionId, second.op, second.choice, false).subscribe((result) => {
        this.feedback(result.outcome === 'merged' ? 'merged' : result.outcome, candidate)
      })
    }, 350)
  }

  undo(session: MergeSession) {
    this.board.undo(session.id, this.operator).subscribe(() => {
      this.snackBar.open('已撤销并案：两案、旧会签按快照恢复，附件经核对无丢失', '关闭', { duration: 3000 })
    })
  }

  discard(candidate: MergeCandidateView) {
    this.board.discard(candidate.sessionId, this.operator).subscribe(() => {
      this.store.dispatch(setToast({ message: '候选已关闭，处理记录保留备查' }))
    })
  }

  resolve(conflict: MergeConflict, resolution: '接受主案' | '维持分歧') {
    this.board.resolveConflict(conflict.sessionId, this.operator, resolution).subscribe(() => {
      this.store.dispatch(setToast({ message: resolution === '接受主案' ? '后到者已接受主案，分歧关闭' : '分歧已登记并转入主案复核' }))
    })
  }

  openMaster(session: MergeSession) {
    if (session.mergedClaimId) {
      this.store.dispatch(selectClaim({ id: session.mergedClaimId }))
      this.router.navigate(['/assessment'])
    }
  }
}
