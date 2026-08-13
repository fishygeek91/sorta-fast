/**
 * Footer disclosure panels for site copy (issue #16).
 *
 * Builds native `<details>` drawers from {@link siteCopy} — no trace imports,
 * no playback or scheduler wiring.
 */

import {
  COST_TABLE_LINK_LABEL,
  COST_TABLE_SOURCE_URL,
  DISCLOSURE_LABELS,
  EXPLAINER_COPY,
  FAIRNESS_COPY,
  PAPER_LINKS,
} from "./siteCopy.ts";

/**
 * Create an external link with safe new-tab attributes.
 *
 * @param href - Absolute HTTPS destination.
 * @param label - Visible link text.
 */
function createExternalLink(href: string, label: string): HTMLAnchorElement {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.textContent = label;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  return anchor;
}

/**
 * Create a paragraph element with plain text content.
 *
 * @param text - Paragraph body copy.
 */
function createParagraph(text: string): HTMLParagraphElement {
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  return paragraph;
}

/**
 * Append one list item per string into an unordered list.
 *
 * @param list - Target `<ul>` element.
 * @param items - Plain-text item strings.
 */
function appendTextListItems(list: HTMLUListElement, items: readonly string[]): void {
  for (const text of items) {
    const item = document.createElement("li");
    item.textContent = text;
    list.append(item);
  }
}

/**
 * Build the explainer disclosure body: barrier history, personas, vocabulary.
 */
function buildExplainerBody(): HTMLDivElement {
  const body = document.createElement("div");
  body.className = "site-disclosure-body";

  body.append(createParagraph(EXPLAINER_COPY.barrier), createParagraph(EXPLAINER_COPY.argument));

  const personaList = document.createElement("ul");
  for (const persona of EXPLAINER_COPY.personas) {
    const item = document.createElement("li");
    item.dataset.accent = persona.accent;
    item.textContent = `${persona.lane} — ${persona.persona} (${persona.accent}). ${persona.blurb}`;
    personaList.append(item);
  }
  body.append(personaList);

  const vocabularyList = document.createElement("ul");
  for (const entry of EXPLAINER_COPY.vocabulary) {
    const item = document.createElement("li");
    item.textContent = `${entry.term}: ${entry.meaning}`;
    vocabularyList.append(item);
  }
  body.append(vocabularyList);

  return body;
}

/**
 * Build the fairness disclosure body: work-clock rules, billed ops, source link.
 */
function buildFairnessBody(): HTMLDivElement {
  const body = document.createElement("div");
  body.className = "site-disclosure-body";

  body.append(createParagraph(FAIRNESS_COPY.intro));

  const billedList = document.createElement("ul");
  appendTextListItems(billedList, FAIRNESS_COPY.billed);
  body.append(billedList);

  const unbilledList = document.createElement("ul");
  appendTextListItems(unbilledList, FAIRNESS_COPY.unbilled);
  body.append(unbilledList);

  body.append(
    createParagraph(FAIRNESS_COPY.headline),
    createParagraph(FAIRNESS_COPY.secondary),
    createParagraph(FAIRNESS_COPY.honesty),
    createParagraph(FAIRNESS_COPY.sourceLead),
    createExternalLink(COST_TABLE_SOURCE_URL, COST_TABLE_LINK_LABEL),
  );

  return body;
}

/**
 * Build the papers disclosure body: external references in display order.
 */
function buildPapersBody(): HTMLDivElement {
  const body = document.createElement("div");
  body.className = "site-disclosure-body";

  const paperList = document.createElement("ul");
  for (const paper of PAPER_LINKS) {
    const item = document.createElement("li");
    item.append(createExternalLink(paper.href, paper.label));
    paperList.append(item);
  }
  body.append(paperList);

  return body;
}

/**
 * Create one native `<details>` drawer with a labeled summary and body content.
 *
 * @param label - `<summary>` trigger text.
 * @param body - Inner `.site-disclosure-body` element.
 */
function createDisclosure(label: string, body: HTMLDivElement): HTMLDetailsElement {
  const details = document.createElement("details");
  details.className = "site-disclosure";

  const summary = document.createElement("summary");
  summary.textContent = label;

  details.append(summary, body);
  return details;
}

/**
 * Mount footer disclosure drawers onto a parent element.
 *
 * Appends a `<footer class="site-disclosures">` with three independent
 * `<details>` panels (explainer, fairness, papers) built from {@link siteCopy}.
 *
 * @param parent - DOM node that receives the footer.
 * @returns The mounted footer element.
 * @throws If `parent` is not an `HTMLElement`.
 */
export function mountDisclosures(parent: HTMLElement): HTMLElement {
  if (!(parent instanceof HTMLElement)) {
    throw new Error("mountDisclosures requires an HTMLElement parent");
  }

  const footer = document.createElement("footer");
  footer.className = "site-disclosures";

  footer.append(
    createDisclosure(DISCLOSURE_LABELS.explainer, buildExplainerBody()),
    createDisclosure(DISCLOSURE_LABELS.fairness, buildFairnessBody()),
    createDisclosure(DISCLOSURE_LABELS.papers, buildPapersBody()),
  );

  parent.append(footer);
  return footer;
}
