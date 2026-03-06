/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import express from "express";
import * as sdk from "matrix-js-sdk";

const exec = promisify(execFile);

// ─── Configuration ──────────────────────────────────────────────────────────

const MATRIX_HOMESERVER_URL = process.env.MATRIX_HOMESERVER_URL ?? "http://localhost:8008";
const MATRIX_BOT_TOKEN = process.env.MATRIX_BOT_TOKEN ?? "";
const MATRIX_BOT_USER_ID = process.env.MATRIX_BOT_USER_ID ?? "";
const BUNDLE_PORT = parseInt(process.env.BUNDLE_PORT ?? "3001", 10);
const BUNDLE_BASE_URL = process.env.BUNDLE_BASE_URL ?? `http://localhost:${BUNDLE_PORT}`;

const WORKSPACE = path.resolve("./renderer-workspace");
const SYSTEM_PROMPT_PATH = path.resolve("./component-contract.md");
const BUNDLE_SERVE_DIR = path.resolve("./public/bundles");

const RENDERER_PROMPT_EVENT = "io.element.renderer_prompt";
const RENDERER_STATUS_EVENT = "io.element.renderer_status";
const RENDERER_STATE_EVENT = "io.element.custom_renderer";

// Extend matrix-js-sdk's StateEvents to include our custom event types
declare module "matrix-js-sdk" {
    interface StateEvents {
        "io.element.custom_renderer": {
            bundleUrl: string;
            displayName: string;
            schemaVersion: string;
            schema: { events: unknown[] };
        };
        "io.element.renderer_status": {
            status: "pending" | "ready" | "error";
            bundleUrl?: string;
            error?: string;
        };
    }
}

// ─── Matrix Client ──────────────────────────────────────────────────────────

const client = sdk.createClient({
    baseUrl: MATRIX_HOMESERVER_URL,
    accessToken: MATRIX_BOT_TOKEN,
    userId: MATRIX_BOT_USER_ID,
});

// Track rooms we're currently generating for, to avoid concurrent runs
const generating = new Set<string>();

client.on(sdk.RoomEvent.Timeline as any, async (event: any, room: any) => {
    if (!event || !room) return;
    if (event.getType() !== RENDERER_PROMPT_EVENT) return;

    const roomId: string = room.roomId;

    // Don't process our own events
    if (event.getSender() === MATRIX_BOT_USER_ID) return;

    // Don't run concurrently for the same room
    if (generating.has(roomId)) {
        console.log(`[bot] Already generating for ${roomId}, skipping`);
        return;
    }

    const userPrompt: string = event.getContent()?.body;
    if (!userPrompt) return;

    console.log(`[bot] Received prompt for ${roomId}: "${userPrompt}"`);
    generating.add(roomId);

    try {
        await generate(roomId, userPrompt);
    } catch (err) {
        console.error(`[bot] Generation failed for ${roomId}:`, err);
        await setStatus(roomId, "error", undefined, String(err));
    } finally {
        generating.delete(roomId);
    }
});

// ─── Generation Pipeline ────────────────────────────────────────────────────

async function generate(roomId: string, userPrompt: string): Promise<void> {
    const safeRoomId = roomId.replace(/[^a-zA-Z0-9]/g, "_");
    const outputDir = path.join(WORKSPACE, safeRoomId);

    // 1. Signal "working on it"
    await setStatus(roomId, "pending");

    // 2. Ensure workspace exists
    await fs.mkdir(path.join(outputDir, "src"), { recursive: true });
    await fs.mkdir(path.join(outputDir, "dist"), { recursive: true });

    // 3. Read system prompt
    const systemPrompt = await fs.readFile(SYSTEM_PROMPT_PATH, "utf-8");

    // 4. Invoke Claude Code
    const prompt = buildPrompt(userPrompt, outputDir);
    console.log(`[bot] Invoking Claude Code for ${roomId}...`);

    const { stdout } = await exec("claude", [
        "-p",
        prompt,
        "--system-prompt", systemPrompt,
        "--allowedTools", "Edit,Write,Bash",
        "--output-format", "json",
        "--max-turns", "20",
    ], {
        cwd: outputDir,
        timeout: 120_000, // 2 minutes max
        env: { ...process.env },
    });

    console.log(`[bot] Claude Code finished for ${roomId}`);

    // 5. Verify bundle exists
    const bundlePath = path.join(outputDir, "dist", "index.html");
    try {
        await fs.access(bundlePath);
    } catch {
        throw new Error(`Bundle not found at ${bundlePath}. Claude Code may have failed.`);
    }

    // 6. Copy to serve directory
    const bundleId = `${Date.now()}-${safeRoomId}`;
    const servePath = path.join(BUNDLE_SERVE_DIR, bundleId);
    await fs.mkdir(servePath, { recursive: true });
    await fs.cp(path.join(outputDir, "dist"), servePath, { recursive: true });

    const bundleUrl = `${BUNDLE_BASE_URL}/${bundleId}/index.html`;
    console.log(`[bot] Bundle ready at ${bundleUrl}`);

    // 7. Post renderer state event
    await client.sendStateEvent(roomId, RENDERER_STATE_EVENT, {
        bundleUrl,
        displayName: userPrompt.slice(0, 80),
        schemaVersion: "1",
        schema: { events: [] },
    }, "");

    // 8. Signal "done"
    await setStatus(roomId, "ready", bundleUrl);
}

function buildPrompt(userPrompt: string, outputDir: string): string {
    return `
Build a self-contained web component based on this user request:

"${userPrompt}"

Requirements:
1. Write the source file to ${outputDir}/src/index.html
2. Copy it to ${outputDir}/dist/index.html
3. The final output MUST be at ${outputDir}/dist/index.html
4. Verify the file exists and has valid HTML

If the build fails, read the error and fix it. Keep going until dist/index.html exists.
`.trim();
}

async function setStatus(
    roomId: string,
    status: "pending" | "ready" | "error",
    bundleUrl?: string,
    error?: string,
): Promise<void> {
    const content: sdk.StateEvents["io.element.renderer_status"] = {
        status,
        ...(bundleUrl !== undefined && { bundleUrl }),
        ...(error !== undefined && { error }),
    };

    try {
        await client.sendStateEvent(roomId, RENDERER_STATUS_EVENT, content, "");
    } catch (err) {
        console.error(`[bot] Failed to set status for ${roomId}:`, err);
    }
}

// ─── Static File Server ─────────────────────────────────────────────────────

const app = express();

// Serve bundles with CORS so Element can load them in iframes
app.use("/", express.static(BUNDLE_SERVE_DIR, {
    setHeaders: (res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
    },
}));

app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
});

// ─── Startup ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    // Ensure directories exist
    await fs.mkdir(WORKSPACE, { recursive: true });
    await fs.mkdir(BUNDLE_SERVE_DIR, { recursive: true });

    // Validate configuration
    if (!MATRIX_BOT_TOKEN) {
        console.error("[bot] MATRIX_BOT_TOKEN is required. Set it in your environment.");
        process.exit(1);
    }

    // Start the static file server
    app.listen(BUNDLE_PORT, () => {
        console.log(`[bot] Bundle server listening on http://localhost:${BUNDLE_PORT}`);
    });

    // Start the Matrix client
    console.log(`[bot] Connecting to ${MATRIX_HOMESERVER_URL} as ${MATRIX_BOT_USER_ID}...`);
    await client.startClient({ initialSyncLimit: 0 });
    console.log("[bot] Matrix client started. Listening for renderer prompts...");
}

main().catch((err) => {
    console.error("[bot] Fatal error:", err);
    process.exit(1);
});
