import { Inject, Injectable, Logger, Optional, type OnModuleDestroy } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import type { ApiConfig } from '../../config/api-config';
import { API_CONFIG } from '../../config/config.module';
import type { EmailMessage, EmailPort } from './email.port';

@Injectable()
export class SmtpEmailAdapter implements EmailPort, OnModuleDestroy {
  private readonly logger = new Logger(SmtpEmailAdapter.name);
  private readonly transporter: Transporter;

  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Optional() transporter?: Transporter,
  ) {
    this.transporter =
      transporter ??
      nodemailer.createTransport({
        host: this.config.smtpHost,
        port: this.config.smtpPort,
        secure: this.config.smtpSecure,
        auth: this.config.smtpAuth,
      });
  }

  async send(message: EmailMessage): Promise<void> {
    try {
      const info = await this.transporter.sendMail({
        from: this.config.emailFrom,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: message.idempotencyKey
          ? { 'X-Idempotency-Key': message.idempotencyKey }
          : undefined,
      });

      this.logger.log({
        operation: 'email.send',
        adapter: 'smtp',
        messageId: info.messageId,
      });
    } catch (error) {
      this.logger.error({
        operation: 'email.send',
        adapter: 'smtp',
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      throw error;
    }
  }

  onModuleDestroy(): void {
    if (typeof this.transporter.close === 'function') {
      this.transporter.close();
    }
  }
}
