# Demo accounts — role onujayi login

App: **http://localhost:5173** · API: **http://localhost:5501/api/v1**
Password: **`Owner@12345`** (shob account e ek)

Ei table er protita line live API diye verify kora
(`node server/scripts/demo-role-accounts-verify.cjs`) — kono ta anuman noy.

| Email | Role | Permission | Ki dekhe |
|---|---|---|---|
| `owner@company.local` | Owner | 56 (shob) | shob space |
| `farhana@beautybooth.com.bd` | Admin | 53 | shob space |
| `tanvir@beautybooth.com.bd` | Admin + Engineering head | 53 | shob space |
| `nusrat@beautybooth.com.bd` | Member + Marketing head | 20 | shob space |
| `rakib@` `sadia@` `imran@` `mitu@` | Member + nijer dept er head | 20 | shob space |
| `arif@` `sumaiya@` `jhankar@` `priya@` | Member | 20 | shob space |
| **`guest@beautybooth.com.bd`** | **Guest** | **19** | shob space |
| **`marketing.only@beautybooth.com.bd`** | **Department Only** | **8** | **shudhu Marketing** |
| **`cs.only@beautybooth.com.bd`** | **Department Only** | **8** | **shudhu Customer Service** |

Bold gulo notun — age eituku missing chilo.

## Kon account e ki test korben

**Owner vs Admin** — Admin er `Settings > Roles` ache, kintu space/list **delete**
korte pare na (`space.delete` / `list.delete` shudhu Owner er). Ei 3-ta permission-i
tader parthokko.

**Guest vs Member** — matro ekta parthokko: Guest **file upload** korte pare na
(`attachment.upload`). Baki shob same. Eta apnar seeded default — chaile
`Settings > Roles > Guest` theke aro tighten korte paren.

**Department Only** ⭐ — ei duita account-i RBAC er asol proof. `marketing.only@`
diye login korle:

- Sidebar e **shudhu Marketing** — baki 7-ta department nei
- Search e onno department er kichu ase na
- **Onno department er task er URL/id janleo dekhte pare na** → 404
  (`node server/scripts/demo-role-idor-check.cjs` diye eta proof kora)
- Nijer je task banayni, sheta **edit** korte pare na (`task.edit` = own scope)

`cs.only@` same jinis, Customer Service er jonno.

⚠️ Ei duita account notun, tai tader **assign kora kono task nei** — Home page e
"my tasks" 0 dekhabe. Marketing er task gulo dekhte pabe, kintu nijer bole kichu
nei. Chaile owner account theke ekta task tader assign kore din, tarpor tader
diye login korun — tokhon Home o vore jabe.

## "Department Only" role ta ki

Notun ekta **custom role** (`Settings > Roles` e dekhben, pink color).
Seeded Member role ke ami **hat dei nai** — Member ke narrow korle apnar 22 jon
existing member-er access change hoye jeto. Tai alada role banano hoyeche:

| Permission | Scope |
|---|---|
| `space.view` | **space** ← main switch |
| `task.view` | space |
| `task.create` | space |
| `task.edit` | **own** |
| `comment.create` | space |
| `checklist.manage` | own |
| `member.view` | all |
| `assistant.use` | all |

Role tar scope `space`, ar assignment ta **Marketing space er vitore** — ei duita
mile bole shudhu Marketing dekhe. Ekhon ei role ta apni onno kauke onno space e
o assign korte paren, kono code lage na.

## Abar banate hole

```bash
cd server && NODE_ENV=dev npx tsx scripts/demo-role-accounts.ts
```

Script ta **additive ar idempotent** — existing kono user/role change kore na,
bar bar chalale kichu vange na.

## Ekta jinis mone rakhben

Chatbot ke jiggasha korle o eki niyom mane. `marketing.only@` diye login kore
🤖 button e "Engineering e koyta task ache?" jiggasha korle o oi data pabe na —
bot tar nijer permission diye porhe, apnar noy. Eta
`server/tests/assistant/scoping.test.ts` e proof kora ache.

---

*Verify scripts: `server/scripts/demo-role-accounts-verify.cjs` (permission table)
+ `server/scripts/demo-role-idor-check.cjs` (cross-department read probe). Duita
i ASCII-only output dey, terminal e Bangla dump kore na.*
