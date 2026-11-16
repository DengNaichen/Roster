import { afterEach } from "vitest";
import { focusManager, onlineManager, type QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createQueryClient, ServerCacheProvider } from "../queryCache";
const clients = new Set<QueryClient>();
export function createQueryWrapper(client = createQueryClient(true), subject = "test-user") {
  clients.add(client);
  focusManager.setFocused(true);
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ServerCacheProvider client={client} subject={subject}>
        {children}
      </ServerCacheProvider>
    );
  };
}
afterEach(() => {
  clients.forEach((client) => client.clear());
  clients.clear();
  onlineManager.setOnline(true);
  focusManager.setFocused(undefined);
});

// Explicit helpers avoid loading application/auth modules before a test's boundary mocks.
export * from "@testing-library/react";
import {
  render as renderBase,
  renderHook as renderHookBase,
  type RenderOptions,
  type RenderHookOptions,
} from "@testing-library/react";
export function render(ui: ReactNode, options?: RenderOptions) {
  return renderBase(ui, { ...options, wrapper: options?.wrapper ?? createQueryWrapper() });
}
export function renderHook<Result, Props>(
  render: (props: Props) => Result,
  options?: RenderHookOptions<Props>,
) {
  return renderHookBase(render, { ...options, wrapper: options?.wrapper ?? createQueryWrapper() });
}
