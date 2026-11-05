import { useMemo } from "react";
import DOMPurify from "dompurify";
import { MarkdownText } from "./MarkdownText";
import "./issue-document.css";

export function isIssueHtml(source: string) {
  return /^\s*(?:<!doctype html>\s*)?<(?:html|body|article|section|header|div|p|h[1-6]|ul|ol|table|blockquote|pre)(?:\s|>)/i.test(
    source,
  );
}

// Issue HTML is document content: no scripts, styles, embeds or interactive controls.
export function sanitizeIssueHtml(source: string) {
  const fragment = DOMPurify.sanitize(source, {
    ALLOWED_TAGS: [
      "article",
      "section",
      "header",
      "aside",
      "div",
      "span",
      "p",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ul",
      "ol",
      "li",
      "strong",
      "b",
      "em",
      "i",
      "s",
      "del",
      "br",
      "hr",
      "blockquote",
      "pre",
      "code",
      "a",
      "table",
      "caption",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "th",
      "td",
      "dl",
      "dt",
      "dd",
      "figure",
      "figcaption",
    ],
    ALLOWED_ATTR: ["class", "href", "title", "colspan", "rowspan", "scope", "start"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });
  const classes = new Set([
    "issue-doc-lead",
    "issue-doc-columns",
    "issue-doc-panel",
    "issue-doc-scope",
    "issue-doc-note",
    "issue-doc-criteria",
  ]);
  for (const element of fragment.querySelectorAll("[class]")) {
    const allowed = [...element.classList].filter((name) => classes.has(name));
    if (allowed.length) element.setAttribute("class", allowed.join(" "));
    else element.removeAttribute("class");
  }
  const wrapper = document.createElement("div");
  wrapper.append(fragment);
  return wrapper.innerHTML;
}

export function IssueDocument({ text }: { text: string }) {
  const html = useMemo(() => (isIssueHtml(text) ? sanitizeIssueHtml(text) : null), [text]);
  return html === null ? (
    <MarkdownText text={text} />
  ) : (
    <div className="issue-document" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
