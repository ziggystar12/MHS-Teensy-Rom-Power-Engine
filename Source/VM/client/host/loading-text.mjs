export const LOADING_TEXT_WIDTH = 25;
export const DEFAULT_LOADING_TEXT = "AGI GAME IS LOADING...";

export function loadingTextForTitle(value) {
  const suffix = " IS LOADING";
  const maxTitleLength = LOADING_TEXT_WIDTH - suffix.length;
  let title = [...String(value ?? "").trim().toUpperCase()]
    .map((character) => {
      const code = character.charCodeAt(0);
      return (code >= 65 && code <= 90) || (code >= 32 && code <= 63) ? character : " ";
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (title.startsWith("THE ") && title.length + suffix.length > LOADING_TEXT_WIDTH) {
    title = title.slice(4);
  }
  if (title.length > maxTitleLength) {
    let clipped = title.slice(0, maxTitleLength);
    if (title[maxTitleLength] !== " " && clipped.includes(" ")) {
      clipped = clipped.slice(0, clipped.lastIndexOf(" "));
    }
    title = clipped.trimEnd();
  }
  return `${title || "AGI GAME"}${suffix}`;
}

function loadingScreenCode(character) {
  const code = character.charCodeAt(0);
  if (code >= 65 && code <= 90) return code - 64;
  if (code >= 32 && code <= 63) return code;
  throw new Error(`Loading caption contains unsupported character ${JSON.stringify(character)}`);
}

export function encodeLoadingText(value = DEFAULT_LOADING_TEXT) {
  const caption = String(value).trim().toUpperCase();
  if (!caption || caption.length > LOADING_TEXT_WIDTH) {
    throw new Error(`Loading caption must be 1-${LOADING_TEXT_WIDTH} characters, got ${caption.length}`);
  }
  const leftPadding = Math.floor((LOADING_TEXT_WIDTH - caption.length) / 2);
  const centered = caption.padStart(caption.length + leftPadding).padEnd(LOADING_TEXT_WIDTH);
  return Buffer.from([...centered].map(loadingScreenCode));
}
