/**
 * Google People (Contacts) Tools — list, search, and create contacts.
 */

import { googleGet, googlePost, requireGoogleAuth } from "./api-client.js";
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";

const BASE = "https://people.googleapis.com/v1";

// ─── Types ───────────────────────────────────────────────────────────────────

type Person = {
    resourceName: string;
    names?: { displayName: string }[];
    emailAddresses?: { value: string }[];
    phoneNumbers?: { value: string }[];
    organizations?: { name: string; title?: string }[];
};

type PeopleList = { connections?: Person[]; totalPeople?: number };
type SearchResult = { results?: { person: Person }[] };

function formatContact(p: Person): string {
    const name = p.names?.[0]?.displayName ?? "Unknown";
    const email = p.emailAddresses?.map(e => e.value).join(", ") ?? "";
    const phone = p.phoneNumbers?.map(ph => ph.value).join(", ") ?? "";
    const org = p.organizations?.[0];
    let s = `👤 ${name}`;
    if (email) s += `\n   📧 ${email}`;
    if (phone) s += `\n   📱 ${phone}`;
    if (org) s += `\n   🏢 ${org.name}${org.title ? ` (${org.title})` : ""}`;
    return s;
}

// ─── Tools ───────────────────────────────────────────────────────────────────

export const peopleTools: ToolDefinition[] = [
    {
        name: "contacts_list",
        description: "List Google contacts. Shows name, email, phone, and organization.",
        parameters: {
            type: "object" as const,
            properties: {
                max_results: { type: "number", description: "Number of contacts (default 20)" },
            },
            required: [],
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            const authErr = requireGoogleAuth();
            if (authErr) return { type: "text", content: authErr };

            const max = Math.min(typeof args.max_results === "number" ? args.max_results : 20, 50);
            const res = await googleGet<PeopleList>(`${BASE}/people/me/connections`, {
                pageSize: String(max),
                personFields: "names,emailAddresses,phoneNumbers,organizations",
                sortOrder: "LAST_MODIFIED_DESCENDING",
            });
            if (!res.ok) return { type: "text", content: `Contacts error: ${res.error}` };
            if (!res.data.connections?.length) return { type: "text", content: "No contacts found." };
            return { type: "text", content: res.data.connections.map(formatContact).join("\n\n") };
        },
    },
    {
        name: "contacts_search",
        description: "Search Google contacts by name, email, or phone number.",
        parameters: {
            type: "object" as const,
            properties: {
                query: { type: "string", description: "Search term" },
            },
            required: ["query"],
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            const authErr = requireGoogleAuth();
            if (authErr) return { type: "text", content: authErr };

            const res = await googleGet<SearchResult>(`${BASE}/people:searchContacts`, {
                query: args.query as string,
                readMask: "names,emailAddresses,phoneNumbers,organizations",
                pageSize: "10",
            });
            if (!res.ok) return { type: "text", content: `Search error: ${res.error}` };
            if (!res.data.results?.length) return { type: "text", content: "No contacts found." };
            return { type: "text", content: res.data.results.map(r => formatContact(r.person)).join("\n\n") };
        },
    },
    {
        name: "contacts_create",
        description: "Create a new Google contact.",
        parameters: {
            type: "object" as const,
            properties: {
                name: { type: "string", description: "Full name" },
                email: { type: "string", description: "Email address" },
                phone: { type: "string", description: "Phone number" },
                company: { type: "string", description: "Company/organization name" },
                job_title: { type: "string", description: "Job title" },
            },
            required: ["name"],
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            const authErr = requireGoogleAuth();
            if (authErr) return { type: "text", content: authErr };

            const fullName = args.name as string;
            const person: Record<string, unknown> = {
                names: [{ givenName: fullName.split(" ")[0], familyName: fullName.split(" ").slice(1).join(" ") || undefined }],
            };
            if (args.email) person.emailAddresses = [{ value: args.email }];
            if (args.phone) person.phoneNumbers = [{ value: args.phone }];
            if (args.company) person.organizations = [{ name: args.company, title: args.job_title }];

            const res = await googlePost<Person>(`${BASE}/people:createContact`, person);
            if (!res.ok) return { type: "text", content: `Create failed: ${res.error}` };
            return { type: "text", content: `✅ Contact created: ${fullName}` };
        },
    },
];
