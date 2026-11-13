export class DomainError extends Error {
  constructor(message: string, readonly code = "DOMAIN_ERROR") {
    super(message);
    this.name = "DomainError";
  }
}

export function assertDomain(condition: unknown, message: string, code?: string): asserts condition {
  if (!condition) throw new DomainError(message, code);
}
