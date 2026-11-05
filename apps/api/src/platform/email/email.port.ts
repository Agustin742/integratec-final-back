/** A plain transactional email. Providers map it to their own wire format. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Outbound email boundary. Features depend on this, never on a provider. */
export interface EmailPort {
  send(message: EmailMessage): Promise<void>;
}

/** Injection token for the {@link EmailPort} implementation. */
export const EMAIL_PORT = Symbol('EMAIL_PORT');
