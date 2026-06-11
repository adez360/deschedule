# 工時統計與薪資報表（IDEA-05）

> **狀態：✅ 完成實作並通過瀏覽器端到端驗證（2026-06-09）**

## 現況

後端已完成：
- `PayrollReport` model（`payroll_reports` 表）：`user_id`、`store_id`、`week_start`、`total_hours`、`contract_type`、`monthly_salary_snapshot`、`hourly_rate_snapshot`、`gross_pay`、`currency`、`note`
- `_create_payroll_reports()`：班表 `archived` 時自動觸發，依合約類型分流（FT 用 `monthly_salary`、PT 用 `hourly_rate × total_hours`、CUSTOM 跳過）

尚未實作：
- 查詢 API（列表 + 手動觸發）
- 前端報表頁面
- CSV 匯出

---

## 後端 API

### 新增路由

```
GET  /api/organizations/:orgId/payroll          # 組織層級，跨門市
GET  /api/stores/:storeId/payroll               # 單一門市
POST /api/stores/:storeId/payroll/generate      # 手動觸發（對已封存班表補算）
```

#### Query params（GET）
| 參數 | 說明 |
|------|------|
| `from` | 起始週（`YYYY-MM-DD`，週一） |
| `to` | 結束週（`YYYY-MM-DD`，週一） |
| `user_id` | 篩選特定員工（選填） |

#### Response schema（`PayrollReportResponse`）
```
id, user_id, user_name, store_id, store_name,
week_start, total_hours, contract_type,
monthly_salary_snapshot | hourly_rate_snapshot,
gross_pay, currency, generated_at, note
```

#### `POST /generate` 行為
- 接受 `week_start`（指定週次）
- 找到該門市該週的 `archived` 班表 → 呼叫 `_create_payroll_reports()`
- 若班表未封存（`draft`/`published`）→ 回傳 `409`
- 若薪資報表已存在 → 重新計算並覆寫（idempotent）

### 權限
- `GET` 需要 `employee.payroll.view`
- `POST /generate` 需要 `org.schedule.arrange` 或 `employee.payroll.view`

---

## 前端頁面

### 位置
側邊欄新增「薪資」分頁，路由 `/payroll`。

### 頁面結構

```
[門市選擇] [月份/週次範圍選擇]   [匯出 CSV] [手動計算]
──────────────────────────────────────────────────────
員工姓名   門市   週次      工時   合約   金額
張小明     門市A  2026-W23   24h   PT     4,320
張小明     門市B  2026-W23    8h   PT     1,440
────────────────────────────────── 小計   5,760
王大華     門市A  2026-W23   40h   FT    月薪（固定）
...
```

### 設計細節
1. **FT 顯示**：`gross_pay` 欄顯示月薪數字，`total_hours` 另一欄顯示工時（僅供參考），並在 `合約` 欄加注「FT（月薪制）」
2. **CUSTOM**：不產生薪資記錄，不顯示於報表（或可顯示工時但金額欄空白，待決策）
3. **跨門市彙總**：同一員工多筆記錄時，在每位員工最後一列顯示跨門市合計工時與合計薪資
4. **週次格式**：顯示 ISO 週次（`2026-W23`）+ 日期範圍（`6/1–6/7`）
5. **空狀態**：若所選期間無封存班表 → 提示「所選期間無已封存班表，請先封存班表或手動計算」

### CSV 匯出格式
```csv
員工姓名,員工ID,門市,週次,週起日,工時,合約類型,時薪快照,月薪快照,薪資小計,幣別,備註
張小明,uuid,門市A,2026-W23,2026-06-01,24,PT,180,,4320,TWD,
```
- 每列為一筆 `PayrollReport` 記錄
- 匯出範圍為當前頁面篩選條件所顯示的資料

### 手動計算
- 「手動計算」按鈕：選定門市 + 週次 → `POST /payroll/generate` → toast 顯示結果
- 僅在班表已封存時可操作；若班表尚未封存，按鈕 disabled 並顯示提示

---

## 實作順序

1. **後端**：`schemas/payroll.py`（`PayrollReportResponse`）→ `api/v1/payroll.py`（3 個路由）→ 掛進 `main.py`
2. **前端**：`src/lib/payroll-api.ts` → `/payroll/page.tsx`（表格 + 篩選 + CSV 匯出 + 手動計算按鈕）
3. **側邊欄**：`app-sidebar.tsx` 新增「薪資」項目

---

## 已決策（2026-06-09）

- **CUSTOM 合約員工**：顯示工時，`gross_pay` 欄空白（`—`）
- **篩選單位**：月份（當月 1 號至最後一天），不顯示週次
- **跨月份週次歸屬**：以 `week_start` 日期所在月份為準（`week_start` 落在哪個月就算哪個月）
