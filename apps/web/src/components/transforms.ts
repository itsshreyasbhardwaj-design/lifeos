/**
 * Named body transforms for ApiForm. Server components cannot pass functions
 * to client components, so they refer to these by name instead.
 */
type Body = Record<string, unknown>;

export const TRANSFORMS = {
  /** Task details form: the "remind" checkbox becomes reminder offsets. */
  taskDetails: (b: Body): Body => {
    const { remind, ...rest } = b;
    return { ...rest, reminderOffsets: remind ? [0] : [] };
  },
  /** Any form with an optional due date: remind on the day when a date is set. */
  remindIfDue: (b: Body): Body => ({ ...b, reminderOffsets: b.dueDate ? [0] : [] }),
  /** Link a chosen document to a record (toType/toId/relation come from `extra`). */
  documentLink: (b: Body): Body => {
    const { documentId, ...rest } = b;
    return { ...rest, fromType: 'document', fromId: documentId };
  },
  /** Document share form: "u:<id>" / "w:<id>" target selector. */
  shareTarget: (b: Body): Body => {
    const [kind, target] = String(b.target).split(':');
    return { granteeUserId: kind === 'u' ? target : null, granteeWorkspaceId: kind === 'w' ? target : null, canDownload: Boolean(b.canDownload), expiresAt: b.expiresAt ? new Date(String(b.expiresAt)).toISOString() : null };
  },
  routine: (b: Body): Body => ({
    title: b.title, timeOfDay: b.timeOfDay, reminderEnabled: Boolean(b.reminderEnabled),
    recurrence: b.freq === 'weekdays' ? { freq: 'weekly', interval: 1, byWeekday: [0, 1, 2, 3, 4] } : b.freq === 'weekly' ? { freq: 'weekly', interval: 1, byWeekday: ((b.days as string[] | undefined) ?? []).map(Number) } : { freq: b.freq, interval: 1 },
  }),
  automation: (b: Body): Body => ({ name: b.name, trigger: b.trigger, action: b.action, conditions: { daysBefore: Number(b.daysBefore ?? 7) }, maxRuns: b.maxRuns ?? null }),
} as const;

export type TransformName = keyof typeof TRANSFORMS;
