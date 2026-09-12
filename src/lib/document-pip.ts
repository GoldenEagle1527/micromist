/** Document Picture-in-Picture “fake ad” float for 摸鱼. */

export const FLOAT_QUERY = "float";

export type AdPipLabels = {
  adBadge: string;
  adTitle: string;
  unsupported: string;
};

declare global {
  interface DocumentPictureInPicture {
    requestWindow(options?: {
      width?: number;
      height?: number;
      disallowReturnToOpener?: boolean;
    }): Promise<Window>;
    readonly window: Window | null;
  }

  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

export function isFloatEmbed(): boolean {
  try {
    return new URLSearchParams(window.location.search).get(FLOAT_QUERY) === "1";
  } catch {
    return false;
  }
}

export function supportsDocumentPip(): boolean {
  return typeof window !== "undefined" && "documentPictureInPicture" in window;
}

function floatUrl(): string {
  const url = new URL(window.location.href);
  url.searchParams.set(FLOAT_QUERY, "1");
  return url.toString();
}

const AD_CSS = `
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    height: 100%;
    overflow: hidden;
    background: #1a1a1a;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .ad-shell {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 100%;
  }
  .ad-bar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.55rem;
    background: linear-gradient(180deg, #3a3a3a 0%, #2a2a2a 100%);
    border-bottom: 1px solid #111;
    color: #c8c8c8;
    font-size: 11px;
    letter-spacing: 0.02em;
    user-select: none;
    cursor: default;
  }
  .ad-badge {
    flex: 0 0 auto;
    padding: 0.1rem 0.35rem;
    border-radius: 2px;
    background: #f5c518;
    color: #111;
    font-weight: 700;
    font-size: 10px;
    text-transform: uppercase;
  }
  .ad-title {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.85;
  }
  .ad-frame {
    flex: 1 1 auto;
    width: 100%;
    border: 0;
    background: #fff;
    min-height: 0;
  }
`;

/**
 * Open a Document PiP window with fake advertisement chrome and an iframe
 * of the current micromist page. Requires a user gesture.
 */
export async function openAdDocumentPip(labels: AdPipLabels): Promise<void> {
  const api = window.documentPictureInPicture;
  if (!api) {
    throw new Error(labels.unsupported);
  }

  const existing = api.window;
  if (existing && !existing.closed) {
    existing.close();
  }

  const width = Math.min(420, Math.max(280, Math.round(window.screen.availWidth * 0.28)));
  const height = Math.min(720, Math.max(360, Math.round(window.screen.availHeight * 0.7)));

  const pip = await api.requestWindow({
    width,
    height,
    // Hides the “back to tab” control; origin title bar still required by Chrome.
    disallowReturnToOpener: true,
  });
  const doc = pip.document;

  doc.documentElement.lang = document.documentElement.lang || "zh";
  doc.head.replaceChildren();

  const meta = doc.createElement("meta");
  meta.setAttribute("charset", "utf-8");
  doc.head.appendChild(meta);

  const title = doc.createElement("title");
  title.textContent = labels.adTitle;
  doc.head.appendChild(title);

  const style = doc.createElement("style");
  style.textContent = AD_CSS;
  doc.head.appendChild(style);

  const shell = doc.createElement("div");
  shell.className = "ad-shell";

  const bar = doc.createElement("div");
  bar.className = "ad-bar";
  const badge = doc.createElement("span");
  badge.className = "ad-badge";
  badge.textContent = labels.adBadge;
  const ttl = doc.createElement("span");
  ttl.className = "ad-title";
  ttl.textContent = labels.adTitle;
  bar.append(badge, ttl);

  const iframe = doc.createElement("iframe");
  iframe.className = "ad-frame";
  iframe.src = floatUrl();
  iframe.title = labels.adTitle;
  iframe.allow = "autoplay; clipboard-write";

  shell.append(bar, iframe);
  doc.body.replaceChildren(shell);
}
