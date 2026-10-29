export interface Op { p: string[]; v?: unknown; del?: true; add?: string; rem?: string }
export interface Setup { config: Record<string, unknown>; hulks: Record<string, unknown>; info: Record<string, unknown>; locked: string[]; teams?: unknown }
export const MAX_OPS: number
export function diffSetup(base: Setup | null | undefined, mine: Setup | null | undefined): Op[]
export function validOps(ops: unknown): ops is Op[]
export function applyOps<T extends Setup | null>(setup: T, ops: Op[]): Setup
