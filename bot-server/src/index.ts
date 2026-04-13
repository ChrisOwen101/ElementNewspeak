/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"
import * as path from "node:path"
import * as fs from "node:fs/promises"
import express from "express"

const exec = promisify(execFile)

// ─── Configuration ──────────────────────────────────────────────────────────

const BUNDLE_PORT = parseInt(process.env.BUNDLE_PORT ?? "3001", 10)
const BUNDLE_BASE_URL = process.env.BUNDLE_BASE_URL ?? `http://localhost:${BUNDLE_PORT}`

const WORKSPACE = path.resolve("./renderer-workspace")
const SYSTEM_PROMPT_PATH = path.resolve("./component-contract.md")
const BUNDLE_SERVE_DIR = path.resolve("./public/bundles")

// Track rooms we're currently generating for, to avoid concurrent runs
const generating = new Set<string>()

// ─── Generation Pipeline ────────────────────────────────────────────────────

async function generate(roomId: string, userPrompt: string): Promise<string> {
    const safeRoomId = roomId.replace(/[^a-zA-Z0-9]/g, "_")
    const outputDir = path.join(WORKSPACE, safeRoomId)

    // 1. Ensure workspace exists
    await fs.mkdir(path.join(outputDir, "src"), { recursive: true })
    await fs.mkdir(path.join(outputDir, "dist"), { recursive: true })

    // 2. Read system prompt and build user prompt
    const systemPrompt = await fs.readFile(SYSTEM_PROMPT_PATH, "utf-8")
    const prompt = buildPrompt(userPrompt)
    console.log(`[server] Invoking Claude Code for ${roomId} (cwd: ${outputDir})...`)

    // 3. Invoke Claude Code using spawn to stream output and avoid buffer limits
    const args = [
        "-p", prompt,
        "--system-prompt", systemPrompt,
        "--dangerously-skip-permissions",
        "--output-format", "json",
        "--max-turns", "20",
    ]

    await new Promise<void>((resolve, reject) => {
        const child = spawn("claude", args, {
            cwd: outputDir,
            env: { ...process.env },
            stdio: ["ignore", "pipe", "pipe"],
        })

        let stdout = ""
        let stderr = ""
        child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString() })
        child.stderr.on("data", (chunk: Buffer) => {
            const line = chunk.toString().trim()
            if (line) console.log(`[server] [claude] ${line}`)
            stderr += line + "\n"
        })

        const timer = setTimeout(() => {
            child.kill("SIGTERM")
            reject(new Error("Claude Code timed out after 5 minutes"))
        }, 300_000)

        child.on("close", (code) => {
            clearTimeout(timer)
            // Log Claude's result summary
            try {
                const result = JSON.parse(stdout)
                console.log(`[server] Claude result: turns=${result.num_turns}, cost=$${result.total_cost_usd?.toFixed(4)}`)
                console.log(`[server] Claude summary: ${(result.result || "").slice(0, 200)}`)
            } catch {
                console.log(`[server] Claude stdout (raw): ${stdout.slice(0, 300)}`)
            }
            if (code === 0) {
                resolve()
            } else {
                reject(new Error(`Claude Code exited with code ${code}. stderr: ${stderr.slice(0, 500)}`))
            }
        })

        child.on("error", (err) => {
            clearTimeout(timer)
            reject(err)
        })
    })

    // 4. Verify bundle exists
    const bundlePath = path.join(outputDir, "dist", "index.html")
    try {
        await fs.access(bundlePath)
    } catch {
        // Check if it was written to src/ but not copied
        const srcPath = path.join(outputDir, "src", "index.html")
        try {
            await fs.access(srcPath)
            console.log(`[server] Found src/index.html but not dist/index.html, copying...`)
            await fs.cp(srcPath, bundlePath)
        } catch {
            throw new Error(`Bundle not found at ${bundlePath}. Claude Code may have failed.`)
        }
    }

    // 5. Copy to serve directory
    const bundleId = `${Date.now()}-${safeRoomId}`
    const servePath = path.join(BUNDLE_SERVE_DIR, bundleId)
    await fs.mkdir(servePath, { recursive: true })
    await fs.cp(path.join(outputDir, "dist"), servePath, { recursive: true })

    const bundleUrl = `${BUNDLE_BASE_URL}/bundles/${bundleId}/index.html`
    console.log(`[server] Bundle ready at ${bundleUrl}`)

    return bundleUrl
}

function buildPrompt(userPrompt: string): string {
    return `
Build a self-contained web component based on this user request:

"${userPrompt}"

Write the output to src/index.html in the current directory, then copy it to dist/index.html.
Verify dist/index.html exists before finishing.
`.trim()
}

// ─── HTTP Server ────────────────────────────────────────────────────────────

const app = express()
app.use(express.json())

// CORS for all routes
app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")
    if (_req.method === "OPTIONS") {
        res.sendStatus(204)
        return
    }
    next()
})

// POST /generate — accepts { roomId, prompt }, returns { bundleUrl }
app.post("/generate", async (req, res) => {
    const { roomId, prompt } = req.body

    if (!roomId || typeof roomId !== "string") {
        res.status(400).json({ error: "roomId is required" })
        return
    }
    if (!prompt || typeof prompt !== "string") {
        res.status(400).json({ error: "prompt is required" })
        return
    }

    if (generating.has(roomId)) {
        res.status(409).json({ error: "Generation already in progress for this room" })
        return
    }

    generating.add(roomId)
    console.log(`[server] Received prompt for ${roomId}: "${prompt}"`)

    try {
        const bundleUrl = await generate(roomId, prompt)
        res.json({ bundleUrl })
    } catch (err) {
        console.error(`[server] Generation failed for ${roomId}:`, err)
        res.status(500).json({ error: String(err) })
    } finally {
        generating.delete(roomId)
    }
})

// Serve bundles as static files
app.use("/bundles", express.static(BUNDLE_SERVE_DIR))

app.get("/health", (_req, res) => {
    res.json({ status: "ok" })
})

// ─── Startup ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    // Ensure directories exist
    await fs.mkdir(WORKSPACE, { recursive: true })
    await fs.mkdir(BUNDLE_SERVE_DIR, { recursive: true })

    app.listen(BUNDLE_PORT, "0.0.0.0", () => {
        console.log(`[server] Listening on http://localhost:${BUNDLE_PORT}`)
        console.log(`[server] POST /generate — submit a prompt`)
        console.log(`[server] GET  /bundles/  — serve generated bundles`)
        console.log(`[server] GET  /health    — liveness check`)
    })
}

main().catch((err) => {
    console.error("[server] Fatal error:", err)
    process.exit(1)
})
