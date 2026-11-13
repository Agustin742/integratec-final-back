import assert from 'node:assert/strict';

export interface AuthorizationResponse {
  status: number;
  body: unknown;
}

export interface ResourceAuthorizationOptions<TInteraction> {
  /** Must invoke the actual public endpoint, preserving the authenticated actor. */
  request: (resourceId: string, interaction?: TInteraction) => PromiseLike<AuthorizationResponse>;
  allowedResourceId: string;
  foreignResourceId: string;
  /** Untrusted context from an object the actor can already interact with. */
  interaction: TInteraction;
  allowedStatus?: number;
  deniedStatus: 403 | 404;
  assertAllowed?: (response: AuthorizationResponse) => void | Promise<void>;
  assertDenied?: (response: AuthorizationResponse) => void | Promise<void>;
}

/** Checks direct requests and object-origin requests against the same resource boundary. */
export async function assertResourceAuthorization<TInteraction>(
  options: ResourceAuthorizationOptions<TInteraction>,
): Promise<void> {
  assert.notEqual(
    options.allowedResourceId,
    options.foreignResourceId,
    'Fixture resource IDs must be distinct',
  );
  const cases = [
    {
      label: 'allowed direct',
      resourceId: options.allowedResourceId,
      interaction: undefined,
      allowed: true,
    },
    {
      label: 'allowed object interaction',
      resourceId: options.allowedResourceId,
      interaction: options.interaction,
      allowed: true,
    },
    {
      label: 'foreign direct',
      resourceId: options.foreignResourceId,
      interaction: undefined,
      allowed: false,
    },
    {
      label: 'foreign object interaction',
      resourceId: options.foreignResourceId,
      interaction: options.interaction,
      allowed: false,
    },
  ];
  for (const testCase of cases) {
    const response = await options.request(testCase.resourceId, testCase.interaction);
    const expected = testCase.allowed ? (options.allowedStatus ?? 200) : options.deniedStatus;
    assert.equal(
      response.status,
      expected,
      `${testCase.label}: expected HTTP ${expected}, received ${response.status}`,
    );
    await (testCase.allowed ? options.assertAllowed : options.assertDenied)?.(response);
  }
}
