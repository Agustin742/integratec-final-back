import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Transporter } from 'nodemailer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authTestConfig } from '../../auth/testing/auth-test-config';
import { ApiConfigModule } from '../../config/config.module';
import { EmailModule } from './email.module';
import { EMAIL_PORT, type EmailMessage, type EmailPort } from './email.port';
import { escapeHtml } from './escape-html';
import { InMemoryEmailAdapter } from './in-memory-email.adapter';
import { SmtpEmailAdapter } from './smtp-email.adapter';

const message: EmailMessage = {
  to: 'student@example.edu.ar',
  subject: 'Reset your password',
  text: 'Secret body with token abc123',
};

describe('EmailModule', () => {
  afterEach(() => vi.restoreAllMocks());

  it('binds the email token to the in-memory adapter when EMAIL_PROVIDER=memory', async () => {
    const config = authTestConfig({ emailProvider: 'memory' });
    const moduleRef = await Test.createTestingModule({
      imports: [ApiConfigModule.forRoot(config), EmailModule],
    }).compile();

    expect(moduleRef.get<EmailPort>(EMAIL_PORT)).toBeInstanceOf(InMemoryEmailAdapter);
  });

  it('binds the email token to the SMTP adapter when EMAIL_PROVIDER=smtp', async () => {
    const config = authTestConfig({ emailProvider: 'smtp' });
    const moduleRef = await Test.createTestingModule({
      imports: [ApiConfigModule.forRoot(config), EmailModule],
    }).compile();

    expect(moduleRef.get<EmailPort>(EMAIL_PORT)).toBeInstanceOf(SmtpEmailAdapter);
  });

  it('throws an error for unsupported email providers', async () => {
    const config = authTestConfig({ emailProvider: 'ses' });
    await expect(
      Test.createTestingModule({
        imports: [ApiConfigModule.forRoot(config), EmailModule],
      }).compile(),
    ).rejects.toThrow('Unsupported email provider: ses');
  });

  it('records messages sent through the port and can clear them', async () => {
    const config = authTestConfig({ emailProvider: 'memory' });
    const moduleRef = await Test.createTestingModule({
      imports: [ApiConfigModule.forRoot(config), EmailModule],
    }).compile();
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
});

describe('InMemoryEmailAdapter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('deduplicates concurrent and replayed messages with the same idempotency key', async () => {
    const adapter = new InMemoryEmailAdapter();
    const keyed = { ...message, idempotencyKey: 'notification:synthetic:email' };
    await Promise.all([adapter.send(keyed), adapter.send(keyed)]);
    await adapter.send(keyed);
    expect(adapter.sent).toHaveLength(1);
    adapter.clear();
    await adapter.send(keyed);
    expect(adapter.sent).toHaveLength(1);
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

describe('SmtpEmailAdapter', () => {
  const config = authTestConfig({
    emailProvider: 'smtp',
    smtpHost: 'mailpit.internal',
    smtpPort: 1025,
    smtpSecure: false,
    emailFrom: 'soporte@fundacion-integrar.org.ar',
  });

  afterEach(() => vi.restoreAllMocks());

  it('maps EmailMessage fields to nodemailer sendMail options and logs success', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: '<synthetic-msg-id@aula>' });
    const mockTransporter = { sendMail, close: vi.fn() } as unknown as Transporter;
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const adapter = new SmtpEmailAdapter(config, mockTransporter);
    await adapter.send(message);

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith({
      from: config.emailFrom,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: undefined,
      headers: undefined,
    });

    expect(logSpy).toHaveBeenCalledWith({
      operation: 'email.send',
      adapter: 'smtp',
      messageId: '<synthetic-msg-id@aula>',
    });

    const logged = JSON.stringify(logSpy.mock.calls);
    expect(logged).not.toContain(message.to);
    expect(logged).not.toContain(message.subject);
    expect(logged).not.toContain(message.text);
    expect(logged).not.toContain('abc123');
  });

  it('sets X-Idempotency-Key header when idempotencyKey is provided', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: '<msg-keyed@aula>' });
    const mockTransporter = { sendMail, close: vi.fn() } as unknown as Transporter;

    const adapter = new SmtpEmailAdapter(config, mockTransporter);
    await adapter.send({
      ...message,
      html: '<p>HTML body</p>',
      idempotencyKey: 'idem-key-789',
    });

    expect(sendMail).toHaveBeenCalledWith({
      from: config.emailFrom,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: '<p>HTML body</p>',
      headers: { 'X-Idempotency-Key': 'idem-key-789' },
    });
  });

  it('logs errorName and throws when sendMail fails, without logging sensitive content', async () => {
    const sendMail = vi.fn().mockRejectedValue(new Error('Connection refused'));
    const mockTransporter = { sendMail, close: vi.fn() } as unknown as Transporter;
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const adapter = new SmtpEmailAdapter(config, mockTransporter);
    await expect(adapter.send(message)).rejects.toThrow('Connection refused');

    expect(errorSpy).toHaveBeenCalledWith({
      operation: 'email.send',
      adapter: 'smtp',
      errorName: 'Error',
    });

    const errorLogged = JSON.stringify(errorSpy.mock.calls);
    expect(errorLogged).not.toContain(message.to);
    expect(errorLogged).not.toContain(message.subject);
    expect(errorLogged).not.toContain(message.text);
    expect(errorLogged).not.toContain('abc123');
  });

  it('closes the transporter onModuleDestroy', () => {
    const close = vi.fn();
    const mockTransporter = { sendMail: vi.fn(), close } as unknown as Transporter;

    const adapter = new SmtpEmailAdapter(config, mockTransporter);
    adapter.onModuleDestroy();

    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('escapeHtml', () => {
  it('escapes HTML metacharacters cleanly', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});
