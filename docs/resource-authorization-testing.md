# Test authorization on the resource, not the object

Use `assertResourceAuthorization` from `apps/api/src/testing/resource-authorization.ts` to exercise an existing public endpoint with authorized and foreign resource identifiers, both directly and with untrusted classroom-object context. An accessible desk, board or shop object never grants authority over its related business resource.

## Present API and example

The helper accepts one options object and returns `Promise<void>`; failures throw assertions. It uses Node's assertions, not a Nest provider or production authorization implementation.

| Option | Contract |
| --- | --- |
| `request(resourceId, interaction?)` | Invoke the actual public route as the same authenticated actor; return a promise-like `{ status, body }` response. Supertest requests work directly. |
| `allowedResourceId`, `foreignResourceId` | Distinct persisted resource fixtures: the actor can access the first, not the second. |
| `interaction` | Untrusted context from an object the actor can interact with. The adapter sends it through the endpoint's relevant transport input. |
| `allowedStatus` | Success status; defaults to `200`. |
| `deniedStatus` | Explicit `403` or `404`, according to the resource's actual visibility policy; never `401`. |
| `assertAllowed`, `assertDenied` | Optional async/sync response assertions for payload privacy, error envelopes or scenario-specific effects. |

This is the concrete adapter used by the [desk-map HTTP tests](../apps/api/src/classrooms/desks/desks.http.spec.ts), with fixture variables initialized by that suite:

```ts
await assertResourceAuthorization({
  allowedResourceId: classroomId,
  foreignResourceId: foreignId,
  interaction: { classroomId, objectId: desks[0].id },
  deniedStatus: 404,
  request: (resourceId, interaction) => {
    const req = get(resourceId);
    return interaction === undefined ? req : req.query(interaction);
  },
  assertAllowed: (response) => {
    expect(response.body).toMatchObject({ items: expect.any(Array) });
  },
  assertDenied: (response) => {
    expect(response.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(response.body).not.toHaveProperty('items');
  },
});
```

Here `get(resourceId)` sends an authenticated Supertest GET to `/classrooms/${resourceId}/desks`. The desk-map route has no object-context parameters: the query deliberately supplies untrusted hints and must not override the path resource's persisted scope. These hints are test attack inputs, not an advertised API feature.

The helper issues four sequential requests:

1. Allowed resource directly: success proves the route/fixture exists, avoiding vacuous `404` denial.
2. Allowed resource with object context: the same success policy applies.
3. Foreign resource directly: the specified authorization denial must hold.
4. Foreign resource with the **same accessible object context**: the denial must still hold despite identifier tampering.

Callbacks run after each matching status and may inspect error bodies or fixture state. Transport and callback failures propagate; the helper never retries, changes roles, creates fixtures, invokes a nonexistent route or calls an authorization service directly.

## Adult education and student scopes

The desk suite runs the same adapter with `adultMode: false` and `adultMode: true`, retaining an enrolled student in the accessible classroom and no membership in the foreign classroom. **Adult means adult education, not parent access**: [RF-AUT-004/RN-16](functional-requirements.md) and [HU-AUL-001](user-stories.md) disable parental actions in adult mode. Separate HTTP tests deny parent-only access (`403` for a visible non-adult classroom, `404` when adult mode removes that visibility).

Later stories #34/#37/#40/#41/#46 can reuse this helper by supplying their own real public request adapter, resource fixtures and payload assertions when their routes exist. For a nested/private resource, both IDs must identify that resource itself; the fixture must resolve its owning classroom/student from persistence. Do not merely switch a client-supplied classroom ID while leaving the protected resource unchanged.

## Evidence and limits

- [Helper self-tests](../apps/api/src/testing/resource-authorization.spec.ts) verify all four calls, detect accidental cross-resource grants and object-context bypasses, reject a missing route or authentication failure as false proof, support `403`/alternate success statuses, and propagate callback/transport errors.
- The actual Nest/Supertest desk suite uses the real shared access service with predicate-aware mocked persistence and synthetic session identity. It also checks that denied requests do not fetch the map and that controlled fixture state remains unchanged.
- Unit adapter responses test the helper itself; they are not endpoint integration evidence. No real database, enrollment race, token validation, live object interaction or future endpoint behavior is proven here.
- The helper is a focused request pattern, not a complete permission matrix. Each story still needs role-specific, student-private ownership, revoked membership, authentication, input validation and no-write tests appropriate to its contract. Object context cannot replace those checks.

Focused commands (existing workspace dependencies required; no database required):

```bash
pnpm --filter @aula/api exec vitest run src/testing/resource-authorization.spec.ts src/classrooms/desks/desks.http.spec.ts --pool=threads --maxWorkers=2 --minWorkers=1
```

Binding policy remains in [classroom authorization rules](../rules/classrooms-and-roles.md#server-side-checks) and [security](../rules/security.md).
