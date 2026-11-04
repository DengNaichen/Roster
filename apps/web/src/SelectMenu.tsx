import * as Select from "@radix-ui/react-select";
import { Check } from "lucide-react";
import { ReactNode } from "react";

export type MenuOption = { value: string; label: string; icon?: ReactNode; disabled?: boolean };

// The one menu surface behind every choice list: dropdowns, status and priority.
export function SelectMenu({
  options,
  container,
  className = "",
}: {
  options: MenuOption[];
  container: HTMLElement | null | undefined;
  className?: string;
}) {
  return (
    <Select.Portal container={container || undefined}>
      <Select.Content
        className={`select-menu ${className}`.trim()}
        position="popper"
        sideOffset={5}
        align="start"
        collisionPadding={8}
      >
        <Select.Viewport>
          {options.map((option) => (
            <Select.Item
              className="select-option"
              value={option.value}
              key={option.value}
              disabled={option.disabled}
              textValue={option.label}
            >
              {option.icon}
              <Select.ItemText>{option.label}</Select.ItemText>
              <span className="select-check">
                <Select.ItemIndicator>
                  <Check className="icon" />
                </Select.ItemIndicator>
              </span>
            </Select.Item>
          ))}
        </Select.Viewport>
      </Select.Content>
    </Select.Portal>
  );
}
