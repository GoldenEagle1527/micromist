/** Every way a ledger operation can be refused; the ledger never half-applies one. */
export type LedgerErrorCode = "unknown-pool" | "same-pool" | "unknown-type" | "bad-count" | "bad-vector" | "insufficient" | "not-conserved";

export class LedgerError extends Error {
  readonly code: LedgerErrorCode;

  constructor(code: LedgerErrorCode, message: string) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}
