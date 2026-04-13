/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Room name prefix that triggers the dynamic room renderer.
 * Any room whose name starts with this prefix will use a custom
 * LLM-generated view instead of the standard chat timeline.
 */
export const DYNAMIC_ROOM_PREFIX = "app-"

/**
 * Custom Matrix state event type that carries the renderer configuration
 * for a dynamic room: bundle URL, schema, and display name.
 * Posted by the client once the generation server returns a bundleUrl.
 */
export const RENDERER_STATE_EVENT = "io.element.custom_renderer"

/**
 * URL of the generation server's HTTP API endpoint.
 * Injected at build time via webpack DefinePlugin from the GENERATE_API_URL
 * environment variable, so the dev server can be reached from other machines
 * on the network (set automatically by dev.sh).
 */
export const GENERATE_API_URL = process.env.GENERATE_API_URL ?? "http://localhost:3001/generate"
