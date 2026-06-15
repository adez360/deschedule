# IDEA-12 員工帳號註冊 / 入職流程

## 需求（2026-06-15，使用者提案）

讓員工能「註冊帳號」——重新檢視員工怎麼取得登入帳密、由誰發起、怎麼啟用。

目標：降低管理者逐一設密碼的負擔，並避免管理者經手員工密碼造成的安全問題。

---

## 現況盤點

| 既有物件 | 現況 | 落差 |
|---|---|---|
| `POST /organizations/{org_id}/users`（`api/v1/organizations.py:163`） | 管理者建帳號，**直接在 body 帶 `password`**，後端 `hash_password` 後存 | 管理者得自己想一組密碼、明文傳給員工（LINE/口頭）；員工不一定會改 |
| `/employees` 快速新增對話框 | 表單含密碼欄，建立即啟用 | 同上：密碼由管理者經手 |
| `User.hashed_password` | `NOT NULL` | 沒有「已建帳號但尚未設密碼」的中間狀態 |
| `User.is_active` | soft-delete 用（啟用/停用） | 可重用為「尚未完成入職啟用」狀態，但目前語意是「在職與否」，需釐清是否混用 |
| `User.email` | `unique`、登入帳號 | 已可當邀請對象識別 |
| 登入 | NextAuth credentials + JWT（`/login`） | 只有登入,無註冊/入職頁 |

**沒有**任何邀請 token、入職頁、email/簡訊送達機制。

---

## 設計前提

加盟排班系統**不應開放自由註冊**——員工一定隸屬某個 organization / 門市,不能自己憑空冒出來。所以方向是「管理者發起、員工自己完成」,而非公開 sign-up。

---

## 提案流程（邀請制 invitation flow）

```
管理者建帳號(只填姓名 + email,不設密碼)
        │
   系統產生一次性 invite token(含期限),user is_active=False / 待啟用
        │
   邀請連結送到員工(送達方式見待決策 A)
        │
   員工開啟 /onboard?token=xxx → 驗 token → 自己設密碼 + 確認個資
        │
   啟用帳號(可登入),token 失效
```

關鍵效益:管理者**永遠不知道員工密碼**;員工首次登入就是自己設的。

---

## 待決策面向（提案階段,尚未定案）

### A. 邀請連結的送達方式
- **A1 先做「複製連結」**:管理者按一下複製邀請連結,自己用 LINE 貼給員工。零外部依賴、最快上線,之後再補 email/簡訊。**（建議起步）**
- A2 Email 寄送:需先接 email 服務(SMTP / SendGrid 等),較正式但多一層基礎設施;可併入 Phase 2「Email 通知系統」。
- A3 兩者都做:複製連結 + 自動寄 email,工作量最大。

### B. 註冊模式
- **B1 純邀請制**:管理者建帳號 → 員工收連結設密碼。最符合加盟場景,員工無法自行申請。**（建議）**
- B2 邀請制 + 機構碼自助:額外讓員工輸入門市/機構代碼自行申請,管理者再核准。彈性高但多一層審核流程,且有冒名申請風險。
- B3 維持現狀(管理者設密碼):不改流程。

### C. 「待啟用」狀態怎麼表示
- C1 重用 `is_active=False`:不加欄位,但會與既有 soft-delete(停用在職員工)語意混用 → 列表得區分「停用」vs「未啟用」。
- **C2 新增獨立狀態**:`User` 加 `invite_token` / `invite_expires_at`(nullable),`hashed_password` 改 nullable;「未啟用」= 有 token 且尚未設密碼。語意乾淨,與 `is_active` 分離。**（建議）**

### D. Token 機制與有效期
- D1 一次性 UUID token,設密碼後即作廢;預設有效期(例如 7 天),過期可由管理者重發。**（建議）**
- D2 永久連結(不過期):簡單但安全性差,連結外洩即可被冒用。
- 附帶:重發(重新產生 token)、撤銷(清掉 token)入口放在 `/employees` 列表。

### E. 入職時員工要填什麼
- E1 只設密碼(最低限度)。
- **E2 設密碼 + 確認/補齊基本個資**(姓名、暱稱、電話),管理者建帳號時只需 email + 姓名,其餘員工自己補。**（建議,減輕管理者負擔)**
- E3 設密碼 + 個資 + 直接引導去設可用時段(`/availability`,可串 IDEA-11 標準週表)。體驗最完整但流程較長。

### F. 安全性附加(選配)
- 密碼強度規則、重設密碼流程(忘記密碼)、是否要 email 驗證 / 手機驗證。
- 起步可先不做手機驗證;忘記密碼可沿用同一套 token 機制(寄重設連結)。

---

## 實作草圖（待決策後再動工）

1. **model**(C2 + D1):`User` 加 `invite_token: UUID | None`(unique)、`invite_expires_at: datetime | None`;`hashed_password` 改 nullable。Migration。
2. **建立端點調整**:`create_user` 不再收 `password`,改產生 token、`is_active`/待啟用狀態;回傳邀請連結。
3. **入職端點**:`GET /onboard/{token}`(驗 token、回基本資訊供顯示)、`POST /onboard/{token}`(設密碼 + 補個資 → 啟用、作廢 token)。**免登入存取**,只認 token。
4. **重發 / 撤銷**:`POST /organizations/{org_id}/users/{id}/resend-invite`(產新 token)。
5. **前端**:
   - `/employees` 快速新增拿掉密碼欄,改為「建立後顯示/複製邀請連結」;列表加「待啟用」badge + 重發/複製連結。
   - 新增 `/onboard` 頁(無需 session),設密碼表單 + 個資確認。
6. **(A2 若採用)** 接 email 服務,建帳號/重發時寄出邀請信。

---

## 關聯
- 入職可順勢引導員工設定 IDEA-11 的「標準週表」(`/availability`),一次完成帳號 + 常態可用時段。
- Email 送達(A2)與忘記密碼可併入 Phase 2「Email 通知系統」。
- 「待啟用」狀態需與 5.3.1 員工管理的 soft-delete(`is_active` 停用)在列表 UI 上明確區分。
- 權限沿用:建帳號 / 重發邀請需 `org.manage`(同現有 `create_user`)。

## ✅ 最終決策（2026-06-15）

**A1 + B1 + C2 + D1 + E2 + F（簡化）**

| 面向 | 選定 | 說明 |
|---|---|---|
| A 送達方式 | **A1** | 先做「複製連結」：建立 / 重發後回傳邀請連結，管理者自行用 LINE 等貼給員工。零外部依賴，email 待後續 |
| B 註冊模式 | **B1** | 純邀請制；員工無法自行申請，一律由管理者建帳號發起 |
| C 待啟用狀態 | **C2** | `User` 新增 `invite_token` / `invite_expires_at`，`hashed_password` 改 nullable；`is_pending = hashed_password IS NULL`，與 `is_active`（停用）分離 |
| D Token 機制 | **D1** | 一次性 UUID token，有效期 7 天（`INVITE_TTL_DAYS`）；onboard 完成即作廢；可重發 |
| E 入職內容 | **E2** | 員工設密碼 + 確認/補齊姓名、暱稱、電話；管理者建帳號只需姓名 + email |
| F 安全性 | **F（簡化）** | 不做 email/手機驗證；忘記密碼 = 管理者按「重設密碼」重發 token，員工經同一 `/onboard` 流程設新密碼 |

## ✅ 已實作（2026-06-15）

- **model**：`User` 新增 `invite_token`(unique index)、`invite_expires_at`；`hashed_password` 改 nullable
- **migration `b3c4d5e6f7a8`**：add 兩欄 + unique index、alter `hashed_password` nullable（已套用至 dev DB → head `b3c4d5e6f7a8`）
- **schemas**：`UserCreate` 移除 `password`；`UserResponse.is_pending`（`serialize_user` 由 `hashed_password is None` 算出）；新增 `InviteResponse`；新增 `schemas/onboarding.py`（`OnboardInfo` / `OnboardSubmit`）
- **API**：
  - `POST /organizations/{org}/users` 改回傳 `InviteResponse`（不收密碼、產 token、`is_active=True` + `hashed_password=None`）
  - `POST /organizations/{org}/users/{id}/resend-invite`（重發 / 密碼重設，需 `org.manage`）
  - **公開** `GET /onboard/{token}`（回基本資訊）、`POST /onboard/{token}`（設密碼 + 補個資 → 作廢 token + 啟用），新 router 註冊於 `api/v1/__init__.py`
  - `auth.login` 加 `hashed_password` None 防護（pending 帳號登入 → 401，非 500）
- **前端**：
  - `users-api.ts`：`createUser` 改回傳 `InviteResponse`、`UserCreateBody` 去 password；新增 `resendInvite`、`onboardUrl`、公開 `fetchOnboardInfo` / `submitOnboard`（不帶 token）
  - `UserDTO.is_pending`
  - `add-employee-dialog.tsx`：移除密碼欄；建立後切換到「邀請連結」步驟（唯讀連結 + 複製鈕 + 「再新增一位/完成」）
  - `employees/page.tsx`：清單列 + 詳情標題顯示「待啟用」amber badge；詳情標題加「邀請連結 / 重設密碼」鈕（`resendInvite` → 複製連結，`org.manage` 限定）
  - 新 `(auth)/onboard/page.tsx`：公開頁，沿用 login 視覺（漸層 + glow + 漸層邊框卡）；驗 token → 表單（email 唯讀、姓名/暱稱/電話預填、設密碼 + 確認）→ 啟用後導去 `/login`；token 無效/缺失顯示錯誤卡
  - `middleware.ts`：`/onboard` 列為公開路由
- **驗證**：端到端測過 — 建立 invite(is_pending=true) → 公開取資訊 → 設密碼(204) → 新帳號登入(200) → token 重用(404)；pending 帳號登入(401)；resend 作密碼重設 → 設新密碼(204) → 新密碼登入(200)

### 尚未做（後續）
- A2 email 自動寄送（待 Phase 2 通知系統）
- 入職完成後可選引導去設 IDEA-11 標準週表（目前結束即導去登入）

## 狀態
**已實作（2026-06-15）**
