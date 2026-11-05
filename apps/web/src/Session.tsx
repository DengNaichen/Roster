import { useSession } from "./integration";
import * as Popover from "@radix-ui/react-popover";
import { ChevronUp, LogOut, UserRound } from "lucide-react";
import { useState } from "react";
import { type Appearance, readAppearance, saveAppearance } from "./appearance";
import { Dropdown } from "./Dropdown";

export function Session() {
  const { identity, preview, signOut } = useSession();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [appearance, setAppearance] = useState(readAppearance);
  function changeAppearance(next: Appearance) {
    setAppearance(next);
    saveAppearance(next);
  }
  async function logout() {
    setBusy(true);
    try {
      await signOut();
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }
  if (!identity && !error) return null;
  const name = identity && (identity.name || identity.email || identity.subject);
  return (
    <div className="sidebar-account">
      {identity && (
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              type="button"
              className="account-trigger"
              title={name || undefined}
              aria-label={`Account: ${name}`}
            >
              <span className="account-avatar" aria-hidden="true">
                <UserRound className="icon" />
              </span>
              <span>{name}</span>
              <ChevronUp className="icon" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="account-menu"
              side="top"
              align="start"
              sideOffset={6}
              collisionPadding={8}
              aria-label="Account"
            >
              <div className="account-identity">
                <strong>{name}</strong>
                {identity.email && identity.email !== name && <small>{identity.email}</small>}
              </div>
              <div className="appearance-settings">
                <label>
                  Appearance
                  <Dropdown
                    aria-label="Appearance"
                    value={appearance.theme}
                    options={[
                      { value: "system", label: "System" },
                      { value: "light", label: "Light" },
                      { value: "dark", label: "Dark" },
                    ]}
                    onChange={(theme) =>
                      changeAppearance({ ...appearance, theme: theme as Appearance["theme"] })
                    }
                  />
                </label>
                <label>
                  Density
                  <Dropdown
                    aria-label="Density"
                    value={appearance.density}
                    options={[
                      { value: "compact", label: "Compact" },
                      { value: "comfortable", label: "Comfortable" },
                    ]}
                    onChange={(density) =>
                      changeAppearance({ ...appearance, density: density as Appearance["density"] })
                    }
                  />
                </label>
              </div>
              <button
                type="button"
                className="toolbar-menu-action"
                onClick={() => void logout()}
                disabled={busy || preview}
                title={preview ? "Sign out is unavailable in local preview" : undefined}
              >
                <LogOut className="icon" />
                {busy ? "Signing out…" : "Sign out"}
              </button>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
      {preview && (
        <div className="account-identity">
          <strong>Local preview</strong>
          <small>Isolated demo data · Roster</small>
        </div>
      )}
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
