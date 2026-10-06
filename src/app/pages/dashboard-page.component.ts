import { Component } from '@angular/core'
import { CommonModule, CurrencyPipe } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Router } from '@angular/router'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatIconModule } from '@angular/material/icon'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatTableModule } from '@angular/material/table'
import { Store } from '@ngrx/store'
import type { Observable } from 'rxjs'
import { StatusChipComponent } from '../shared/status-chip.component'
import type { ClaimCase } from '../core/models'
import {
  selectAllClaims,
  selectFilters,
  selectFilteredClaims,
  selectCandidateCount,
  selectUnresolvedConflictCount,
  selectClaim,
  setFilters,
  type AppState,
} from '../core/claims.store'

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CurrencyPipe,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    StatusChipComponent,
  ],
  template: `
    <section class="page">
      <div class="page-head">
        <div>
          <p class="eyebrow">CLAIMS CONTROL / 理赔控制</p>
          <h1>财产险案件总览</h1>
          <p class="muted">并案后准备金不再重复计提；下列口径与审批页、审计时间线一致。</p>
        </div>
        <div class="actions">
          <button mat-stroked-button routerLink="/merges"><mat-icon>join_full</mat-icon> 并案处理</button>
          <button mat-flat-button color="primary" (click)="openFirst()"><mat-icon>fact_check</mat-icon> 继续查勘</button>
        </div>
      </div>

      <div class="merge-banner panel" *ngIf="candidateCount$ | async as candidateCount">
        <mat-icon>join_full</mat-icon>
        <div class="banner-text">
          <strong>{{ candidateCount }} 对疑似同事故案件待并案</strong>
          <p>按事故日、地址、保单与证据命中；先冻结快照再选主案，合并可撤销。</p>
        </div>
        <span class="conflict-pill" *ngIf="(conflictCount$ | async) as conflictCount">{{ conflictCount }} 个未决并发分歧</span>
        <button mat-flat-button color="primary" routerLink="/merges">前往并案</button>
      </div>

      <div class="metrics">
        <mat-card appearance="outlined"><span>在办案件</span><strong>{{ (claims$ | async)?.length }}</strong><small>{{ mergedCount$ | async }} 件为并案主案</small></mat-card>
        <mat-card appearance="outlined"><span>申请准备金</span><strong>{{ totalReserve$ | async | currency:'CNY':'symbol':'1.0-0' }}</strong><small>并案后已去重</small></mat-card>
        <mat-card appearance="outlined"><span>待会签步骤</span><strong>{{ pendingApprovals$ | async }}</strong><small>含并案后重算会签</small></mat-card>
        <mat-card appearance="outlined"><span>失效会签待复核</span><strong class="warn">{{ invalidApprovals$ | async }}</strong><small>并案导致原会签失效</small></mat-card>
        <mat-card appearance="outlined"><span>争议科目</span><strong class="warn">{{ disputedItems$ | async }}</strong><small>需补充证据</small></mat-card>
        <mat-card appearance="outlined"><span>未决并案分歧</span><strong class="warn">{{ conflictCount$ | async }}</strong><small>后到者选择已保留</small></mat-card>
      </div>

      <div class="dashboard-grid">
        <section class="panel">
          <div class="panel-head">
            <h3>案件队列</h3>
            <span class="muted">被并入来源案不重复列示 · {{ (filteredClaims$ | async)?.length }} 条</span>
          </div>
          <div class="filters">
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>搜索案件/被保险人</mat-label>
              <input matInput [ngModel]="(filters$ | async)?.query" (ngModelChange)="updateFilter('query', $event)" />
              <mat-icon matSuffix>search</mat-icon>
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>状态</mat-label>
              <mat-select [ngModel]="(filters$ | async)?.status" (ngModelChange)="updateFilter('status', $event)">
                <mat-option value="">全部状态</mat-option>
                <mat-option value="查勘中">查勘中</mat-option>
                <mat-option value="待复核">待复核</mat-option>
                <mat-option value="退回补件">退回补件</mat-option>
                <mat-option value="审批中">审批中</mat-option>
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>风险等级</mat-label>
              <mat-select [ngModel]="(filters$ | async)?.risk" (ngModelChange)="updateFilter('risk', $event)">
                <mat-option value="">全部等级</mat-option>
                <mat-option value="高">高风险</mat-option>
                <mat-option value="中">中风险</mat-option>
                <mat-option value="低">低风险</mat-option>
              </mat-select>
            </mat-form-field>
          </div>
          <div class="table-wrap">
            <table mat-table [dataSource]="(filteredClaims$ | async) ?? []">
              <ng-container matColumnDef="case">
                <th mat-header-cell *matHeaderCellDef>案件 / 保单</th>
                <td mat-cell *matCellDef="let claim">
                  <strong>{{ claim.id }}
                    <mat-icon class="merged-icon" *ngIf="claim.mergedFrom?.length" title="并案主案">join_full</mat-icon>
                  </strong>
                  <small>{{ claim.policyNo }}<span *ngIf="claim.mergedFrom?.length"> · 已并入 {{ claim.mergedFrom.join('、') }}</span></small>
                </td>
              </ng-container>
              <ng-container matColumnDef="insured">
                <th mat-header-cell *matHeaderCellDef>被保险人</th>
                <td mat-cell *matCellDef="let claim">
                  <strong>{{ claim.insured }}</strong>
                  <small>{{ claim.adjuster }}</small>
                </td>
              </ng-container>
              <ng-container matColumnDef="reserve">
                <th mat-header-cell *matHeaderCellDef>准备金</th>
                <td mat-cell *matCellDef="let claim">{{ claim.reserve | currency:'CNY':'symbol':'1.0-0' }}</td>
              </ng-container>
              <ng-container matColumnDef="risk">
                <th mat-header-cell *matHeaderCellDef>风险</th>
                <td mat-cell *matCellDef="let claim"><app-status-chip [label]="claim.riskLevel + '风险'" [tone]="claim.riskLevel === '高' ? 'warn' : claim.riskLevel === '中' ? 'default' : 'good'" /></td>
              </ng-container>
              <ng-container matColumnDef="status">
                <th mat-header-cell *matHeaderCellDef>状态</th>
                <td mat-cell *matCellDef="let claim"><app-status-chip [label]="claim.status" [tone]="claim.status === '待复核' || claim.status === '退回补件' ? 'warn' : 'good'" /></td>
              </ng-container>
              <ng-container matColumnDef="action">
                <th mat-header-cell *matHeaderCellDef></th>
                <td mat-cell *matCellDef="let claim"><button mat-button color="primary" (click)="open(claim.id)">处理</button></td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="columns"></tr>
              <tr mat-row *matRowDef="let row; columns: columns"></tr>
            </table>
          </div>
        </section>

        <aside class="panel risk-panel">
          <div class="panel-head"><h3>并案处理规则</h3><span class="muted">可撤销事务</span></div>
          <div class="rule-list">
            <div><span>候选依据</span><strong>事故日 / 地址 / 保单 / 证据</strong></div>
            <div><span>合并前置</span><strong>冻结两案快照</strong></div>
            <div><span>重复科目</span><strong>合成一项 · 依据并列</strong></div>
            <div><span>准备金</span><strong>按主案免赔重算</strong></div>
            <div><span>原会签</span><strong>失效并挂待复核</strong></div>
            <div><span>并发确认</span><strong>先到生效 · 后到留分歧</strong></div>
          </div>
          <div class="risk-note">
            <mat-icon>info</mat-icon>
            <div><strong>失败与撤销都以快照恢复</strong><p>恢复原案、旧会签和全部附件，候选、处理记录与未决冲突重开页面后仍在。</p></div>
          </div>
        </aside>
      </div>
    </section>
  `,
  styles: [`
    .merge-banner { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; padding: 12px 16px; background: #f0f7f8; border-color: #bcd9df; }
    .merge-banner mat-icon { color: #2f8191; }
    .banner-text strong { font-size: 13px; color: #16485a; }
    .banner-text p { margin: 3px 0 0; font-size: 11.5px; color: #5c7079; }
    .conflict-pill { margin-left: auto; padding: 5px 10px; border-radius: 12px; background: #c4613b; color: #fff; font-size: 11px; font-weight: 700; }
    .metrics { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 12px; margin-bottom: 14px; }
    .metrics mat-card { padding: 16px; border-color: #dce3e6; }
    .metrics span, .metrics small { display: block; color: #6e7a83; font-size: 12px; }
    .metrics strong { display: block; margin: 7px 0; color: #153747; font-size: 26px; }
    .warn { color: #b95c2c !important; }
    .dashboard-grid { display: grid; grid-template-columns: minmax(0,1fr) 290px; gap: 14px; }
    .filters { display: grid; grid-template-columns: minmax(220px,1fr) 150px 130px; gap: 10px; padding: 12px 14px 4px; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; min-width: 760px; }
    td strong, td small { display: block; }
    td strong { display: flex; align-items: center; gap: 4px; }
    .merged-icon { font-size: 16px; width: 16px; height: 16px; color: #2f8191; }
    td small { margin-top: 4px; color: #7b8790; }
    .risk-panel { align-self: start; }
    .rule-list { padding: 6px 16px; }
    .rule-list div { display: flex; justify-content: space-between; gap: 8px; padding: 10px 0; border-bottom: 1px solid #edf0f2; font-size: 12px; }
    .rule-list span { color: #6d7982; }
    .risk-note { display: flex; gap: 9px; margin: 4px 14px 14px; padding: 12px; color: #1f4e5d; background: #eaf4f5; border-left: 3px solid #2f8191; }
    .risk-note p { margin: 5px 0 0; font-size: 11px; line-height: 1.55; }
    @media (max-width: 1050px) { .dashboard-grid { grid-template-columns: 1fr; } .metrics { grid-template-columns: repeat(2,1fr); } }
    @media (max-width: 680px) { .filters { grid-template-columns: 1fr; } .metrics { grid-template-columns: 1fr 1fr; } .conflict-pill { margin-left: 0; } }
  `],
})
export class DashboardPageComponent {
  claims$: Observable<ClaimCase[]>
  filteredClaims$: Observable<ClaimCase[]>
  filters$: Observable<import('../core/models').ClaimFilters>
  totalReserve$: Observable<number>
  pendingApprovals$: Observable<number>
  disputedItems$: Observable<number>
  invalidApprovals$: Observable<number>
  mergedCount$: Observable<number>
  candidateCount$: Observable<number>
  conflictCount$: Observable<number>
  columns = ['case', 'insured', 'reserve', 'risk', 'status', 'action']

  constructor(
    private readonly store: Store<AppState>,
    private readonly router: Router,
  ) {
    this.claims$ = this.store.select(selectAllClaims)
    this.filteredClaims$ = this.store.select(selectFilteredClaims)
    this.filters$ = this.store.select(selectFilters)
    this.totalReserve$ = this.store.select((state) => state.claims.items.reduce((sum, claim) => sum + claim.reserve, 0))
    this.pendingApprovals$ = this.store.select((state) =>
      state.claims.items.reduce((sum, claim) => sum + claim.approvals.filter((step) => step.status === '待处理').length, 0),
    )
    this.disputedItems$ = this.store.select((state) => state.claims.items.reduce((sum, claim) => sum + claim.lossItems.filter((item) => item.disputed).length, 0))
    this.invalidApprovals$ = this.store.select((state) =>
      state.claims.items.reduce((sum, claim) => sum + (claim.invalidatedApprovals?.length ?? 0), 0),
    )
    this.mergedCount$ = this.store.select((state) => state.claims.items.filter((claim) => claim.mergedFrom?.length).length)
    this.candidateCount$ = this.store.select(selectCandidateCount)
    this.conflictCount$ = this.store.select(selectUnresolvedConflictCount)
  }

  updateFilter(key: string, value: string) {
    this.store.dispatch(setFilters({ filters: { [key]: value, page: 1 } }))
  }

  open(id: string) {
    this.store.dispatch(selectClaim({ id }))
    this.router.navigate(['/assessment'])
  }

  openFirst() {
    this.router.navigate(['/assessment'])
  }
}
