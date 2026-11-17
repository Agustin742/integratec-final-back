# Private classroom study material

Staff upload classroom files; current staff and students discover metadata and request short-lived signed downloads. Logical removal hides material and prevents fresh download requests without deleting the author, history or private object. Parents receive no new permission.

Implementation is additive and uses the existing shared access service and `StoragePort`/S3 adapter. Local Linux Node 22 verification passed 34 material HTTP tests, 10 OpenAPI tests and the full 1,879-test workspace suite. Independent verification repeated the 44 focused tests and exercised public HTTP against real private S3-compatible storage (MinIO), including signed byte retrieval and unsigned-access rejection. This is not evidence of an AWS deployment.

## HTTP contract

All routes require a bearer session. The backend owner is the API materials module; frontend integration uses the generated, committed [OpenAPI document](../apps/api/openapi.json), not handwritten persistence types.

| Method and path | Permission | Success |
|---|---|---|
| `POST /classrooms/:id/materials` | Teacher-level staff | `201` material metadata; multipart field `file` only |
| `GET /classrooms/:id/materials` | Staff or current student | `200 { items, page, pageSize, total }` |
| `GET /classrooms/:id/materials/:materialId/download` | Staff or current student | `200 { url, expiresInSeconds }`, `Cache-Control: no-store` |
| `DELETE /classrooms/:id/materials/:materialId` | Teacher-level staff | `204`, logical removal; repeated removal is `404` |

Teacher-level staff includes school Owner/Admin for every classroom of their school, classroom teachers, and the independent teacher of their classroom. School Teachers do not gain access to other teachers' classrooms. Access is checked from current persisted membership per request. A parent linked to a child receives `403`; in adult mode parent-only access is disabled and receives `404`. Students retain their own classroom access in adult mode. No client-supplied student ID or shelf/object context grants permission.

Lists exclude removed material. Pagination follows the [shared contract](../apps/api/src/http/pagination/pagination-query.dto.ts): page defaults to 1 (maximum 10,000), pageSize defaults to 20 (maximum 100). Sort accepts `createdAt` or `-createdAt` (default); ID is the tiebreaker in the same direction. There is no filename filter or editable material metadata endpoint.

Metadata has exactly `id`, `classroomId`, `authorId`, `filename`, `contentType`, `sizeBytes`, and UTC ISO `createdAt`. Internal object keys and removal fields are not serialized. The signed URL itself is necessarily a storage bearer capability; clients must not log, cache, publish or persist it.

### Failures

- `401`: missing or invalid session.
- `403`: insufficient role on a visible classroom (student write or parent material access).
- `404`: invalid, missing, removed or out-of-scope classroom/material. A material must belong to the classroom in the path; using another classroom's material ID never issues a URL.
- `400`: invalid filename/type, empty or missing file, extra file/field, invalid list pagination/sort.
- `413`: file exceeds the byte limit.
- `503`: storage/signing failure or uncertain upload outcome, without provider/database diagnostics.

Example upload against a local disposable API, using a synthetic file and a session supplied by the developer (do not paste a live token into logs):

```bash
curl -X POST "$API_URL/classrooms/$CLASSROOM_ID/materials" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F 'file=@synthetic-lesson.pdf;type=application/pdf'
```

## Provisional file policy — not team-approved defaults

These are implementation assumptions proposed under issue #46's open file-policy decision, **not approved general submission or retention policy**. Review before release; [activities and grading](../rules/activities-and-grading.md#open-decisions) and [data retention](../rules/data.md#deletion-and-lifecycle) remain open.

| Area | Realized assumption |
|---|---|
| Count | Exactly one file per request, field named `file`; no other multipart fields |
| Size | 1 through 10,485,760 bytes inclusive (10 MiB); memory parser bounded to 10 MiB + 1 byte per file before service validation, at most one file and two multipart parts |
| Filename | 1–120 ASCII characters; starts with a letter/digit, then letters, digits, spaces, `.`, `_`, `(`, `)`, `-`; extension must match detected type, case-insensitively |
| PDF | Leading five bytes `%PDF-`; declared MIME `application/pdf`, extension `.pdf` |
| PNG | Leading eight bytes `89 50 4e 47 0d 0a 1a 0a`; declared MIME `image/png`, extension `.png` |
| JPEG | Leading three bytes `ff d8 ff`; declared MIME `image/jpeg`, extension `.jpg` or `.jpeg` |
| Storage | Generated ID-only key `materials/<classroom UUID>/<material UUID>` validated by the existing safe-key helper; no filename in keys, no public ACL |
| Signature lifetime | Existing `STORAGE_SIGNED_URL_TTL`; configured default `5m` (300 seconds), existing allowed range 1–3,600 seconds; no new config |
| Retention | No automatic purge or finite retention period implemented. Logical removal retains private bytes, author, metadata and removal actor/time pending a team retention decision |

Detection checks **only these leading byte signatures**, not document validity, image decoding, trailing data or malware. A file with the right prefix can still be malformed or dangerous. MIME/extension agreement is a conservative usability/type policy, not security proof. No antivirus, sanitization, PDF active-content removal or full parser is implemented. Clients must treat files as untrusted downloads, not execute or render them as trusted HTML.

Already issued signed links remain usable until expiration after removal or membership revocation; in-flight signing is not a revocable capability. Logical removal prevents subsequent endpoint requests from issuing URLs. Storage privacy still depends on the existing bucket/adapter configuration: this feature adds no bucket/IAM or infrastructure changes.

## Persistence and uncertain outcomes

`StudyMaterial` adds a new table with RESTRICT foreign keys to classroom, author and optional removal actor; removal records actor/time and never deletes the object. The migration adds indexes and checks positive bounded size and paired removal fields; it changes no existing rows or tables beyond new foreign-key relationships. Deploy through the [existing Prisma migration workflow](../README.md#database-and-prisma-workflows); no backfill is needed. Before rollback, stop material writes and retain this additive table/objects rather than dropping history.

The service validates authorization and the complete received request before calling storage, then stores bytes before inserting metadata. Invalid requests create neither object nor material. A failed `put` never attempts a metadata insert. If storage or persistence reports an error after possibly committing, the API returns `503` and **does not delete the object**: deleting on an uncertain database acknowledgement could break a committed material.

Refresh the ordered material list before deciding to retry; uploads are not idempotent and must not be automatically retried. Absence from one page is not proof of failure. Minimal operator follow-up for a suspected orphan: privately reconcile generated keys against material rows (including removed rows), account for in-flight writes and uncertain outcomes, and obtain retention approval before any eventual cleanup. No cleanup job, recovery framework or object-deletion permission is added here. Possible private orphans are preferable to deleting bytes referenced by a committed row.

## Verification scope

The focused HTTP spec uses real isolated PostgreSQL, actual public Nest routes, synthetic identity verification and a controlled `StoragePort`. It checks status/body and public-list stability for rejected mutations, current membership, staff/student/parent/adult scope, #26 ID tampering, size/count/signatures, pagination, logical removal, and storage/persistence uncertainty. The storage double does **not** prove real bucket privacy, AWS connectivity or signed URL validity; those require the existing adapter integration checks and parent-owned independent verification.

Run only against task-owned services with generated Prisma client and migrations applied:

```bash
pnpm --filter @aula/api exec vitest run src/materials/materials.http.spec.ts
pnpm --filter @aula/api exec vitest run src/openapi/openapi.spec.ts
pnpm --filter @aula/api typecheck
```

No submissions (#30), activity, bot indexing, notifications, frontend editor or infrastructure behavior is introduced. Shared access, storage adapters, auth and config semantics remain unchanged.
