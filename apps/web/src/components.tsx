import React, {
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
  useState,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
const SavingContext = createContext<(busy: boolean) => void>(() => {});
export function ErrorText({ error }: { error: unknown }) {
  return error
    ? (
      <p role="alert" className="error">
        {error instanceof Error ? error.message : String(error)}
      </p>
    )
    : null;
}

export function Modal(
  { title, children }: { title: string; children: ReactNode },
) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <SavingContext.Provider value={setBusy}>
      <Dialog.Root
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
        }}
      >
        <Dialog.Trigger asChild>
          <button>{title}</button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="modal">
            <div className="row spread">
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Close asChild>
                <button disabled={busy} aria-label="Close">×</button>
              </Dialog.Close>
            </div>
            {children}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </SavingContext.Provider>
  );
}

export function Form({
  fields,
  onSubmit,
  label = "Save",
}: {
  fields: {
    name: string;
    label: string;
    value?: string;
    type?: string;
    options?: string[];
    optionLabels?: Record<string, string>;
  }[];
  onSubmit: (data: Record<string, string>) => Promise<unknown>;
  label?: string;
}) {
  const setModalBusy = useContext(SavingContext);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<
      string,
      string
    >;
    setBusy(true);
    setModalBusy(true);
    setError(undefined);
    setSuccess(false);
    try {
      await onSubmit(data);
      setSuccess(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      setModalBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <fieldset disabled={busy} className="form-fields">
        {fields.map((f) => (
          <label key={f.name}>
            {f.label}
            {f.options
              ? (
                <select required name={f.name} defaultValue={f.value}>
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {f.optionLabels?.[o] || o}
                    </option>
                  ))}
                </select>
              )
              : f.type === "textarea"
              ? <textarea name={f.name} defaultValue={f.value} />
              : (
                <input
                  name={f.name}
                  type={f.type || "text"}
                  defaultValue={f.value}
                  required={f.type !== "textarea"}
                />
              )}
          </label>
        ))}
        <ErrorText error={error} />
        {success && <p role="status">Saved.</p>}
        <button disabled={busy}>{busy ? "Saving…" : label}</button>
      </fieldset>
    </form>
  );
}
