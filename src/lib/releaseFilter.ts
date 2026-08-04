const EXCLUDED_RELEASE_REGEX = /\b(?:cam(?:rip)?|hdcam|ts|tc|hdtc|hdts|telesync|telecine|lat|spa|fre|turko|french|vf2|truefrench|vff|kpfr|yg)\b/i;

export function isExcludedRelease(title: string | undefined | null): boolean {
  return !!title && EXCLUDED_RELEASE_REGEX.test(title);
}
