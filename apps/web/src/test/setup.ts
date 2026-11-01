import { vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// jsdom lacks the pointer and scroll APIs Radix Select uses when a menu opens.
Object.assign(Element.prototype, {
  hasPointerCapture: () => false,
  setPointerCapture: () => {},
  releasePointerCapture: () => {},
  scrollIntoView: () => {},
});

// Existing component tests exercise the original complete UI contract explicitly.
vi.mock("../Capabilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../Capabilities")>();
  const capabilities = Object.fromEntries(actual.capabilityNames.map(name => [name, true]));
  return {...actual, useCapabilities: () => capabilities, CapabilitiesProvider: ({children}: {children: React.ReactNode}) => children};
});

vi.mock("../integration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../integration")>();
  return {...actual, api: async (path: string, method = "GET", body?: object) => {
    const response = await fetch(path, {method, headers: {"Content-Type":"application/json"}, body: JSON.stringify(body)});
    if(response.status===401)window.dispatchEvent(new Event("session-expired"));
    if(response.ok)window.dispatchEvent(new Event("session-active"));
    const result=await response.json();
    if(!response.ok)throw new Error(typeof result.error === "string" ? result.error : result.error.message);
    return result;
  }};
});
