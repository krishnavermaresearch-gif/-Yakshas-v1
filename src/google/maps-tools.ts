/**
 * Google Maps / Places Tools — search places, get directions, geocode.
 */

import { googleGet, googlePost, requireGoogleAuth } from "./api-client.js";
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";

type Place = {
    displayName?: { text: string };
    formattedAddress?: string;
    rating?: number;
    userRatingCount?: number;
    googleMapsUri?: string;
    currentOpeningHours?: { openNow?: boolean };
    nationalPhoneNumber?: string;
};
type PlacesSearchResult = { places?: Place[] };
type GeoResult = { results: { formatted_address: string; geometry: { location: { lat: number; lng: number } } }[] };

function fmtPlace(p: Place, i: number): string {
    const n = p.displayName?.text ?? "Unknown";
    let s = `${i}. 📍 ${n}`;
    if (p.formattedAddress) s += `\n   ${p.formattedAddress}`;
    if (p.rating) s += `\n   ⭐ ${p.rating}`;
    if (p.nationalPhoneNumber) s += `\n   📞 ${p.nationalPhoneNumber}`;
    if (p.googleMapsUri) s += `\n   🔗 ${p.googleMapsUri}`;
    return s;
}

export const mapsTools: ToolDefinition[] = [
    {
        name: "maps_search",
        description: "Search for places on Google Maps.",
        parameters: {
            type: "object" as const, properties: {
                query: { type: "string", description: "Search query" },
                max_results: { type: "number", description: "Number of results (default 5)" },
            }, required: ["query"]
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            const err = requireGoogleAuth(); if (err) return { type: "text", content: err };
            const max = Math.min(typeof args.max_results === "number" ? args.max_results : 5, 10);
            const res = await googlePost<PlacesSearchResult>("https://places.googleapis.com/v1/places:searchText", { textQuery: args.query, maxResultCount: max });
            if (!res.ok) return { type: "text", content: `Maps error: ${res.error}` };
            if (!res.data.places?.length) return { type: "text", content: "No places found." };
            return { type: "text", content: res.data.places.map((p, i) => fmtPlace(p, i + 1)).join("\n\n") };
        },
    },
    {
        name: "maps_directions",
        description: "Get directions between two locations.",
        parameters: {
            type: "object" as const, properties: {
                origin: { type: "string", description: "Starting location" },
                destination: { type: "string", description: "Destination" },
                mode: { type: "string", description: "DRIVE, WALK, BICYCLE, or TRANSIT (default: DRIVE)" },
            }, required: ["origin", "destination"]
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            const err = requireGoogleAuth(); if (err) return { type: "text", content: err };
            const res = await googlePost<{ routes?: { distanceMeters: number; duration: string; description?: string }[] }>(
                "https://routes.googleapis.com/directions/v2:computeRoutes",
                { origin: { address: args.origin }, destination: { address: args.destination }, travelMode: (args.mode as string) ?? "DRIVE" }
            );
            if (!res.ok) return { type: "text", content: `Directions error: ${res.error}` };
            if (!res.data.routes?.length) return { type: "text", content: "No route found." };
            const r = res.data.routes[0];
            const km = (r.distanceMeters / 1000).toFixed(1);
            const min = Math.round(parseInt(r.duration.replace("s", "")) / 60);
            return { type: "text", content: `🗺️ ${args.origin} → ${args.destination}\n📏 ${km} km | ⏱️ ${min} min` };
        },
    },
    {
        name: "maps_geocode",
        description: "Convert an address to coordinates.",
        parameters: {
            type: "object" as const, properties: {
                address: { type: "string", description: "Address to geocode" },
            }, required: ["address"]
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            const err = requireGoogleAuth(); if (err) return { type: "text", content: err };
            const res = await googleGet<GeoResult>("https://maps.googleapis.com/maps/api/geocode/json", { address: args.address as string });
            if (!res.ok) return { type: "text", content: `Geocode error: ${res.error}` };
            if (!res.data.results?.length) return { type: "text", content: "Address not found." };
            const r = res.data.results[0];
            return { type: "text", content: `📍 ${r.formatted_address}\n📐 ${r.geometry.location.lat}, ${r.geometry.location.lng}` };
        },
    },
];
