/** Must match the server's oc1 protocol. Never regenerate an unknown request automatically. */
export const newOfficeRequestId = () => `oc1_${Date.now()}_${crypto.randomUUID()}`;
