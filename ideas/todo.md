# TODO（2026-06-15 盤點）

## 🟡 已實作、尚未 commit（2026-06-15）

- **IDEA-11 標準班表 + 每週自動提交可用時段**（決策 A2+B2+C1+D3+E1+F+G2，見 `ideas/IDEA-11.md`）：
  - `AvailabilityTemplate` 獨立表（每人一筆）；`Availability` 移除 `is_default_template`、新增 `auto_filled`
  - migration `a1b2c3d4e5f6`（**新 head**，已套用至 dev DB）：建表 + 欄位調整 + 搬移舊 default-template 列
  - API：`GET/PUT /users/me/availability-template` + 管理者 `/users/{id}/availability-template`
  - Celery：`tasks/availability.py::auto_submit_availability` + `worker.py` beat（週五 23:00 Asia/Taipei）；
    docker-compose 新增 `celery-beat` 服務（專案第一個排程任務）
  - `scheduler.py` fallback 改讀 `AvailabilityTemplate`
  - 前端：`/availability` 新增「標準週表」分頁 + 週檢視 `auto_filled` 標記
  - 驗證：task 邏輯端到端測過（建立下週 auto_filled 列、重跑不覆蓋）；worker 註冊 task、beat 已啟動
  - 後續：未設定名單通知（待 Email 系統）、管理者模板編輯 UI（API 已備、UI 待接）

- **IDEA-12 員工註冊／入職流程**（決策 A1+B1+C2+D1+E2+F 簡化，見 `ideas/idea-12-employee-registration-onboarding.md`）：
  - `User` 新增 `invite_token`(unique) + `invite_expires_at`；`hashed_password` 改 nullable
  - migration `b3c4d5e6f7a8`（**新 head**，已套用至 dev DB）
  - API：`POST /organizations/{org}/users` 改不收密碼、回傳 `InviteResponse`；`POST .../users/{id}/resend-invite`（重發／密碼重設）；公開 `GET/POST /onboard/{token}`；`auth.login` 防 null 密碼
  - 前端：`add-employee-dialog` 移密碼欄 + 複製邀請連結步驟；`/employees` 待啟用 badge + 邀請連結鈕；新 `(auth)/onboard` 公開頁；`middleware.ts` 白名單
  - 驗證：端到端 curl 測過（建立→取資訊→設密碼→登入→token 重用 404；pending 登入 401；resend 密碼重設→登入）
  - 後續：A2 email 自動寄送（待通知系統）、入職後可選引導去設標準週表

## ✅ 已完成並 commit

- **IDEA-10 全組織聯合排班**（`81b5a9c`）：`scheduler.py` → `load_org_inputs` + `run_greedy_org`；
  `POST /organizations/{org_id}/schedules/generate`；`Store.cross_group`（migration `f7a8b9c0d1e2`）+ `/settings/stores` UI
- **每位員工每日排班上限**（`81b5a9c`，IDEA-10 § H）：`User.daily_hour_max`（migration `e5f6a7b8c9d0`，
  NULL = 預設 8 小時，跨門市總和）；排班器納入 `daily_caps`；`/availability` 偏好分頁輸入框
- **員工管理頁面重新設計 5.3.1**（`54f9069`）：清單 search/filter/sort/pin/group/多選 + 快速新增 +
  停用切換（soft-delete）；詳細頁分頁（個人資料·合約·可用時段·班表歷史·權限·技能）
- **共用元件抽出**：`AvailabilityGrid`（`f714da7`）、`StorePreferences`（`4080022`）
- `stores.py` / `users.py` PATCH 改 `exclude_unset`（讓 nullable 欄位可被清空）

## 🔶 待處理

- [ ] 端到端驗證（多門市自動排班 + 跨店群組 + daily cap 上限）— 尚未在瀏覽器實測
- [ ] commit IDEA-11 + IDEA-12 變更
- [ ] IDEA-11 瀏覽器實測（標準週表分頁、auto_filled 標記、週五排程實際觸發）
- [ ] IDEA-12 瀏覽器實測（新增員工複製連結、`/onboard` 設密碼啟用、待啟用 badge、重設密碼）

---

## Phase 2 剩餘項目（PLAN.md §10）

- [ ] 班表 PDF 匯出
- [ ] Email 通知系統（含截止提醒）— **IDEA-11 的「未設定標準模板」名單通知併入此項**
- [ ] 門市管理頁面（清單 + 管理介面 + 班表檢視，含 `Store.manager_user_id` / `Store.color`，PLAN §5.3.3）
- [ ] 個人班表依門市分色檢視頁面（PLAN §5.3.2，可複用現有 iCal 機制）
      → 對應 **`ideas/IDEA-04.md`「個人班表檢視」**，目前該文件只有一行標題，需要展開規格
- [ ] employees 可用時段 tab 接上管理者模板編輯 UI（IDEA-11，API 已備）

---

## Phase 3 剩餘項目（PLAN.md §10）

- [ ] MILP 求解器整合（OR-Tools CP-SAT，取代 greedy）
- [ ] 跨週多週班表並排顯示
- [ ] 行動端 PWA 推播通知
- [ ] 薪資報表自動歸檔（班表 archived 時觸發 — 目前已有 `_create_payroll_reports()` 但需確認自動觸發是否完整）
- [ ] 多語系支援（zh-TW / en）
- [ ] 完整稽核日誌頁面（含鎖定後修改記錄）
- [ ] 效能調校與壓力測試
- [ ] AI 輔助班表審查（低優先度、唯讀、權限受限，PLAN §5.3.4，源自 `ideas/IDEA-01.md`）

---

## 開放議題（PLAN.md §11，待決策）

- [ ] **議題 1：最短連續工時** — 是否強制班次最少連續 2 小時？由組織或門市層級設定？

---

## 已完成（供參考，不需再做）

- Phase 1 全部完成（2026-06-05）
- 手動排班 v1 + IDEA-03 改版（跨日框選、批次指派/清除）
- 工時統計與薪資報表 IDEA-05 / IDEA-06（個人/門市雙視圖、加減項、home_store FT 歸屬）
- 個人資料擴充 IDEA-07（nickname/avatar/note/hire_date、`employee.identity.view` 顯示分級）
- 工作能力需求改版 IDEA-02（純標籤、與人數需求單表整合）
- 合約模型 v2/v3（依合約別分流、跨門市 org-level）
- JWT 過期自動登出、RoleGroup `store_ids[]` 多選範圍
