import { ReactNode } from "react";

export function PageHeader({
  children,
  actions,
  className = "",
}: {
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`header-row${className ? ` ${className}` : ""}`}>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        {children}
      </nav>
      {actions}
    </header>
  );
}
