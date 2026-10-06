import { Component } from '@angular/core'
import { CommonModule, CurrencyPipe } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { RouterLink } from '@angular/router'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatExpansionModule } from '@angular/material/expansion'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatIconModule } from '@angular/material/icon'
import { MatInputModule } from '@angular/material/input'
import { MatSnackBar } from '@angular/material/snack-bar'
import { MatStepperModule } from '@angular/material/stepper'
import { Store } from '@ngrx/store'
import type { Observable } from 'rxjs'
import { ClaimsService } from '../core/claims.service'
import type { ClaimCase } from '../core/models'
import { selectSelectedClaim, selectSelectedClaimConflicts, updateClaim, type AppState } from '../core/claims.store'
import { StatusChipComponent } from '../shared/status-chip.component'

@Component({
  selector: 'app-review-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    CurrencyPipe,
    MatButtonModule,
    MatCardModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatStepperModule,
    StatusChipComponent,
  ],
  template: `
    <section class="page" *ngIf="claim$ | async as claim">
      <div class="page-head">
        <div>
          <p class="eyebrow">RESERVE APPROVAL / 准备金审批</p>
          <h1>{{ claim.id }} 多级会签</h1>
          <p class="muted">
            按金额、科目和风险阈值逐级审批；退回必须说明补充材料。
            <span *ngIf="claim.mergedFrom?.length" class="merged-link">本案为并案主案，已并入 {{ mergedFromText(claim) }}。</span>
          </p>
        </div>
        <span class="reserve">重算后准备金 {{ claim.reserve | currency:'CNY':'symbol':'1.0-0' }}</span>
      </div>

      <div class="conflict-banner" *ngIf="(claimConflicts$ | async)?.length">
        <mat-icon>flash_on</mat-icon>
        <div>
          <strong>{{ (claimConflicts$ | async)?.length }} 条并发并案分歧待复核</strong>
          <p>两人同时确认时先到者已生效，后到者的不同主案选择已保留，请在并案处理页复核。</p>
        </div>
        <a mat-stroked-button routerLink="/merges">去处理分歧</a>
      </div>

      <div class="review-grid">
        <section class="panel">
          <div class="panel-head"><h3>重算会签流程</h3><app-status-chip [label]="claim.status" [tone]="claim.status === '退回补件' || claim.status === '待复核' ? 'warn' : 'good'" /></div>
          <mat-stepper orientation="vertical" [linear]="false" class="approval-stepper">
            <mat-step *ngFor="let step of claim.approvals; let index = index" [completed]="step.status === '已通过'">
              <ng-template matStepLabel>
                <strong>{{ step.role }}</strong>
                <span class="threshold">触发阈值 {{ step.threshold | currency:'CNY':'symbol':'1.0-0' }}</span>
              </ng-template>
              <div class="step-body">
                <p>{{ step.comment || (step.status === '待处理' ? '等待当前审核人处理（并案后按新准备金重新会签）。' : step.status + '。') }}</p>
                <small *ngIf="step.operator">{{ step.operator }} · {{ step.completedAt }}</small>
                <div class="step-actions" *ngIf="step.status === '待处理'">
                  <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>审批意见</mat-label><input matInput [(ngModel)]="comments[index]" /></mat-form-field>
                  <button mat-flat-button color="primary" [disabled]="!comments[index]?.trim()" (click)="decide(claim.id, step.role, '已通过', index)">通过</button>
                  <button mat-stroked-button color="warn" [disabled]="!comments[index]?.trim()" (click)="decide(claim.id, step.role, '退回补件', index)">退回补件</button>
                </div>
              </div>
            </mat-step>
          </mat-stepper>
        </section>

        <aside>
          <section class="panel invalid-panel" *ngIf="claim.invalidatedApprovals?.length">
            <div class="panel-head"><h3>原会签失效待复核</h3><app-status-chip [label]="(claim.invalidatedApprovals?.length ?? 0) + ' 步'" tone="warn" /></div>
            <mat-accordion>
              <mat-expansion-panel *ngFor="let step of claim.invalidatedApprovals">
                <mat-expansion-panel-header>
                  <mat-panel-title><strong>{{ step.role }}</strong><span>来源 {{ step.sourceClaimId }}</span></mat-panel-title>
                </mat-expansion-panel-header>
                <p class="invalid-reason">{{ step.invalidatedReason }}</p>
                <small *ngIf="step.operator">原操作人 {{ step.operator }} · {{ step.completedAt }}</small>
                <small *ngIf="step.comment">原意见：{{ step.comment }}</small>
              </mat-expansion-panel>
            </mat-accordion>
          </section>

          <section class="panel basis-panel" *ngIf="hasBasis(claim)">
            <div class="panel-head"><h3>重复科目金额依据并列</h3><span class="muted">合成一项</span></div>
            <article *ngFor="let item of claim.lossItems">
              <ng-container *ngIf="item.amountBasis?.length">
                <strong>{{ item.category }} · {{ item.description }}</strong>
                <div class="basis-row" *ngFor="let basis of item.amountBasis">
                  <span class="source-tag">{{ basis.sourceClaimId }} / {{ basis.sourceItemId }}</span>
                  <b>{{ basis.amount | currency:'CNY':'symbol':'1.0-0' }}</b>
                  <small>V{{ basis.version }} · {{ basis.operator }} · {{ basis.createdAt }}</small>
                  <p>{{ basis.reason }}</p>
                </div>
              </ng-container>
            </article>
          </section>

          <section class="panel">
            <div class="panel-head"><h3>赔付方案对比</h3><span class="muted">自动试算</span></div>
            <div class="plans">
              <mat-card appearance="outlined">
                <span>方案 A · 现状评估</span>
                <strong>{{ planA(claim) | currency:'CNY':'symbol':'1.0-0' }}</strong>
                <p>采用各科目最新报价，合并科目并列依据均展示。</p>
                <button mat-button>设为审批方案</button>
              </mat-card>
              <mat-card appearance="outlined" class="recommended">
                <span>方案 B · 核减待证部分</span>
                <strong>{{ planB(claim) | currency:'CNY':'symbol':'1.0-0' }}</strong>
                <p>暂扣第三方复测与库龄核减争议金额，通过后追加。</p>
                <button mat-flat-button color="primary">推荐方案</button>
              </mat-card>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head"><h3>争议项定位</h3><span class="muted">{{ disputedCount(claim) }} 项</span></div>
            <div class="disputes">
              <div *ngFor="let item of claim.lossItems" [class.disputed]="item.disputed">
                <mat-icon>{{ item.disputed ? 'report_problem' : 'check_circle' }}</mat-icon>
                <div>
                  <strong>{{ item.category }} · {{ item.description }}</strong>
                  <small class="src" *ngIf="item.sourceClaimId || item.mergedFrom?.length">
                    {{ item.sourceClaimId ? '来源 ' + item.sourceClaimId : '由 ' + (item.mergedFrom?.join('、') ?? '') + ' 同科目合成' }}
                  </small>
                  <p>{{ item.disputed ? '存在证据差异，审批意见不能覆盖原始查勘记录。' : '材料一致，可纳入当前方案。' }}</p>
                </div>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </section>
  `,
  styles: [`
    .reserve { padding: 10px 14px; border-left: 3px solid #2f8191; background: #eaf4f5; color: #175866; font-weight: 800; }
    .merged-link { margin-left: 8px; color: #2f8191; font-weight: 700; }
    .conflict-banner { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; padding: 12px 16px; border: 1px solid #e3c3af; border-left: 4px solid #c4613b; background: #fff6ef; }
    .conflict-banner mat-icon { color: #c4613b; }
    .conflict-banner p { margin: 4px 0 0; font-size: 11.5px; color: #7a5a48; }
    .review-grid { display: grid; grid-template-columns: minmax(0,1fr) 370px; gap: 14px; align-items: start; }
    .approval-stepper { padding: 18px 22px 22px 8px; background: transparent; }
    mat-step strong, mat-step .threshold { display: block; }
    .threshold { margin-top: 3px; color: #78858d; font-size: 10px; }
    .step-body { padding: 4px 0 16px; }
    .step-body p { margin: 0 0 6px; color: #58666f; }
    .step-body small { color: #869198; }
    .step-actions { display: flex; align-items: center; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    .step-actions mat-form-field { flex: 1; min-width: 240px; }
    aside { display: grid; gap: 14px; }
    .invalid-panel mat-expansion-panel { border-radius: 0; border-left: 0; border-right: 0; }
    .invalid-reason { margin: 6px 0; color: #8a4d27; font-size: 11.5px; }
    mat-panel-title { flex-direction: column; align-items: flex-start; gap: 2px; }
    mat-panel-title span { color: #8a969e; font-size: 10px; }
    .basis-panel article { padding: 10px 14px; border-top: 1px solid #edf0f2; }
    .basis-panel > div + article, .basis-panel article:first-of-type { border-top: 0; }
    .basis-row { margin-top: 8px; padding: 8px 10px; background: #f4f8f9; border-radius: 6px; }
    .basis-row b { display: block; color: #175866; margin: 3px 0; }
    .basis-row small, .basis-row p { display: block; color: #6d7982; font-size: 10.5px; line-height: 1.5; }
    .basis-row p { margin-top: 3px; }
    .source-tag { display: inline-block; padding: 2px 8px; border-radius: 10px; background: #d9eaee; color: #1f6575; font-size: 10px; }
    .plans { display: grid; gap: 10px; padding: 14px; }
    .plans mat-card { padding: 14px; }
    .plans .recommended { border-color: #39828b; background: #f0f8f8; }
    .plans span, .plans p { display: block; color: #69767e; font-size: 12px; }
    .plans strong { display: block; margin: 7px 0; color: #184855; font-size: 22px; }
    .disputes { padding: 6px 14px 14px; }
    .disputes > div { display: flex; gap: 9px; padding: 10px 0; border-bottom: 1px solid #edf0f2; color: #437360; }
    .disputes > div.disputed { color: #b55a2e; }
    .disputes strong { font-size: 12px; }
    .disputes .src { display: block; margin-top: 2px; color: #3a7f8e; font-size: 10px; }
    .disputes p { margin: 5px 0 0; color: #6d7981; font-size: 11px; line-height: 1.5; }
    @media (max-width: 1050px) { .review-grid { grid-template-columns: 1fr; } }
  `],
})
export class ReviewPageComponent {
  claim$: Observable<ClaimCase>
  claimConflicts$: Observable<import('../core/models').MergeConflict[]>
  comments: Record<number, string> = {}

  constructor(
    private readonly store: Store<AppState>,
    private readonly service: ClaimsService,
    private readonly snackBar: MatSnackBar,
  ) {
    this.claim$ = this.store.select(selectSelectedClaim)
    this.claimConflicts$ = this.store.select(selectSelectedClaimConflicts)
  }

  hasBasis(claim: ClaimCase) {
    return claim.lossItems.some((item) => item.amountBasis?.length)
  }

  mergedFromText(claim: ClaimCase) {
    return (claim.mergedFrom ?? []).join('、')
  }

  planA(claim: any) {
    return claim.lossItems.reduce((sum: number, item: any) => sum + Math.max(0, (item.repairQuotes.at(-1)?.amount ?? 0) - item.salvage) * item.liability, 0) - claim.deductible
  }

  planB(claim: any) {
    return this.planA(claim) - (claim.lossItems.filter((item: any) => item.disputed).length * 72000)
  }

  disputedCount(claim: any) {
    return claim.lossItems.filter((item: any) => item.disputed).length
  }

  decide(claimId: string, role: string, result: string, index: number) {
    const comment = this.comments[index]?.trim()
    if (!comment) return
    this.service.approve(claimId, { role, result, comment }).subscribe((updatedClaim) => {
      this.store.dispatch(updateClaim({ claim: structuredClone(updatedClaim) }))
      this.snackBar.open(result === '已通过' ? '会签通过，已流转至下一级' : '案件已退回补件，原始记录未修改', '关闭', { duration: 2200 })
      this.comments[index] = ''
    })
  }
}
