# Piezario API Specification

!!! warning "**DOCUMENTATION STATUS**"
    This document describes the **target** REST surface for the hosted
    platform. No endpoint below is implemented yet — the project is at
    Phase 0 (see [`roadmap.md`](../roadmap.md)). Where a decision is
    still open it is marked inline rather than silently resolved.

## API Overview

- Base path: `/api/v1`
- All request and response bodies are JSON, snake_case, except file
  upload (`multipart/form-data`) and login (`x-www-form-urlencoded`, to
  match FastAPI's OAuth2 password form).
- Timestamps are RFC 3339 UTC (`2026-08-09T00:00:00Z`).
- Identifiers are UUIDs. Examples truncate them (`cat1-…`).

## Authentication

Bearer JWT in the `Authorization` header. Tokens are HS256, carry only
`sub` (the user id) and `exp`, and last 7 days. There is no refresh
flow.

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

Endpoints are marked **Public**, **Authenticated**, **Catalog owner**,
**Catalog editor**, **Maintainer / admin** or **Admin**. "Catalog
owner" and "catalog editor" are relationships to one catalog, not
platform roles — see the permission matrix in
[`requirements.md`](../requirements.md#permission-matrix).

## Response Format

### Success

Data is returned directly, with no wrapper. List endpoints return
`{ items, total, limit, offset }`.

### Errors

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message.",
    "details": { }
  }
}
```

### Visibility and the 404 rule

A caller who may not see a catalog gets `404`, never `403`, on every
read path — the detail page, its projects, its files, its comments. A
leaked private link must be worthless (FR-170). `403` is reserved for
the case where the caller **can** see the resource but is not permitted
the action, which for downloads means: you can read the project's page,
you do not hold an entitlement for its files.

---

## API Endpoints

### 1. Authentication & Account

#### POST /auth/register

Self-register. **Public.**

**Request Body:**

```json
{
  "username": "ana",
  "email": "ana@example.com",
  "password": "securePassword123",
  "preferred_locale": "es"
}
```

**Response:** `201 Created`

```json
{
  "id": "usr1-…",
  "username": "ana",
  "email": "ana@example.com",
  "display_name": null,
  "role": "user",
  "storage_quota_bytes": 1073741824,
  "storage_used_bytes": 0,
  "preferred_locale": "es",
  "active": true,
  "created_at": "2026-08-09T00:00:00Z",
  "updated_at": "2026-08-09T00:00:00Z"
}
```

**Errors:** `409 USERNAME_TAKEN`, `409 EMAIL_TAKEN`,
`400 WEAK_PASSWORD`, `422 USERNAME_RESERVED`

> **Reserved usernames.** A user profile lives at `/{username}`, so the
> username namespace collides with the app's own routes. `settings`,
> `login`, `api`, `docs`, `admin` and friends are rejected at
> registration with `USERNAME_RESERVED`.

#### POST /auth/login

Exchange credentials for a token. **Public.** Accepts username or
email. Body is `application/x-www-form-urlencoded`.

**Response:** `200 OK`

```json
{ "access_token": "eyJ…", "token_type": "bearer" }
```

**Errors:** `401 INVALID_CREDENTIALS`, `403 INACTIVE_USER`,
`429 RATE_LIMITED`

| Method | Path | Description |
|---|---|---|
| `GET`  | `/auth/me` | Current user. **Authenticated.** |
| `PUT`  | `/auth/me/password` | `{ "current_password", "new_password" }`. |
| `POST` | `/auth/forgot-password` | `{ "email" }`. Always `204`, even for an unknown address (FR-008). |
| `POST` | `/auth/reset-password` | `{ "token", "new_password" }`. |
| `PUT`  | `/users/me` | Display name, bio, avatar, locale. |
| `POST` | `/users/me/deactivate` | Deactivate own account (FR-010). |

### 2. Users & Administration

| Method | Path | Description |
|---|---|---|
| `GET`    | `/users/{username}` | Public profile + public catalogs. **Public.** |
| `GET`    | `/users` | List/search users. **Maintainer / admin.** |
| `PUT`    | `/users/{id}/role` | `{ "role": "maintainer" }`. **Admin.** |
| `PUT`    | `/users/{id}/quota` | `{ "storage_quota_bytes": 5368709120 }`. **Maintainer / admin** (FR-057). |
| `POST`   | `/users/{id}/deactivate` | **Admin.** Blocked for the last active admin. |

**Errors:** `403 LOCKOUT_PROTECTION` when the change would leave no
active admin (FR-015).

### 3. Catalogs

#### POST /catalogs

Create a catalog. **Authenticated.**

**Request Body:**

```json
{
  "slug": "piezario",
  "name": "Piezario",
  "description": "Llaveros, sellos y litofanías.",
  "source_type": "hosted",
  "visibility": "public",
  "default_license": "CC BY-NC 4.0"
}
```

**Response:** `201 Created`

```json
{
  "id": "cat1-…",
  "owner_user_id": "usr1-…",
  "owner_username": "ana",
  "slug": "piezario",
  "name": "Piezario",
  "source_type": "hosted",
  "visibility": "public",
  "project_count": 0,
  "file_count": 0,
  "total_bytes": 0,
  "comments_enabled": true,
  "active": true,
  "created_at": "2026-08-09T00:00:00Z",
  "updated_at": "2026-08-09T00:00:00Z"
}
```

**Errors:** `409 CATALOG_SLUG_TAKEN`, `422 VALIDATION_ERROR`

#### GET /catalogs

List public catalogs. **Public.** A signed-in caller additionally sees
their own catalogs of every visibility, and catalogs they hold an
entitlement on.

**Query:** `search`, `owner`, `sort` (`recent` | `projects`), `limit`,
`offset`

#### GET /catalogs/{owner}/{slug}

Fetch one catalog by its public address. **Public**, subject to
visibility.

**Errors:** `404 CATALOG_NOT_FOUND` — returned both when it does not
exist and when the caller may not see it.

| Method | Path | Description |
|---|---|---|
| `PATCH`  | `/catalogs/{id}` | Name, description, visibility, license, comments, exclude/output dirs. **Catalog owner.** |
| `DELETE` | `/catalogs/{id}` | Soft delete (FR-033). **Catalog owner.** |
| `POST`   | `/catalogs/{id}/unpublish` | Force visibility to `private` with a reason. **Owner or maintainer** (FR-037). |
| `GET`    | `/catalogs/{id}/editors` | **Catalog owner / editor.** |
| `POST`   | `/catalogs/{id}/editors` | `{ "username": "bob" }`. **Catalog owner** (FR-027). |
| `DELETE` | `/catalogs/{id}/editors/{user_id}` | Owner removes; editor self-removes. |
| `POST`   | `/catalogs/{id}/transfer` | `{ "to_username": "bob" }`. **Catalog owner** (FR-028). |
| `POST`   | `/catalogs/transfers/{id}/accept` | **Transfer target.** |
| `POST`   | `/catalogs/transfers/{id}/decline` | **Transfer target.** |
| `POST`   | `/catalogs/{id}/report` | `{ "reason" }`. **Authenticated** (FR-036). |

### 4. Catalog Sources & Sync

#### POST /catalogs/{id}/source

Link a GitHub repository. **Catalog owner.** Only valid when
`source_type = "github"`.

**Request Body:**

```json
{
  "repo_url": "https://github.com/jcarranz97/3d-catalog",
  "branch": "main",
  "subdirectory": null
}
```

**Response:** `201 Created`

```json
{
  "id": "src1-…",
  "catalog_id": "cat1-…",
  "repo_url": "https://github.com/jcarranz97/3d-catalog",
  "branch": "main",
  "subdirectory": null,
  "lfs_enabled": false,
  "last_commit_sha": null,
  "last_synced_at": null,
  "last_status": "never_run",
  "last_error": null
}
```

**Errors:** `409 SOURCE_ALREADY_LINKED`, `422 REPO_URL_INVALID`,
`404 REPO_UNREACHABLE`, `403 INSTALLATION_REQUIRED`

> **Private repositories.** If the repository is private and no GitHub
> App installation covers it, this returns `403 INSTALLATION_REQUIRED`
> with `details.install_url` — the owner is sent to GitHub to install
> the App on that repository and comes back. Public repositories need no
> installation at all (FR-213).

#### GET /catalogs/{id}/sync-review

What the last sync changed, and what still needs a decision.
**Catalog owner / editor** (FR-223).

**Response:** `200 OK`

```json
{
  "sync_run_id": "syn1-…",
  "awaiting_review": 3,
  "changes": [
    {
      "id": "chg1-…",
      "kind": "created",
      "project_id": "mod9-…",
      "new_path": "keychains/halloween-bat",
      "is_draft": true,
      "access_level": "free"
    },
    {
      "kind": "moved",
      "project_id": "mod1-…",
      "previous_path": "keychains/mexico-jersey",
      "new_path": "keychains/mexico-2026",
      "match_confidence": 1.0,
      "resolved_at": "2026-08-09T00:00:41Z"
    },
    {
      "id": "chg3-…",
      "kind": "suspected_move",
      "candidate_project_id": "mod4-…",
      "previous_path": "stamps/leaf",
      "new_path": "stamps/leaf-v2",
      "match_confidence": 0.62
    }
  ]
}
```

A `moved` change arrives already `resolved_at` — it was confident, so
it was applied. A `suspected_move` has no `resolved_at` and both projects
still exist until the owner rules on it (FR-221).

| Method | Path | Description |
|---|---|---|
| `POST` | `/sync-changes/{id}/confirm-move` | Merge the new path into the candidate project, carrying identity, price and entitlements (FR-220). |
| `POST` | `/sync-changes/{id}/reject-move` | Treat it as a genuine removal plus a new draft. |
| `POST` | `/catalogs/{id}/projects/publish` | `{ "project_ids": [...] }` — bulk publish drafts (FR-223). |
| `PATCH` | `/catalogs/{id}` | Includes `new_project_policy`: `draft` \| `publish_free` (FR-218). |

#### GitHub App installation

| Method | Path | Description |
|---|---|---|
| `GET`    | `/github/install-url` | Returns the GitHub App installation URL with a signed `state`. **Authenticated.** |
| `GET`    | `/github/callback` | GitHub redirects here after install; exchanges `installation_id` and stores it. **Authenticated.** |
| `GET`    | `/github/installations` | The caller's installations and the repositories each covers. **Authenticated.** |
| `GET`    | `/github/installations/{id}/repositories` | Selectable repositories for the link form. |
| `DELETE` | `/github/installations/{id}` | Forget an installation locally. Does **not** uninstall on GitHub — only the owner can, from GitHub's own settings. |
| `POST`   | `/github/webhook` | GitHub App events: `push` → sync (FR-209); `installation`/`installation_repositories` → update or revoke. **Public**, signature-verified. |

**Response:** `GET /github/installations` → `200 OK`

```json
[
  {
    "id": "ins1-…",
    "account_login": "jcarranz97",
    "account_type": "user",
    "repository_selection": "selected",
    "repositories": [
      { "full_name": "jcarranz97/3d-catalog", "visibility": "private" }
    ],
    "suspended_at": null,
    "created_at": "2026-08-09T00:00:00Z"
  }
]
```

No token appears in this payload, or in any other. The platform stores
none to return (FR-205).

> **The webhook is the only public endpoint that mutates data.** It must
> verify GitHub's `X-Hub-Signature-256` HMAC against
> `GITHUB_WEBHOOK_SECRET` before parsing the body, and reject anything
> that fails — an unsigned webhook endpoint is a way to make the
> platform clone arbitrary repositories on demand.

#### POST /catalogs/{id}/sync

Trigger a sync. **Catalog owner.** Returns immediately; the sync runs
as a job (NFR-003).

**Response:** `202 Accepted`

```json
{ "sync_id": "syn1-…", "status": "running" }
```

**Errors:** `409 SYNC_ALREADY_RUNNING`, `409 NOT_A_GITHUB_CATALOG`

#### GET /catalogs/{id}/syncs/{sync_id}

Poll a sync. **Catalog owner.**

**Response:** `200 OK`

```json
{
  "id": "syn1-…",
  "status": "ok",
  "commit_sha": "b40d5f1…",
  "started_at": "2026-08-09T00:00:00Z",
  "finished_at": "2026-08-09T00:00:41Z",
  "trigger": "webhook",
  "projects_created": 41,
  "projects_updated": 0,
  "projects_moved": 0,
  "projects_suspected_moved": 0,
  "projects_removed": 0,
  "awaiting_review": 41,
  "files_imported": 388,
  "warnings": [
    {
      "code": "NO_GEOMETRY_IMPORTED",
      "message": "No printable files were found. This repository's .gitignore excludes *.stl and *.3mf, so projects will show without files and without cost figures.",
      "details": { "projects_without_geometry": 41 }
    }
  ],
  "error": null
}
```

> **`NO_GEOMETRY_IMPORTED` is the expected first result**, not an edge
> case (FR-046). Nearly every real maker repository gitignores its
> binaries. The response deliberately names the cause and the count so
> the UI can offer the two ways forward — commit through LFS, or attach
> hosted files (FR-050) — instead of leaving the owner to guess why
> their catalog looks empty.

### 5. Projects

#### GET /catalogs/{owner}/{slug}/projects

List a catalog's projects. **Public**, subject to visibility. Drafts are
included only for the owner and editors.

**Query:** `category` (path prefix), `tag`, `capability` (repeatable,
ANDed), `access` (`free` | `paid`), `search`, `limit`, `offset`

**Response:** `200 OK`

```json
{
  "items": [
    {
      "id": "mod1-…",
      "path": "keychains/mexico-jersey",
      "title": "Mexico jersey",
      "description": "Llavero de la jersey de México.",
      "categories": ["keychains"],
      "tags": ["2026", "mexico", "world-cup"],
      "capabilities": ["printable"],
      "access_level": "paid",
      "viewer_can_download": false,
      "cover_url": "/api/v1/files/fil9-…/inline",
      "has_readme": true,
      "is_draft": false,
      "declared_date": "2026-07-14",
      "content_updated_at": "2026-07-20T11:02:00Z"
    }
  ],
  "total": 41,
  "limit": 24,
  "offset": 0
}
```

`viewer_can_download` is computed per request for the calling user and
is the single field the UI needs to decide between a download button and
an access prompt (FR-176).

#### GET /projects/{id}

Full project detail. **Public**, subject to visibility.

**Response:** `200 OK`

```json
{
  "id": "mod1-…",
  "catalog_id": "cat1-…",
  "path": "keychains/keychain-viral-1",
  "title": "Clicker kit — 3 clickers + lip balm",
  "description": "Three printed clickers with their keycaps…",
  "body": "## Assembly\n\nBag the three clickers…",
  "categories": ["keychains"],
  "tags": ["clicker", "gift", "keychain", "kit"],
  "status": "idea",
  "declared_date": "2026-08-08",
  "materials": ["PLA"],
  "printers": ["Snapmaker U1"],
  "profiles": [],
  "source_url": null,
  "license": "personal",
  "access_level": "free",
  "capabilities": ["kit"],
  "yield_units": 1,
  "labor_minutes": 10,
  "labor_basis": "part",
  "failure_risk": "medium",
  "markup_percent": null,
  "discount_percent": null,
  "components": [
    {
      "component_project_id": "mod7-…",
      "path": "clickers/mx-clicker-base__lace-holes",
      "title": "MX clicker base",
      "quantity": 3,
      "include_parts": ["supplies", "labor"],
      "resolved": true
    }
  ],
  "supply_lines": [
    { "supply_key": "cadenita-de-color", "quantity": 1, "line_kind": "supply" },
    { "supply_key": "bolsa-de-carton", "quantity": 1, "line_kind": "packaging" }
  ],
  "files": [
    {
      "id": "fil3-…",
      "rel_path": "cover.jpeg",
      "kind": "image",
      "is_output": false,
      "size_bytes": 184320,
      "viewer_can_download": true,
      "protection": "protected"
    }
  ],
  "viewer_can_download": true,
  "viewer_can_edit": false,
  "content_updated_at": "2026-08-08T09:14:00Z"
}
```

| Method | Path | Description |
|---|---|---|
| `POST`   | `/catalogs/{id}/projects` | Create a project. **Catalog owner / editor.** Hosted catalogs only (FR-043). |
| `PATCH`  | `/projects/{id}` | Edit any metadata field. **Catalog owner / editor.** |
| `DELETE` | `/projects/{id}` | Soft delete. Blocked while a kit references it. |
| `PUT`    | `/projects/{id}/access` | `{ "access_level": "paid" }`. **Catalog owner** (FR-147). |
| `GET`    | `/projects/{id}/protection` | Per-file classification and a summary, for the owner's decision (FR-214, FR-215). **Catalog owner / editor.** |
| `POST`   | `/projects/{id}/move` | `{ "path": "keychains/new-name" }`. Leaves a redirect (FR-062). |

#### GET /projects/{id}/protection

What the download gate can actually enforce for this project. Shown before
a project is first marked paid, and whenever the mix changes.

**Response:** `200 OK`

```json
{
  "summary": { "protected": 6, "public_source": 0 },
  "repo_visibility": "public",
  "files": [
    { "rel_path": "dogcup.py", "protection": "public_source", "deliverable": false },
    { "rel_path": "out/dogcup.3mf", "protection": "protected", "deliverable": true }
  ],
  "notice": null
}
```

`protection` is derived, never declared (FR-214): `protected` when the
bytes are in our object storage or a private repository, `public_source`
when the same bytes sit in a public repository.

The example above is the **generator-only** case (FR-216) and is the
common one: the public repo holds `dogcup.py`, the printable `.3mf` is a
hosted attachment. Every deliverable is protected, `notice` is `null`,
and the UI shows no warning.

When deliverables *are* public, `notice` carries a plain-language
statement naming the count and the files, so the owner decides with
accurate information. The platform does **not** refuse the sale
(FR-210), and must never render a lock over a `public_source` file.

**Errors:** `409 PROJECT_REFERENCED_BY_KIT` with
`details.referencing_models`, `409 CATALOG_IS_READ_ONLY` when the
catalog is GitHub-backed (FR-043), `409 CONTRIBUTED_LICENSE_FORBIDS_PAID`
when marking a contributed project paid (FR-182).

### 6. Files, Uploads & Downloads

#### POST /catalogs/{id}/uploads

Upload files into a hosted catalog. **Catalog owner / editor.**
`multipart/form-data` with one or more `files` parts and an optional
`target_path`. A `.zip` is expanded and walked (FR-053).

**Response:** `202 Accepted`

```json
{
  "upload_id": "upl1-…",
  "accepted_bytes": 48211934,
  "status": "processing",
  "quota": {
    "used_bytes": 214748364,
    "quota_bytes": 1073741824,
    "remaining_bytes": 858993460
  }
}
```

**Errors:**

- `507 STORAGE_QUOTA_EXCEEDED` — `details` carries `quota_bytes`,
  `used_bytes` and `upload_bytes` so the message can name real numbers
  (FR-058, NFR-015)
- `413 FILE_TOO_LARGE` — one file over the per-file cap (FR-060)
- `415 EXTENSION_NOT_ALLOWED`
- `409 CATALOG_IS_READ_ONLY` — GitHub-backed, except for the
  hosted-attachment path (FR-050)
- `422 ARCHIVE_UNSAFE` — traversal, absolute path, symlink or
  decompression ratio over the ceiling (NFR-009)

The quota check runs **before any bytes are committed** (FR-058). An
upload that would cross the line is rejected whole; there is no partial
acceptance.

#### GET /files/{id}/download

Download one file. **Public**, subject to the download gate.

**Response:** `302 Found` with a `Location` pointing at a short-lived
signed object-storage URL, bound to that one key and filename (FR-168,
FR-169).

**Errors:**

- `404 FILE_NOT_FOUND` — the caller cannot see the catalog at all
- `403 ENTITLEMENT_REQUIRED` — the caller can see the project but not its
  files; `details` names the catalog and project so the UI can link to the
  redeem form
- `429 RATE_LIMITED` (FR-174)

| Method | Path | Description |
|---|---|---|
| `GET`    | `/files/{id}/inline` | Inline-served images, fonts, text (FR-086). |
| `GET`    | `/projects/{id}/archive` | Zip of every file the caller may download (FR-171). |
| `DELETE` | `/files/{id}` | **Catalog owner / editor.** Hosted files only. |
| `POST`   | `/projects/{id}/slice-summaries` | Bulk upsert slice summaries (FR-088, FR-192). **Catalog owner / editor.** |

#### POST /projects/{id}/slice-summaries

The endpoint the desktop client uses to publish cost figures without
uploading geometry (FR-192). Also the shape of the committed sidecar
the importer reads (FR-051).

**Request Body:**

```json
{
  "origin": "desktop",
  "summaries": [
    {
      "rel_path": "out/juanito1/order.gcode.3mf",
      "grams": 24.8,
      "seconds": 5340,
      "printer": "Snapmaker U1",
      "nozzle": "0.4",
      "filaments": [
        { "type": "PLA", "grams": 20.1, "color": "#f5c542" },
        { "type": "TPU", "grams": 4.7, "color": "#1a1a1a" }
      ]
    }
  ]
}
```

**Response:** `200 OK` — `{ "created": 1, "updated": 0, "skipped": 0 }`

`skipped` counts summaries refused because a `parsed` row already exists
for that path — a real sliced file always outranks a declaration about
one (FR-088).

### 7. Entitlements & Access Codes

#### POST /catalogs/{id}/entitlements

Grant access. **Catalog owner.** Not maintainers, not admins — the
owner and only the owner (FR-149).

**Request Body:**

```json
{
  "grantee_username": "bob",
  "project_id": "mod1-…",
  "expires_at": null,
  "note": "Paid via MercadoPago, order 4471"
}
```

`project_id: null` grants the whole catalog.

**Response:** `201 Created`

```json
{
  "id": "ent1-…",
  "catalog_id": "cat1-…",
  "project_id": "mod1-…",
  "grantee_user_id": "usr9-…",
  "grantee_username": "bob",
  "source": "manual",
  "expires_at": null,
  "revoked_at": null,
  "created_at": "2026-08-09T00:00:00Z"
}
```

**Errors:** `403 NOT_CATALOG_OWNER`, `404 USER_NOT_FOUND`,
`409 ENTITLEMENT_EXISTS`, `422 PROJECT_NOT_IN_CATALOG`

| Method | Path | Description |
|---|---|---|
| `GET`    | `/catalogs/{id}/entitlements` | Granted access, filterable by project and grantee. **Catalog owner** (FR-153). |
| `DELETE` | `/entitlements/{id}` | Revoke. **Granting catalog's owner** (FR-151). |
| `GET`    | `/me/entitlements` | Everything the caller holds (FR-154). **Authenticated.** |
| `GET`    | `/catalogs/{id}/ledger` | Per-project grant and download counts. **Catalog owner** (FR-165). |

#### POST /catalogs/{id}/access-codes

Issue a redeemable code. **Catalog owner.**

**Request Body:**

```json
{
  "project_id": "mod1-…",
  "max_redemptions": 1,
  "expires_at": "2026-12-31T23:59:59Z",
  "note": "Feria de Guadalajara"
}
```

**Response:** `201 Created`

```json
{
  "id": "acc1-…",
  "code": "K7QM-3XPT-9RHD-2WYF",
  "code_prefix": "K7QM",
  "catalog_id": "cat1-…",
  "project_id": "mod1-…",
  "max_redemptions": 1,
  "redemption_count": 0,
  "expires_at": "2026-12-31T23:59:59Z",
  "created_at": "2026-08-09T00:00:00Z"
}
```

> **`code` appears in this response and nowhere else, ever** (FR-157).
> Only its SHA-256 is stored. Every later read returns `code_prefix`
> alone. An issuer who loses the code revokes it and issues another —
> there is no recovery path, by design.

#### POST /access-codes/redeem

Redeem a code. **Authenticated** (FR-158).

**Request Body:** `{ "code": "K7QM-3XPT-9RHD-2WYF" }`

**Response:** `201 Created` — the resulting entitlement, with
`"source": "access_code"`.

**Errors:**

- `404 ACCESS_CODE_INVALID` — unknown code
- `410 ACCESS_CODE_EXPIRED`
- `409 ACCESS_CODE_EXHAUSTED` — redemption cap reached
- `410 ACCESS_CODE_REVOKED`
- `429 RATE_LIMITED` (FR-161)

Redeeming a code the caller already redeemed returns `200 OK` with the
existing entitlement rather than an error — redemption is idempotent per
user (FR-158).

| Method | Path | Description |
|---|---|---|
| `GET`    | `/catalogs/{id}/access-codes` | List issued codes (prefixes only). **Catalog owner.** |
| `DELETE` | `/access-codes/{id}` | Revoke an unredeemed code. Existing entitlements survive (FR-160). |

### 8. Inventory & Cost

Everything in this section is scoped to the calling user and is
invisible to everyone else, including maintainers and admins (FR-018,
FR-145).

| Method | Path | Description |
|---|---|---|
| `GET` / `PUT` | `/me/cost-settings` | The whole cost configuration (FR-129). |
| `GET` / `POST` | `/me/filaments` | List / create (FR-113). |
| `PATCH` / `DELETE` | `/me/filaments/{id}` | |
| `GET` / `POST` | `/me/supplies` | List / create (FR-116). |
| `PATCH` / `DELETE` | `/me/supplies/{id}` | |
| `GET` / `POST` | `/me/supplies/{id}/purchases` | Purchase history (FR-117). |
| `PATCH` / `DELETE` | `/me/purchases/{id}` | |
| `POST` | `/me/inventory/import` | Import from a `catalog.yaml` (FR-126). |
| `GET`  | `/me/inventory/export` | Export as `catalog.yaml`. |

#### GET /projects/{id}/cost

Compute the cost card for the calling user. **Authenticated.**

**Query:** `filament_key` (override the project's preferred filament)

**Response:** `200 OK`

```json
{
  "currency": "$",
  "groups": [
    {
      "name": "Estimate",
      "file_count": 1,
      "yield_units": 52,
      "rows": {
        "components": null,
        "filament": 0.0142,
        "machine": 0.0091,
        "supplies": 0.1421,
        "packaging": 0.04,
        "shipping": 0,
        "labor": 0.0321
      },
      "landed": 0.2375,
      "markup_percent": 70,
      "profit": 0.1663,
      "discount_percent": null,
      "discount": 0,
      "total": 0.4038,
      "tax_percent": 8,
      "tax": 0.0323,
      "price": 0.4361,
      "effective_markup_percent": 70,
      "unresolved_supplies": ["kit-de-placa-de-retroiluminacion-led"]
    }
  ],
  "notes": []
}
```

A row is `null` when its input is missing, and the UI hides it rather
than showing a zero (FR-144). `unresolved_supplies` lists identifiers
the project references that this viewer has no inventory row for — those
lines contribute nothing and say so (FR-119, FR-128).

**Errors:** `404 PROJECT_NOT_FOUND` (visibility), `204 No Content` when
there is nothing to price at all.

> **A guest never receives this endpoint's payload.** Cost figures are
> derived from the caller's private rates, so an unauthenticated request
> is `401`, not an anonymous estimate (FR-145).

| Method | Path | Description |
|---|---|---|
| `PUT` | `/projects/{id}/pricing` | `{ "markup_percent" }` or `{ "target_price" }` — the latter back-solves and saves (FR-142). **Catalog owner / editor.** |

### 9. Fonts & Icons

| Method | Path | Description |
|---|---|---|
| `GET`  | `/catalogs/{id}/fonts` | Specimen list with family, style, format (FR-103). |
| `GET`  | `/catalogs/{id}/icons` | Icon list with per-folder group metadata (FR-107). |
| `GET`  | `/icons/search` | Proxy an external public-domain library. **Authenticated** (FR-109). |
| `POST` | `/catalogs/{id}/icons` | Save a searched icon into a folder. **Catalog owner / editor** (FR-110). |

### 10. Contributions & Community

| Method | Path | Description |
|---|---|---|
| `POST`   | `/catalogs/{id}/contributions` | Submit a project to someone else's catalog (FR-177). |
| `GET`    | `/catalogs/{id}/contributions` | Review queue. **Catalog owner / editor.** |
| `POST`   | `/contributions/{id}/accept` | **Catalog owner / editor.** |
| `POST`   | `/contributions/{id}/reject` | **Catalog owner / editor.** Not terminal (FR-179). |
| `GET`/`POST` | `/contributions/{id}/thread` | The private review conversation (FR-180). |
| `GET`/`POST` | `/projects/{id}/comments` | Public comments, when the catalog allows them (FR-183). |
| `GET`    | `/projects/{id}/activity` | Timeline (FR-184). |

### 11. Profiles, Comments, Reactions & Notifications

Modelled on PrintForHelp's equivalents so the two products behave the
same way. `{entity_type}` is `project`, `catalog`, `comment` or
`contribution_review` depending on the endpoint.

#### Profiles

| Method | Path | Description |
|---|---|---|
| `GET` | `/users/{username}/profile` | Public profile: avatar + crop, bio, public catalogs, counts. **Public.** |
| `GET` | `/users/{username}/activity` | Timeline grouped by month, cursor-paginated (FR-236). **Public**, filtered to what the viewer may see (FR-238). |
| `GET` | `/users/{username}/calendar` | Per-day contribution density for a year (FR-237). **Public.** |
| `GET` | `/users/search` | Typeahead for @mentions and grants, capped (FR-239). **Authenticated.** |
| `PUT` | `/users/me` | Display name, full name, bio. |
| `PUT` | `/users/me/avatar` | `{ "avatar_url", "crop": { "x", "y", "w", "h" } }` (FR-231). |
| `PUT` | `/users/me/username` | Rename, subject to the cooldown (FR-234). |
| `PUT` | `/users/me/locale` | |
| `PUT` | `/users/me/flags/{key}` | Self-assignable **traits** only (FR-241). |
| `PUT` | `/users/{id}/flags/{key}` | Any key. **Admin.** |
| `PATCH` | `/username-changes/{id}` | `{ "hidden": true }`. **Maintainer / admin** (FR-235). |

**Errors:** `409 USERNAME_COOLDOWN` with `details.retry_after`,
`403 FLAG_NOT_SELF_ASSIGNABLE`, `422 BIO_TOO_LONG`.

#### Comments and reactions

| Method | Path | Description |
|---|---|---|
| `GET` | `/comments/{entity_type}/{entity_id}` | Cursor-paginated thread with replies nested one level (FR-243, FR-253). |
| `POST` | `/comments/{entity_type}/{entity_id}` | `{ "body", "parent_comment_id": null }`. **Authenticated.** |
| `PATCH` | `/comments/{id}` | Edit own comment; stamps `edited_at` (FR-244). |
| `DELETE` | `/comments/{id}` | Author, or the surface's owner / maintainer (FR-245). |
| `POST` | `/reactions/{entity_type}/{entity_id}` | `{ "reaction_type": "like" }`. Idempotent (FR-249). |
| `DELETE` | `/reactions/{entity_type}/{entity_id}` | Un-like. |
| `GET` | `/activity/{entity_type}/{entity_id}` | The entity's timeline (FR-254). |

Reaction state travels **with the entity**, never as a second request
(FR-250) — every project and comment payload carries:

```json
{
  "reactions": { "like": 12 },
  "viewer_reacted": ["like"],
  "comment_count": 4
}
```

#### Watches and notifications

| Method | Path | Description |
|---|---|---|
| `GET` / `POST` / `DELETE` | `/watches/{entity_type}/{entity_id}` | Read, subscribe, unsubscribe (FR-257). |
| `GET` | `/notifications` | Cursor-paginated feed. **Authenticated.** |
| `GET` | `/notifications/unread-count` | Cheap enough for a header badge (FR-270). |
| `POST` | `/notifications/read` | `{ "ids": [...] }` or `{ "all": true }`. |
| `GET` | `/notifications/preferences` | Per-category channel toggles. |
| `PUT` | `/notifications/preferences/{category}` | `{ "in_app_enabled", "email_enabled" }` (FR-262). |
| `POST` | `/notifications/unsubscribe` | Signed, no-login token. **Public** (FR-267). |

**Categories** (FR-259): `mention`, `comment`, `reaction`,
`project_updated`, `project_added`, `contribution_reviewed`,
`contribution_queue`, `sync_failed`, `entitlement_granted`,
`access_code_redeemed`.

> **Unsubscribe is a `POST`, never a `GET`** (FR-267). Corporate inbox
> scanners and link previewers follow every URL in an email; a `GET`
> unsubscribe endpoint means people are quietly unsubscribed by their
> own mail server. The emailed link opens a confirmation page that
> issues the `POST`.

### 11.1 Piezario-specific notification events

| Category | Fires when | Recipient |
|---|---|---|
| `entitlement_granted` | An owner grants access | The buyer (IR-005) |
| `access_code_redeemed` | Someone redeems a code | The issuing owner |
| `sync_failed` | A GitHub sync fails | The catalog owner (IR-004) |
| `contribution_queue` | A contribution is submitted | Catalog owner and editors |
| `contribution_reviewed` | Accepted or rejected | The contributor |
| `project_added` | A watched catalog gains a project | Watchers |
| `project_updated` | A watched project changes | Watchers |

### 12. System

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness. **Public.** |
| `GET` | `/version` | Build info. **Public.** |

---

## Error Codes

| Code | HTTP | Description |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Request validation failed |
| `WEAK_PASSWORD` | 400 | Fails the password policy (FR-002) |
| `INVALID_CREDENTIALS` | 401 | Bad username/email or password |
| `INVALID_TOKEN` | 401 | Missing, malformed or expired JWT |
| `INACTIVE_USER` | 403 | Account deactivated |
| `USERNAME_TAKEN` | 409 | |
| `USERNAME_RESERVED` | 422 | Collides with an application route |
| `EMAIL_TAKEN` | 409 | |
| `LOCKOUT_PROTECTION` | 403 | Would leave no active admin (FR-015) |
| `CATALOG_NOT_FOUND` | 404 | Missing **or** invisible to the caller (FR-170) |
| `CATALOG_SLUG_TAKEN` | 409 | Slug already used by this owner |
| `NOT_CATALOG_OWNER` | 403 | Owner-only action attempted by another user |
| `NOT_CATALOG_EDITOR` | 403 | Edit attempted without owner/editor rights |
| `CATALOG_IS_READ_ONLY` | 409 | GitHub-backed content edited in the UI (FR-043) |
| `SOURCE_ALREADY_LINKED` | 409 | |
| `NOT_A_GITHUB_CATALOG` | 409 | Sync requested on a hosted catalog |
| `REPO_URL_INVALID` | 422 | |
| `REPO_UNREACHABLE` | 404 | Clone failed at the network level |
| `INSTALLATION_REQUIRED` | 403 | Private repo with no GitHub App installation (FR-204) |
| `INSTALLATION_REVOKED` | 403 | App uninstalled or repo deselected (FR-208) |
| `INSTALLATION_PENDING_APPROVAL` | 409 | Org install awaiting an admin (FR-212) |
| `WEBHOOK_SIGNATURE_INVALID` | 401 | Failed HMAC verification |
| `SYNC_ALREADY_RUNNING` | 409 | |
| `PROJECT_NOT_FOUND` | 404 | Missing or invisible |
| `PROJECT_NOT_IN_CATALOG` | 422 | Entitlement or component scope mismatch |
| `PROJECT_REFERENCED_BY_KIT` | 409 | Delete blocked (FR-080) |
| `CONTRIBUTED_LICENSE_FORBIDS_PAID` | 409 | (FR-182) |
| `FILE_NOT_FOUND` | 404 | Missing or invisible |
| `ENTITLEMENT_REQUIRED` | 403 | Visible project, withheld files (FR-170) |
| `ENTITLEMENT_EXISTS` | 409 | Duplicate live grant |
| `ENTITLEMENT_NOT_FOUND` | 404 | |
| `ACCESS_CODE_INVALID` | 404 | Unknown code |
| `ACCESS_CODE_EXPIRED` | 410 | |
| `ACCESS_CODE_EXHAUSTED` | 409 | Redemption cap reached |
| `ACCESS_CODE_REVOKED` | 410 | |
| `FILE_TOO_LARGE` | 413 | Over the per-file cap |
| `EXTENSION_NOT_ALLOWED` | 415 | |
| `ARCHIVE_UNSAFE` | 422 | Traversal, symlink or decompression bomb |
| `STORAGE_QUOTA_EXCEEDED` | 507 | Over the owner's quota (FR-058) |
| `RATE_LIMITED` | 429 | |
| `INTERNAL_SERVER_ERROR` | 500 | |

## Rate Limiting

| Endpoint | Limit |
|---|---|
| `POST /auth/login` | 10/minute |
| `POST /auth/register` | 5/minute |
| `POST /auth/forgot-password` | 5/minute |
| `POST /access-codes/redeem` | 5/minute per account, 20/hour per IP |
| `GET /files/{id}/download` | 60/minute per account, 120/minute per IP |

Access-code redemption is limited harder than login because a code is a
guessable secret in a way a session token is not (FR-161).

## Data Validation Rules

**Identifiers.** Usernames are 3–64 characters, `[a-z0-9_-]`,
case-insensitively unique, and checked against the reserved list.
Catalog slugs are 1–80 characters, `[a-z0-9-]`. Inventory keys are
normalized to lower-kebab on write (FR-127).

**Paths.** A project path is `/`-joined segments, each 1–100 characters,
with no `.` or `..` segment and no leading slash. File paths may contain
spaces and `+` and are encoded per segment (FR-094).

**Quantities.** Component quantities are integers ≥ 1. Supply-line
quantities are decimals > 0. `yield` is an integer ≥ 1. Percentages are
decimals ≥ 0 and are not capped — a 300% markup is legitimate.

**URLs.** `source_url` and purchase URLs must be absolute `http(s)`.
Everything else may be site-relative.

---

## API Usage Examples

### End-to-end: selling one project

```javascript
// 1. Ana creates a hosted catalog.
const catalog = await api("POST", "/catalogs", {
  slug: "piezario", name: "Piezario",
  source_type: "hosted", visibility: "public",
});

// 2. She uploads a folder as a zip. The walker turns it into projects.
const upload = await api.upload(`/catalogs/${catalog.id}/uploads`, zipFile);
console.log(upload.quota.remaining_bytes);   // → 858993460

// 3. One project becomes paid. It stays visible; only files are withheld.
await api("PUT", `/projects/${project.id}/access`, { access_level: "paid" });

// 4. A guest can still read the page…
const page = await api("GET", `/projects/${project.id}`, null, { auth: false });
console.log(page.viewer_can_download);       // → false

// 5. …but not the file.
await api("GET", `/files/${file.id}/download`, null, { auth: false });
// → 403 ENTITLEMENT_REQUIRED

// 6. Bob pays Ana over WhatsApp. Ana grants him access herself —
//    no admin, no gateway.
await api("POST", `/catalogs/${catalog.id}/entitlements`, {
  grantee_username: "bob",
  project_id: project.id,
  note: "Paid via MercadoPago, order 4471",
});

// 7. Bob downloads.
const res = await api("GET", `/files/${file.id}/download`, null, { as: bob });
console.log(res.status);                     // → 302, signed URL in Location

// 8. Ana checks her ledger.
const ledger = await api("GET", `/catalogs/${catalog.id}/ledger`);
console.log(ledger[0]);  // → { title: "…", live_grants: 1, downloads: 1 }
```

### Selling at a fair, with codes instead of usernames

```javascript
// 1. Ana prints 50 cards, each with one single-use code.
const codes = [];
for (let i = 0; i < 50; i += 1) {
  const c = await api("POST", `/catalogs/${catalog.id}/access-codes`, {
    project_id: project.id, max_redemptions: 1, note: "Feria de Guadalajara",
  });
  codes.push(c.code);        // ← the ONLY time the code is ever readable
}

// 2. A buyer redeems at home, after signing up.
const ent = await api("POST", "/access-codes/redeem", { code: codes[0] });
console.log(ent.source);     // → "access_code"

// 3. Redeeming twice is idempotent, not an error.
const again = await api("POST", "/access-codes/redeem", { code: codes[0] });
console.log(again.id === ent.id);            // → true

// 4. A second buyer trying the same card is refused.
await api("POST", "/access-codes/redeem", { code: codes[0] }, { as: carla });
// → 409 ACCESS_CODE_EXHAUSTED
```

### Publishing cost figures without uploading geometry

```javascript
// The desktop client slices locally, then publishes only the numbers.
await api("POST", `/projects/${project.id}/slice-summaries`, {
  origin: "desktop",
  summaries: [{
    rel_path: "out/estimate/plate.gcode.3mf",
    grams: 24.8, seconds: 5340,
    printer: "Snapmaker U1", nozzle: "0.4",
    filaments: [{ type: "PLA", grams: 24.8, color: "#f5c542" }],
  }],
});

// The cost card now works for every viewer, from their own rates,
// while the 33 MB .3mf never left the maker's laptop.
const cost = await api("GET", `/projects/${project.id}/cost`);
console.log(cost.groups[0].landed);
```
