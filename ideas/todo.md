# TODO（2026-06-15 盤點）

## 🔶 待處理：目前 working tree 未提交的變更

實作看起來已完成，待確認後 commit：

- [ ] **IDEA-10 全組織聯合排班**：`scheduler.py` 重寫為 `load_org_inputs` + `run_greedy_org`；
      `POST /organizations/{org_id}/schedules/generate` 取代單店端點；
      `Store.cross_group`（跨店群組，migration `f7a8b9c0d1e2`）+ `/settings/stores` UI
- [ ] **每位員工每日排班上限（daily_hour_max，IDEA-10 § H）**：`User.daily_hour_max`（migration
      `e5f6a7b8c9d0`，NULL = 預設 8 小時，跨門市總和）；排班器已納入 `daily_caps`；
      `/availability` 偏好分頁新增輸入框（GET/PATCH `/users/me`）— 決策與實作記錄已補進 `ideas/IDEA-10.md` § H
- [ ] `stores.py` / `users.py` PATCH 改 `exclude_unset`（讓 nullable 欄位可被清空）
- [ ] 整理 `ideas/IDEA-03.md`（取代已刪除的 `IDEAS-03.md`）、`ideas/IDEA-04.md` 標題簡化
- [ ] 跑一次端到端驗證（多門市自動排班 + 跨店群組 + daily cap 上限），確認後 commit

---

## Phase 2 剩餘項目（PLAN.md §10）

- [ ] 班表 PDF 匯出
- [ ] Email 通知系統（含截止提醒）
- [ ] 預設時段模板（`is_default_template`）功能
- [ ] 員工管理頁面重新設計（多選 / 篩選 / 排序 / 搜尋 / 釘選 / 分組，PLAN §5.3.1）
- [ ] 門市管理頁面（清單 + 管理介面 + 班表檢視，含 `Store.manager_user_id` / `Store.color`，PLAN §5.3.3）
- [ ] 個人班表依門市分色檢視頁面（PLAN §5.3.2，可複用現有 iCal 機制）
      → 對應 **`ideas/IDEA-04.md`「個人班表檢視」**，目前該文件只有一行標題，需要展開規格

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
