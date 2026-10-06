import { Component } from '@angular/core'
import { CommonModule } from '@angular/common'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatChipsModule } from '@angular/material/chips'
import { MatIconModule } from '@angular/material/icon'
import { MatSnackBar } from '@angular/material/snack-bar'
import { Store } from '@ngrx/store'
import type { Observable } from 'rxjs'
import type { ClaimCase, MergeSession } from '../core/models'
import { MergeBoardService } from '../core/merge-board.service'
import { selectSelectedClaim, selectMergeSessions, selectSessionsForSelectedClaim, saveDraft, type AppState } from '../core/claims.store'
import { StatusChipComponent } from '../shared/status-chip.component'

@Component({
  selector: 'app-audit-page',
  standalone: true,
  template: `
    <section class="page" *ngIf="claim$ | async as claim">
      <div class="page-head">
        <div>
          <p class="eyebrow">AUDIT & EVIDENCE / 审计与证据</p>
          <h1>附件版本、并案快照与操作时间线</h1>
          <p class="muted">报价调整、并案合并、准备金重算、会签失效与撤销全部保留在不可覆盖的审计记录中。</p>
        </div>
        <div class="actions">
          <button mat-stroked-button (click)="restoreDraft()"><mat-icon>restore</mat-icon> 恢复未提交草稿</button>
          <button mat-flat-button color="primary" (click)="exportAudit(claim)"><mat-icon>download</mat-icon> 导出审计包</button>
        </div>
      </div>

      <div class="audit-grid">
        <section class="panel">
          <div class="panel-head"><h3>案件操作时间线</h3><span class="muted">{{ claim.audit.length }} 条记录</span></div>
          <div class="timeline">
            <article *ngFor="let event of claim.audit.slice().reverse(); let first = first" [class.merge-event]="isMergeEvent(event.action)">
              <div class="time">{{ event.at }}</div>
              <div class="rail"><i [class.merged]="isMergeEvent(event.action)"></i><b *ngIf="!first"></b></div>
              <div class="event">
                <strong>{{ event.action }}</strong>
                <p>{{ event.detail }}</p>
                <small>{{ event.operator }} · 记录编号 {{ event.id }}</small>
              </div>
            </article>
          </div>
        </section>

        <aside>
          <section class="panel">
            <div class="panel-head"><h3>附件版本</h3><span class="muted">只增不删 · 撤销不丢</span></div>
            <div class="file-list">
              <div *ngFor="let item of claim.lossItems">
                <strong>{{ item.category }}</strong>
                <article *ngFor="let file of item.attachments">
                  <mat-icon>{{ file.category === '现场照片' ? 'photo_camera' : 'description' }}</mat-icon>
                  <div>
                    <span>{{ file.name }}</span>
                    <small>V{{ file.version }} · {{ file.uploadedBy }} · {{ file.uploadedAt }}</small>
                    <small class="from" *ngIf="file.sourceClaimId">来源案件 {{ file.sourceClaimId }}</small>
                  </div>
                  <app-status-chip [label]="file.category" />
                </article>
                <small *ngIf="item.attachments.length === 0">暂无附件</small>
              </div>
            </div>
          </section>

          <mat-card appearance="outlined" class="snapshot-card">
            <div><mat-icon>ac_unit</mat-icon><strong>合并前两案快照</strong></div>
            <p *ngIf="(snapshotSessions$ | async)?.length; else noSnapshot">
              下列会话冻结过本案快照，失败回滚与撤销均以快照为准：
            </p>
            <ng-template #noSnapshot><p>本案暂无并案快照；发起并案时会先冻结再确认。</p></ng-template>
            <div class="snapshot-item" *ngFor="let session of (snapshotSessions$ | async) ?? []">
              <span>{{ session.id }}</span>
              <app-status-chip [label]="session.status" [tone]="session.status === '已合并' ? 'good' : session.status === '失败' ? 'warn' : 'default'" />
              <small>冻结于 {{ session.frozenAt || '—' }} · {{ session.frozenBy || '—' }}</small>
              <button mat-stroked-button color="warn" *ngIf="session.status === '已合并'" (click)="undo(session)">撤销并案恢复快照</button>
            </div>
          </mat-card>
        </aside>
      </div>

      <section class="panel merge-history-panel">
        <div class="panel-head"><h3>并案处理记录（全局）</h3><span class="muted">候选、冻结、确认、冲突、失败、撤销全程留痕，重开页面仍在</span></div>
        <div class="merge-history" *ngIf="(sessions$ | async) as sessions">
          <article *ngFor="let session of sessions">
            <header>
              <strong>{{ session.masterId }} ↔ {{ session.sourceId }}</strong>
              <app-status-chip [label]="session.status" [tone]="session.status === '已合并' ? 'good' : session.status === '失败' || session.status === '冲突' ? 'warn' : 'default'" />
            </header>
            <ul>
              <li *ngFor="let event of session.history">
                <b>{{ event.action }}</b>
                <p>{{ event.detail }}</p>
                <small>{{ event.at }} · {{ event.operator }}</small>
              </li>
            </ul>
          </article>
          <p class="muted" *ngIf="sessions.length === 0">暂无并案处理记录。</p>
        </div>
      </section>
    </section>
  `,
  styles: [`
    .audit-grid { display: grid; grid-template-columns: minmax(0,1fr) 380px; gap: 14px; align-items: start; }
    .timeline { padding: 18px 20px; }
    .timeline article { display: grid; grid-template-columns: 96px 22px minmax(0,1fr); }
    .time { padding-top: 2px; color: #66757e; font-family: monospace; font-size: 11px; text-align: right; }
    .rail { position: relative; }
    .rail i { position: absolute; z-index: 2; top: 3px; left: 7px; width: 8px; height: 8px; border: 2px solid #fff; border-radius: 50%; background: #2c7f89; box-shadow: 0 0 0 1px #2c7f89; }
    .rail i.merged { background: #c4613b; box-shadow: 0 0 0 1px #c4613b; }
    .rail b { position: absolute; top: 11px; bottom: -2px; left: 10px; width: 1px; background: #ccd8dc; }
    .merge-event .event strong { color: #984313; }
    .event { padding: 0 0 22px 8px; }
    .event strong { font-size: 13px; }
    .event p { margin: 6px 0; color: #56656e; font-size: 12px; line-height: 1.55; }
    .event small { color: #89949b; font-size: 10px; }
    aside { display: grid; gap: 14px; }
    .file-list { padding: 8px 14px 16px; }
    .file-list > div { padding: 10px 0; border-bottom: 1px solid #edf0f2; }
    .file-list article { display: grid; grid-template-columns: 28px minmax(0,1fr) auto; gap: 8px; align-items: center; padding: 8px; margin-top: 6px; background: #f5f7f7; border-radius: 6px; }
    .file-list article span, .file-list article small { display: block; }
    .file-list article span { font-size: 12px; }
    .file-list article small { margin-top: 3px; color: #7b878f; font-size: 10px; }
    .file-list article small.from { color: #2f8191; font-weight: 700; }
    .snapshot-card { padding: 16px; }
    .snapshot-card > div:first-child { display: flex; align-items: center; gap: 8px; }
    .snapshot-card > div:first-child mat-icon { color: #2f8191; }
    .snapshot-card p { margin: 9px 0 12px; color: #69767f; font-size: 12px; line-height: 1.55; }
    .snapshot-item { display: grid; gap: 6px; padding: 10px; margin-bottom: 8px; background: #f4f8f9; border-radius: 7px; }
    .snapshot-item span { font-size: 12px; font-weight: 700; color: #20495a; }
    .snapshot-item small { color: #7b8790; font-size: 10px; }
    .merge-history-panel { margin-top: 14px; }
    .merge-history { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; padding: 14px 16px 18px; }
    .merge-history article { border: 1px solid #e6ebed; border-radius: 8px; padding: 10px 12px; }
    .merge-history header { display: flex; justify-content: space-between; gap: 8px; align-items: center; margin-bottom: 8px; }
    .merge-history ul { list-style: none; margin: 0; padding: 0; }
    .merge-history li { position: relative; padding: 0 0 8px 12px; border-left: 2px solid #d8e2e6; }
    .merge-history li::before { content: ''; position: absolute; left: -5px; top: 3px; width: 7px; height: 7px; border-radius: 50%; background: #3c8c9b; }
    .merge-history li b { font-size: 11px; color: #235062; }
    .merge-history li p { margin: 2px 0; font-size: 10.5px; color: #5d6b74; line-height: 1.5; }
    .merge-history li small { color: #94a0a8; font-size: 9.5px; }
    @media (max-width: 1050px) { .audit-grid { grid-template-columns: 1fr; } }
  `],
  imports: [CommonModule, MatButtonModule, MatCardModule, MatChipsModule, MatIconModule, StatusChipComponent],
})
export class AuditPageComponent {
  claim$: Observable<ClaimCase>
  sessions$: Observable<MergeSession[]>
  snapshotSessions$: Observable<MergeSession[]>

  constructor(
    private readonly store: Store<AppState>,
    private readonly board: MergeBoardService,
    private readonly snackBar: MatSnackBar,
  ) {
    this.claim$ = this.store.select(selectSelectedClaim)
    this.sessions$ = this.store.select(selectMergeSessions)
    this.snapshotSessions$ = this.store.select(selectSessionsForSelectedClaim)
  }

  isMergeEvent(action: string) {
    return ['并案合并', '准备金重算', '会签失效', '撤销并案'].includes(action)
  }

  undo(session: MergeSession) {
    this.board.undo(session.id, '主管-审计页').subscribe(() => {
      this.snackBar.open('已撤销并案：原案、旧会签与附件按快照恢复', '关闭', { duration: 3000 })
    })
  }

  restoreDraft() {
    const draft = localStorage.getItem('claims-assessment-draft') ?? '待补充房屋檩条第三方复测依据。'
    this.store.dispatch(saveDraft({ draft }))
    this.snackBar.open('已恢复本地未提交草稿', '关闭', { duration: 1800 })
  }

  exportAudit(claim: any) {
    const lines = ['时间,操作者,动作,说明', ...claim.audit.map((event: any) => [event.at, event.operator, event.action, event.detail].map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))]
    const url = URL.createObjectURL(new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${claim.id}-审计记录.csv`
    link.click()
    URL.revokeObjectURL(url)
    this.snackBar.open('审计包已导出', '关闭', { duration: 1600 })
  }
}
