/** Hono environment shared by every middleware and route of the API. */
export type AppEnv = {
  Variables: {
    requestId: string;
    /** Set by the auth middleware once the caller is known; included in the request log line. */
    userId?: string;
  };
};
