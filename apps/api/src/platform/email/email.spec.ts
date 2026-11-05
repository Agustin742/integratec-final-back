import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMAIL_PORT, type EmailPort } from './email.port';
import { EmailModule } from './email.module';
import { InMemoryEmailAdapter } from './in-memory-email.adapter';

const message = {
  to: 'student@example.edu.ar',
  subject: 'Reset your password',
  text: 'Secret body with token abc123',
};

describe('EmailModule', () => {
  afterEach(() => vi.restoreAllMocks());

  it('binds the email token to the in-memory adapter', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [EmailModule] }).compile();

    expect(moduleRef.get<EmailPort>(EMAIL_PORT)).toBeInstanceOf(InMemoryEmailAdapter);
  });

  it('records messages sent through the port and can clear them', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [EmailModule] }).compile();
    const port = moduleRef.get<EmailPort>(EMAIL_PORT);
    const adapter = moduleRef.get(InMemoryEmailAdapter);

    await port.send(message);
    await port.send({ ...message, html: '<p>hi</p>' });

    expect(adapter.sent).toHaveLength(2);
    expect(adapter.sent[0]).toEqual(message);
    expect(adapter.sent[1]?.html).toBe('<p>hi</p>');

    adapter.clear();
    expect(adapter.sent).toHaveLength(0);
  });

  it('does not expose its internal store for mutation', async () => {
    const adapter = new InMemoryEmailAdapter();
    await adapter.send(message);

    (adapter.sent as unknown[]).length = 0;
    expect(adapter.sent).toHaveLength(1);
  });

  it('logs without recipient, subject or body', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const adapter = new InMemoryEmailAdapter();

    await adapter.send(message);

    const logged = JSON.stringify(log.mock.calls);
    expect(log).toHaveBeenCalledTimes(1);
    expect(logged).not.toContain(message.to);
    expect(logged).not.toContain(message.subject);
    expect(logged).not.toContain('abc123');
  });
});
