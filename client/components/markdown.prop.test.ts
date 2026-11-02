import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fc from "fast-check";
import { holds } from "#shared/propertyTestutil.ts";
import { inlineText, parseInline, parseMarkdown, safeLinkHref, type Block, type Inline, type MarkdownOptions } from "./markdown.ts";

/**
 * Property tests of the Markdown subset (markdown.ts). Journal pages are
 * typed by the DM and shown to players, so the parser meets any text, and
 * its tree is all Markdown.tsx renders: whatever the text, every node must
 * be one its option set allows, every link must open only an https address
 * or a heading on the page, and no text may be lost or invented.
 * markdown.test.ts pins the cases by hand.
 */

const STAT_BLOCK: MarkdownOptions = {};
const JOURNAL: MarkdownOptions = { journal: true };
const GUIDE: MarkdownOptions = { guide: true };
const options = fc.constantFrom(STAT_BLOCK, JOURNAL, GUIDE);

/** The anchor a guide link may name, as markdown.ts's ANCHOR spells it. */
const ANCHOR = /^#[\p{L}\p{M}\p{N}_-]{1,200}$/u;
/** A guide image's path: relative, with no scheme and no query. */
const IMAGE_SRC = /^[A-Za-z0-9_./-]{1,300}$/;
const MAX_QUOTE_DEPTH = 3;

const prose = fc.constantFrom("a", "word", " ", "Goblin", "\u00e9", "\u{1F600}", "1", ".", "_", "-", "#", ">", "(", ")", "|", "!", ":", "\t");
const inlineSyntax = fc.constantFrom("*", "**", "\\", "\\*", "\\[", "`", "[", "]", "](", "\n");
const lineSyntax = fc.constantFrom("\n", "\r\n", "\n\n", "\n> ", "\n>", "\n- ", "\n  - ", "\n1. ", "\n2) ", "\n# ", "\n## ", "\n### ", "\n| a | b |", "\n|---|---|", "\n> [!TIP]", "\n> [!NOTE]", "\n> [!WARNING]", "\n> > > > ");
const links = fc.constantFrom(
  "[x](https://example.com/a)",
  "[x](http://example.com)",
  "[x](javascript:alert(1))",
  "[x](JaVaScRiPt:alert(1))",
  "[x](#areas)",
  "[x](#)",
  "[x](dm-guide.md)",
  "[x](https:example.com)",
  "[x](https://)",
  "[x](https://a.example/\"onclick)",
  "[**b**](https://e.example)",
  "[[x]](https://e.example)",
  "[a [b](https://e.example)](https://f.example)",
  "\n![alt](dm-guide/x.webp)",
  "\n![a](https://e.example/x.png)",
  "\n![a](../../x.webp)",
);
const markdownText = fc
  .array(
    fc.oneof(
      { weight: 6, arbitrary: prose },
      { weight: 4, arbitrary: inlineSyntax },
      { weight: 3, arbitrary: lineSyntax },
      { weight: 2, arbitrary: links },
      { weight: 1, arbitrary: fc.string({ unit: "binary", maxLength: 4 }) },
    ),
    // fast-check keeps arrays to about ten items unless asked, too few for nested quotes and lists.
    { maxLength: 50, size: "medium" },
  )
  .map((pieces) => pieces.join(""));

function assertHttps(href: string): void {
  const url = new URL(href);
  assert.equal(url.protocol, "https:", `${href} is https`);
  assert.notEqual(url.hostname, "", `${href} has a host`);
  assert.equal(url.href, href, `${href} is already in the form the browser reads`);
}

function checkInline(nodes: Inline[], opts: MarkdownOptions, inLink: boolean): void {
  const journal = opts.journal === true || opts.guide === true;
  const guide = opts.guide === true;
  for (const node of nodes) {
    switch (node.kind) {
      case "text":
        assert.notEqual(node.text, "", "no empty text node");
        break;
      case "bold":
      case "italic":
        assert.ok(node.children.length > 0, `an empty ${node.kind} stays literal`);
        checkInline(node.children, opts, inLink);
        break;
      case "break":
        assert.ok(journal, "a line break inside a paragraph is the journal's");
        break;
      case "link":
        assert.ok(journal, "links are the journal's");
        assert.ok(!inLink, "a link's text never holds another link");
        if (guide && ANCHOR.test(node.href)) assert.ok(node.href.startsWith("#"));
        else assertHttps(node.href);
        checkInline(node.children, opts, true);
        break;
      case "code":
        assert.ok(guide, "code spans are the guide's");
        assert.ok(node.text !== "" && !node.text.includes("\n"), "a code span is one line and not empty");
        break;
      default:
        assert.fail(`no inline kind ${(node as { kind: string }).kind}`);
    }
  }
}

function checkBlocks(blocks: Block[], opts: MarkdownOptions, depth: number): void {
  const journal = opts.journal === true || opts.guide === true;
  const guide = opts.guide === true;
  for (const block of blocks) {
    switch (block.kind) {
      case "heading":
        assert.ok(block.level === 2 || block.level === 3 || (journal && block.level === 1), `level ${block.level} heading`);
        assert.equal(typeof block.id === "string", guide, "headings have ids in the guide alone");
        checkInline(block.content, opts, false);
        break;
      case "paragraph":
        checkInline(block.content, opts, false);
        break;
      case "list":
        assert.ok(block.items.length > 0);
        if (block.start !== undefined) assert.ok(journal && Number.isSafeInteger(block.start) && block.start >= 0, "numbered lists are the journal's");
        if (block.sub !== undefined) {
          assert.ok(guide, "nested bullets are the guide's");
          assert.equal(block.sub.length, block.items.length, "one list of bullets per item");
          for (const items of block.sub) for (const item of items) checkInline(item, opts, false);
        }
        for (const item of block.items) checkInline(item, opts, false);
        break;
      case "image":
        assert.ok(guide, "images are the guide's");
        assert.match(block.src, IMAGE_SRC, "an image names only a relative path");
        assert.ok(!block.alt.includes("\n"));
        break;
      case "table":
        for (const cell of block.header) checkInline(cell, opts, false);
        for (const row of block.rows) for (const cell of row) checkInline(cell, opts, false);
        break;
      case "quote":
        assert.ok(journal, "quotes are the journal's");
        assert.ok(depth < MAX_QUOTE_DEPTH, `quotes nest at most ${MAX_QUOTE_DEPTH} deep`);
        if (block.alert !== undefined) assert.ok(guide && depth === 0 && (block.alert === "tip" || block.alert === "note"), "an alert is the guide's, at the top, a tip or a note");
        checkBlocks(block.blocks, opts, depth + 1);
        break;
      default:
        assert.fail(`no block kind ${(block as { kind: string }).kind}`);
    }
  }
}

/** Every heading id on a page, quotes included. */
function headingIds(blocks: Block[]): string[] {
  return blocks.flatMap((b) => (b.kind === "heading" && b.id !== undefined ? [b.id] : b.kind === "quote" ? headingIds(b.blocks) : []));
}

describe("the Markdown subset, over any text (property)", () => {
  test("never throws, and every node, link and image is one its option set allows", () => {
    holds(
      fc.property(fc.oneof(markdownText, fc.string({ unit: "binary", maxLength: 80 })), options, (text, opts) => {
        checkBlocks(parseMarkdown(text, opts), opts, 0);
        checkInline(parseInline(text, opts), opts, false);
      }),
      10_000,
    );
  });

  test("inline text keeps every character but the markers and escapes it reads", () => {
    // The characters markdown.ts reads as syntax inline: emphasis markers and escapes, and in the guide code spans' backticks.
    const strip = (s: string, opts: MarkdownOptions) => s.replace(opts.guide ? /[*\\`]/g : /[*\\]/g, "");
    holds(
      fc.property(
        // A link's address is dropped by design, so only text without links compares whole.
        markdownText.map((s) => s.replace(/\[/g, "(")),
        options,
        (text, opts) => {
          const journal = opts.journal === true || opts.guide === true;
          // A journal's line break is a break node, which reads back as a space.
          const expected = journal ? text.replace(/\n/g, " ") : text;
          assert.equal(strip(inlineText(parseInline(text, opts)), opts), strip(expected, opts));
        },
      ),
      5_000,
    );
  });

  test("a guide page's heading ids are all different, so every link reaches its own heading", () => {
    const heading = fc.constantFrom("Areas", "areas", "Areas!", "Areas 1", "Areas-1", "areas-1", "areas-2", "Areas 2", "A", "a-1", "", "?");
    holds(
      fc.property(fc.array(fc.tuple(fc.constantFrom("# ", "## ", "### ", "> ## "), heading), { maxLength: 8 }), (lines) => {
        const ids = headingIds(parseMarkdown(lines.map(([mark, text]) => mark + text).join("\n"), GUIDE));
        assert.equal(new Set(ids).size, ids.length, `ids ${JSON.stringify(ids)}`);
      }),
      2_000,
    );
  });

  test("an address a link may open is already in its final form", () => {
    const address = fc
      .tuple(
        fc.constantFrom("https://", "HTTPS://", "https:", "https:///", "http://", "javascript:", ""),
        fc.constantFrom("example.com", "EXAMPLE.com", "a.example", "xn--bcher-kva.example", "b\u00fccher.example", "[::1]", "1.2.3.4", "user:pw@e.example", "e.example:443", "e.example:8443", ""),
        fc.array(fc.constantFrom("/", "a", "..", ".", "%2e", "%zz", "%41", "?", "#", "&", "=", " ", "\\", "\u00e9", "\t", "\n"), { maxLength: 10 }),
      )
      .map(([scheme, host, path]) => scheme + host + path.join(""));
    holds(
      fc.property(fc.oneof(address, fc.string({ maxLength: 40 })), (raw) => {
        const href = safeLinkHref(raw);
        if (href === null) return;
        assertHttps(href);
      }),
      5_000,
    );
  });
});
