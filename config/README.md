# Build configuration (`config/`)

This directory holds the single build-referenced application configuration for
HomeoClinic (task HC-MVP1-005). It supplies the business UPI id, payee/business
name, WhatsApp number, plan prices, support hours and the embedded ed25519
**public** verification keys that the client uses offline.

## Files

| File | Tracked in git? | Contents |
|---|---|---|
| `app-config.template.toml` | Yes | **Placeholders only.** Schema/shape reference. Safe to commit. |
| `README.md` | Yes | This document. |
| `app-config.local.toml` | **No** (gitignored) | The real values for a local/dev build. You create it. Never commit it. |

The committed `app-config.template.toml` contains **placeholder values only**.
Every secret or PII field is a visibly-fake placeholder (e.g.
`upi_id = "PLACEHOLDER_UPI_ID@examplebank"`, `whatsapp_e164 = "+910000000000"`,
keys `= "PLACEHOLDER_BASE64_ED25519_PUBKEY_32B_*"`). Real values are **never**
committed (R-SEC-005, PAY-015).

## How the build resolves real values

The future M0 build step (an embedding crate's `build.rs`, not part of this
task) resolves each field with this precedence, highest wins:

1. **Environment variables** — the locked CI / release runner (TAM-012)
   injects real values from its secret store, e.g. `HC_UPI_ID`,
   `HC_PAYEE_NAME`, `HC_WHATSAPP_E164`, `HC_LICENCE_PUB_CURRENT`,
   `HC_LICENCE_PUB_NEXT`, `HC_CONTENT_PUB_PUBLIC`, `HC_CONTENT_PUB_EVAL`.
   Nothing touches disk in the repo.
2. **`config/app-config.local.toml`** — an untracked file you create for a
   local/dev build, with the same shape as the template.
3. **`config/app-config.template.toml`** — the committed template. Used only
   as the schema/shape reference and to let a dev build *compile* with obvious
   placeholder values. A build using template placeholders is never shipped as
   a release.

The resolved values are compiled into the binary and compile-time encrypted
(TAM-003, PAY-015); they are not read from disk at runtime.

### Local/dev build

```
cp config/app-config.template.toml config/app-config.local.toml
# edit config/app-config.local.toml and fill real values
```

`app-config.local.toml` is gitignored (`config/app-config.local.toml` and
`config/*.local.*`). Do not remove those rules and do not force-add the file.

## Which fields are secret / PII

| Field | Class |
|---|---|
| `business.upi_id` | SECRET — real UPI credential (PAY-015). Placeholder in git. |
| `business.whatsapp_e164` | PII — phone number. Placeholder in git. |
| `business.payee_name` | Business identity. Placeholder until finalised. |
| `keys.licence_pub_current` / `licence_pub_next` | PUBLIC key — not a secret, but placeholder now (keys do not exist yet). |
| `keys.content_pub_public` / `content_pub_eval` | PUBLIC key — not a secret, placeholder now; the eval key is embedded in internal builds only (R-CONT-003/004). |
| `plans.*_paise` | Business pricing — placeholder values, safe to commit (PAY section 1). |
| `upi.currency` / `tn_template` / `tr_template` | Safe constants/templates. |
| `support.hours_label` / `timezone` | Safe public copy. |
| `keys.key_id_current`, `config_version` | Safe labels. |

The **private** ed25519 signing key is out of scope for this repo entirely: it
lives only on a hardware key or offline laptop and never appears in the repo or
CI (R-LIC-010). No private key, PIN, recovery code, DEK/KEK or real UPI
credential is ever committed.

## Real values are never committed

- Keep real UPI ids, phone numbers and private keys out of every tracked file.
- Supply them through environment variables (CI) or an untracked
  `app-config.local.toml` (local).
- A public-release gate fails if any shipped value still contains `PLACEHOLDER`,
  if `whatsapp_e164` is still `+910000000000`, or if the internal_eval content
  key appears in a public artifact (R-SEC-005, R-CONT-004).
