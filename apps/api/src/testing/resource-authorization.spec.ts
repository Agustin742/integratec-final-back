import { describe, expect, it, vi } from 'vitest';
import { assertResourceAuthorization, type AuthorizationResponse } from './resource-authorization';

const allowedResourceId = 'allowed-resource';
const foreignResourceId = 'foreign-resource';
const interaction = { classroomId: allowedResourceId, objectId: 'accessible-desk' };
const allowed = { status: 200, body: { items: ['safe'] } };
const denied = { status: 404, body: { error: { code: 'NOT_FOUND' } } };

// Unit tests validate the helper's request/response assertion protocol. The real
// Nest/Supertest adapter is exercised in desks.http.spec.ts, not replaced here.
function options(respond?: (id: string, context?: typeof interaction) => AuthorizationResponse) {
  return {
    allowedResourceId,
    foreignResourceId,
    interaction,
    deniedStatus: 404 as const,
    request: vi.fn(async (id: string, context?: typeof interaction) =>
      respond ? respond(id, context) : id === allowedResourceId ? allowed : denied,
    ),
    assertAllowed: vi.fn(),
    assertDenied: vi.fn(),
  };
}

describe('resource authorization public-request pattern', () => {
  it('checks both resource IDs directly and with the same untrusted object context', async () => {
    const fixture = options();
    await assertResourceAuthorization(fixture);
    expect(fixture.request.mock.calls).toEqual([
      [allowedResourceId, undefined],
      [allowedResourceId, interaction],
      [foreignResourceId, undefined],
      [foreignResourceId, interaction],
    ]);
    expect(fixture.assertAllowed).toHaveBeenCalledTimes(2);
    expect(fixture.assertDenied).toHaveBeenCalledTimes(2);
    expect(fixture.assertAllowed).toHaveBeenCalledWith(allowed);
    expect(fixture.assertDenied).toHaveBeenCalledWith(denied);
  });

  it('rejects a missing route rather than accepting vacuous 404 denial', async () => {
    await expect(assertResourceAuthorization(options(() => denied))).rejects.toThrow(
      'allowed direct',
    );
  });
  it('detects direct cross-resource access', async () => {
    await expect(assertResourceAuthorization(options(() => allowed))).rejects.toThrow(
      'foreign direct',
    );
  });
  it('detects authorization incorrectly granted by object interaction', async () => {
    const fixture = options((id, context) =>
      id === allowedResourceId || context !== undefined ? allowed : denied,
    );
    await expect(assertResourceAuthorization(fixture)).rejects.toThrow(
      'foreign object interaction',
    );
  });
  it('does not confuse authentication failure with authorization denial', async () => {
    const fixture = options((id) =>
      id === allowedResourceId ? allowed : { ...denied, status: 401 },
    );
    await expect(assertResourceAuthorization(fixture)).rejects.toThrow('foreign direct');
  });
  it('supports visible-resource 403 and alternate success status without assuming a payload', async () => {
    const fixture = options((id) => ({ status: id === allowedResourceId ? 204 : 403, body: null }));
    await assertResourceAuthorization({ ...fixture, allowedStatus: 204, deniedStatus: 403 });
    expect(fixture.request).toHaveBeenCalledTimes(4);
  });
  it('propagates response assertion failures and request failures', async () => {
    const fixture = options();
    fixture.assertDenied.mockRejectedValue(new Error('private payload leaked'));
    await expect(assertResourceAuthorization(fixture)).rejects.toThrow('private payload leaked');
    fixture.request.mockRejectedValue(new Error('transport failed'));
    await expect(assertResourceAuthorization(fixture)).rejects.toThrow('transport failed');
  });
  it('rejects identical fixture IDs before issuing any request', async () => {
    const fixture = options();
    await expect(
      assertResourceAuthorization({ ...fixture, foreignResourceId: allowedResourceId }),
    ).rejects.toThrow('distinct');
    expect(fixture.request).not.toHaveBeenCalled();
  });
});
