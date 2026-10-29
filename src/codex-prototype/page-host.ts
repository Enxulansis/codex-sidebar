/** The existing page channel. It owns no session, request IDs, retries or storage. */
export interface PageHost {
  postMessage(message: unknown): void;
  messages: {
    addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
    removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  };
}
