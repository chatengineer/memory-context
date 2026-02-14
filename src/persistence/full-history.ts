// src/persistence/full-history.ts
// Simple in‑memory full conversation history used by the JITEngine.
// In a production plugin you would persist to disk, but for the purpose of
// this task an in‑memory store is sufficient.

/**
 * FullHistory – stores raw messages (as received from OpenClaw) and provides
 * retrieval for JIT rebuilding.
 */
export interface Message {
  // The raw message payload – shape depends on OpenClaw, but we keep it generic.
  content: string;
  // Optional metadata (timestamp, role, etc.)
  [key: string]: any;
}

export class FullHistory {
  private messages: Message[] = [];

  constructor() {
    // In a real implementation we could load persisted history from a file.
    // For now we start with an empty list.
  }

  /** Add a new message to the history. */
  addMessage(msg: any): void {
    const entry: Message = {
      content: msg?.content ?? String(msg),
      ...msg,
    };
    this.messages.push(entry);
  }

  /** Retrieve all stored messages in chronological order. */
  getAllMessages(): Message[] {
    return this.messages;
  }

  /** Clear the history – used for testing or reset. */
  clear(): void {
    this.messages = [];
  }
}
