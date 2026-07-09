/**
 * Markdown parsing utilities for memorize-mcp
 * Provides content hashing, section parsing, and tag extraction
 */
import crypto from "crypto";
import type { Section } from "./types.js";

const MAX_HISTORY_ENTRIES = 10;
export { MAX_HISTORY_ENTRIES };

/**
 * Compute a SHA-256 hash of the given content string.
 * Returns a prefixed string like "sha256:abc123..."
 */
export function computeContentHash(content: string): string {
	return (
		"sha256:" +
		crypto.createHash("sha256").update(content, "utf8").digest("hex")
	);
}

/**
 * Extract inline #hashtag tokens from markdown content.
 * Markdown headings (# Heading — space after #) are excluded because
 * the regex requires the character immediately after # to be a word character.
 *
 * Examples matched: #typescript, #my-tag
 * Examples NOT matched: # Heading, https://example.com/#anchor
 */
export function extractTags(content: string): string[] {
	const tags = new Set<string>();
	for (const match of content.matchAll(/#(\w[\w-]*)/g)) {
		const tag = match[1];
		if (tag) tags.add(tag.toLowerCase());
	}
	return Array.from(tags);
}

/**
 * Determine the dominant content type of a markdown section body.
 */
function determineSectionType(body: string): "text" | "code" | "list" {
	const trimmed = body.trim();
	if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
		return "code";
	}
	const lines = trimmed.split("\n").filter((l) => l.trim().length > 0);
	if (lines.length > 0) {
		const listLines = lines.filter((l) => /^(\s*[-*+]|\s*\d+\.)/.test(l));
		if (listLines.length / lines.length > 0.5) {
			return "list";
		}
	}
	return "text";
}

/**
 * Extract the language identifier from an opening code fence line.
 * e.g. "```typescript" → "typescript"
 */
function extractCodeLanguage(body: string): string | undefined {
	const match = body.match(/^(?:```|~~~)(\w+)/);
	return match?.[1];
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Parse a raw markdown string into an array of Section objects.
 *
 * - Content before the first heading is collected as a preamble section
 *   with heading: "" and level: 0.
 * - Each ATX heading (# through ######) starts a new section.
 * - Code fences (``` or ~~~) are tracked so headings inside code blocks
 *   are not treated as section boundaries.
 */
export function parseMarkdownToSections(rawContent: string): Section[] {
	const lines = rawContent.split("\n");
	const sections: Section[] = [];

	let pendingHeading: string | null = null;
	let pendingLevel = 0;
	let pendingLines: string[] = [];
	let inCodeBlock = false;

	const usedIds = new Set<string>();

	function generateId(heading: string): string {
		let id = heading ? slugify(heading) : "preamble";
		if (!id) id = "section";
		let deduped = id;
		let counter = 2;
		while (usedIds.has(deduped)) {
			deduped = `${id}-${counter++}`;
		}
		usedIds.add(deduped);
		return deduped;
	}

	function flush(): void {
		const body = pendingLines.join("\n").trim();
		if (pendingHeading !== null || body) {
			const type = determineSectionType(body);
			const section: Section = {
				id: generateId(pendingHeading ?? ""),
				heading: pendingHeading ?? "",
				level: pendingLevel,
				body,
				type,
			};
			if (type === "code") {
				const lang = extractCodeLanguage(body);
				if (lang) section.language = lang;
			}
			sections.push(section);
		}
		pendingHeading = null;
		pendingLevel = 0;
		pendingLines = [];
	}

	for (const line of lines) {
		// Toggle code-block state when we encounter a code fence
		if (/^(`{3,}|~{3,})/.test(line)) {
			inCodeBlock = !inCodeBlock;
		}

		if (!inCodeBlock) {
			const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
			if (headingMatch) {
				flush();
				pendingHeading = headingMatch[2]?.trim() ?? "";
				pendingLevel = headingMatch[1]?.length ?? 1;
				continue;
			}
		}

		pendingLines.push(line);
	}

	flush();

	// Remove empty sections (no heading and no body)
	return sections.filter((s) => s.heading !== "" || s.body !== "");
}
