# IDEA-07：個人資料擴充

> **狀態：✅ 已實作（2026-06-11）**。含 Alembic migration `d4e5f6a7b8c9`（nickname 以 name 回填 + 為既有管理身份組補授 `employee.identity.view`）。對應 PLAN.md § 3.1「提案中欄位」與 § 11 議題 8（已決策的 name/nickname 可見度分級）。

## 目標

擴充 `User` 個人資料欄位，並落實「真實姓名依權限分級顯示」規則。

## 新增欄位（User）

| 欄位 | 型別 | 說明 |
|------|------|------|
| `nickname` | string | 暱稱，對組織內所有人公開；建立時預設可取 `name` |
| `avatar_url` | string \| null | 頭像連結 |
| `note` | string \| null | 備註，僅管理者（`org.employee.manage`）可見/可編輯 |
| `hire_date` | date \| null | 入職日期 |

## 姓名可見度（議題 8，已決策）

- 新增權限位 `employee.identity.view`（加入 `core/permissions.py` 與前端權限選單）
- 回應 schema 新增 `display_name`：請求者具 `employee.identity.view`（或 `system.all`、或本人）→ 回 `name`；否則回 `nickname`
- 無權限者的回應中應隱藏 `name`（避免繞過）；`note` 同理僅對管理者回傳
- 前端所有顯示員工姓名處（/employees、/schedules 員工 Grid、手動排班側邊欄、/payroll）一律改用 `display_name`
- seed / migration：為既有管理職身份組（店長、組織管理者）補上 `employee.identity.view`

## 後端工作

1. Alembic migration：users 加 4 欄位（`nickname` 以 `name` 回填，設 NOT NULL）
2. `models/user.py`、`schemas/user.py`（`UserUpdate` / `UserResponse` + `display_name` 序列化邏輯，依請求者權限分流——建議在 router 層組裝 response）
3. `PATCH /users/me`：開放 `nickname` / `avatar_url`；`note` 僅管理者可改（`PATCH /users/{id}`）
4. 受影響端點：`GET /organizations/{org}/users`、`GET /users/{id}`、payroll 回應的 `user_name` 等

## 前端工作

1. `/employees` 個人資料分頁：新增 nickname / avatar / hire_date / note（管理者）欄位編輯
2. 全站姓名顯示改 `display_name`（`users-api.ts` 型別同步更新）
3. 頭像：暫以 URL 輸入（檔案上傳留待 MinIO/S3 整合）

## 驗證

- 以管理者帳號與一般員工帳號分別登入，確認姓名顯示分別為 `name` / `nickname`
- 一般員工回應 payload 中不含 `name` 與 `note`
- /employees 編輯各欄位後重新整理正確回填

## 開放問題

1. 員工清單排序依 `name` 還是 `display_name`？（建議 `display_name`）
2. `nickname` 是否要求組織內唯一？（建議不要求）
