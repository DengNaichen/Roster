import * as Select from "@radix-ui/react-select";
import { ChevronDown } from "lucide-react";
import { ReactNode } from "react";
import { SelectMenu } from "./SelectMenu";
import { useLazySelect } from "./shared";

export type DropdownOption = { value: string; label: string; icon?: ReactNode; disabled?: boolean };

// Radix items cannot use "" as a value, but "no selection" options are common.
const EMPTY = "\u0000empty";
const encode = (value: string) => (value === "" ? EMPTY : value);
const decode = (value: string) => (value === EMPTY ? "" : value);

// The one dropdown used everywhere. It shares its menu with the status and
// priority controls; `variant` only changes how the trigger sits in its row.
export function Dropdown({
  value,
  onChange,
  options,
  disabled = false,
  required = false,
  id,
  "aria-label": ariaLabel,
  placeholder = "Select…",
  variant = "field",
  icon,
  className = "",
  title,
}: {
  value: string;
  onChange: (value: string, option: DropdownOption) => void;
  options: DropdownOption[];
  disabled?: boolean;
  required?: boolean;
  id?: string;
  "aria-label"?: string;
  placeholder?: string;
  // field: faintly bordered, sized to its content. block: the same at full width.
  // ghost: borderless with no chevron, for property rows and toolbars.
  variant?: "field" | "block" | "ghost";
  icon?: ReactNode;
  className?: string;
  title?: string;
}) {
  const pick = (raw: string) => onChange(raw, options.find((option) => option.value === raw)!);
  const { open, setOpen, trigger, container, onKeyDown } = useLazySelect(value, options, pick);
  const selected = options.find((option) => option.value === value);
  return (
    <>
      <Select.Root
        open={open}
        onOpenChange={setOpen}
        value={encode(value)}
        onValueChange={(next) => pick(decode(next))}
        disabled={disabled}
      >
        <Select.Trigger
          ref={trigger}
          id={id}
          onKeyDown={onKeyDown}
          aria-label={ariaLabel}
          title={title ?? selected?.label}
          className={`dropdown dropdown-${variant} ${className}`.trim()}
        >
          {icon ?? selected?.icon}
          <span className={selected ? "dropdown-label" : "dropdown-label dropdown-placeholder"}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronDown className="dropdown-chevron" aria-hidden="true" />
        </Select.Trigger>
        {open && (
          <SelectMenu
            container={container}
            className="dropdown-menu"
            options={options.map((option) => ({ ...option, value: encode(option.value) }))}
          />
        )}
      </Select.Root>
      {required && (
        <input
          className="dropdown-required"
          tabIndex={-1}
          aria-hidden="true"
          required
          value={value}
          onChange={() => {}}
        />
      )}
    </>
  );
}
