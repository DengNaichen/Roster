import { type MouseEvent, useLayoutEffect, useMemo, useRef } from "react";
import DOMPurify from "dompurify";
import "./issue-document.css";

const criterion = ".issue-doc-criteria > li";
const doneClass = "issue-doc-done";
const itemText = (item: Element) => item.textContent!.replace(/\s+/g, " ").trim();

// Issue HTML is document content: no scripts, styles, embeds or interactive controls.
function sanitizeIssueFragment(source: string) {
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
    doneClass,
  ]);
  for (const element of fragment.querySelectorAll("[class]")) {
    const allowed = [...element.classList].filter((name) => classes.has(name));
    if (allowed.length) element.setAttribute("class", allowed.join(" "));
    else element.removeAttribute("class");
  }
  return fragment;
}

function serialize(fragment: DocumentFragment) {
  const wrapper = document.createElement("div");
  wrapper.append(fragment);
  return wrapper.innerHTML;
}

export function sanitizeIssueHtml(source: string) {
  return serialize(sanitizeIssueFragment(source));
}

// Controls are added after sanitizing, so authored HTML can never contain them.
function renderIssueHtml(source: string, checkable: boolean) {
  const fragment = sanitizeIssueFragment(source);
  for (const list of fragment.querySelectorAll(".issue-doc-criteria")) {
    const items = [...list.children].filter((child) => child.tagName === "LI");
    for (const item of items) {
      const box = document.createElement("input");
      box.type = "checkbox";
      box.className = "issue-doc-check";
      box.setAttribute("aria-label", itemText(item));
      if (item.classList.contains(doneClass)) box.setAttribute("checked", "");
      if (!checkable) box.setAttribute("disabled", "");
      item.prepend(box);
    }
    const heading = list.closest("section")?.querySelector("h1, h2, h3, h4");
    if (heading && items.length) {
      const progress = document.createElement("span");
      progress.className = "issue-doc-progress";
      progress.setAttribute("aria-hidden", "true");
      progress.textContent = `${items.filter((item) => item.classList.contains(doneClass)).length}/${items.length}`;
      heading.append(progress);
    }
  }
  return serialize(fragment);
}

export type CriterionChange = { index: number; text: string; done: boolean };

// Edits the stored source rather than the sanitized copy, so everything else the author wrote is kept.
export function setCriterion(source: string, { index, text, done }: CriterionChange) {
  const template = document.createElement("template");
  template.innerHTML = source;
  const item = template.content.querySelectorAll(criterion)[index];
  if (!item || itemText(item) !== text)
    throw new Error("Acceptance criteria changed. Reload and try again.");
  item.classList.toggle(doneClass, done);
  if (!item.classList.length) item.removeAttribute("class");
  return template.innerHTML;
}

export function IssueDocument({
  text,
  onCriterionChange,
}: {
  text: string;
  onCriterionChange?: (change: CriterionChange) => void;
}) {
  const checkable = !!onCriterionChange;
  const html = useMemo(() => renderIssueHtml(text, checkable), [text, checkable]);
  const container = useRef<HTMLDivElement>(null);
  const refocus = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (refocus.current === null) return;
    const boxes = container.current?.querySelectorAll<HTMLElement>("input.issue-doc-check");
    boxes?.[refocus.current]?.focus();
    refocus.current = null;
  }, [html]);
  function toggle(event: MouseEvent<HTMLDivElement>) {
    const box = (event.target as Element).closest("input.issue-doc-check");
    if (!(box instanceof HTMLInputElement) || !onCriterionChange) return;
    // The description decides what is shown, so a failed save rolls the box back.
    event.preventDefault();
    const item = box.parentElement!;
    const index = [...event.currentTarget.querySelectorAll(criterion)].indexOf(item);
    if (document.activeElement === box) refocus.current = index;
    onCriterionChange({
      index,
      text: itemText(item),
      done: box.checked,
    });
  }
  return (
    <div
      ref={container}
      className="issue-document"
      onClick={toggle}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
