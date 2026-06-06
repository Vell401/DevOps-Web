import type { ReactNode } from 'react';

export function AuthSplit({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen w-screen bg-paper bg-noise md:grid-cols-2">
      <aside className="relative hidden flex-col justify-between border-r border-line bg-surface px-10 py-10 md:flex">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-ink text-paper">
            <span className="font-display text-[13px] font-bold">t</span>
          </span>
          <span className="font-display text-lg font-semibold tracking-tight">
            tracker
          </span>
        </div>

        <div className="relative">
          <h2 className="font-display text-[42px] font-semibold leading-[1.05] text-ink text-balance">
            Work, <span className="text-mark">in plain view</span>.
            <br />
            Without the ceremony.
          </h2>
          <p className="mt-5 max-w-md text-sm text-ink-muted">
            A small, opinionated task tracker. Boards, comments, history, labels —
            none of the dashboards you never opened.
          </p>

          <ul className="mt-8 space-y-2.5 text-sm text-ink">
            <Bullet color="bg-sun-300">Six-column flow: Backlog → Done</Bullet>
            <Bullet color="bg-leaf-300">Labels with a calm palette</Bullet>
            <Bullet color="bg-chip-purple">Subtasks and a full activity log</Bullet>
          </ul>
        </div>

        <div className="text-[11px] uppercase tracking-[0.18em] text-ink-subtle">
          v0.2 · pet-project edition
        </div>
      </aside>

      <main className="flex items-center justify-center px-6 py-12 md:px-10">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}

function Bullet({ color, children }: { color: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className={`mt-1.5 h-1.5 w-1.5 rounded-full ${color}`} />
      <span>{children}</span>
    </li>
  );
}
