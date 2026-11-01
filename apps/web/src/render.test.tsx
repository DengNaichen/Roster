import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Auth, AuthorizationDetails, Consent } from "./features/auth";
import { Settings } from "./features/settings";
function settingsMarkup(role: "admin" | "member") {
  const client = new QueryClient();
  client.setQueryData(["workspaces"], {
    workspaces: [{ id: "workspace", slug: "acme", name: "Acme", role }],
  });
  client.setQueryData(["acme", "members"], {
    members: [{
      subject: "person",
      name: "Ada",
      email: "ada@example.com",
      role: "member",
      status: "active",
    }],
  });
  client.setQueryData(["acme", "directory"], { teams: [] });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/acme/settings"]}>
        <Routes>
          <Route path="/:slug/settings" element={<Settings />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
describe("deployment and permission screens", () => {
  it("renders OAuth application and requested permissions without raw authorization internals", () => {
    const html = renderToStaticMarkup(
      <AuthorizationDetails
        details={{
          authorization_id: "secret-request",
          redirect_uri: "https://client.example/callback",
          client: {
            id: "client-id",
            name: "Agent client",
            uri: "https://client.example",
            logo_uri: "",
          },
          user: { id: "user-id", email: "private@example.com" },
          scope: "openid profile",
        }}
      />,
    );
    expect(html).toContain("Agent client");
    expect(html).toContain("<li>openid</li>");
    expect(html).toContain("<li>profile</li>");
    expect(html).not.toContain("secret-request");
    expect(html).not.toContain("private@example.com");
  });
  it("does not offer consent decisions without an authorization request", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/oauth/consent"]}>
        <Consent />
      </MemoryRouter>,
    );
    expect(html).toContain("Missing authorization_id");
    expect(html).not.toContain(">Approve<");
  });
  it("explains missing configuration without presenting a working login", () => {
    const html = renderToStaticMarkup(<Auth />);
    expect(html).toContain("Connect your deployment");
    expect(html).toContain("VITE_SUPABASE_URL");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("Email me a sign-in link");
  });
  it("hides invitation and role mutations from workspace members", () => {
    const html = settingsMarkup("member");
    expect(html).toContain("Ada");
    expect(html).toContain("Workspace administrators manage");
    expect(html).not.toContain("Generate / reset invitation");
    expect(html).not.toContain('name="role"');
    expect(html).not.toContain('name="status"');
  });
  it("provides real administration controls to workspace admins", () => {
    const html = settingsMarkup("admin");
    expect(html).toContain("Generate / reset invitation");
    expect(html).toContain('name="role"');
    expect(html).toContain('name="status"');
  });
});
