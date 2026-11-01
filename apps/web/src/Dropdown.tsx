import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { ReactNode } from "react";
import { useLazySelect } from "./shared";

export type DropdownOption = { value: string; label: string; icon?: ReactNode; disabled?: boolean };

// Radix items cannot use "" as a value, but "no selection" options are common.
const EMPTY = "\u0000empty";
const encode = (value: string) => (value === "" ? EMPTY : value);
const decode = (value: string) => (value === EMPTY ? "" : value);

// The one dropdown used everywhere. It shares its menu surface with the status
// and priority menus; `variant` only changes how the trigger sits in its row.
export function Dropdown({ value, onChange, options, disabled = false, required = false, id, "aria-label": ariaLabel, placeholder = "Select…", variant = "field", icon, className = "", title }: {
  value: string;
  onChange: (value: string, option: DropdownOption) => void;
  options: DropdownOption[];
  disabled?: boolean;
  required?: boolean;
  id?: string;
  "aria-label"?: string;
  placeholder?: string;
  // field: bordered, sized to its content. block: bordered, full width. ghost: borderless, for property rows and toolbars.
  variant?: "field" | "block" | "ghost";
  icon?: ReactNode;
  className?: string;
  title?: string;
}) {
  const pick = (raw: string) => onChange(raw, options.find((option) => option.value === raw)!);
  const { open, setOpen, trigger, container, onKeyDown } = useLazySelect(value, options, pick);
  const selected = options.find((option) => option.value === value);
  return <>
    <Select.Root open={open} onOpenChange={setOpen} value={encode(value)} onValueChange={(next) => pick(decode(next))} disabled={disabled}>
      <Select.Trigger ref={trigger} id={id} onKeyDown={onKeyDown} aria-label={ariaLabel} title={title ?? selected?.label} className={`dropdown dropdown-${variant} ${className}`.trim()}>
        {icon ?? selected?.icon}
        <span className={selected ? "dropdown-label" : "dropdown-label dropdown-placeholder"}>{selected?.label ?? placeholder}</span>
        <ChevronDown className="dropdown-chevron" aria-hidden="true" />
      </Select.Trigger>
      {open && <Select.Portal container={container || undefined}>
        <Select.Content className="priority-menu dropdown-menu" position="popper" sideOffset={5} align="start" collisionPadding={8}>
          <Select.Viewport>
            {options.map((option) => <Select.Item className="priority-option" value={encode(option.value)} key={option.value} disabled={option.disabled} textValue={option.label}>
              <span className="priority-check"><Select.ItemIndicator><Check className="icon" /></Select.ItemIndicator></span>
              {option.icon}
              <Select.ItemText>{option.label}</Select.ItemText>
            </Select.Item>)}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>}
    </Select.Root>
    {required && <input className="dropdown-required" tabIndex={-1} aria-hidden="true" required value={value} onChange={() => {}} />}
  </>;
}
