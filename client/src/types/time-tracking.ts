/**
 * Per-user time logs for a task.
 */
export interface TimeLog {
    id: string;
    taskId: string;
    userId: string;
    /** Duration in seconds. */
    durationSeconds: number;
    /** Optional note describing the session. */
    note?: string;
    /** ISO timestamp the work started. */
    startedAt: string;
    /** ISO timestamp the work ended (null while a timer is running). */
    endedAt: string | null;
    createdAt: string;
}
