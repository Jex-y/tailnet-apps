import type { ReactNode } from "react";
import { useStore } from "../hooks/useStore";
import { useSyncStatus } from "../hooks/useSyncStatus";
import { Icon, type IconName } from "./Icon";
import { NavLink } from "./NavLink";

type Section = { readonly href: string; readonly label: string; readonly icon: IconName };

/** On phones the sections sit in a bottom tab bar within thumb reach. */
const SECTIONS: readonly Section[] = [
  { href: "/", label: "Log", icon: "log" },
  { href: "/history", label: "History", icon: "history" },
  { href: "/exercises", label: "Exercises", icon: "exercises" },
];

/** Why changes made here cannot wait for a connection, where they cannot. */
const LIMITS = {
  device: null,
  none: "This browser cannot keep the log on the device, so changes need a connection.",
  "other-tab": "The log is open in another tab, so changes made in this one need a connection.",
} as const;

/**
 * Sits in the header, where nothing moves when it changes: quiet while everything is on the server, a count while
 * changes wait to be sent, and a standing word where the device cannot hold them at all.
 */
const SyncChip = () => {
  const { pending, durability } = useSyncStatus();
  const limit = LIMITS[durability];

  if (limit !== null) {
    return (
      <span className="sync limited" role="status" title={limit}>
        <span className="sync-dot" aria-hidden="true" />
        Online only
        <span className="visually-hidden">{limit}</span>
      </span>
    );
  }
  return (
    <span className={pending > 0 ? "sync waiting" : "sync"} role="status">
      <span className="sync-dot" aria-hidden="true" />
      {pending > 0 ? `${pending} to sync` : <span className="visually-hidden">Everything is synced</span>}
    </span>
  );
};

/** Laid over the page rather than in it, so it comes and goes without moving what is being tapped. */
const Refusal = () => {
  const store = useStore();
  const { refusal } = useSyncStatus();

  return refusal === null ? null : (
    <div className="notices">
      <p className="notice" role="alert">
        <span>Undone: {refusal}</span>
        <button type="button" className="quiet" aria-label="Dismiss" onClick={store.dismissRefusal}>
          <Icon name="close" />
        </button>
      </p>
    </div>
  );
};

type Props = {
  /** Without it the frame is drawn alone, while the log is being opened. */
  readonly ready: boolean;
  readonly children: ReactNode;
};

/** Lifts stands on its own: its header and tab bar lead only to its own sections, never to the other apps. */
export const Layout = ({ ready, children }: Props) => (
  <>
    <header className="site-header">
      <span className="brand">Lifts</span>
      <nav>
        {SECTIONS.map(({ href, label }) => (
          <NavLink key={href} href={href} className="nav-link section-link">
            {label}
          </NavLink>
        ))}
      </nav>
      {ready && <SyncChip />}
    </header>
    <main>{children}</main>
    {ready && <Refusal />}
    <nav className="tab-bar" aria-label="Sections">
      {SECTIONS.map(({ href, label, icon }) => (
        <NavLink key={href} href={href} className="tab">
          <Icon name={icon} />
          {label}
        </NavLink>
      ))}
    </nav>
  </>
);
