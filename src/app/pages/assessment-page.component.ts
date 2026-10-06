import { Component } from '@angular/core'
import { CommonModule, CurrencyPipe } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatChipsModule } from '@angular/material/chips'
import { MatExpansionModule } from '@angular/material/expansion'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatIconModule } from '@angular/material/icon'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatSnackBar } from '@angular/material/snack-bar'
import { MatTableModule } from '@angular/material/table'
import { Store } from '@ngrx/store'
import type { Observable } from 'rxjs'
import { ClaimsService } from '../core/claims.service'
import type { ClaimCase } from '../core/models'
import { selectSelectedClaim, updateClaim, type AppState } from '../core/claims.store'
import { StatusChipComponent } from '../shared/status-chip.component'

@Component({
  selector: 'app-assessment-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CurrencyPipe,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    StatusChipComponent,
  ],
  template: `
    <section class="page" *ngIf="claim$ | async as claim">
      <div class="page-head">
        <div>
          <p class="eyebrow">ASSESSMENT / 查勘定损</p>
          <h1>{{ claim.id }} · {{ claim.insured }}</h1>
          <p class="muted">{{ claim.lossAddress }} · 事故日 {{ claim.accidentDate }} · 查勘员 {{ claim.adjuster }}</p>
          <div class="merge-tags" *ngIf="claim.mergedFrom?.length">
            <mat-chip highlighted>并案主案 · 已并入 {{ mergedClaimText(claim) }}</mat-chip>
            <mat-chip *ngIf="(claim.invalidatedApprovals?.length ?? 0) > 0">原会签 {{ claim.invalidatedApprovals?.length ?? 0 }} 步失效待复核</mat-chip>
          </div>
        </div>
        <div class="actions">
          <button mat-stroked-button><mat-icon>upload_file</mat-icon> 上传查勘材料</button>
          <button mat-flat-button color="primary" (click)="saveAll(claim)">保存本次查勘</button>
        </div>
      </div>

      <div class="summary-grid">
        <mat-card appearance="outlined"><span>损失科目</span><strong>{{ claim.lossItems.length }}</strong><small>{{ disputedCount(claim) }} 项存在争议 · 合成项 {{ mergedItemCount(claim) }}</small></mat-card>
        <mat-card appearance="outlined"><span>修复报价合计</span><strong>{{ quoteTotal(claim) | currency:'CNY':'symbol':'1.0-0' }}</strong><small>取各科目主案最新报价</small></mat-card>
        <mat-card appearance="outlined"><span>附件合计</span><strong>{{ attachmentTotal(claim) }}</strong><small>并案后来源附件不丢失</small></mat-card>
        <mat-card appearance="outlined"><span>建议准备金</span><strong>{{ claim.reserve | currency:'CNY':'symbol':'1.0-0' }}</strong><small>按主案免赔重算</small></mat-card>
      </div>

      <div class="assessment-grid">
        <section class="panel">
          <div class="panel-head"><h3>损失科目与报价版本</h3><span class="muted">重复科目已合成 · 金额依据并列</span></div>
          <mat-accordion multi>
            <mat-expansion-panel *ngFor="let item of claim.lossItems; let itemIndex = index" [expanded]="itemIndex === activeIndex" (opened)="activeIndex = itemIndex">
              <mat-expansion-panel-header>
                <mat-panel-title>
                  <strong>
                    {{ item.category }}
                    <mat-icon class="merge-ico" *ngIf="item.mergedFrom?.length" title="重复科目合成">join_full</mat-icon>
                  </strong>
                  <span>{{ item.description }}</span>
                </mat-panel-title>
                <mat-panel-description>
                  <app-status-chip [label]="item.disputed ? '争议项' : '已确认'" [tone]="item.disputed ? 'warn' : 'good'" />
                  <span class="quote">{{ latestQuote(item) | currency:'CNY':'symbol':'1.0-0' }}</span>
                </mat-panel-description>
              </mat-expansion-panel-header>
              <div class="loss-body">
                <div class="source-line" *ngIf="item.sourceClaimId">
                  <mat-icon>link</mat-icon> 来源案件 {{ item.sourceClaimId }}，整体并入主案并保留来源引用
                </div>
                <div class="source-line merged" *ngIf="item.mergedFrom?.length">
                  <mat-icon>join_full</mat-icon> 与 {{ mergedFromText(item) }} 的同科目合成为一项，下列金额依据并列保留
                </div>
                <div class="facts">
                  <label>损失事实</label>
                  <textarea [(ngModel)]="item.damage" rows="3"></textarea>
                  <div class="inline-fields">
                    <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>残值</mat-label><input matInput type="number" [(ngModel)]="item.salvage" /></mat-form-field>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>责任比例</mat-label><input matInput type="number" step="0.05" [(ngModel)]="item.liability" /></mat-form-field>
                  </div>
                </div>

                <div class="basis-block" *ngIf="item.amountBasis?.length">
                  <h4>并列金额依据（重复科目）</h4>
                  <div class="basis" *ngFor="let basis of item.amountBasis">
                    <span class="basis-source">{{ basis.sourceClaimId }} / {{ basis.sourceItemId }}</span>
                    <strong>{{ basis.amount | currency:'CNY':'symbol':'1.0-0' }}</strong>
                    <small>V{{ basis.version }} · {{ basis.operator }} · {{ basis.createdAt }} · {{ basis.reason }}</small>
                  </div>
                </div>

                <div class="quote-history">
                  <h4>主案报价版本</h4>
                  <table mat-table [dataSource]="item.repairQuotes">
                    <ng-container matColumnDef="version"><th mat-header-cell *matHeaderCellDef>版本</th><td mat-cell *matCellDef="let quote">V{{ quote.version }}</td></ng-container>
                    <ng-container matColumnDef="amount"><th mat-header-cell *matHeaderCellDef>金额</th><td mat-cell *matCellDef="let quote">{{ quote.amount | currency:'CNY':'symbol':'1.0-0' }}</td></ng-container>
                    <ng-container matColumnDef="reason"><th mat-header-cell *matHeaderCellDef>调整理由</th><td mat-cell *matCellDef="let quote">{{ quote.reason }}<small>{{ quote.operator }} · {{ quote.createdAt }}</small></td></ng-container>
                    <tr mat-header-row *matHeaderRowDef="quoteColumns"></tr>
                    <tr mat-row *matRowDef="let row; columns: quoteColumns"></tr>
                  </table>
                </div>
                <div class="attachment-row">
                  <strong>关联材料</strong>
                  <span *ngFor="let file of item.attachments" [class.from-source]="file.sourceClaimId">
                    <mat-icon>attach_file</mat-icon>{{ file.name }} · V{{ file.version }}
                    <i *ngIf="file.sourceClaimId">来自 {{ file.sourceClaimId }}</i>
                  </span>
                </div>
                <button mat-stroked-button color="primary" (click)="startQuote(item)"><mat-icon>edit_road</mat-icon> 调整最新报价</button>
                <div class="quote-form" *ngIf="quotingItemId === item.id">
                  <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>新报价</mat-label><input matInput type="number" [(ngModel)]="quoteAmount" /></mat-form-field>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic" class="reason-field"><mat-label>调整理由（必填）</mat-label><input matInput [(ngModel)]="quoteReason" /></mat-form-field>
                  <button mat-flat-button color="primary" [disabled]="!quoteReason.trim() || !quoteAmount" (click)="submitQuote(claim.id, item.id)">生成新版本</button>
                </div>
              </div>
            </mat-expansion-panel>
          </mat-accordion>
        </section>

        <aside>
          <section class="panel">
            <div class="panel-head"><h3>专家记录</h3><span class="muted">不可覆盖</span></div>
            <div class="expert-list">
              <div *ngFor="let item of claim.lossItems">
                <strong>{{ item.category }}</strong>
                <p *ngFor="let note of item.expertNotes">{{ note }}</p>
                <small *ngIf="item.expertNotes.length === 0">暂无专家补充说明</small>
              </div>
            </div>
          </section>
          <section class="panel draft-panel">
            <div class="panel-head"><h3>查勘草稿</h3><mat-icon>cloud_done</mat-icon></div>
            <textarea rows="7" [(ngModel)]="draft" (blur)="saveDraft(claim)"></textarea>
            <small>离开页面后仍可恢复到本地草稿。</small>
          </section>
        </aside>
      </div>
    </section>
  `,
  styles: [`
    .merge-tags { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
    .merge-tags .mat-mdc-chip-highlighted { background: #d9eaee; color: #1f6575; }
    .summary-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 12px; margin-bottom: 14px; }
    .summary-grid mat-card { padding: 15px; border-color: #dce3e6; }
    .summary-grid span, .summary-grid small { display: block; color: #6e7a83; font-size: 12px; }
    .summary-grid strong { display: block; margin: 6px 0; color: #153747; font-size: 24px; }
    .assessment-grid { display: grid; grid-template-columns: minmax(0,1fr) 330px; gap: 14px; align-items: start; }
    mat-panel-title { display: flex; flex-direction: column; gap: 4px; }
    mat-panel-title strong { display: flex; align-items: center; gap: 4px; }
    .merge-ico { font-size: 16px; width: 16px; height: 16px; color: #2f8191; }
    mat-panel-title span { color: #7a858c; font-size: 11px; }
    mat-panel-description { justify-content: flex-end; gap: 12px; }
    .quote { color: #1d6670; font-weight: 800; }
    .loss-body { display: grid; gap: 16px; padding-top: 10px; }
    .source-line { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-radius: 6px; background: #eef6f8; color: #235c6a; font-size: 11.5px; }
    .source-line.merged { background: #f0f4f8; color: #33556a; }
    .source-line mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .facts > label { display: block; margin-bottom: 6px; color: #53636d; font-size: 12px; font-weight: 700; }
    textarea { width: 100%; padding: 10px; border: 1px solid #cbd5da; border-radius: 8px; resize: vertical; font: inherit; }
    .inline-fields, .quote-form { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .inline-fields mat-form-field { width: 150px; }
    .basis-block { padding: 10px 12px; border: 1px dashed #b9d3da; border-radius: 8px; background: #f8fbfc; }
    .basis-block h4 { margin: 0 0 8px; font-size: 12.5px; }
    .basis { display: grid; grid-template-columns: 150px 130px minmax(0,1fr); gap: 8px; align-items: center; padding: 6px 0; border-top: 1px dashed #d6e2e6; }
    .basis:first-of-type { border-top: 0; }
    .basis-source { padding: 2px 8px; border-radius: 10px; background: #d9eaee; color: #1f6575; font-size: 10px; text-align: center; }
    .basis strong { color: #175866; font-size: 13px; }
    .basis small { color: #6d7982; font-size: 10.5px; line-height: 1.5; }
    .quote-history h4 { margin: 0 0 8px; font-size: 13px; }
    table { width: 100%; }
    td small { display: block; margin-top: 4px; color: #7a858c; }
    .attachment-row { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; }
    .attachment-row span { display: inline-flex; align-items: center; gap: 3px; padding: 5px 7px; color: #4f626d; background: #f0f4f5; border-radius: 5px; font-size: 11px; }
    .attachment-row span.from-source { background: #e3eff2; color: #1f6575; }
    .attachment-row span i { font-style: normal; color: #2f8191; font-size: 10px; }
    .attachment-row mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .quote-form { padding: 12px; background: #f4f7f8; border-left: 3px solid #277b89; }
    .reason-field { flex: 1; min-width: 220px; }
    aside { display: grid; gap: 14px; }
    .expert-list { padding: 8px 16px 16px; }
    .expert-list div { padding: 10px 0; border-bottom: 1px solid #edf0f2; }
    .expert-list p { margin: 6px 0 0; color: #65737c; font-size: 11px; line-height: 1.5; }
    .expert-list small { color: #8b969d; font-size: 11px; }
    .draft-panel { padding-bottom: 14px; }
    .draft-panel textarea { width: calc(100% - 28px); margin: 14px; }
    .draft-panel small { display: block; margin: -6px 14px 0; color: #7d8991; }
    @media (max-width: 1050px) { .assessment-grid { grid-template-columns: 1fr; } .summary-grid { grid-template-columns: repeat(2,1fr); } }
    @media (max-width: 620px) { .summary-grid { grid-template-columns: 1fr 1fr; } .basis { grid-template-columns: 1fr; } }
  `],
})
export class AssessmentPageComponent {
  claim$: Observable<ClaimCase>
  quoteColumns = ['version', 'amount', 'reason']
  activeIndex = 0
  quotingItemId = ''
  quoteAmount = 0
  quoteReason = ''
  draft = localStorage.getItem('claims-assessment-draft') ?? '待补充房屋檩条第三方复测依据，并核对存货库龄核减。'

  constructor(
    private readonly store: Store<AppState>,
    private readonly service: ClaimsService,
    private readonly snackBar: MatSnackBar,
  ) {
    this.claim$ = this.store.select(selectSelectedClaim)
    this.store.select((state) => state.claims.draft).subscribe((draft) => (this.draft = draft))
  }

  latestQuote(item: { repairQuotes: Array<{ amount: number }> }) {
    return item.repairQuotes.at(-1)?.amount ?? 0
  }

  quoteTotal(claim: { lossItems: Array<{ repairQuotes: Array<{ amount: number }> }> }) {
    return claim.lossItems.reduce((sum, item) => sum + this.latestQuote(item), 0)
  }

  attachmentTotal(claim: { lossItems: Array<{ attachments: unknown[] }> }) {
    return claim.lossItems.reduce((sum, item) => sum + item.attachments.length, 0)
  }

  mergedItemCount(claim: { lossItems: Array<{ mergedFrom?: unknown[] }> }) {
    return claim.lossItems.filter((item) => item.mergedFrom?.length).length
  }

  mergedFromText(item: { mergedFrom?: Array<{ claimId: string }> }) {
    return (item.mergedFrom ?? []).map((ref) => ref.claimId).join('、')
  }

  mergedClaimText(claim: ClaimCase) {
    return (claim.mergedFrom ?? []).join('、')
  }

  disputedCount(claim: { lossItems: Array<{ disputed: boolean }> }) {
    return claim.lossItems.filter((item) => item.disputed).length
  }

  startQuote(item: any) {
    this.quotingItemId = item.id
    this.quoteAmount = this.latestQuote(item)
    this.quoteReason = ''
  }

  submitQuote(claimId: string, itemId: string) {
    if (!this.quoteReason.trim()) return
    this.service.addQuote(claimId, { itemId, amount: Number(this.quoteAmount), reason: this.quoteReason }).subscribe((updatedClaim) => {
      // 接口返回写入后的最新案件，直接替换为当前版本（并案后也与引擎一致）
      this.store.dispatch(updateClaim({ claim: structuredClone(updatedClaim) }))
      this.snackBar.open('新报价版本已生成，原记录保持可追溯', '关闭', { duration: 2200 })
      this.quotingItemId = ''
    })
  }

  saveAll(claim: any) {
    localStorage.setItem('claims-assessment-draft', this.draft)
    this.store.dispatch(updateClaim({ claim: structuredClone(claim) }))
    this.snackBar.open('查勘数据和草稿已保存', '关闭', { duration: 1800 })
  }

  saveDraft(claim: any) {
    localStorage.setItem('claims-assessment-draft', this.draft)
    this.store.dispatch(updateClaim({ claim: structuredClone(claim) }))
  }
}
