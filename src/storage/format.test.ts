import { describe, expect, test } from "bun:test";
import { parseSession, parseSummary, renderEntry, renderSession, renderSummary, revisionOf } from "./format.js";

const sessionId = "514625c4-faf2-4fbe-b759-8404d9987c40";
const entryId = "83cae40d-370d-4534-8a6b-4b0dbf57ddaa";
const timestamp = "2026-10-21T00:00:00.000Z";

describe("Markdown format", () => {
	test("round-trips free Markdown and UTF-8 byte framing", () => {
		const content = 'Tiếng Việt 🙂\r\n## arbitrary\n```md\n<!-- memorize:entry {} -->\n```\n';
		const entry = { entryId, title: "Decision --> & <", timestamp, content };
		const bytes = renderSession({ sessionId, startedAt: timestamp, goal: "Research" }, [entry]);
		expect(parseSession(bytes).entries).toEqual([entry]);
		expect(parseSession(bytes).meta.goal).toBe("Research");
		expect(renderEntry(entry).toString()).toContain('id="entry-' + entryId);
	});
	test("rejects truncated or malformed framing and unknown versions", () => {
		const bytes = renderSession({ sessionId, startedAt: timestamp }, [{ entryId, title: "A", timestamp, content: "🙂" }]);
		expect(() => parseSession(bytes.subarray(0, bytes.length - 3))).toThrow();
		expect(() => parseSession(Buffer.from(bytes.toString().replace('"contentBytes":4', '"contentBytes":400')))).toThrow();
		expect(() => parseSummary(Buffer.from("<!-- memorize:memory version=99 -->\nbody"))).toThrow();
	});
	test("summary preserves content and hashes all bytes", () => {
		const content = "# Memory\n\nA fact.\r\n";
		const bytes = renderSummary(content);
		expect(parseSummary(bytes).content).toBe(content);
		expect(revisionOf(bytes)).not.toBe(revisionOf(Buffer.concat([bytes, Buffer.from(" ")])));
	});
	test("preserves a leading U+FEFF in entry payload", () => {
		const entry = { entryId, title: "BOM", timestamp, content: "\uFEFFDecision" };
		expect(parseSession(renderSession({ sessionId, startedAt: timestamp }, [entry])).entries[0]?.content).toBe(entry.content);
	});
	test("summary remains editable when an editor uses CRLF", () => {
		const bytes = Buffer.from("<!-- memorize:memory version=1 -->\r\n# Memory\r\n\r\nFact\r\n");
		expect(parseSummary(bytes).content).toBe("# Memory\r\n\r\nFact\r\n");
	});
});
